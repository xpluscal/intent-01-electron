import express from 'express';
import cors from 'cors';
import { EventEmitter } from 'node:events';
import { program } from 'commander';
import path from 'node:path';
import config from './config.js';
import ProcessManager from './processManager.js';
import StreamHandler from './streamHandler.js';
import { createLogger } from './logger.js';
import Database from './db.js';
import WorkspaceManager from './services/WorkspaceManager.js';
import IntegrationManager from './services/IntegrationManager.js';
import RefManager from './services/RefManager.js';
import ResourceMonitor from './services/ResourceMonitor.js';
import AuditLogger from './services/AuditLogger.js';
import PerformanceMonitor from './services/PerformanceMonitor.js';
import { Events } from './constants.js';

const logger = createLogger('server');

const app = express();
const eventEmitter = new EventEmitter();

// Middleware
app.use(express.json());
app.use(cors({
  origin: config.server.corsOrigins,
  credentials: true
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Routes
import executeRoutes from './routes/execute.js';
import statusRoutes from './routes/status.js';
import messageRoutes from './routes/message.js';
import logsRoutes from './routes/logs.js';
import filesRoutes from './routes/files.js';
import previewRoutes from './routes/preview.js';
import refsRoutes from './routes/refs.js';
import cleanupRoutes from './routes/cleanup.js';
import resourcesRoutes from './routes/resources.js';
import monitoringRoutes from './routes/monitoring.js';
import executionFilesRoutes from './routes/executionFiles.js';

app.use('/', executeRoutes);
app.use('/', statusRoutes);
app.use('/', messageRoutes);
app.use('/', logsRoutes);
app.use('/', filesRoutes);
app.use('/preview', previewRoutes);
app.use('/', refsRoutes);
app.use('/', cleanupRoutes);
app.use('/', resourcesRoutes);
app.use('/', monitoringRoutes);
app.use('/', executionFilesRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Handle different error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: err.details || {}
      }
    });
  }
  
  if (err.name === 'NotFoundError') {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: err.message
      }
    });
  }
  
  // Default to 500 internal server error
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'ENDPOINT_NOT_FOUND',
      message: `Endpoint ${req.method} ${req.path} not found`
    }
  });
});

// Graceful shutdown handling
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

let server;
let db;
let resourceMonitor;

async function shutdown() {
  logger.info('Shutting down gracefully...');
  
  if (resourceMonitor) {
    resourceMonitor.stop();
  }
  
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }
  
  if (db) {
    await db.close();
  }
  
  process.exit(0);
}

async function start(options) {
  try {
    // Initialize workspace
    const workspaceManager = new WorkspaceManager(options.workspace);
    const workspace = await workspaceManager.initialize();
    
    // Store workspace paths globally for use in endpoints
    app.locals.workspace = workspace;
    app.locals.workspaceManager = workspaceManager;
    
    // Initialize database with workspace-specific path
    const dbPath = path.join(workspace.dataDir, 'agent-wrapper.db');
    db = new Database(dbPath);
    await db.initialize();
    
    // Make db, config, and eventEmitter available to routes
    app.locals.db = db;
    app.locals.eventEmitter = eventEmitter;
    app.locals.config = config;
    
    // Initialize managers
    app.locals.processManager = new ProcessManager(db, config, eventEmitter);
    app.locals.streamHandler = new StreamHandler(db, eventEmitter);
    
    // Recovery function for running executions
    async function recoverRunningExecutions() {
      logger.info('Checking for executions to recover...');
      
      try {
        // First, clean up stale preview processes
        logger.info('Cleaning up stale preview processes...');
        const runningPreviews = await db.all(`
          SELECT * FROM preview_processes 
          WHERE status IN ('running', 'starting', 'installing')
        `);
        
        if (runningPreviews.length > 0) {
          logger.info(`Found ${runningPreviews.length} previews marked as running, verifying...`);
          for (const preview of runningPreviews) {
            let isActuallyRunning = false;
            
            // Check if process is actually running
            if (preview.pid) {
              try {
                process.kill(preview.pid, 0);
                isActuallyRunning = true;
                logger.info(`Preview ${preview.id} process ${preview.pid} is still running`);
              } catch (error) {
                logger.info(`Preview ${preview.id} process ${preview.pid} is not running`);
              }
            }
            
            if (!isActuallyRunning) {
              // Update status to stopped
              await db.run(
                'UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?',
                ['stopped', 'Server restarted', preview.id]
              );
              logger.info(`Updated preview ${preview.id} status to stopped`);
            }
          }
        }
        
        // Find executions that were running with recent heartbeat
        const runningExecutions = await db.all(`
          SELECT * FROM executions 
          WHERE status = 'running' 
          AND last_heartbeat > datetime('now', '-5 minutes')
        `);
        
        if (runningExecutions.length === 0) {
          logger.info('No executions to recover');
          return;
        }
        
        logger.info(`Found ${runningExecutions.length} executions to recover`);
        
        // Initialize Claude SDK Manager if needed
        if (!app.locals.claudeSDKManager) {
          const { default: ClaudeSDKManager } = await import('./claudeSDKManager.js');
          app.locals.claudeSDKManager = new ClaudeSDKManager(
            db, 
            config, 
            eventEmitter,
            workspaceManager
          );
        }
        
        // Initialize Preview Manager if needed
        const { default: PreviewManager } = await import('./preview/previewManager.js');
        const previewManager = new PreviewManager(db, app.locals.processManager, eventEmitter);
        
        for (const exec of runningExecutions) {
          try {
            logger.info(`Attempting to recover execution ${exec.id}`);
            
            // Resume Claude SDK session if exists
            if (exec.session_id && exec.agent_type === 'claude') {
              logger.info(`Resuming Claude session for execution ${exec.id}`, {
                executionId: exec.id,
                sessionId: exec.session_id,
                agentType: exec.agent_type,
                lastHeartbeat: exec.last_heartbeat,
                action: 'recovery_resume_session'
              });
              await app.locals.claudeSDKManager.resumeSession(exec.id, exec.session_id);
            } else if (exec.agent_type !== 'claude') {
              logger.info(`Skipping non-Claude execution recovery`, {
                executionId: exec.id,
                agentType: exec.agent_type,
                action: 'recovery_skip_non_claude'
              });
            } else {
              logger.warn(`Claude execution missing session_id`, {
                executionId: exec.id,
                hasSessionId: !!exec.session_id,
                action: 'recovery_missing_session'
              });
            }
            
            // Restart previews that were running
            const previews = await db.all(
              'SELECT * FROM preview_processes WHERE execution_id = ? AND status = ?',
              [exec.id, 'running']
            );
            
            for (const preview of previews) {
              logger.info(`Restarting preview ${preview.id} for execution ${exec.id}`);
              try {
                await previewManager.restartPreview(preview);
              } catch (error) {
                logger.error(`Failed to restart preview ${preview.id}:`, error);
                // Continue with other previews
              }
            }
          } catch (error) {
            logger.error(`Failed to recover execution ${exec.id}:`, error);
            // Continue with other executions
          }
        }
        
        // Clean up stale executions (heartbeat older than 5 minutes)
        const staleCount = await db.run(`
          UPDATE executions 
          SET status = 'failed',
              completed_at = CURRENT_TIMESTAMP,
              phase = 'failed'
          WHERE status = 'running' 
          AND last_heartbeat < datetime('now', '-5 minutes')
        `);
        
        if (staleCount?.changes > 0) {
          logger.info(`Marked ${staleCount.changes} stale executions as failed`);
        }
      } catch (error) {
        logger.error('Error during execution recovery:', error);
      }
    }
    
    // Run recovery after initialization
    await recoverRunningExecutions();
    
    // Listen for buffer flush events
    eventEmitter.on('buffer:flush', async ({ executionId }) => {
      await app.locals.streamHandler.flushBuffer(executionId);
    });
    
    // Initialize audit logger
    app.locals.auditLogger = new AuditLogger(db);
    
    // Initialize performance monitor with audit logger
    app.locals.performanceMonitor = new PerformanceMonitor(app.locals.auditLogger);
    
    // Initialize integration manager with instrumented ref manager
    const refManager = new RefManager(workspace.workspace, app.locals.performanceMonitor);
    app.locals.integrationManager = new IntegrationManager(workspaceManager, refManager, null, null, db);
    
    // Initialize resource monitor
    app.locals.resourceMonitor = new ResourceMonitor(workspaceManager, db, {
      maxConcurrentExecutions: process.env.MAX_CONCURRENT_EXECUTIONS || 100,
      maxDiskUsageMB: process.env.MAX_DISK_USAGE_MB || 10000,
      maxExecutionTimeMinutes: process.env.MAX_EXECUTION_TIME_MINUTES || 60,
      checkInterval: process.env.RESOURCE_CHECK_INTERVAL || 300000 // 5 minutes
    });
    
    // Start resource monitoring
    app.locals.resourceMonitor.start();
    resourceMonitor = app.locals.resourceMonitor;
    
    // Listen for process exit events to trigger integration
    eventEmitter.on(Events.PROCESS_EXIT, async ({ executionId, code }) => {
      logger.info(`Process exited for execution ${executionId} with code ${code}`);
      
      // Only integrate on successful completion
      if (code === 0) {
        // Check if this execution has references
        const refs = await db.all(
          'SELECT DISTINCT ref_id FROM execution_refs WHERE execution_id = ?',
          [executionId]
        );
        
        if (refs.length > 0) {
          logger.info(`Starting integration for execution ${executionId} with ${refs.length} references`);
          
          // Run integration asynchronously
          setTimeout(async () => {
            try {
              const result = await app.locals.integrationManager.integrateExecutionChanges(executionId, {
                commitMessage: `Changes from execution ${executionId}`,
                merge: true,
                cleanup: false  // Keep execution workspace for message resume
              });
              
              if (result.success) {
                logger.info(`Integration completed successfully for execution ${executionId}`);
              } else {
                logger.error(`Integration failed for execution ${executionId}:`, result.error);
              }
            } catch (error) {
              logger.error(`Integration error for execution ${executionId}:`, error);
            }
          }, 1000); // Small delay to ensure all logs are flushed
        }
      }
    });
    
    // Start server
    const port = options.port || config.server.port;
    server = app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
      logger.info(`Workspace: ${workspace.workspace}`);
      logger.info(`CORS enabled for: ${config.server.corsOrigins.join(', ')}`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Export for testing
export { app, eventEmitter };

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Parse command line arguments
  program
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('-p, --port <number>', 'Server port', parseInt)
    .option('-c, --config <path>', 'Config file path')
    .parse(process.argv);
  
  const options = program.opts();
  start(options);
}