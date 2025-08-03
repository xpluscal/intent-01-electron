import { promises as fs } from 'node:fs';
import path from 'node:path';

interface WorkspaceConfig {
  workspace: string;
  refsDir: string;
  executionsDir: string;
  dataDir: string;
}

export class WorkspaceManager {
  private workspacePath: string;

  constructor(workspacePath?: string) {
    // Use provided path, env variable, or default
    this.workspacePath = workspacePath || 
                        process.env.WORKSPACE_DIR || 
                        path.join(process.cwd(), 'workspace');
    
    // Ensure absolute path
    this.workspacePath = path.resolve(this.workspacePath);
  }

  async initialize(): Promise<WorkspaceConfig> {
    console.log(`Initializing workspace at: ${this.workspacePath}`);
    
    // First ensure base workspace exists and is writable
    if (!await this.exists(this.workspacePath)) {
      await fs.mkdir(this.workspacePath, { recursive: true });
      console.log(`Created workspace directory: ${this.workspacePath}`);
    }
    
    // Verify write permissions before creating subdirectories
    await this.verifyPermissions();
    
    // Create workspace structure
    const subdirs = [
      path.join(this.workspacePath, 'refs'),
      path.join(this.workspacePath, '.execution'),
      path.join(this.workspacePath, 'data')
    ];
    
    for (const dir of subdirs) {
      if (!await this.exists(dir)) {
        await fs.mkdir(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    }
    
    // Clean up any orphaned execution directories
    await this.cleanupOrphanedExecutions();
    
    // Initialize default references if refs directory is empty
    await this.initializeDefaultRefs();
    
    return {
      workspace: this.workspacePath,
      refsDir: path.join(this.workspacePath, 'refs'),
      executionsDir: path.join(this.workspacePath, '.execution'),
      dataDir: path.join(this.workspacePath, 'data')
    };
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async verifyPermissions(): Promise<void> {
    try {
      // Try to create a test file to verify write permissions
      const testFile = path.join(this.workspacePath, '.permission-test');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(`No write permission for workspace directory: ${this.workspacePath}`);
      }
      throw error;
    }
  }

  private async cleanupOrphanedExecutions(): Promise<void> {
    const executionsDir = path.join(this.workspacePath, '.execution');
    
    try {
      const dirs = await fs.readdir(executionsDir);
      
      for (const dir of dirs) {
        if (dir.startsWith('exec-')) {
          const execPath = path.join(executionsDir, dir);
          const stats = await fs.stat(execPath);
          
          // Clean up executions older than 7 days
          const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
          if (ageInDays > 7) {
            await fs.rm(execPath, { recursive: true, force: true });
            console.log(`Cleaned up old execution directory: ${dir}`);
          }
        }
      }
    } catch (error: any) {
      // Directory might not exist yet
      if (error.code !== 'ENOENT') {
        console.error('Error cleaning up executions:', error);
      }
    }
  }

  async createExecutionWorkspace(executionId: string): Promise<string> {
    const execPath = path.join(this.workspacePath, '.execution', `exec-${executionId}`);
    await fs.mkdir(execPath, { recursive: true });
    return execPath;
  }

  async createRefWorkspace(refId: string): Promise<string> {
    const refPath = path.join(this.workspacePath, 'refs', refId);
    await fs.mkdir(refPath, { recursive: true });
    return refPath;
  }

  async cleanupExecution(executionId: string): Promise<void> {
    const execPath = path.join(this.workspacePath, '.execution', `exec-${executionId}`);
    
    try {
      await fs.rm(execPath, { recursive: true, force: true });
      console.log(`Cleaned up execution workspace: ${executionId}`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to cleanup execution ${executionId}:`, error);
      }
    }
  }

  async cleanupOldExecutions(hoursOld: number = 24): Promise<number> {
    const executionsDir = path.join(this.workspacePath, '.execution');
    const cutoffTime = Date.now() - (hoursOld * 60 * 60 * 1000);
    let cleanedCount = 0;
    
    try {
      const dirs = await fs.readdir(executionsDir);
      
      for (const dir of dirs) {
        if (dir.startsWith('exec-')) {
          const execPath = path.join(executionsDir, dir);
          const stats = await fs.stat(execPath);
          
          if (stats.mtime.getTime() < cutoffTime) {
            await fs.rm(execPath, { recursive: true, force: true });
            cleanedCount++;
            console.log(`Cleaned up old execution: ${dir}`);
          }
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error cleaning up old executions:', error);
      }
    }
    
    return cleanedCount;
  }

  async getWorkspaceStats(): Promise<{
    totalSize: number;
    executionCount: number;
    refCount: number;
  }> {
    const stats = {
      totalSize: 0,
      executionCount: 0,
      refCount: 0
    };
    
    // Count executions
    try {
      const execDirs = await fs.readdir(path.join(this.workspacePath, '.execution'));
      stats.executionCount = execDirs.filter(d => d.startsWith('exec-')).length;
    } catch (error) {
      // Directory might not exist
    }
    
    // Count refs
    try {
      const refDirs = await fs.readdir(path.join(this.workspacePath, 'refs'));
      stats.refCount = refDirs.length;
    } catch (error) {
      // Directory might not exist
    }
    
    // Calculate total size (simplified - just counting files)
    stats.totalSize = await this.getDirectorySize(this.workspacePath);
    
    return stats;
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Ignore errors for inaccessible files
    }
    
    return totalSize;
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  getRefPath(refId: string): string {
    return path.join(this.workspacePath, 'refs', refId);
  }

  getExecutionPath(executionId: string): string {
    return path.join(this.workspacePath, '.execution', `exec-${executionId}`);
  }

  getExecutionsDir(): string {
    return path.join(this.workspacePath, '.execution');
  }

  private async initializeDefaultRefs(): Promise<void> {
    const refsDir = path.join(this.workspacePath, 'refs');
    
    try {
      // Check if refs directory is empty
      const existingRefs = await fs.readdir(refsDir);
      if (existingRefs.length > 0) {
        // Already has references, skip initialization
        return;
      }

      // Find the default refs directory
      const defaultRefsPath = path.join(__dirname, '..', 'defaultRefs');
      
      // Check if default refs exist
      if (!await this.exists(defaultRefsPath)) {
        console.log('Default refs directory not found, skipping initialization');
        return;
      }

      console.log('Initializing workspace with default references...');

      // Copy all default references
      await this.copyDirectory(defaultRefsPath, refsDir);
      
      console.log('Default references initialized successfully');
    } catch (error) {
      console.error('Error initializing default refs:', error);
      // Don't throw - this is optional initialization
    }
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    // Create destination directory if it doesn't exist
    await fs.mkdir(dest, { recursive: true });

    // Read all entries in source directory
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        // Recursively copy subdirectories
        await this.copyDirectory(srcPath, destPath);
      } else {
        // Copy file
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

export default WorkspaceManager;