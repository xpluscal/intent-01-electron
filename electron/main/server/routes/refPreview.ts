import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createLogger } from '../logger.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const logger = createLogger('ref-preview-routes');
const router = express.Router();

// Store active previews
const activePreviews = new Map();

// Port management
let currentPort = 3000;
const MAX_PORT = 3999;

function getNextAvailablePort() {
  currentPort++;
  if (currentPort > MAX_PORT) {
    currentPort = 3000;
  }
  return currentPort;
}

// Helper to detect package manager
async function detectPackageManager(refPath) {
  try {
    await fs.access(path.join(refPath, 'package-lock.json'));
    return 'npm';
  } catch {}
  
  try {
    await fs.access(path.join(refPath, 'yarn.lock'));
    return 'yarn';
  } catch {}
  
  try {
    await fs.access(path.join(refPath, 'pnpm-lock.yaml'));
    return 'pnpm';
  } catch {}
  
  try {
    await fs.access(path.join(refPath, 'bun.lockb'));
    return 'bun';
  } catch {}
  
  // Default to npm if package.json exists
  try {
    await fs.access(path.join(refPath, 'package.json'));
    return 'npm';
  } catch {}
  
  return null;
}

// Get the ref path from workspace
function getRefPath(workspace, refId) {
  return path.join(workspace, 'refs', refId);
}

// Start preview for a ref
router.post('/refs/:refId/preview/start', async (req, res) => {
  try {
    const { refId } = req.params;
    const { workspace } = req.app.locals;
    
    logger.info(`Starting preview for ref ${refId}`);
    
    // Check if preview already exists
    if (activePreviews.has(refId)) {
      const preview = activePreviews.get(refId);
      if (preview.status === 'running') {
        return res.json({
          success: true,
          previewId: preview.id,
          port: preview.port,
          url: `http://localhost:${preview.port}`,
          status: 'running'
        });
      }
    }
    
    const refPath = getRefPath(workspace.workspace, refId);
    
    // Check if ref exists
    try {
      await fs.access(refPath);
    } catch {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference ${refId} not found`
        }
      });
    }
    
    // Detect package manager
    const packageManager = await detectPackageManager(refPath);
    if (!packageManager) {
      return res.status(400).json({
        error: {
          code: 'NO_PACKAGE_JSON',
          message: 'No package.json found in reference'
        }
      });
    }
    
    // Create preview record
    const previewId = uuidv4();
    const port = getNextAvailablePort();
    const preview = {
      id: previewId,
      refId,
      port,
      status: 'installing',
      logs: [],
      process: null,
      eventEmitter: new EventEmitter()
    };
    
    activePreviews.set(refId, preview);
    
    // Start installation process
    logger.info(`Installing dependencies with ${packageManager} for ref ${refId}`);
    
    const installCmd = packageManager === 'npm' ? 'npm' : packageManager;
    const installArgs = ['install'];
    
    const installProcess = spawn(installCmd, installArgs, {
      cwd: refPath,
      env: { ...process.env, CI: 'true' }
    });
    
    installProcess.stdout.on('data', (data) => {
      const log = { timestamp: new Date().toISOString(), type: 'info', content: data.toString() };
      preview.logs.push(log);
      preview.eventEmitter.emit('log', log);
    });
    
    installProcess.stderr.on('data', (data) => {
      const log = { timestamp: new Date().toISOString(), type: 'error', content: data.toString() };
      preview.logs.push(log);
      preview.eventEmitter.emit('log', log);
    });
    
    installProcess.on('close', (code) => {
      if (code !== 0) {
        preview.status = 'error';
        preview.eventEmitter.emit('status', { status: 'error' });
        return;
      }
      
      // Start the dev server
      preview.status = 'starting';
      preview.eventEmitter.emit('status', { status: 'starting' });
      
      logger.info(`Starting dev server on port ${port} for ref ${refId}`);
      
      const devCmd = packageManager === 'npm' ? 'npm' : packageManager;
      const devArgs = ['run', 'dev'];
      
      const devProcess = spawn(devCmd, devArgs, {
        cwd: refPath,
        env: {
          ...process.env,
          PORT: port.toString(),
          VITE_PORT: port.toString(), // For Vite
          NEXT_PORT: port.toString(), // For Next.js
          REACT_APP_PORT: port.toString(), // For CRA
        }
      });
      
      preview.process = devProcess;
      
      devProcess.stdout.on('data', (data) => {
        const log = { timestamp: new Date().toISOString(), type: 'info', content: data.toString() };
        preview.logs.push(log);
        preview.eventEmitter.emit('log', log);
        
        // Check if server is ready
        const output = data.toString().toLowerCase();
        if (output.includes('ready') || output.includes('running') || output.includes('started') || output.includes(`localhost:${port}`)) {
          preview.status = 'running';
          preview.eventEmitter.emit('status', { 
            status: 'running', 
            port: preview.port,
            url: `http://localhost:${preview.port}`
          });
        }
      });
      
      devProcess.stderr.on('data', (data) => {
        const log = { timestamp: new Date().toISOString(), type: 'error', content: data.toString() };
        preview.logs.push(log);
        preview.eventEmitter.emit('log', log);
      });
      
      devProcess.on('close', (code) => {
        logger.info(`Dev server for ref ${refId} exited with code ${code}`);
        preview.status = 'stopped';
        preview.eventEmitter.emit('status', { status: 'stopped' });
        activePreviews.delete(refId);
      });
    });
    
    res.json({
      success: true,
      previewId,
      port,
      status: 'installing'
    });
  } catch (error) {
    logger.error('Error starting preview:', error);
    res.status(500).json({
      error: {
        code: 'PREVIEW_START_FAILED',
        message: error.message
      }
    });
  }
});

// Get preview status
router.get('/refs/:refId/preview/status', async (req, res) => {
  try {
    const { refId } = req.params;
    
    const preview = activePreviews.get(refId);
    if (!preview) {
      return res.json({
        status: 'stopped',
        running: false
      });
    }
    
    res.json({
      status: preview.status,
      running: preview.status === 'running',
      port: preview.port,
      url: preview.status === 'running' ? `http://localhost:${preview.port}` : undefined,
      previewId: preview.id
    });
  } catch (error) {
    logger.error('Error getting preview status:', error);
    res.status(500).json({
      error: {
        code: 'STATUS_FAILED',
        message: error.message
      }
    });
  }
});

// Stop preview
router.post('/refs/:refId/preview/stop', async (req, res) => {
  try {
    const { refId } = req.params;
    
    const preview = activePreviews.get(refId);
    if (!preview) {
      return res.json({ success: true });
    }
    
    if (preview.process) {
      preview.process.kill('SIGTERM');
      // Give it time to terminate gracefully
      setTimeout(() => {
        if (preview.process && !preview.process.killed) {
          preview.process.kill('SIGKILL');
        }
      }, 5000);
    }
    
    activePreviews.delete(refId);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Error stopping preview:', error);
    res.status(500).json({
      error: {
        code: 'STOP_FAILED',
        message: error.message
      }
    });
  }
});

// Stream logs via SSE
router.get('/refs/:refId/preview/logs', async (req, res) => {
  try {
    const { refId } = req.params;
    const { previewId } = req.query;
    
    const preview = activePreviews.get(refId);
    if (!preview || preview.id !== previewId) {
      return res.status(404).json({
        error: {
          code: 'PREVIEW_NOT_FOUND',
          message: 'Preview not found'
        }
      });
    }
    
    logger.info(`Starting log stream for ref ${refId} preview ${previewId}`);
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    // Send recent logs
    preview.logs.slice(-50).forEach(log => {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    });
    
    // Send current status
    res.write(`event: status\ndata: ${JSON.stringify({
      status: preview.status,
      port: preview.port,
      url: preview.status === 'running' ? `http://localhost:${preview.port}` : undefined
    })}\n\n`);
    
    // Listen for new logs
    const logHandler = (log) => {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    };
    
    const statusHandler = (status) => {
      res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
    };
    
    preview.eventEmitter.on('log', logHandler);
    preview.eventEmitter.on('status', statusHandler);
    
    // Heartbeat
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30000);
    
    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      preview.eventEmitter.off('log', logHandler);
      preview.eventEmitter.off('status', statusHandler);
      logger.info(`Log stream closed for ref ${refId}`);
    });
  } catch (error) {
    logger.error('Error streaming logs:', error);
    res.status(500).json({
      error: {
        code: 'STREAM_FAILED',
        message: error.message
      }
    });
  }
});

export default router;