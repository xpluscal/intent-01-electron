import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { ScrollArea } from '../ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Plus, Trash2, FileText, Key } from 'lucide-react'
import { toast } from 'sonner'
import { useDialogKeyboard } from '@/hooks/useDialogKeyboard'
import { KeyboardHint } from '../ui/keyboard-hint'

interface EnvVariable {
  key: string
  value: string
  description?: string
}

interface EnvVariablesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  refId: string
  refName?: string
  autoShow?: boolean
  onComplete?: () => void
}

export function EnvVariablesDialog({
  open,
  onOpenChange,
  refId,
  refName,
  autoShow,
  onComplete
}: EnvVariablesDialogProps) {
  const [variables, setVariables] = useState<EnvVariable[]>([])
  const [exampleVariables, setExampleVariables] = useState<EnvVariable[]>([])
  const [bulkText, setBulkText] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasEnvExample, setHasEnvExample] = useState(false)
  const [editMode, setEditMode] = useState<'individual' | 'bulk'>('individual')

  useEffect(() => {
    if (open && refId) {
      loadEnvironmentVariables()
    }
  }, [open, refId])

  const loadEnvironmentVariables = async () => {
    setLoading(true)
    try {
      const response = await fetch(`http://localhost:3456/refs/${refId}/env`)
      if (!response.ok) {
        throw new Error('Failed to load environment variables')
      }
      
      const data = await response.json()
      setVariables(data.variables || [])
      setExampleVariables(data.exampleVariables || [])
      setHasEnvExample(data.hasEnvExample)
      
      // If no variables exist but we have examples, pre-populate with example keys
      if (data.variables.length === 0 && data.exampleVariables.length > 0 && autoShow) {
        setVariables(data.exampleVariables.map((ev: EnvVariable) => ({ key: ev.key, value: '' })))
      }
      
      // Convert variables to bulk text format
      const bulkLines = (data.variables || []).map((v: EnvVariable) => `${v.key}=${v.value}`)
      setBulkText(bulkLines.join('\n'))
    } catch (error) {
      console.error('Failed to load environment variables:', error)
      toast.error('Failed to load environment variables')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      let variablesToSave: EnvVariable[] = []
      
      if (editMode === 'bulk') {
        // Parse bulk text
        variablesToSave = parseBulkText(bulkText)
      } else {
        // Use individual variables
        variablesToSave = variables.filter(v => v.key.trim())
      }
      
      const response = await fetch(`http://localhost:3456/refs/${refId}/env`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ variables: variablesToSave })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error?.message || 'Failed to save environment variables')
      }
      
      toast.success('Environment variables saved successfully')
      onComplete?.()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save environment variables:', error)
      toast.error((error as Error).message || 'Failed to save environment variables')
    } finally {
      setSaving(false)
    }
  }

  const parseBulkText = (text: string): EnvVariable[] => {
    const lines = text.split('\n')
    const vars: EnvVariable[] = []
    
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim()
          const value = trimmed.substring(eqIndex + 1).trim()
          vars.push({ key, value })
        }
      }
    }
    
    return vars
  }

  const addVariable = () => {
    setVariables([...variables, { key: '', value: '' }])
  }

  const updateVariable = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...variables]
    updated[index] = { ...updated[index], [field]: value }
    setVariables(updated)
  }

  const removeVariable = (index: number) => {
    setVariables(variables.filter((_, i) => i !== index))
  }

  const copyFromExample = () => {
    setVariables(exampleVariables.map(ev => ({ key: ev.key, value: '' })))
    const bulkLines = exampleVariables.map(ev => `${ev.key}=`)
    setBulkText(bulkLines.join('\n'))
  }

  // Keyboard shortcuts
  useDialogKeyboard({
    isOpen: open,
    onSubmit: handleSave,
    onCancel: () => onOpenChange(false),
    isSubmitDisabled: saving
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Environment Variables{refName ? ` - ${refName}` : ''}</DialogTitle>
          <DialogDescription>
            {autoShow && hasEnvExample ? (
              <span className="text-amber-600">
                This project requires environment variables to run. Please configure them below.
              </span>
            ) : (
              'Manage environment variables for this reference. These will be saved to .env.local'
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Loading environment variables...</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              {hasEnvExample && exampleVariables.length > 0 && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Example Variables Found</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyFromExample}
                    >
                      Copy from Example
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {exampleVariables.map((ev, index) => (
                      <div key={index} className="text-xs text-muted-foreground">
                        <span className="font-mono">{ev.key}</span>
                        {ev.description && <span className="ml-2">- {ev.description}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Tabs value={editMode} onValueChange={(v) => setEditMode(v as 'individual' | 'bulk')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="individual">
                    <Key className="h-4 w-4 mr-2" />
                    Individual Variables
                  </TabsTrigger>
                  <TabsTrigger value="bulk">
                    <FileText className="h-4 w-4 mr-2" />
                    Bulk Edit
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="individual" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    {variables.map((variable, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          placeholder="VARIABLE_NAME"
                          value={variable.key}
                          onChange={(e) => updateVariable(index, 'key', e.target.value)}
                          className="font-mono text-sm w-2/5"
                        />
                        <Input
                          placeholder="value"
                          value={variable.value}
                          onChange={(e) => updateVariable(index, 'value', e.target.value)}
                          className="font-mono text-sm flex-1"
                          type="text"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeVariable(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addVariable}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Variable
                  </Button>
                </TabsContent>

                <TabsContent value="bulk" className="mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="bulk-env">Paste environment variables (KEY=value format)</Label>
                    <Textarea
                      id="bulk-env"
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      placeholder="DATABASE_URL=postgresql://...\nAPI_KEY=sk-...\nNEXT_PUBLIC_APP_URL=https://..."
                      className="font-mono text-sm min-h-[300px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      One variable per line in KEY=value format. Lines starting with # are ignored.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="flex items-center justify-between border-t pt-4 mt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <KeyboardHint keys={['⌘', 'Enter']} /> to save • <KeyboardHint keys={['Esc']} /> to cancel
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Variables'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}