import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { ExternalLink, Loader2, Check, AlertCircle, User, LogOut } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { toast } from 'sonner'

interface VercelUser {
  id: string
  email: string
  name: string
  username: string
  avatar?: string
}

interface VercelOAuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (user: VercelUser) => void
  onError: (error: string) => void
}

export function VercelOAuthDialog({ 
  open, 
  onOpenChange, 
  onSuccess, 
  onError 
}: VercelOAuthDialogProps) {
  const [loading, setLoading] = useState(false)
  const [authStep, setAuthStep] = useState<'initial' | 'authenticating' | 'success' | 'error'>('initial')
  const [authUrl, setAuthUrl] = useState<string>('')
  const [currentUser, setCurrentUser] = useState<VercelUser | null>(null)
  const [authError, setAuthError] = useState<string>('')

  const serverUrl = window.intentAPI.serverUrl

  // Check authentication status when dialog opens
  useEffect(() => {
    if (open) {
      checkAuthStatus()
    }
  }, [open])

  const checkAuthStatus = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${serverUrl}/auth/vercel/status`)
      const data = await response.json()
      
      if (data.authenticated && data.user) {
        setCurrentUser(data.user)
        setAuthStep('success')
      } else {
        setCurrentUser(null)
        setAuthStep('initial')
      }
    } catch (error) {
      console.error('Failed to check auth status:', error)
      setAuthStep('initial')
    } finally {
      setLoading(false)
    }
  }

  const initiateOAuth = async () => {
    try {
      setLoading(true)
      setAuthStep('authenticating')
      setAuthError('')
      
      const response = await fetch(`${serverUrl}/auth/vercel/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      
      const data = await response.json()
      
      if (data.success && data.authUrl) {
        setAuthUrl(data.authUrl)
        
        // Open OAuth URL in external browser
        window.open(data.authUrl, '_blank')
        
        // Start polling for completion
        pollForCompletion()
      } else {
        throw new Error(data.error?.message || 'Failed to initiate OAuth')
      }
    } catch (error) {
      console.error('Failed to initiate OAuth:', error)
      setAuthError(error.message || 'Failed to start authentication')
      setAuthStep('error')
      onError(error.message || 'Failed to start authentication')
    } finally {
      setLoading(false)
    }
  }

  const pollForCompletion = () => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${serverUrl}/auth/vercel/status`)
        const data = await response.json()
        
        if (data.authenticated && data.user) {
          clearInterval(pollInterval)
          setCurrentUser(data.user)
          setAuthStep('success')
          
          toast.success('Successfully connected to Vercel!', {
            description: `Logged in as ${data.user.name || data.user.username}`
          })
          
          onSuccess(data.user)
        }
      } catch (error) {
        console.error('Polling error:', error)
        // Continue polling on error
      }
    }, 2000) // Poll every 2 seconds

    // Stop polling after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval)
      if (authStep === 'authenticating') {
        setAuthError('Authentication timed out. Please try again.')
        setAuthStep('error')
      }
    }, 300000)
  }

  const disconnect = async () => {
    try {
      setLoading(true)
      
      const response = await fetch(`${serverUrl}/auth/vercel/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      
      const data = await response.json()
      
      if (data.success) {
        setCurrentUser(null)
        setAuthStep('initial')
        
        toast.success('Disconnected from Vercel')
      } else {
        throw new Error(data.error?.message || 'Failed to disconnect')
      }
    } catch (error) {
      console.error('Failed to disconnect:', error)
      toast.error('Failed to disconnect from Vercel')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    // Reset state when closing
    setTimeout(() => {
      setAuthStep('initial')
      setAuthError('')
      setAuthUrl('')
    }, 300)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 22.525H0L12 1.475l12 21.05z"/>
            </svg>
            Connect to Vercel
          </DialogTitle>
          <DialogDescription>
            {authStep === 'initial' && "Connect your Vercel account to deploy your projects directly from this app."}
            {authStep === 'authenticating' && "Complete the authentication in your browser, then return here."}
            {authStep === 'success' && "Your Vercel account is connected and ready for deployments."}
            {authStep === 'error' && "Authentication failed. You can try again below."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Initial State */}
          {authStep === 'initial' && (
            <div className="space-y-4">
              <div className="text-center p-6 border-2 border-dashed border-muted rounded-lg">
                <User className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No Vercel account connected
                </p>
              </div>
              
              <Button 
                onClick={initiateOAuth} 
                disabled={loading}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Connect Vercel Account
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Authenticating State */}
          {authStep === 'authenticating' && (
            <div className="space-y-4">
              <div className="text-center p-6 border-2 border-dashed border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 rounded-lg">
                <Loader2 className="h-8 w-8 mx-auto mb-2 text-blue-600 animate-spin" />
                <p className="text-sm font-medium">Waiting for authentication...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Please complete the login in your browser
                </p>
              </div>

              {authUrl && (
                <Button 
                  variant="outline" 
                  onClick={() => window.open(authUrl, '_blank')}
                  className="w-full"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Reopen Authentication Page
                </Button>
              )}

              <Button 
                variant="ghost" 
                onClick={() => setAuthStep('initial')}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          )}

          {/* Success State */}
          {authStep === 'success' && currentUser && (
            <div className="space-y-4">
              <div className="text-center p-6 border-2 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 rounded-lg">
                <Check className="h-8 w-8 mx-auto mb-2 text-green-600" />
                <p className="text-sm font-medium">Connected Successfully!</p>
                
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    {currentUser.avatar && (
                      <img 
                        src={currentUser.avatar} 
                        alt={currentUser.name}
                        className="h-6 w-6 rounded-full"
                      />
                    )}
                    <span className="text-sm font-medium">{currentUser.name || currentUser.username}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {currentUser.email}
                  </Badge>
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleClose}
                  className="flex-1"
                >
                  Done
                </Button>
                <Button 
                  variant="outline"
                  onClick={disconnect}
                  disabled={loading}
                  size="icon"
                  title="Disconnect"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Error State */}
          {authStep === 'error' && (
            <div className="space-y-4">
              <div className="text-center p-6 border-2 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 rounded-lg">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-600" />
                <p className="text-sm font-medium">Authentication Failed</p>
                {authError && (
                  <p className="text-xs text-muted-foreground mt-1">{authError}</p>
                )}
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={initiateOAuth} 
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    'Try Again'
                  )}
                </Button>
                <Button 
                  variant="outline"
                  onClick={handleClose}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}