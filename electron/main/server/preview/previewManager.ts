import { spawn } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { createLogger } from '../logger.js';
import { default as PortAllocator } from './portAllocator.js';
import { default as ProjectAnalyzer } from './projectAnalyzer.js';
import { default as HealthChecker } from './healthChecker.js';

const logger = createLogger('previewManager');

class PreviewManager {
  constructor(db, processManager, eventEmitter) {
    this.db = db;
    this.processManager = processManager;
    this.eventEmitter = eventEmitter;
    this.portAllocator = new PortAllocator(db);
    this.projectAnalyzer = new ProjectAnalyzer();
    this.healthChecker = new HealthChecker();
    this.previewProcesses = new Map();
    this.sseConnections = new Map();
    
    // Clean up stale port allocations on startup
    this.cleanupStalePortAllocations();
    
    // Auto-restart configuration
    this.healthCheckInterval = 120000; // 2 minutes - less aggressive
    this.maxRestartAttempts = 1; // Only one restart attempt before asking Claude
    this.restartDelay = 5000; // 5 seconds
    
    // Error detection patterns for preview logs
    this.errorPatterns = [
      // Build/compilation errors
      /error TS\d+:/i,  // TypeScript errors
      /Module not found:/i,
      /Cannot find module/i,
      /SyntaxError:/i,
      /ReferenceError:/i,
      /TypeError:/i,
      /Failed to compile/i,
      /Build error occurred/i,
      /ENOENT.*no such file or directory/i,
      
      // Dependency errors
      /npm ERR!/i,
      /yarn error/i,
      /pnpm ERR!/i,
      /Cannot resolve dependency/i,
      /peer dep missing/i,
      
      // Runtime critical errors
      /FATAL ERROR:/i,
      /Uncaught Exception/i,
      /Out of memory/i,
      /EMFILE.*too many open files/i,
      
      // Next.js specific errors
      /Error: Failed to load/i,
      /Error occurred prerendering page/i,
      /Export encountered errors/i
    ];
    
    // Track recent errors to avoid spam
    this.recentErrors = new Map(); // previewId -> { count, lastSent }
    
    // Execution-level error tracking to prevent multiple Claude sessions
    this.executionErrors = new Map(); // executionId -> { errorBuffer, timeoutId, lastSent, isHandling }
    this.errorBufferDelay = 2000; // 2 seconds to collect full error context
    
    // Start health monitoring
    this.startHealthMonitoring();
  }

  async cleanupStalePortAllocations() {
    try {
      const cleaned = await this.portAllocator.cleanupStaleAllocations();
      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} stale port allocations on startup`);
      }
    } catch (error) {
      logger.error('Failed to cleanup stale port allocations:', error);
    }
  }

  async stopAllPreviews() {
    logger.info('Stopping all preview processes...');
    
    try {
      // Get all running previews
      const runningPreviews = await this.db.all(
        'SELECT * FROM preview_processes WHERE status IN (?, ?, ?)',
        ['installing', 'starting', 'running']
      );
      
      logger.info(`Found ${runningPreviews.length} running previews to stop`);
      
      // Stop each preview
      for (const preview of runningPreviews) {
        try {
          await this.stopPreview(preview.execution_id, preview.id);
          logger.info(`Stopped preview ${preview.id}`);
        } catch (error) {
          logger.error(`Failed to stop preview ${preview.id}:`, error);
        }
      }
      
      // Clean up any remaining port allocations
      await this.portAllocator.cleanupStaleAllocations();
      
      logger.info('All previews stopped');
    } catch (error) {
      logger.error('Error stopping all previews:', error);
    }
  }

  async analyzeProject(executionId, options = {}) {
    try {
      const execution = await this.db.get(
        'SELECT * FROM executions WHERE id = ?',
        [executionId]
      );

      if (!execution) {
        throw new Error('Execution not found');
      }

      // Determine the working directory based on reference info
      let workingDir = execution.working_dir;
      if (options.refType && options.refId) {
        // Use reference-specific directory within the execution workspace
        const baseWorkspace = execution.workspace_path || execution.working_dir;
        workingDir = path.join(baseWorkspace, options.refType, options.refId);
        logger.info(`Using reference-specific directory: ${workingDir}`);
      }
      const projectInfo = await this.projectAnalyzer.detectProjectType(workingDir);
      const scripts = await this.projectAnalyzer.getAvailableScripts(workingDir, projectInfo.projectType);
      const suggestedCommand = this.projectAnalyzer.getSuggestedCommand(scripts);
      const dependencies = {
        installed: await this.projectAnalyzer.checkDependenciesInstalled(workingDir, projectInfo.projectType),
        manager: this.projectAnalyzer.detectPackageManager(projectInfo.configFiles)
      };

      let detectedPort = null;
      if (suggestedCommand) {
        detectedPort = await this.projectAnalyzer.detectPort(workingDir, suggestedCommand, projectInfo.framework);
      }

      const port = {
        detected: detectedPort,
        available: detectedPort ? await this.portAllocator.isPortAvailable(detectedPort) : null
      };

      return {
        executionId,
        refType: options.refType,
        refId: options.refId,
        workingDir,
        projectType: projectInfo.projectType,
        framework: projectInfo.framework,
        configFiles: projectInfo.configFiles,
        availableScripts: scripts,
        suggestedCommand,
        dependencies,
        port
      };
    } catch (error) {
      logger.error(`Error analyzing project for execution ${executionId}:`, error);
      throw error;
    }
  }

  async startPreview(executionId, options = {}) {
    try {
      const execution = await this.db.get(
        'SELECT * FROM executions WHERE id = ?',
        [executionId]
      );

      if (!execution) {
        throw new Error('Execution not found');
      }

      // Check if there's already a preview for this reference
      if (options.refType && options.refId) {
        const existingPreview = await this.db.get(
          'SELECT * FROM preview_processes WHERE execution_id = ? AND ref_type = ? AND ref_id = ? ORDER BY started_at DESC LIMIT 1',
          [executionId, options.refType, options.refId]
        );
        
        if (existingPreview) {
          logger.info(`Found existing preview for ${options.refType}/${options.refId}:`, {
            id: existingPreview.id,
            status: existingPreview.status,
            pid: existingPreview.pid,
            port: existingPreview.port,
            stopped_at: existingPreview.stopped_at,
            error_message: existingPreview.error_message
          });
          
          // If preview is marked as running, verify it's actually running
          if (['installing', 'starting', 'running'].includes(existingPreview.status)) {
            logger.info(`Preview is marked as ${existingPreview.status}, verifying actual state...`);
            
            // Check if the process is actually running
            let isActuallyRunning = false;
            
            // Check by PID
            if (existingPreview.pid) {
              try {
                // Check if process exists (kill with signal 0 doesn't actually kill, just checks)
                process.kill(existingPreview.pid, 0);
                isActuallyRunning = true;
                logger.info(`Process ${existingPreview.pid} is still running`);
              } catch (error) {
                logger.info(`Process ${existingPreview.pid} is not running: ${error.message}`);
              }
            }
            
            // Also check if port is actually in use
            if (!isActuallyRunning && existingPreview.port) {
              const portInUse = !(await this.portAllocator.isPortAvailable(existingPreview.port));
              if (portInUse) {
                logger.info(`Port ${existingPreview.port} is still in use, but not by our process`);
                // Port is in use but not by our process - need to clean up
              } else {
                logger.info(`Port ${existingPreview.port} is available`);
              }
            }
            
            if (isActuallyRunning) {
              // Process is actually running, return existing preview
              logger.info(`Preview is actually running, returning existing preview`);
              const urls = existingPreview.urls ? JSON.parse(existingPreview.urls) : {};
              return {
                success: true,
                previewId: existingPreview.id,
                executionId,
                refType: options.refType,
                refId: options.refId,
                workingDir: existingPreview.working_dir,
                status: existingPreview.status,
                command: existingPreview.command,
                pid: existingPreview.pid,
                port: existingPreview.port,
                urls,
                startedAt: existingPreview.started_at,
                existing: true
              };
            } else {
              // Process is not running, update status to stopped
              logger.info(`Preview process is not running, updating status to stopped`);
              await this.db.run(
                'UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['stopped', existingPreview.id]
              );
              existingPreview.status = 'stopped';
              // Continue to restart logic below
            }
          }
          
          // If preview is stopped or failed, restart it
          if (['stopped', 'failed'].includes(existingPreview.status)) {
            logger.info(`Preview is in ${existingPreview.status} state, stopping and restarting...`);
            
            // First stop the preview if needed
            try {
              await this.stopPreview(executionId, existingPreview.id);
              // Wait a moment for cleanup
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
              logger.warn(`Error stopping preview ${existingPreview.id}:`, error);
            }
            
            // Now start a new preview with the same parameters
            // Continue to the normal flow below to create a new preview
            logger.info(`Creating new preview for ${options.refType}/${options.refId} after stopping the old one`);
            // Don't return here - let it continue to create a new preview
          } else {
            // Return for unexpected status
            logger.warn(`Preview has unexpected status: ${existingPreview.status}`);
            return {
              success: false,
              error: `Preview has unexpected status: ${existingPreview.status}`,
              previewId: existingPreview.id
            };
          }
        }
      }

      // Determine the working directory based on reference info
      let workingDir = execution.working_dir;
      if (options.refType && options.refId) {
        const baseWorkspace = execution.workspace_path || execution.working_dir;
        workingDir = path.join(baseWorkspace, options.refType, options.refId);
        logger.info(`Starting new preview in reference directory: ${workingDir}`, {
          refType: options.refType,
          refId: options.refId,
          baseWorkspace,
          'execution.workspace_path': execution.workspace_path,
          'execution.working_dir': execution.working_dir,
          'execution': execution,
          options
        });
      }
      
      const previewId = uuidv4();

      // Store preview in database immediately with 'installing' status
      await this.db.run(
        `INSERT INTO preview_processes (id, execution_id, command, port, status, urls, pid, ref_type, ref_id, working_dir)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [previewId, executionId, 'pending', null, 'installing', JSON.stringify({}), null, 
         options.refType || null, options.refId || null, workingDir]
      );

      // Start the async setup process in the background
      this.setupPreviewAsync(previewId, executionId, workingDir, options)
        .catch(error => {
          logger.error(`Async preview setup failed for ${previewId}:`, error);
          this.db.run(
            'UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?',
            ['failed', error.message, previewId]
          ).catch(dbError => {
            logger.error(`Failed to update preview status to failed:`, dbError);
          });
        });

      // Return immediately - client will poll status endpoint
      return {
        success: true,
        previewId,
        executionId,
        refType: options.refType,
        refId: options.refId,
        workingDir,
        status: 'installing',
        command: 'pending',
        pid: null,
        port: null,
        urls: {},
        startedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error starting preview:', error);
      throw error;
    }
  }

  async setupPreviewAsync(previewId, executionId, workingDir, options) {
    try {
      logger.info(`Setting up preview ${previewId} in ${workingDir}`);

      // Analyze project
      const analysis = await this.analyzeProject(executionId, { refType: options.refType, refId: options.refId });
      
      // Install dependencies by default unless explicitly disabled
      if (options.installDependencies !== false) {
        logger.info(`Installing dependencies in ${workingDir}`);
        
        // Emit phase update for dependency installation
        if (this.eventEmitter) {
          this.eventEmitter.emit('execution:log', {
            executionId,
            log: {
              timestamp: new Date().toISOString(),
              type: 'system',
              content: JSON.stringify({
                type: 'system',
                subtype: 'phase',
                phase: 'installing_dependencies',
                message: 'Installing project dependencies'
              })
            }
          });
        }
        
        try {
          const installResult = await this.installDependencies(executionId, { 
            manager: 'auto', 
            workingDir,
            refType: options.refType,
            refId: options.refId 
          });
          logger.info(`Dependencies installed successfully`, installResult);
          
          // Emit ready for preview after successful install
          if (this.eventEmitter) {
            this.eventEmitter.emit('execution:log', {
              executionId,
              log: {
                timestamp: new Date().toISOString(),
                type: 'system',
                content: JSON.stringify({
                  type: 'system',
                  subtype: 'phase',
                  phase: 'ready_for_preview',
                  message: 'Dependencies installed, project ready for preview'
                })
              }
            });
          }
        } catch (installError) {
          logger.error(`Failed to install dependencies: ${installError.message}`);
          throw new Error(`Dependency installation failed: ${installError.message}`);
        }
      }

      // Get command
      let command = options.customCommand || 
        (options.command && analysis.availableScripts[options.command]) ||
        analysis.availableScripts[analysis.suggestedCommand];

      if (!command) {
        throw new Error('No command specified or available');
      }

      // Fix command to use npx for Node.js projects so binaries are found
      if (analysis.projectType === 'node' && !command.startsWith('npx') && !command.startsWith('npm') && !command.startsWith('yarn')) {
        command = `npx ${command}`;
        logger.info(`Modified command to use npx: ${command}`);
      }

      // Update status to starting
      await this.db.run(
        'UPDATE preview_processes SET status = ?, command = ? WHERE id = ?',
        ['starting', command, previewId]
      );

      logger.info(`Starting app with command: ${command} in directory: ${workingDir}`);
      
      // Create clean environment, let the dev server pick its own port
      const env = {
        ...process.env,
        NODE_ENV: 'development',
        ...options.env
      };
      
      // Set PORT=0 to hint that we want any available port
      // Some servers respect this, others will use their default port selection
      env.PORT = '0';
      
      logger.info(`Starting preview ${previewId} with PORT=0 for auto-selection`);

      const [cmd, ...args] = command.split(' ');
      const childProcess = spawn(cmd, args, {
        cwd: workingDir,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (!childProcess.pid) {
        throw new Error('Failed to start process');
      }

      // Store the process so it doesn't get garbage collected
      this.previewProcesses.set(previewId, childProcess);
      
      logger.info(`Started process with PID: ${childProcess.pid}`);

      await this.db.run(
        'UPDATE preview_processes SET pid = ? WHERE id = ?',
        [childProcess.pid, previewId]
      );

      let detectedPort = null;

      childProcess.stdout.on('data', async (data) => {
        const output = data.toString();
        this.handleProcessOutput(previewId, 'stdout', output);
        this.checkForErrors(previewId, output, executionId);
        
        // Detect the port from server output
        if (!detectedPort) {
          const parsedPort = this.parsePortFromOutput(output, analysis.framework);
          if (parsedPort) {
            detectedPort = parsedPort;
            logger.info(`Detected port ${detectedPort} for preview ${previewId}`);
            await this.updatePreviewPort(previewId, detectedPort);
          }
        }
      });

      childProcess.stderr.on('data', async (data) => {
        const output = data.toString();
        this.handleProcessOutput(previewId, 'stderr', output);
        this.checkForErrors(previewId, output, executionId);
        
        // Also check stderr for port information
        if (!detectedPort) {
          const parsedPort = this.parsePortFromOutput(output, analysis.framework);
          if (parsedPort) {
            detectedPort = parsedPort;
            logger.info(`Detected port ${detectedPort} for preview ${previewId} (from stderr)`);
            await this.updatePreviewPort(previewId, detectedPort);
          }
        }
      });

      childProcess.on('error', (error) => {
        logger.error(`Process error for preview ${previewId}:`, error);
        this.handleProcessError(previewId, error);
      });

      childProcess.on('exit', (code, signal) => {
        logger.info(`Process exited for preview ${previewId} with code ${code}, signal ${signal}`);
        this.handleProcessExit(previewId, code, signal);
      });

    } catch (error) {
      logger.error(`Setup failed for preview ${previewId}:`, error);
      await this.db.run(
        'UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?',
        ['failed', error.message, previewId]
      );
      throw error;
    }
  }

  async stopPreview(executionId, previewId = null, options = {}) {
    try {
      let previewsToStop = [];

      if (previewId) {
        const preview = await this.db.get(
          'SELECT * FROM preview_processes WHERE id = ? AND execution_id = ?',
          [previewId, executionId]
        );
        if (preview) {
          previewsToStop.push(preview);
        }
      } else if (options.refType && options.refId) {
        // Stop only previews for specific reference
        previewsToStop = await this.db.all(
          'SELECT * FROM preview_processes WHERE execution_id = ? AND ref_type = ? AND ref_id = ? AND status IN (?, ?, ?)',
          [executionId, options.refType, options.refId, 'installing', 'starting', 'running']
        );
      } else {
        // Stop all previews for execution
        previewsToStop = await this.db.all(
          'SELECT * FROM preview_processes WHERE execution_id = ? AND status IN (?, ?, ?)',
          [executionId, 'installing', 'starting', 'running']
        );
      }

      const stoppedIds = [];

      for (const preview of previewsToStop) {
        const process = this.previewProcesses.get(preview.id);
        if (process) {
          process.kill('SIGTERM');
          
          setTimeout(() => {
            if (!process.killed) {
              process.kill('SIGKILL');
            }
          }, 5000);
        }

        await this.portAllocator.releasePortsByPreviewId(preview.id);
        
        await this.db.run(
          'UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['stopped', preview.id]
        );

        this.previewProcesses.delete(preview.id);
        stoppedIds.push(preview.id);
      }

      return {
        success: true,
        stopped: stoppedIds,
        stoppedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error stopping preview:`, error);
      throw error;
    }
  }

  async getPreviewStatus(executionId, options = {}) {
    try {
      let query = 'SELECT * FROM preview_processes WHERE execution_id = ?';
      const params = [executionId];
      
      if (options.refType && options.refId) {
        query += ' AND ref_type = ? AND ref_id = ?';
        params.push(options.refType, options.refId);
      }
      
      query += ' ORDER BY started_at DESC';
      
      const previews = await this.db.all(query, params);

      const results = [];

      for (const preview of previews) {
        const urls = JSON.parse(preview.urls || '{}');
        let health = null;

        if (preview.status === 'running' && urls.local) {
          const healthCheck = await this.healthChecker.checkHealth(urls.local, 5000); // 5 second timeout
          health = {
            responsive: healthCheck.responsive,
            lastCheck: new Date().toISOString(),
            responseTime: healthCheck.responseTime
          };
        }

        const recentLogs = await this.db.all(
          'SELECT content FROM preview_logs WHERE preview_id = ? ORDER BY timestamp DESC LIMIT 10',
          [preview.id]
        );

        results.push({
          previewId: preview.id,
          refType: preview.ref_type,
          refId: preview.ref_id,
          workingDir: preview.working_dir,
          status: preview.status,
          command: preview.command,
          pid: preview.pid,
          port: preview.port,
          urls,
          startedAt: preview.started_at,
          stoppedAt: preview.stopped_at,
          errorMessage: preview.error_message,
          health,
          logs: {
            recent: recentLogs.map(log => log.content).reverse()
          }
        });
      }

      return {
        executionId,
        refType: options.refType,
        refId: options.refId,
        previews: results
      };
    } catch (error) {
      logger.error(`Error getting preview status for execution ${executionId}:`, error);
      throw error;
    }
  }

  async installDependencies(executionId, options = {}) {
    try {
      const execution = await this.db.get(
        'SELECT * FROM executions WHERE id = ?',
        [executionId]
      );

      if (!execution) {
        throw new Error('Execution not found');
      }

      // Determine the working directory based on reference info
      let workingDir = options.workingDir || execution.working_dir;
      if (options.refType && options.refId) {
        const baseWorkspace = execution.workspace_path || execution.working_dir;
        workingDir = path.join(baseWorkspace, options.refType, options.refId);
        logger.info(`Installing dependencies in reference directory: ${workingDir}`);
      }
      
      const analysis = await this.analyzeProject(executionId, { refType: options.refType, refId: options.refId });
      
      let manager = options.manager;
      if (manager === 'auto') {
        manager = analysis.dependencies.manager;
      }

      if (!manager) {
        throw new Error('No package manager detected');
      }

      const commands = {
        npm: options.production ? 'npm ci --production' : 'npm install',
        yarn: options.production ? 'yarn install --production' : 'yarn install',
        pnpm: options.production ? 'pnpm install --prod' : 'pnpm install',
        pip: 'pip install -r requirements.txt',
        pipenv: 'pipenv install'
      };

      const command = commands[manager];
      if (!command) {
        throw new Error(`Unsupported package manager: ${manager}`);
      }

      const startTime = Date.now();

      return new Promise((resolve, reject) => {
        const [cmd, ...args] = command.split(' ');
        const childProcess = spawn(cmd, args, {
          cwd: workingDir,
          shell: true,
          env: { ...process.env, NODE_ENV: 'development' }
        });

        let output = '';

        childProcess.stdout.on('data', (data) => {
          output += data.toString();
          logger.info(`Install output: ${data.toString().trim()}`);
        });

        childProcess.stderr.on('data', (data) => {
          output += data.toString();
          logger.info(`Install stderr: ${data.toString().trim()}`);
        });

        childProcess.on('error', (error) => {
          logger.error(`Install process error:`, error);
          reject(error);
        });

        childProcess.on('exit', (code) => {
          const duration = Date.now() - startTime;
          logger.info(`Install process exited with code ${code} after ${duration}ms`);

          if (code === 0) {
            resolve({
              success: true,
              manager,
              command,
              duration,
              workingDir,
              refType: options.refType,
              refId: options.refId,
              installedAt: new Date().toISOString()
            });
          } else {
            reject(new Error(`Installation failed with code ${code}: ${output}`));
          }
        });
      });
    } catch (error) {
      logger.error(`Error installing dependencies for execution ${executionId}:`, error);
      throw error;
    }
  }

  async handleProcessOutput(previewId, type, content) {
    try {
      await this.db.run(
        'INSERT INTO preview_logs (preview_id, type, content) VALUES (?, ?, ?)',
        [previewId, type, content]
      );

      this.broadcastLog(previewId, type, content);
    } catch (error) {
      logger.error(`Error handling process output for preview ${previewId}:`, error);
    }
  }

  async handleProcessError(previewId, error) {
    try {
      await this.db.run(
        'UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?',
        ['failed', error.message, previewId]
      );

      await this.handleProcessOutput(previewId, 'system', `Process error: ${error.message}`);
    } catch (dbError) {
      logger.error(`Error handling process error for preview ${previewId}:`, dbError);
    }
  }

  async handleProcessExit(previewId, code, signal) {
    try {
      const status = code === 0 ? 'stopped' : 'failed';
      const message = signal ? `Process killed by signal ${signal}` : `Process exited with code ${code}`;

      await this.db.run(
        'UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?',
        [status, code !== 0 ? message : null, previewId]
      );

      await this.handleProcessOutput(previewId, 'system', message);
      await this.portAllocator.releasePortsByPreviewId(previewId);

      this.previewProcesses.delete(previewId);

      // Check if this was an unexpected exit that should trigger auto-restart
      const isUnexpectedExit = code !== 0 && !signal?.includes('SIGTERM') && !signal?.includes('SIGINT');
      
      if (isUnexpectedExit) {
        // Get preview data for error notification
        const preview = await this.db.get(
          'SELECT * FROM preview_processes WHERE id = ?',
          [previewId]
        );
        
        if (preview && preview.execution_id) {
          logger.warn(`Preview ${previewId} exited unexpectedly (code: ${code}, signal: ${signal})`);
          
          // Send error to Claude instead of auto-restarting
          const errorMessage = `⚠️ **Preview Process Exited**\n\n` +
            `Preview for ${preview.ref_type}/${preview.ref_id} stopped unexpectedly.\n\n` +
            `Exit code: ${code}\n` +
            `Signal: ${signal || 'none'}\n\n` +
            `This might be due to:\n` +
            `- A crash in the application\n` +
            `- Memory issues\n` +
            `- Build/compilation errors\n` +
            `- Port conflicts\n\n` +
            `Please check the logs above for more details. You can restart the preview using the UI controls.`;
          
          try {
            await axios.post(`http://localhost:3010/message/${preview.execution_id}`, {
              message: errorMessage
            });
            logger.info(`Sent exit notification to Claude for preview ${previewId}`);
          } catch (error) {
            logger.error(`Failed to send exit notification to Claude:`, error);
          }
        }
      }
    } catch (error) {
      logger.error(`Error handling process exit for preview ${previewId}:`, error);
    }
  }

  addSSEConnection(previewId, res) {
    if (!this.sseConnections.has(previewId)) {
      this.sseConnections.set(previewId, new Set());
    }
    this.sseConnections.get(previewId).add(res);
  }

  removeSSEConnection(previewId, res) {
    const connections = this.sseConnections.get(previewId);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        this.sseConnections.delete(previewId);
      }
    }
  }

  broadcastLog(previewId, type, content) {
    const connections = this.sseConnections.get(previewId);
    if (connections) {
      const data = JSON.stringify({
        timestamp: new Date().toISOString(),
        type,
        content
      });

      connections.forEach(res => {
        res.write(`event: log\ndata: ${data}\n\n`);
      });
    }
  }

  broadcastStatus(previewId, status, port, url) {
    const connections = this.sseConnections.get(previewId);
    if (connections) {
      const data = JSON.stringify({
        status,
        port,
        url
      });

      connections.forEach(res => {
        res.write(`event: status\ndata: ${data}\n\n`);
      });
    }
  }

  getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return 'localhost';
  }

  parsePortFromOutput(output, framework) {
    // Common patterns for different frameworks
    const patterns = {
      nextjs: [
        /Ready - started server on 0\.0\.0\.0:(\d+)/,
        /Ready - started server on .*:(\d+)/,
        /Local:\s+http:\/\/localhost:(\d+)/,
        /ready - started server on.*:(\d+)/i
      ],
      react: [
        /Local:\s+http:\/\/localhost:(\d+)/,
        /webpack compiled with \d+ warnings.*http:\/\/localhost:(\d+)/,
        /compiled successfully!.*http:\/\/localhost:(\d+)/i
      ],
      vue: [
        /Local:\s+http:\/\/localhost:(\d+)/,
        /App running at:.*http:\/\/localhost:(\d+)/
      ],
      vite: [
        /Local:\s+http:\/\/localhost:(\d+)/,
        /Local:\s+http:\/\/127\.0\.0\.1:(\d+)/
      ]
    };

    // Try framework-specific patterns first
    const frameworkPatterns = patterns[framework] || [];
    for (const pattern of frameworkPatterns) {
      const match = output.match(pattern);
      if (match) {
        const port = parseInt(match[1], 10);
        logger.info(`Detected port ${port} for ${framework} from output`);
        return port;
      }
    }

    // Try generic patterns
    const genericPatterns = [
      /localhost:(\d+)/g,
      /127\.0\.0\.1:(\d+)/g,
      /0\.0\.0\.0:(\d+)/g,
      /http:\/\/.*:(\d+)/g
    ];

    for (const pattern of genericPatterns) {
      const matches = Array.from(output.matchAll(pattern));
      if (matches.length > 0) {
        const port = parseInt(matches[0][1], 10);
        // Skip common non-server ports
        if (port >= 3000 && port <= 9000) {
          logger.info(`Detected port ${port} from generic pattern`);
          return port;
        }
      }
    }

    return null;
  }

  async updatePreviewPort(previewId, port) {
    try {
      const urls = {
        local: `http://localhost:${port}`,
        network: `http://${this.getNetworkIP()}:${port}`,
        public: null
      };

      await this.db.run(
        'UPDATE preview_processes SET port = ?, urls = ? WHERE id = ?',
        [port, JSON.stringify(urls), previewId]
      );

      // Allocate port for this preview (upsert to handle both new and existing allocations)
      await this.portAllocator.allocatePortForPreview(port, previewId);

      logger.info(`Updated preview ${previewId} with detected port ${port}`);

      // Broadcast port update to SSE connections
      this.broadcastStatus(previewId, 'port_detected', port, urls.local);

      // Start health checking now that we have the port
      this.startHealthCheck(previewId, port);
    } catch (error) {
      logger.error(`Error updating preview port for ${previewId}:`, error);
    }
  }

  async startHealthCheck(previewId, port) {
    const url = `http://localhost:${port}`;
    
    setTimeout(async () => {
      try {
        const waitResult = await this.healthChecker.waitForServer(url, {
          maxAttempts: 30,
          initialDelay: 2000
        });

        if (waitResult.success) {
          await this.db.run(
            'UPDATE preview_processes SET status = ? WHERE id = ?',
            ['running', previewId]
          );
          this.broadcastStatus(previewId, 'running', port, url);
        } else {
          await this.db.run(
            'UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?',
            ['failed', 'Server failed to start', previewId]
          );
          this.broadcastStatus(previewId, 'failed', port, null);
        }
      } catch (error) {
        logger.error(`Health check failed for preview ${previewId}:`, error);
      }
    }, 3000); // Give the app some time to start before health checking
  }

  /**
   * Forcefully stop a preview process and clean up resources
   */
  async forceStopPreview(previewId) {
    logger.info(`Force stopping preview ${previewId}`);
    
    try {
      // Kill process if it exists in memory
      const processInfo = this.previewProcesses.get(previewId);
      if (processInfo && processInfo.process) {
        const process = processInfo.process;
        
        if (!process.killed) {
          // Try graceful termination first
          process.kill('SIGTERM');
          
          // Wait 2 seconds, then force kill if still running
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          if (!process.killed) {
            logger.warn(`Preview ${previewId} didn't respond to SIGTERM, using SIGKILL`);
            process.kill('SIGKILL');
          }
        }
        
        // Remove from our process map
        this.previewProcesses.delete(previewId);
      }
      
      // Kill any processes using the same port (in case of port conflicts)
      const preview = await this.db.get('SELECT port FROM preview_processes WHERE id = ?', [previewId]);
      if (preview && preview.port) {
        await this.killProcessOnPort(preview.port);
      }
      
      // Release allocated ports
      await this.portAllocator.releasePortsByPreviewId(previewId);
      
    } catch (error) {
      logger.error(`Error during force stop of preview ${previewId}:`, error);
      // Don't throw - we want restart to continue even if cleanup partially fails
    }
  }

  /**
   * Kill any process using the specified port
   */
  async killProcessOnPort(port) {
    
    try {
      // Use lsof to find process using the port, then kill it
      const lsofProcess = spawn('lsof', ['-ti', `:${port}`]);
      
      let pids = '';
      lsofProcess.stdout.on('data', (data) => {
        pids += data.toString();
      });
      
      await new Promise((resolve, reject) => {
        lsofProcess.on('close', (code) => {
          resolve();
        });
        lsofProcess.on('error', reject);
      });
      
      // Kill all PIDs found
      const pidList = pids.trim().split('\n').filter(pid => pid);
      for (const pid of pidList) {
        try {
          process.kill(parseInt(pid), 'SIGKILL');
          logger.info(`Killed process ${pid} using port ${port}`);
        } catch (e) {
          // Process might already be dead
        }
      }
    } catch (error) {
      logger.warn(`Could not kill processes on port ${port}:`, error.message);
      // This is not critical, so don't throw
    }
  }

  /**
   * Restart a preview process after server restart
   */
  async restartPreview(previewData) {
    logger.info(`Attempting to restart preview ${previewData.id}`);
    
    try {
      // First, forcefully stop any existing process for this preview
      await this.forceStopPreview(previewData.id);
      
      // Clear the port in the database - let the server auto-select a new one
      await this.db.run(
        'UPDATE preview_processes SET port = NULL, urls = ? WHERE id = ?',
        [JSON.stringify({}), previewData.id]
      );
      
      // Update status to restarting
      await this.db.run(
        'UPDATE preview_processes SET status = ? WHERE id = ?',
        ['starting', previewData.id]
      );
      
      // Parse command from stored data
      const command = JSON.parse(previewData.command);
      
      // Create clean environment without PORT
      const env = { ...process.env };
      delete env.PORT;
      
      // Spawn the process
      const childProcess = spawn(command.cmd, command.args, {
        cwd: previewData.working_dir,
        env,
        shell: true
      });
      
      // Store process reference
      this.previewProcesses.set(previewData.id, {
        process: childProcess,
        port: previewData.port,
        executionId: previewData.execution_id,
        refType: previewData.ref_type,
        refId: previewData.ref_id
      });
      
      // Handle process output
      childProcess.stdout.on('data', (data) => {
        const content = data.toString();
        this.handleProcessOutput(previewData.id, 'stdout', content);
        this.checkForErrors(previewData.id, content, previewData.execution_id);
      });
      
      childProcess.stderr.on('data', (data) => {
        const content = data.toString();
        this.handleProcessOutput(previewData.id, 'stderr', content);
        this.checkForErrors(previewData.id, content, previewData.execution_id);
      });
      
      childProcess.on('error', (error) => {
        logger.error(`Preview process error for ${previewData.id}:`, error);
        this.handlePreviewError(previewData.id, error.message);
      });
      
      childProcess.on('exit', (code, signal) => {
        logger.info(`Preview process exited for ${previewData.id}: code=${code}, signal=${signal}`);
        this.handlePreviewExit(previewData.id, code, signal);
      });
      
      // Update URLs
      const newUrls = {
        local: `http://localhost:${previewData.port}`,
        tunnel: null
      };
      
      await this.db.run(
        'UPDATE preview_processes SET urls = ?, pid = ? WHERE id = ?',
        [JSON.stringify(newUrls), childProcess.pid, previewData.id]
      );
      
      // Perform health check after a delay
      const url = newUrls.local;
      setTimeout(async () => {
        try {
          const waitResult = await this.healthChecker.waitForServer(url, {
            maxAttempts: 30,
            initialDelay: 2000
          });
          
          if (waitResult.success) {
            await this.db.run(
              'UPDATE preview_processes SET status = ? WHERE id = ?',
              ['running', previewData.id]
            );
            logger.info(`Successfully restarted preview ${previewData.id}`);
          } else {
            await this.db.run(
              'UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?',
              ['failed', 'Server failed to restart', previewData.id]
            );
          }
        } catch (error) {
          logger.error(`Health check failed for restarted preview ${previewData.id}:`, error);
        }
      }, 3000);
      
      return {
        success: true,
        previewId: previewData.id,
        port: previewData.port,
        url: newUrls.local
      };
    } catch (error) {
      logger.error(`Failed to restart preview ${previewData.id}:`, error);
      
      // Update status to failed
      await this.db.run(
        'UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?',
        ['failed', error.message, previewData.id]
      );
      
      throw error;
    }
  }

  /**
   * Start periodic health monitoring for running previews
   */
  startHealthMonitoring() {
    setInterval(async () => {
      try {
        await this.checkAndRestartFailedPreviews();
      } catch (error) {
        logger.error('Error during health monitoring:', error);
      }
    }, this.healthCheckInterval);
    
    logger.info(`Started preview health monitoring (interval: ${this.healthCheckInterval}ms)`);
  }

  /**
   * Check all running previews and restart failed ones
   */
  async checkAndRestartFailedPreviews() {
    const runningPreviews = await this.db.all(
      'SELECT * FROM preview_processes WHERE status = ?',
      ['running']
    );

    for (const preview of runningPreviews) {
      try {
        await this.checkPreviewHealth(preview);
      } catch (error) {
        logger.error(`Health check failed for preview ${preview.id}:`, error);
      }
    }
  }

  /**
   * Check health of a specific preview and restart if needed
   */
  async checkPreviewHealth(preview) {
    const urls = preview.urls ? JSON.parse(preview.urls) : {};
    const url = urls.local;
    
    if (!url) {
      logger.warn(`Preview ${preview.id} has no URL, skipping health check`);
      return;
    }

    // Check if process is still running
    const processInfo = this.previewProcesses.get(preview.id);
    if (processInfo && processInfo.process && processInfo.process.killed) {
      logger.warn(`Preview ${preview.id} process was killed, restarting...`);
      await this.handlePreviewRestart(preview, 'Process was killed');
      return;
    }

    // HTTP health check - less aggressive, just log failures
    try {
      const healthResult = await this.healthChecker.checkHealth(url, 10000); // 10 second timeout

      if (!healthResult.success) {
        logger.warn(`Preview ${preview.id} health check failed: ${healthResult.error}`);
        // Don't auto-restart on health check failures - let Claude handle it
        // await this.handlePreviewRestart(preview, `Health check failed: ${healthResult.error}`);
        
        // Instead, just update the status so UI can show warning
        await this.db.run(
          'UPDATE preview_processes SET last_health_check = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?',
          [`Health check failed: ${healthResult.error}`, preview.id]
        );
      } else {
        // Health check passed, update last check time and clear any errors
        await this.db.run(
          'UPDATE preview_processes SET last_health_check = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ?',
          [preview.id]
        );
      }
    } catch (error) {
      logger.warn(`Preview ${preview.id} health check error:`, error);
      // Don't auto-restart on health check errors
      // await this.handlePreviewRestart(preview, `Health check error: ${error.message}`);
    }
  }

  /**
   * Handle restarting a failed preview
   */
  async handlePreviewRestart(preview, reason) {
    // Check restart attempts
    const restartAttempts = preview.restart_attempts || 0;
    if (restartAttempts >= this.maxRestartAttempts) {
      logger.error(`Preview ${preview.id} exceeded max restart attempts (${this.maxRestartAttempts}), marking as failed`);
      await this.db.run(
        'UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?',
        ['failed', `Exceeded max restart attempts: ${reason}`, preview.id]
      );
      return;
    }

    logger.info(`Restarting preview ${preview.id} (attempt ${restartAttempts + 1}/${this.maxRestartAttempts}): ${reason}`);

    try {
      // Stop the current process if it exists
      const processInfo = this.previewProcesses.get(preview.id);
      if (processInfo && processInfo.process) {
        try {
          processInfo.process.kill('SIGTERM');
        } catch (e) {
          // Process might already be dead
        }
      }

      // Update status to restarting
      await this.db.run(
        'UPDATE preview_processes SET status = ?, restart_attempts = ?, error_message = ? WHERE id = ?',
        ['starting', restartAttempts + 1, `Restarting: ${reason}`, preview.id]
      );

      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, this.restartDelay));

      // Restart the preview using existing data
      await this.restartPreview(preview);

      logger.info(`Successfully restarted preview ${preview.id}`);
    } catch (error) {
      logger.error(`Failed to restart preview ${preview.id}:`, error);
      await this.db.run(
        'UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?',
        ['failed', `Restart failed: ${error.message}`, preview.id]
      );
    }
  }

  /**
   * Check for errors in preview logs and send to Claude if needed
   */
  async checkForErrors(previewId, content, executionId) {
    // Check if content contains any error patterns
    let errorFound = null;
    for (const pattern of this.errorPatterns) {
      if (pattern.test(content)) {
        errorFound = content.trim();
        break;
      }
    }
    
    if (!errorFound) return;
    
    // Get or create execution error state
    let execError = this.executionErrors.get(executionId);
    if (!execError) {
      execError = {
        errorBuffer: new Set(),
        timeoutId: null,
        lastSent: 0,
        isHandling: false
      };
      this.executionErrors.set(executionId, execError);
    }
    
    // Check if we're already handling an error for this execution
    if (execError.isHandling) {
      logger.debug(`Already handling error for execution ${executionId}, skipping`);
      return;
    }
    
    // Check if we've sent an error recently (within 60 seconds)
    const now = Date.now();
    if (execError.lastSent && (now - execError.lastSent) < 60000) {
      logger.debug(`Recently sent error for execution ${executionId}, skipping`);
      return;
    }
    
    // Add error to buffer
    execError.errorBuffer.add(errorFound);
    
    // Clear existing timeout if any
    if (execError.timeoutId) {
      clearTimeout(execError.timeoutId);
    }
    
    // Set a new timeout to send the buffered errors
    execError.timeoutId = setTimeout(async () => {
      await this.sendBufferedErrors(executionId, previewId);
    }, this.errorBufferDelay);
  }

  /**
   * Send buffered errors to Claude after delay
   */
  async sendBufferedErrors(executionId, previewId) {
    const execError = this.executionErrors.get(executionId);
    if (!execError || execError.errorBuffer.size === 0) return;
    
    // Mark as handling to prevent duplicates
    execError.isHandling = true;
    
    try {
      // Check if Claude is already active for this execution
      // We need to check with the Claude SDK Manager through the database
      const execution = await this.db.get(
        'SELECT agent_type FROM executions WHERE id = ?',
        [executionId]
      );
      
      if (execution && execution.agent_type === 'claude') {
        // For Claude executions, check if there's an active session
        // We'll rely on the startExecution check we added to prevent duplicates
        logger.info(`Checking Claude session status for execution ${executionId}`);
      }
      
      logger.info(`Sending buffered errors to Claude for execution ${executionId}`);
      
      // Get preview info
      const preview = await this.db.get(
        'SELECT * FROM preview_processes WHERE id = ?',
        [previewId]
      );
      
      if (!preview) {
        execError.errorBuffer.clear();
        execError.isHandling = false;
        return;
      }
      
      // Combine all buffered errors
      const allErrors = Array.from(execError.errorBuffer).join('\n\n---\n\n');
      
      const errorMessage = `🚨 **Preview Error Detected**\n\n` +
        `Preview for ${preview.ref_type}/${preview.ref_id} encountered errors:\n\n` +
        `\`\`\`\n${allErrors}\n\`\`\`\n\n` +
        `The preview server needs attention. Please:\n` +
        `1. Review and fix the errors above\n` +
        `2. The preview will automatically restart once fixed\n` +
        `3. If needed, you can manually restart using the UI\n\n` +
        `Common solutions:\n` +
        `- Fix TypeScript/build errors\n` +
        `- Install missing dependencies\n` +
        `- Check import paths and module resolution\n` +
        `- Verify configuration files`;
      
      // Send message to Claude
      await axios.post(`http://localhost:3010/message/${executionId}`, {
        message: errorMessage
      });
      
      // Update tracking
      execError.lastSent = Date.now();
      execError.errorBuffer.clear();
      
      logger.info(`Successfully sent error message to Claude for execution ${executionId}`);
    } catch (error) {
      logger.error(`Failed to send error to Claude:`, error);
    } finally {
      execError.isHandling = false;
    }
  }

  /**
   * Handle preview process error
   */
  async handlePreviewError(previewId, errorMessage) {
    try {
      await this.db.run(
        'UPDATE preview_processes SET status = ?, error_message = ?, stopped_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['failed', errorMessage, previewId]
      );
      
      logger.error(`Preview ${previewId} failed: ${errorMessage}`);
    } catch (error) {
      logger.error(`Failed to update preview error status:`, error);
    }
  }

  /**
   * Handle preview process exit
   */
  async handlePreviewExit(previewId, code, signal) {
    try {
      const status = code === 0 ? 'stopped' : 'failed';
      const message = signal ? `Process killed by signal ${signal}` : 
                     code !== 0 ? `Process exited with code ${code}` : null;

      await this.db.run(
        'UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?',
        [status, message, previewId]
      );

      // Clean up process reference
      this.previewProcesses.delete(previewId);
      
      // Get execution ID to clean up error tracking if this was the last preview
      const preview = await this.db.get(
        'SELECT execution_id FROM preview_processes WHERE id = ?',
        [previewId]
      );
      
      if (preview) {
        // Check if there are other active previews for this execution
        const otherPreviews = await this.db.get(
          'SELECT COUNT(*) as count FROM preview_processes WHERE execution_id = ? AND status IN ("running", "starting", "installing") AND id != ?',
          [preview.execution_id, previewId]
        );
        
        // If no other active previews, clean up execution error tracking
        if (otherPreviews.count === 0) {
          const execError = this.executionErrors.get(preview.execution_id);
          if (execError) {
            if (execError.timeoutId) {
              clearTimeout(execError.timeoutId);
            }
            this.executionErrors.delete(preview.execution_id);
            logger.debug(`Cleaned up error tracking for execution ${preview.execution_id}`);
          }
        }
      }
      
      logger.info(`Preview ${previewId} exited with status: ${status}`);
    } catch (error) {
      logger.error(`Failed to handle preview exit:`, error);
    }
  }
}

export default PreviewManager;