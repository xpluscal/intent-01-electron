import { useState, useEffect } from 'react'
import { X, Save, Edit } from 'lucide-react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { toast } from 'sonner'
import { useFileSystem } from '@/hooks/useFileSystem'

interface FileViewerProps {
  filePath: string
  onClose: () => void
}

export function FileViewer({ filePath, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string>('')
  const [editedContent, setEditedContent] = useState<string>('')
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const { readFile, writeFile } = useFileSystem()

  useEffect(() => {
    loadFile()
  }, [filePath])

  const loadFile = async () => {
    setIsLoading(true)
    try {
      const fileContent = await readFile(filePath)
      setContent(fileContent)
      setEditedContent(fileContent)
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      await writeFile(filePath, editedContent)
      setContent(editedContent)
      setIsEditing(false)
      toast.success('File saved successfully')
    } catch (error) {
      console.error(error)
    }
  }

  const handleCancel = () => {
    setEditedContent(content)
    setIsEditing(false)
  }

  const fileName = filePath.split('/').pop() || ''

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-3 flex items-center justify-between bg-background">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium truncate">{fileName}</h3>
          <span className="text-xs text-muted-foreground truncate max-w-[300px]">
            {filePath}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={handleSave}
              >
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsEditing(true)}
            >
              <Edit className="h-4 w-4 mr-1" />
              Edit
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <div className="flex-1 p-4 overflow-auto">
        {isLoading ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : isEditing ? (
          <Textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="w-full h-full font-mono text-sm resize-none"
            placeholder="Enter file content..."
          />
        ) : (
          <pre className="font-mono text-sm whitespace-pre-wrap">
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}