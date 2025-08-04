import { ReactNode, useState } from 'react'
// import { UserButton } from '@clerk/clerk-react'
import { Button } from '../ui/button'
import { Settings } from 'lucide-react'
import { SettingsModal } from '../settings/SettingsModal'

interface SimplifiedLayoutProps {
  children: ReactNode
}

export function SimplifiedLayout({ children }: SimplifiedLayoutProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="h-screen flex flex-col">
      {/* Top Navigation */}
      <header className="h-12 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <div className="font-mono text-[3px] leading-[4px] text-primary select-none">
            <pre className="whitespace-pre">
{`██╗███╗   ██╗████████╗███████╗███╗   ██╗████████╗    ██████╗  ██╗
██║████╗  ██║╚══██╔══╝██╔════╝████╗  ██║╚══██╔══╝   ██╔═████╗███║
██║██╔██╗ ██║   ██║   █████╗  ██╔██╗ ██║   ██║█████╗██║██╔██║╚██║
██║██║╚██╗██║   ██║   ██╔══╝  ██║╚██╗██║   ██║╚════╝████╔╝██║ ██║
██║██║ ╚████║   ██║   ███████╗██║ ╚████║   ██║      ╚██████╔╝ ██║
╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝   ╚═╝       ╚═════╝  ╚═╝`}
            </pre>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
          {/* <UserButton afterSignOutUrl="/" /> */}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}