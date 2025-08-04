import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// Expose Intent Server API
contextBridge.exposeInMainWorld('intentAPI', {
  getServerStatus: () => ipcRenderer.invoke('intent-server:status'),
  // The server runs on localhost:3456, so we'll provide the base URL
  serverUrl: 'http://localhost:3456',
  
  // File operations
  getWorkspacePath: () => ipcRenderer.invoke('intent:get-workspace-path'),
  listFiles: (dirPath: string) => ipcRenderer.invoke('intent:list-files', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('intent:read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('intent:write-file', filePath, content),
  createFile: (filePath: string, content: string) => ipcRenderer.invoke('intent:create-file', filePath, content),
  deleteFile: (filePath: string) => ipcRenderer.invoke('intent:delete-file', filePath),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('intent:create-directory', dirPath),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('intent:rename-file', oldPath, newPath),
  copyFile: (sourcePath: string, destPath: string) => ipcRenderer.invoke('intent:copy-file', sourcePath, destPath),
  writeFileBuffer: (filePath: string, buffer: ArrayBuffer) => ipcRenderer.invoke('intent:write-file-buffer', filePath, buffer),
  getFileUrl: (filePath: string) => ipcRenderer.invoke('intent:get-file-url', filePath),
  
  // Project management
  scanRefs: () => ipcRenderer.invoke('intent:scan-refs'),
  checkMetadataExists: (filePath: string) => ipcRenderer.invoke('intent:check-metadata-exists', filePath),
  
  // Git operations
  checkGit: () => ipcRenderer.invoke('intent:check-git'),
  initGit: (refPath: string) => ipcRenderer.invoke('intent:init-git', refPath),
  installGit: () => ipcRenderer.invoke('intent:install-git'),
  createNextApp: (refPath: string) => ipcRenderer.invoke('intent:create-next-app', refPath),
  mergeExecutionBranch: (refId: string, executionId: string) => ipcRenderer.invoke('intent:merge-execution-branch', refId, executionId),
})

// Expose Auth API
contextBridge.exposeInMainWorld('authAPI', {
  storeToken: (token: string) => ipcRenderer.invoke('auth:store-token', token),
  getToken: () => ipcRenderer.invoke('auth:get-token'),
  clearToken: () => ipcRenderer.invoke('auth:clear-token'),
  openLogin: () => ipcRenderer.invoke('auth:open-login'),
  
  // Listen for token received from protocol URL
  onTokenReceived: (callback: (token: string) => void) => {
    ipcRenderer.on('auth:token-received', (event, token) => callback(token))
  },
  removeTokenListener: () => {
    ipcRenderer.removeAllListeners('auth:token-received')
  }
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const styleContent = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes loading-dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
  100% { content: ''; }
}
.retro-loader {
  font-family: "Fira Code", monospace;
  /* Primary color from dark theme */
  color: oklch(0.7 0.16 70);
  font-size: 11px;
  line-height: 12px;
  white-space: pre;
  animation: pulse 2s ease-in-out infinite;
}
.loading-text {
  font-family: "Fira Code", monospace;
  /* Muted foreground from dark theme */
  color: oklch(0.7 0.03 90);
  font-size: 12px;
  margin-top: 16px;
  display: flex;
  align-items: center;
}
.loading-text::after {
  content: '';
  animation: loading-dots 1.5s steps(4, end) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* Background from dark theme */
  background: oklch(0.25 0.04 80);
  z-index: 9;
}
.loading-footer {
  position: absolute;
  bottom: 20px;
  font-family: "Fira Code", monospace;
  font-size: 9px;
  /* Muted foreground with lower opacity */
  color: oklch(0.7 0.03 90 / 0.5);
  text-align: center;
  line-height: 1.4;
}
/* Support for light mode if system prefers it */
@media (prefers-color-scheme: light) {
  .retro-loader {
    /* Primary color from light theme */
    color: oklch(0.65 0.15 70);
  }
  .loading-text {
    /* Muted foreground from light theme */
    color: oklch(0.5 0.03 80);
  }
  .app-loading-wrap {
    /* Background from light theme */
    background: oklch(0.98 0.02 90);
  }
  .loading-footer {
    /* Muted foreground with lower opacity */
    color: oklch(0.5 0.03 80 / 0.5);
  }
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `
    <div class="retro-loader" style="font-size: 0.7rem; line-height: 0.8rem; color: var(--primary);">██╗███╗   ██╗████████╗███████╗███╗   ██╗████████╗    ██████╗  ██╗
██║████╗  ██║╚══██╔══╝██╔════╝████╗  ██║╚══██╔══╝   ██╔═████╗███║
██║██╔██╗ ██║   ██║   █████╗  ██╔██╗ ██║   ██║█████╗██║██╔██║╚██║
██║██║╚██╗██║   ██║   ██╔══╝  ██║╚██╗██║   ██║╚════╝████╔╝██║ ██║
██║██║ ╚████║   ██║   ███████╗██║ ╚████║   ██║      ╚██████╔╝ ██║
╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝   ╚═╝       ╚═════╝  ╚═╝</div>
    <div class="loading-text">Initializing...</div>
    <div class="loading-footer">
      <div>INTENT-01</div>
      <div>RESONANCE LABS</div>
    </div>
  `

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)