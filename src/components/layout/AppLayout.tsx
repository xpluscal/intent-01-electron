import { ReactNode } from 'react'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '../ui/resizable'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={10} minSize={10} maxSize={25}>
            <Sidebar />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={90}>
            <main className="h-full overflow-auto bg-background">
              {children}
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}