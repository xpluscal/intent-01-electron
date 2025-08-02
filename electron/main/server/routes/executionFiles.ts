import express from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as validators from '../validators.js';
import { NotFoundError, createErrorResponse } from '../errors.js';
import { createLogger } from '../logger.js';

const logger = createLogger('routes/executionFiles');
const router = express.Router();

/**
 * GET /executions/:executionId/files - List files and folders in execution workspace
 */
router.get('/executions/:executionId/files', async (req, res, next) => {
  try {
    const executionId = validators.validateExecutionId(req.params.executionId);
    const { path: dirPath = '', recursive = false } = req.query;
    const { db, workspaceManager } = req.app.locals;
    
    // Check if execution exists
    const execution = await db.get(
      'SELECT id, status FROM executions WHERE id = ?',
      [executionId]
    );
    
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    
    // Build execution workspace path
    const workspacePath = path.join(
      workspaceManager.getWorkspacePath(),
      '.execution',
      `exec-${executionId}`
    );
    
    // Check if workspace exists
    try {
      await fs.access(workspacePath);
    } catch (error) {
      return res.status(404).json({
        error: {
          code: 'WORKSPACE_NOT_FOUND',
          message: 'Execution workspace not found'
        }
      });
    }
    
    // Build full path
    const fullPath = path.join(workspacePath, dirPath);
    
    // Ensure path is within workspace (prevent directory traversal)
    if (!fullPath.startsWith(workspacePath)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PATH',
          message: 'Invalid path'
        }
      });
    }
    
    try {
      const stats = await fs.stat(fullPath);
      
      if (!stats.isDirectory()) {
        return res.status(400).json({
          error: {
            code: 'NOT_A_DIRECTORY',
            message: 'Path is not a directory'
          }
        });
      }
      
      if (recursive === 'true' || recursive === true) {
        // Recursive listing
        const files = await listFilesRecursive(fullPath, workspacePath);
        res.json({ files });
      } else {
        // Single-level listing with metadata
        const entries = await listDirectory(fullPath, workspacePath);
        res.json({ entries });
      }
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          error: {
            code: 'PATH_NOT_FOUND',
            message: 'Path not found in workspace'
          }
        });
      }
      throw error;
    }
    
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

/**
 * GET /executions/:executionId/file - Read file content from execution workspace
 */
router.get('/executions/:executionId/file', async (req, res, next) => {
  try {
    const executionId = validators.validateExecutionId(req.params.executionId);
    const { path: filePath } = req.query;
    const { db, workspaceManager } = req.app.locals;
    
    if (!filePath) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PATH',
          message: 'File path is required'
        }
      });
    }
    
    // Check if execution exists
    const execution = await db.get(
      'SELECT id, status FROM executions WHERE id = ?',
      [executionId]
    );
    
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    
    // Build execution workspace path
    const workspacePath = path.join(
      workspaceManager.getWorkspacePath(),
      '.execution',
      `exec-${executionId}`
    );
    
    // Check if workspace exists
    try {
      await fs.access(workspacePath);
    } catch (error) {
      return res.status(404).json({
        error: {
          code: 'WORKSPACE_NOT_FOUND',
          message: 'Execution workspace not found'
        }
      });
    }
    
    // Build full path
    const fullPath = path.join(workspacePath, filePath);
    
    // Ensure path is within workspace (prevent directory traversal)
    if (!fullPath.startsWith(workspacePath)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PATH',
          message: 'Invalid path'
        }
      });
    }
    
    try {
      const stats = await fs.stat(fullPath);
      
      if (!stats.isFile()) {
        return res.status(400).json({
          error: {
            code: 'NOT_A_FILE',
            message: 'Path is not a file'
          }
        });
      }
      
      // Check file size
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (stats.size > maxSize) {
        return res.status(400).json({
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File too large (max ${maxSize} bytes)`
          }
        });
      }
      
      // Read file content
      const content = await fs.readFile(fullPath, 'utf8');
      
      res.json({
        path: path.relative(workspacePath, fullPath),
        size: stats.size,
        modified: stats.mtime,
        content
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found in workspace'
          }
        });
      }
      if (error.code === 'EISDIR') {
        return res.status(400).json({
          error: {
            code: 'IS_DIRECTORY',
            message: 'Path is a directory, not a file'
          }
        });
      }
      throw error;
    }
    
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

/**
 * Helper function to list directory contents
 */
async function listDirectory(dirPath, basePath) {
  const entries = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const relativePath = path.relative(basePath, itemPath);
    const stats = await fs.stat(itemPath);
    
    entries.push({
      name: item.name,
      path: relativePath,
      type: item.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      modified: stats.mtime
    });
  }
  
  // Sort directories first, then files
  entries.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === 'directory' ? -1 : 1;
  });
  
  return entries;
}

/**
 * Helper function to recursively list files
 */
async function listFilesRecursive(dirPath, basePath, files = []) {
  const items = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const relativePath = path.relative(basePath, itemPath);
    
    if (item.isDirectory()) {
      await listFilesRecursive(itemPath, basePath, files);
    } else {
      files.push(relativePath);
    }
  }
  
  return files;
}

export default router;