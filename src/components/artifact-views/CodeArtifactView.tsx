import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Code2, X, BookOpen } from 'lucide-react'
import { projectManager } from '@/lib/projectManager'
import { Reference } from '@/types/projects'

interface CodeArtifactViewProps {
  refId: string
  refName: string
  onClose?: () => void
}

export function CodeArtifactView({ refId, refName, onClose }: CodeArtifactViewProps) {
  const [readReferences, setReadReferences] = useState<Reference[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadReadReferences()
  }, [refId])

  const loadReadReferences = async () => {
    try {
      const refs = await projectManager.getReadReferences(refId)
      setReadReferences(refs)
    } catch (error) {
      console.error('Failed to load read references:', error)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4" />
              <h2 className="text-base font-semibold">{refName}</h2>
            </div>
            {readReferences.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Uses:</span>
                <div className="flex items-center gap-1">
                  {readReferences.slice(0, 3).map(ref => (
                    <Badge key={ref.id} variant="secondary" className="text-xs">
                      {ref.name}
                    </Badge>
                  ))}
                  {readReferences.length > 3 && (
                    <Badge variant="secondary" className="text-xs">
                      +{readReferences.length - 3}
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
          {onClose && (
            <Button 
              onClick={onClose} 
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        {/* Placeholder Content */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Code2 className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-medium mb-2">Code Artifact View</h3>
            <p className="text-muted-foreground mb-4">
              Specialized view for code artifacts
            </p>
            <p className="text-sm text-muted-foreground">
              Coming soon with enhanced features
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}