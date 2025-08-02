import express from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as validators from '../validators.js';
import { NotFoundError, ProcessError, createErrorResponse } from '../errors.js';
import { ErrorCodes, ExecutionStatus } from '../constants.js';
import { createLogger } from '../logger.js';
import ClaudeSDKManager from '../claudeSDKManager.js';
import { config } from '../config.js';

const logger = createLogger('routes/message');
const router = express.Router();

router.post('/message/:executionId', async (req, res, next) => {
  try {
    // Validate input
    const executionId = validators.validateExecutionId(req.params.executionId);
    const message = validators.validateMessage(req.body.message);

    const { db, processManager } = req.app.locals;

    // Check if execution exists
    const execution = await db.get(
      'SELECT * FROM executions WHERE id = ?',
      [executionId]
    );

    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }

    // Use ClaudeSDKManager for Claude agent
    if (execution.agent_type === 'claude') {
      // Initialize ClaudeSDKManager if not exists
      if (!req.app.locals.claudeSDKManager) {
        const { eventEmitter, workspaceManager } = req.app.locals;
        req.app.locals.claudeSDKManager = new ClaudeSDKManager(
          db, 
          req.app.locals.config || config, 
          eventEmitter,
          workspaceManager
        );
      }
      
      const claudeManager = req.app.locals.claudeSDKManager;
      
      try {
        // Send message using SDK (it handles session resumption)
        await claudeManager.sendMessage(executionId, message);
        
        // Return success response
        res.json({
          success: true,
          continued: true,
          timestamp: new Date().toISOString()
        });
        return;
        
      } catch (error) {
        if (error.message === ErrorCodes.EXECUTION_NOT_FOUND) {
          throw new NotFoundError(`Execution not found: ${executionId}`);
        }
        throw new ProcessError(
          ErrorCodes.INTERNAL_ERROR,
          `Failed to send message: ${error.message}`
        );
      }
    }
    
    // For non-Claude agents, use the original process-based approach
    if (execution.status !== ExecutionStatus.RUNNING) {
      // Check if we can resume the execution
      if (execution.status === ExecutionStatus.COMPLETED || execution.status === ExecutionStatus.FAILED) {
        const { workspaceManager, eventEmitter } = req.app.locals;
        
        // Check if execution workspace still exists
        const workspacePath = path.join(
          workspaceManager.getWorkspacePath(),
          '.execution',
          `exec-${executionId}`
        );
        
        try {
          await fs.access(workspacePath);
          logger.info(`Resuming execution ${executionId} in existing workspace`);
          
          // Update execution status to running
          await db.run(
            'UPDATE executions SET status = ?, completed_at = NULL WHERE id = ?',
            [ExecutionStatus.RUNNING, executionId]
          );
          
          // Spawn new process in existing workspace with continuation flag
          const childProcess = await processManager.spawn(
            executionId,
            execution.agent_type,
            message,
            workspacePath,
            true  // isContinuation = true
          );
          
          // Get streamHandler
          const streamHandler = req.app.locals.streamHandler;
          
          // Attach stream handlers for logging
          childProcess.stdout.on('data', (data) => {
            logger.info('Process stdout', { executionId, length: data.length, preview: data.toString().substring(0, 100) });
            streamHandler.handleOutput(executionId, 'stdout', data);
          });

          childProcess.stderr.on('data', (data) => {
            logger.info('Process stderr', { executionId, length: data.length, preview: data.toString().substring(0, 100) });
            streamHandler.handleOutput(executionId, 'stderr', data);
          });
          
          // Emit process start event
          eventEmitter.emit('process-start', { executionId, pid: childProcess.pid });
          
          // Return success response
          res.json({
            success: true,
            resumed: true,
            timestamp: new Date().toISOString()
          });
          return;
          
        } catch (error) {
          // Workspace doesn't exist or can't be accessed
          throw new ProcessError(
            ErrorCodes.PROCESS_NOT_RUNNING,
            `Process is not running and workspace no longer exists (status: ${execution.status})`
          );
        }
      } else {
        throw new ProcessError(
          ErrorCodes.PROCESS_NOT_RUNNING,
          `Process is not running (status: ${execution.status})`
        );
      }
    }

    // For non-Claude agents that are already running
    // Process is running - stop it and restart with continuation flag
    if (!processManager) {
      throw new ProcessError(
        ErrorCodes.INTERNAL_ERROR,
        'ProcessManager not initialized'
      );
    }

    logger.info(`Stopping process for execution ${executionId} to restart with continuation`);
    
    // Stop the current process
    await processManager.stopProcess(executionId);
    
    // Reload execution data after stopping to get latest status
    const updatedExecution = await db.get(
      'SELECT * FROM executions WHERE id = ?',
      [executionId]
    );
    
    // Get workspace path
    const { workspaceManager, streamHandler, eventEmitter } = req.app.locals;
    const workspacePath = updatedExecution.working_dir || path.join(
      workspaceManager.getWorkspacePath(),
      '.execution',
      `exec-${executionId}`
    );
    
    // Restart process with continuation flag
    const childProcess = await processManager.spawn(
      executionId,
      updatedExecution.agent_type,
      message,
      workspacePath,
      true  // isContinuation = true
    );
    
    // Attach stream handlers for logging
    childProcess.stdout.on('data', (data) => {
      logger.info('Process stdout', { executionId, length: data.length, preview: data.toString().substring(0, 100) });
      streamHandler.handleOutput(executionId, 'stdout', data);
    });

    childProcess.stderr.on('data', (data) => {
      logger.info('Process stderr', { executionId, length: data.length, preview: data.toString().substring(0, 100) });
      streamHandler.handleOutput(executionId, 'stderr', data);
    });
    
    // Emit process start event
    eventEmitter.emit('process-start', { executionId, pid: childProcess.pid });

    // Return success response
    res.json({
      success: true,
      continued: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json(createErrorResponse(error));
    }
    if (error.name === 'NotFoundError') {
      return res.status(404).json(createErrorResponse(error));
    }
    if (error.name === 'ProcessError') {
      return res.status(400).json(createErrorResponse(error));
    }
    next(error);
  }
});

export default router;