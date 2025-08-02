import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { Badge } from '../ui/badge'
import { Loader2 } from 'lucide-react'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [serverStatus, setServerStatus] = useState<{ running: boolean; port: number | null }>({ running: false, port: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (open) {
      checkServerStatus()
    }
  }, [open])

  const checkServerStatus = async () => {
    setLoading(true)
    try {
      const status = await window.intentAPI.getServerStatus()
      setServerStatus(status)
    } catch (error) {
      console.error('Failed to get server status:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your Intent workspace preferences
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Server Status */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Server Status</h3>
            <div className="rounded-lg border p-4">
              {loading ? (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Intent Server</p>
                    <p className="text-xs text-muted-foreground">
                      {serverStatus.running 
                        ? `Running on port ${serverStatus.port}` 
                        : 'Not running'}
                    </p>
                  </div>
                  <Badge variant={serverStatus.running ? 'default' : 'secondary'}>
                    {serverStatus.running ? 'Online' : 'Offline'}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Preferences */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Preferences</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-save">Auto-save files</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically save files after editing
                  </p>
                </div>
                <Switch id="auto-save" defaultChecked />
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="dark-mode">Dark mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Toggle dark mode theme
                  </p>
                </div>
                <Switch id="dark-mode" defaultChecked />
              </div>
            </div>
          </div>

          {/* Workspace Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Workspace</h3>
            <div className="rounded-lg border p-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Location</span>
                  <span className="font-mono text-xs">~/Library/Application Support/intent-01</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Version</span>
                  <span>0.0.1</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}