import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ProcessManager from '../processManager.js';
import ClaudeSDKManager from '../claudeSDKManager.js';
import StreamHandler from '../streamHandler.js';
import * as validators from '../validators.js';
import { createErrorResponse } from '../errors.js';
import { ExecutionStatus, Events } from '../constants.js';
import { createLogger } from '../logger.js';
import ExecutionContextManager from '../services/ExecutionContextManager.js';
import RefManager from '../services/RefManager.js';
import PreviewManager from '../preview/previewManager.js';
import { config } from '../config.js';

const logger = createLogger('routes/execute');

const router = express.Router();

router.post('/execute', async (req, res, next) => {
  try {
    // Validate input
    const agent = validators.validateAgent(req.body.agent);
    const prompt = validators.validatePrompt(req.body.prompt);
    
    // workingDir is optional - if not provided, we'll use the execution workspace
    const providedWorkingDir = req.body.workingDir;
    let workingDir = null;
    if (providedWorkingDir) {
      workingDir = validators.validateWorkingDir(providedWorkingDir);
    }
    
    // Validate references if provided
    const refs = req.body.refs || {};
    if (refs.read && !Array.isArray(refs.read)) {
      throw new validators.ValidationError('refs.read must be an array');
    }
    if (refs.mutate && !Array.isArray(refs.mutate)) {
      throw new validators.ValidationError('refs.mutate must be an array');
    }
    if (refs.create && !Array.isArray(refs.create)) {
      throw new validators.ValidationError('refs.create must be an array');
    }

    // Generate execution ID
    const executionId = uuidv4();
    
    // Get dependencies from app locals
    const { db, eventEmitter, workspaceManager, resourceMonitor, auditLogger, performanceMonitor } = req.app.locals;
    
    // Helper to emit phase updates and update database
    const emitPhase = async (phase, message) => {
      const timestamp = new Date().toISOString();
      
      // Update phase in database
      await db.run(
        'UPDATE executions SET phase = ?, last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?',
        [phase, executionId]
      );
      
      // Emit log event
      eventEmitter.emit(Events.LOG_ENTRY, {
        executionId,
        timestamp,
        type: 'system',
        content: JSON.stringify({
          type: 'system',
          subtype: 'phase',
          phase,
          message
        })
      });
    };
    
    // Emit starting phase
    await emitPhase('starting', 'Execution started');
    
    // Check resource limits before starting execution
    if (resourceMonitor) {
      const canExecute = await resourceMonitor.canStartExecution();
      if (!canExecute) {
        const checks = await Promise.all([
          resourceMonitor.checkConcurrentExecutions(),
          resourceMonitor.checkDiskUsage(),
          resourceMonitor.checkSystemResources()
        ]);
        
        const blockedBy = checks.filter(check => !check.allowed);
        const reasons = blockedBy.map(check => check.message).filter(Boolean);
        
        return res.status(429).json({
          error: {
            code: 'RESOURCE_LIMIT_EXCEEDED',
            message: 'Cannot start execution due to resource limits',
            details: {
              blockedBy: blockedBy.map(check => check.type),
              reasons
            }
          }
        });
      }
    }
    
    // Create execution record FIRST so it exists for auto-preview
    await db.run(
      `INSERT INTO executions (id, agent_type, status, working_dir, workspace_path, phase, last_heartbeat) 
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [executionId, agent, ExecutionStatus.STARTING, workingDir || process.cwd(), 
       null, 'starting'] // workspace_path will be updated later
    );

    // Set up execution workspace if references are provided
    let executionWorkspace = null;
    let actualWorkingDir = workingDir || process.cwd();
    
    if (refs.read?.length > 0 || refs.mutate?.length > 0 || refs.create?.length > 0) {
      // Initialize ExecutionContextManager with PreviewManager
      const workspacePath = workspaceManager.getWorkspacePath();
      const refManager = new RefManager(workspacePath, performanceMonitor);
      const previewManager = new PreviewManager(db, req.app.locals.processManager, eventEmitter);
      const contextManager = new ExecutionContextManager(workspaceManager, refManager, previewManager);
      
      try {
        await emitPhase('copying_files', 'Setting up project files and references');
        
        // Set up execution workspace with references
        executionWorkspace = await contextManager.setupExecutionWorkspace(executionId, refs);
        
        // Use the execution workspace as the working directory
        actualWorkingDir = executionWorkspace.executionPath;
        
        // Update the execution record with workspace path
        await db.run(
          'UPDATE executions SET workspace_path = ?, working_dir = ? WHERE id = ?',
          [executionWorkspace.executionPath, actualWorkingDir, executionId]
        );
        
        // Create CLAUDE.md file with execution context
        const claudeMdContent = `# Execution Context

## Execution ID: ${executionId}
Created: ${new Date().toISOString()}

## Your Task
${prompt}

## Important Instructions
1. **ALWAYS read the references FIRST** before making any changes
2. **Show fast, incremental results**: Update components one by one so progress is visible
3. **Make small commits** rather than one large change at the end
4. **Keep the preview running** so the user can see your progress

## Available References

### Mutate (You will modify these)
${refs.mutate && refs.mutate.length > 0 ? refs.mutate.map(refId => 
  `- **${refId}** - Located at: mutate/${refId}/`
).join('\n') : 'No mutate references provided.'}

### Read (Read these for context - DO NOT MODIFY)
${refs.read && refs.read.length > 0 ? refs.read.map(refId => 
  `- **${refId}** - Located at: read/${refId}/`
).join('\n') : 'No read references provided.'}

### Create (Empty directories for new content)
${refs.create && refs.create.length > 0 ? refs.create.map(dir => 
  `- **${dir}** - Located at: create/${dir}/`
).join('\n') : 'No create directories provided.'}

## Workspace Structure
- **read/** - Contains read-only reference files. Read these first for context.
- **mutate/** - Contains files you should modify to complete the task.
- **create/** - Empty directories where you can create new content.

## Git Information
- Each mutate reference has its own git worktree
- You can make commits in the mutate directories
- Your changes are isolated to this execution

## Remember
1. Start by reading ALL files in the read/ directory to understand the context
2. Focus on incremental, visible progress
3. The user wants to see results quickly - update the main components first
4. Make the preview functional as early as possible
`;

        await fs.writeFile(
          path.join(executionWorkspace.executionPath, 'CLAUDE.md'),
          claudeMdContent
        );
        
        // Now start any pending previews (after workspace_path is updated)
        await contextManager.startPendingPreviews();
        
        logger.info('Execution workspace created', { 
          executionId, 
          workspace: executionWorkspace.executionPath,
          refs: executionWorkspace.manifest.refs 
        });
      } catch (error) {
        logger.error('Failed to set up execution workspace', { executionId, error });
        throw new validators.ValidationError(`Failed to set up references: ${error.message}`);
      }
    }

    // Log execution start event
    if (auditLogger) {
      await auditLogger.logExecutionEvent({
        executionId,
        event: 'started',
        phase: 'initialization',
        details: {
          agent,
          prompt: prompt.substring(0, 100), // First 100 chars for brevity
          workingDir: actualWorkingDir,
          hasReferences: !!(refs.read?.length || refs.mutate?.length || refs.create?.length),
          referenceCounts: {
            read: refs.read?.length || 0,
            mutate: refs.mutate?.length || 0,
            create: refs.create?.length || 0
          }
        }
      });
    }

    // Execution record already created above
    
    // Save reference associations if provided
    if (executionWorkspace) {
      const refInserts = [];
      
      for (const refId of refs.read || []) {
        refInserts.push(db.run(
          'INSERT INTO execution_refs (execution_id, ref_id, permission) VALUES (?, ?, ?)',
          [executionId, refId, 'read']
        ));
      }
      
      for (const refId of refs.mutate || []) {
        refInserts.push(db.run(
          'INSERT INTO execution_refs (execution_id, ref_id, permission) VALUES (?, ?, ?)',
          [executionId, refId, 'mutate']
        ));
      }
      
      for (const refId of refs.create || []) {
        refInserts.push(db.run(
          'INSERT INTO execution_refs (execution_id, ref_id, permission) VALUES (?, ?, ?)',
          [executionId, refId, 'create']
        ));
      }
      
      await Promise.all(refInserts);
    }

    // Use ClaudeSDKManager for Claude agent
    if (agent === 'claude') {
      // Initialize ClaudeSDKManager if not exists
      if (!req.app.locals.claudeSDKManager) {
        req.app.locals.claudeSDKManager = new ClaudeSDKManager(
          db, 
          req.app.locals.config || config, 
          eventEmitter,
          workspaceManager
        );
      }
      
      const claudeManager = req.app.locals.claudeSDKManager;
      
      // Start execution with SDK
      await claudeManager.startExecution(executionId, prompt, actualWorkingDir);
      
    } else {
      // Fall back to process spawning for other agents
      if (!req.app.locals.processManager) {
        req.app.locals.processManager = new ProcessManager(db, req.app.locals.config || config, eventEmitter);
      }
      if (!req.app.locals.streamHandler) {
        req.app.locals.streamHandler = new StreamHandler(db, eventEmitter);
      }

      const processManager = req.app.locals.processManager;
      const streamHandler = req.app.locals.streamHandler;

      // Spawn the process with the actual working directory
      const childProcess = await processManager.spawn(executionId, agent, prompt, actualWorkingDir, false);

      // Attach stream handlers
      childProcess.stdout.on('data', (data) => {
        logger.info('Process stdout', { executionId, length: data.length, preview: data.toString().substring(0, 100) });
        streamHandler.handleOutput(executionId, 'stdout', data);
      });

      childProcess.stderr.on('data', (data) => {
        logger.info('Process stderr', { executionId, length: data.length, preview: data.toString().substring(0, 100) });
        streamHandler.handleOutput(executionId, 'stderr', data);
      });
    }

    // Return response
    const response = {
      executionId,
      status: ExecutionStatus.STARTING,
      startedAt: new Date().toISOString(),
      workingDir: actualWorkingDir
    };
    
    // Add refs to response if present
    if (executionWorkspace) {
      response.refs = executionWorkspace.manifest.refs;
      response.workspace = {
        path: executionWorkspace.executionPath,
        directories: executionWorkspace.paths
      };
      
      // Include skipped references information
      if (executionWorkspace.skippedRefs) {
        const hasSkipped = executionWorkspace.skippedRefs.read.length > 0 || 
                          executionWorkspace.skippedRefs.mutate.length > 0;
        if (hasSkipped) {
          response.skippedRefs = executionWorkspace.skippedRefs;
          response.warnings = [`Skipped ${executionWorkspace.skippedRefs.read.length + executionWorkspace.skippedRefs.mutate.length} non-existent references`];
        }
      }
    }
    
    logger.info('Execution started', { executionId, agent, workingDir: actualWorkingDir, refs });
    res.status(201).json(response);

  } catch (error) {
    if (error.name === 'ValidationError') {
      logger.warn('Validation error', error);
      return res.status(400).json(createErrorResponse(error));
    }
    logger.error('Execution error', error);
    next(error);
  }
});

// Stop an execution
router.post('/stop/:executionId', async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { db, eventEmitter, claudeSDKManager, processManager } = req.app.locals;
    
    logger.info('Stopping execution', { executionId });
    
    // Check if execution exists
    const execution = await db.get(
      'SELECT * FROM executions WHERE id = ?',
      [executionId]
    );
    
    if (!execution) {
      return res.status(404).json({
        error: {
          code: 'EXECUTION_NOT_FOUND',
          message: `Execution ${executionId} not found`
        }
      });
    }
    
    // Check if already completed or cancelled
    if (execution.status === ExecutionStatus.COMPLETED || 
        execution.status === ExecutionStatus.CANCELLED ||
        execution.status === ExecutionStatus.ERROR) {
      return res.json({
        executionId,
        status: execution.status,
        message: 'Execution already stopped'
      });
    }
    
    // Stop the execution based on agent type
    if (execution.agent_type === 'claude' && claudeSDKManager) {
      await claudeSDKManager.stopExecution(executionId);
    } else if (processManager) {
      await processManager.stopProcess(executionId);
    }
    
    // Update status to completed
    await db.run(
      'UPDATE executions SET status = ?, phase = ? WHERE id = ?',
      [ExecutionStatus.COMPLETED, 'stopped', executionId]
    );
    
    // Emit cancellation event
    eventEmitter.emit(Events.LOG_ENTRY, {
      executionId,
      timestamp: new Date().toISOString(),
      type: 'system',
      content: JSON.stringify({
        type: 'system',
        subtype: 'stopped',
        message: 'Execution stopped by user'
      })
    });
    
    // Emit process exit event to trigger git integration (same as when Claude completes normally)
    eventEmitter.emit(Events.PROCESS_EXIT, { 
      executionId, 
      code: 0,  // Use code 0 to trigger git integration
      signal: null
    });
    
    logger.info('Execution stopped successfully', { executionId });
    
    res.json({
      executionId,
      status: ExecutionStatus.COMPLETED,
      message: 'Execution stopped successfully'
    });
    
  } catch (error) {
    logger.error('Failed to stop execution', { executionId: req.params.executionId, error });
    next(error);
  }
});

export default router;