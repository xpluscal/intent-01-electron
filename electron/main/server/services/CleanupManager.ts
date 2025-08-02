import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';

const logger = createLogger('CleanupManager');

class CleanupManager {
  constructor(workspaceManager, refManager, contextManager, db) {
    this.workspaceManager = workspaceManager;
    this.refManager = refManager;
    this.contextManager = contextManager;
    this.db = db;
  }

  /**
   * Clean up all resources for an execution
   */
  async cleanupExecution(executionId, options = {}) {
    logger.info(`Starting cleanup for execution ${executionId}`);
    const results = {
      success: true,
      worktrees: { removed: 0, failed: 0 },
      workspace: { removed: false },
      branches: { removed: 0, failed: 0 },
      errors: []
    };

    try {
      // Get execution manifest
      const manifest = await this.contextManager.getExecutionManifest(executionId);
      if (!manifest) {
        logger.warn(`No manifest found for execution ${executionId}, cleaning workspace only`);
        return await this.cleanupWorkspaceOnly(executionId, options);
      }

      // Clean up worktrees
      if (manifest.worktrees) {
        const worktreeResults = await this.cleanupWorktrees(executionId, manifest.worktrees, options);
        results.worktrees = worktreeResults;
      }

      // Clean up execution branches (after worktrees are removed)
      if (!options.keepBranches && manifest.worktrees) {
        const branchResults = await this.cleanupBranches(executionId, manifest.worktrees);
        results.branches = branchResults;
      }

      // Clean up execution workspace
      if (!options.keepWorkspace) {
        try {
          await this.contextManager.cleanupExecutionWorkspace(executionId);
          results.workspace.removed = true;
        } catch (error) {
          logger.error(`Failed to cleanup workspace for ${executionId}:`, error);
          results.errors.push({ type: 'workspace', error: error.message });
          results.success = false;
        }
      }

      // Update database
      if (options.updateDatabase !== false) {
        await this.updateCleanupStatus(executionId, results);
      }

    } catch (error) {
      logger.error(`Cleanup failed for execution ${executionId}:`, error);
      results.success = false;
      results.errors.push({ type: 'general', error: error.message });
    }

    logger.info(`Cleanup completed for execution ${executionId}`, results);
    return results;
  }

  /**
   * Clean up worktrees
   */
  async cleanupWorktrees(executionId, worktrees, options = {}) {
    const results = { removed: 0, failed: 0, details: {} };

    for (const [refId, worktreeInfo] of Object.entries(worktrees)) {
      try {
        logger.info(`Removing worktree for ref ${refId} in execution ${executionId}`);
        
        // Force removal if specified
        if (options.force) {
          // First try to remove any uncommitted changes
          try {
            await this.refManager.execGit(worktreeInfo.worktreePath, 'reset --hard HEAD');
            await this.refManager.execGit(worktreeInfo.worktreePath, 'clean -fd');
          } catch (e) {
            // Ignore errors in cleanup attempt
          }
        }

        await this.refManager.removeWorktree(refId, worktreeInfo.worktreePath);
        results.removed++;
        results.details[refId] = { success: true };
      } catch (error) {
        logger.error(`Failed to remove worktree for ref ${refId}:`, error);
        results.failed++;
        results.details[refId] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Clean up execution branches (DISABLED - we preserve branches for audit trail)
   */
  async cleanupBranches(executionId, worktrees) {
    const results = { removed: 0, failed: 0, details: {} };
    const branchName = `exec-${executionId}`;

    // NOTE: We intentionally preserve execution branches for audit trail
    // Each execution branch shows exactly what changes that execution made
    logger.info(`Preserving execution branch ${branchName} for audit trail`);
    
    for (const [refId, worktreeInfo] of Object.entries(worktrees)) {
      results.details[refId] = { 
        success: true, 
        action: 'preserved',
        message: 'Execution branch preserved for audit trail'
      };
    }

    return results;
  }

  /**
   * Clean up workspace when no manifest exists
   */
  async cleanupWorkspaceOnly(executionId, options = {}) {
    const results = {
      success: true,
      workspace: { removed: false },
      errors: []
    };

    if (!options.keepWorkspace) {
      try {
        const executionPath = path.join(this.workspaceManager.getWorkspacePath(), '.execution', `exec-${executionId}`);
        await fs.rm(executionPath, { recursive: true, force: true });
        results.workspace.removed = true;
      } catch (error) {
        logger.error(`Failed to cleanup workspace for ${executionId}:`, error);
        results.success = false;
        results.errors.push({ type: 'workspace', error: error.message });
      }
    }

    return results;
  }

  /**
   * Clean up orphaned executions older than specified hours
   */
  async cleanupOrphanedExecutions(olderThanHours = 24) {
    logger.info(`Cleaning up orphaned executions older than ${olderThanHours} hours`);
    const results = {
      checked: 0,
      cleaned: 0,
      failed: 0,
      errors: []
    };

    try {
      // Get all execution directories
      const executionsDir = path.join(this.workspaceManager.getWorkspacePath(), '.execution');
      const entries = await fs.readdir(executionsDir, { withFileTypes: true });
      
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('exec-')) {
          results.checked++;
          const executionId = entry.name.substring(5);
          const executionPath = path.join(executionsDir, entry.name);

          try {
            // Check if execution exists in database
            const execution = await this.db.get(
              'SELECT id, status, created_at, workspace_preserved FROM executions WHERE id = ?',
              [executionId]
            );

            const stat = await fs.stat(executionPath);
            const isOld = stat.mtimeMs < cutoffTime;

            // Clean up if:
            // 1. Not in database and old
            // 2. In database but completed/failed and old AND not preserved
            if (!execution && isOld) {
              logger.info(`Cleaning orphaned execution ${executionId} (not in database)`);
              await this.cleanupExecution(executionId, { force: true });
              results.cleaned++;
            } else if (execution && isOld && ['completed', 'failed'].includes(execution.status)) {
              // Check if workspace is preserved
              if (execution.workspace_preserved === 1) {
                logger.info(`Skipping preserved execution ${executionId}`);
              } else {
                logger.info(`Cleaning old ${execution.status} execution ${executionId}`);
                await this.cleanupExecution(executionId, { force: true });
                results.cleaned++;
              }
            }
          } catch (error) {
            logger.error(`Failed to process execution ${executionId}:`, error);
            results.failed++;
            results.errors.push({ executionId, error: error.message });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to list execution directories:', error);
      results.errors.push({ type: 'list', error: error.message });
    }

    logger.info('Orphaned execution cleanup completed', results);
    return results;
  }

  /**
   * Rollback an execution (remove without merging)
   */
  async rollbackExecution(executionId, reason = 'User requested rollback') {
    logger.info(`Rolling back execution ${executionId}: ${reason}`);
    
    try {
      // Get execution info
      const execution = await this.db.get(
        'SELECT * FROM executions WHERE id = ?',
        [executionId]
      );

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      // Record rollback in database
      await this.db.run(
        `INSERT INTO ref_changes (execution_id, ref_id, change_type, commit_message) 
         VALUES (?, ?, ?, ?)`,
        [executionId, null, 'rollback', reason]
      );

      // Clean up with force flag
      const results = await this.cleanupExecution(executionId, {
        force: true,
        keepBranches: false,
        keepWorkspace: false
      });

      // Update execution status
      await this.db.run(
        'UPDATE executions SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['rolled_back', executionId]
      );

      return {
        success: true,
        executionId,
        reason,
        cleanup: results
      };

    } catch (error) {
      logger.error(`Rollback failed for execution ${executionId}:`, error);
      return {
        success: false,
        executionId,
        error: error.message
      };
    }
  }

  /**
   * Update cleanup status in database
   */
  async updateCleanupStatus(executionId, results) {
    try {
      const cleanupData = JSON.stringify({
        timestamp: new Date().toISOString(),
        results
      });

      await this.db.run(
        `UPDATE executions 
         SET cleanup_status = ?, cleanup_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [cleanupData, executionId]
      );
    } catch (error) {
      logger.error(`Failed to update cleanup status for ${executionId}:`, error);
    }
  }

  /**
   * Get cleanup status for an execution
   */
  async getCleanupStatus(executionId) {
    const execution = await this.db.get(
      'SELECT cleanup_status, cleanup_at FROM executions WHERE id = ?',
      [executionId]
    );

    if (!execution || !execution.cleanup_status) {
      return null;
    }

    try {
      return JSON.parse(execution.cleanup_status);
    } catch (error) {
      return execution.cleanup_status;
    }
  }
}

export default CleanupManager;