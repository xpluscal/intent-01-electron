import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Search, Plus, X, BookOpen, FileText, Image, Package } from 'lucide-react'
import { projectManager } from '@/lib/projectManager'
import { Reference } from '@/types/projects'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ManageReadReferencesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artifactId: string
  artifactName: string
  projectId?: string
}

export function ManageReadReferencesDialog({
  open,
  onOpenChange,
  artifactId,
  artifactName,
  projectId
}: ManageReadReferencesDialogProps) {
  const [readReferences, setReadReferences] = useState<Reference[]>([])
  const [availableReferences, setAvailableReferences] = useState<Reference[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (open) {
      loadReferences()
    }
  }, [open, artifactId, projectId])

  const loadReferences = async () => {
    setLoading(true)
    try {
      // Get current read references
      const currentReadRefs = await projectManager.getReadReferences(artifactId)
      setReadReferences(currentReadRefs)

      // Get all references in the same project
      if (projectId) {
        const projectRefs = await projectManager.getProjectRefs(projectId)
        // Filter out the artifact itself and already added references
        const readRefIds = currentReadRefs.map(r => r.id)
        const available = projectRefs.filter(ref => 
          ref.id !== artifactId && 
          !readRefIds.includes(ref.id) &&
          ref.type === 'reference' // Only show references, not other artifacts
        )
        setAvailableReferences(available)
      }
    } catch (error) {
      console.error('Failed to load references:', error)
      toast.error('Failed to load references')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async (refId: string) => {
    try {
      await projectManager.addReadReference(artifactId, refId)
      await loadReferences()
      toast.success('Read reference added')
    } catch (error) {
      console.error('Failed to add read reference:', error)
      toast.error('Failed to add read reference')
    }
  }

  const handleRemove = async (refId: string) => {
    try {
      await projectManager.removeReadReference(artifactId, refId)
      await loadReferences()
      toast.success('Read reference removed')
    } catch (error) {
      console.error('Failed to remove read reference:', error)
      toast.error('Failed to remove read reference')
    }
  }

  const getRefIcon = (ref: Reference) => {
    if (ref.subtype === 'document') return <FileText className="h-4 w-4" />
    if (ref.subtype === 'media') return <Image className="h-4 w-4" />
    return <Package className="h-4 w-4" />
  }

  const filteredAvailable = availableReferences.filter(ref =>
    ref.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Context</DialogTitle>
          <DialogDescription>
            Configure which references "{artifactName}" can read from
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Read References */}
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Current Read References
              <Badge variant="secondary">{readReferences.length}</Badge>
            </h3>
            <ScrollArea className="h-48 rounded-md border p-2">
              {readReferences.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No read references configured
                </p>
              ) : (
                <div className="space-y-1">
                  {readReferences.map(ref => (
                    <div
                      key={ref.id}
                      className="flex items-center justify-between p-2 rounded hover:bg-accent"
                    >
                      <div className="flex items-center gap-2">
                        {getRefIcon(ref)}
                        <span className="text-sm font-medium">{ref.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {ref.subtype}
                        </Badge>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemove(ref.id)}
                        className="h-7 w-7"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Available References */}
          <div>
            <h3 className="text-sm font-medium mb-2">Available References</h3>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search references..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <ScrollArea className="h-48 rounded-md border p-2">
              {filteredAvailable.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {searchQuery ? 'No matching references found' : 'No available references'}
                </p>
              ) : (
                <div className="space-y-1">
                  {filteredAvailable.map(ref => (
                    <div
                      key={ref.id}
                      className="flex items-center justify-between p-2 rounded hover:bg-accent"
                    >
                      <div className="flex items-center gap-2">
                        {getRefIcon(ref)}
                        <span className="text-sm font-medium">{ref.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {ref.subtype}
                        </Badge>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleAdd(ref.id)}
                        className="h-7 w-7"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}