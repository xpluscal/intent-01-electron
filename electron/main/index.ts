import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
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
  // Check for Git installation
  try {
    const { stdout } = await execAsync('git --version')
    console.log('Git is installed:', stdout.trim())
  } catch (error) {
    console.warn('Git is not installed. Some features may not work properly.')
    // We'll handle the installation prompt in the renderer process
  }
  
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
  
  // Check if it's a directory
  const stat = await fs.stat(fullPath)
  if (stat.isDirectory()) {
    await fs.rm(fullPath, { recursive: true, force: true })
  } else {
    await fs.unlink(fullPath)
  }
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

ipcMain.handle('intent:copy-file', async (event, sourcePath, destPath) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullDestPath = path.join(workspacePath, destPath)
  if (!fullDestPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Destination path outside workspace')
  }
  
  // Ensure destination directory exists
  const destDir = path.dirname(fullDestPath)
  await fs.mkdir(destDir, { recursive: true })
  
  // Copy the file
  await fs.copyFile(sourcePath, fullDestPath)
  return true
})

ipcMain.handle('intent:write-file-buffer', async (event, filePath, buffer) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullPath = path.join(workspacePath, filePath)
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  // Ensure directory exists
  const dir = path.dirname(fullPath)
  await fs.mkdir(dir, { recursive: true })
  
  // Write the buffer to file
  await fs.writeFile(fullPath, Buffer.from(buffer))
  return true
})

ipcMain.handle('intent:get-file-url', async (event, filePath) => {
  const { promises: fs } = await import('node:fs')
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  
  const fullPath = path.join(workspacePath, filePath)
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  // Read file and return as data URL
  const buffer = await fs.readFile(fullPath)
  const ext = path.extname(filePath).toLowerCase().slice(1)
  
  // Determine MIME type
  let mimeType = 'application/octet-stream'
  const mimeTypes: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    // Videos
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    mkv: 'video/x-matroska',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    wma: 'audio/x-ms-wma',
    m4a: 'audio/mp4'
  }
  
  if (ext in mimeTypes) {
    mimeType = mimeTypes[ext]
  }
  
  // Return data URL
  return `data:${mimeType};base64,${buffer.toString('base64')}`
})

// Git-related handlers
const execAsync = promisify(exec)

// Check if Git is installed
ipcMain.handle('intent:check-git', async () => {
  try {
    const { stdout } = await execAsync('git --version')
    return { installed: true, version: stdout.trim() }
  } catch (error) {
    return { installed: false }
  }
})

// Initialize Git repository
ipcMain.handle('intent:init-git', async (event, refPath) => {
  const userDataPath = app.getPath('userData')
  const workspacePath = path.join(userDataPath, 'intent-workspace')
  const fullPath = path.join(workspacePath, refPath)
  
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: Path outside workspace')
  }
  
  try {
    // Initialize git repo
    await execAsync('git init', { cwd: fullPath })
    
    // Create .gitignore
    const gitignoreContent = `# Intent Worker
.DS_Store
node_modules/
*.log
.env
.env.local
`
    const { promises: fs } = await import('node:fs')
    await fs.writeFile(path.join(fullPath, '.gitignore'), gitignoreContent)
    
    // Initial commit
    await execAsync('git add .', { cwd: fullPath })
    await execAsync('git commit -m "Initial commit"', { cwd: fullPath })
    
    return { success: true }
  } catch (error) {
    console.error('Git init error:', error)
    return { success: false, error: error.message }
  }
})

// Install Git if not present (macOS/Windows)
ipcMain.handle('intent:install-git', async () => {
  const platform = os.platform()
  
  try {
    if (platform === 'darwin') {
      // On macOS, try to trigger Xcode command line tools installation
      // This will prompt the user to install if not present
      await execAsync('xcode-select --install')
      return { success: true, message: 'Git installation initiated. Please follow the system prompts.' }
    } else if (platform === 'win32') {
      // On Windows, open the Git download page
      shell.openExternal('https://git-scm.com/download/win')
      return { success: true, message: 'Please download and install Git from the opened webpage.' }
    } else {
      // On Linux, provide package manager commands
      return { 
        success: false, 
        message: 'Please install Git using your package manager:\n' +
                 'Ubuntu/Debian: sudo apt-get install git\n' +
                 'Fedora: sudo dnf install git\n' +
                 'Arch: sudo pacman -S git'
      }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})
