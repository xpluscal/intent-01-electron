import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { useServerStatus } from '@/hooks/useServerStatus'

export function ServerStatus() {
  const { status, isLoading, error } = useServerStatus()
  const [healthCheck, setHealthCheck] = useState<any>(null)

  useEffect(() => {
    if (status?.running) {
      checkHealth()
    }
  }, [status?.running])

  const checkHealth = async () => {
    if (!status?.running) return
    
    try {
      const response = await fetch(`${window.intentAPI.serverUrl}/health`)
      const data = await response.json()
      setHealthCheck(data)
    } catch (err) {
      console.error('Health check failed:', err)
      setHealthCheck(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Server Status</CardTitle>
            <CardDescription>
              Intent server status and health information
            </CardDescription>
          </div>
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : status?.running ? (
            <Badge variant="default" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              Running
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              Stopped
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {error && (
            <div className="text-sm text-destructive">
              Error: {error}
            </div>
          )}
          
          {status && (
            <div className="grid gap-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium">Port:</span>
                <span className="text-sm text-muted-foreground">
                  {status.port || 'N/A'}
                </span>
              </div>
              
              {healthCheck && (
                <>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Version:</span>
                    <span className="text-sm text-muted-foreground">
                      {healthCheck.version}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Last Check:</span>
                    <span className="text-sm text-muted-foreground">
                      {new Date(healthCheck.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}