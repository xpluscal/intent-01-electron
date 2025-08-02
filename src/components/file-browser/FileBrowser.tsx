import { useState } from 'react'
import { FileTree } from './FileTree'
import { FileViewer } from './FileViewer'
import { FileActions } from './FileActions'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '../ui/resizable'
import { ScrollArea } from '../ui/scroll-area'

export function FileBrowser() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  return (
    <div className="h-full flex flex-col">
      <FileActions onRefresh={handleRefresh} />
      
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
            <ScrollArea className="h-full">
              <FileTree 
                key={refreshKey}
                onSelectFile={setSelectedFile}
                selectedFile={selectedFile}
              />
            </ScrollArea>
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