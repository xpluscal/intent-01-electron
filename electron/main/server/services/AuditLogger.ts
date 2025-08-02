import { createLogger } from '../logger.js';

const logger = createLogger('AuditLogger');

class AuditLogger {
  constructor(db) {
    this.db = db;
  }

  /**
   * Log a Git operation with full context
   */
  async logGitOperation(operationData) {
    const {
      executionId = null,
      refId,
      operation, // 'clone', 'checkout', 'commit', 'merge', 'push', 'fetch', etc.
      branch = null,
      command,
      workingDir,
      success,
      duration,
      output = null,
      error = null,
      metadata = {}
    } = operationData;

    try {
      await this.db.run(`
        INSERT INTO git_operations_log (
          execution_id, ref_id, operation, branch, command, 
          working_dir, success, duration_ms, output, error, 
          metadata, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        executionId, refId, operation, branch, command,
        workingDir, success ? 1 : 0, duration, output, error,
        JSON.stringify(metadata)
      ]);

      logger.info(`Git operation logged: ${operation} on ${refId}`, {
        executionId,
        refId,
        operation,
        success,
        duration: `${duration}ms`
      });

    } catch (dbError) {
      logger.error('Failed to log Git operation:', dbError);
    }
  }

  /**
   * Log execution lifecycle events
   */
  async logExecutionEvent(eventData) {
    const {
      executionId,
      event, // 'started', 'workspace_setup', 'refs_configured', 'process_spawned', 'completed', 'failed', 'cleanup'
      phase = null, // 'initialization', 'execution', 'integration', 'cleanup'
      details = {},
      success = true,
      duration = null,
      error = null
    } = eventData;

    try {
      await this.db.run(`
        INSERT INTO execution_events_log (
          execution_id, event, phase, details, success, 
          duration_ms, error, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        executionId, event, phase, JSON.stringify(details),
        success ? 1 : 0, duration, error
      ]);

      logger.info(`Execution event logged: ${event}`, {
        executionId,
        event,
        phase,
        success
      });

    } catch (dbError) {
      logger.error('Failed to log execution event:', dbError);
    }
  }

  /**
   * Log resource usage metrics
   */
  async logResourceUsage(usageData) {
    const {
      type, // 'disk_usage', 'concurrent_executions', 'system_resources', 'execution_duration'
      currentValue,
      limitValue,
      exceeded,
      executionId = null,
      details = {}
    } = usageData;

    try {
      await this.db.run(`
        INSERT INTO resource_usage (
          type, current_value, limit_value, exceeded, 
          execution_id, details, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        type, currentValue, limitValue, exceeded ? 1 : 0,
        executionId, JSON.stringify(details)
      ]);

      if (exceeded) {
        logger.warn(`Resource limit exceeded: ${type}`, {
          type,
          current: currentValue,
          limit: limitValue,
          executionId
        });
      } else {
        logger.debug(`Resource usage logged: ${type}`, {
          type,
          current: currentValue,
          limit: limitValue
        });
      }

    } catch (dbError) {
      logger.error('Failed to log resource usage:', dbError);
    }
  }

  /**
   * Log performance metrics
   */
  async logPerformanceMetric(metricData) {
    const {
      executionId = null,
      operation, // 'git_operation', 'workspace_setup', 'file_read', 'integration', etc.
      duration,
      success,
      metadata = {}
    } = metricData;

    try {
      await this.db.run(`
        INSERT INTO performance_metrics (
          execution_id, operation, duration_ms, success, 
          metadata, timestamp
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        executionId, operation, duration, success ? 1 : 0,
        JSON.stringify(metadata)
      ]);

      // Log slow operations as warnings
      if (duration > 5000) { // 5 seconds
        logger.warn(`Slow operation detected: ${operation}`, {
          executionId,
          operation,
          duration: `${duration}ms`,
          success
        });
      } else {
        logger.debug(`Performance metric logged: ${operation}`, {
          duration: `${duration}ms`,
          success
        });
      }

    } catch (dbError) {
      logger.error('Failed to log performance metric:', dbError);
    }
  }

  /**
   * Get audit trail for an execution
   */
  async getExecutionAuditTrail(executionId) {
    try {
      const [gitOps, events, resources, performance] = await Promise.all([
        this.db.all(`
          SELECT * FROM git_operations_log 
          WHERE execution_id = ? 
          ORDER BY timestamp
        `, [executionId]),
        
        this.db.all(`
          SELECT * FROM execution_events_log 
          WHERE execution_id = ? 
          ORDER BY timestamp
        `, [executionId]),
        
        this.db.all(`
          SELECT * FROM resource_usage 
          WHERE execution_id = ? 
          ORDER BY timestamp
        `, [executionId]),
        
        this.db.all(`
          SELECT * FROM performance_metrics 
          WHERE execution_id = ? 
          ORDER BY timestamp
        `, [executionId])
      ]);

      return {
        executionId,
        gitOperations: gitOps.map(this.parseLogRecord),
        events: events.map(this.parseLogRecord),
        resourceUsage: resources.map(this.parseLogRecord),
        performanceMetrics: performance.map(this.parseLogRecord)
      };

    } catch (error) {
      logger.error(`Failed to get audit trail for execution ${executionId}:`, error);
      throw error;
    }
  }

  /**
   * Get system-wide metrics summary
   */
  async getSystemMetrics(timeWindow = '24 hours') {
    try {
      const [gitOpStats, executionStats, resourceStats, perfStats] = await Promise.all([
        this.db.all(`
          SELECT 
            operation,
            COUNT(*) as total_operations,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_operations,
            AVG(duration_ms) as avg_duration_ms,
            MAX(duration_ms) as max_duration_ms
          FROM git_operations_log 
          WHERE timestamp > datetime('now', '-${timeWindow}')
          GROUP BY operation
        `),
        
        this.db.all(`
          SELECT 
            event,
            phase,
            COUNT(*) as total_events,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_events,
            AVG(duration_ms) as avg_duration_ms
          FROM execution_events_log 
          WHERE timestamp > datetime('now', '-${timeWindow}')
          GROUP BY event, phase
        `),
        
        this.db.all(`
          SELECT 
            type,
            AVG(current_value) as avg_usage,
            MAX(current_value) as peak_usage,
            COUNT(CASE WHEN exceeded = 1 THEN 1 END) as violations
          FROM resource_usage 
          WHERE timestamp > datetime('now', '-${timeWindow}')
          GROUP BY type
        `),
        
        this.db.all(`
          SELECT 
            operation,
            COUNT(*) as total_operations,
            AVG(duration_ms) as avg_duration_ms,
            MAX(duration_ms) as max_duration_ms,
            COUNT(CASE WHEN duration_ms > 5000 THEN 1 END) as slow_operations
          FROM performance_metrics 
          WHERE timestamp > datetime('now', '-${timeWindow}')
          GROUP BY operation
        `)
      ]);

      return {
        timeWindow,
        gitOperations: gitOpStats,
        executionEvents: executionStats,
        resourceUsage: resourceStats,
        performance: perfStats,
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to get system metrics:', error);
      throw error;
    }
  }

  /**
   * Parse log record and handle JSON fields
   */
  parseLogRecord(record) {
    const parsed = { ...record };
    
    // Parse JSON fields
    ['metadata', 'details'].forEach(field => {
      if (parsed[field]) {
        try {
          parsed[field] = JSON.parse(parsed[field]);
        } catch (e) {
          logger.warn(`Failed to parse ${field} in log record:`, e);
        }
      }
    });
    
    return parsed;
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(retentionDays = 30) {
    const cutoffDate = `datetime('now', '-${retentionDays} days')`;
    
    try {
      const results = await Promise.all([
        this.db.run(`DELETE FROM git_operations_log WHERE timestamp < ${cutoffDate}`),
        this.db.run(`DELETE FROM execution_events_log WHERE timestamp < ${cutoffDate}`),
        this.db.run(`DELETE FROM resource_usage WHERE timestamp < ${cutoffDate}`),
        this.db.run(`DELETE FROM performance_metrics WHERE timestamp < ${cutoffDate}`)
      ]);

      const totalDeleted = results.reduce((sum, result) => sum + (result.changes || 0), 0);
      
      logger.info(`Cleaned up ${totalDeleted} old audit log records older than ${retentionDays} days`);
      
      return { deletedRecords: totalDeleted, retentionDays };

    } catch (error) {
      logger.error('Failed to cleanup old audit logs:', error);
      throw error;
    }
  }
}

export default AuditLogger;