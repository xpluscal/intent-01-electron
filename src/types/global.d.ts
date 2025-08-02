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