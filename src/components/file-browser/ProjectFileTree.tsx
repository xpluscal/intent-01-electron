import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, File, Folder, Briefcase, Bookmark, BookOpen, Loader2, Package, FileText, Image, Code, Type, FolderOpen, Video, Music, FileImage, Plus } from 'lucide-react'
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
  selectedArtifact?: string | null
  showProjects: boolean
  loading?: boolean
  onRefresh?: () => void
  onCreateReference?: (projectId?: string) => void
  onCreateArtifact?: (projectId?: string) => void
  onMoveReference?: (refId: string, targetProjectId: string) => Promise<void>
  onOpenArtifactView?: (refId: string, artifactType: string) => void
}

export function ProjectFileTree({ 
  projects, 
  onSelectFile, 
  selectedFile,
  selectedArtifact,
  showProjects = true,
  loading = false,
  onRefresh,
  onCreateReference,
  onCreateArtifact,
  onMoveReference,
  onOpenArtifactView
}: ProjectFileTreeProps) {
  const [fileTree, setFileTree] = useState<ProjectFileNode[]>([])
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const { buildFileTree } = useFileSystem()
  const [projectRefs, setProjectRefs] = useState<Map<string, Reference[]>>(new Map())
  const [draggedNode, setDraggedNode] = useState<ProjectFileNode | null>(null)
  const [dragOverNode, setDragOverNode] = useState<string | null>(null)
  const [, setUnassignedRefs] = useState<Reference[]>([])
  const [hoveredArtifact, setHoveredArtifact] = useState<string | null>(null)
  const [artifactReadRefs, setArtifactReadRefs] = useState<Set<string>>(new Set())

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
    
    // Load unassigned references
    const unassigned = await projectManager.getUnassignedReferences()
    setUnassignedRefs(unassigned)
    
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
          description: project.description,
          emoji: project.emoji
        }
      }
      
      // Separate refs into References and Artifacts
      const refs = refsMap.get(project.id) || []
      const references = refs.filter(r => r.type === 'reference')
      const artifacts = refs.filter(r => r.type === 'artifact')
      
      // Add References folder
      if (references.length > 0 || true) { // Always show References folder
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
          
          // Special handling for document references
          let refNode: ProjectFileNode
          if (ref.subtype === 'document') {
            // For documents, show as a file that opens the main .md file
            refNode = {
              name: ref.name,
              path: `refs/${ref.id}/${ref.id}.md`, // Direct path to the .md file
              type: 'file',
              nodeType: 'reference',
              projectId: project.id,
              refId: ref.id,
              metadata: {
                created: ref.created,
                modified: ref.modified,
                description: ref.description,
                refType: ref.type,
                refSubtype: ref.subtype
              }
            }
          } else {
            // For other references, show as folder
            refNode = {
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
                description: ref.description,
                refType: ref.type,
                refSubtype: ref.subtype
              }
            }
          }
          referencesNode.children?.push(refNode)
        }
        
        projectNode.children?.push(referencesNode)
      }
      
      // Add Artifacts folder
      if (artifacts.length > 0 || true) { // Always show Artifacts folder
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
              description: ref.description,
              refType: ref.type,
              refSubtype: ref.subtype,
              readRefCount: ref.readReferences?.length || 0
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
    
    // Add unassigned references section if there are any
    if (unassigned.length > 0) {
      const unassignedNode: ProjectFileNode = {
        name: 'Unassigned References',
        path: 'unassigned-references',
        type: 'directory',
        nodeType: 'folder',
        children: []
      }
      
      for (const ref of unassigned) {
        const refFiles = await buildFileTree(`refs/${ref.id}`)
        
        // Special handling for document references
        let refNode: ProjectFileNode
        if (ref.subtype === 'document') {
          // For documents, show as a file that opens the main .md file
          refNode = {
            name: ref.name,
            path: `refs/${ref.id}/${ref.id}.md`,
            type: 'file',
            nodeType: 'reference',
            refId: ref.id,
            metadata: {
              created: ref.created,
              modified: ref.modified,
              description: ref.description,
              refType: ref.type,
              refSubtype: ref.subtype
            }
          }
        } else {
          // For other references, show as folder
          refNode = {
            name: ref.name,
            path: `refs/${ref.id}`,
            type: 'directory',
            nodeType: 'reference',
            refId: ref.id,
            children: refFiles as ProjectFileNode[],
            metadata: {
              created: ref.created,
              modified: ref.modified,
              description: ref.description,
              refType: ref.type,
              refSubtype: ref.subtype
            }
          }
        }
        unassignedNode.children?.push(refNode)
      }
      
      tree.push(unassignedNode)
      
      // Auto-expand unassigned section
      setExpandedNodes(prev => {
        const next = new Set(prev)
        next.add('unassigned-references')
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
      
      let refNode: ProjectFileNode
      
      // Special handling for document references
      if (metadata?.reference.subtype === 'document') {
        refNode = {
          name: ref.name,
          path: `refs/${ref.id}/${ref.id}.md`,
          type: 'file',
          nodeType: 'reference',
          refId: ref.id,
          metadata: metadata?.reference ? {
            created: metadata.reference.created,
            modified: metadata.reference.modified,
            description: metadata.reference.description,
            refType: metadata.reference.type,
            refSubtype: metadata.reference.subtype
          } : undefined
        }
      } else {
        refNode = {
          name: ref.name,
          path: `refs/${ref.id}`,
          type: 'directory',
          nodeType: 'reference',
          refId: ref.id,
          children: refFiles as ProjectFileNode[],
          metadata: metadata?.reference ? {
            created: metadata.reference.created,
            modified: metadata.reference.modified,
            description: metadata.reference.description,
            refType: metadata.reference.type,
            refSubtype: metadata.reference.subtype
          } : undefined
        }
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

  const handleExternalFileDrop = async (file: File, projectId: string | null) => {
    // Generate reference ID from filename
    const baseName = file.name.replace(/\.[^/.]+$/, '') // Remove extension
    const refId = baseName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    
    // Determine type and subtype based on file extension
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    let refType: 'reference' | 'artifact' = 'reference'
    let refSubtype: string = 'document'
    
    // Detect file type
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp']
    const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv']
    const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma']
    const markdownExtensions = ['md', 'markdown']
    
    if (markdownExtensions.includes(extension)) {
      refType = 'reference'
      refSubtype = 'document'
    } else if ([...imageExtensions, ...videoExtensions, ...audioExtensions].includes(extension)) {
      refType = 'reference'
      refSubtype = 'media'
    } else {
      // Default to document for other file types
      refType = 'reference'
      refSubtype = 'document'
    }
    
    // Create reference directory
    const refPath = `refs/${refId}`
    await window.intentAPI.createDirectory(refPath)
    
    // Create reference metadata
    await projectManager.createRefMetadata(refId, baseName, refType, refSubtype as any)
    
    // Copy the file to the reference directory
    const destFileName = file.name
    const destPath = `${refPath}/${destFileName}`
    
    if (markdownExtensions.includes(extension)) {
      // For markdown files, read as text
      const text = await file.text()
      await window.intentAPI.createFile(destPath, text)
    } else {
      // For binary files, use the buffer write API
      const arrayBuffer = await file.arrayBuffer()
      await window.intentAPI.writeFileBuffer(destPath, arrayBuffer)
    }
    
    // For document references, create the default .md file if it doesn't exist
    if (refType === 'reference' && refSubtype === 'document' && !markdownExtensions.includes(extension)) {
      const docPath = `${refPath}/${refId}.md`
      const defaultContent = `# ${baseName}\n\nFile: ${file.name}\n`
      await window.intentAPI.createFile(docPath, defaultContent)
    }
    
    // Add reference to project if projectId is provided
    if (projectId) {
      await projectManager.addRefToProject(projectId, refId)
    }
  }

  // Helper to get the single media file from a directory (for image preview)
  const getSingleMediaFile = (node: ProjectFileNode): string | null => {
    // For media references
    if (node.nodeType === 'reference' && node.metadata?.refSubtype === 'media') {
      // Filter out .intent-ref.json and find media files
      const mediaFiles = node.children?.filter(child => 
        child.type === 'file' && 
        !child.name.endsWith('.intent-ref.json')
      ) || []
      
      // If exactly one media file, return its path
      if (mediaFiles.length === 1) {
        return mediaFiles[0].path
      }
    }
    
    // For any directory containing only images (filtering out git files)
    if (node.type === 'directory' && node.children) {
      const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico']
      
      // Filter out git-related files and non-image files
      const imageFiles = node.children.filter(child => {
        if (child.type !== 'file') return false
        
        // Skip git-related files
        if (child.name === '.gitignore' || child.name.startsWith('.git')) return false
        if (child.name === '.intent-ref.json') return false
        
        // Check if it's an image
        const ext = child.name.split('.').pop()?.toLowerCase() || ''
        return imageExtensions.includes(ext)
      })
      
      // Also check that there are no non-git subdirectories
      const hasSubdirs = node.children.some(child => 
        child.type === 'directory' && child.name !== '.git'
      )
      
      // If only images (no subdirs) and exactly one image, return it
      if (!hasSubdirs && imageFiles.length === 1) {
        return imageFiles[0].path
      }
    }
    
    return null
  }

  // Helper to determine media type from files in a reference
  const getMediaType = (node: ProjectFileNode): 'image' | 'video' | 'audio' | 'mixed' | null => {
    if (node.nodeType !== 'reference' || node.metadata?.refSubtype !== 'media') {
      return null
    }
    
    const mediaFiles = node.children?.filter(child => 
      child.type === 'file' && 
      !child.name.endsWith('.intent-ref.json')
    ) || []
    
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico']
    const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v']
    const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a']
    
    let hasImage = false
    let hasVideo = false
    let hasAudio = false
    
    for (const file of mediaFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      if (imageExtensions.includes(ext)) hasImage = true
      else if (videoExtensions.includes(ext)) hasVideo = true
      else if (audioExtensions.includes(ext)) hasAudio = true
    }
    
    // Return specific type if only one type present
    const typeCount = [hasImage, hasVideo, hasAudio].filter(Boolean).length
    if (typeCount === 1) {
      if (hasImage) return 'image'
      if (hasVideo) return 'video'
      if (hasAudio) return 'audio'
    } else if (typeCount > 1) {
      return 'mixed'
    }
    
    return null
  }

  const getNodeIcon = (node: ProjectFileNode) => {
    if (node.nodeType === 'project') {
      return node.metadata?.emoji ? (
        <span className="text-base leading-none">{node.metadata.emoji}</span>
      ) : (
        <Briefcase className="h-3 w-3" />
      )
    }
    if (node.name === 'References') return <BookOpen className="h-3 w-3" />
    if (node.name === 'Artifacts') return <Package className="h-3 w-3" />
    if (node.name === 'Unassigned References') return <FolderOpen className="h-3 w-3 text-orange-500" />
    
    // Icons for references based on their subtype
    if (node.nodeType === 'reference' && node.metadata) {
      const { refType, refSubtype } = node.metadata
      
      if (refType === 'reference') {
        switch (refSubtype) {
          case 'document':
            return <FileText className="h-3 w-3" />
          case 'media':
            // Determine specific media type
            const mediaType = getMediaType(node)
            switch (mediaType) {
              case 'image':
                return <Image className="h-3 w-3" />
              case 'video':
                return <Video className="h-3 w-3" />
              case 'audio':
                return <Music className="h-3 w-3" />
              case 'mixed':
                return <FileImage className="h-3 w-3" />
              default:
                return <Image className="h-3 w-3" />
            }
          default:
            return <Bookmark className="h-3 w-3" />
        }
      } else if (refType === 'artifact') {
        switch (refSubtype) {
          case 'code':
            return <Code className="h-3 w-3" />
          case 'text':
            return <Type className="h-3 w-3" />
          case 'media-artifact':
            return <Image className="h-3 w-3" />
          default:
            return <Package className="h-3 w-3" />
        }
      }
    }
    
    if (node.type === 'file') return <File className="h-3 w-3" />
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
    } else if (!draggedNode && (node.nodeType === 'project' || node.name === 'Unassigned References') && e.dataTransfer.types.includes('Files')) {
      // Allow external file drops on projects and unassigned references
      e.dataTransfer.dropEffect = 'copy'
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
      // Handle internal reference drag
      try {
        await onMoveReference(draggedNode.refId, node.projectId)
        onRefresh?.()
      } catch (error) {
        console.error('Failed to move reference:', error)
      }
    } else if (!draggedNode && e.dataTransfer.files.length > 0) {
      // Handle external file drops
      const files = Array.from(e.dataTransfer.files)
      
      if (node.nodeType === 'project' && node.projectId) {
        // Drop on project - add to that project
        for (const file of files) {
          try {
            await handleExternalFileDrop(file, node.projectId)
          } catch (error) {
            console.error('Failed to import file:', error)
          }
        }
      } else if (node.name === 'Unassigned References') {
        // Drop on unassigned - create without project assignment
        for (const file of files) {
          try {
            await handleExternalFileDrop(file, null)
          } catch (error) {
            console.error('Failed to import file:', error)
          }
        }
      }
      
      onRefresh?.()
    }
    
    setDraggedNode(null)
  }

  const renderNode = (node: ProjectFileNode, depth = 0) => {
    const isExpanded = expandedNodes.has(node.path)
    const isSelected = selectedFile === node.path
    const isArtifactSelected = node.nodeType === 'reference' && node.metadata?.refType === 'artifact' && node.refId === selectedArtifact
    const isDragOver = dragOverNode === node.path
    const isHighlighted = hoveredArtifact && node.refId && artifactReadRefs.has(node.refId)

    return (
      <div key={node.path}>
        <FileContextMenu 
          node={node} 
          onRefresh={() => onRefresh?.()}
          onOpenFile={onSelectFile}
          onCreateReference={
            (node.nodeType === 'project' && node.projectId) || (node.name === 'References' && node.projectId)
              ? () => onCreateReference?.(node.projectId) 
              : undefined
          }
          onCreateArtifact={
            (node.name === 'Artifacts' && node.projectId)
              ? () => onCreateArtifact?.(node.projectId)
              : undefined
          }
          projects={projects.map(p => ({ id: p.id, name: p.name }))}
        >
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start px-2 py-1 h-7 font-normal cursor-pointer group',
              isSelected && 'bg-accent',
              isArtifactSelected && 'bg-muted',
              isDragOver && 'bg-primary/20 border-2 border-primary border-dashed',
              node.nodeType === 'reference' && 'cursor-move',
              node.name === 'Unassigned References' && 'bg-orange-50 dark:bg-orange-950/20 border-l-2 border-orange-300 dark:border-orange-700',
              isHighlighted && 'bg-blue-100 dark:bg-blue-950 ring-1 ring-blue-300 dark:ring-blue-700'
            )}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            draggable={node.nodeType === 'reference'}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragOver={(e) => handleDragOver(e, node)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node)}
            onMouseEnter={async () => {
              if (node.nodeType === 'reference' && node.metadata?.refType === 'artifact' && node.refId) {
                setHoveredArtifact(node.refId)
                // Load read references for this artifact
                try {
                  const readRefs = await projectManager.getReadReferences(node.refId)
                  setArtifactReadRefs(new Set(readRefs.map(r => r.id)))
                } catch (error) {
                  console.error('Failed to load read references:', error)
                  setArtifactReadRefs(new Set())
                }
              }
            }}
            onMouseLeave={() => {
              if (hoveredArtifact) {
                setHoveredArtifact(null)
                setArtifactReadRefs(new Set())
              }
            }}
            onClick={() => {
              // Special handling for artifact references
              if (node.nodeType === 'reference' && node.metadata?.refType === 'artifact' && node.refId) {
                onOpenArtifactView?.(node.refId, node.metadata.refSubtype || 'code')
              } else if (node.type === 'directory') {
                // Check if it's a media reference with a single file
                const singleMediaFile = getSingleMediaFile(node)
                if (singleMediaFile) {
                  onSelectFile(singleMediaFile)
                } else {
                  toggleExpanded(node.path)
                }
              } else {
                onSelectFile(node.path)
              }
            }}
          >
            <span className="mr-2">{getNodeIcon(node)}</span>
            <span className="truncate flex-1 text-left">{node.name}</span>
            
            {node.nodeType === 'reference' && !showProjects && (
              <Badge variant="secondary" className="ml-auto text-xs px-1 py-0 mr-2">
                {projectRefs.size > 0 ? 
                  Array.from(projectRefs.entries())
                    .filter(([_, refs]) => refs.some(r => r.id === node.refId))
                    .length
                  : 0
                } projects
              </Badge>
            )}
            
            {/* Show read references count for artifacts */}
            {node.nodeType === 'reference' && node.metadata?.refType === 'artifact' && node.metadata?.readRefCount !== undefined && node.metadata.readRefCount > 0 && (
              <Badge variant="outline" className="ml-1 text-xs px-1 py-0" title="Read references">
                <BookOpen className="h-3 w-3 mr-1" />
                {node.metadata.readRefCount}
              </Badge>
            )}
            
            {node.type === 'directory' && !getSingleMediaFile(node) && (
              <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                {/* Show "show files" text for artifacts */}
                {node.nodeType === 'reference' && node.metadata?.refType === 'artifact' && (
                  <span 
                    className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpanded(node.path)
                    }}
                  >
                    show files
                  </span>
                )}
                {/* Show add button for References and Artifacts folders */}
                {(node.name === 'References' || node.name === 'Artifacts') && node.projectId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 p-0 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (node.name === 'References' && onCreateReference) {
                        onCreateReference(node.projectId)
                      } else if (node.name === 'Artifacts' && onCreateArtifact) {
                        onCreateArtifact(node.projectId)
                      }
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                )}
                {/* Show chevron for other directories */}
                {node.name !== 'References' && node.name !== 'Artifacts' && (
                  isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )
                )}
              </span>
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