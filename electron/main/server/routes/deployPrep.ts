import express from 'express';
import { createLogger } from '../logger.js';
import RefManager from '../services/RefManager.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const router = express.Router();
const logger = createLogger('deploy-prep');

// Initialize RefManager lazily
let refManager: RefManager | null = null;

function getRefManager(req: express.Request): RefManager {
  if (!refManager) {
    refManager = new RefManager(req.app.locals.workspace.workspace);
  }
  return refManager;
}

// Prepare deployment information for a ref
router.post('/deploy/prepare/:refId', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const manager = getRefManager(req);

    // Check if ref exists
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }

    const refPath = path.join(req.app.locals.workspace.workspace, 'refs', refId);
    
    logger.info('Preparing deployment for ref', { refId, refPath });

    // Step 1: Check git remote
    let gitInfo = {
      hasRemote: false,
      remoteUrl: '',
      currentBranch: 'main',
      needsCommit: false,
      needsPush: false
    };

    try {
      // Get current branch
      gitInfo.currentBranch = await manager.execGit(refPath, 'rev-parse --abbrev-ref HEAD');
      
      // Check if remote exists
      try {
        gitInfo.remoteUrl = await manager.execGit(refPath, 'remote get-url origin');
        gitInfo.hasRemote = true;
        
        // Check if there are uncommitted changes
        const status = await manager.execGit(refPath, 'status --porcelain');
        gitInfo.needsCommit = status.trim().length > 0;
        
        if (!gitInfo.needsCommit) {
          // Check if local is ahead of remote
          try {
            const ahead = await manager.execGit(refPath, `rev-list --count origin/${gitInfo.currentBranch}..HEAD`);
            gitInfo.needsPush = parseInt(ahead) > 0;
          } catch (error) {
            // If this fails, probably means remote branch doesn't exist yet
            gitInfo.needsPush = true;
          }
        }
      } catch (error) {
        // No remote configured
        gitInfo.hasRemote = false;
      }
    } catch (error) {
      logger.warn('Failed to get git info', { refId, error: error.message });
    }

    // Step 2: Auto-commit and push if needed
    if (gitInfo.hasRemote && (gitInfo.needsCommit || gitInfo.needsPush)) {
      try {
        if (gitInfo.needsCommit) {
          // Add all changes and commit
          await manager.execGit(refPath, 'add .');
          const commitMessage = `Deploy: ${new Date().toISOString()}`;
          await manager.execGit(refPath, `commit -m "${commitMessage}"`);
          logger.info('Auto-committed changes', { refId });
        }
        
        if (gitInfo.needsCommit || gitInfo.needsPush) {
          // Push to remote
          await manager.execGit(refPath, `push origin ${gitInfo.currentBranch}`);
          logger.info('Pushed to remote', { refId, branch: gitInfo.currentBranch });
        }
        
        // Update status
        gitInfo.needsCommit = false;
        gitInfo.needsPush = false;
      } catch (error) {
        logger.warn('Failed to auto-commit/push', { refId, error: error.message });
        // Continue anyway - user might need to resolve conflicts manually
      }
    }

    // Step 3: Read environment variables from .env.local
    const envVars: { key: string; value: string }[] = [];
    const envFilePath = path.join(refPath, '.env.local');
    
    try {
      const envContent = await fs.readFile(envFilePath, 'utf8');
      const lines = envContent.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
          envVars.push({ key: key.trim(), value: value.trim() });
        }
      }
      
      logger.info('Found environment variables', { refId, count: envVars.length });
    } catch (error) {
      // .env.local doesn't exist or can't be read - that's fine
      logger.info('No .env.local file found', { refId });
    }

    // Step 4: Generate Vercel import URL
    let vercelImportUrl = 'https://vercel.com/new';
    if (gitInfo.hasRemote && gitInfo.remoteUrl) {
      // Extract owner and repo name from git URL for cleaner Vercel import
      const repoMatch = gitInfo.remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/);
      if (repoMatch) {
        const [, owner, repo] = repoMatch;
        // Use Vercel's cleaner import URL that doesn't trigger clone
        vercelImportUrl = `https://vercel.com/new/import?s=https://github.com/${owner}/${repo}`;
      } else {
        // Fallback to encoded URL
        const encodedRepoUrl = encodeURIComponent(gitInfo.remoteUrl);
        vercelImportUrl = `https://vercel.com/new/import?s=${encodedRepoUrl}`;
      }
    }

    // Step 5: Get suggested project name from ref or repo
    let suggestedProjectName = refId;
    if (gitInfo.remoteUrl) {
      // Extract repo name from URL
      const match = gitInfo.remoteUrl.match(/\/([^\/]+?)(?:\.git)?$/);
      if (match) {
        suggestedProjectName = match[1];
      }
    }

    const result = {
      success: true,
      refId,
      git: gitInfo,
      environmentVariables: envVars,
      vercelImportUrl,
      suggestedProjectName,
      instructions: {
        hasRemote: gitInfo.hasRemote,
        nextSteps: gitInfo.hasRemote ? [
          'Click "Open Vercel Import" below',
          'Paste environment variables in Vercel',
          'Deploy with one click!'
        ] : [
          'Create a GitHub repository',
          'Add it as remote: git remote add origin <repo-url>',
          'Push your code: git push -u origin main',
          'Then try deploying again'
        ]
      }
    };

    res.json(result);

  } catch (error) {
    logger.error('Failed to prepare deployment', { refId: req.params.refId, error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'PREPARATION_FAILED',
        message: error.message || 'Failed to prepare deployment'
      }
    });
  }
});

export default router;