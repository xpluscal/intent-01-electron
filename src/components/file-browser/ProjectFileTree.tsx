import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, File, Folder, Briefcase, Bookmark, BookOpen, Loader2, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { useFileSystem } from '@/hooks/useFileSystem'
import { Project, Reference } from '@/types/projects'
import { projectManager } from '@/lib/projectManager'
import { ProjectFileNode } from '@/types/projects'
import { FileContextMenu } from './FileContextMenu'

interface ProjectFileTreeProps {
  projects: Project[]
  onSelectFile: (path: string) => void
  selectedFile: string | null
  showProjects: boolean
  loading?: boolean
  onRefresh?: () => void
  onCreateReference?: (projectId?: string) => void
  onMoveReference?: (refId: string, targetProjectId: string) => Promise<void>
}

export function ProjectFileTree({ 
  projects, 
  onSelectFile, 
  selectedFile,
  showProjects = true,
  loading = false,
  onRefresh,
  onCreateReference,
  onMoveReference
}: ProjectFileTreeProps) {
  const [fileTree, setFileTree] = useState<ProjectFileNode[]>([])
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const { buildFileTree } = useFileSystem()
  const [projectRefs, setProjectRefs] = useState<Map<string, Reference[]>>(new Map())
  const [draggedNode, setDraggedNode] = useState<ProjectFileNode | null>(null)
  const [dragOverNode, setDragOverNode] = useState<string | null>(null)

  useEffect(() => {
    if (showProjects) {
      loadProjectStructure()
    } else {
      loadFlatRefs()
    }
  }, [projects, showProjects])

  const loadProjectStructure = async () => {
    const tree: ProjectFileNode[] = []
    
    // Load refs for each project
    const refsMap = new Map<string, Reference[]>()
    for (const project of projects) {
      const refs = await projectManager.getProjectRefs(project.id)
      refsMap.set(project.id, refs)
    }
    setProjectRefs(refsMap)
    
    // Build project tree
    for (const project of projects) {
      const projectNode: ProjectFileNode = {
        name: project.name,
        path: `project:${project.id}`,
        type: 'directory',
        nodeType: 'project',
        projectId: project.id,
        children: [],
        metadata: {
          created: project.created,
          modified: project.modified,
          description: project.description
        }
      }
      
      // Separate refs into References and Artifacts
      const refs = refsMap.get(project.id) || []
      const references = refs.filter(r => r.type === 'reference')
      const artifacts = refs.filter(r => r.type === 'artifact')
      
      // Add References folder
      if (references.length > 0) {
        const referencesNode: ProjectFileNode = {
          name: 'References',
          path: `${projectNode.path}/references`,
          type: 'directory',
          nodeType: 'folder',
          projectId: project.id,
          children: []
        }
        
        for (const ref of references) {
          const refFiles = await buildFileTree(`refs/${ref.id}`)
          const refNode: ProjectFileNode = {
            name: ref.name,
            path: `refs/${ref.id}`,
            type: 'directory',
            nodeType: 'reference',
            projectId: project.id,
            refId: ref.id,
            children: refFiles as ProjectFileNode[],
            metadata: {
              created: ref.created,
              modified: ref.modified,
              description: ref.description
            }
          }
          referencesNode.children?.push(refNode)
        }
        
        projectNode.children?.push(referencesNode)
      }
      
      // Add Artifacts folder
      if (artifacts.length > 0) {
        const artifactsNode: ProjectFileNode = {
          name: 'Artifacts',
          path: `${projectNode.path}/artifacts`,
          type: 'directory',
          nodeType: 'folder',
          projectId: project.id,
          children: []
        }
        
        for (const ref of artifacts) {
          const refFiles = await buildFileTree(`refs/${ref.id}`)
          const refNode: ProjectFileNode = {
            name: ref.name,
            path: `refs/${ref.id}`,
            type: 'directory',
            nodeType: 'reference',
            projectId: project.id,
            refId: ref.id,
            children: refFiles as ProjectFileNode[],
            metadata: {
              created: ref.created,
              modified: ref.modified,
              description: ref.description
            }
          }
          artifactsNode.children?.push(refNode)
        }
        
        projectNode.children?.push(artifactsNode)
      }
      
      tree.push(projectNode)
      
      // Auto-expand projects and their folders
      setExpandedNodes(prev => {
        const next = new Set(prev)
        next.add(projectNode.path)
        next.add(`${projectNode.path}/references`)
        next.add(`${projectNode.path}/artifacts`)
        return next
      })
    }
    
    setFileTree(tree)
  }

  const loadFlatRefs = async () => {
    const refs = await window.intentAPI.scanRefs()
    const tree: ProjectFileNode[] = []
    
    for (const ref of refs) {
      const refFiles = await buildFileTree(`refs/${ref.id}`)
      const metadata = await projectManager.loadRefMetadata(ref.id)
      
      const refNode: ProjectFileNode = {
        name: ref.name,
        path: `refs/${ref.id}`,
        type: 'directory',
        nodeType: 'reference',
        refId: ref.id,
        children: refFiles as ProjectFileNode[],
        metadata: metadata?.reference ? {
          created: metadata.reference.created,
          modified: metadata.reference.modified,
          description: metadata.reference.description
        } : undefined
      }
      
      tree.push(refNode)
    }
    
    setFileTree(tree)
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

  const getNodeIcon = (node: ProjectFileNode) => {
    if (node.type === 'file') return <File className="h-3 w-3" />
    if (node.nodeType === 'project') return <Briefcase className="h-3 w-3" />
    if (node.nodeType === 'reference') return <Bookmark className="h-3 w-3" />
    if (node.name === 'References') return <BookOpen className="h-3 w-3" />
    if (node.name === 'Artifacts') return <Package className="h-3 w-3" />
    return <Folder className="h-3 w-3" />
  }

  const handleDragStart = (e: React.DragEvent, node: ProjectFileNode) => {
    if (node.nodeType === 'reference' && node.refId) {
      setDraggedNode(node)
      e.dataTransfer.effectAllowed = 'move'
    }
  }

  const handleDragOver = (e: React.DragEvent, node: ProjectFileNode) => {
    e.preventDefault()
    if (draggedNode && node.nodeType === 'project' && draggedNode.refId && node.projectId) {
      e.dataTransfer.dropEffect = 'move'
      setDragOverNode(node.path)
    }
  }

  const handleDragLeave = () => {
    setDragOverNode(null)
  }

  const handleDrop = async (e: React.DragEvent, node: ProjectFileNode) => {
    e.preventDefault()
    setDragOverNode(null)
    
    if (draggedNode && draggedNode.refId && node.nodeType === 'project' && node.projectId && onMoveReference) {
      try {
        await onMoveReference(draggedNode.refId, node.projectId)
        onRefresh?.()
      } catch (error) {
        console.error('Failed to move reference:', error)
      }
    }
    
    setDraggedNode(null)
  }

  const renderNode = (node: ProjectFileNode, depth = 0) => {
    const isExpanded = expandedNodes.has(node.path)
    const isSelected = selectedFile === node.path
    const isClickable = node.type === 'file' || (node.type === 'directory' && !node.path.startsWith('project:'))
    const isDragOver = dragOverNode === node.path

    return (
      <div key={node.path}>
        <FileContextMenu 
          node={node} 
          onRefresh={() => onRefresh?.()}
          onOpenFile={onSelectFile}
          onCreateReference={node.nodeType === 'project' && node.projectId ? () => onCreateReference?.(node.projectId) : undefined}
          projects={projects.map(p => ({ id: p.id, name: p.name }))}
        >
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start px-2 py-1 h-7 font-normal cursor-pointer',
              isSelected && 'bg-accent',
              isDragOver && 'bg-accent/50 border-2 border-primary',
              node.nodeType === 'reference' && 'cursor-move'
            )}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            draggable={node.nodeType === 'reference'}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragOver={(e) => handleDragOver(e, node)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node)}
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
            <span className="mr-2">{getNodeIcon(node)}</span>
            <span className="truncate flex-1 text-left">{node.name}</span>
            
            {node.nodeType === 'reference' && !showProjects && (
              <Badge variant="secondary" className="ml-auto text-xs px-1 py-0">
                {projectRefs.size > 0 ? 
                  Array.from(projectRefs.entries())
                    .filter(([_, refs]) => refs.some(r => r.id === node.refId))
                    .length
                  : 0
                } projects
              </Badge>
            )}
          </Button>
        </FileContextMenu>
        
        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (fileTree.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        {showProjects ? 'No projects found. Create your first project!' : 'No references found'}
      </div>
    )
  }

  return (
    <div className="p-2">
      {fileTree.map(node => renderNode(node))}
    </div>
  )
}