import { useState, useEffect, useCallback, useRef } from 'react'
import { DEFAULT_AGENT } from '@/lib/agents'

interface ExecutionStatus {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  phase?: string
  created: string
  started?: string
  completed?: string
  error?: string
  result?: any
  preview?: {
    refId: string
    refType: string
    port?: number
    url?: string
    status: string
  }
}

interface ExecutionLog {
  timestamp: string
  type: 'info' | 'error' | 'warning' | 'system' | 'assistant' | 'user' | 'result'
  content: any
}

interface StartExecutionParams {
  artifactId: string
  readReferences: string[]
  message: string
}

export function useExecution() {
  const [executions, setExecutions] = useState<Map<string, ExecutionStatus>>(new Map())
  const [logs, setLogs] = useState<Map<string, ExecutionLog[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map())
  const serverUrl = window.intentAPI.serverUrl // http://localhost:3456

  const startExecution = async ({ artifactId, readReferences, message }: StartExecutionParams) => {
    setLoading(true)
    try {
      // Build execution plan with instructions
      const executionPlan = `${message}

You have access to:
- Mutate item at: mutate/${artifactId}
${readReferences.map(ref => `- Read item at: read/${ref}`).join('\n')}

Please complete the user's request by reading from the provided references and making changes to the mutate item.`

      const response = await fetch(`${serverUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: DEFAULT_AGENT,
          prompt: executionPlan,
          refs: {
            mutate: [artifactId],
            read: readReferences
          }
        })
      })
      
      const data = await response.json()
      
      if (response.ok && data.executionId) {
        const executionId = data.executionId
        
        // Initialize execution status
        const initialStatus: ExecutionStatus = {
          id: executionId,
          status: 'pending',
          created: new Date().toISOString()
        }
        setExecutions(prev => new Map(prev).set(executionId, initialStatus))
        setLogs(prev => new Map(prev).set(executionId, []))
        
        // Start monitoring logs
        startLogStream(executionId)
        
        // Start polling for status
        startStatusPolling(executionId)
        
        return { success: true, executionId }
      } else {
        return { success: false, error: data.error?.message || 'Failed to start execution' }
      }
    } catch (error) {
      console.error('Failed to start execution:', error)
      return { success: false, error: 'Failed to start execution' }
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async (executionId: string, message: string) => {
    try {
      const response = await fetch(`${serverUrl}/message/${executionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      })
      
      const data = await response.json()
      
      if (response.ok && data.success) {
        return { success: true }
      } else {
        return { success: false, error: data.error?.message || 'Failed to send message' }
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      return { success: false, error: 'Failed to send message' }
    }
  }

  const startLogStream = (executionId: string) => {
    // Close existing stream
    stopLogStream(executionId)
    
    // Create new EventSource for SSE
    const eventSource = new EventSource(`${serverUrl}/logs/${executionId}`)
    
    eventSource.addEventListener('message', (event) => {
      try {
        const log = JSON.parse(event.data)
        const executionLog: ExecutionLog = {
          timestamp: new Date().toISOString(),
          type: log.type || 'info',
          content: log
        }
        setLogs(prev => {
          const newLogs = new Map(prev)
          const existingLogs = newLogs.get(executionId) || []
          newLogs.set(executionId, [...existingLogs, executionLog])
          return newLogs
        })
      } catch (error) {
        console.error('Failed to parse log:', error)
      }
    })
    
    eventSource.addEventListener('error', (event) => {
      console.error('EventSource error:', event)
      if (eventSource.readyState === EventSource.CLOSED) {
        stopLogStream(executionId)
      }
    })
    
    eventSourcesRef.current.set(executionId, eventSource)
  }

  const stopLogStream = (executionId: string) => {
    const eventSource = eventSourcesRef.current.get(executionId)
    if (eventSource) {
      eventSource.close()
      eventSourcesRef.current.delete(executionId)
    }
  }

  const startStatusPolling = (executionId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${serverUrl}/status/${executionId}`)
        if (response.ok) {
          const data = await response.json()
          
          const status: ExecutionStatus = {
            id: executionId,
            status: data.status,
            phase: data.phase,
            created: data.created,
            started: data.started,
            completed: data.completed,
            error: data.error,
            result: data.result,
            preview: data.previews?.[0] // Get first preview if available
          }
          
          setExecutions(prev => new Map(prev).set(executionId, status))
          
          // Stop polling if execution is done
          if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
            clearInterval(pollInterval)
            // Keep log stream open for a bit to catch final logs
            setTimeout(() => stopLogStream(executionId), 5000)
          }
        }
      } catch (error) {
        console.error('Failed to poll status:', error)
      }
    }, 1000)
    
    // Store interval ID for cleanup
    // Note: In production, you'd want a more robust cleanup mechanism
  }

  const getExecutionsByArtifact = async (artifactId: string): Promise<ExecutionStatus[]> => {
    try {
      const response = await fetch(`${serverUrl}/refs/${artifactId}/executions`)
      if (!response.ok) {
        throw new Error('Failed to fetch executions')
      }
      
      const data = await response.json()
      const historicalExecutions: ExecutionStatus[] = data.executions.map((exec: any) => ({
        id: exec.id,
        status: exec.status,
        phase: exec.phase,
        created: exec.created,
        started: exec.created, // Use created as started since we don't have started_at
        completed: exec.completed,
        error: exec.error,
        result: exec.result,
        readReferences: exec.readReferences
      }))
      
      // Update state with historical executions
      setExecutions(prev => {
        const newMap = new Map(prev)
        historicalExecutions.forEach(exec => {
          if (!newMap.has(exec.id)) {
            newMap.set(exec.id, exec)
          }
        })
        return newMap
      })
      
      // Also initialize empty logs for historical executions
      setLogs(prev => {
        const newLogs = new Map(prev)
        historicalExecutions.forEach(exec => {
          if (!newLogs.has(exec.id)) {
            newLogs.set(exec.id, [])
          }
        })
        return newLogs
      })
      
      // For active executions, start monitoring
      historicalExecutions.forEach(exec => {
        if (exec.status === 'running' || exec.status === 'pending') {
          startLogStream(exec.id)
          startStatusPolling(exec.id)
        }
      })
      
      return historicalExecutions
    } catch (error) {
      console.error('Failed to get executions:', error)
      return []
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Close all event sources
      eventSourcesRef.current.forEach(eventSource => eventSource.close())
      eventSourcesRef.current.clear()
    }
  }, [])

  return {
    executions,
    logs,
    loading,
    startExecution,
    sendMessage,
    getExecutionsByArtifact
  }
}