import { useState, useEffect } from 'react'
import { ProjectFileTree } from './ProjectFileTree'
import { FileViewer } from './FileViewer'
import { BackgroundContextMenu } from './BackgroundContextMenu'
import { CodeArtifactView } from '../artifact-views/CodeArtifactView'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '../ui/resizable'
import { ScrollArea } from '../ui/scroll-area'
import { projectManager } from '@/lib/projectManager'
import { Project } from '@/types/projects'
import { useDialogKeyboard } from '@/hooks/useDialogKeyboard'
import { KeyboardHint } from '../ui/keyboard-hint'
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
  const [createReferenceOpen, setCreateReferenceOpen] = useState(false)
  const [referenceName, setReferenceName] = useState('')
  const [referenceType, setReferenceType] = useState<'reference' | 'artifact'>('reference')
  const [referenceSubtype, setReferenceSubtype] = useState<string>('document')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [creating, setCreating] = useState(false)

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
      await projectManager.createProject(projectName.trim(), projectDescription.trim() || undefined)
      setCreateProjectOpen(false)
      setProjectName('')
      setProjectDescription('')
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

  const handleCloseFile = () => {
    setSelectedFile(null)
  }

  return (
    <>
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={20} minSize={20} maxSize={50}>
          <div className="h-full flex flex-col">
            {/* Header with add button */}
            <div className="border-b p-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Files</h2>
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
              <ScrollArea className="flex-1">
                <ProjectFileTree
                  key={refreshKey}
                  projects={projects}
                  onSelectFile={handleSelectFile}
                  selectedFile={selectedFile}
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
            <div className="space-y-2">
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
    </>
  )
}