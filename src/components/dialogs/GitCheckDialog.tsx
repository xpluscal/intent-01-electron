import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { AlertCircle, CheckCircle, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface GitCheckDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GitCheckDialog({ open, onOpenChange }: GitCheckDialogProps) {
  const [checking, setChecking] = useState(true)
  const [gitInstalled, setGitInstalled] = useState(false)
  const [gitVersion, setGitVersion] = useState('')
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (open) {
      checkGit()
    }
  }, [open])

  const checkGit = async () => {
    setChecking(true)
    try {
      const result = await window.intentAPI.checkGit()
      setGitInstalled(result.installed)
      if (result.version) {
        setGitVersion(result.version)
      }
    } catch (error) {
      console.error('Failed to check Git:', error)
      setGitInstalled(false)
    } finally {
      setChecking(false)
    }
  }

  const handleInstallGit = async () => {
    setInstalling(true)
    try {
      const result = await window.intentAPI.installGit()
      if (result.success) {
        toast.info(result.message)
        // Close dialog after showing message
        setTimeout(() => {
          onOpenChange(false)
        }, 2000)
      } else {
        toast.error(result.message || 'Failed to initiate Git installation')
      }
    } catch (error) {
      console.error('Failed to install Git:', error)
      toast.error('Failed to initiate Git installation')
    } finally {
      setInstalling(false)
    }
  }

  const handleContinueWithoutGit = () => {
    toast.warning('Some features may not work without Git installed')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Git Installation Check</DialogTitle>
          <DialogDescription>
            Intent Worker requires Git for version control features
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {checking ? (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Checking for Git installation...</span>
            </div>
          ) : gitInstalled ? (
            <div className="flex items-center gap-3 py-4">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium">Git is installed</p>
                <p className="text-xs text-muted-foreground">{gitVersion}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <div>
                  <p className="text-sm font-medium">Git is not installed</p>
                  <p className="text-xs text-muted-foreground">
                    Git is required for version control features
                  </p>
                </div>
              </div>
              
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">
                  Without Git, you won't be able to:
                </p>
                <ul className="mt-1 text-xs text-muted-foreground list-disc list-inside">
                  <li>Track changes in your references and artifacts</li>
                  <li>Create version history</li>
                  <li>Use the Intent CLI execution features</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {gitInstalled ? (
            <Button onClick={() => onOpenChange(false)}>
              Continue
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleContinueWithoutGit}
                disabled={installing}
              >
                Continue Without Git
              </Button>
              <Button
                onClick={handleInstallGit}
                disabled={installing}
              >
                {installing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Install Git
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}