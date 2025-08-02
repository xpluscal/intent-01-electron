import express from 'express';
const router = express.Router();
import { createLogger } from '../logger.js';
import RefManager from '../services/RefManager.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const logger = createLogger('refs-routes');

// Initialize RefManager lazily to get workspace from app.locals
let refManager;
function getRefManager(req) {
  if (!refManager) {
    refManager = new RefManager(req.app.locals.workspace.workspace);
  }
  return refManager;
}

// List all references
router.get('/refs', async (req, res, next) => {
  try {
    const manager = getRefManager(req);
    const refsDir = path.join(req.app.locals.workspace.workspace, 'refs');
    
    // Get all directories in refs folder
    const refs = [];
    try {
      const entries = await fs.readdir(refsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const refId = entry.name;
          const refPath = path.join(refsDir, refId);
          
          try {
            // Get basic git info
            const branchInfo = await manager.listBranches(refId);
            const branches = branchInfo.branches;
            const currentBranch = branchInfo.current;
            
            // Get last commit info
            const lastCommit = await manager.execGit(refPath, 
              'log -1 --format=%H%n%an%n%ae%n%at%n%s'
            );
            const [hash, author, email, timestamp, subject] = lastCommit.split('\n');
            
            // Check for active worktrees (executions)
            const worktrees = await manager.listWorktrees(refId);
            const activeExecutions = worktrees
              .filter(w => w.branch && w.branch.startsWith('exec-'))
              .map(w => w.branch.replace('exec-', ''));
            
            refs.push({
              refId,
              currentBranch,
              branches: branches.map(b => b.name),
              lastCommit: {
                hash,
                author,
                email,
                timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
                message: subject
              },
              activeExecutions
            });
          } catch (error) {
            logger.error(`Error getting info for ref ${refId}:`, error);
            refs.push({
              refId,
              error: 'Failed to get reference info'
            });
          }
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // refs directory doesn't exist yet
        return res.json({ refs: [] });
      }
      throw error;
    }
    
    res.json({ refs });
  } catch (error) {
    next(error);
  }
});

// Get detailed reference info
router.get('/refs/:refId/info', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const manager = getRefManager(req);
    
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }
    
    const refPath = path.join(req.app.locals.workspace.workspace, 'refs', refId);
    
    // Get current branch
    const currentBranch = await manager.execGit(refPath, 'rev-parse --abbrev-ref HEAD');
    
    // Get all branches with last commit info
    const branchInfo = await manager.listBranches(refId);
    const branches = branchInfo.branches;
    const branchDetails = [];
    
    for (const branch of branches) {
      const commitInfo = await manager.execGit(refPath,
        `log -1 --format=%H%n%at%n%s ${branch.name}`
      );
      const [hash, timestamp, subject] = commitInfo.split('\n');
      
      branchDetails.push({
        name: branch.name,
        isHead: branch.isHead,
        lastCommit: {
          hash,
          timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
          message: subject
        }
      });
    }
    
    // Get recent commits
    const recentCommits = await manager.execGit(refPath,
      'log -10 --format=%H%n%an%n%ae%n%at%n%s%n'
    );
    const commits = [];
    const lines = recentCommits.trim().split('\n');
    
    for (let i = 0; i < lines.length; i += 6) {
      if (lines[i]) {
        commits.push({
          hash: lines[i],
          author: lines[i + 1],
          email: lines[i + 2],
          timestamp: new Date(parseInt(lines[i + 3]) * 1000).toISOString(),
          message: lines[i + 4]
        });
      }
    }
    
    // Get active executions
    const worktrees = await manager.listWorktrees(refId);
    const activeExecutions = worktrees
      .filter(w => w.branch && w.branch.startsWith('exec-'))
      .map(w => ({
        executionId: w.branch.replace('exec-', ''),
        branch: w.branch,
        path: w.worktree
      }));
    
    // Get repository stats
    const fileCount = await manager.execGit(refPath, 'ls-files | wc -l');
    const size = await manager.execGit(refPath, 'count-objects -v');
    const sizeMatch = size.match(/size: (\d+)/);
    
    res.json({
      refId,
      currentBranch,
      branches: branchDetails,
      recentCommits: commits,
      activeExecutions,
      stats: {
        fileCount: parseInt(fileCount.trim()),
        sizeKB: sizeMatch ? parseInt(sizeMatch[1]) : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

// List branches
router.get('/refs/:refId/branches', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const manager = getRefManager(req);
    
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }
    
    const branchInfo = await manager.listBranches(refId);
    const branches = branchInfo.branches;
    const currentBranch = branchInfo.current;
    const refPath = path.join(req.app.locals.workspace.workspace, 'refs', refId);
    
    // Get detailed info for each branch
    const branchDetails = [];
    for (const branch of branches) {
      const commitInfo = await manager.execGit(refPath,
        `log -1 --format=%H%n%an%n%at%n%s ${branch.name}`
      );
      const [hash, author, timestamp, subject] = commitInfo.split('\n');
      
      branchDetails.push({
        name: branch.name,
        isHead: branch.isHead,
        isCurrent: branch.name === currentBranch,
        isExecutionBranch: branch.name.startsWith('exec-'),
        lastCommit: {
          hash,
          author,
          timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
          message: subject
        }
      });
    }
    
    res.json({
      currentBranch,
      branches: branchDetails
    });
  } catch (error) {
    next(error);
  }
});

// Switch branch (UI only - doesn't affect executions)
router.post('/refs/:refId/checkout', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { branch } = req.body;
    const manager = getRefManager(req);
    
    if (!branch) {
      return res.status(400).json({
        error: {
          code: 'MISSING_BRANCH',
          message: 'Branch name is required'
        }
      });
    }
    
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }
    
    const refPath = path.join(req.app.locals.workspace.workspace, 'refs', refId);
    
    // Check if branch exists
    const branchInfo = await manager.listBranches(refId);
    const branchExists = branchInfo.branches.some(b => b.name === branch);
    
    if (!branchExists) {
      return res.status(404).json({
        error: {
          code: 'BRANCH_NOT_FOUND',
          message: `Branch '${branch}' not found in reference '${refId}'`
        }
      });
    }
    
    // Switch branch
    await manager.execGit(refPath, `checkout ${manager.escapeArg(branch)}`);
    
    res.json({
      refId,
      branch,
      success: true
    });
  } catch (error) {
    next(error);
  }
});

// List files in reference
router.get('/refs/:refId/files', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { branch = 'HEAD', path: dirPath = '', recursive = false } = req.query;
    const manager = getRefManager(req);
    
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }
    
    if (recursive === 'true' || recursive === true) {
      // Use ls-tree for recursive listing
      const files = await manager.listFiles(refId, branch, dirPath);
      res.json({ files });
    } else {
      // Use listDirectory for single-level listing with metadata
      const entries = await manager.listDirectory(refId, branch, dirPath);
      res.json({ entries });
    }
  } catch (error) {
    // Handle specific git errors
    if ((error.message.includes('pathspec') && error.message.includes('did not match')) ||
        (error.message.includes('Branch') && error.message.includes('or path') && error.message.includes('not found'))) {
      return res.status(404).json({
        error: {
          code: 'PATH_NOT_FOUND',
          message: 'Path not found in repository'
        }
      });
    }
    
    if (error.message.includes('unknown revision')) {
      return res.status(404).json({
        error: {
          code: 'BRANCH_NOT_FOUND',
          message: 'Branch or revision not found'
        }
      });
    }
    
    next(error);
  }
});

// Read file content
router.get('/refs/:refId/file', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { branch = 'HEAD', path: filePath } = req.query;
    const manager = getRefManager(req);
    
    if (!filePath) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PATH',
          message: 'File path is required'
        }
      });
    }
    
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }
    
    try {
      // Get file info first
      const fileInfo = await manager.getFileInfo(refId, branch, filePath);
      
      if (!fileInfo) {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found in repository'
          }
        });
      }
      
      if (fileInfo.type !== 'blob') {
        return res.status(400).json({
          error: {
            code: 'NOT_A_FILE',
            message: 'Path is not a file'
          }
        });
      }
      
      // Read file content
      const fileData = await manager.readFile(refId, branch, filePath);
      
      if (!fileData.found) {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found in repository'
          }
        });
      }
      
      const buffer = fileData.content;
      const isBinary = fileData.isBinary;
      
      if (isBinary) {
        // Return as base64 for binary files
        res.json({
          path: filePath,
          encoding: 'base64',
          content: buffer.toString('base64'),
          size: fileInfo.size,
          mode: fileInfo.mode
        });
      } else {
        // Return as UTF-8 for text files
        res.json({
          path: filePath,
          encoding: 'utf8',
          content: buffer.toString('utf8'),
          size: fileInfo.size,
          mode: fileInfo.mode
        });
      }
    } catch (error) {
      if (error.message.includes('pathspec') && error.message.includes('did not match')) {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found in repository'
          }
        });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// Merge branches
router.post('/refs/:refId/merge', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { sourceBranch, targetBranch = 'main', strategy = 'merge', commitMessage } = req.body;
    const manager = getRefManager(req);
    
    // Validate required parameters
    if (!sourceBranch) {
      return res.status(400).json({
        error: {
          code: 'MISSING_SOURCE_BRANCH',
          message: 'Source branch is required'
        }
      });
    }
    
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }
    
    const refPath = path.join(req.app.locals.workspace.workspace, 'refs', refId);
    
    // Check if both branches exist
    const branchInfo = await manager.listBranches(refId);
    const branches = branchInfo.branches.map(b => b.name);
    
    if (!branches.includes(sourceBranch)) {
      return res.status(404).json({
        error: {
          code: 'SOURCE_BRANCH_NOT_FOUND',
          message: `Source branch '${sourceBranch}' not found`
        }
      });
    }
    
    if (!branches.includes(targetBranch)) {
      return res.status(404).json({
        error: {
          code: 'TARGET_BRANCH_NOT_FOUND',
          message: `Target branch '${targetBranch}' not found`
        }
      });
    }
    
    // Get original state of target branch before merge
    const originalTargetCommit = await manager.execGit(refPath, `rev-parse ${manager.escapeArg(targetBranch)}`);
    
    // Switch to target branch
    await manager.execGit(refPath, `checkout ${manager.escapeArg(targetBranch)}`);
    
    try {
      let mergeOutput;
      let mergeCommit;
      
      if (strategy === 'rebase') {
        // Rebase source branch onto target
        mergeOutput = await manager.execGit(refPath, `rebase ${manager.escapeArg(sourceBranch)}`);
        mergeCommit = await manager.execGit(refPath, 'rev-parse HEAD');
      } else if (strategy === 'squash') {
        // Squash merge
        mergeOutput = await manager.execGit(refPath, `merge --squash ${manager.escapeArg(sourceBranch)}`);
        const message = commitMessage || `Squash merge of ${sourceBranch} into ${targetBranch}`;
        await manager.execGit(refPath, `commit -m ${manager.escapeArg(message)}`);
        mergeCommit = await manager.execGit(refPath, 'rev-parse HEAD');
      } else if (strategy === 'ff-only') {
        // Fast-forward only merge
        mergeOutput = await manager.execGit(refPath, `merge --ff-only ${manager.escapeArg(sourceBranch)}`);
        mergeCommit = await manager.execGit(refPath, 'rev-parse HEAD');
      } else {
        // Default merge strategy
        const message = commitMessage || `Merge ${sourceBranch} into ${targetBranch}`;
        mergeOutput = await manager.execGit(refPath, 
          `merge ${manager.escapeArg(sourceBranch)} -m ${manager.escapeArg(message)}`
        );
        mergeCommit = await manager.execGit(refPath, 'rev-parse HEAD');
      }
      
      // Get commit info
      const commitInfo = await manager.execGit(refPath, 'log -1 --format=%H%n%an%n%ae%n%at%n%s');
      const [hash, author, email, timestamp, subject] = commitInfo.split('\n');
      
      // Get diff of the merge
      const diffOutput = await manager.execGit(refPath, `diff --stat ${originalTargetCommit}..HEAD`);
      
      // Record merge in database if available
      if (req.app.locals.db) {
        try {
          await req.app.locals.db.run(
            `INSERT INTO ref_changes (execution_id, ref_id, change_type, branch_name, commit_hash, commit_message, merge_status) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [null, refId, 'merge', sourceBranch, mergeCommit, subject, 'success']
          );
        } catch (dbError) {
          logger.warn('Failed to record merge in database:', dbError);
          // Don't fail the merge if database recording fails
        }
      }
      
      res.json({
        success: true,
        refId,
        merge: {
          sourceBranch,
          targetBranch,
          strategy,
          commit: {
            hash,
            author,
            email,
            timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
            message: subject
          },
          diff: {
            summary: diffOutput,
            originalCommit: originalTargetCommit,
            mergeCommit
          },
          output: mergeOutput
        }
      });
      
    } catch (error) {
      // Handle merge conflicts
      if (error.message.includes('CONFLICT') || error.message.includes('conflict')) {
        // Get conflict details
        let conflictInfo = {};
        
        try {
          const status = await manager.execGit(refPath, 'status --porcelain');
          const conflictFiles = status.split('\n')
            .filter(line => line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD '))
            .map(line => line.substring(3).trim());
          
          conflictInfo = {
            files: conflictFiles,
            count: conflictFiles.length
          };
          
          // Get conflict markers for first few files
          if (conflictFiles.length > 0) {
            const conflictDetails = [];
            for (const file of conflictFiles.slice(0, 3)) { // Limit to first 3 files
              try {
                const content = await fs.readFile(path.join(refPath, file), 'utf8');
                const conflicts = [];
                const lines = content.split('\n');
                
                let inConflict = false;
                let conflictStart = -1;
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].startsWith('<<<<<<<')) {
                    inConflict = true;
                    conflictStart = i;
                  } else if (lines[i].startsWith('>>>>>>>') && inConflict) {
                    conflicts.push({
                      startLine: conflictStart + 1,
                      endLine: i + 1,
                      lines: lines.slice(conflictStart, i + 1)
                    });
                    inConflict = false;
                  }
                }
                
                conflictDetails.push({
                  file,
                  conflicts
                });
              } catch (readError) {
                conflictDetails.push({
                  file,
                  error: 'Could not read conflict details'
                });
              }
            }
            
            conflictInfo.details = conflictDetails;
          }
          
          // Abort the merge
          try {
            if (strategy === 'rebase') {
              await manager.execGit(refPath, 'rebase --abort');
            } else {
              await manager.execGit(refPath, 'merge --abort');
            }
          } catch (abortError) {
            logger.warn('Failed to abort merge:', abortError);
          }
          
        } catch (statusError) {
          logger.warn('Failed to get conflict details:', statusError);
        }
        
        return res.status(409).json({
          success: false,
          error: {
            code: 'MERGE_CONFLICT',
            message: 'Merge conflicts detected',
            conflicts: conflictInfo
          },
          refId,
          merge: {
            sourceBranch,
            targetBranch,
            strategy,
            aborted: true
          }
        });
      }
      
      // Handle other merge errors
      throw error;
    }
    
  } catch (error) {
    logger.error(`Merge failed for ${req.params.refId}:`, error);
    
    // Try to get back to a clean state
    try {
      const manager = getRefManager(req);
      const refPath = path.join(req.app.locals.workspace.workspace, 'refs', req.params.refId);
      await manager.execGit(refPath, 'checkout main');
    } catch (cleanupError) {
      logger.warn('Failed to cleanup after merge error:', cleanupError);
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'MERGE_FAILED',
        message: error.message
      },
      refId: req.params.refId
    });
  }
});

// Get diff between branches
router.get('/refs/:refId/diff', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { from, to = 'main', format = 'unified' } = req.query;
    const manager = getRefManager(req);
    
    if (!from) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FROM_BRANCH',
          message: 'From branch is required'
        }
      });
    }
    
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }
    
    const refPath = path.join(req.app.locals.workspace.workspace, 'refs', refId);
    
    // Check if both branches exist
    const branchInfo = await manager.listBranches(refId);
    const branches = branchInfo.branches.map(b => b.name);
    
    if (!branches.includes(from)) {
      return res.status(404).json({
        error: {
          code: 'FROM_BRANCH_NOT_FOUND',
          message: `From branch '${from}' not found`
        }
      });
    }
    
    if (!branches.includes(to)) {
      return res.status(404).json({
        error: {
          code: 'TO_BRANCH_NOT_FOUND',
          message: `To branch '${to}' not found`
        }
      });
    }
    
    // Get diff statistics
    const diffStat = await manager.execGit(refPath, 
      `diff --stat ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
    );
    
    // Get commit count difference
    const commitCount = await manager.execGit(refPath,
      `rev-list --count ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
    );
    
    let diffContent;
    if (format === 'name-only') {
      diffContent = await manager.execGit(refPath,
        `diff --name-only ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
      );
    } else if (format === 'name-status') {
      diffContent = await manager.execGit(refPath,
        `diff --name-status ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
      );
    } else {
      // Unified diff format
      diffContent = await manager.execGit(refPath,
        `diff ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
      );
    }
    
    // Parse changed files
    const changedFiles = [];
    if (diffStat) {
      const statLines = diffStat.split('\n').slice(0, -1); // Remove summary line
      for (const line of statLines) {
        const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s+([+-]+)$/);
        if (match) {
          const [, filename, changes, indicators] = match;
          const additions = (indicators.match(/\+/g) || []).length;
          const deletions = (indicators.match(/-/g) || []).length;
          
          changedFiles.push({
            filename,
            changes: parseInt(changes),
            additions,
            deletions
          });
        }
      }
    }
    
    res.json({
      refId,
      diff: {
        from,
        to,
        format,
        commitCount: parseInt(commitCount) || 0,
        changedFiles,
        summary: diffStat,
        content: diffContent
      }
    });
    
  } catch (error) {
    next(error);
  }
});

export default router;