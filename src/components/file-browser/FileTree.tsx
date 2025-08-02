import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, File, Folder, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { useFileSystem } from '@/hooks/useFileSystem'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

interface FileTreeProps {
  onSelectFile: (path: string) => void
  selectedFile: string | null
}

export function FileTree({ onSelectFile, selectedFile }: FileTreeProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const { buildFileTree, isLoading } = useFileSystem()

  useEffect(() => {
    loadFileTree()
  }, [])

  const loadFileTree = async () => {
    const tree = await buildFileTree('refs')
    setFileTree(tree)
    // Auto-expand first level
    tree.forEach(node => {
      if (node.type === 'directory') {
        setExpandedNodes(prev => new Set(prev).add(node.path))
      }
    })
  }

  const toggleExpanded = (path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const renderNode = (node: FileNode, depth = 0) => {
    const isExpanded = expandedNodes.has(node.path)
    const isSelected = selectedFile === node.path

    return (
      <div key={node.path}>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'w-full justify-start px-2 py-1 h-7 font-normal',
            isSelected && 'bg-accent',
            depth > 0 && 'ml-4'
          )}
          onClick={() => {
            if (node.type === 'directory') {
              toggleExpanded(node.path)
            } else {
              onSelectFile(node.path)
            }
          }}
        >
          {node.type === 'directory' && (
            <span className="mr-1">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </span>
          )}
          {node.type === 'directory' ? (
            <Folder className="h-3 w-3 mr-2" />
          ) : (
            <File className="h-3 w-3 mr-2" />
          )}
          <span className="truncate">{node.name}</span>
        </Button>
        
        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (fileTree.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No references found
      </div>
    )
  }

  return (
    <div className="p-2">
      {fileTree.map(node => renderNode(node))}
    </div>
  )
}