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

// Get executions for a specific reference
router.get('/refs/:refId/executions', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { db } = req.app.locals;
    
    // Query executions where this ref was used as a mutate item
    const executions = await db.all(`
      SELECT DISTINCT 
        e.id,
        e.status,
        e.phase,
        e.agent_type,
        e.created_at as created,
        e.completed_at as completed,
        e.rollback_reason as error,
        e.message_count,
        e.workspace_path
      FROM executions e
      INNER JOIN execution_refs er ON e.id = er.execution_id
      WHERE er.ref_id = ? AND er.permission = 'mutate'
      ORDER BY e.created_at DESC
    `, [refId]);
    
    // For each execution, get the read references
    const executionsWithRefs = await Promise.all(executions.map(async (exec) => {
      const readRefs = await db.all(`
        SELECT ref_id
        FROM execution_refs
        WHERE execution_id = ? AND permission = 'read'
      `, [exec.id]);
      
      return {
        ...exec,
        readReferences: readRefs.map(r => r.ref_id)
      };
    }));
    
    res.json({
      refId,
      executions: executionsWithRefs
    });
  } catch (error) {
    logger.error('Failed to get executions for ref', { refId: req.params.refId, error: error.message });
    next(error);
  }
});

// Merge branches
router.post('/refs/:refId/merge', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { sourceBranch, targetBranch = 'main', strategy = 'merge', commitMessage, executionId } = req.body;
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
            [executionId || null, refId, 'merge', sourceBranch, mergeCommit, subject, 'success']
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

// Get logs for a specific execution
router.get('/executions/:executionId/logs', async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { db } = req.app.locals;
    
    // Get logs for this execution
    const logs = await db.all(`
      SELECT timestamp, type, content
      FROM logs
      WHERE execution_id = ?
      ORDER BY timestamp ASC
    `, [executionId]);
    
    res.json({
      executionId,
      logs: logs.map(log => ({
        timestamp: log.timestamp,
        type: log.type,
        content: typeof log.content === 'string' ? JSON.parse(log.content) : log.content
      }))
    });
  } catch (error) {
    logger.error('Failed to get logs for execution', { executionId: req.params.executionId, error: error.message });
    next(error);
  }
});

// Temporary: Add deploy prepare endpoint here until route loading issue is resolved
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
    
    // Basic git info
    let gitInfo = {
      hasRemote: false,
      remoteUrl: '',
      currentBranch: 'main',
      needsCommit: false,
      needsPush: false
    };

    try {
      // First ensure git is initialized
      try {
        await manager.execGit(refPath, 'rev-parse --git-dir');
      } catch (error) {
        // Initialize git if not already
        await manager.execGit(refPath, 'init');
        await manager.execGit(refPath, 'add .');
        await manager.execGit(refPath, 'commit -m "Initial commit"');
        console.log('✅ Initialized git repository');
      }
      
      // Get current branch
      gitInfo.currentBranch = await manager.execGit(refPath, 'rev-parse --abbrev-ref HEAD');
      
      // Check if remote exists, if not create GitHub repo automatically
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
            gitInfo.needsPush = true;
          }
        }
      } catch (error) {
        // No remote exists, let's create a GitHub repository automatically
        gitInfo.hasRemote = false;
        
        try {
          // Get user's GitHub username from git credential system
          let githubUsername;
          try {
            // Use git credential fill to get the stored GitHub username
            const credentialOutput = await manager.execGit(refPath, 
              'credential fill <<< "protocol=https\nhost=github.com" | grep "^username=" | cut -d= -f2'
            );
            githubUsername = credentialOutput.trim();
            
            if (!githubUsername) {
              throw new Error('No username found in git credentials');
            }
          } catch (error) {
            // Fallback: try to parse from existing GitHub remotes
            try {
              const remotes = await manager.execGit(refPath, 'remote -v');
              const match = remotes.match(/github\.com[:/]([^/]+)\//);
              if (match) {
                githubUsername = match[1];
              } else {
                throw new Error('No GitHub remotes found');
              }
            } catch (e) {
              console.log('⚠️ Could not detect GitHub username automatically');
              githubUsername = 'user'; // last resort fallback
            }
          }
          
          // Create repository name from refId
          const repoName = refId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          
          // Set up GitHub repository URL
          const repoUrl = `https://github.com/${githubUsername}/${repoName}.git`;
          
          // Try to create the repository using GitHub API with git credentials
          try {
            // Get the stored GitHub token from git credential store
            const credentialOutput = await manager.execGit(refPath, 
              'credential fill <<< "protocol=https\nhost=github.com"'
            );
            
            // Parse the password/token from credentials
            const passwordMatch = credentialOutput.match(/password=(.+)/);
            if (passwordMatch && passwordMatch[1]) {
              const token = passwordMatch[1].trim();
              
              // Create repository using GitHub API
              const createRepoPayload = JSON.stringify({
                name: repoName,
                private: false,
                auto_init: false
              });
              
              // Use direct shell execution instead of git command
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);
              
              const curlCommand = `curl -s -w "\\n%{http_code}" -X POST \
                -H "Authorization: token ${token}" \
                -H "Accept: application/vnd.github.v3+json" \
                -H "Content-Type: application/json" \
                -d '${createRepoPayload}' \
                https://api.github.com/user/repos`;
              
              const { stdout: apiResponse } = await execAsync(curlCommand, { cwd: refPath });
              const lines = apiResponse.trim().split('\n');
              const httpCode = lines[lines.length - 1];
              
              if (httpCode === '201') {
                console.log(`✅ Successfully created GitHub repository: ${repoName}`);
              } else if (httpCode === '422') {
                console.log(`ℹ️ Repository already exists: ${repoName}`);
              } else {
                console.log(`⚠️ GitHub API returned status ${httpCode}`);
              }
            }
          } catch (error) {
            console.log(`⚠️ Could not create repository automatically: ${error.message}`);
          }
          
          // Add the remote
          try {
            await manager.execGit(refPath, `remote get-url origin`);
            // Remote already exists, update it
            await manager.execGit(refPath, `remote set-url origin ${repoUrl}`);
          } catch {
            // Add new remote
            await manager.execGit(refPath, `remote add origin ${repoUrl}`);
          }
          
          gitInfo.remoteUrl = repoUrl;
          gitInfo.hasRemote = true;
          
          // Now try to push
          try {
            await manager.execGit(refPath, `push -u origin ${gitInfo.currentBranch}`);
            gitInfo.needsPush = false;
            console.log(`✅ Pushed to repository: ${repoName}`);
          } catch (pushError) {
            gitInfo.needsPush = true;
            console.log(`ℹ️ Push failed: ${pushError.message}`);
          }
        } catch (autoSetupError) {
          console.log(`❌ Failed to auto-setup repository: ${autoSetupError.message}`);
          // Keep gitInfo.hasRemote = false to show manual instructions
        }
      }
    } catch (error) {
      // Git operations failed
    }

    // Auto-commit and push if needed
    if (gitInfo.hasRemote && (gitInfo.needsCommit || gitInfo.needsPush)) {
      try {
        if (gitInfo.needsCommit) {
          await manager.execGit(refPath, 'add .');
          const commitMessage = `Deploy: ${new Date().toISOString()}`;
          await manager.execGit(refPath, `commit -m "${commitMessage}"`);
        }
        
        if (gitInfo.needsCommit || gitInfo.needsPush) {
          await manager.execGit(refPath, `push -u origin ${gitInfo.currentBranch}`);
          console.log(`✅ Pushed to remote: origin/${gitInfo.currentBranch}`);
        }
        
        gitInfo.needsCommit = false;
        gitInfo.needsPush = false;
      } catch (error) {
        console.log(`⚠️ Push failed: ${error.message}`);
        // If push fails, it's likely because the repo doesn't exist on GitHub yet
        if (error.message.includes('Repository not found') || error.message.includes('remote repository')) {
          console.log(`ℹ️ The GitHub repository needs to be created first`);
          gitInfo.needsPush = true; // Keep this flag so UI knows push is needed
        }
        // Continue anyway
      }
    }

    // Read environment variables from .env.local
    const envVars = [];
    const envFilePath = path.join(refPath, '.env.local');
    
    try {
      const envContent = await fs.readFile(envFilePath, 'utf8');
      const lines = envContent.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          envVars.push({ key: key.trim(), value: value.trim() });
        }
      }
    } catch (error) {
      // .env.local doesn't exist - that's fine
    }

    // Generate Vercel import URL
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

    // Get suggested project name
    let suggestedProjectName = refId;
    if (gitInfo.remoteUrl) {
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
        nextSteps: gitInfo.hasRemote ? 
          (gitInfo.needsPush ? [
            'GitHub remote is configured but push may have failed',
            'If you see "Repository not found" error on Vercel:',
            '1. Create the repository manually on GitHub',
            '2. Run: git push -u origin main',
            'Then click "Open Vercel Import" to deploy'
          ] : [
            'Your repository is ready and code is pushed!',
            'Click "Open Vercel Import" below',
            'Paste environment variables in Vercel',
            'Deploy with one click!'
          ]) : [
            'No GitHub remote configured',
            'To deploy, you need to:',
            '1. Create a GitHub repository',
            '2. Add it as remote: git remote add origin <repo-url>',
            '3. Push your code: git push -u origin main',
            'Then try deploying again'
          ]
      }
    };

    res.json(result);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'PREPARATION_FAILED',
        message: error.message || 'Failed to prepare deployment'
      }
    });
  }
});

// Get environment variables for a reference
router.get('/refs/:refId/env', async (req, res, next) => {
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
    
    const refPath = path.join(manager.refsDir, refId);
    const envLocalPath = path.join(refPath, '.env.local');
    const envExamplePath = path.join(refPath, '.env.example');
    
    const variables = [];
    const exampleVariables = [];
    
    // Read .env.local if exists
    try {
      const envContent = await fs.readFile(envLocalPath, 'utf8');
      const lines = envContent.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
            variables.push({ key, value });
          }
        }
      }
    } catch (error) {
      // .env.local doesn't exist - that's fine
      logger.debug(`No .env.local found for ref ${refId}`);
    }
    
    // Read .env.example if exists
    let hasEnvExample = false;
    try {
      const exampleContent = await fs.readFile(envExamplePath, 'utf8');
      hasEnvExample = true;
      const lines = exampleContent.split('\n');
      
      let lastComment = '';
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Capture comments as descriptions
        if (trimmed.startsWith('#')) {
          lastComment = trimmed.substring(1).trim();
          continue;
        }
        
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
            exampleVariables.push({ 
              key, 
              value,
              description: lastComment || undefined
            });
            lastComment = '';
          }
        }
      }
    } catch (error) {
      // .env.example doesn't exist
      logger.debug(`No .env.example found for ref ${refId}`);
    }
    
    res.json({
      variables,
      exampleVariables,
      hasEnvExample
    });
    
  } catch (error) {
    logger.error('Failed to get environment variables:', error);
    next(error);
  }
});

// Update environment variables for a reference
router.put('/refs/:refId/env', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { variables } = req.body;
    const manager = getRefManager(req);
    
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }
    
    if (!Array.isArray(variables)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Variables must be an array'
        }
      });
    }
    
    // Validate variables
    for (const variable of variables) {
      if (!variable.key || typeof variable.key !== 'string') {
        return res.status(400).json({
          error: {
            code: 'INVALID_VARIABLE',
            message: 'Each variable must have a key'
          }
        });
      }
      
      // Validate key format (alphanumeric, underscore, no spaces)
      if (!/^[A-Z0-9_]+$/i.test(variable.key)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_KEY_FORMAT',
            message: `Invalid key format: ${variable.key}. Use only letters, numbers, and underscores.`
          }
        });
      }
    }
    
    const refPath = path.join(manager.refsDir, refId);
    const envLocalPath = path.join(refPath, '.env.local');
    
    // Build .env.local content
    let content = '';
    for (const variable of variables) {
      const value = variable.value || '';
      // Quote values that contain spaces or special characters
      const needsQuotes = value.includes(' ') || value.includes('\n') || value.includes('"');
      const quotedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
      content += `${variable.key}=${quotedValue}\n`;
    }
    
    // Write the file
    await fs.writeFile(envLocalPath, content.trim() + '\n');
    
    // Commit the change if git is initialized
    try {
      await manager.execGit(refPath, 'add .env.local');
      await manager.execGit(refPath, 'commit -m "Update environment variables"');
      logger.info(`Committed .env.local changes for ref ${refId}`);
    } catch (error) {
      // Git might not be initialized or no changes to commit
      logger.debug('Could not commit .env.local:', error);
    }
    
    res.json({
      success: true,
      message: 'Environment variables updated successfully'
    });
    
  } catch (error) {
    logger.error('Failed to update environment variables:', error);
    next(error);
  }
});

// Import artifact from GitHub URL
router.post('/refs/import-github', async (req, res, next) => {
  try {
    const { githubUrl, refId: customRefId, projectId } = req.body;
    const manager = getRefManager(req);
    
    // Validate GitHub URL
    const githubUrlPattern = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+/;
    if (!githubUrl || !githubUrlPattern.test(githubUrl)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_GITHUB_URL',
          message: 'Please provide a valid GitHub repository URL'
        }
      });
    }
    
    // Extract repository name from URL
    const urlMatch = githubUrl.match(/github\.com\/[\w-]+\/([\w.-]+?)(\.git)?$/);
    if (!urlMatch) {
      return res.status(400).json({
        error: {
          code: 'INVALID_GITHUB_URL',
          message: 'Could not extract repository name from URL'
        }
      });
    }
    
    const repoName = urlMatch[1];
    const refId = customRefId || repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    // Check if ref already exists
    if (await manager.refExists(refId)) {
      return res.status(400).json({
        error: {
          code: 'REF_EXISTS',
          message: `Reference '${refId}' already exists`
        }
      });
    }
    
    // Create reference directory
    const refsDir = path.join(req.app.locals.workspace.workspace, 'refs');
    const refPath = path.join(refsDir, refId);
    
    try {
      await fs.mkdir(refPath, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create directory for ref ${refId}:`, error);
      throw new Error('Failed to create reference directory');
    }
    
    // Clone the repository
    logger.info(`Cloning repository ${githubUrl} to ${refPath}`);
    try {
      // Clone with depth 1 for faster clone
      await manager.execGit(refsDir, `clone --depth 1 ${githubUrl} ${refId}`);
      logger.info(`Successfully cloned repository to ${refId}`);
      
      // Remove the .git/shallow file to allow full git operations
      try {
        await fs.unlink(path.join(refPath, '.git', 'shallow'));
      } catch (error) {
        // Ignore if file doesn't exist
      }
      
      // Fetch full history
      try {
        await manager.execGit(refPath, 'fetch --unshallow');
      } catch (error) {
        // Ignore if already unshallow
      }
    } catch (error) {
      // Clean up directory on failure
      try {
        await fs.rm(refPath, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.error('Failed to cleanup after clone error:', cleanupError);
      }
      
      logger.error(`Failed to clone repository:`, error);
      return res.status(400).json({
        error: {
          code: 'CLONE_FAILED',
          message: error.message.includes('Repository not found') 
            ? 'Repository not found or is private. Make sure the URL is correct and the repository is public.'
            : `Failed to clone repository: ${error.message}`
        }
      });
    }
    
    // Detect project type and check for .env.example
    let subtype = 'code';
    let hasEnvExample = false;
    try {
      const files = await fs.readdir(refPath);
      
      // Check for .env.example
      hasEnvExample = files.includes('.env.example');
      
      // Check for common project files
      if (files.includes('package.json') || files.includes('tsconfig.json')) {
        subtype = 'code';
      } else if (files.some(f => f.endsWith('.md') || f.endsWith('.mdx'))) {
        // Check if it's primarily documentation
        const codeFiles = files.filter(f => 
          f.endsWith('.js') || f.endsWith('.ts') || 
          f.endsWith('.jsx') || f.endsWith('.tsx') ||
          f.endsWith('.py') || f.endsWith('.java')
        );
        if (codeFiles.length === 0) {
          subtype = 'text';
        }
      } else if (files.some(f => 
        f.endsWith('.png') || f.endsWith('.jpg') || 
        f.endsWith('.svg') || f.endsWith('.gif')
      )) {
        subtype = 'media-artifact';
      }
    } catch (error) {
      logger.warn('Could not detect project type, defaulting to code');
    }
    
    // Create .intent-ref.json metadata
    const metadata = {
      version: '1.0',
      reference: {
        id: refId,
        name: repoName,
        description: `Imported from GitHub: ${githubUrl}`,
        type: 'artifact',
        subtype,
        projects: projectId ? [projectId] : [],
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      }
    };
    
    const metadataPath = path.join(refPath, '.intent-ref.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    // Create initial commit for the import
    try {
      await manager.execGit(refPath, 'add .intent-ref.json');
      await manager.execGit(refPath, 'commit -m "Add Intent metadata"');
    } catch (error) {
      logger.warn('Could not commit metadata file:', error);
    }
    
    // Add to project if specified
    if (projectId) {
      const projectsPath = path.join(req.app.locals.workspace.workspace, '.intent-projects.json');
      try {
        const projectsData = await fs.readFile(projectsPath, 'utf8');
        const projects = JSON.parse(projectsData);
        
        if (projects.projects && projects.projects[projectId]) {
          if (!projects.projects[projectId].refs) {
            projects.projects[projectId].refs = [];
          }
          if (!projects.projects[projectId].refs.includes(refId)) {
            projects.projects[projectId].refs.push(refId);
            projects.projects[projectId].modified = new Date().toISOString();
            await fs.writeFile(projectsPath, JSON.stringify(projects, null, 2));
          }
        }
      } catch (error) {
        logger.warn(`Could not add ref to project ${projectId}:`, error);
      }
    }
    
    res.json({
      success: true,
      ref: {
        id: refId,
        name: repoName,
        type: 'artifact',
        subtype,
        githubUrl
      },
      hasEnvExample
    });
    
  } catch (error) {
    logger.error('GitHub import error:', error);
    next(error);
  }
});

export default router;