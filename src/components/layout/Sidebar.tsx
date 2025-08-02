import { NavLink } from 'react-router-dom'
import { Settings, FolderOpen, FileText, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '../ui/scroll-area'

const navItems = [
  {
    to: '/files',
    icon: FolderOpen,
    label: 'File Browser',
  },
  {
    to: '/executions',
    icon: Activity,
    label: 'Executions',
  },
  {
    to: '/logs',
    icon: FileText,
    label: 'Logs',
  },
  {
    to: '/settings',
    icon: Settings,
    label: 'Settings',
  },
]

export function Sidebar() {
  return (
    <div className="flex h-full flex-col border-r bg-background">
      <div className="p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Navigation</h2>
      </div>
      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent text-accent-foreground'
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </ScrollArea>
    </div>
  )
}