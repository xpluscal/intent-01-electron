import { default as RefManager } from './RefManager.js';
import { default as ExecutionContextManager } from './ExecutionContextManager.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

class ChangeManager {
  constructor(workspaceManager, refManager, contextManager) {
    this.workspaceManager = workspaceManager;
    this.refManager = refManager || new RefManager(workspaceManager.getWorkspacePath());
    this.contextManager = contextManager || new ExecutionContextManager(workspaceManager, this.refManager);
  }

  /**
   * Commit changes in a worktree
   */
  async commitChanges(executionId, refId, message) {
    const manifest = await this.contextManager.getExecutionManifest(executionId);
    if (!manifest || !manifest.worktrees || !manifest.worktrees[refId]) {
      throw new Error(`No worktree found for reference '${refId}' in execution '${executionId}'`);
    }
    
    const worktreePath = manifest.worktrees[refId].worktreePath;
    
    // Check if there are any changes to commit
    const status = await this.refManager.execGit(worktreePath, 'status --porcelain');
    if (!status.trim()) {
      return {
        committed: false,
        message: 'No changes to commit'
      };
    }
    
    // Stage all changes
    await this.refManager.execGit(worktreePath, 'add -A');
    
    // Create commit with execution metadata
    const fullMessage = `${message}\n\nExecution: ${executionId}`;
    const commitCommand = `commit -m ${this.refManager.escapeArg(fullMessage)}`;
    
    try {
      const output = await this.refManager.execGit(worktreePath, commitCommand);
      
      // Get the commit hash
      const commitHash = await this.refManager.execGit(worktreePath, 'rev-parse HEAD');
      
      return {
        committed: true,
        hash: commitHash,
        message: fullMessage,
        output
      };
    } catch (error) {
      // Check if it's just "nothing to commit" after staging
      if (error.message.includes('nothing to commit')) {
        return {
          committed: false,
          message: 'No changes to commit after staging'
        };
      }
      throw error;
    }
  }

  /**
   * Sync execution branch to refs directory (preserves both main and exec branches separately)
   */
  async syncExecutionBranch(refId, executionBranch) {
    const refPath = path.join(this.refManager.refsDir, refId);
    
    try {
      // The execution branch already exists in the ref repository via worktree
      // We should preserve BOTH branches independently - do NOT update main
      
      // Verify the execution branch exists
      const branches = await this.refManager.execGit(refPath, 'branch -a');
      const branchExists = branches.includes(executionBranch);
      
      if (!branchExists) {
        throw new Error(`Execution branch '${executionBranch}' not found in repository`);
      }
      
      // Get the commit hash of the execution branch
      const execBranchHash = await this.refManager.execGit(refPath, `rev-parse ${this.refManager.escapeArg(executionBranch)}`);
      
      // Get the commit hash of main branch for comparison
      const mainBranchHash = await this.refManager.execGit(refPath, 'rev-parse main');
      
      // Ensure we're on main branch for consistency
      await this.refManager.execGit(refPath, 'checkout main');
      
      return {
        synced: true,
        preservedBranches: ['main', executionBranch],
        execBranchHash,
        mainBranchHash,
        mainUpdated: false, // We intentionally do NOT update main for audit trail
        message: `Preserved execution branch '${executionBranch}' alongside unchanged main branch for complete audit trail`
      };
    } catch (error) {
      return {
        synced: false,
        error: error.message,
        message: `Failed to sync execution branch '${executionBranch}': ${error.message}`
      };
    }
  }

  /**
   * Initialize a new reference from created content
   */
  async initializeNewRef(executionId, refId) {
    const manifest = await this.contextManager.getExecutionManifest(executionId);
    if (!manifest) {
      throw new Error(`Execution '${executionId}' not found`);
    }
    
    // Check if this ref was in the create list
    if (!manifest.refs.create || !manifest.refs.create.includes(refId)) {
      throw new Error(`Reference '${refId}' was not marked for creation in execution '${executionId}'`);
    }
    
    // Check if ref already exists
    if (await this.refManager.refExists(refId)) {
      throw new Error(`Reference '${refId}' already exists`);
    }
    
    const sourcePath = path.join(manifest.paths.create, refId);
    
    // Check if any files were created (excluding marker file)
    const allFiles = await this.listDirectoryRecursive(sourcePath);
    const files = allFiles.filter(f => f !== '.new-reference');
    
    if (files.length === 0) {
      throw new Error(`No files found in create directory for reference '${refId}'`);
    }
    
    // Initialize the repository
    const refPath = await this.refManager.initializeRepo(refId);
    
    // Copy all files
    for (const file of files) {
      
      const sourceFile = path.join(sourcePath, file);
      const destFile = path.join(refPath, file);
      
      // Create directory if needed
      const destDir = path.dirname(destFile);
      await fs.mkdir(destDir, { recursive: true });
      
      // Copy file
      await fs.copyFile(sourceFile, destFile);
    }
    
    // Create initial commit
    await this.refManager.execGit(refPath, 'add -A');
    const commitMessage = `Initial commit\n\nCreated from execution: ${executionId}`;
    await this.refManager.execGit(refPath, `commit -m ${this.refManager.escapeArg(commitMessage)}`);
    
    const commitHash = await this.refManager.execGit(refPath, 'rev-parse HEAD');
    
    return {
      refId,
      refPath,
      files,
      commitHash
    };
  }

  /**
   * Process all changes from an execution
   */
  async processExecutionChanges(executionId, options = {}) {
    const manifest = await this.contextManager.getExecutionManifest(executionId);
    if (!manifest) {
      throw new Error(`Execution '${executionId}' not found`);
    }
    
    const results = {
      commits: {},
      merges: {},
      creates: {},
      errors: {}
    };
    
    // Commit changes in mutable refs
    if (manifest.worktrees) {
      for (const [refId, worktreeInfo] of Object.entries(manifest.worktrees)) {
        try {
          const commitResult = await this.commitChanges(
            executionId, 
            refId, 
            options.commitMessage || `Changes from execution ${executionId}`
          );
          results.commits[refId] = commitResult;
          
          // Sync execution branch if commit was successful and sync is requested
          if (commitResult.committed && options.merge !== false) {
            const syncResult = await this.syncExecutionBranch(
              refId, 
              worktreeInfo.branch
            );
            results.merges[refId] = syncResult;
          }
        } catch (error) {
          results.errors[refId] = {
            phase: results.commits[refId] ? 'merge' : 'commit',
            error: error.message
          };
        }
      }
    }
    
    // Initialize new refs
    if (manifest.refs.create && manifest.refs.create.length > 0) {
      for (const refId of manifest.refs.create) {
        try {
          const createResult = await this.initializeNewRef(executionId, refId);
          results.creates[refId] = createResult;
        } catch (error) {
          results.errors[refId] = {
            phase: 'create',
            error: error.message
          };
        }
      }
    }
    
    return results;
  }

  /**
   * List all files in a directory recursively
   */
  async listDirectoryRecursive(dir, basePath = '') {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(basePath, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.listDirectoryRecursive(fullPath, relativePath);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    return files;
  }
}

export default ChangeManager;