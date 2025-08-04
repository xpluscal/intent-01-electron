/// <reference types="vite-electron-plugin/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: 'true'
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬ dist-electron
     * │ ├─┬ main
     * │ │ └── index.js    > Electron-Main
     * │ └─┬ preload
     * │   └── index.mjs   > Preload-Scripts
     * ├─┬ dist
     * │ └── index.html    > Electron-Renderer
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Window object extensions
interface Window {
  ipcRenderer: {
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
    off: (channel: string, ...args: any[]) => void
    send: (channel: string, ...args: any[]) => void
    invoke: (channel: string, ...args: any[]) => Promise<any>
  }
  
  intentAPI: {
    getServerStatus: () => Promise<{ running: boolean; port: number | null }>
    serverUrl: string
    getWorkspacePath: () => Promise<string>
    listFiles: (dirPath: string) => Promise<any[]>
    readFile: (filePath: string) => Promise<string>
    writeFile: (filePath: string, content: string) => Promise<boolean>
    createFile: (filePath: string, content: string) => Promise<boolean>
    deleteFile: (filePath: string) => Promise<boolean>
    createDirectory: (dirPath: string) => Promise<boolean>
    renameFile: (oldPath: string, newPath: string) => Promise<boolean>
    copyFile: (sourcePath: string, destPath: string) => Promise<boolean>
    writeFileBuffer: (filePath: string, buffer: ArrayBuffer) => Promise<boolean>
    getFileUrl: (filePath: string) => Promise<string>
    scanRefs: () => Promise<any[]>
    checkMetadataExists: (filePath: string) => Promise<boolean>
    checkGit: () => Promise<{ installed: boolean; version?: string }>
    initGit: (refPath: string) => Promise<{ success: boolean; error?: string }>
    installGit: () => Promise<{ success: boolean; message?: string; error?: string }>
    createNextApp: (refPath: string) => Promise<{ success: boolean; error?: string }>
    mergeExecutionBranch: (refId: string, executionId: string) => Promise<{ success: boolean; message?: string; error?: string }>
  }
  
  authAPI: {
    storeToken: (token: string) => Promise<{ success: boolean; error?: string }>
    getToken: () => Promise<{ success: boolean; token: string | null; error?: string }>
    clearToken: () => Promise<{ success: boolean; error?: string }>
    openLogin: () => Promise<{ success: boolean }>
    onTokenReceived: (callback: (token: string) => void) => void
    removeTokenListener: () => void
  }
}
