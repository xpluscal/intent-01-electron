import { Project, Reference, ProjectsMetadata, RefMetadata, ReferenceType, ReferenceSubtype } from '@/types/projects'

const PROJECTS_FILE = '.intent-projects.json'
const REF_METADATA_FILE = '.intent-ref.json'

export class ProjectManager {
  // @ts-ignore
  private _workspacePath: string = ''
  // @ts-ignore
  private _projectsCache: ProjectsMetadata | null = null

  constructor() {
    // Initialize with workspace path from IPC
    this.initializeWorkspace()
  }

  private async initializeWorkspace() {
    this._workspacePath = await window.intentAPI.getWorkspacePath()
  }

  // Load projects metadata
  async loadProjects(): Promise<ProjectsMetadata> {
    try {
      const content = await window.intentAPI.readFile(PROJECTS_FILE)
      const metadata = JSON.parse(content) as ProjectsMetadata
      
      // Convert date strings back to Date objects
      Object.values(metadata.projects).forEach(project => {
        project.created = new Date(project.created)
        project.modified = new Date(project.modified)
      })
      
      this._projectsCache = metadata
      return metadata
    } catch (error) {
      // If file doesn't exist, return empty projects
      return {
        version: '1.0',
        projects: {}
      }
    }
  }

  // Save projects metadata
  async saveProjects(metadata: ProjectsMetadata): Promise<void> {
    await window.intentAPI.writeFile(PROJECTS_FILE, JSON.stringify(metadata, null, 2))
    this._projectsCache = metadata
  }

  // Create a new project
  async createProject(name: string, description?: string, emoji?: string): Promise<Project> {
    const projects = await this.loadProjects()
    const id = this.generateId(name)
    
    const project: Project = {
      id,
      name,
      description,
      emoji,
      created: new Date(),
      modified: new Date(),
      refs: []
    }
    
    projects.projects[id] = project
    await this.saveProjects(projects)
    
    return project
  }

  // Add reference to project
  async addRefToProject(projectId: string, refId: string): Promise<void> {
    const projects = await this.loadProjects()
    const project = projects.projects[projectId]
    
    if (!project) {
      throw new Error(`Project ${projectId} not found`)
    }
    
    if (!project.refs.includes(refId)) {
      project.refs.push(refId)
      project.modified = new Date()
      await this.saveProjects(projects)
    }
    
    // Update ref metadata to include this project
    await this.updateRefProject(refId, projectId, 'add')
  }

  // Remove reference from project
  async removeRefFromProject(projectId: string, refId: string): Promise<void> {
    const projects = await this.loadProjects()
    const project = projects.projects[projectId]
    
    if (!project) {
      throw new Error(`Project ${projectId} not found`)
    }
    
    project.refs = project.refs.filter(r => r !== refId)
    project.modified = new Date()
    await this.saveProjects(projects)
    
    // Update ref metadata to remove this project
    await this.updateRefProject(refId, projectId, 'remove')
  }

  // Load reference metadata
  async loadRefMetadata(refId: string): Promise<RefMetadata | null> {
    try {
      const refPath = `refs/${refId}/${REF_METADATA_FILE}`
      const content = await window.intentAPI.readFile(refPath)
      const metadata = JSON.parse(content) as RefMetadata
      
      // Convert dates
      metadata.reference.created = new Date(metadata.reference.created)
      metadata.reference.modified = new Date(metadata.reference.modified)
      
      return metadata
    } catch (error) {
      return null
    }
  }

  // Save reference metadata
  async saveRefMetadata(refId: string, metadata: RefMetadata): Promise<void> {
    const refPath = `refs/${refId}/${REF_METADATA_FILE}`
    await window.intentAPI.writeFile(refPath, JSON.stringify(metadata, null, 2))
  }

  // Create reference metadata
  async createRefMetadata(
    refId: string,
    name: string,
    type: ReferenceType = 'reference',
    subtype: ReferenceSubtype = 'document',
    description?: string
  ): Promise<Reference> {
    const reference: Reference = {
      id: refId,
      name,
      description,
      type,
      subtype,
      projects: [],
      created: new Date(),
      modified: new Date()
    }
    
    const metadata: RefMetadata = {
      version: '1.0',
      reference
    }
    
    await this.saveRefMetadata(refId, metadata)
    
    // Initialize Git repository for this reference
    try {
      const result = await window.intentAPI.initGit(`refs/${refId}`)
      if (result.success) {
        console.log(`Git repository initialized for ${type} ${refId}`)
      } else {
        console.warn(`Failed to initialize Git for ${refId}:`, result.error)
      }
    } catch (error) {
      console.error(`Error initializing Git for ${refId}:`, error)
    }
    
    return reference
  }

  // Update reference project associations
  private async updateRefProject(refId: string, projectId: string, action: 'add' | 'remove'): Promise<void> {
    let metadata = await this.loadRefMetadata(refId)
    
    if (!metadata) {
      // Create metadata if it doesn't exist
      metadata = {
        version: '1.0',
        reference: await this.createRefMetadata(refId, refId, 'reference', 'document')
      }
    }
    
    if (action === 'add' && !metadata.reference.projects.includes(projectId)) {
      metadata.reference.projects.push(projectId)
    } else if (action === 'remove') {
      metadata.reference.projects = metadata.reference.projects.filter(p => p !== projectId)
    }
    
    metadata.reference.modified = new Date()
    await this.saveRefMetadata(refId, metadata)
  }

  // Get all references for a project
  async getProjectRefs(projectId: string): Promise<Reference[]> {
    const projects = await this.loadProjects()
    const project = projects.projects[projectId]
    
    if (!project) {
      throw new Error(`Project ${projectId} not found`)
    }
    
    const refs: Reference[] = []
    
    for (const refId of project.refs) {
      const metadata = await this.loadRefMetadata(refId)
      if (metadata) {
        refs.push(metadata.reference)
      }
    }
    
    return refs
  }

  // Get all projects
  async getAllProjects(): Promise<Project[]> {
    const metadata = await this.loadProjects()
    return Object.values(metadata.projects)
  }

  // Get all references (both assigned and unassigned)
  async getAllReferences(): Promise<Reference[]> {
    const refs: Reference[] = []
    
    try {
      // Get all reference directories
      const refDirs = await window.intentAPI.listFiles('refs')
      
      for (const refDir of refDirs) {
        if (refDir.type === 'directory') {
          const metadata = await this.loadRefMetadata(refDir.name)
          if (metadata) {
            refs.push(metadata.reference)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load references:', error)
    }
    
    return refs
  }

  // Get unassigned references (not in any project)
  async getUnassignedReferences(): Promise<Reference[]> {
    const [allRefs, projects] = await Promise.all([
      this.getAllReferences(),
      this.getAllProjects()
    ])
    
    // Get all reference IDs that are assigned to projects
    const assignedRefIds = new Set<string>()
    projects.forEach(project => {
      project.refs.forEach(refId => assignedRefIds.add(refId))
    })
    
    // Filter out assigned references
    return allRefs.filter(ref => !assignedRefIds.has(ref.id))
  }

  // Update project
  async updateProject(projectId: string, updates: { name?: string; description?: string; emoji?: string }): Promise<void> {
    const projects = await this.loadProjects()
    const project = projects.projects[projectId]
    
    if (!project) {
      throw new Error(`Project ${projectId} not found`)
    }
    
    if (updates.name !== undefined) {
      project.name = updates.name
    }
    if (updates.description !== undefined) {
      project.description = updates.description
    }
    if (updates.emoji !== undefined) {
      project.emoji = updates.emoji
    }
    
    project.modified = new Date()
    await this.saveProjects(projects)
  }

  // Update reference
  async updateReference(refId: string, updates: { 
    name?: string; 
    description?: string;
    type?: ReferenceType;
    subtype?: ReferenceSubtype;
    readReferences?: string[];
  }): Promise<void> {
    const metadata = await this.loadRefMetadata(refId)
    
    if (!metadata) {
      throw new Error(`Reference ${refId} not found`)
    }
    
    if (updates.name !== undefined) {
      metadata.reference.name = updates.name
    }
    if (updates.description !== undefined) {
      metadata.reference.description = updates.description
    }
    if (updates.type !== undefined) {
      metadata.reference.type = updates.type
    }
    if (updates.subtype !== undefined) {
      metadata.reference.subtype = updates.subtype
    }
    if (updates.readReferences !== undefined) {
      metadata.reference.readReferences = updates.readReferences
    }
    
    metadata.reference.modified = new Date()
    await this.saveRefMetadata(refId, metadata)
  }

  // Delete project
  async deleteProject(projectId: string): Promise<void> {
    const projects = await this.loadProjects()
    
    if (!projects.projects[projectId]) {
      throw new Error(`Project ${projectId} not found`)
    }
    
    // Delete all references assigned to this project
    const project = projects.projects[projectId]
    for (const refId of project.refs) {
      try {
        // Delete the reference directory
        const refPath = `refs/${refId}`
        await window.intentAPI.deleteFile(refPath)
      } catch (error) {
        console.error(`Failed to delete reference ${refId}:`, error)
      }
    }
    
    // Delete the project
    delete projects.projects[projectId]
    await this.saveProjects(projects)
  }

  // Delete reference
  async deleteReference(refId: string): Promise<void> {
    const metadata = await this.loadRefMetadata(refId)
    
    if (!metadata) {
      throw new Error(`Reference ${refId} not found`)
    }
    
    // Remove reference from all projects
    for (const projectId of metadata.reference.projects) {
      await this.removeRefFromProject(projectId, refId)
    }
    
    // Delete the reference directory
    const refPath = `refs/${refId}`
    await window.intentAPI.deleteFile(refPath)
  }

  // Add read reference to artifact
  async addReadReference(artifactId: string, readRefId: string): Promise<void> {
    const metadata = await this.loadRefMetadata(artifactId)
    
    if (!metadata) {
      throw new Error(`Artifact ${artifactId} not found`)
    }
    
    if (metadata.reference.type !== 'artifact') {
      throw new Error(`Reference ${artifactId} is not an artifact`)
    }
    
    // Prevent self-reference
    if (artifactId === readRefId) {
      throw new Error('An artifact cannot read from itself')
    }
    
    // Initialize readReferences if not exists
    if (!metadata.reference.readReferences) {
      metadata.reference.readReferences = []
    }
    
    // Add if not already present
    if (!metadata.reference.readReferences.includes(readRefId)) {
      metadata.reference.readReferences.push(readRefId)
      metadata.reference.modified = new Date()
      await this.saveRefMetadata(artifactId, metadata)
    }
  }

  // Remove read reference from artifact
  async removeReadReference(artifactId: string, readRefId: string): Promise<void> {
    const metadata = await this.loadRefMetadata(artifactId)
    
    if (!metadata) {
      throw new Error(`Artifact ${artifactId} not found`)
    }
    
    if (metadata.reference.type !== 'artifact') {
      throw new Error(`Reference ${artifactId} is not an artifact`)
    }
    
    if (metadata.reference.readReferences) {
      metadata.reference.readReferences = metadata.reference.readReferences.filter(id => id !== readRefId)
      metadata.reference.modified = new Date()
      await this.saveRefMetadata(artifactId, metadata)
    }
  }

  // Get all read references for an artifact
  async getReadReferences(artifactId: string): Promise<Reference[]> {
    const metadata = await this.loadRefMetadata(artifactId)
    
    if (!metadata || metadata.reference.type !== 'artifact') {
      return []
    }
    
    const readRefs: Reference[] = []
    
    if (metadata.reference.readReferences) {
      for (const refId of metadata.reference.readReferences) {
        const refMetadata = await this.loadRefMetadata(refId)
        if (refMetadata) {
          readRefs.push(refMetadata.reference)
        }
      }
    }
    
    return readRefs
  }

  // Helper to generate ID from name
  private generateId(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }
}

// Singleton instance
export const projectManager = new ProjectManager()