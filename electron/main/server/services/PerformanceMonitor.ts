import { createLogger } from '../logger.js';

const logger = createLogger('PerformanceMonitor');

class PerformanceMonitor {
  constructor(auditLogger = null) {
    this.auditLogger = auditLogger;
    this.activeOperations = new Map(); // Track ongoing operations
    this.metrics = {
      operationCounts: new Map(),
      averageDurations: new Map(),
      errorCounts: new Map()
    };
  }

  /**
   * Start timing an operation
   */
  startTiming(operationId, operation, metadata = {}) {
    const startTime = Date.now();
    
    this.activeOperations.set(operationId, {
      operation,
      startTime,
      metadata
    });

    logger.debug(`Started timing operation: ${operation}`, {
      operationId,
      operation,
      metadata
    });

    return operationId;
  }

  /**
   * End timing an operation
   */
  async endTiming(operationId, success = true, error = null, additionalMetadata = {}) {
    const operationData = this.activeOperations.get(operationId);
    
    if (!operationData) {
      logger.warn(`Operation ${operationId} not found in active operations`);
      return null;
    }

    const endTime = Date.now();
    const duration = endTime - operationData.startTime;
    
    // Update in-memory metrics
    this.updateMetrics(operationData.operation, duration, success);
    
    // Log to audit system if available
    if (this.auditLogger) {
      const executionId = operationData.metadata.executionId || null;
      
      await this.auditLogger.logPerformanceMetric({
        executionId,
        operation: operationData.operation,
        duration,
        success,
        metadata: {
          ...operationData.metadata,
          ...additionalMetadata,
          error: error?.message || null
        }
      });
    }

    // Clean up
    this.activeOperations.delete(operationId);

    logger.debug(`Completed timing operation: ${operationData.operation}`, {
      operationId,
      operation: operationData.operation,
      duration: `${duration}ms`,
      success
    });

    return {
      operation: operationData.operation,
      duration,
      success,
      metadata: { ...operationData.metadata, ...additionalMetadata }
    };
  }

  /**
   * Instrument a function with automatic timing
   */
  async instrument(operation, fn, metadata = {}) {
    const operationId = this.generateOperationId();
    
    this.startTiming(operationId, operation, metadata);
    
    try {
      const result = await fn();
      await this.endTiming(operationId, true, null, { resultType: typeof result });
      return result;
    } catch (error) {
      await this.endTiming(operationId, false, error);
      throw error;
    }
  }

  /**
   * Instrument a Git operation specifically
   */
  async instrumentGitOperation(gitOperationData, fn) {
    const {
      executionId,
      refId,
      operation,
      branch,
      command,
      workingDir
    } = gitOperationData;

    const operationId = this.generateOperationId();
    const startTime = Date.now();
    
    this.startTiming(operationId, `git_${operation}`, {
      executionId,
      refId,
      operation,
      branch,
      command,
      workingDir
    });

    let output = null;
    let error = null;
    let success = false;

    try {
      output = await fn();
      success = true;
      return output;
    } catch (err) {
      error = err;
      success = false;
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      
      // Log to audit system
      if (this.auditLogger) {
        await this.auditLogger.logGitOperation({
          ...gitOperationData,
          success,
          duration,
          output: typeof output === 'string' ? output : null,
          error: error?.message || null,
          metadata: {
            commandLength: command.length,
            hasOutput: !!output
          }
        });
      }

      await this.endTiming(operationId, success, error);
    }
  }

  /**
   * Update in-memory metrics
   */
  updateMetrics(operation, duration, success) {
    // Update operation counts
    const currentCount = this.metrics.operationCounts.get(operation) || 0;
    this.metrics.operationCounts.set(operation, currentCount + 1);

    // Update average durations
    const currentAvg = this.metrics.averageDurations.get(operation) || { total: 0, count: 0 };
    currentAvg.total += duration;
    currentAvg.count += 1;
    this.metrics.averageDurations.set(operation, currentAvg);

    // Update error counts
    if (!success) {
      const currentErrors = this.metrics.errorCounts.get(operation) || 0;
      this.metrics.errorCounts.set(operation, currentErrors + 1);
    }
  }

  /**
   * Get current performance metrics
   */
  getMetrics() {
    const metrics = {};

    for (const [operation, count] of this.metrics.operationCounts) {
      const avgData = this.metrics.averageDurations.get(operation) || { total: 0, count: 0 };
      const errorCount = this.metrics.errorCounts.get(operation) || 0;
      
      metrics[operation] = {
        totalOperations: count,
        averageDuration: avgData.count > 0 ? Math.round(avgData.total / avgData.count) : 0,
        totalDuration: avgData.total,
        errorCount,
        successRate: count > 0 ? ((count - errorCount) / count * 100).toFixed(2) + '%' : '100%'
      };
    }

    return {
      metrics,
      activeOperations: this.activeOperations.size,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Get slow operations report
   */
  getSlowOperations(thresholdMs = 5000) {
    const slowOps = [];

    for (const [operation, avgData] of this.metrics.averageDurations) {
      const avgDuration = avgData.count > 0 ? avgData.total / avgData.count : 0;
      
      if (avgDuration > thresholdMs) {
        slowOps.push({
          operation,
          averageDuration: Math.round(avgDuration),
          totalOperations: avgData.count,
          totalDuration: avgData.total
        });
      }
    }

    return slowOps.sort((a, b) => b.averageDuration - a.averageDuration);
  }

  /**
   * Reset metrics (useful for testing or periodic resets)
   */
  resetMetrics() {
    this.metrics = {
      operationCounts: new Map(),
      averageDurations: new Map(),
      errorCounts: new Map()
    };
    
    logger.info('Performance metrics reset');
  }

  /**
   * Generate unique operation ID
   */
  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get summary of active operations
   */
  getActiveOperations() {
    const operations = [];
    const now = Date.now();

    for (const [operationId, data] of this.activeOperations) {
      operations.push({
        operationId,
        operation: data.operation,
        duration: now - data.startTime,
        metadata: data.metadata
      });
    }

    return operations.sort((a, b) => b.duration - a.duration);
  }

  /**
   * Check for stuck operations (running too long)
   */
  getStuckOperations(thresholdMs = 300000) { // 5 minutes
    const now = Date.now();
    const stuckOps = [];

    for (const [operationId, data] of this.activeOperations) {
      const duration = now - data.startTime;
      if (duration > thresholdMs) {
        stuckOps.push({
          operationId,
          operation: data.operation,
          duration,
          startTime: new Date(data.startTime).toISOString(),
          metadata: data.metadata
        });
      }
    }

    if (stuckOps.length > 0) {
      logger.warn(`Found ${stuckOps.length} potentially stuck operations`, { stuckOps });
    }

    return stuckOps;
  }
}

export default PerformanceMonitor;