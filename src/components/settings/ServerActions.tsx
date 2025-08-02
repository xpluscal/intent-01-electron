import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Play, Square, RotateCw, Loader2 } from 'lucide-react'
import { useServerStatus } from '@/hooks/useServerStatus'
import { toast } from 'sonner'

export function ServerActions() {
  const { status, refresh } = useServerStatus()
  const [loading, setLoading] = useState<string | null>(null)

  const handleStart = async () => {
    setLoading('start')
    try {
      // TODO: Implement server start via IPC
      toast.success('Server started successfully')
      await refresh()
    } catch (error) {
      toast.error('Failed to start server')
      console.error(error)
    } finally {
      setLoading(null)
    }
  }

  const handleStop = async () => {
    setLoading('stop')
    try {
      // TODO: Implement server stop via IPC
      toast.success('Server stopped successfully')
      await refresh()
    } catch (error) {
      toast.error('Failed to stop server')
      console.error(error)
    } finally {
      setLoading(null)
    }
  }

  const handleRestart = async () => {
    setLoading('restart')
    try {
      // TODO: Implement server restart via IPC
      toast.success('Server restarted successfully')
      await refresh()
    } catch (error) {
      toast.error('Failed to restart server')
      console.error(error)
    } finally {
      setLoading(null)
    }
  }

  const isRunning = status?.running

  return (
    <Card>
      <CardHeader>
        <CardTitle>Server Controls</CardTitle>
        <CardDescription>
          Start, stop, or restart the Intent server
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Button
            onClick={handleStart}
            disabled={isRunning || loading !== null}
            variant="default"
            size="sm"
          >
            {loading === 'start' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Start
          </Button>
          
          <Button
            onClick={handleStop}
            disabled={!isRunning || loading !== null}
            variant="destructive"
            size="sm"
          >
            {loading === 'stop' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Square className="h-4 w-4 mr-2" />
            )}
            Stop
          </Button>
          
          <Button
            onClick={handleRestart}
            disabled={!isRunning || loading !== null}
            variant="outline"
            size="sm"
          >
            {loading === 'restart' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4 mr-2" />
            )}
            Restart
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}