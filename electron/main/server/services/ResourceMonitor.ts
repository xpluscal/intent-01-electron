import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';

const logger = createLogger('ResourceMonitor');

class ResourceMonitor {
  constructor(workspaceManager, db, options = {}) {
    this.workspaceManager = workspaceManager;
    this.db = db;
    
    // Resource limits (configurable)
    this.limits = {
      maxConcurrentExecutions: options.maxConcurrentExecutions || 10,
      maxDiskUsageMB: options.maxDiskUsageMB || 10000, // 1GB
      maxExecutionTimeMinutes: options.maxExecutionTimeMinutes || 60,
      maxWorkspaceAgeDays: options.maxWorkspaceAgeDays || 7
    };
    
    // Monitoring intervals
    this.monitoringEnabled = true;
    this.checkInterval = options.checkInterval || 300000; // 5 minutes
    this.intervalId = null;
  }

  /**
   * Start resource monitoring
   */
  start() {
    if (this.intervalId) {
      logger.warn('Resource monitoring already started');
      return;
    }
    
    logger.info('Starting resource monitoring with limits:', this.limits);
    this.intervalId = setInterval(() => {
      this.performResourceCheck().catch(error => {
        logger.error('Resource check failed:', error);
      });
    }, this.checkInterval);
  }

  /**
   * Stop resource monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Resource monitoring stopped');
    }
  }

  /**
   * Check if a new execution can be started
   */
  async canStartExecution() {
    const checks = await Promise.all([
      this.checkConcurrentExecutions(),
      this.checkDiskUsage(),
      this.checkSystemResources()
    ]);

    console.log('Resource checks:', checks);
    
    return checks.every(check => check.allowed);
  }

  /**
   * Check concurrent execution limit
   */
  async checkConcurrentExecutions() {
    try {
      const runningExecutions = await this.db.all(
        "SELECT COUNT(*) as count FROM executions WHERE status IN ('running', 'starting')"
      );
      
      const currentCount = runningExecutions[0]?.count || 0;
      const allowed = currentCount < this.limits.maxConcurrentExecutions;
      
      return {
        type: 'concurrent_executions',
        allowed,
        current: currentCount,
        limit: this.limits.maxConcurrentExecutions,
        message: allowed ? null : `Maximum concurrent executions (${this.limits.maxConcurrentExecutions}) reached`
      };
    } catch (error) {
      logger.error('Failed to check concurrent executions:', error);
      return { type: 'concurrent_executions', allowed: false, error: error.message };
    }
  }

  /**
   * Check disk usage in workspace
   */
  async checkDiskUsage() {
    try {
      const workspacePath = this.workspaceManager.getWorkspacePath();
      const usage = await this.calculateDirectorySize(workspacePath);
      const usageMB = usage / (1024 * 1024);
      const allowed = usageMB < this.limits.maxDiskUsageMB;
      
      return {
        type: 'disk_usage',
        allowed,
        current: usageMB,
        limit: this.limits.maxDiskUsageMB,
        message: allowed ? null : `Disk usage (${usageMB.toFixed(2)}MB) exceeds limit (${this.limits.maxDiskUsageMB}MB)`
      };
    } catch (error) {
      logger.error('Failed to check disk usage:', error);
      return { type: 'disk_usage', allowed: true, error: error.message }; // Allow on error
    }
  }

  /**
   * Check system resources (memory, CPU if available)
   */
  async checkSystemResources() {
    try {
      const memUsage = process.memoryUsage();
      const memUsageMB = memUsage.heapUsed / (1024 * 1024);
      
      // Basic memory check - warn if using more than 512MB
      const memoryOk = memUsageMB < 512;
      
      return {
        type: 'system_resources',
        allowed: memoryOk,
        memory: {
          heapUsed: memUsageMB,
          heapTotal: memUsage.heapTotal / (1024 * 1024),
          external: memUsage.external / (1024 * 1024)
        },
        message: memoryOk ? null : `High memory usage: ${memUsageMB.toFixed(2)}MB`
      };
    } catch (error) {
      logger.error('Failed to check system resources:', error);
      return { type: 'system_resources', allowed: true, error: error.message };
    }
  }

  /**
   * Perform periodic resource check and cleanup
   */
  async performResourceCheck() {
    logger.debug('Performing resource check');
    
    try {
      // Check and log current resource usage
      const checks = await Promise.all([
        this.checkConcurrentExecutions(),
        this.checkDiskUsage(),
        this.checkSystemResources()
      ]);
      
      // Log warnings for resources near limits
      checks.forEach(check => {
        if (!check.allowed && check.message) {
          logger.warn(`Resource limit warning: ${check.message}`);
        }
      });
      
      // Check for long-running executions
      await this.checkLongRunningExecutions();
      
      // Clean up old workspace data
      await this.cleanupOldWorkspaces();
      
    } catch (error) {
      logger.error('Resource check failed:', error);
    }
  }

  /**
   * Check for executions that have been running too long
   */
  async checkLongRunningExecutions() {
    try {
      const cutoffTime = new Date(Date.now() - (this.limits.maxExecutionTimeMinutes * 60 * 1000));
      const longRunning = await this.db.all(
        "SELECT id, created_at FROM executions WHERE status = 'running' AND created_at < ?",
        [cutoffTime.toISOString()]
      );
      
      if (longRunning.length > 0) {
        logger.warn(`Found ${longRunning.length} long-running executions`);
        
        for (const execution of longRunning) {
          logger.warn(`Execution ${execution.id} has been running since ${execution.created_at}`);
          
          // Mark for review rather than auto-terminate
          await this.db.run(
            'UPDATE executions SET needs_review = 1, review_reason = ? WHERE id = ?',
            [`Long-running execution (>${this.limits.maxExecutionTimeMinutes} minutes)`, execution.id]
          );
        }
      }
    } catch (error) {
      logger.error('Failed to check long-running executions:', error);
    }
  }

  /**
   * Clean up old workspace data
   */
  async cleanupOldWorkspaces() {
    try {
      const cutoffTime = new Date(Date.now() - (this.limits.maxWorkspaceAgeDays * 24 * 60 * 60 * 1000));
      const executionsDir = path.join(this.workspaceManager.getWorkspacePath(), '.execution');
      
      if (!await this.exists(executionsDir)) {
        return;
      }
      
      const entries = await fs.readdir(executionsDir, { withFileTypes: true });
      let cleanedCount = 0;
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('exec-')) {
          const executionPath = path.join(executionsDir, entry.name);
          const stat = await fs.stat(executionPath);
          
          if (stat.mtime < cutoffTime) {
            const executionId = entry.name.substring(5);
            
            // Check if execution is completed
            const execution = await this.db.get(
              'SELECT status FROM executions WHERE id = ?',
              [executionId]
            );
            
            if (!execution || ['completed', 'failed', 'rolled_back'].includes(execution.status)) {
              logger.info(`Cleaning up old workspace: ${entry.name}`);
              await fs.rm(executionPath, { recursive: true, force: true });
              cleanedCount++;
            }
          }
        }
      }
      
      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} old workspace directories`);
      }
    } catch (error) {
      logger.error('Failed to cleanup old workspaces:', error);
    }
  }

  /**
   * Calculate total size of a directory
   */
  async calculateDirectorySize(dirPath) {
    let totalSize = 0;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(fullPath);
        } else {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
        }
      }
    } catch (error) {
      logger.debug(`Error calculating directory size for ${dirPath}:`, error.message);
    }
    
    return totalSize;
  }

  /**
   * Check if file/directory exists
   */
  async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current resource usage report
   */
  async getResourceReport() {
    const checks = await Promise.all([
      this.checkConcurrentExecutions(),
      this.checkDiskUsage(),
      this.checkSystemResources()
    ]);
    
    return {
      timestamp: new Date().toISOString(),
      limits: this.limits,
      usage: checks.reduce((acc, check) => {
        acc[check.type] = check;
        return acc;
      }, {}),
      healthy: checks.every(check => check.allowed)
    };
  }
}

export default ResourceMonitor;