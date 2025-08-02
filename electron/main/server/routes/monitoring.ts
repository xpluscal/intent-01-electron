import express from 'express';
import { createLogger } from '../logger.js';

const logger = createLogger('monitoring-routes');
const router = express.Router();

// GET /monitoring/metrics - Get performance metrics
router.get('/monitoring/metrics', async (req, res, next) => {
  try {
    const { performanceMonitor } = req.app.locals;
    
    if (!performanceMonitor) {
      return res.status(503).json({
        error: {
          code: 'PERFORMANCE_MONITOR_UNAVAILABLE',
          message: 'Performance monitoring is not enabled'
        }
      });
    }
    
    const metrics = performanceMonitor.getMetrics();
    const slowOps = performanceMonitor.getSlowOperations(parseInt(req.query.slowThreshold) || 5000);
    const activeOps = performanceMonitor.getActiveOperations();
    const stuckOps = performanceMonitor.getStuckOperations(parseInt(req.query.stuckThreshold) || 300000);
    
    res.json({
      metrics: metrics.metrics,
      summary: {
        activeOperations: metrics.activeOperations,
        slowOperations: slowOps.length,
        stuckOperations: stuckOps.length,
        generatedAt: metrics.generatedAt
      },
      slowOperations: slowOps,
      activeOperations: activeOps,
      stuckOperations: stuckOps
    });
    
  } catch (error) {
    logger.error('Get metrics error:', error);
    next(error);
  }
});

// GET /monitoring/audit/:executionId - Get audit trail for execution
router.get('/monitoring/audit/:executionId', async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { auditLogger } = req.app.locals;
    
    if (!auditLogger) {
      return res.status(503).json({
        error: {
          code: 'AUDIT_LOGGER_UNAVAILABLE',
          message: 'Audit logging is not enabled'
        }
      });
    }
    
    const auditTrail = await auditLogger.getExecutionAuditTrail(executionId);
    
    res.json({
      execution: executionId,
      auditTrail
    });
    
  } catch (error) {
    logger.error('Get audit trail error:', error);
    next(error);
  }
});

// GET /monitoring/system - Get system-wide metrics
router.get('/monitoring/system', async (req, res, next) => {
  try {
    const { auditLogger } = req.app.locals;
    const { timeWindow = '24 hours' } = req.query;
    
    if (!auditLogger) {
      return res.status(503).json({
        error: {
          code: 'AUDIT_LOGGER_UNAVAILABLE',
          message: 'Audit logging is not enabled'
        }
      });
    }
    
    const systemMetrics = await auditLogger.getSystemMetrics(timeWindow);
    
    res.json(systemMetrics);
    
  } catch (error) {
    logger.error('Get system metrics error:', error);
    next(error);
  }
});

// GET /monitoring/logs - Query audit logs
router.get('/monitoring/logs', async (req, res, next) => {
  try {
    const { db } = req.app.locals;
    const {
      type = 'all', // 'git', 'events', 'performance', 'resources', 'all'
      executionId = null,
      operation = null,
      success = null,
      limit = 100,
      offset = 0,
      timeWindow = '24 hours'
    } = req.query;
    
    const results = {};
    const baseTimeFilter = `timestamp > datetime('now', '-${timeWindow}')`;
    
    // Build queries based on type
    const queries = [];
    
    if (type === 'all' || type === 'git') {
      let gitQuery = `
        SELECT 'git' as log_type, * FROM git_operations_log 
        WHERE ${baseTimeFilter}
      `;
      const gitParams = [];
      
      if (executionId) {
        gitQuery += ' AND execution_id = ?';
        gitParams.push(executionId);
      }
      if (operation) {
        gitQuery += ' AND operation = ?';
        gitParams.push(operation);
      }
      if (success !== null) {
        gitQuery += ' AND success = ?';
        gitParams.push(success === 'true' ? 1 : 0);
      }
      
      gitQuery += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      gitParams.push(parseInt(limit), parseInt(offset));
      
      queries.push({ name: 'git', query: gitQuery, params: gitParams });
    }
    
    if (type === 'all' || type === 'events') {
      let eventsQuery = `
        SELECT 'events' as log_type, * FROM execution_events_log 
        WHERE ${baseTimeFilter}
      `;
      const eventsParams = [];
      
      if (executionId) {
        eventsQuery += ' AND execution_id = ?';
        eventsParams.push(executionId);
      }
      if (operation) {
        eventsQuery += ' AND event = ?';
        eventsParams.push(operation);
      }
      if (success !== null) {
        eventsQuery += ' AND success = ?';
        eventsParams.push(success === 'true' ? 1 : 0);
      }
      
      eventsQuery += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      eventsParams.push(parseInt(limit), parseInt(offset));
      
      queries.push({ name: 'events', query: eventsQuery, params: eventsParams });
    }
    
    if (type === 'all' || type === 'performance') {
      let perfQuery = `
        SELECT 'performance' as log_type, * FROM performance_metrics 
        WHERE ${baseTimeFilter}
      `;
      const perfParams = [];
      
      if (executionId) {
        perfQuery += ' AND execution_id = ?';
        perfParams.push(executionId);
      }
      if (operation) {
        perfQuery += ' AND operation = ?';
        perfParams.push(operation);
      }
      if (success !== null) {
        perfQuery += ' AND success = ?';
        perfParams.push(success === 'true' ? 1 : 0);
      }
      
      perfQuery += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      perfParams.push(parseInt(limit), parseInt(offset));
      
      queries.push({ name: 'performance', query: perfQuery, params: perfParams });
    }
    
    if (type === 'all' || type === 'resources') {
      let resourceQuery = `
        SELECT 'resources' as log_type, * FROM resource_usage 
        WHERE ${baseTimeFilter}
      `;
      const resourceParams = [];
      
      if (executionId) {
        resourceQuery += ' AND execution_id = ?';
        resourceParams.push(executionId);
      }
      
      resourceQuery += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      resourceParams.push(parseInt(limit), parseInt(offset));
      
      queries.push({ name: 'resources', query: resourceQuery, params: resourceParams });
    }
    
    // Execute queries
    for (const { name, query, params } of queries) {
      const logs = await db.all(query, params);
      results[name] = logs.map(log => {
        // Parse JSON fields
        if (log.metadata) {
          try {
            log.metadata = JSON.parse(log.metadata);
          } catch (e) {
            // Keep as string if parsing fails
          }
        }
        if (log.details) {
          try {
            log.details = JSON.parse(log.details);
          } catch (e) {
            // Keep as string if parsing fails
          }
        }
        return log;
      });
    }
    
    res.json({
      filters: {
        type,
        executionId,
        operation,
        success,
        timeWindow,
        limit: parseInt(limit),
        offset: parseInt(offset)
      },
      results,
      totalByType: Object.keys(results).reduce((acc, key) => {
        acc[key] = results[key].length;
        return acc;
      }, {})
    });
    
  } catch (error) {
    logger.error('Query logs error:', error);
    next(error);
  }
});

// POST /monitoring/cleanup - Clean up old audit logs
router.post('/monitoring/cleanup', async (req, res, next) => {
  try {
    const { auditLogger } = req.app.locals;
    const { retentionDays = 30 } = req.body;
    
    if (!auditLogger) {
      return res.status(503).json({
        error: {
          code: 'AUDIT_LOGGER_UNAVAILABLE',
          message: 'Audit logging is not enabled'
        }
      });
    }
    
    const result = await auditLogger.cleanupOldLogs(parseInt(retentionDays));
    
    res.json({
      message: 'Audit log cleanup completed',
      result
    });
    
  } catch (error) {
    logger.error('Cleanup logs error:', error);
    next(error);
  }
});

// POST /monitoring/reset-metrics - Reset performance metrics
router.post('/monitoring/reset-metrics', async (req, res, next) => {
  try {
    const { performanceMonitor } = req.app.locals;
    
    if (!performanceMonitor) {
      return res.status(503).json({
        error: {
          code: 'PERFORMANCE_MONITOR_UNAVAILABLE',
          message: 'Performance monitoring is not enabled'
        }
      });
    }
    
    performanceMonitor.resetMetrics();
    
    res.json({
      message: 'Performance metrics reset successfully',
      resetAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Reset metrics error:', error);
    next(error);
  }
});

export default router;