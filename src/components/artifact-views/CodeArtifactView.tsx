import { useState, useEffect } from 'react'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Separator } from '../ui/separator'
import { CodeEditor } from '../editor/CodeEditor'
import { useFileSystem } from '@/hooks/useFileSystem'
import { File, Plus, Save, FileText, Code2, Image, FileCode, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface CodeFile {
  name: string
  path: string
  type: 'file'
  extension: string
  language: string
}

interface CodeArtifactViewProps {
  refId: string
  refName: string
  onClose?: () => void
}

export function CodeArtifactView({ refId, refName, onClose }: CodeArtifactViewProps) {
  const [files, setFiles] = useState<CodeFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { buildFileTree } = useFileSystem()

  useEffect(() => {
    loadArtifactFiles()
  }, [refId])

  const loadArtifactFiles = async () => {
    setLoading(true)
    try {
      const tree = await buildFileTree(`refs/${refId}`)
      const codeFiles = extractCodeFiles(tree, `refs/${refId}`)
      setFiles(codeFiles)
      
      // Auto-select first file if available
      if (codeFiles.length > 0 && !selectedFile) {
        setSelectedFile(codeFiles[0].path)
      }
    } catch (error) {
      console.error('Failed to load artifact files:', error)
      toast.error('Failed to load artifact files')
    } finally {
      setLoading(false)
    }
  }

  const extractCodeFiles = (tree: any[], basePath: string): CodeFile[] => {
    const codeFiles: CodeFile[] = []
    
    const traverse = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.type === 'file' && !node.name.endsWith('.intent-ref.json')) {
          const extension = node.name.split('.').pop()?.toLowerCase() || ''
          const language = getLanguageFromExtension(extension)
          
          // Only include code files
          if (isCodeFile(extension)) {
            codeFiles.push({
              name: node.name,
              path: node.path,
              type: 'file',
              extension,
              language
            })
          }
        } else if (node.type === 'directory' && node.children) {
          traverse(node.children)
        }
      }
    }
    
    traverse(tree)
    return codeFiles
  }

  const isCodeFile = (extension: string): boolean => {
    const codeExtensions = [
      'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'php', 'java', 'cpp', 'c', 'cs', 'go',
      'rs', 'swift', 'kt', 'scala', 'clj', 'hs', 'ml', 'fs', 'dart', 'vue', 'svelte',
      'html', 'css', 'scss', 'sass', 'less', 'json', 'xml', 'yaml', 'yml', 'toml',
      'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'r', 'jl', 'elm', 'ex', 'exs'
    ]
    return codeExtensions.includes(extension)
  }

  const getLanguageFromExtension = (extension: string): string => {
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'php': 'php',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'clj': 'clojure',
      'hs': 'haskell',
      'ml': 'ocaml',
      'fs': 'fsharp',
      'dart': 'dart',
      'vue': 'vue',
      'svelte': 'svelte',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'fish': 'bash',
      'ps1': 'powershell',
      'sql': 'sql',
      'r': 'r',
      'jl': 'julia',
      'elm': 'elm',
      'ex': 'elixir',
      'exs': 'elixir'
    }
    return languageMap[extension] || 'text'
  }

  const getFileIcon = (extension: string) => {
    if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
      return <FileCode className="h-4 w-4 text-yellow-500" />
    } else if (['py'].includes(extension)) {
      return <FileCode className="h-4 w-4 text-blue-500" />
    } else if (['html', 'css', 'scss'].includes(extension)) {
      return <Code2 className="h-4 w-4 text-orange-500" />
    } else if (['json', 'xml', 'yaml', 'yml'].includes(extension)) {
      return <FileText className="h-4 w-4 text-gray-500" />
    }
    return <File className="h-4 w-4 text-gray-500" />
  }

  const loadFileContent = async (filePath: string) => {
    try {
      const content = await window.intentAPI.readFile(filePath)
      setFileContent(content)
    } catch (error) {
      console.error('Failed to load file:', error)
      toast.error('Failed to load file')
      setFileContent('')
    }
  }

  const saveFileContent = async () => {
    if (!selectedFile) return
    
    setSaving(true)
    try {
      await window.intentAPI.writeFile(selectedFile, fileContent)
      toast.success('File saved successfully')
    } catch (error) {
      console.error('Failed to save file:', error)
      toast.error('Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  const handleFileSelect = async (filePath: string) => {
    setSelectedFile(filePath)
    await loadFileContent(filePath)
  }

  // Load content when selectedFile changes
  useEffect(() => {
    if (selectedFile) {
      loadFileContent(selectedFile)
    }
  }, [selectedFile])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Loading code files...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Code2 className="h-5 w-5" />
              {refName}
            </h2>
            <p className="text-sm text-muted-foreground">
              {files.length} code file{files.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedFile && (
              <Button 
                onClick={saveFileContent} 
                disabled={saving}
                size="sm"
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            )}
            {onClose && (
              <Button 
                onClick={onClose} 
                variant="ghost"
                size="sm"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex">
        {/* File List */}
        <div className="w-64 border-r">
          <div className="p-3 border-b">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Files</h3>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="p-2">
              {files.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <FileCode className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  No code files found
                </div>
              ) : (
                <div className="space-y-1">
                  {files.map((file) => (
                    <Button
                      key={file.path}
                      variant={selectedFile === file.path ? "secondary" : "ghost"}
                      size="sm"
                      className={cn(
                        "w-full justify-start px-2 py-1 h-8 font-normal",
                        selectedFile === file.path && "bg-accent"
                      )}
                      onClick={() => handleFileSelect(file.path)}
                    >
                      <span className="mr-2">{getFileIcon(file.extension)}</span>
                      <span className="truncate flex-1 text-left">{file.name}</span>
                      <Badge variant="outline" className="ml-1 text-xs px-1 py-0">
                        {file.extension}
                      </Badge>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Editor */}
        <div className="flex-1">
          {selectedFile ? (
            <CodeEditor
              content={fileContent}
              onChange={setFileContent}
              language={files.find(f => f.path === selectedFile)?.language || 'text'}
              onSave={saveFileContent}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <FileCode className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">Select a file to edit</h3>
                <p className="text-sm text-muted-foreground">
                  Choose a code file from the sidebar to start editing
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}