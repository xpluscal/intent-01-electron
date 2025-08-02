import { default as ChangeManager } from './ChangeManager.js';
import { default as ExecutionContextManager } from './ExecutionContextManager.js';
import { createLogger } from '../logger.js';

const logger = createLogger('IntegrationManager');

class IntegrationManager {
  constructor(workspaceManager, refManager, contextManager, changeManager, db) {
    this.workspaceManager = workspaceManager;
    this.refManager = refManager;
    this.contextManager = contextManager || new ExecutionContextManager(workspaceManager, refManager);
    this.changeManager = changeManager || new ChangeManager(workspaceManager, refManager, this.contextManager);
    this.db = db;
  }

  /**
   * Process all changes from an execution and integrate them
   */
  async integrateExecutionChanges(executionId, options = {}) {
    try {
      logger.info(`Starting integration for execution ${executionId}`);
      
      // Get execution manifest
      const manifest = await this.contextManager.getExecutionManifest(executionId);
      if (!manifest) {
        logger.warn(`No manifest found for execution ${executionId}`);
        return { success: false, message: 'No execution manifest found' };
      }
      
      // Process all changes
      const results = await this.changeManager.processExecutionChanges(executionId, {
        commitMessage: options.commitMessage || `Changes from execution ${executionId}`,
        merge: options.merge !== false,
        mergeStrategy: options.mergeStrategy || 'merge'
      });
      
      // Save change records to database
      await this.saveChangeRecords(executionId, results);
      
      // Check if any syncs failed (conflicts should not occur with branch preservation)
      const hasSyncFailures = Object.values(results.merges || {}).some(m => !m.synced);
      if (hasSyncFailures) {
        logger.warn(`Execution ${executionId} had sync failures`);
        await this.markExecutionNeedsReview(executionId, 'sync_failures');
        
        // Provide detailed failure information
        const failureDetails = Object.entries(results.merges || {})
          .filter(([refId, result]) => !result.synced)
          .reduce((acc, [refId, result]) => {
            acc[refId] = {
              error: result.error || 'Unknown sync failure',
              message: result.message || 'Sync operation failed',
              branch: `exec-${executionId}`
            };
            return acc;
          }, {});
          
        // Store failure details in execution record
        await this.db.run(
          'UPDATE executions SET conflict_details = ? WHERE id = ?',
          [JSON.stringify(failureDetails), executionId]
        );
      }
      
      // Clean up execution workspace
      if (options.cleanup !== false && !hasSyncFailures) {
        try {
          await this.contextManager.cleanupExecutionWorkspace(executionId);
          logger.info(`Cleaned up workspace for execution ${executionId}`);
        } catch (error) {
          logger.error(`Failed to clean up workspace for execution ${executionId}:`, error);
          // Don't fail the integration if cleanup fails
        }
      }
      
      logger.info(`Integration completed for execution ${executionId}`, results);
      return {
        success: true,
        results
      };
      
    } catch (error) {
      logger.error(`Integration failed for execution ${executionId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Save change records to the database
   */
  async saveChangeRecords(executionId, results) {
    const inserts = [];
    
    // Save commit records
    for (const [refId, commitResult] of Object.entries(results.commits || {})) {
      if (commitResult.committed) {
        inserts.push(this.db.run(
          `INSERT INTO ref_changes (execution_id, ref_id, change_type, branch_name, commit_hash, commit_message) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [executionId, refId, 'commit', `exec-${executionId}`, commitResult.hash, commitResult.message]
        ));
      }
    }
    
    // Save merge records (branch preservation operations)
    for (const [refId, syncResult] of Object.entries(results.merges || {})) {
      inserts.push(this.db.run(
        `INSERT INTO ref_changes (execution_id, ref_id, change_type, branch_name, commit_hash, merge_status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [executionId, refId, 'merge', `exec-${executionId}`, syncResult.execBranchHash || null, 
         syncResult.synced ? 'success' : 'failed']
      ));
    }
    
    // Save create records
    for (const [refId, createResult] of Object.entries(results.creates || {})) {
      inserts.push(this.db.run(
        `INSERT INTO ref_changes (execution_id, ref_id, change_type, commit_hash, commit_message) 
         VALUES (?, ?, ?, ?, ?)`,
        [executionId, refId, 'create', createResult.commitHash, `Initial commit\n\nCreated from execution: ${executionId}`]
      ));
    }
    
    await Promise.all(inserts);
  }
  
  /**
   * Mark an execution as needing manual review
   */
  async markExecutionNeedsReview(executionId, reason) {
    try {
      await this.db.run(
        'UPDATE executions SET status = ?, needs_review = 1, review_reason = ? WHERE id = ?',
        ['needs_review', reason, executionId]
      );
      logger.info(`Marked execution ${executionId} as needing review: ${reason}`);
    } catch (error) {
      logger.error(`Failed to mark execution ${executionId} as needing review:`, error);
      throw error;
    }
  }
  
  /**
   * Get integration status for an execution
   */
  async getIntegrationStatus(executionId) {
    const changes = await this.db.all(
      'SELECT * FROM ref_changes WHERE execution_id = ? ORDER BY created_at',
      [executionId]
    );
    
    const refs = await this.db.all(
      'SELECT * FROM execution_refs WHERE execution_id = ?',
      [executionId]
    );
    
    return {
      executionId,
      refs: refs.reduce((acc, ref) => {
        if (!acc[ref.ref_id]) {
          acc[ref.ref_id] = { permissions: [] };
        }
        acc[ref.ref_id].permissions.push(ref.permission);
        return acc;
      }, {}),
      changes: changes.reduce((acc, change) => {
        if (!acc[change.ref_id]) {
          acc[change.ref_id] = [];
        }
        acc[change.ref_id].push({
          type: change.change_type,
          branch: change.branch_name,
          commit: change.commit_hash,
          message: change.commit_message,
          mergeStatus: change.merge_status,
          timestamp: change.created_at
        });
        return acc;
      }, {})
    };
  }
}

export default IntegrationManager;