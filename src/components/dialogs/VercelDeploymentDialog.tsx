import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Separator } from '../ui/separator'
import { Upload, Loader2, Check, AlertCircle, ExternalLink, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui/tabs'
import { toast } from 'sonner'
import { VercelOAuthDialog } from './VercelOAuthDialog'

interface EnvironmentVariable {
  key: string
  value: string
  target: ('production' | 'preview' | 'development')[]
  type: 'plain' | 'secret'
}

interface VercelUser {
  id: string
  email: string
  name: string
  username: string
  avatar?: string
}

interface VercelDeployment {
  id: string
  url: string
  state: 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'QUEUED'
  createdAt: Date
}

interface VercelDeploymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  refId: string
  refName: string
}

export function VercelDeploymentDialog({ 
  open, 
  onOpenChange, 
  refId, 
  refName 
}: VercelDeploymentDialogProps) {
  const [activeTab, setActiveTab] = useState('setup')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<VercelUser | null>(null)
  const [showOAuthDialog, setShowOAuthDialog] = useState(false)
  
  // Project Configuration
  const [projectName, setProjectName] = useState(refName.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
  const [framework, setFramework] = useState<string>('')
  const [buildCommand, setBuildCommand] = useState('')
  const [outputDirectory, setOutputDirectory] = useState('')
  const [installCommand, setInstallCommand] = useState('')
  const [devCommand, setDevCommand] = useState('')
  
  // Environment Variables
  const [envVars, setEnvVars] = useState<EnvironmentVariable[]>([])
  const [showValues, setShowValues] = useState<Record<number, boolean>>({})
  
  // Git Repository
  const [, ] = useState('')
  const [, ] = useState<'github' | 'gitlab' | 'bitbucket'>('github')
  const [isPrivate, ] = useState(false)
  
  // Deployment
  const [deployment, setDeployment] = useState<VercelDeployment | null>(null)
  const [deploymentStep, setDeploymentStep] = useState<'idle' | 'creating-repo' | 'pushing-code' | 'creating-project' | 'deploying' | 'complete' | 'error'>('idle')
  const [deploymentError, setDeploymentError] = useState('')

  const serverUrl = window.intentAPI.serverUrl

  // Check authentication status when dialog opens
  useEffect(() => {
    if (open) {
      console.log('VercelDeploymentDialog opened for:', refId, refName); // Debug log
      checkAuthStatus()
    }
  }, [open])

  const checkAuthStatus = async () => {
    try {
      const response = await fetch(`${serverUrl}/auth/vercel/status`)
      const data = await response.json()
      
      if (data.authenticated && data.user) {
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error('Failed to check auth status:', error)
      setUser(null)
    }
  }

  const handleAuthSuccess = (authUser: VercelUser) => {
    setUser(authUser)
    setShowOAuthDialog(false)
    toast.success('Connected to Vercel successfully!')
  }

  const addEnvironmentVariable = () => {
    setEnvVars([...envVars, {
      key: '',
      value: '',
      target: ['production'],
      type: 'plain'
    }])
  }

  const updateEnvironmentVariable = (index: number, field: keyof EnvironmentVariable, value: any) => {
    const updated = [...envVars]
    updated[index] = { ...updated[index], [field]: value }
    setEnvVars(updated)
  }

  const removeEnvironmentVariable = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index))
    const newShowValues = { ...showValues }
    delete newShowValues[index]
    setShowValues(newShowValues)
  }

  const toggleShowValue = (index: number) => {
    setShowValues(prev => ({
      ...prev,
      [index]: !prev[index]
    }))
  }

  const startDeployment = async () => {
    if (!user) {
      setShowOAuthDialog(true)
      return
    }

    try {
      setLoading(true)
      setActiveTab('deploy')
      setDeploymentStep('creating-repo')
      setDeploymentError('')

      console.log('Starting deployment with:', {
        projectName,
        framework,
        envVars: envVars.length,
        refId,
        refName
      });

      // Use our comprehensive deploy endpoint that handles everything
      const deployResponse = await fetch(`${serverUrl}/deploy/vercel/${refId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName,
          framework: framework === 'auto' ? undefined : framework,
          environmentVariables: envVars.filter(env => env.key && env.value),
          isPrivate: isPrivate,
          buildCommand: buildCommand || undefined,
          outputDirectory: outputDirectory || undefined,
          installCommand: installCommand || undefined,
          devCommand: devCommand || undefined
          // Note: GitHub token should be set as environment variable on the server
        })
      })

      const deployData = await deployResponse.json()
      
      if (!deployData.success) {
        throw new Error(deployData.error?.message || 'Failed to deploy to Vercel')
      }

      // Update UI based on deployment progress
      setDeploymentStep('pushing-code')
      await new Promise(resolve => setTimeout(resolve, 500))
      
      setDeploymentStep('creating-project')
      await new Promise(resolve => setTimeout(resolve, 500))
      
      setDeploymentStep('deploying')
      await new Promise(resolve => setTimeout(resolve, 500))

      setDeployment(deployData.deployment)
      setDeploymentStep('complete')

      toast.success('Deployment created successfully!', {
        description: 'Your project is now being built on Vercel.',
        action: {
          label: 'View Deployment',
          onClick: () => window.open(deployData.deployment.url, '_blank')
        }
      })

    } catch (error) {
      console.error('Deployment failed:', error)
      setDeploymentError((error as Error).message || 'Deployment failed')
      setDeploymentStep('error')
      toast.error('Deployment failed', {
        description: (error as Error).message || 'An unexpected error occurred'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    // Reset state when closing
    setTimeout(() => {
      setActiveTab('setup')
      setDeploymentStep('idle')
      setDeployment(null)
      setDeploymentError('')
    }, 300)
  }

  const frameworks = [
    { value: 'auto', label: 'Auto-detect' },
    { value: 'nextjs', label: 'Next.js' },
    { value: 'vite', label: 'Vite' },
    { value: 'nuxtjs', label: 'Nuxt.js' },
    { value: 'astro', label: 'Astro' },
    { value: 'svelte-kit', label: 'SvelteKit' },
    { value: 'remix', label: 'Remix' },
    { value: 'create-react-app', label: 'Create React App' },
    { value: 'vue', label: 'Vue.js' },
    { value: 'angular', label: 'Angular' },
    { value: 'static', label: 'Static HTML' }
  ]

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 22.525H0L12 1.475l12 21.05z"/>
              </svg>
              Deploy to Vercel
            </DialogTitle>
            <DialogDescription>
              Deploy "{refName}" to Vercel with automated builds and preview deployments.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="environment">Environment</TabsTrigger>
              <TabsTrigger value="deploy">Deploy</TabsTrigger>
            </TabsList>

            {/* Setup Tab */}
            <TabsContent value="setup" className="space-y-4">
              {!user && (
                <div className="p-4 border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium">Authentication Required</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    You need to connect your Vercel account before deploying.
                  </p>
                  <Button 
                    onClick={() => setShowOAuthDialog(true)}
                    size="sm"
                    variant="outline"
                  >
                    Connect Vercel Account
                  </Button>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <Label htmlFor="projectName">Project Name</Label>
                  <Input
                    id="projectName"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="my-awesome-project"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    This will be your project name on Vercel
                  </p>
                </div>

                <div>
                  <Label htmlFor="framework">Framework</Label>
                  <Select value={framework} onValueChange={setFramework}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select framework" />
                    </SelectTrigger>
                    <SelectContent>
                      {frameworks.map(fw => (
                        <SelectItem key={fw.value} value={fw.value}>
                          {fw.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="buildCommand">Build Command</Label>
                    <Input
                      id="buildCommand"
                      value={buildCommand}
                      onChange={(e) => setBuildCommand(e.target.value)}
                      placeholder="npm run build"
                    />
                  </div>
                  <div>
                    <Label htmlFor="outputDirectory">Output Directory</Label>
                    <Input
                      id="outputDirectory"
                      value={outputDirectory}
                      onChange={(e) => setOutputDirectory(e.target.value)}
                      placeholder="dist"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="installCommand">Install Command</Label>
                    <Input
                      id="installCommand"
                      value={installCommand}
                      onChange={(e) => setInstallCommand(e.target.value)}
                      placeholder="npm install"
                    />
                  </div>
                  <div>
                    <Label htmlFor="devCommand">Dev Command</Label>
                    <Input
                      id="devCommand"
                      value={devCommand}
                      onChange={(e) => setDevCommand(e.target.value)}
                      placeholder="npm run dev"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Environment Tab */}
            <TabsContent value="environment" className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Environment Variables</h3>
                  <p className="text-xs text-muted-foreground">
                    Configure environment variables for your deployment
                  </p>
                </div>
                <Button onClick={addEnvironmentVariable} size="sm" variant="outline">
                  <Plus className="h-3 w-3 mr-1" />
                  Add Variable
                </Button>
              </div>

              <div className="space-y-3">
                {envVars.map((envVar, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-3">
                      <Input
                        placeholder="KEY"
                        value={envVar.key}
                        onChange={(e) => updateEnvironmentVariable(index, 'key', e.target.value)}
                      />
                    </div>
                    <div className="col-span-4 relative">
                      <Input
                        type={showValues[index] ? 'text' : 'password'}
                        placeholder="value"
                        value={envVar.value}
                        onChange={(e) => updateEnvironmentVariable(index, 'value', e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-6 w-6"
                        onClick={() => toggleShowValue(index)}
                      >
                        {showValues[index] ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <div className="col-span-2">
                      <Select 
                        value={envVar.type} 
                        onValueChange={(value: 'plain' | 'secret') => updateEnvironmentVariable(index, 'type', value)}
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="plain">Plain</SelectItem>
                          <SelectItem value="secret">Secret</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Select 
                        value={envVar.target.join(',')} 
                        onValueChange={(value) => updateEnvironmentVariable(index, 'target', value.split(','))}
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="production">Production</SelectItem>
                          <SelectItem value="preview">Preview</SelectItem>
                          <SelectItem value="development">Development</SelectItem>
                          <SelectItem value="production,preview,development">All</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1">
                      <Button
                        onClick={() => removeEnvironmentVariable(index)}
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}

                {envVars.length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      No environment variables configured
                    </p>
                    <Button 
                      onClick={addEnvironmentVariable} 
                      size="sm" 
                      variant="outline" 
                      className="mt-2"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Your First Variable
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Deploy Tab */}
            <TabsContent value="deploy" className="space-y-4">
              {deploymentStep === 'idle' && (
                <div className="space-y-4">
                  <div className="text-center p-6 border-2 border-dashed border-muted rounded-lg">
                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm font-medium">Ready to Deploy</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Project: {projectName}
                    </p>
                    {framework && (
                      <Badge variant="secondary" className="mt-2">
                        {frameworks.find(f => f.value === framework)?.label}
                      </Badge>
                    )}
                  </div>

                  <Button 
                    onClick={startDeployment} 
                    disabled={loading || !user || !projectName}
                    className="w-full"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Deploy to Vercel
                      </>
                    )}
                  </Button>
                </div>
              )}

              {deploymentStep !== 'idle' && deploymentStep !== 'complete' && deploymentStep !== 'error' && (
                <div className="space-y-4">
                  <div className="text-center p-6 border-2 border-dashed border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 rounded-lg">
                    <Loader2 className="h-8 w-8 mx-auto mb-2 text-blue-600 animate-spin" />
                    <p className="text-sm font-medium">
                      {deploymentStep === 'creating-repo' && 'Creating repository...'}
                      {deploymentStep === 'pushing-code' && 'Pushing code to repository...'}
                      {deploymentStep === 'creating-project' && 'Creating Vercel project...'}
                      {deploymentStep === 'deploying' && 'Starting deployment...'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This may take a few moments
                    </p>
                  </div>
                </div>
              )}

              {deploymentStep === 'complete' && deployment && (
                <div className="space-y-4">
                  <div className="text-center p-6 border-2 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 rounded-lg">
                    <Check className="h-8 w-8 mx-auto mb-2 text-green-600" />
                    <p className="text-sm font-medium">Deployment Started!</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your project is now building on Vercel
                    </p>
                    
                    <div className="mt-4 space-y-2">
                      <Badge variant="secondary" className="text-xs">
                        {deployment.state}
                      </Badge>
                      <div className="text-xs text-muted-foreground">
                        Deployment URL: {deployment.url}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button 
                      onClick={() => window.open(deployment.url, '_blank')}
                      className="flex-1"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Deployment
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={handleClose}
                      className="flex-1"
                    >
                      Done
                    </Button>
                  </div>
                </div>
              )}

              {deploymentStep === 'error' && (
                <div className="space-y-4">
                  <div className="text-center p-6 border-2 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 rounded-lg">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-600" />
                    <p className="text-sm font-medium">Deployment Failed</p>
                    {deploymentError && (
                      <p className="text-xs text-muted-foreground mt-1">{deploymentError}</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button 
                      onClick={startDeployment} 
                      disabled={loading}
                      className="flex-1"
                    >
                      Try Again
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => setActiveTab('setup')}
                      className="flex-1"
                    >
                      Back to Setup
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <VercelOAuthDialog
        open={showOAuthDialog}
        onOpenChange={setShowOAuthDialog}
        onSuccess={handleAuthSuccess}
        onError={(error) => {
          console.error('OAuth error:', error)
          toast.error('Authentication failed', { description: error })
        }}
      />
    </>
  )
}