import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { ExternalLink, Loader2, Check, AlertCircle, Copy, Github, RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { toast } from 'sonner'

interface GitInfo {
  hasRemote: boolean
  remoteUrl: string
  currentBranch: string
  needsCommit: boolean
  needsPush: boolean
}

interface EnvVar {
  key: string
  value: string
}

interface DeploymentInfo {
  success: boolean
  refId: string
  git: GitInfo
  environmentVariables: EnvVar[]
  vercelImportUrl: string
  suggestedProjectName: string
  instructions: {
    hasRemote: boolean
    nextSteps: string[]
  }
}

interface VercelDeployGuideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  refId: string
  refName: string
}

export function VercelDeployGuideDialog({ 
  open, 
  onOpenChange, 
  refId, 
  refName 
}: VercelDeployGuideDialogProps) {
  const [loading, setLoading] = useState(false)
  const [deploymentInfo, setDeploymentInfo] = useState<DeploymentInfo | null>(null)
  const [error, setError] = useState<string>('')

  const serverUrl = window.intentAPI.serverUrl

  // Prepare deployment when dialog opens
  useEffect(() => {
    if (open) {
      console.log('VercelDeployGuideDialog opened for:', refId, refName)
      prepareDeployment()
    }
  }, [open])

  const prepareDeployment = async () => {
    try {
      setLoading(true)
      setError('')
      
      const response = await fetch(`${serverUrl}/deploy/prepare/${refId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      
      const data = await response.json()
      
      if (data.success) {
        setDeploymentInfo(data)
      } else {
        throw new Error(data.error?.message || 'Failed to prepare deployment')
      }
    } catch (error) {
      console.error('Failed to prepare deployment:', error)
      setError(error.message || 'Failed to prepare deployment')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`Copied ${label}!`)
    } catch (error) {
      toast.error('Failed to copy to clipboard')
    }
  }

  const copyAllEnvVars = async () => {
    if (!deploymentInfo?.environmentVariables.length) return
    
    const envText = deploymentInfo.environmentVariables
      .map(env => `${env.key}=${env.value}`)
      .join('\n')
    
    await copyToClipboard(envText, 'all environment variables')
  }

  const openVercelImport = () => {
    if (deploymentInfo?.vercelImportUrl) {
      window.open(deploymentInfo.vercelImportUrl, '_blank')
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    // Reset state when closing
    setTimeout(() => {
      setDeploymentInfo(null)
      setError('')
    }, 300)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 22.525H0L12 1.475l12 21.05z"/>
            </svg>
            Deploy "{refName}" to Vercel
          </DialogTitle>
          <DialogDescription>
            Follow these simple steps to deploy your project to Vercel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Loading State */}
          {loading && (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin" />
              <p className="text-sm text-muted-foreground">Preparing deployment...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="p-4 border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-red-800 dark:text-red-200">Preparation Failed</span>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
              <Button 
                onClick={prepareDeployment} 
                size="sm" 
                variant="outline" 
                className="mt-2"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Try Again
              </Button>
            </div>
          )}

          {/* Success State */}
          {deploymentInfo && (
            <>
              {/* Step 1: Git Repository Status */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Github className="h-4 w-4" />
                  Step 1: Git Repository
                </h3>
                
                {deploymentInfo.git.hasRemote ? (
                  <div className="p-4 border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-800 dark:text-green-200">Repository Ready!</span>
                    </div>
                    <div className="space-y-1 text-xs text-green-700 dark:text-green-300">
                      <div className="flex items-center justify-between">
                        <span>Repository: {deploymentInfo.git.remoteUrl}</span>
                        <Button
                          onClick={() => copyToClipboard(deploymentInfo.git.remoteUrl, 'repository URL')}
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <div>Branch: {deploymentInfo.git.currentBranch}</div>
                      <div>✅ Latest changes pushed to remote</div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      <span className="text-sm font-medium text-amber-800 dark:text-amber-200">Manual Setup Required</span>
                    </div>
                    <div className="space-y-3 text-xs text-amber-700 dark:text-amber-300">
                      {deploymentInfo.git.remoteUrl && (
                        <div className="mb-3">
                          <p className="font-medium mb-1">Create this repository on GitHub:</p>
                          <div className="flex items-center justify-between bg-amber-100 dark:bg-amber-900/50 rounded p-2">
                            <code className="text-xs">{deploymentInfo.git.remoteUrl.replace('.git', '')}</code>
                            <Button
                              onClick={() => {
                                const repoUrl = deploymentInfo.git.remoteUrl.replace('.git', '').replace('https://github.com/', '');
                                window.open(`https://github.com/new?name=${repoUrl.split('/')[1]}`, '_blank');
                              }}
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 ml-2"
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Create
                            </Button>
                          </div>
                        </div>
                      )}
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        {deploymentInfo.instructions.nextSteps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Environment Variables */}
              {deploymentInfo.environmentVariables.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Step 2: Environment Variables</h3>
                    <Button 
                      onClick={copyAllEnvVars}
                      size="sm" 
                      variant="outline"
                      className="text-xs"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy All
                    </Button>
                  </div>
                  
                  <div className="space-y-2">
                    {deploymentInfo.environmentVariables.map((env, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-muted rounded border">
                        <code className="text-xs font-mono flex-1">
                          <span className="text-blue-600 dark:text-blue-400">{env.key}</span>
                          <span className="text-muted-foreground">=</span>
                          <span className="text-green-600 dark:text-green-400">{env.value}</span>
                        </code>
                        <Button
                          onClick={() => copyToClipboard(`${env.key}=${env.value}`, env.key)}
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 ml-2"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    💡 Copy these variables and paste them in Vercel's environment variables section
                  </p>
                </div>
              )}

              {/* Step 3: Deploy to Vercel */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium">
                  Step {deploymentInfo.environmentVariables.length > 0 ? '3' : '2'}: Deploy to Vercel
                </h3>
                
                <div className="p-4 border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 rounded-lg">
                  <div className="space-y-3">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      Click the button below to open Vercel with your repository pre-filled:
                    </p>
                    
                    <Button 
                      onClick={openVercelImport}
                      disabled={!deploymentInfo.git.hasRemote}
                      className="w-full"
                      size="lg"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open Vercel Import
                    </Button>
                    
                    {deploymentInfo.environmentVariables.length > 0 && (
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        📋 Don't forget to paste your environment variables in Vercel!
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Project Info */}
              <div className="pt-4 border-t">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Suggested project name: <code>{deploymentInfo.suggestedProjectName}</code></span>
                  <Badge variant="secondary" className="text-xs">
                    {deploymentInfo.environmentVariables.length} env vars
                  </Badge>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button 
                  onClick={handleClose}
                  variant="outline"
                  className="flex-1"
                >
                  Close
                </Button>
                {deploymentInfo.git.hasRemote && (
                  <Button 
                    onClick={openVercelImport}
                    className="flex-1"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Deploy Now
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}