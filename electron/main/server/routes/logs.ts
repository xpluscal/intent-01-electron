import express from 'express';
import * as validators from '../validators.js';
import { NotFoundError, createErrorResponse } from '../errors.js';
import { Events } from '../constants.js';
import { createLogger } from '../logger.js';

const logger = createLogger('routes/logs');

const router = express.Router();

router.get('/logs/:executionId', async (req, res, next) => {
  try {
    // Validate execution ID
    const executionId = validators.validateExecutionId(req.params.executionId);

    const { db, eventEmitter, config } = req.app.locals;

    // Check if execution exists
    const execution = await db.get(
      'SELECT * FROM executions WHERE id = ?',
      [executionId]
    );

    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }

    logger.info('Starting SSE stream', { executionId });
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable Nginx buffering
    });

    // Send historical logs first
    const historicalLogs = await db.all(
      'SELECT * FROM logs WHERE execution_id = ? ORDER BY timestamp ASC',
      [executionId]
    );

    for (const log of historicalLogs) {
      res.write(`event: log\n`);
      res.write(`data: ${JSON.stringify({
        timestamp: log.timestamp,
        type: log.type,
        content: log.content
      })}\n\n`);
    }

    // Set up real-time log streaming
    const logHandler = (event) => {
      if (event.executionId === executionId) {
        res.write(`event: log\n`);
        res.write(`data: ${JSON.stringify({
          timestamp: event.timestamp,
          type: event.type,
          content: event.content
        })}\n\n`);
      }
    };

    // Listen for new logs
    eventEmitter.on(Events.LOG_ENTRY, logHandler);

    // Set up heartbeat
    const heartbeatInterval = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, config?.streaming?.heartbeatInterval || 30000);

    // Clean up on client disconnect
    req.on('close', () => {
      logger.info('SSE client disconnected', { executionId });
      eventEmitter.removeListener(Events.LOG_ENTRY, logHandler);
      clearInterval(heartbeatInterval);
    });

    // Handle process completion
    const exitHandler = (event) => {
      if (event.executionId === executionId) {
        res.write(`event: end\n`);
        res.write(`data: ${JSON.stringify({
          code: event.code,
          signal: event.signal
        })}\n\n`);
        
        // Clean up
        eventEmitter.removeListener(Events.LOG_ENTRY, logHandler);
        eventEmitter.removeListener(Events.PROCESS_EXIT, exitHandler);
        clearInterval(heartbeatInterval);
        res.end();
      }
    };

    eventEmitter.on(Events.PROCESS_EXIT, exitHandler);

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