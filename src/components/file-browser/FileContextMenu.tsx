import { useState } from 'react'
import { 
  ContextMenu, 
  ContextMenuContent, 
  ContextMenuItem, 
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '../ui/context-menu'
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
import { Button } from '../ui/button'
import { 
  File, 
  FolderPlus, 
  FilePlus, 
  Edit, 
  Trash2, 
  Copy, 
  Scissors,
  RefreshCcw,
  Bookmark,
  Briefcase
} from 'lucide-react'
import { ProjectFileNode } from '@/types/projects'
import { projectManager } from '@/lib/projectManager'
import { toast } from 'sonner'

interface FileContextMenuProps {
  node: ProjectFileNode
  children: React.ReactNode
  onRefresh: () => void
  onOpenFile?: (path: string) => void
  onCreateReference?: () => void
  projects?: Array<{ id: string; name: string }>
}

export function FileContextMenu({ 
  node, 
  children, 
  onRefresh,
  onOpenFile,
  onCreateReference,
  projects = []
}: FileContextMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState(node.name)
  const [createFileOpen, setCreateFileOpen] = useState(false)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [folderName, setFolderName] = useState('')
  const [addToProjectOpen, setAddToProjectOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState('')

  const handleRename = async () => {
    if (!newName.trim() || newName === node.name) {
      setRenameOpen(false)
      return
    }

    try {
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/'))
      const newPath = parentPath ? `${parentPath}/${newName}` : newName
      
      await window.intentAPI.renameFile(node.path, newPath)
      toast.success('Renamed successfully')
      setRenameOpen(false)
      onRefresh()
    } catch (error) {
      console.error('Failed to rename:', error)
      toast.error('Failed to rename')
    }
  }

  const handleDelete = async () => {
    const confirmed = window.confirm(`Are you sure you want to delete "${node.name}"?`)
    if (!confirmed) return

    try {
      await window.intentAPI.deleteFile(node.path)
      toast.success('Deleted successfully')
      onRefresh()
    } catch (error) {
      console.error('Failed to delete:', error)
      toast.error('Failed to delete')
    }
  }

  const handleCreateFile = async () => {
    if (!fileName.trim()) return

    try {
      const filePath = `${node.path}/${fileName}`
      await window.intentAPI.createFile(filePath, '')
      toast.success('File created successfully')
      setCreateFileOpen(false)
      setFileName('')
      onRefresh()
      
      // Open the new file
      if (onOpenFile) {
        onOpenFile(filePath)
      }
    } catch (error) {
      console.error('Failed to create file:', error)
      toast.error('Failed to create file')
    }
  }

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return

    try {
      const folderPath = `${node.path}/${folderName}`
      await window.intentAPI.createDirectory(folderPath)
      toast.success('Folder created successfully')
      setCreateFolderOpen(false)
      setFolderName('')
      onRefresh()
    } catch (error) {
      console.error('Failed to create folder:', error)
      toast.error('Failed to create folder')
    }
  }

  const handleAddToProject = async () => {
    if (!selectedProjectId || !node.refId) return

    try {
      await projectManager.addRefToProject(selectedProjectId, node.refId)
      toast.success('Added to project successfully')
      setAddToProjectOpen(false)
      onRefresh()
    } catch (error) {
      console.error('Failed to add to project:', error)
      toast.error('Failed to add to project')
    }
  }

  const handleRemoveFromProject = async () => {
    if (!node.projectId || !node.refId) return

    try {
      await projectManager.removeRefFromProject(node.projectId, node.refId)
      toast.success('Removed from project successfully')
      onRefresh()
    } catch (error) {
      console.error('Failed to remove from project:', error)
      toast.error('Failed to remove from project')
    }
  }

  const isProject = node.nodeType === 'project'
  const isReference = node.nodeType === 'reference'
  const isReferencesFolder = node.name === 'References'
  
  const canCreateItems = node.type === 'directory' && 
    (isReference || (!node.nodeType && !node.path.startsWith('project:')))

  const canRename = !isProject && !isReference && !isReferencesFolder

  const canDelete = canRename && !isProject && !isReferencesFolder

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {node.type === 'file' && (
            <>
              <ContextMenuItem onClick={() => onOpenFile?.(node.path)}>
                <File className="mr-2 h-4 w-4" />
                Open
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          
          {isProject && onCreateReference && (
            <>
              <ContextMenuItem onClick={onCreateReference}>
                <Bookmark className="mr-2 h-4 w-4" />
                New Reference
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          
          {canCreateItems && (
            <>
              <ContextMenuItem onClick={() => setCreateFileOpen(true)}>
                <FilePlus className="mr-2 h-4 w-4" />
                New File
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setCreateFolderOpen(true)}>
                <FolderPlus className="mr-2 h-4 w-4" />
                New Folder
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}

          {isReference && !node.projectId && projects.length > 0 && (
            <>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Briefcase className="mr-2 h-4 w-4" />
                  Add to Project
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {projects.map(project => (
                    <ContextMenuItem 
                      key={project.id}
                      onClick={() => {
                        setSelectedProjectId(project.id)
                        setAddToProjectOpen(true)
                      }}
                    >
                      {project.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
            </>
          )}

          {canRename && (
            <ContextMenuItem onClick={() => setRenameOpen(true)}>
              <Edit className="mr-2 h-4 w-4" />
              Rename
            </ContextMenuItem>
          )}
          
          <ContextMenuItem onClick={onRefresh}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </ContextMenuItem>
          
          {canDelete && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem 
                onClick={handleDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {node.type === 'file' ? 'File' : 'Folder'}</DialogTitle>
            <DialogDescription>
              Enter a new name for "{node.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-name">New Name</Label>
            <Input
              id="new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleRename()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!newName.trim() || newName === node.name}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create File Dialog */}
      <Dialog open={createFileOpen} onOpenChange={setCreateFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New File</DialogTitle>
            <DialogDescription>
              Create a new file in "{node.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="file-name">File Name</Label>
            <Input
              id="file-name"
              placeholder="example.md"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreateFile()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFileOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFile} disabled={!fileName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Create a new folder in "{node.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              placeholder="new-folder"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreateFolder()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={!folderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to Project Confirmation */}
      <Dialog open={addToProjectOpen} onOpenChange={setAddToProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Project</DialogTitle>
            <DialogDescription>
              Add this reference to the selected project?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToProjectOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddToProject}>
              Add to Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}