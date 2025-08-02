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
import { Textarea } from '../ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
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
  Briefcase,
  BookOpen
} from 'lucide-react'
import { ProjectFileNode } from '@/types/projects'
import { projectManager } from '@/lib/projectManager'
import { toast } from 'sonner'
import { useDialogKeyboard } from '@/hooks/useDialogKeyboard'
import { KeyboardHint } from '../ui/keyboard-hint'
import { EmojiPicker } from '../ui/emoji-picker'
import { ManageReadReferencesDialog } from '../dialogs/ManageReadReferencesDialog'

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
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState(node.name)
  const [editDescription, setEditDescription] = useState(node.metadata?.description || '')
  const [editEmoji, setEditEmoji] = useState(node.metadata?.emoji || '📁')
  const [editType, setEditType] = useState<'reference' | 'artifact'>(node.metadata?.refType || 'reference')
  const [editSubtype, setEditSubtype] = useState(node.metadata?.refSubtype || 'document')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [manageReadRefsOpen, setManageReadRefsOpen] = useState(false)

  const isProject = node.nodeType === 'project'
  const isReference = node.nodeType === 'reference'
  const isArtifact = isReference && node.metadata?.refType === 'artifact'
  const isReferencesFolder = node.name === 'References'
  const isArtifactsFolder = node.name === 'Artifacts'

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

  const handleEdit = async () => {
    if (!editName.trim()) return

    try {
      if (isProject && node.projectId) {
        // Update project
        await projectManager.updateProject(node.projectId, {
          name: editName,
          description: editDescription,
          emoji: editEmoji
        })
        toast.success('Project updated successfully')
      } else if (isReference && node.refId) {
        // Update reference
        await projectManager.updateReference(node.refId, {
          name: editName,
          description: editDescription,
          type: editType,
          subtype: editSubtype as any
        })
        toast.success('Reference updated successfully')
      }
      setEditOpen(false)
      onRefresh()
    } catch (error) {
      console.error('Failed to update:', error)
      toast.error('Failed to update')
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

  const handleDeleteProject = async () => {
    if (!node.projectId) return

    try {
      await projectManager.deleteProject(node.projectId)
      toast.success('Project deleted successfully')
      setDeleteConfirmOpen(false)
      onRefresh()
    } catch (error) {
      console.error('Failed to delete project:', error)
      toast.error('Failed to delete project')
    }
  }

  const handleDeleteReference = async () => {
    if (!node.refId) return

    try {
      await projectManager.deleteReference(node.refId)
      toast.success('Reference deleted successfully')
      setDeleteConfirmOpen(false)
      onRefresh()
    } catch (error) {
      console.error('Failed to delete reference:', error)
      toast.error('Failed to delete reference')
    }
  }

  const canCreateItems = node.type === 'directory' && 
    (isReference || (!node.nodeType && !node.path.startsWith('project:')))

  const canRename = !isProject && !isReference && !isReferencesFolder && !isArtifactsFolder

  const canDelete = canRename && !isProject && !isReferencesFolder && !isArtifactsFolder

  // Keyboard shortcuts for dialogs
  useDialogKeyboard({
    isOpen: renameOpen,
    onSubmit: handleRename,
    onCancel: () => setRenameOpen(false),
    isSubmitDisabled: !newName.trim() || newName === node.name
  })

  useDialogKeyboard({
    isOpen: editOpen,
    onSubmit: handleEdit,
    onCancel: () => setEditOpen(false),
    isSubmitDisabled: !editName.trim()
  })

  useDialogKeyboard({
    isOpen: createFileOpen,
    onSubmit: handleCreateFile,
    onCancel: () => setCreateFileOpen(false),
    isSubmitDisabled: !fileName.trim()
  })

  useDialogKeyboard({
    isOpen: createFolderOpen,
    onSubmit: handleCreateFolder,
    onCancel: () => setCreateFolderOpen(false),
    isSubmitDisabled: !folderName.trim()
  })

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
          
          {isProject && (
            <>
              {onCreateReference && (
                <ContextMenuItem onClick={onCreateReference}>
                  <Bookmark className="mr-2 h-4 w-4" />
                  New Reference
                </ContextMenuItem>
              )}
              <ContextMenuItem onClick={() => {
                setEditName(node.name)
                setEditDescription(node.metadata?.description || '')
                setEditEmoji(node.metadata?.emoji || '📁')
                setEditOpen(true)
              }}>
                <Edit className="mr-2 h-4 w-4" />
                Edit Project
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem 
                onClick={() => setDeleteConfirmOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Project
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}

          {isReferencesFolder && onCreateReference && (
            <>
              <ContextMenuItem onClick={onCreateReference}>
                <Bookmark className="mr-2 h-4 w-4" />
                New Reference
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}

          {isReference && (
            <>
              <ContextMenuItem onClick={() => {
                setEditName(node.name)
                setEditDescription(node.metadata?.description || '')
                setEditType(node.metadata?.refType || 'reference')
                setEditSubtype(node.metadata?.refSubtype || 'document')
                setEditOpen(true)
              }}>
                <Edit className="mr-2 h-4 w-4" />
                Edit Reference
              </ContextMenuItem>
              {isArtifact && (
                <>
                  <ContextMenuItem onClick={() => setManageReadRefsOpen(true)}>
                    <BookOpen className="mr-2 h-4 w-4" />
                    Manage Context
                  </ContextMenuItem>
                </>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem 
                onClick={() => setDeleteConfirmOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Reference
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
          <DialogFooter className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyboardHint keys={['⌘', 'Enter']} /> to submit • <KeyboardHint keys={['Esc']} /> to cancel
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleRename} disabled={!newName.trim() || newName === node.name}>
                Rename
              </Button>
            </div>
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
          <DialogFooter className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyboardHint keys={['⌘', 'Enter']} /> to submit • <KeyboardHint keys={['Esc']} /> to cancel
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreateFileOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateFile} disabled={!fileName.trim()}>
                Create
              </Button>
            </div>
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
          <DialogFooter className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyboardHint keys={['⌘', 'Enter']} /> to submit • <KeyboardHint keys={['Esc']} /> to cancel
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateFolder} disabled={!folderName.trim()}>
                Create
              </Button>
            </div>
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

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {isProject ? 'Project' : 'Reference'}</DialogTitle>
            <DialogDescription>
              Update the details for this {isProject ? 'project' : 'reference'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isProject ? (
              <div className="flex gap-3">
                <div>
                  <Label>Icon</Label>
                  <div className="mt-2">
                    <EmojiPicker value={editEmoji} onChange={setEditEmoji} />
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Project name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleEdit()
                      }
                    }}
                    autoFocus
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Reference name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleEdit()
                    }
                  }}
                  autoFocus
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Add a description..."
                rows={3}
              />
            </div>
            
            {isReference && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-type">Type</Label>
                  <Select 
                    value={editType} 
                    onValueChange={(value) => {
                      setEditType(value as 'reference' | 'artifact')
                      // Reset subtype when type changes
                      setEditSubtype(value === 'reference' ? 'document' : 'code')
                    }}
                  >
                    <SelectTrigger id="edit-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reference">Reference</SelectItem>
                      <SelectItem value="artifact">Artifact</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-subtype">Subtype</Label>
                  <Select value={editSubtype} onValueChange={setEditSubtype}>
                    <SelectTrigger id="edit-subtype">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editType === 'reference' ? (
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
              </>
            )}
          </div>
          <DialogFooter className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyboardHint keys={['⌘', 'Enter']} /> to submit • <KeyboardHint keys={['Esc']} /> to cancel
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEdit} disabled={!editName.trim()}>
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {isProject ? 'Project' : 'Reference'}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{node.name}"? This action cannot be undone.
              {isProject && (
                <p className="mt-2 text-sm text-destructive">
                  Warning: This will permanently delete the project and all its assigned references.
                </p>
              )}
              {isReference && (
                <p className="mt-2 text-sm">
                  Warning: This will permanently delete all files in this reference.
                </p>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={isProject ? handleDeleteProject : handleDeleteReference}
            >
              Delete {isProject ? 'Project' : 'Reference'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Read References Dialog */}
      {isArtifact && node.refId && (
        <ManageReadReferencesDialog
          open={manageReadRefsOpen}
          onOpenChange={setManageReadRefsOpen}
          artifactId={node.refId}
          artifactName={node.name}
          projectId={node.projectId}
        />
      )}
    </>
  )
}