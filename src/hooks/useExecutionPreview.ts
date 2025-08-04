import { useState, useEffect, useRef } from 'react'

interface ExecutionPreviewStatus {
  running: boolean
  status: 'stopped' | 'installing' | 'starting' | 'running' | 'error' | 'workspace_unavailable'
  port?: number
  url?: string
  error?: string
  previewId?: string
  workspaceAvailable?: boolean
}

interface PreviewLog {
  timestamp: string
  type: 'info' | 'error' | 'warning' | 'system'
  content: string
}

export function useExecutionPreview(executionId: string, refId: string, isActive: boolean = false) {
  const [status, setStatus] = useState<ExecutionPreviewStatus>({
    running: false,
    status: 'stopped',
    workspaceAvailable: true
  })
  const [logs, setLogs] = useState<PreviewLog[]>([])
  const [loading, setLoading] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const serverUrl = window.intentAPI.serverUrl // http://localhost:3456

  // Only check status when active
  useEffect(() => {
    if (executionId && isActive) {
      // Check immediately when becoming active
      checkStatus()
      
      // Set up periodic status check every 10 seconds only when active
      const intervalId = setInterval(() => {
        checkStatus()
      }, 10000)
      
      return () => clearInterval(intervalId)
    }
  }, [executionId, isActive])

  const checkStatus = async () => {
    try {
      // Use the status endpoint which includes preview info
      const response = await fetch(`${serverUrl}/status/${executionId}`)
      if (response.ok) {
        const data = await response.json()
        
        // Workspace is available if we got a successful response
        const workspaceAvailable = true
        
        // Check both possible locations for the preview
        const preview = data.previews?.mutate?.[refId] || 
                       data.preview || 
                       data.previews?.[0] ||
                       (data.previews?.mutate && Object.values(data.previews.mutate)[0])
                       
        if (preview) {
          setStatus({
            running: preview.status === 'running',
            status: preview.status,
            port: preview.port,
            url: preview.url || preview.urls?.local,
            previewId: preview.id || preview.previewId,
            workspaceAvailable
          })
        } else {
          console.log('No preview found in response')
          setStatus(prev => ({
            ...prev,
            workspaceAvailable,
            status: 'stopped'
          }))
        }
      } else if (response.status === 404) {
        // Execution not found
        setStatus({
          running: false,
          status: 'workspace_unavailable',
          error: 'Execution workspace no longer exists',
          workspaceAvailable: false
        })
      }
    } catch (error) {
      console.error('Failed to check execution preview status:', error)
    }
  }

  const startPreview = async () => {
    // Check if workspace is available first
    if (!status.workspaceAvailable) {
      console.error('Cannot start preview: execution workspace is not available')
      return { success: false, error: 'Execution workspace has been cleaned up' }
    }
    
    setLoading(true)
    try {
      const response = await fetch(`${serverUrl}/preview/${executionId}/start?refType=mutate&refId=${refId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installDependencies: false // Dependencies should already be installed
        })
      })
      
      const data = await response.json()
      
      if (response.ok && data.success) {
        setStatus({
          running: false,
          status: 'starting',
          previewId: data.previewId,
          workspaceAvailable: true
        })
        
        // Start monitoring logs
        if (data.previewId) {
          startLogStream(data.previewId)
        }
        
        // Start polling for status
        const pollInterval = setInterval(async () => {
          const statusResponse = await fetch(`${serverUrl}/status/${executionId}`)
          if (statusResponse.ok) {
            const statusData = await statusResponse.json()
            const preview = statusData.previews?.mutate?.[refId] || 
                           statusData.preview || 
                           statusData.previews?.[0] ||
                           (statusData.previews?.mutate && Object.values(statusData.previews.mutate)[0])
                           
            if (preview) {
              setStatus({
                running: preview.status === 'running',
                status: preview.status,
                port: preview.port,
                url: preview.url || preview.urls?.local,
                previewId: preview.id || preview.previewId,
                workspaceAvailable: true
              })
              
              if (preview.status === 'running' || preview.status === 'error') {
                clearInterval(pollInterval)
              }
            }
          }
        }, 5000) // Poll every 5 seconds instead of 1 second
        
        // Clear interval after 2 minutes to prevent memory leaks
        setTimeout(() => clearInterval(pollInterval), 120000)
        
        return { success: true }
      } else {
        setStatus({
          running: false,
          status: 'error',
          error: data.error?.message || 'Failed to start preview'
        })
        return { success: false, error: data.error?.message }
      }
    } catch (error) {
      console.error('Failed to start execution preview:', error)
      setStatus({
        running: false,
        status: 'error',
        error: 'Failed to start preview'
      })
      return { success: false, error: 'Failed to start preview' }
    } finally {
      setLoading(false)
    }
  }

  const stopPreview = async () => {
    if (!status.previewId) return
    
    setLoading(true)
    try {
      const response = await fetch(`${serverUrl}/preview/${executionId}/stop?refType=mutate&refId=${refId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          previewId: status.previewId 
        })
      })
      
      if (response.ok) {
        setStatus({
          running: false,
          status: 'stopped',
          workspaceAvailable: true
        })
        stopLogStream()
      }
    } catch (error) {
      console.error('Failed to stop preview:', error)
    } finally {
      setLoading(false)
    }
  }

  const restartPreview = async () => {
    if (status.running || status.status === 'starting') {
      await stopPreview()
      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    return startPreview()
  }

  const startLogStream = (previewId: string) => {
    // Close existing stream
    stopLogStream()
    
    // Create new EventSource for SSE
    const eventSource = new EventSource(`${serverUrl}/preview/${executionId}/${previewId}/logs`)
    
    eventSource.addEventListener('log', (event) => {
      try {
        const log = JSON.parse(event.data)
        const previewLog: PreviewLog = {
          timestamp: new Date().toISOString(),
          type: log.type || 'info',
          content: log.content || log.message || log
        }
        setLogs(prev => [...prev, previewLog])
      } catch (error) {
        console.error('Failed to parse preview log:', error)
      }
    })
    
    eventSource.addEventListener('error', (event) => {
      console.error('Preview EventSource error:', event)
      if (eventSource.readyState === EventSource.CLOSED) {
        stopLogStream()
      }
    })
    
    eventSourceRef.current = eventSource
  }

  const stopLogStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLogStream()
      // Reset status to prevent stale state
      setStatus({
        running: false,
        status: 'stopped',
        workspaceAvailable: true
      })
      setLogs([])
    }
  }, [])

  return {
    status,
    logs,
    loading,
    startPreview,
    stopPreview,
    restartPreview,
    checkStatus
  }
}