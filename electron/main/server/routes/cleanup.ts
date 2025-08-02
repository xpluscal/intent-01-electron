import express from 'express';
import { createLogger } from '../logger.js';
import CleanupManager from '../services/CleanupManager.js';
import RefManager from '../services/RefManager.js';
import ExecutionContextManager from '../services/ExecutionContextManager.js';
import * as validators from '../validators.js';
import { NotFoundError, ProcessError, createErrorResponse } from '../errors.js';
import { ErrorCodes, ExecutionStatus } from '../constants.js';

const logger = createLogger('cleanup-routes');
const router = express.Router();

// POST /executions/:executionId/cleanup - Clean up a specific execution
router.post('/executions/:executionId/cleanup', async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { force = false, keepBranches = false, keepWorkspace = false } = req.body;
    
    const { workspaceManager, db } = req.app.locals;
    const refManager = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager);
    const cleanupManager = new CleanupManager(workspaceManager, refManager, contextManager, db);
    
    logger.info(`Manual cleanup requested for execution ${executionId}`, { force, keepBranches, keepWorkspace });
    
    const results = await cleanupManager.cleanupExecution(executionId, {
      force,
      keepBranches,
      keepWorkspace
    });
    
    res.json({
      executionId,
      cleanup: results
    });
    
  } catch (error) {
    logger.error('Cleanup error:', error);
    next(error);
  }
});

// POST /executions/:executionId/rollback - Rollback an execution
router.post('/executions/:executionId/rollback', async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { reason = 'Manual rollback requested' } = req.body;
    
    const { workspaceManager, db } = req.app.locals;
    const refManager = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager);
    const cleanupManager = new CleanupManager(workspaceManager, refManager, contextManager, db);
    
    logger.info(`Rollback requested for execution ${executionId}`, { reason });
    
    const result = await cleanupManager.rollbackExecution(executionId, reason);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({
        error: {
          code: 'ROLLBACK_FAILED',
          message: result.error
        }
      });
    }
    
  } catch (error) {
    logger.error('Rollback error:', error);
    next(error);
  }
});

// GET /executions/:executionId/cleanup/status - Get cleanup status
router.get('/executions/:executionId/cleanup/status', async (req, res, next) => {
  try {
    const { executionId } = req.params;
    
    const { workspaceManager, db } = req.app.locals;
    const refManager = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager);
    const cleanupManager = new CleanupManager(workspaceManager, refManager, contextManager, db);
    
    const status = await cleanupManager.getCleanupStatus(executionId);
    
    if (status) {
      res.json({
        executionId,
        cleanupStatus: status
      });
    } else {
      res.status(404).json({
        error: {
          code: 'NO_CLEANUP_STATUS',
          message: 'No cleanup status found for this execution'
        }
      });
    }
    
  } catch (error) {
    logger.error('Get cleanup status error:', error);
    next(error);
  }
});

// POST /cleanup/orphaned - Clean up orphaned executions
router.post('/cleanup/orphaned', async (req, res, next) => {
  try {
    const { olderThanHours = 24 } = req.body;
    
    const { workspaceManager, db } = req.app.locals;
    const refManager = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager);
    const cleanupManager = new CleanupManager(workspaceManager, refManager, contextManager, db);
    
    logger.info(`Cleaning orphaned executions older than ${olderThanHours} hours`);
    
    const results = await cleanupManager.cleanupOrphanedExecutions(olderThanHours);
    
    res.json({
      olderThanHours,
      results
    });
    
  } catch (error) {
    logger.error('Orphaned cleanup error:', error);
    next(error);
  }
});

/**
 * DELETE /executions/:executionId/workspace - Delete execution workspace manually
 */
router.delete('/executions/:executionId/workspace', async (req, res, next) => {
  try {
    const executionId = validators.validateExecutionId(req.params.executionId);
    const { workspaceManager, db } = req.app.locals;
    
    // Check if execution exists
    const execution = await db.get(
      'SELECT id, status FROM executions WHERE id = ?',
      [executionId]
    );
    
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    
    // Only allow cleanup of completed/failed executions
    if (execution.status === ExecutionStatus.RUNNING || execution.status === ExecutionStatus.STARTING) {
      throw new ProcessError(
        ErrorCodes.PROCESS_RUNNING,
        `Cannot delete workspace for running execution (status: ${execution.status})`
      );
    }
    
    logger.info(`Manual workspace deletion requested for execution ${executionId}`);
    
    // Initialize cleanup manager
    const refManager = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager);
    const cleanupManager = new CleanupManager(workspaceManager, refManager, contextManager, db);
    
    // Perform cleanup
    const results = await cleanupManager.cleanupExecution(executionId, {
      keepBranches: true,  // Still preserve branches for audit
      keepWorkspace: false,
      updateDatabase: true
    });
    
    // Update workspace_preserved flag
    await db.run(
      'UPDATE executions SET workspace_preserved = 0 WHERE id = ?',
      [executionId]
    );
    
    res.json({
      success: results.success,
      executionId,
      cleanup: results
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