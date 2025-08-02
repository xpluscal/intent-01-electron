import { useState, useEffect, useCallback, useRef } from 'react'

interface PreviewStatus {
  running: boolean
  status: 'stopped' | 'installing' | 'starting' | 'running' | 'error'
  port?: number
  url?: string
  error?: string
  previewId?: string
}

interface PreviewLog {
  timestamp: string
  type: 'info' | 'error' | 'warning' | 'system'
  content: string
}

export function usePreview(refId: string) {
  const [status, setStatus] = useState<PreviewStatus>({
    running: false,
    status: 'stopped'
  })
  const [logs, setLogs] = useState<PreviewLog[]>([])
  const [loading, setLoading] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const serverUrl = window.intentAPI.serverUrl // http://localhost:3456

  // Check initial status
  useEffect(() => {
    checkStatus()
  }, [refId])

  const checkStatus = async () => {
    try {
      const response = await fetch(`${serverUrl}/refs/${refId}/preview/status`)
      if (response.ok) {
        const data = await response.json()
        setStatus({
          running: data.status === 'running',
          status: data.status,
          port: data.port,
          url: data.url,
          previewId: data.previewId
        })
      }
    } catch (error) {
      console.error('Failed to check preview status:', error)
    }
  }

  const startPreview = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${serverUrl}/refs/${refId}/preview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      
      const data = await response.json()
      
      if (response.ok && data.success) {
        setStatus({
          running: false,
          status: 'starting',
          previewId: data.previewId
        })
        
        // Start monitoring logs
        if (data.previewId) {
          startLogStream(data.previewId)
        }
        
        // Start polling for status
        const pollInterval = setInterval(async () => {
          const statusResponse = await fetch(`${serverUrl}/refs/${refId}/preview/status`)
          if (statusResponse.ok) {
            const statusData = await statusResponse.json()
            setStatus({
              running: statusData.status === 'running',
              status: statusData.status,
              port: statusData.port,
              url: statusData.url,
              previewId: statusData.previewId
            })
            
            if (statusData.status === 'running' || statusData.status === 'error') {
              clearInterval(pollInterval)
            }
          }
        }, 1000)
        
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
      console.error('Failed to start preview:', error)
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
    setLoading(true)
    try {
      const response = await fetch(`${serverUrl}/refs/${refId}/preview/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          previewId: status.previewId 
        })
      })
      
      if (response.ok) {
        setStatus({
          running: false,
          status: 'stopped'
        })
        stopLogStream()
        return { success: true }
      } else {
        const data = await response.json()
        return { success: false, error: data.error?.message }
      }
    } catch (error) {
      console.error('Failed to stop preview:', error)
      return { success: false, error: 'Failed to stop preview' }
    } finally {
      setLoading(false)
    }
  }

  const startLogStream = (previewId: string) => {
    // Close existing stream
    stopLogStream()
    
    // Create new EventSource for SSE
    const eventSource = new EventSource(`${serverUrl}/refs/${refId}/preview/logs?previewId=${previewId}`)
    
    eventSource.addEventListener('log', (event) => {
      try {
        const log = JSON.parse(event.data) as PreviewLog
        setLogs(prev => [...prev, log])
      } catch (error) {
        console.error('Failed to parse log:', error)
      }
    })
    
    eventSource.addEventListener('status', (event) => {
      try {
        const statusUpdate = JSON.parse(event.data)
        setStatus(prev => ({
          ...prev,
          status: statusUpdate.status,
          port: statusUpdate.port,
          url: statusUpdate.url
        }))
      } catch (error) {
        console.error('Failed to parse status:', error)
      }
    })
    
    eventSource.addEventListener('error', (event) => {
      console.error('EventSource error:', event)
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

  const clearLogs = () => {
    setLogs([])
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLogStream()
    }
  }, [])

  return {
    status,
    logs,
    loading,
    startPreview,
    stopPreview,
    clearLogs,
    checkStatus
  }
}