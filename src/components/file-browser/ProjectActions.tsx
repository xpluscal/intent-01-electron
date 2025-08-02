import { useState, forwardRef, useImperativeHandle } from 'react'
import { Button } from '../ui/button'
import { RefreshCw, Plus, FolderPlus, Search, Briefcase } from 'lucide-react'
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

interface ProjectActionsProps {
  onRefresh: () => void
  onCreateProject: (name: string, description?: string) => Promise<void>
  onCreateReference?: (name: string, type: string, subtype: string, projectId?: string) => Promise<void>
  projects?: Array<{ id: string; name: string }>
}

export interface ProjectActionsHandle {
  openCreateProject: () => void
  openCreateReference: (projectId?: string) => void
}

export const ProjectActions = forwardRef<ProjectActionsHandle, ProjectActionsProps>(
  ({ onRefresh, onCreateProject, onCreateReference, projects = [] }, ref) => {
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [createReferenceOpen, setCreateReferenceOpen] = useState(false)
  const [referenceName, setReferenceName] = useState('')
  const [referenceType, setReferenceType] = useState<'reference' | 'artifact'>('reference')
  const [referenceSubtype, setReferenceSubtype] = useState<string>('document')
  const [selectedProjectId, setSelectedProjectId] = useState('')

  useImperativeHandle(ref, () => ({
    openCreateProject: () => setCreateProjectOpen(true),
    openCreateReference: (projectId?: string) => {
      if (projectId) {
        setSelectedProjectId(projectId)
      }
      setCreateReferenceOpen(true)
    }
  }))

  const handleCreateProject = async () => {
    if (!projectName.trim()) return
    
    setCreating(true)
    try {
      await onCreateProject(projectName.trim(), projectDescription.trim() || undefined)
      setCreateProjectOpen(false)
      setProjectName('')
      setProjectDescription('')
    } catch (error) {
      console.error('Failed to create project:', error)
    } finally {
      setCreating(false)
    }
  }

  const handleCreateReference = async () => {
    if (!referenceName.trim() || !onCreateReference) return
    
    setCreating(true)
    try {
      const projectId = selectedProjectId === 'none' || !selectedProjectId ? undefined : selectedProjectId
      await onCreateReference(referenceName.trim(), referenceType, referenceSubtype, projectId)
      setCreateReferenceOpen(false)
      setReferenceName('')
      setReferenceType('reference')
      setReferenceSubtype('document')
      setSelectedProjectId('')
    } catch (error) {
      console.error('Failed to create reference:', error)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="border-b p-3 flex items-center justify-between bg-background">
        <h2 className="text-lg font-semibold">Projects & References</h2>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="New">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCreateProjectOpen(true)}>
                <Briefcase className="h-4 w-4 mr-2" />
                New Project
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCreateReferenceOpen(true)} disabled={!onCreateReference}>
                <FolderPlus className="h-4 w-4 mr-2" />
                New Reference
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button
            variant="ghost"
            size="icon"
            title="Search"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
          
          <DialogFooter>
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
            
            {projects.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="reference-project">Add to Project (optional)</Label>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger id="reference-project">
                    <SelectValue placeholder="Select a project..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {projects.map(project => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateReferenceOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateReference}
              disabled={!referenceName.trim() || creating}
            >
              {creating ? 'Creating...' : 'Create Reference'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})