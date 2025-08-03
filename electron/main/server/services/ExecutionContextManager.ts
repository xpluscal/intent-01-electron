import { promises as fs } from 'node:fs';
import path from 'node:path';
import { default as RefManager } from './RefManager.js';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'node:child_process';

class ExecutionContextManager {
  constructor(workspaceManager, refManager, previewManager) {
    this.workspaceManager = workspaceManager;
    const workspacePath = workspaceManager.getWorkspacePath();
    console.log(`[ExecutionContextManager] Workspace path: ${workspacePath}`);
    this.refManager = refManager || new RefManager(workspacePath);
    this.executionsDir = workspaceManager.getExecutionsDir();
    console.log(`[ExecutionContextManager] Executions directory: ${this.executionsDir}`);
    this.previewManager = previewManager; // For auto-starting previews
  }

  /**
   * Set up complete execution workspace with references
   */
  async setupExecutionWorkspace(executionId, refs = {}) {
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    
    // Create execution directory structure
    const dirs = {
      root: executionPath,
      read: path.join(executionPath, 'read'),
      mutate: path.join(executionPath, 'mutate'),
      create: path.join(executionPath, 'create')
    };
    
    // Create all directories
    for (const dir of Object.values(dirs)) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    // Ensure refs object has all arrays
    const normalizedRefs = {
      read: refs.read || [],
      mutate: refs.mutate || [],
      create: refs.create || []
    };
    
    // Create manifest
    const manifest = {
      executionId,
      timestamp: new Date().toISOString(),
      refs: normalizedRefs,
      paths: dirs
    };
    
    await fs.writeFile(
      path.join(executionPath, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    // Set up each type of reference
    try {
      const skippedRefs = {
        read: [],
        mutate: []
      };
      
      if (refs.read && refs.read.length > 0) {
        skippedRefs.read = await this.setupReadOnlyRefs(executionId, refs.read);
      }
      
      if (refs.mutate && refs.mutate.length > 0) {
        const result = await this.setupMutableRefs(executionId, refs.mutate);
        manifest.worktrees = result.worktrees;
        skippedRefs.mutate = result.skippedRefs;
      }
      
      if (refs.create && refs.create.length > 0) {
        await this.setupCreateDirs(executionId, refs.create);
      }
      
      // Add skipped refs to manifest
      manifest.skippedRefs = skippedRefs;
      
      // Update manifest with worktree and skipped refs info
      await fs.writeFile(
        path.join(executionPath, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
      
      return {
        executionPath,
        manifest,
        paths: dirs,
        skippedRefs
      };
    } catch (error) {
      // Clean up on failure
      await this.cleanupExecutionWorkspace(executionId);
      throw error;
    }
  }

  /**
   * Set up read-only references using symlinks
   */
  async setupReadOnlyRefs(executionId, refIds) {
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    const readDir = path.join(executionPath, 'read');
    const skippedRefs = [];
    
    for (const refId of refIds) {
      // Verify reference exists
      if (!await this.refManager.refExists(refId)) {
        console.error(`[ExecutionContextManager] Read reference '${refId}' does not exist!`);
        throw new Error(`Read reference '${refId}' does not exist. Please ensure all references are properly initialized.`);
      }
      
      const sourcePath = path.join(this.refManager.refsDir, refId);
      const linkPath = path.join(readDir, refId);
      
      // Create symlink
      console.log(`[ExecutionContextManager] Creating read-only symlink from ${sourcePath} to ${linkPath}`);
      await fs.symlink(sourcePath, linkPath, 'dir');
    }
    
    return skippedRefs;
  }

  /**
   * Set up mutable references using git worktrees
   */
  async setupMutableRefs(executionId, refIds) {
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    const mutateDir = path.join(executionPath, 'mutate');
    const worktrees = {};
    const skippedRefs = [];
    
    for (const refId of refIds) {
      // Verify reference exists
      if (!await this.refManager.refExists(refId)) {
        console.error(`[ExecutionContextManager] Mutate reference '${refId}' does not exist!`);
        throw new Error(`Mutate reference '${refId}' does not exist. Please ensure all references are properly initialized.`);
      }
      
      const worktreePath = path.join(mutateDir, refId);
      
      try {
        console.log(`[ExecutionContextManager] Creating worktree for ref ${refId} at ${worktreePath}`);
        const result = await this.refManager.createWorktree(refId, executionId, worktreePath);
        console.log(`[ExecutionContextManager] Worktree created successfully:`, result);
        worktrees[refId] = result;
      } catch (error) {
        // Clean up any worktrees we already created
        for (const [createdRefId, worktreeInfo] of Object.entries(worktrees)) {
          try {
            await this.refManager.removeWorktree(createdRefId, worktreeInfo.worktreePath);
            // Also try to delete the branch
            await this.refManager.deleteBranch(createdRefId, worktreeInfo.branch, true);
          } catch (cleanupError) {
            console.error(`Failed to clean up worktree for ${createdRefId}:`, cleanupError);
          }
        }
        throw error;
      }
    }
    
    return { worktrees, skippedRefs };
  }

  /**
   * Set up directories for new references to be created
   */
  async setupCreateDirs(executionId, refIds) {
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    const createDir = path.join(executionPath, 'create');
    
    for (const refId of refIds) {
      // Check that reference doesn't already exist
      if (await this.refManager.refExists(refId)) {
        throw new Error(`Reference '${refId}' already exists`);
      }
      
      // Create empty directory
      const refDir = path.join(createDir, refId);
      await fs.mkdir(refDir, { recursive: true });
      
      // Run create-next-app with all options pre-configured
      console.log(`[ExecutionContextManager] Running create-next-app for ${refId}...`);
      
      const createNextProcess = spawn('npx', [
        'create-next-app@latest',
        '.',
        '--ts',
        '--tailwind',
        '--eslint',
        '--app',
        '--use-npm',
        '--import-alias', '@/*',
        '--src-dir',
        '--turbopack',
        '--example', 'https://github.com/resonancelabsai/intent-01-app-starter'
      ], {
        cwd: refDir,
        stdio: 'pipe',
        shell: true
      });
      
      // Wait for create-next-app to complete
      await new Promise((resolve, reject) => {
        let output = '';
        
        createNextProcess.stdout.on('data', (data) => {
          output += data.toString();
          console.log(`[create-next-app] ${data.toString().trim()}`);
        });
        
        createNextProcess.stderr.on('data', (data) => {
          output += data.toString();
          console.log(`[create-next-app stderr] ${data.toString().trim()}`);
        });
        
        createNextProcess.on('close', (code) => {
          if (code === 0) {
            console.log(`[ExecutionContextManager] create-next-app completed successfully for ${refId}`);
            resolve();
          } else {
            reject(new Error(`create-next-app failed with code ${code}: ${output}`));
          }
        });
        
        createNextProcess.on('error', (error) => {
          reject(new Error(`Failed to run create-next-app: ${error.message}`));
        });
      });
      
      // Create a marker file to indicate this is a new reference
      await fs.writeFile(
        path.join(refDir, '.new-reference'),
        JSON.stringify({
          refId,
          createdAt: new Date().toISOString(),
          executionId,
          type: 'nextjs-app'
        })
      );
      
      // Store the refId for later auto-preview start (after workspace_path is updated)
      if (!this.pendingPreviews) {
        this.pendingPreviews = [];
      }
      this.pendingPreviews.push({
        executionId,
        refType: 'create',
        refId: refId
      });
    }
  }

  /**
   * Start pending previews after workspace_path is updated in database
   */
  async startPendingPreviews() {
    if (!this.pendingPreviews || this.pendingPreviews.length === 0) {
      return;
    }

    for (const preview of this.pendingPreviews) {
      if (this.previewManager) {
        console.log(`[ExecutionContextManager] Auto-starting preview for ${preview.refId}...`);
        try {
          const previewResult = await this.previewManager.startPreview(preview.executionId, {
            refType: preview.refType,
            refId: preview.refId,
            installDependencies: false // Already installed by create-next-app
          });
          console.log(`[ExecutionContextManager] Preview started successfully:`, previewResult);
        } catch (error) {
          console.error(`[ExecutionContextManager] Failed to auto-start preview for ${preview.refId}:`, error);
          // Don't throw - preview failure shouldn't stop execution
        }
      }
    }

    // Clear pending previews
    this.pendingPreviews = [];
  }

  /**
   * Get execution manifest
   */
  async getExecutionManifest(executionId) {
    const manifestPath = path.join(this.executionsDir, `exec-${executionId}`, 'manifest.json');
    
    try {
      const content = await fs.readFile(manifestPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Clean up execution workspace
   */
  async cleanupExecutionWorkspace(executionId) {
    const manifest = await this.getExecutionManifest(executionId);
    
    // Remove worktrees if any
    if (manifest && manifest.worktrees) {
      for (const [refId, worktreeInfo] of Object.entries(manifest.worktrees)) {
        try {
          await this.refManager.removeWorktree(refId, worktreeInfo.worktreePath);
          // NOTE: We intentionally keep the execution branch for audit trail
          // The exec-{executionId} branch should remain in the refs folder
          console.log(`Preserved execution branch ${worktreeInfo.branch} for audit trail`);
        } catch (error) {
          console.error(`Failed to remove worktree for ${refId}:`, error);
        }
      }
    }
    
    // Remove execution directory
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    try {
      await fs.rm(executionPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * List all active executions
   */
  async listExecutions() {
    try {
      const entries = await fs.readdir(this.executionsDir, { withFileTypes: true });
      const executions = [];
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('exec-')) {
          const executionId = entry.name.substring(5); // Remove 'exec-' prefix
          const manifest = await this.getExecutionManifest(executionId);
          if (manifest) {
            executions.push({
              executionId,
              timestamp: manifest.timestamp,
              refs: manifest.refs
            });
          }
        }
      }
      
      return executions.sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get changes in mutable references
   */
  async getExecutionChanges(executionId) {
    const manifest = await this.getExecutionManifest(executionId);
    if (!manifest || !manifest.worktrees) {
      return {};
    }
    
    const changes = {};
    
    for (const [refId, worktreeInfo] of Object.entries(manifest.worktrees)) {
      try {
        // Get git status in worktree
        const status = await this.refManager.execGit(
          worktreeInfo.worktreePath,
          'status --porcelain'
        );
        
        const files = {
          added: [],
          modified: [],
          deleted: []
        };
        
        if (status) {
          for (const line of status.split('\n').filter(Boolean)) {
            const statusCode = line.substring(0, 2);
            const filePath = line.substring(2).trim();
            
            // First character is index status, second is working tree status
            const indexStatus = statusCode[0];
            const workingStatus = statusCode[1];
            
            if (statusCode === '??') {
              // Untracked file
              files.added.push(filePath);
            } else if (indexStatus === 'A' || workingStatus === 'A') {
              // Added to index or working tree
              files.added.push(filePath);
            } else if (indexStatus === 'M' || workingStatus === 'M') {
              // Modified in index or working tree
              files.modified.push(filePath);
            } else if (indexStatus === 'D' || workingStatus === 'D') {
              // Deleted from index or working tree
              files.deleted.push(filePath);
            } else if (indexStatus === 'R') {
              // Renamed - git shows "R  old -> new"
              const renameParts = filePath.split(' -> ');
              if (renameParts.length === 2) {
                files.deleted.push(renameParts[0]);
                files.added.push(renameParts[1]);
              }
            }
          }
        }
        
        changes[refId] = {
          branch: worktreeInfo.branch,
          files,
          hasChanges: files.added.length > 0 || files.modified.length > 0 || files.deleted.length > 0
        };
      } catch (error) {
        console.error(`Failed to get changes for ${refId}:`, error);
        changes[refId] = {
          error: error.message
        };
      }
    }
    
    return changes;
  }
}

export default ExecutionContextManager;