import { useState, useEffect } from 'react'
import { ProjectFileTree } from './ProjectFileTree'
import { FileViewer } from './FileViewer'
import { BackgroundContextMenu } from './BackgroundContextMenu'
import { CodeArtifactView } from '../artifact-views/CodeArtifactView'
import { CreateArtifactDialog } from '../dialogs/CreateArtifactDialog'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '../ui/resizable'
import { ScrollArea } from '../ui/scroll-area'
import { projectManager } from '@/lib/projectManager'
import { Project } from '@/types/projects'
import { useDialogKeyboard } from '@/hooks/useDialogKeyboard'
import { toast } from 'sonner'
import { KeyboardHint } from '../ui/keyboard-hint'
import { EmojiPicker } from '../ui/emoji-picker'
import { Button } from '../ui/button'
import { Plus, FolderPlus, Briefcase } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

export function SimplifiedProjectBrowser() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [artifactView, setArtifactView] = useState<{refId: string, type: string, name: string} | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectForRef, setSelectedProjectForRef] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Dialog states
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [projectEmoji, setProjectEmoji] = useState('📁')
  const [createReferenceOpen, setCreateReferenceOpen] = useState(false)
  const [referenceName, setReferenceName] = useState('')
  const [referenceType, setReferenceType] = useState<'reference' | 'artifact'>('reference')
  const [referenceSubtype, setReferenceSubtype] = useState<string>('document')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createArtifactOpen, setCreateArtifactOpen] = useState(false)
  const [selectedProjectIdForArtifact, setSelectedProjectIdForArtifact] = useState('')

  useEffect(() => {
    loadProjects()
  }, [refreshKey])

  const loadProjects = async () => {
    setLoading(true)
    try {
      const allProjects = await projectManager.getAllProjects()
      setProjects(allProjects)
      
      // Initialize default project if none exist
      if (allProjects.length === 0) {
        await initializeDefaultProject()
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const initializeDefaultProject = async () => {
    const defaultProject = await projectManager.createProject('Default Project', 'Auto-generated project for existing references')
    
    const existingRefs = await window.intentAPI.scanRefs()
    for (const ref of existingRefs) {
      await projectManager.addRefToProject(defaultProject.id, ref.id)
      
      const metadataExists = await window.intentAPI.checkMetadataExists(`refs/${ref.id}/.intent-ref.json`)
      if (!metadataExists) {
        await projectManager.createRefMetadata(ref.id, ref.name, 'reference', 'document')
      }
    }
    
    const allProjects = await projectManager.getAllProjects()
    setProjects(allProjects)
  }

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  const handleCreateProject = async () => {
    if (!projectName.trim()) return
    
    setCreating(true)
    try {
      const project = await projectManager.createProject(projectName.trim(), projectDescription.trim() || undefined, projectEmoji)
      
      // Create default references for the new project
      const defaultReferences = [
        { name: 'Project Overview', id: 'project-overview' },
        { name: 'Branding Guidelines', id: 'branding-guidelines' },
        { name: 'Image Guidelines', id: 'image-guidelines' }
      ]
      
      for (const ref of defaultReferences) {
        const refId = `${project.id}-${ref.id}`
        const refPath = `refs/${refId}`
        
        // Create reference directory
        await window.intentAPI.createDirectory(refPath)
        
        // Create reference metadata
        await projectManager.createRefMetadata(refId, ref.name, 'reference', 'document')
        
        // Create default .md file
        const docPath = `${refPath}/${refId}.md`
        let defaultContent = `# ${ref.name}\n\n`
        
        // Add specific template content based on reference type
        switch (ref.id) {
          case 'project-overview':
            defaultContent += `## Project Description\n${projectDescription.trim() || 'Add your project description here...'}\n\n## Goals\n- \n\n## Key Features\n- \n\n## Timeline\n- `
            break
          case 'branding-guidelines':
            defaultContent += `## Brand Identity\n\n### Logo\n*Add logo files to this reference*\n\n### Colors\n- Primary: \n- Secondary: \n\n### Typography\n- Headers: \n- Body: \n\n### Voice & Tone\n`
            break
          case 'image-guidelines':
            defaultContent += `## Image Standards\n\n### Formats\n- Web: PNG, WebP\n- Print: \n\n### Dimensions\n- Hero images: \n- Thumbnails: \n\n### Style Guidelines\n- \n\n### Examples\n*Add example images to this reference*`
            break
        }
        
        await window.intentAPI.createFile(docPath, defaultContent)
        
        // Add reference to project
        await projectManager.addRefToProject(project.id, refId)
      }
      
      setCreateProjectOpen(false)
      setProjectName('')
      setProjectDescription('')
      setProjectEmoji('📁')
      handleRefresh()
    } catch (error) {
      console.error('Failed to create project:', error)
    } finally {
      setCreating(false)
    }
  }

  // Keyboard shortcuts for create project dialog
  useDialogKeyboard({
    isOpen: createProjectOpen,
    onSubmit: handleCreateProject,
    onCancel: () => setCreateProjectOpen(false),
    isSubmitDisabled: !projectName.trim() || creating
  })

  const handleCreateReference = async () => {
    if (!referenceName.trim()) return
    
    setCreating(true)
    try {
      const refId = referenceName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
      const refPath = `refs/${refId}`
      
      await window.intentAPI.createDirectory(refPath)
      await projectManager.createRefMetadata(refId, referenceName.trim(), referenceType as any, referenceSubtype as any)
      
      // Create default .md file for document references
      if (referenceType === 'reference' && referenceSubtype === 'document') {
        const docPath = `${refPath}/${refId}.md`
        const defaultContent = `# ${referenceName.trim()}\n\n`
        await window.intentAPI.createFile(docPath, defaultContent)
      }
      
      const targetProjectId = selectedProjectForRef || selectedProjectId
      if (targetProjectId) {
        await projectManager.addRefToProject(targetProjectId, refId)
      }
      
      setCreateReferenceOpen(false)
      setReferenceName('')
      setReferenceType('reference')
      setReferenceSubtype('document')
      setSelectedProjectId('')
      setSelectedProjectForRef(null)
      handleRefresh()
    } catch (error) {
      console.error('Failed to create reference:', error)
    } finally {
      setCreating(false)
    }
  }

  // Keyboard shortcuts for create reference dialog
  useDialogKeyboard({
    isOpen: createReferenceOpen,
    onSubmit: handleCreateReference,
    onCancel: () => setCreateReferenceOpen(false),
    isSubmitDisabled: !referenceName.trim() || !selectedProjectId || creating || projects.length === 0
  })

  const handleMoveReference = async (refId: string, targetProjectId: string) => {
    const currentProject = projects.find(p => p.refs.includes(refId))
    
    if (currentProject) {
      await projectManager.removeRefFromProject(currentProject.id, refId)
    }
    
    await projectManager.addRefToProject(targetProjectId, refId)
  }

  const handleOpenArtifactView = async (refId: string, artifactType: string) => {
    // Get reference name
    const metadata = await projectManager.loadRefMetadata(refId)
    const refName = metadata?.reference.name || refId
    
    setArtifactView({ refId, type: artifactType, name: refName })
    setSelectedFile(null) // Clear file selection when opening artifact view
  }

  const handleSelectFile = (filePath: string) => {
    setSelectedFile(filePath)
    setArtifactView(null) // Clear artifact view when selecting a file
  }

  const openCreateArtifact = (projectId?: string) => {
    setSelectedProjectIdForArtifact(projectId || '')
    setCreateArtifactOpen(true)
  }

  const handleCreateArtifact = async (
    name: string,
    description: string,
    subtype: string,
    readReferences: string[]
  ) => {
    const refId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const refPath = `refs/${refId}`
    
    await window.intentAPI.createDirectory(refPath)
    
    // If it's a code artifact, run create-next-app BEFORE creating metadata
    if (subtype === 'code') {
      console.log(`Creating Next.js app for artifact ${refId}...`)
      const result = await window.intentAPI.createNextApp(refPath)
      if (!result.success) {
        console.error(`Failed to create Next.js app: ${result.error}`)
        // Still continue to create the artifact metadata
      } else {
        console.log(`Next.js app created successfully for ${refId}`)
      }
    }
    
    // Now create metadata after create-next-app
    await projectManager.createRefMetadata(
      refId,
      name,
      'artifact',
      subtype as any,
      description
    )
    
    // Add read references
    for (const readRefId of readReferences) {
      await projectManager.addReadReference(refId, readRefId)
    }
    
    // Add to project if provided
    if (selectedProjectIdForArtifact) {
      await projectManager.addRefToProject(selectedProjectIdForArtifact, refId)
    }
    
    // If it's a code artifact, we're done (no default file needed)
    if (subtype === 'code') {
      handleRefresh()
      return
    }
    
    // Create default file based on subtype
    let defaultContent = ''
    let fileName = ''
    
    switch (subtype) {
      case 'code':
        fileName = `${refId}.ts`
        defaultContent = `// ${name}\n// ${description || 'Code artifact'}\n\nexport {}`
        break
      case 'text':
        fileName = `${refId}.txt`
        defaultContent = `${name}\n${'='.repeat(name.length)}\n\n${description || ''}`
        break
      case 'media-artifact':
        fileName = `${refId}.md`
        defaultContent = `# ${name}\n\n${description || 'Media artifact'}\n\n<!-- Add your media files to this folder -->`
        break
    }
    
    if (fileName) {
      const filePath = `${refPath}/${fileName}`
      await window.intentAPI.createFile(filePath, defaultContent)
    }
    
    handleRefresh()
  }

  const handleCloseFile = () => {
    setSelectedFile(null)
  }

  return (
    <>
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={15} minSize={15} maxSize={50}>
          <div className="h-full flex flex-col overflow-hidden">
            {/* Header with add button */}
            <div className="border-b p-2 flex items-center justify-between flex-shrink-0">
              <h2 className="text-sm font-medium">Projects</h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Plus className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setCreateProjectOpen(true)}>
                    <Briefcase className="h-4 w-4 mr-2" />
                    New Project
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCreateReferenceOpen(true)}>
                    <FolderPlus className="h-4 w-4 mr-2" />
                    New Reference
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
            {/* File tree */}
            <BackgroundContextMenu
              onCreateProject={() => setCreateProjectOpen(true)}
              onCreateReference={() => {
                setSelectedProjectForRef(null)
                setCreateReferenceOpen(true)
              }}
              onRefresh={handleRefresh}
            >
              <ScrollArea className="flex-1 overflow-y-auto">
                <ProjectFileTree
                  key={refreshKey}
                  projects={projects}
                  onSelectFile={handleSelectFile}
                  selectedFile={selectedFile}
                  selectedArtifact={artifactView?.refId}
                  showProjects={true}
                  loading={loading}
                  onRefresh={handleRefresh}
                  onCreateReference={(projectId?: string) => {
                    setSelectedProjectForRef(projectId || null)
                    if (projectId) {
                      setSelectedProjectId(projectId)
                    }
                    setCreateReferenceOpen(true)
                  }}
                  onCreateArtifact={openCreateArtifact}
                  onMoveReference={handleMoveReference}
                  onOpenArtifactView={handleOpenArtifactView}
                />
              </ScrollArea>
            </BackgroundContextMenu>
          </div>
        </ResizablePanel>
        
        <ResizableHandle />
        
        <ResizablePanel defaultSize={70}>
          {artifactView ? (
            <div className="h-full">
              {artifactView.type === 'code' ? (
                <CodeArtifactView
                  refId={artifactView.refId}
                  refName={artifactView.name}
                  onClose={() => setArtifactView(null)}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <p className="text-lg mb-2">Artifact view for "{artifactView.name}"</p>
                    <p className="text-sm">View for {artifactView.type} artifacts coming soon</p>
                    <button 
                      onClick={() => setArtifactView(null)}
                      className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : selectedFile ? (
            <FileViewer 
              filePath={selectedFile}
              onClose={handleCloseFile}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Select a file to view its contents or click an artifact to open its specialized view
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Create Project Dialog */}
      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Projects help you organize related references and resources.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="flex gap-3">
              <div>
                <Label>Icon</Label>
                <div className="mt-2">
                  <EmojiPicker value={projectEmoji} onChange={setProjectEmoji} />
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  placeholder="My Awesome Project"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleCreateProject()
                    }
                  }}
                  autoFocus
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="project-description">Description (optional)</Label>
              <Textarea
                id="project-description"
                placeholder="Describe what this project is about..."
                rows={3}
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
              />
            </div>
          </div>
          
          <DialogFooter className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyboardHint keys={['⌘', 'Enter']} /> to submit • <KeyboardHint keys={['Esc']} /> to cancel
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateProjectOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateProject}
                disabled={!projectName.trim() || creating}
              >
                {creating ? 'Creating...' : 'Create Project'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Reference Dialog */}
      <Dialog open={createReferenceOpen} onOpenChange={setCreateReferenceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Reference</DialogTitle>
            <DialogDescription>
              Create a new reference to organize your code, documentation, or other resources.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reference-name">Reference Name</Label>
              <Input
                id="reference-name"
                placeholder="my-reference"
                value={referenceName}
                onChange={(e) => setReferenceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleCreateReference()
                  }
                }}
                autoFocus
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reference-type">Type</Label>
              <Select 
                value={referenceType} 
                onValueChange={(value) => {
                  setReferenceType(value as 'reference' | 'artifact')
                  // Reset subtype when type changes
                  setReferenceSubtype(value === 'reference' ? 'document' : 'code')
                }}
              >
                <SelectTrigger id="reference-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference">Reference</SelectItem>
                  <SelectItem value="artifact">Artifact</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reference-subtype">Subtype</Label>
              <Select value={referenceSubtype} onValueChange={setReferenceSubtype}>
                <SelectTrigger id="reference-subtype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {referenceType === 'reference' ? (
                    <>
                      <SelectItem value="document">Document</SelectItem>
                      <SelectItem value="media">Media</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="code">Code</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="media-artifact">Media</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reference-project">Project *</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger id="reference-project">
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projects.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No projects found. Create a project first.
                </p>
              )}
            </div>
          </div>
          
          <DialogFooter className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyboardHint keys={['⌘', 'Enter']} /> to submit • <KeyboardHint keys={['Esc']} /> to cancel
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateReferenceOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateReference}
                disabled={!referenceName.trim() || !selectedProjectId || creating || projects.length === 0}
              >
                {creating ? 'Creating...' : 'Create Reference'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Artifact Dialog */}
      <CreateArtifactDialog
        open={createArtifactOpen}
        onOpenChange={setCreateArtifactOpen}
        projectId={selectedProjectIdForArtifact}
        onCreateArtifact={handleCreateArtifact}
      />
    </>
  )
}