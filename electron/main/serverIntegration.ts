import { app as electronApp, BrowserWindow } from 'electron'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

// Import server modules directly as TypeScript
import express from 'express'
import cors from 'cors'
import { Database } from './server/db.js'
import { createLogger } from './server/logger.js'
import { config } from './server/config.js'
import { Events } from './server/constants.js'
import WorkspaceManager from './server/services/WorkspaceManager.js'
import ProcessManager from './server/processManager.js'
import StreamHandler from './server/streamHandler.js'
import IntegrationManager from './server/services/IntegrationManager.js'
import RefManager from './server/services/RefManager.js'
import ResourceMonitor from './server/services/ResourceMonitor.js'
import AuditLogger from './server/services/AuditLogger.js'
import PerformanceMonitor from './server/services/PerformanceMonitor.js'
import ClaudeSDKManager from './server/claudeSDKManager.js'
import PreviewManager from './server/preview/previewManager.js'

// Import routes
import executeRoutes from './server/routes/execute.js'
import statusRoutes from './server/routes/status.js'
import messageRoutes from './server/routes/message.js'
import logsRoutes from './server/routes/logs.js'
import filesRoutes from './server/routes/files.js'
import previewRoutes from './server/routes/preview.js'
import refsRoutes from './server/routes/refs.js'
import refPreviewRoutes from './server/routes/refPreview.js'
import cleanupRoutes from './server/routes/cleanup.js'
import resourcesRoutes from './server/routes/resources.js'
import monitoringRoutes from './server/routes/monitoring.js'
import executionFilesRoutes from './server/routes/executionFiles.js'
import authRoutes from './server/routes/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface ServerOptions {
  port?: number
  workspace?: string
}

export class IntentServer {
  private server: any
  private db: Database | null = null
  private eventEmitter: EventEmitter
  private isRunning: boolean = false
  private port: number
  private _mainWindow: BrowserWindow | null = null

  constructor(options: ServerOptions = {}) {
    this.port = options.port || 3000
    this.eventEmitter = new EventEmitter()
  }
  
  setMainWindow(window: BrowserWindow) {
    this._mainWindow = window
  }
  
  get mainWindow() {
    return this._mainWindow
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Intent server is already running')
      return
    }

    try {
      const logger = createLogger('serverIntegration')

      // Create Express app
      const app = express()

      // Middleware
      app.use(express.json())
      app.use(cors({
        origin: ['http://localhost:5173', 'http://localhost:3001'], // Allow Vite dev server and React app
        credentials: true
      }))

      // Request logging middleware
      app.use((req: any, res: any, next: any) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`)
        next()
      })

      // Health check endpoint
      app.get('/health', (req: any, res: any) => {
        res.json({ 
          status: 'ok', 
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          electron: true
        })
      })

      // Use Electron's userData directory for workspace
      const userDataPath = electronApp.getPath('userData')
      const workspacePath = path.join(userDataPath, 'intent-workspace')

      // Initialize services

      // Initialize workspace
      const workspaceManager = new WorkspaceManager(workspacePath)
      const workspace = await workspaceManager.initialize()
      
      // Store workspace paths globally for use in endpoints
      app.locals.workspace = workspace
      app.locals.workspaceManager = workspaceManager
      
      // Initialize database with workspace-specific path
      const dbPath = path.join(workspace.dataDir, 'agent-wrapper.db')
      this.db = new Database(dbPath)
      await this.db.initialize()
      
      // Make db, eventEmitter, and server instance available to routes
      app.locals.db = this.db
      app.locals.eventEmitter = this.eventEmitter
      app.locals.config = config
      app.locals.server = this
      
      // Initialize managers
      app.locals.processManager = new ProcessManager(this.db, config, this.eventEmitter)
      app.locals.streamHandler = new StreamHandler(this.db, this.eventEmitter)
      
      // Initialize audit logger
      app.locals.auditLogger = new AuditLogger(this.db)
      
      // Initialize performance monitor with audit logger
      app.locals.performanceMonitor = new PerformanceMonitor(app.locals.auditLogger)
      
      // Initialize integration manager with instrumented ref manager
      const refManager = new RefManager(workspace.workspace, app.locals.performanceMonitor)
      app.locals.integrationManager = new IntegrationManager(workspaceManager, refManager, null, null, this.db)
      
      // Initialize resource monitor
      app.locals.resourceMonitor = new ResourceMonitor(workspaceManager, this.db, {
        maxConcurrentExecutions: process.env.MAX_CONCURRENT_EXECUTIONS || 100,
        maxDiskUsageMB: process.env.MAX_DISK_USAGE_MB || 10000,
        maxExecutionTimeMinutes: process.env.MAX_EXECUTION_TIME_MINUTES || 60,
        checkInterval: process.env.RESOURCE_CHECK_INTERVAL || 300000 // 5 minutes
      })
      
      // Start resource monitoring
      app.locals.resourceMonitor.start()

      // Serve static files from the React build directory in production
      if (electronApp.isPackaged) {
        const staticPath = path.join(process.env.APP_ROOT || '', 'dist')
        console.log('Serving static files from:', staticPath)
        
        // Serve static assets
        app.use(express.static(staticPath))
        
        // Handle client-side routing - serve index.html for all non-API routes
        app.get(/^(?!\/api|\/execute|\/status|\/message|\/logs|\/files|\/preview|\/refs|\/cleanup|\/resources|\/monitoring|\/auth|\/health).*/, (req, res) => {
          res.sendFile(path.join(staticPath, 'index.html'))
        })
      }

      // Set up routes

      app.use('/', authRoutes)
      app.use('/', executeRoutes)
      app.use('/', statusRoutes)
      app.use('/', messageRoutes)
      app.use('/', logsRoutes)
      app.use('/', filesRoutes)
      app.use('/preview', previewRoutes)
      app.use('/', refsRoutes)
      app.use('/', refPreviewRoutes)
      app.use('/', cleanupRoutes)
      app.use('/', resourcesRoutes)
      app.use('/', monitoringRoutes)
      app.use('/', executionFilesRoutes)

      // Error handling middleware
      app.use((err: any, req: any, res: any, next: any) => {
        console.error('Error:', err)
        
        // Handle different error types
        if (err.name === 'ValidationError') {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: err.message,
              details: err.details || {}
            }
          })
        }
        
        if (err.name === 'NotFoundError') {
          return res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: err.message
            }
          })
        }
        
        // Default to 500 internal server error
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
          }
        })
      })

      // 404 handler
      app.use((req: any, res: any) => {
        res.status(404).json({
          error: {
            code: 'ENDPOINT_NOT_FOUND',
            message: `Endpoint ${req.method} ${req.path} not found`
          }
        })
      })

      // Start server
      this.server = app.listen(this.port, () => {
        logger.info(`Intent server running on port ${this.port}`)
        logger.info(`Workspace: ${workspace.workspace}`)
        this.isRunning = true
      })

      // Initialize Claude SDK Manager
      app.locals.claudeSDKManager = new ClaudeSDKManager(
        this.db, 
        config, 
        this.eventEmitter,
        workspaceManager
      )

      // Initialize Preview Manager
      app.locals.previewManager = new PreviewManager(this.db, app.locals.processManager, this.eventEmitter)

      // Listen for process exit events to trigger integration
      this.eventEmitter.on(Events.PROCESS_EXIT, async ({ executionId, code }: any) => {
        logger.info(`Process exited for execution ${executionId} with code ${code}`)
        
        // Only integrate on successful completion
        if (code === 0) {
          // Check if this execution has references
          const refs = await this.db.all(
            'SELECT DISTINCT ref_id FROM execution_refs WHERE execution_id = ?',
            [executionId]
          )
          
          if (refs.length > 0) {
            logger.info(`Starting integration for execution ${executionId} with ${refs.length} references`)
            
            // Run integration asynchronously
            setTimeout(async () => {
              try {
                const result = await app.locals.integrationManager.integrateExecutionChanges(executionId, {
                  commitMessage: `Changes from execution ${executionId}`,
                  merge: true,
                  cleanup: false  // Keep execution workspace for message resume
                })
                
                if (result.success) {
                  logger.info(`Integration completed successfully for execution ${executionId}`)
                } else {
                  logger.error(`Integration failed for execution ${executionId}:`, result.error)
                }
              } catch (error) {
                logger.error(`Integration error for execution ${executionId}:`, error)
              }
            }, 1000) // Small delay to ensure all logs are flushed
          }
        }
      })

    } catch (error) {
      console.error('Failed to start Intent server:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    const logger = createLogger('serverIntegration')
    
    logger.info('Shutting down Intent server...')
    
    // Stop all preview processes
    if (this.server && this.server.locals && this.server.locals.previewManager) {
      try {
        await this.server.locals.previewManager.stopAllPreviews()
        logger.info('All previews stopped')
      } catch (error) {
        logger.error('Error stopping previews:', error)
      }
    }
    
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          logger.info('HTTP server closed')
          resolve()
        })
      })
    }
    
    if (this.db) {
      await this.db.close()
    }
    
    this.isRunning = false
  }

  getPort(): number {
    return this.port
  }

  isServerRunning(): boolean {
    return this.isRunning
  }
}