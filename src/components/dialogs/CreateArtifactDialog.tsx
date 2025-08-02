import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Checkbox } from '../ui/checkbox'
import { ScrollArea } from '../ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Search, FileText, Image, Package } from 'lucide-react'
import { projectManager } from '@/lib/projectManager'
import { Reference } from '@/types/projects'
import { toast } from 'sonner'
import { useDialogKeyboard } from '@/hooks/useDialogKeyboard'
import { KeyboardHint } from '../ui/keyboard-hint'

interface CreateArtifactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  onCreateArtifact?: (
    name: string,
    description: string,
    subtype: string,
    readReferences: string[]
  ) => Promise<void>
}

export function CreateArtifactDialog({
  open,
  onOpenChange,
  projectId,
  onCreateArtifact
}: CreateArtifactDialogProps) {
  const [artifactName, setArtifactName] = useState('')
  const [artifactDescription, setArtifactDescription] = useState('')
  const [artifactSubtype, setArtifactSubtype] = useState<string>('code')
  const [availableReferences, setAvailableReferences] = useState<Reference[]>([])
  const [selectedReferences, setSelectedReferences] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open && projectId) {
      loadReferences()
    } else if (open) {
      // Reset if no project ID
      setAvailableReferences([])
      setSelectedReferences(new Set())
    }
  }, [open, projectId])

  const loadReferences = async () => {
    if (!projectId) return
    
    setLoading(true)
    try {
      const projectRefs = await projectManager.getProjectRefs(projectId)
      // Filter to only show references, not other artifacts
      const references = projectRefs.filter(ref => ref.type === 'reference')
      setAvailableReferences(references)
    } catch (error) {
      console.error('Failed to load references:', error)
      toast.error('Failed to load references')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!artifactName.trim()) return
    
    setCreating(true)
    try {
      if (onCreateArtifact) {
        await onCreateArtifact(
          artifactName.trim(),
          artifactDescription.trim(),
          artifactSubtype,
          Array.from(selectedReferences)
        )
      } else {
        // Fallback: create artifact directly
        const refId = artifactName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const refPath = `refs/${refId}`
        
        await window.intentAPI.createDirectory(refPath)
        await projectManager.createRefMetadata(
          refId,
          artifactName.trim(),
          'artifact',
          artifactSubtype as any,
          artifactDescription.trim()
        )
        
        // Add read references
        for (const readRefId of selectedReferences) {
          await projectManager.addReadReference(refId, readRefId)
        }
        
        // Add to project if provided
        if (projectId) {
          await projectManager.addRefToProject(projectId, refId)
        }
        
        toast.success('Artifact created successfully')
      }
      
      // Reset form
      setArtifactName('')
      setArtifactDescription('')
      setArtifactSubtype('code')
      setSelectedReferences(new Set())
      setSearchQuery('')
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to create artifact:', error)
      toast.error('Failed to create artifact')
    } finally {
      setCreating(false)
    }
  }

  const toggleReference = (refId: string) => {
    const newSelected = new Set(selectedReferences)
    if (newSelected.has(refId)) {
      newSelected.delete(refId)
    } else {
      newSelected.add(refId)
    }
    setSelectedReferences(newSelected)
  }

  const getRefIcon = (ref: Reference) => {
    if (ref.subtype === 'document') return <FileText className="h-4 w-4" />
    if (ref.subtype === 'media') return <Image className="h-4 w-4" />
    return <Package className="h-4 w-4" />
  }

  const filteredReferences = availableReferences.filter(ref =>
    ref.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Keyboard shortcuts
  useDialogKeyboard({
    isOpen: open,
    onSubmit: handleCreate,
    onCancel: () => onOpenChange(false),
    isSubmitDisabled: !artifactName.trim() || creating
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create New Artifact</DialogTitle>
          <DialogDescription>
            Create an artifact that can read from selected references for context
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
          {/* Artifact Name */}
          <div className="space-y-2">
            <Label htmlFor="artifact-name">Artifact Name</Label>
            <Input
              id="artifact-name"
              placeholder="my-artifact"
              value={artifactName}
              onChange={(e) => setArtifactName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Artifact Description */}
          <div className="space-y-2">
            <Label htmlFor="artifact-description">Description</Label>
            <Textarea
              id="artifact-description"
              placeholder="Describe what this artifact is for..."
              rows={3}
              value={artifactDescription}
              onChange={(e) => setArtifactDescription(e.target.value)}
            />
          </div>

          {/* Artifact Subtype */}
          <div className="space-y-2">
            <Label htmlFor="artifact-subtype">Type</Label>
            <Select value={artifactSubtype} onValueChange={setArtifactSubtype}>
              <SelectTrigger id="artifact-subtype">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="code">Code</SelectItem>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="media-artifact">Media</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Context References */}
          {projectId && availableReferences.length > 0 && (
            <div className="space-y-2">
              <Label>Context References</Label>
              <p className="text-sm text-muted-foreground">
                Select references this artifact can read from
              </p>
              
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search references..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>

              {/* Reference List */}
              <ScrollArea className="h-48 rounded-md border p-2">
                {loading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Loading references...
                  </p>
                ) : filteredReferences.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {searchQuery ? 'No matching references found' : 'No references available'}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredReferences.map(ref => (
                      <div
                        key={ref.id}
                        className="flex items-center space-x-2 p-2 rounded hover:bg-accent"
                      >
                        <Checkbox
                          id={ref.id}
                          checked={selectedReferences.has(ref.id)}
                          onCheckedChange={() => toggleReference(ref.id)}
                        />
                        <label
                          htmlFor={ref.id}
                          className="flex-1 flex items-center gap-2 cursor-pointer"
                        >
                          {getRefIcon(ref)}
                          <span className="text-sm font-medium">{ref.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {ref.subtype}
                          </Badge>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
              
              {selectedReferences.size > 0 && (
                <p className="text-sm text-muted-foreground">
                  {selectedReferences.size} reference{selectedReferences.size !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>
          )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between border-t pt-4 mt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <KeyboardHint keys={['⌘', 'Enter']} /> to submit • <KeyboardHint keys={['Esc']} /> to cancel
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!artifactName.trim() || creating}
            >
              {creating ? 'Creating...' : 'Create Artifact'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}