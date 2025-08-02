import { Button } from '../ui/button'
import { RefreshCw, Plus, FolderPlus, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

interface FileActionsProps {
  onRefresh: () => void
}

export function FileActions({ onRefresh }: FileActionsProps) {
  const handleCreateFile = () => {
    // TODO: Implement file creation
    console.log('Create file')
  }

  const handleCreateFolder = () => {
    // TODO: Implement folder creation
    console.log('Create folder')
  }

  return (
    <div className="border-b p-3 flex items-center justify-between bg-background">
      <h2 className="text-lg font-semibold">References</h2>
      
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="New">
              <Plus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleCreateFile}>
              <Plus className="h-4 w-4 mr-2" />
              New File
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCreateFolder}>
              <FolderPlus className="h-4 w-4 mr-2" />
              New Folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
        <Button
          variant="ghost"
          size="icon"
          title="Search"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}