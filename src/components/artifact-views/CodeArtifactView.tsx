import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Code2, X, BookOpen, Play, Square, Loader2, ExternalLink, AlertCircle, Maximize2, Minimize2, RefreshCw, Send, RotateCw, GitMerge } from 'lucide-react'
import { projectManager } from '@/lib/projectManager'
import { Reference } from '@/types/projects'
import { usePreview } from '@/hooks/usePreview'
import { useExecution } from '@/hooks/useExecution'
import { useExecutionPreview } from '@/hooks/useExecutionPreview'
import { TerminalLogViewer } from './code/terminal-log-viewer'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Textarea } from '../ui/textarea'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'

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
  const [activeTab, setActiveTab] = useState('current')
  const [message, setMessage] = useState('')
  const [executionMessages, setExecutionMessages] = useState<Map<string, string>>(new Map())
  
  const { status, logs, loading: previewLoading, startPreview, stopPreview } = usePreview(refId)
  const { executions, logs: executionLogs, loading: executionLoading, startExecution, sendMessage, getExecutionsByArtifact, clearExecutions, fetchExecutionLogs, startLogStream, stopLogStream, startStatusPolling } = useExecution()

  const handleRefresh = () => {
    setIframeKey(prev => prev + 1)
  }

  useEffect(() => {
    // Reset tab to current when switching artifacts
    setActiveTab('current')
    // Clear execution state before loading new artifact's executions
    clearExecutions()
    loadReadReferences()
    loadExecutions()
  }, [refId]) // Only depend on refId

  // Fetch logs when switching to an execution tab
  useEffect(() => {
    if (activeTab.startsWith('execution-')) {
      const executionId = activeTab.replace('execution-', '')
      
      // Always fetch logs when switching to an execution tab
      fetchExecutionLogs(executionId)
      
      // For active executions, also start streaming
      const execution = executions.get(executionId)
      if (execution && (execution.status === 'running' || execution.status === 'pending')) {
        startLogStream(executionId)
      }
    }
    
    // Cleanup: stop log streams when switching away
    return () => {
      if (activeTab.startsWith('execution-')) {
        const executionId = activeTab.replace('execution-', '')
        stopLogStream(executionId)
      }
    }
  }, [activeTab]) // Only depend on activeTab

  const loadExecutions = async () => {
    // This will load historical executions and update the hook's state
    await getExecutionsByArtifact(refId)
  }

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

  const handleStartExecution = async () => {
    if (!message.trim()) return
    
    const result = await startExecution({
      artifactId: refId,
      artifactName: refName,
      artifactType: 'code', // This is a CodeArtifactView, so it's a code artifact
      readReferences: readReferences.map(r => ({
        id: r.id,
        name: r.name,
        subtype: r.subtype,
        description: r.description
      })),
      message: message.trim()
    })
    
    if (result.success && result.executionId) {
      setMessage('')
      // Switch to the new execution tab
      setActiveTab(`execution-${result.executionId}`)
    }
  }

  const handleSendMessage = async (executionId: string) => {
    const msg = executionMessages.get(executionId)
    if (!msg?.trim()) return
    
    const result = await sendMessage(executionId, msg.trim())
    if (result.success) {
      setExecutionMessages(prev => {
        const newMap = new Map(prev)
        newMap.set(executionId, '')
        return newMap
      })
      
      // Resume log streaming and status polling when message is sent
      startLogStream(executionId)
      startStatusPolling(executionId)
    }
  }

  const executionList = Array.from(executions.values())
  
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
      
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="current">Current</TabsTrigger>
          {executionList.map((exec, index) => (
            <TabsTrigger key={exec.id} value={`execution-${exec.id}`}>
              Execution #{index + 1}
              {exec.status === 'running' && (
                <Badge variant="success" className="ml-2 text-xs px-1 py-0 h-4">
                  Running
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Current Tab - Preview */}
        <TabsContent value="current" className="flex-1 flex flex-col min-h-0">
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
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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

        {/* Normal Preview - flex-1 to take remaining space */}
        <div className={cn("flex-1 relative overflow-hidden", isFullscreen && "hidden")}>
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
        <div className={cn("h-[25dvh] min-h-[200px] max-h-[300px] border-t flex-shrink-0", isFullscreen && "hidden")}>
          <TerminalLogViewer 
            logs={logs.map(log => `[${log.timestamp}] [${log.type}] ${log.content}`)}
            className="h-full"
          />
        </div>
        
        {/* Message Input */}
        <div className={cn("border-t p-4 flex gap-2", isFullscreen && "hidden")}>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleStartExecution()
              }
            }}
            placeholder="Enter a message to start a new execution..."
            className="flex-1 resize-none"
            rows={2}
          />
          <Button
            onClick={handleStartExecution}
            disabled={!message.trim() || executionLoading}
            size="icon"
            className="h-[72px] w-[72px]"
          >
            {executionLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </TabsContent>
        {/* Execution Tabs */}
        {executionList.map((execution, index) => {
          const execLogs = executionLogs.get(execution.id) || []
          const execMessage = executionMessages.get(execution.id) || ''
          
          return (
            <TabsContent key={execution.id} value={`execution-${execution.id}`} className="flex-1 flex flex-col min-h-0">
              <ExecutionTabContent 
                execution={execution}
                execLogs={execLogs}
                execMessage={execMessage}
                refId={refId}
                isActive={activeTab === `execution-${execution.id}`}
                onMessageChange={(value) => {
                  setExecutionMessages(prev => {
                    const newMap = new Map(prev)
                    newMap.set(execution.id, value)
                    return newMap
                  })
                }}
                onSendMessage={() => handleSendMessage(execution.id)}
              />
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}

// Separate component for execution tab content to manage its own preview state
function ExecutionTabContent({ 
  execution, 
  execLogs, 
  execMessage, 
  refId,
  isActive,
  onMessageChange,
  onSendMessage
}: {
  execution: any
  execLogs: any[]
  execMessage: string
  refId: string
  isActive: boolean
  onMessageChange: (value: string) => void
  onSendMessage: () => void
}) {
  const { status: previewStatus, loading: previewLoading, startPreview, stopPreview, restartPreview, checkStatus } = useExecutionPreview(execution.id, refId, isActive)
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeResult, setMergeResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null)

  const handleMerge = async () => {
    setMerging(true)
    try {
      const result = await window.intentAPI.mergeExecutionBranch(refId, execution.id)
      setMergeResult(result)
      if (result.success) {
        // Show success toast
        toast.success('Changes merged successfully!', {
          description: `Execution ${execution.id} has been merged into the current branch.`
        })
        // Close dialog after successful merge
        setTimeout(() => {
          setShowMergeDialog(false)
          setMergeResult(null)
        }, 2000)
      } else {
        // Show error toast for API errors
        toast.error('Merge failed', {
          description: result.error || 'Failed to merge execution branch'
        })
      }
    } catch (error) {
      setMergeResult({ success: false, error: error.message })
      // Show error toast for exceptions
      toast.error('Merge failed', {
        description: error.message || 'An unexpected error occurred'
      })
    } finally {
      setMerging(false)
    }
  }
  
  return (
    <>
      {/* Execution Status Bar with Preview Controls */}
      <div className="px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <Badge 
                variant={
                  execution.status === 'running' ? "success" : 
                  execution.status === 'completed' ? "secondary" : 
                  execution.status === 'failed' ? "destructive" : "outline"
                }
                className="capitalize"
              >
                {execution.status}
              </Badge>
            </div>
            
            {/* {execution.phase && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Phase:</span>
                <span className="capitalize">{execution.phase}</span>
              </div>
            )}
            
            {execution.created && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Started:</span>
                <span>{new Date(execution.created).toLocaleTimeString()}</span>
              </div>
            )} */}
          </div>
          
          <div className="flex items-center gap-2">
            {execution.status === 'completed' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMergeDialog(true)}
                disabled={merging}
              >
                <GitMerge className="h-3 w-3 mr-2" />
                Merge into Current
              </Button>
            )}
            {previewStatus.url && (
              <Button
                variant="ghost"
                size="sm"
                asChild
              >
                <a href={previewStatus.url} target="_blank" rel="noopener noreferrer">
                  Open in Browser
                  <ExternalLink className="h-3 w-3 ml-2" />
                </a>
              </Button>
            )}
          </div>
        </div>
        
        {/* Preview Controls */}
        <div className="flex items-center gap-4 mt-2">
          <Button
            onClick={() => previewStatus.running ? stopPreview() : startPreview()}
            disabled={previewLoading || !previewStatus.workspaceAvailable || (execution.status !== 'running' && execution.status !== 'completed')}
            size="sm"
            variant={previewStatus.running ? "destructive" : "default"}
          >
            {previewLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {previewStatus.status === 'installing' ? 'Installing...' : 'Starting...'}
              </>
            ) : previewStatus.running ? (
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
          
          {previewStatus.previewId && (
            <Button
              onClick={restartPreview}
              disabled={previewLoading || !previewStatus.workspaceAvailable || (execution.status !== 'running' && execution.status !== 'completed')}
              size="sm"
              variant="outline"
            >
              <RotateCw className="h-4 w-4 mr-2" />
              Restart
            </Button>
          )}
          
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Preview:</span>
            <Badge 
              variant={previewStatus.running ? "success" : previewStatus.status === 'error' ? "destructive" : "secondary"}
              className="capitalize"
            >
              {previewStatus.status}
            </Badge>
          </div>
          
          {previewStatus.port && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Port:</span>
              <span className="font-mono">{previewStatus.port}</span>
            </div>
          )}
          
          {!previewStatus.workspaceAvailable && (
            <Badge variant="outline" className="text-xs">
              Workspace Cleaned Up
            </Badge>
          )}
        </div>
      </div>
      
      {/* Content - Using viewport heights */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Preview iframe - flex-1 to take remaining space */}
        <div className="flex-1 relative overflow-hidden">
          {previewStatus.running && previewStatus.url ? (
            <iframe
              key={`exec-preview-${execution.id}-${previewStatus.previewId || 'default'}`}
              src={previewStatus.url}
              className="w-full h-full border-0"
              title={`Execution ${execution.id} Preview`}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-muted/10">
              <div className="text-center">
                {previewStatus.status === 'error' ? (
                  <>
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
                    <h3 className="text-lg font-medium mb-2">Preview Error</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      {previewStatus.error || 'Failed to start preview'}
                    </p>
                  </>
                ) : previewStatus.status === 'workspace_unavailable' ? (
                  <>
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 text-warning" />
                    <h3 className="text-lg font-medium mb-2">Workspace Unavailable</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      The execution workspace has been cleaned up and is no longer available for preview.
                    </p>
                  </>
                ) : (
                  <>
                    <Code2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">No Preview Running</h3>
                    <p className="text-sm text-muted-foreground">
                      {execution.status === 'running' || execution.status === 'completed'
                        ? 'Click "Start Preview" to see the execution preview' 
                        : 'Execution must be running or completed to start preview'}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        
        {/* Terminal Logs */}
        <div className="h-[25dvh] min-h-[200px] max-h-[300px] border-t flex-shrink-0">
          <TerminalLogViewer 
            logs={execLogs.map(log => {
              // Pass logs in the format expected by TerminalLogViewer
              const content = typeof log.content === 'string' 
                ? log.content 
                : JSON.stringify(log.content);
              return `[${log.timestamp}] [${log.type}] ${content}`;
            })}
            className="h-full"
          />
        </div>
        
        {/* Message Input */}
        <div className="border-t p-4 flex gap-2">
          <Textarea
            value={execMessage}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSendMessage()
              }
            }}
            placeholder="Send a message to the execution..."
            className="flex-1 resize-none"
            rows={2}
          />
          <Button
            onClick={onSendMessage}
            disabled={!execMessage.trim()}
            size="icon"
            className="h-[72px] w-[72px]"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Merge Confirmation Dialog */}
      <AlertDialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge Execution Changes</AlertDialogTitle>
            <AlertDialogDescription>
              This will merge the changes from execution branch <code>exec-{execution.id}</code> into the main branch.
              {mergeResult && (
                <div className={cn("mt-4 p-3 rounded-md text-sm", 
                  mergeResult.success ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400"
                )}>
                  {mergeResult.success ? '✓ ' : '✗ '}{mergeResult.message || mergeResult.error}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMerge}
              disabled={merging || (mergeResult?.success)}
            >
              {merging ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Merging...
                </>
              ) : mergeResult?.success ? (
                'Merged!'
              ) : (
                'Merge'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}