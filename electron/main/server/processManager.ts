import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { 
  Events, 
  ValidTransitions, 
  ErrorCodes, 
  ExecutionStatus,
  LogType,
  Limits,
  ExecutionStatusType
} from './constants.js';
import { createLogger } from './logger.js';
import type { Database } from './db.js';
import type { EventEmitter } from 'node:events';
import type { Config } from './config.js';

const logger = createLogger('ProcessManager');

interface CommandConfig {
  cmd: string;
  args: string[];
}

export class ProcessManager {
  private db: Database;
  private config: Config;
  private eventEmitter: EventEmitter;
  private activeProcesses: Map<string, ChildProcess>;

  constructor(db: Database, config: Config, eventEmitter: EventEmitter) {
    this.db = db;
    this.config = config;
    this.eventEmitter = eventEmitter;
    this.activeProcesses = new Map();
  }

  async spawn(
    executionId: string, 
    agent: string, 
    prompt: string, 
    workingDir: string | null = null, 
    isContinuation: boolean = false
  ): Promise<ChildProcess> {
    try {
      // Validate agent type
      if (!['claude', 'gemini'].includes(agent)) {
        throw new Error(`Invalid agent type: ${agent}`);
      }

      // Validate and resolve working directory
      const resolvedWorkingDir = this.validateWorkingDir(workingDir);

      // Update database with starting status
      await this.updateProcessStatus(executionId, ExecutionStatus.STARTING);
      logger.info(`Spawning ${agent} process`, { executionId, workingDir: resolvedWorkingDir, isContinuation });

      // Build command based on agent type
      const { cmd, args } = this.buildCommand(agent, prompt, resolvedWorkingDir, isContinuation);

      // Spawn the process
      const childProcess = spawn(cmd, args, {
        cwd: resolvedWorkingDir,
        env: process.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Store process reference
      this.activeProcesses.set(executionId, childProcess);

      // Update with PID once process starts
      childProcess.on('spawn', () => {
        logger.info(`Process started`, { executionId, pid: childProcess.pid });
        this.updateProcessStatus(executionId, ExecutionStatus.RUNNING, childProcess.pid);
        this.eventEmitter.emit(Events.PROCESS_START, { executionId, pid: childProcess.pid });
        
        // For Claude in --print mode, stdin should be closed after providing prompt
        if (agent === 'claude' && this.config.agents.claude.defaultArgs.includes('--print')) {
          childProcess.stdin!.end();
        }
      });

      // Handle process exit
      childProcess.on('exit', (code, signal) => {
        this.handleProcessExit(executionId, code, signal);
      });

      // Handle process errors
      childProcess.on('error', (error) => {
        this.handleProcessError(executionId, error);
      });
      
      // Log the actual command being run
      logger.info(`Spawning command`, { 
        executionId, 
        command: cmd, 
        args, 
        cwd: resolvedWorkingDir 
      });

      // Set spawn timeout
      const spawnTimeout = setTimeout(() => {
        if (this.getProcess(executionId) && !childProcess.pid) {
          childProcess.kill();
          this.handleProcessError(executionId, new Error('Process spawn timeout'));
        }
      }, Limits.SPAWN_TIMEOUT);

      childProcess.once('spawn', () => clearTimeout(spawnTimeout));

      return childProcess;
    } catch (error) {
      logger.error(`Failed to spawn process`, { executionId, error });
      await this.updateProcessStatus(executionId, ExecutionStatus.FAILED);
      throw error;
    }
  }

  private buildCommand(agent: string, prompt: string, workingDir: string, isContinuation: boolean = false): CommandConfig {
    const agentConfig = this.config.agents[agent];
    if (!agentConfig) {
      throw new Error(`No configuration found for agent: ${agent}`);
    }

    const command = agentConfig.command;
    const args = [...agentConfig.defaultArgs];
    
    if (agent === 'claude') {
      // Add working directory if specified
      if (workingDir) {
        args.push('--cwd', workingDir);
      }
      
      // If it's a continuation, we need to handle it differently
      if (!isContinuation) {
        // For initial prompts, pass the prompt as the last argument
        args.push(prompt);
      }
      // For continuations, the prompt will be sent via stdin
    } else if (agent === 'gemini') {
      // Add Gemini-specific arguments
      args.push(prompt);
    }
    
    return { cmd: command, args };
  }

  private validateWorkingDir(workingDir: string | null): string {
    if (!workingDir) {
      return this.config.execution.defaultWorkingDir;
    }
    
    // Resolve to absolute path
    const resolved = path.resolve(workingDir);
    
    // Verify directory exists
    if (!fs.existsSync(resolved)) {
      throw new Error(`Working directory does not exist: ${resolved}`);
    }
    
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved}`);
    }
    
    return resolved;
  }

  async sendInput(executionId: string, input: string): Promise<void> {
    const process = this.getProcess(executionId);
    if (!process) {
      throw new Error('Process not found');
    }
    
    if (!process.stdin || process.stdin.destroyed) {
      throw new Error('Process stdin is not available');
    }
    
    return new Promise((resolve, reject) => {
      process.stdin!.write(input + '\n', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async terminate(executionId: string): Promise<void> {
    const process = this.getProcess(executionId);
    if (!process) {
      logger.warn(`No process found for execution ${executionId}`);
      return;
    }
    
    logger.info(`Terminating process for execution ${executionId}`);
    
    // Try graceful shutdown first
    process.kill('SIGTERM');
    
    // Force kill after timeout
    setTimeout(() => {
      if (this.getProcess(executionId)) {
        logger.warn(`Force killing process for execution ${executionId}`);
        process.kill('SIGKILL');
      }
    }, 5000);
  }

  getProcess(executionId: string): ChildProcess | undefined {
    return this.activeProcesses.get(executionId);
  }

  isProcessRunning(executionId: string): boolean {
    const process = this.getProcess(executionId);
    return !!process && !process.killed;
  }

  private async updateProcessStatus(executionId: string, status: ExecutionStatusType, pid?: number): Promise<void> {
    const updateFields: string[] = ['status = ?'];
    const updateValues: any[] = [status];
    
    if (pid !== undefined) {
      updateFields.push('pid = ?');
      updateValues.push(pid);
    }
    
    if (status === ExecutionStatus.COMPLETED || status === ExecutionStatus.FAILED) {
      updateFields.push('completed_at = CURRENT_TIMESTAMP');
    }
    
    updateValues.push(executionId);
    
    await this.db.run(
      `UPDATE executions SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
  }

  private async handleProcessExit(executionId: string, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    logger.info(`Process exited`, { executionId, code, signal });
    
    // Remove from active processes
    this.activeProcesses.delete(executionId);
    
    // Update status based on exit code
    const status = code === 0 ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED;
    await this.updateProcessStatus(executionId, status);
    
    // Emit exit event
    this.eventEmitter.emit(Events.PROCESS_EXIT, { executionId, code, signal });
    
    // Also emit a flush buffer event to ensure all output is saved
    this.eventEmitter.emit(Events.BUFFER_FLUSH, { executionId });
  }

  private async handleProcessError(executionId: string, error: Error): Promise<void> {
    logger.error(`Process error`, { executionId, error });
    
    // Remove from active processes
    this.activeProcesses.delete(executionId);
    
    // Update status
    await this.updateProcessStatus(executionId, ExecutionStatus.FAILED);
    
    // Save error to logs
    await this.db.run(
      'INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)',
      [executionId, LogType.SYSTEM, `Process error: ${error.message}`]
    );
    
    // Emit error event
    this.eventEmitter.emit(Events.PROCESS_ERROR, { executionId, error });
  }

  async getAllActiveProcesses(): Promise<string[]> {
    return Array.from(this.activeProcesses.keys());
  }

  async terminateAll(): Promise<void> {
    const executionIds = await this.getAllActiveProcesses();
    
    for (const executionId of executionIds) {
      try {
        await this.terminate(executionId);
      } catch (error) {
        logger.error(`Failed to terminate process ${executionId}:`, error);
      }
    }
  }
}

export default ProcessManager;