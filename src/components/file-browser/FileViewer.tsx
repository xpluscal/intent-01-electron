import { useState, useEffect, useCallback } from 'react'
import { X, Save, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { toast } from 'sonner'
import { useFileSystem } from '@/hooks/useFileSystem'
import { MarkdownEditor } from '../editor/MarkdownEditor'
import { CodeEditor } from '../editor/CodeEditor'

interface FileViewerProps {
  filePath: string
  onClose: () => void
}

// Determine file type from extension
function getFileLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'py':
      return 'python'
    case 'md':
      return 'markdown'
    case 'json':
      return 'javascript' // CodeMirror handles JSON with JS mode
    case 'html':
    case 'xml':
      return 'html'
    case 'css':
      return 'css'
    default:
      return 'text'
  }
}

// Determine if file is an image
function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico']
  return imageExtensions.includes(ext)
}

// Determine if file is a video
function isVideoFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v']
  return videoExtensions.includes(ext)
}

// Determine if file is audio
function isAudioFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a']
  return audioExtensions.includes(ext)
}

export function FileViewer({ filePath, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string>('')
  const [editedContent, setEditedContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const { readFile, writeFile } = useFileSystem()

  const fileName = filePath.split('/').pop() || ''
  const isMarkdown = fileName.endsWith('.md')
  const isImage = isImageFile(filePath)
  const isVideo = isVideoFile(filePath)
  const isAudio = isAudioFile(filePath)
  const isMedia = isImage || isVideo || isAudio
  const language = getFileLanguage(filePath)

  useEffect(() => {
    loadFile()
  }, [filePath])

  const loadFile = async () => {
    if (isMedia) {
      // Load media URL for media files
      setIsLoading(true)
      try {
        const url = await window.intentAPI.getFileUrl(filePath)
        setMediaUrl(url)
      } catch (error) {
        console.error(error)
        toast.error('Failed to load media file')
      } finally {
        setIsLoading(false)
      }
      return
    }
    
    setIsLoading(true)
    try {
      const fileContent = await readFile(filePath)
      setContent(fileContent)
      setEditedContent(fileContent)
      setHasChanges(false)
    } catch (error) {
      console.error(error)
      toast.error('Failed to load file')
    } finally {
      setIsLoading(false)
    }
  }

  const handleChange = useCallback((newContent: string) => {
    setEditedContent(newContent)
    setHasChanges(newContent !== content)
  }, [content])

  const handleSave = async () => {
    if (!hasChanges) return
    
    setIsSaving(true)
    try {
      await writeFile(filePath, editedContent)
      setContent(editedContent)
      setHasChanges(false)
      toast.success('File saved successfully')
    } catch (error) {
      console.error(error)
      toast.error('Failed to save file')
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm('You have unsaved changes. Are you sure you want to close?')
      if (!confirmed) return
    }
    onClose()
  }

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editedContent, content])

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="border-b p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-medium truncate">{fileName}</h3>
          <span className="text-xs text-muted-foreground truncate max-w-[300px]">
            {filePath}
          </span>
          {hasChanges && (
            <span className="text-xs text-orange-500">• Modified</span>
          )}
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          {!isMedia && (
            <Button
              size="sm"
              variant={hasChanges ? "default" : "outline"}
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isMedia ? (
          <div className="h-full flex items-center justify-center p-4 bg-muted/30">
            {isImage && mediaUrl && (
              <img 
                src={mediaUrl} 
                alt={fileName}
                className="max-w-full max-h-full object-contain rounded shadow-lg"
              />
            )}
            {isVideo && mediaUrl && (
              <video 
                src={mediaUrl} 
                controls
                className="max-w-full max-h-full rounded shadow-lg"
              >
                Your browser does not support the video tag.
              </video>
            )}
            {isAudio && mediaUrl && (
              <div className="flex flex-col items-center gap-4">
                <div className="text-6xl">🎵</div>
                <audio 
                  src={mediaUrl} 
                  controls
                  className="w-80"
                >
                  Your browser does not support the audio tag.
                </audio>
                <p className="text-sm text-muted-foreground">{fileName}</p>
              </div>
            )}
          </div>
        ) : isMarkdown ? (
          <MarkdownEditor
            content={editedContent}
            onChange={handleChange}
            onSave={handleSave}
          />
        ) : (
          <CodeEditor
            content={editedContent}
            onChange={handleChange}
            onSave={handleSave}
            language={language}
          />
        )}
      </div>
      
      <div className="border-t px-3 py-1 text-xs text-muted-foreground flex items-center justify-between">
        <span>{isMedia ? (isImage ? 'Image' : isVideo ? 'Video' : 'Audio') : language.charAt(0).toUpperCase() + language.slice(1)}</span>
        <span>{!isMedia && 'Press Cmd+S to save'}</span>
      </div>
    </div>
  )
}