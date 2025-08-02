import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Code2, X, BookOpen, Play, Square, Loader2, ExternalLink, AlertCircle, Maximize2, Minimize2, RefreshCw } from 'lucide-react'
import { projectManager } from '@/lib/projectManager'
import { Reference } from '@/types/projects'
import { usePreview } from '@/hooks/usePreview'
import { TerminalLogViewer } from './code/terminal-log-viewer'
import { cn } from '@/lib/utils'

interface CodeArtifactViewProps {
  refId: string
  refName: string
  onClose?: () => void
}

export function CodeArtifactView({ refId, refName, onClose }: CodeArtifactViewProps) {
  const [readReferences, setReadReferences] = useState<Reference[]>([])
  const [loading, setLoading] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const { status, logs, loading: previewLoading, startPreview, stopPreview } = usePreview(refId)

  const handleRefresh = () => {
    setIframeKey(prev => prev + 1)
  }

  useEffect(() => {
    loadReadReferences()
  }, [refId])

  const loadReadReferences = async () => {
    try {
      const refs = await projectManager.getReadReferences(refId)
      setReadReferences(refs)
    } catch (error) {
      console.error('Failed to load read references:', error)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4" />
              <h2 className="text-base font-semibold">{refName}</h2>
            </div>
            {readReferences.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Uses:</span>
                <div className="flex items-center gap-1">
                  {readReferences.slice(0, 3).map(ref => (
                    <Badge key={ref.id} variant="secondary" className="text-xs">
                      {ref.name}
                    </Badge>
                  ))}
                  {readReferences.length > 3 && (
                    <Badge variant="secondary" className="text-xs">
                      +{readReferences.length - 3}
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
          {onClose && (
            <Button 
              onClick={onClose} 
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Preview Controls */}
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            onClick={() => status.running ? stopPreview() : startPreview()}
            disabled={previewLoading}
            size="sm"
            variant={status.running ? "destructive" : "default"}
          >
            {previewLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {status.status === 'installing' ? 'Installing...' : 'Starting...'}
              </>
            ) : status.running ? (
              <>
                <Square className="h-4 w-4 mr-2" />
                Stop Preview
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Start Preview
              </>
            )}
          </Button>
          
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            <Badge 
              variant={status.running ? "success" : status.status === 'error' ? "destructive" : "secondary"}
              className="capitalize"
            >
              {status.status}
            </Badge>
          </div>
          
          {status.port && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Port:</span>
              <span className="font-mono">{status.port}</span>
            </div>
          )}
        </div>
        
        {status.url && (
          <Button
            variant="ghost"
            size="sm"
            asChild
          >
            <a href={status.url} target="_blank" rel="noopener noreferrer">
              Open in Browser
              <ExternalLink className="h-3 w-3 ml-2" />
            </a>
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Fullscreen Preview */}
        {isFullscreen && status.running && status.url && (
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            {/* Fullscreen Navigation */}
            <div className="h-12 border-b bg-background flex items-center justify-between px-4">
              <div className="flex items-center gap-4">
                <h3 className="font-semibold">{refName}</h3>
                <Badge variant="success" className="text-xs">
                  Preview Running
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {status.url}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  title="Refresh"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(status.url, '_blank')}
                  title="Open in new tab"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsFullscreen(false)}
                  title="Exit fullscreen"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Fullscreen iframe */}
            <iframe
              key={`fullscreen-${iframeKey}`}
              src={status.url}
              className="flex-1 w-full border-0"
              title="Preview Fullscreen"
            />
          </div>
        )}

        {/* Normal Preview */}
        <div className={cn("flex-1 min-h-0 relative", isFullscreen && "hidden")}>
          {status.running && status.url ? (
            <>
              <iframe
                key={`normal-${iframeKey}`}
                src={status.url}
                className="w-full h-full border-0"
                title="Preview"
              />
              {/* Fullscreen button overlay */}
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-2 right-2 shadow-lg"
                onClick={() => setIsFullscreen(true)}
                title="Fullscreen"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <div className="h-full flex items-center justify-center bg-muted/10">
              <div className="text-center">
                {status.status === 'error' ? (
                  <>
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
                    <h3 className="text-lg font-medium mb-2">Preview Error</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      {status.error || 'Failed to start preview'}
                    </p>
                  </>
                ) : (
                  <>
                    <Code2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">Preview Not Running</h3>
                    <p className="text-sm text-muted-foreground">
                      Click "Start Preview" to see your artifact in action
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        
        {/* Terminal Logs */}
        <div className={cn("h-[40%] min-h-[200px] border-t", isFullscreen && "hidden")}>
          <TerminalLogViewer 
            logs={logs.map(log => `[${log.timestamp}] [${log.type}] ${log.content}`)}
            className="h-full"
          />
        </div>
      </div>
    </div>
  )
}