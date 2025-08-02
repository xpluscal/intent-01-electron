import { useState, useEffect, useCallback } from 'react'

interface ServerStatus {
  running: boolean
  port: number | null
}

export function useServerStatus() {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const result = await window.intentAPI.getServerStatus()
      setStatus(result)
    } catch (err) {
      console.error('Failed to get server status:', err)
      setError(err instanceof Error ? err.message : 'Failed to get server status')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    
    // Poll for status every 5 seconds
    const interval = setInterval(fetchStatus, 5000)
    
    return () => clearInterval(interval)
  }, [fetchStatus])

  return {
    status,
    isLoading,
    error,
    refresh: fetchStatus
  }
}