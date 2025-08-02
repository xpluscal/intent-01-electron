import { ServerStatus } from './ServerStatus'
import { ServerActions } from './ServerActions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Separator } from '../ui/separator'

export function SettingsView() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your Intent server configuration and workspace settings.
        </p>
      </div>
      
      <Separator />
      
      <div className="space-y-6">
        <ServerStatus />
        <ServerActions />
        
        <Card>
          <CardHeader>
            <CardTitle>Workspace Configuration</CardTitle>
            <CardDescription>
              Configure your workspace settings and preferences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-1">Workspace Path</h4>
                <p className="text-sm text-muted-foreground">
                  ~/Library/Application Support/intent-01/intent-workspace
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-1">Database Location</h4>
                <p className="text-sm text-muted-foreground">
                  ~/Library/Application Support/intent-01/intent-workspace/data/agent-wrapper.db
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}