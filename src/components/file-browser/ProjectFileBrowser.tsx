import { useState, useEffect, useRef } from 'react'
import { ProjectFileTree } from './ProjectFileTree'
import { FileViewer } from './FileViewer'
import { ProjectActions, ProjectActionsHandle } from './ProjectActions'
import { BackgroundContextMenu } from './BackgroundContextMenu'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '../ui/resizable'
import { ScrollArea } from '../ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { projectManager } from '@/lib/projectManager'
import { Project } from '@/types/projects'

export function ProjectFileBrowser() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [view, setView] = useState<'projects' | 'refs'>('projects')
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectForRef, setSelectedProjectForRef] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadProjects()
  }, [refreshKey])

  const loadProjects = async () => {
    setLoading(true)
    try {
      const allProjects = await projectManager.getAllProjects()
      setProjects(allProjects)
      
      // Initialize default project if none exist
      if (allProjects.length === 0) {
        await initializeDefaultProject()
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const initializeDefaultProject = async () => {
    // Create a default project and scan existing refs
    const defaultProject = await projectManager.createProject('Default Project', 'Auto-generated project for existing references')
    
    // Scan and add existing refs
    const existingRefs = await window.intentAPI.scanRefs()
    for (const ref of existingRefs) {
      await projectManager.addRefToProject(defaultProject.id, ref.id)
      
      // Create ref metadata if it doesn't exist
      const metadataExists = await window.intentAPI.checkMetadataExists(`refs/${ref.id}/.intent-ref.json`)
      if (!metadataExists) {
        await projectManager.createRefMetadata(ref.id, ref.name, 'other')
      }
    }
    
    // Reload projects
    const allProjects = await projectManager.getAllProjects()
    setProjects(allProjects)
  }

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  const handleCreateProject = async (name: string, description?: string) => {
    await projectManager.createProject(name, description)
    handleRefresh()
  }

  const handleCreateReference = async (name: string, type: 'code' | 'documentation' | 'other', projectId?: string) => {
    // Create the reference directory
    const refId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const refPath = `refs/${refId}`
    
    try {
      // Create the directory
      await window.intentAPI.createDirectory(refPath)
      
      // Create metadata
      await projectManager.createRefMetadata(refId, name, type)
      
      // Use selectedProjectForRef if set (from context menu), otherwise use the passed projectId
      const targetProjectId = selectedProjectForRef || projectId
      if (targetProjectId) {
        await projectManager.addRefToProject(targetProjectId, refId)
      }
      
      // Reset selectedProjectForRef
      setSelectedProjectForRef(null)
      
      handleRefresh()
    } catch (error) {
      console.error('Failed to create reference:', error)
      throw error
    }
  }

  const handleMoveReference = async (refId: string, targetProjectId: string) => {
    // First, remove from current project if any
    const currentProject = projects.find(p => 
      p.refs.includes(refId)
    )
    
    if (currentProject) {
      await projectManager.removeRefFromProject(currentProject.id, refId)
    }
    
    // Then add to target project
    await projectManager.addRefToProject(targetProjectId, refId)
  }

  const projectActionsRef = useRef<ProjectActionsHandle | null>(null)

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
            <Tabs value={view} onValueChange={(v) => setView(v as 'projects' | 'refs')}>
              <TabsList className="w-full">
                <TabsTrigger value="projects" className="flex-1">Projects</TabsTrigger>
                <TabsTrigger value="refs" className="flex-1">All Refs</TabsTrigger>
              </TabsList>
              
              <TabsContent value="projects" className="h-[calc(100%-40px)] m-0">
                <BackgroundContextMenu
                  onCreateProject={() => projectActionsRef.current?.openCreateProject()}
                  onCreateReference={() => {
                    setSelectedProjectForRef(null)
                    projectActionsRef.current?.openCreateReference()
                  }}
                  onRefresh={handleRefresh}
                >
                  <ScrollArea className="h-full">
                    <ProjectFileTree
                      key={refreshKey}
                      projects={projects}
                      onSelectFile={setSelectedFile}
                      selectedFile={selectedFile}
                      showProjects={true}
                      loading={loading}
                      onRefresh={handleRefresh}
                      onCreateReference={(projectId?: string) => {
                        setSelectedProjectForRef(projectId || null)
                        projectActionsRef.current?.openCreateReference(projectId)
                      }}
                      onMoveReference={handleMoveReference}
                    />
                  </ScrollArea>
                </BackgroundContextMenu>
              </TabsContent>
              
              <TabsContent value="refs" className="h-[calc(100%-40px)] m-0">
                <BackgroundContextMenu
                  onCreateProject={() => projectActionsRef.current?.openCreateProject()}
                  onCreateReference={() => {
                    setSelectedProjectForRef(null)
                    projectActionsRef.current?.openCreateReference()
                  }}
                  onRefresh={handleRefresh}
                >
                  <ScrollArea className="h-full">
                    <ProjectFileTree
                      key={refreshKey + 1000} // Different key to force re-render
                      projects={projects}
                      onSelectFile={setSelectedFile}
                      selectedFile={selectedFile}
                      showProjects={false}
                      loading={loading}
                      onRefresh={handleRefresh}
                      onCreateReference={(projectId?: string) => {
                        setSelectedProjectForRef(projectId || null)
                        projectActionsRef.current?.openCreateReference(projectId)
                      }}
                      onMoveReference={handleMoveReference}
                    />
                  </ScrollArea>
                </BackgroundContextMenu>
              </TabsContent>
            </Tabs>
          </ResizablePanel>
          
          <ResizableHandle />
          
          <ResizablePanel defaultSize={70}>
            {selectedFile ? (
              <FileViewer 
                filePath={selectedFile}
                onClose={() => setSelectedFile(null)}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                Select a file to view its contents
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}