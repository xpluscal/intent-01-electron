import express from 'express';
import * as validators from '../validators.js';
import { NotFoundError, createErrorResponse } from '../errors.js';

const router = express.Router();

router.get('/status/:executionId', async (req, res, next) => {
  try {
    // Validate execution ID
    const executionId = validators.validateExecutionId(req.params.executionId);

    const { db } = req.app.locals;

    // Get execution details with enhanced fields
    const execution = await db.get(
      'SELECT * FROM executions WHERE id = ?',
      [executionId]
    );

    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }

    // Get preview information - only the most recent preview for each ref
    const previews = await db.all(
      `SELECT p1.* FROM preview_processes p1
       INNER JOIN (
         SELECT execution_id, ref_type, ref_id, MAX(started_at) as max_started
         FROM preview_processes
         WHERE execution_id = ?
         AND ref_type IS NOT NULL
         AND ref_id IS NOT NULL
         GROUP BY execution_id, ref_type, ref_id
       ) p2 ON p1.execution_id = p2.execution_id 
           AND p1.ref_type = p2.ref_type 
           AND p1.ref_id = p2.ref_id 
           AND p1.started_at = p2.max_started
       WHERE p1.execution_id = ?`,
      [executionId, executionId]
    );

    // Group previews by refType and refId
    const previewsByType = {
      create: {},
      mutate: {}
    };

    for (const preview of previews) {
      if (preview.ref_type && preview.ref_id) {
        if (!previewsByType[preview.ref_type]) {
          previewsByType[preview.ref_type] = {};
        }
        
        const urls = preview.urls ? JSON.parse(preview.urls) : {};
        previewsByType[preview.ref_type][preview.ref_id] = {
          previewId: preview.id,
          status: preview.status,
          port: preview.port,
          url: urls.local || null,
          startedAt: preview.started_at,
          stoppedAt: preview.stopped_at || null,
          errorMessage: preview.error_message || null
        };
      }
    }

    // Get log summary
    const logCount = await db.get(
      'SELECT COUNT(*) as count FROM logs WHERE execution_id = ?',
      [executionId]
    );

    const lastLog = await db.get(
      'SELECT timestamp FROM logs WHERE execution_id = ? ORDER BY timestamp DESC LIMIT 1',
      [executionId]
    );

    // Format comprehensive response
    const response = {
      executionId: execution.id,
      status: execution.status,
      phase: execution.phase || 'unknown',
      startedAt: execution.created_at,
      completedAt: execution.completed_at || null,
      lastActivity: execution.last_heartbeat || lastLog?.timestamp || execution.created_at,
      sessionId: execution.session_id || null,
      
      // Preview information
      previews: previewsByType,
      
      // Log summary
      logSummary: {
        totalLogs: logCount?.count || 0,
        lastLogTime: lastLog?.timestamp || null
      }
    };

    res.json(response);

  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json(createErrorResponse(error));
    }
    if (error.name === 'NotFoundError') {
      return res.status(404).json(createErrorResponse(error));
    }
    next(error);
  }
});

export default router;