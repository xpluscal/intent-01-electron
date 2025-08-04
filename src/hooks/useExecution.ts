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
  artifactName: string
  artifactType?: string
  readReferences: Array<{
    id: string
    name: string
    subtype?: string
    description?: string
  }>
  message: string
}

export function useExecution() {
  const [executions, setExecutions] = useState<Map<string, ExecutionStatus>>(new Map())
  const [logs, setLogs] = useState<Map<string, ExecutionLog[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map())
  const serverUrl = window.intentAPI.serverUrl // http://localhost:3456

  const startExecution = async ({ artifactId, artifactName, artifactType, readReferences, message }: StartExecutionParams) => {
    setLoading(true)
    try {
      // Build execution plan with instructions
      const readRefsSection = readReferences.length > 0 
        ? `You can read from these references:
${readReferences.map(ref => {
  let entry = `- "${ref.name}"${ref.subtype ? ` (${ref.subtype})` : ''} at: read/${ref.id}`
  if (ref.description) {
    entry += `\n  Description: ${ref.description}`
  }
  return entry
}).join('\n')}`
        : 'No read references provided.';

      const executionPlan = `${message}

You have access to modify:
- "${artifactName}"${artifactType ? ` (${artifactType})` : ''} at: mutate/${artifactId}

${readRefsSection}

IMPORTANT INSTRUCTIONS:
1. First, read ALL the provided references to understand the full context before making changes.
2. Focus on showing fast, incremental results. As you develop:
   - Update the main page/component immediately as you create new features
   - Add components one by one so the user can see progress in real-time
   - Make small, working commits rather than one large change at the end
   - If building a UI, ensure it's viewable/testable as early as possible
3. The user should be able to preview your progress throughout the development process.
4. Make very stylish greaat clean design aesthieticque outputs and really smooth minimal motion experience to get an amazing result
5. no need to run a dev server but you can run lint and build to test your build (the dev server runs automatically anyhow)
6. before completing your execution you MUST run build to make sure everythign works!! After you made fixes to it make sure to build again to verify changes!

Please read the content from the provided references and use that information to complete the user's request by making changes to the artifact "${artifactName}".`

      const response = await fetch(`${serverUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: DEFAULT_AGENT,
          prompt: executionPlan,
          refs: {
            mutate: [artifactId],
            read: readReferences.map(ref => ref.id)
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

  const startLogStream = useCallback((executionId: string) => {
    // Close existing stream
    stopLogStream(executionId)
    
    // Create new EventSource for SSE
    const eventSource = new EventSource(`${serverUrl}/logs/${executionId}`)
    
    eventSource.addEventListener('log', (event) => {
      try {
        const log = JSON.parse(event.data)
        // Log received successfully
        const executionLog: ExecutionLog = {
          timestamp: log.timestamp || new Date().toISOString(),
          type: log.type || 'info',
          content: log.content || log
        }
        setLogs(prev => {
          const newLogs = new Map(prev)
          const existingLogs = newLogs.get(executionId) || []
          newLogs.set(executionId, [...existingLogs, executionLog])
          return newLogs
        })
      } catch (error) {
        console.error('Failed to parse log:', error, event.data)
      }
    })
    
    eventSource.addEventListener('end', (event) => {
      try {
        JSON.parse(event.data)
        // Execution stream ended
        // The stream will be closed by the server, just clean up our reference
        eventSourcesRef.current.delete(executionId)
      } catch (error) {
        console.error('Failed to parse end event:', error)
      }
    })
    
    eventSource.addEventListener('error', (event) => {
      console.error('EventSource error:', event)
      if (eventSource.readyState === EventSource.CLOSED) {
        stopLogStream(executionId)
      }
    })
    
    eventSourcesRef.current.set(executionId, eventSource)
  }, [])

  const stopLogStream = useCallback((executionId: string) => {
    const eventSource = eventSourcesRef.current.get(executionId)
    if (eventSource) {
      eventSource.close()
      eventSourcesRef.current.delete(executionId)
    }
  }, [])

  const startStatusPolling = useCallback((executionId: string) => {
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
    }, 5000) // Poll every 5 seconds instead of 1 second
    
    // Store interval ID for cleanup
    // Note: In production, you'd want a more robust cleanup mechanism
  }, [])

  const getExecutionsByArtifact = useCallback(async (artifactId: string): Promise<ExecutionStatus[]> => {
    try {
      // Clear current executions and logs when switching artifacts
      setExecutions(new Map())
      setLogs(new Map())
      
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
      // We'll handle this in the component's useEffect instead to avoid circular deps
      
      return historicalExecutions
    } catch (error) {
      console.error('Failed to get executions:', error)
      return []
    }
  }, [serverUrl])

  // Clear state when changing artifacts
  const clearExecutions = useCallback(() => {
    // Close all event sources
    eventSourcesRef.current.forEach(eventSource => eventSource.close())
    eventSourcesRef.current.clear()
    // Clear state
    setExecutions(new Map())
    setLogs(new Map())
  }, [])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Close all event sources
      eventSourcesRef.current.forEach(eventSource => eventSource.close())
      eventSourcesRef.current.clear()
    }
  }, [])

  // Fetch historical logs for a specific execution
  const fetchExecutionLogs = useCallback(async (executionId: string) => {
    try {
      const response = await fetch(`${serverUrl}/executions/${executionId}/logs`)
      if (!response.ok) {
        throw new Error('Failed to fetch execution logs')
      }
      
      const data = await response.json()
      const executionLogs: ExecutionLog[] = data.logs.map((log: any) => ({
        timestamp: log.timestamp,
        type: log.type || 'info',
        content: log.content
      }))
      
      setLogs(prev => {
        const newLogs = new Map(prev)
        newLogs.set(executionId, executionLogs)
        return newLogs
      })
      
      // Note: Log streaming will be started from the component's useEffect
      // to avoid circular dependencies
    } catch (error) {
      console.error('Failed to fetch execution logs:', error)
    }
  }, [serverUrl])
  
  return {
    executions,
    logs,
    loading,
    startExecution,
    sendMessage,
    getExecutionsByArtifact,
    clearExecutions,
    fetchExecutionLogs,
    startLogStream,
    stopLogStream,
    startStatusPolling
  }
}