import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { update } from './update'
import { IntentServer } from './serverIntegration'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

// Initialize Intent server
let intentServer: IntentServer | null = null

async function createWindow() {
  win = new BrowserWindow({
    title: 'Main window',
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    width: 1280,
    height: 720,
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    // win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Auto update
  update(win)
}

app.whenReady().then(async () => {
  // Start Intent server first
  try {
    intentServer = new IntentServer({ port: 3456 })
    await intentServer.start()
    console.log('Intent server started successfully on port 3456')
  } catch (error) {
    console.error('Failed to start Intent server:', error)
  }
  
  // Then create the window
  createWindow()
})

app.on('window-all-closed', async () => {
  win = null
  
  // Stop Intent server
  if (intentServer) {
    try {
      await intentServer.stop()
      console.log('Intent server stopped')
    } catch (error) {
      console.error('Error stopping Intent server:', error)
    }
  }
  
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})

// Intent server status handler
ipcMain.handle('intent-server:status', () => {
  return {
    running: intentServer?.isServerRunning() || false,
    port: intentServer?.getPort() || null
  }
})

// File operation handlers
ipcMain.handle('intent:get-workspace-path', () => {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'intent-workspace', 'refs')
})

ipcMain.handle('intent:list-files', async (event, dirPath) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  // Ensure path is within workspace for security
  const fullPath = path.join(workspacePath, dirPath)
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  try {
    const items = await fs.readdir(fullPath, { withFileTypes: true })
    return items.map(item => ({
      name: item.name,
      path: path.join(dirPath, item.name),
      type: item.isDirectory() ? 'directory' : 'file'
    }))
  } catch (error) {
    console.error('Error listing files:', error)
    return []
  }
})

ipcMain.handle('intent:read-file', async (event, filePath) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullPath = path.join(workspacePath, filePath)
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  return fs.readFile(fullPath, 'utf-8')
})

ipcMain.handle('intent:write-file', async (event, filePath, content) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullPath = path.join(workspacePath, filePath)
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  await fs.writeFile(fullPath, content, 'utf-8')
  return true
})

ipcMain.handle('intent:create-file', async (event, filePath, content = '') => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullPath = path.join(workspacePath, filePath)
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, content, 'utf-8')
  return true
})

ipcMain.handle('intent:delete-file', async (event, filePath) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullPath = path.join(workspacePath, filePath)
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  await fs.unlink(fullPath)
  return true
})

ipcMain.handle('intent:create-directory', async (event, dirPath) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullPath = path.join(workspacePath, dirPath)
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  await fs.mkdir(fullPath, { recursive: true })
  return true
})

ipcMain.handle('intent:rename-file', async (event, oldPath, newPath) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullOldPath = path.join(workspacePath, oldPath)
  const fullNewPath = path.join(workspacePath, newPath)
  
  if (!fullOldPath.startsWith(workspacePath) || !fullNewPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  await fs.rename(fullOldPath, fullNewPath)
  return true
})

// Project management handlers
ipcMain.handle('intent:scan-refs', async () => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const refsPath = path.join(userDataPath, 'intent-workspace', 'refs')
  
  try {
    const items = await fs.readdir(refsPath, { withFileTypes: true })
    const refs = items
      .filter(item => item.isDirectory())
      .map(item => ({
        id: item.name,
        name: item.name,
        path: path.join('refs', item.name)
      }))
    return refs
  } catch (error) {
    console.error('Error scanning refs:', error)
    return []
  }
})

ipcMain.handle('intent:check-metadata-exists', async (event, filePath) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  const fullPath = path.join(workspacePath, filePath)
  
  try {
    await fs.access(fullPath)
    return true
  } catch {
    return false
  }
})
