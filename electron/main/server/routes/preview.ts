import express from 'express';
const router = express.Router();
import { createLogger } from '../logger.js';
import PreviewManager from '../preview/previewManager.js';

const logger = createLogger('preview-routes');

let previewManager;

router.use((req, res, next) => {
  if (!previewManager) {
    previewManager = new PreviewManager(req.app.locals.db, req.app.locals.processManager, req.app.locals.eventEmitter);
  }
  next();
});

router.get('/:executionId/analyze', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    
    logger.info(`Analyzing project for execution ${executionId}`, { refType, refId });
    
    const analysis = await previewManager.analyzeProject(executionId, { refType, refId });
    
    res.json(analysis);
  } catch (error) {
    logger.error('Error analyzing project:', error);
    res.status(error.message === 'Execution not found' ? 404 : 500).json({
      error: {
        code: error.message === 'Execution not found' ? 'EXECUTION_NOT_FOUND' : 'ANALYSIS_FAILED',
        message: error.message,
        details: error.stack
      }
    });
  }
});

router.post('/:executionId/start', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    const options = { ...req.body, refType, refId };
    
    logger.info(`Starting preview for execution ${executionId}`, {
      refType,
      refId,
      queryParams: req.query,
      fullUrl: req.originalUrl,
      options
    });
    
    const result = await previewManager.startPreview(executionId, options);
    
    res.json(result);
  } catch (error) {
    logger.error('Error starting preview:', error);
    
    let errorCode = 'PREVIEW_START_FAILED';
    let statusCode = 500;
    
    if (error.message === 'Execution not found') {
      errorCode = 'EXECUTION_NOT_FOUND';
      statusCode = 404;
    } else if (error.message.includes('No available ports')) {
      errorCode = 'PORT_UNAVAILABLE';
      statusCode = 503;
    } else if (error.message === 'No command specified or available') {
      errorCode = 'COMMAND_NOT_FOUND';
      statusCode = 400;
    }
    
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: error.message,
        details: error.stack
      }
    });
  }
});

router.get('/:executionId/status', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    
    logger.info(`Getting preview status for execution ${executionId}`, { refType, refId });
    
    const status = await previewManager.getPreviewStatus(executionId, { refType, refId });
    
    res.json(status);
  } catch (error) {
    logger.error('Error getting preview status:', error);
    res.status(500).json({
      error: {
        code: 'STATUS_FAILED',
        message: error.message,
        details: error.stack
      }
    });
  }
});

router.post('/:executionId/stop', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    const { previewId, cleanup } = req.body;
    
    logger.info(`Stopping preview for execution ${executionId}`, { previewId, cleanup, refType, refId });
    
    const result = await previewManager.stopPreview(executionId, previewId, { refType, refId });
    
    res.json(result);
  } catch (error) {
    logger.error('Error stopping preview:', error);
    res.status(500).json({
      error: {
        code: 'STOP_FAILED',
        message: error.message,
        details: error.stack
      }
    });
  }
});

router.post('/:executionId/restart', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    const { previewId, force = false } = req.body;
    
    logger.info(`Restarting preview for execution ${executionId}`, { previewId, refType, refId, force });
    
    // If previewId is provided, restart that specific preview
    if (previewId) {
      const preview = await req.app.locals.db.get(
        'SELECT * FROM preview_processes WHERE id = ? AND execution_id = ?',
        [previewId, executionId]
      );
      
      if (!preview) {
        return res.status(404).json({
          error: {
            code: 'PREVIEW_NOT_FOUND',
            message: 'Preview not found'
          }
        });
      }
      
      // Stop existing preview first if it's running
      if (['installing', 'starting', 'running'].includes(preview.status)) {
        await previewManager.stopPreview(executionId, previewId);
        // Wait a moment for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Start the preview again with same ref parameters
      const result = await previewManager.startPreview(executionId, {
        refType: preview.ref_type,
        refId: preview.ref_id,
        installDependencies: !force // Skip install if force=true
      });
      
      res.json({
        ...result,
        restarted: true,
        previousPreviewId: previewId
      });
    } else if (refType && refId) {
      // Restart preview for specific reference
      // First check if there's an existing preview
      const existingPreviews = await req.app.locals.db.all(
        'SELECT * FROM preview_processes WHERE execution_id = ? AND ref_type = ? AND ref_id = ? ORDER BY started_at DESC',
        [executionId, refType, refId]
      );
      
      // Stop any running previews for this ref
      for (const preview of existingPreviews) {
        if (['installing', 'starting', 'running'].includes(preview.status)) {
          await previewManager.stopPreview(executionId, preview.id);
        }
      }
      
      // Wait a moment for cleanup
      if (existingPreviews.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Start new preview
      const result = await previewManager.startPreview(executionId, {
        refType,
        refId,
        installDependencies: !force
      });
      
      res.json({
        ...result,
        restarted: true,
        hadExistingPreviews: existingPreviews.length > 0
      });
    } else {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'Either previewId or both refType and refId must be provided'
        }
      });
    }
  } catch (error) {
    logger.error('Error restarting preview:', error);
    
    let errorCode = 'RESTART_FAILED';
    let statusCode = 500;
    
    if (error.message === 'Execution not found') {
      errorCode = 'EXECUTION_NOT_FOUND';
      statusCode = 404;
    } else if (error.message.includes('No available ports')) {
      errorCode = 'PORT_UNAVAILABLE';
      statusCode = 503;
    }
    
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: error.message,
        details: error.stack
      }
    });
  }
});

router.get('/:executionId/logs', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { previewId } = req.query;
    
    if (!previewId) {
      return res.status(400).json({
        error: {
          code: 'PREVIEW_ID_REQUIRED',
          message: 'Preview ID is required as a query parameter'
        }
      });
    }
    
    logger.info(`Starting log stream for preview ${previewId}`);
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    previewManager.addSSEConnection(previewId, res);
    
    const preview = await req.app.locals.db.get(
      'SELECT * FROM preview_processes WHERE id = ? AND execution_id = ?',
      [previewId, executionId]
    );
    
    if (!preview) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Preview not found' })}\n\n`);
      res.end();
      return;
    }
    
    const recentLogs = await req.app.locals.db.all(
      'SELECT * FROM preview_logs WHERE preview_id = ? ORDER BY timestamp DESC LIMIT 50',
      [previewId]
    );
    
    recentLogs.reverse().forEach(log => {
      res.write(`event: log\ndata: ${JSON.stringify({
        timestamp: log.timestamp,
        type: log.type,
        content: log.content
      })}\n\n`);
    });
    
    const urls = JSON.parse(preview.urls || '{}');
    res.write(`event: status\ndata: ${JSON.stringify({
      status: preview.status,
      port: preview.port,
      url: urls.local
    })}\n\n`);
    
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30000);
    
    req.on('close', () => {
      clearInterval(heartbeat);
      previewManager.removeSSEConnection(previewId, res);
      logger.info(`Log stream closed for preview ${previewId}`);
    });
  } catch (error) {
    logger.error('Error streaming logs:', error);
    res.status(500).json({
      error: {
        code: 'STREAM_FAILED',
        message: error.message,
        details: error.stack
      }
    });
  }
});

router.post('/:executionId/install', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    const options = { ...req.body, refType, refId };
    
    logger.info(`Installing dependencies for execution ${executionId}`, options);
    
    const result = await previewManager.installDependencies(executionId, options);
    
    res.json(result);
  } catch (error) {
    logger.error('Error installing dependencies:', error);
    
    let errorCode = 'INSTALL_FAILED';
    let statusCode = 500;
    
    if (error.message === 'Execution not found') {
      errorCode = 'EXECUTION_NOT_FOUND';
      statusCode = 404;
    } else if (error.message === 'No package manager detected') {
      errorCode = 'NO_PACKAGE_MANAGER';
      statusCode = 400;
    }
    
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: error.message,
        details: error.stack
      }
    });
  }
});

export default router;