import { 
  ContextMenu, 
  ContextMenuContent, 
  ContextMenuItem, 
  ContextMenuTrigger,
} from '../ui/context-menu'
import { 
  FolderPlus, 
  Briefcase,
  RefreshCcw
} from 'lucide-react'

interface BackgroundContextMenuProps {
  children: React.ReactNode
  onCreateProject: () => void
  onCreateReference: () => void
  onRefresh: () => void
}

export function BackgroundContextMenu({ 
  children, 
  onCreateProject,
  onCreateReference,
  onRefresh
}: BackgroundContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onCreateProject}>
          <Briefcase className="mr-2 h-4 w-4" />
          New Project
        </ContextMenuItem>
        <ContextMenuItem onClick={onCreateReference}>
          <FolderPlus className="mr-2 h-4 w-4" />
          New Reference
        </ContextMenuItem>
        <ContextMenuItem onClick={onRefresh}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}