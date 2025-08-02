import express from 'express';
import { createLogger } from '../logger.js';

const logger = createLogger('resources-routes');
const router = express.Router();

// GET /resources/status - Get current resource status
router.get('/resources/status', async (req, res, next) => {
  try {
    const { resourceMonitor } = req.app.locals;
    
    if (!resourceMonitor) {
      return res.status(503).json({
        error: {
          code: 'RESOURCE_MONITOR_UNAVAILABLE',
          message: 'Resource monitoring is not enabled'
        }
      });
    }
    
    const report = await resourceMonitor.getResourceReport();
    
    res.json({
      status: report.healthy ? 'healthy' : 'warning',
      timestamp: report.timestamp,
      limits: report.limits,
      usage: report.usage
    });
    
  } catch (error) {
    logger.error('Resource status error:', error);
    next(error);
  }
});

// GET /resources/can-execute - Check if new execution can start
router.get('/resources/can-execute', async (req, res, next) => {
  try {
    const { resourceMonitor } = req.app.locals;
    
    if (!resourceMonitor) {
      return res.json({
        canExecute: true,
        reason: 'Resource monitoring disabled'
      });
    }
    
    const canExecute = await resourceMonitor.canStartExecution();
    const checks = await Promise.all([
      resourceMonitor.checkConcurrentExecutions(),
      resourceMonitor.checkDiskUsage(),
      resourceMonitor.checkSystemResources()
    ]);
    
    const blockedBy = checks.filter(check => !check.allowed);
    
    res.json({
      canExecute,
      checks: checks.reduce((acc, check) => {
        acc[check.type] = {
          allowed: check.allowed,
          current: check.current,
          limit: check.limit,
          message: check.message
        };
        return acc;
      }, {}),
      blockedBy: blockedBy.map(check => check.type)
    });
    
  } catch (error) {
    logger.error('Can execute check error:', error);
    next(error);
  }
});

// GET /resources/usage/history - Get resource usage history
router.get('/resources/usage/history', async (req, res, next) => {
  try {
    const { db } = req.app.locals;
    const { 
      hours = 24, 
      type = null,
      limit = 100 
    } = req.query;
    
    let sql = `
      SELECT * FROM resource_usage 
      WHERE timestamp > datetime('now', '-${parseInt(hours)} hours')
    `;
    const params = [];
    
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const history = await db.all(sql, params);
    
    res.json({
      history: history.map(record => ({
        timestamp: record.timestamp,
        type: record.type,
        current: record.current_value,
        limit: record.limit_value,
        exceeded: Boolean(record.exceeded),
        details: record.details ? JSON.parse(record.details) : null
      })),
      totalRecords: history.length,
      hoursBack: parseInt(hours)
    });
    
  } catch (error) {
    logger.error('Resource history error:', error);
    next(error);
  }
});

export default router;