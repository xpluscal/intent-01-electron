interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
}

interface ServerStatus {
  running: boolean
  port: number | null
}

interface IntentAPI {
  getServerStatus: () => Promise<ServerStatus>
  serverUrl: string
  
  // File operations
  getWorkspacePath: () => Promise<string>
  listFiles: (dirPath: string) => Promise<FileNode[]>
  readFile: (filePath: string) => Promise<string>
  writeFile: (filePath: string, content: string) => Promise<boolean>
  createFile: (filePath: string, content: string) => Promise<boolean>
  deleteFile: (filePath: string) => Promise<boolean>
  createDirectory: (dirPath: string) => Promise<boolean>
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>
  copyFile: (sourcePath: string, destPath: string) => Promise<boolean>
  writeFileBuffer: (filePath: string, buffer: ArrayBuffer) => Promise<boolean>
  getFileUrl: (filePath: string) => Promise<string>
  
  // Project management
  scanRefs: () => Promise<Array<{ id: string; name: string; path: string }>>
  checkMetadataExists: (filePath: string) => Promise<boolean>
  
  // Git operations
  checkGit: () => Promise<{ installed: boolean; version?: string }>
  initGit: (refPath: string) => Promise<{ success: boolean; error?: string }>
  installGit: () => Promise<{ success: boolean; message?: string; error?: string }>
  createNextApp: (refPath: string) => Promise<{ success: boolean; error?: string }>
  
  // Preview operations
  startPreview: (refId: string) => Promise<PreviewStartResult>
  stopPreview: (refId: string) => Promise<{ success: boolean }>
  getPreviewStatus: (refId: string) => Promise<PreviewStatus>
}

interface PreviewStatus {
  running: boolean
  status: 'stopped' | 'installing' | 'starting' | 'running' | 'error'
  port?: number
  url?: string
  error?: string
}

interface PreviewStartResult {
  success: boolean
  previewId?: string
  port?: number
  url?: string
  error?: string
}

interface PreviewLog {
  timestamp: string
  type: 'info' | 'error' | 'warning' | 'system'
  content: string
}

declare global {
  interface Window {
    intentAPI: IntentAPI
    ipcRenderer: {
      on: (channel: string, func: (...args: any[]) => void) => void
      off: (channel: string, func: (...args: any[]) => void) => void
      send: (channel: string, ...args: any[]) => void
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
  }
}

export {}