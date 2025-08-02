import { exec } from 'node:child_process';
import { promisify } from 'util';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const execAsync = promisify(exec);

class RefManager {
  constructor(workspacePath, performanceMonitor = null) {
    this.workspacePath = workspacePath;
    this.refsDir = path.join(workspacePath, 'refs');
    this.performanceMonitor = performanceMonitor;
  }

  /**
   * Execute a git command safely with proper escaping and performance monitoring
   */
  async execGit(cwd, command, options = {}) {
    const { executionId = null, refId = null, operation = 'unknown' } = options;
    
    // Extract actual Git operation from command
    const gitOperation = this.extractGitOperation(command);
    
    if (this.performanceMonitor) {
      return await this.performanceMonitor.instrumentGitOperation({
        executionId,
        refId,
        operation: gitOperation,
        branch: options.branch || null,
        command: `git ${command}`,
        workingDir: cwd
      }, async () => {
        return await this._execGitInternal(cwd, command, options);
      });
    } else {
      return await this._execGitInternal(cwd, command, options);
    }
  }

  /**
   * Internal Git execution without monitoring
   */
  async _execGitInternal(cwd, command, options = {}) {
    try {
      const { stdout, stderr } = await execAsync(`git ${command}`, {
        cwd,
        encoding: options.encoding || 'utf8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        ...options
      });
      
      // Handle buffer output when encoding is 'buffer'
      if (options.encoding === 'buffer') {
        return stdout;
      }
      
      return stdout.trim();
    } catch (error) {
      // Include stderr in error message for better debugging
      if (error.stderr) {
        error.message = `${error.message}\n${error.stderr}`;
      }
      throw error;
    }
  }

  /**
   * Extract Git operation name from command
   */
  extractGitOperation(command) {
    const parts = command.trim().split(' ');
    if (parts.length === 0) return 'unknown';
    
    const operation = parts[0];
    
    // Map some common compound operations
    if (operation === 'worktree' && parts[1]) {
      return `worktree_${parts[1]}`;
    }
    if (operation === 'ls-tree') {
      return 'ls_tree';
    }
    
    return operation;
  }

  /**
   * List files in a reference without checkout using git ls-tree
   */
  async listFiles(refId, branch = 'main', dirPath = '') {
    const refPath = path.join(this.refsDir, refId);
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    try {
      let output;
      if (dirPath) {
        // When listing a subdirectory, we need to get the full paths
        output = await this.execGit(refPath, 
          `ls-tree -r --name-only --full-tree ${this.escapeArg(branch)} ${this.escapeArg(dirPath)}`
        );
      } else {
        // List all files from root
        output = await this.execGit(refPath, 
          `ls-tree -r --name-only ${this.escapeArg(branch)}`
        );
      }
      
      return output.split('\n').filter(Boolean);
    } catch (error) {
      if (error.message.includes('Not a valid object name')) {
        throw new Error(`Branch '${branch}' not found in reference '${refId}'`);
      }
      throw error;
    }
  }

  /**
   * Read file content from any branch using git show
   */
  async readFile(refId, branch, filePath) {
    const refPath = path.join(this.refsDir, refId);
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    try {
      // Get raw buffer for binary detection
      const content = await this.execGit(refPath,
        `show ${this.escapeArg(branch)}:${this.escapeArg(filePath)}`,
        { encoding: 'buffer' }
      );
      
      // Check if binary by looking for null bytes
      const isBinary = content.includes(0x00);
      
      return {
        content,
        found: true,
        isBinary,
        encoding: isBinary ? 'base64' : 'utf8'
      };
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return { found: false };
      }
      if (error.message.includes('Not a valid object name')) {
        throw new Error(`Branch '${branch}' not found in reference '${refId}'`);
      }
      throw error;
    }
  }

  /**
   * Get directory listing with file metadata
   */
  async listDirectory(refId, branch = 'main', dirPath = '') {
    const refPath = path.join(this.refsDir, refId);
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    try {
      const treeRef = dirPath ? `${branch}:${dirPath}` : branch;
      const output = await this.execGit(refPath,
        `ls-tree -l ${this.escapeArg(treeRef)}`
      );
      
      const entries = [];
      for (const line of output.split('\n').filter(Boolean)) {
        // Parse: "mode type hash size name"
        const match = line.match(/^(\d+)\s+(blob|tree)\s+([a-f0-9]+)\s+(-|\d+)\s+(.+)$/);
        if (match) {
          entries.push({
            name: match[5],
            type: match[2] === 'tree' ? 'directory' : 'file',
            size: match[4] === '-' ? null : parseInt(match[4]),
            mode: match[1],
            hash: match[3]
          });
        }
      }
      
      return entries;
    } catch (error) {
      if (error.message.includes('Not a valid object name')) {
        throw new Error(`Branch '${branch}' or path '${dirPath}' not found in reference '${refId}'`);
      }
      throw error;
    }
  }

  /**
   * Get file metadata without reading content
   */
  async getFileInfo(refId, branch, filePath) {
    const refPath = path.join(this.refsDir, refId);
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    try {
      const info = await this.execGit(refPath,
        `ls-tree -l ${this.escapeArg(branch)} -- ${this.escapeArg(filePath)}`
      );
      
      if (!info.trim()) {
        return null;
      }
      
      const parts = info.trim().split(/\s+/);
      if (parts.length < 5) {
        return null;
      }
      
      const [mode, type, hash, size, ...nameParts] = parts;
      const name = nameParts.join(' ');
      
      // Get last modified date from git log
      const lastModified = await this.execGit(refPath,
        `log -1 --format=%aI ${this.escapeArg(branch)} -- ${this.escapeArg(filePath)}`
      );
      
      return {
        name,
        mode,
        type,
        size: parseInt(size),
        hash,
        lastModified: lastModified.trim()
      };
    } catch (error) {
      if (error.message.includes('Not a valid object name')) {
        throw new Error(`Branch '${branch}' not found in reference '${refId}'`);
      }
      throw error;
    }
  }

  /**
   * Create a git worktree for execution
   */
  async createWorktree(refId, executionId, targetPath) {
    const refPath = path.join(this.refsDir, refId);
    const branchName = `exec-${executionId}`;
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    try {
      // Create new branch and worktree in one command
      await this.execGit(refPath,
        `worktree add -b ${this.escapeArg(branchName)} ${this.escapeArg(targetPath)}`
      );
      
      return {
        worktreePath: targetPath,
        branch: branchName
      };
    } catch (error) {
      if (error.message.includes('already exists')) {
        throw new Error(`Worktree or branch for execution '${executionId}' already exists`);
      }
      throw error;
    }
  }

  /**
   * Remove a git worktree
   */
  async removeWorktree(refId, worktreePath) {
    const refPath = path.join(this.refsDir, refId);
    
    try {
      // Force remove to handle any uncommitted changes
      await this.execGit(refPath,
        `worktree remove --force ${this.escapeArg(worktreePath)}`
      );
    } catch (error) {
      // If worktree doesn't exist, that's fine
      if (!error.message.includes('not a working tree')) {
        throw error;
      }
    }
  }

  /**
   * List all worktrees for a reference
   */
  async listWorktrees(refId) {
    const refPath = path.join(this.refsDir, refId);
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    const output = await this.execGit(refPath, 'worktree list --porcelain');
    
    const worktrees = [];
    let current = {};
    
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current);
        }
        current = { path: line.substring(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.substring(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7);
      } else if (line === 'detached') {
        current.detached = true;
      } else if (line === '') {
        // Empty line indicates end of current worktree info
        if (current.path) {
          worktrees.push(current);
          current = {};
        }
      }
    }
    
    // Don't forget the last one if there's no trailing empty line
    if (current.path) {
      worktrees.push(current);
    }
    
    return worktrees;
  }

  /**
   * List branches for a reference
   */
  async listBranches(refId) {
    const refPath = path.join(this.refsDir, refId);
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    const output = await this.execGit(refPath, 'branch -a --format="%(refname:short)|%(objectname)|%(committerdate:iso)|%(subject)"');
    
    const branches = [];
    for (const line of output.split('\n').filter(Boolean)) {
      const [name, hash, date, ...subjectParts] = line.split('|');
      branches.push({
        name: name.replace('origin/', ''),
        hash,
        date,
        subject: subjectParts.join('|')
      });
    }
    
    // Get current branch
    const currentBranch = await this.execGit(refPath, 'rev-parse --abbrev-ref HEAD');
    
    return {
      current: currentBranch,
      branches
    };
  }

  /**
   * Create a new branch
   */
  async createBranch(refId, branchName, fromBranch = 'main') {
    const refPath = path.join(this.refsDir, refId);
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    await this.execGit(refPath,
      `checkout -b ${this.escapeArg(branchName)} ${this.escapeArg(fromBranch)}`
    );
  }

  /**
   * Delete a branch
   */
  async deleteBranch(refId, branchName, force = false) {
    const refPath = path.join(this.refsDir, refId);
    
    // Verify reference exists
    await this.verifyRefExists(refId);
    
    const flag = force ? '-D' : '-d';
    await this.execGit(refPath, `branch ${flag} ${this.escapeArg(branchName)}`);
  }

  /**
   * Initialize a new git repository
   */
  async initializeRepo(refId) {
    const refPath = path.join(this.refsDir, refId);
    
    // Create directory
    await fs.mkdir(refPath, { recursive: true });
    
    // Initialize git
    await this.execGit(refPath, 'init');
    
    // Set initial branch name to 'main'
    await this.execGit(refPath, 'config init.defaultBranch main');
    
    return refPath;
  }

  /**
   * Check if a reference exists
   */
  async refExists(refId) {
    const refPath = path.join(this.refsDir, refId);
    
    try {
      const stat = await fs.stat(refPath);
      if (!stat.isDirectory()) {
        return false;
      }
      
      // Check if it's a git repository
      await this.execGit(refPath, 'rev-parse --git-dir');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify that a reference exists, throw if not
   */
  async verifyRefExists(refId) {
    if (!await this.refExists(refId)) {
      throw new Error(`Reference '${refId}' does not exist`);
    }
  }

  /**
   * Get all references
   */
  async listRefs() {
    try {
      const entries = await fs.readdir(this.refsDir, { withFileTypes: true });
      const refs = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const refId = entry.name;
          if (await this.refExists(refId)) {
            refs.push(refId);
          }
        }
      }
      
      return refs;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Escape shell arguments to prevent injection
   */
  escapeArg(arg) {
    if (!arg) return "''";
    // Replace single quotes with '\'' and wrap in single quotes
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}

export default RefManager;