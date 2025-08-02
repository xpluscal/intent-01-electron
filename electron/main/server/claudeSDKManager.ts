// Claude SDK uses ES modules, so we need to use dynamic import
import path from 'node:path';
import fs from 'node:fs';
import { 
  Events, 
  ExecutionStatus,
  LogType,
  ErrorCodes
} from './constants.js';
import { createLogger } from './logger.js';

let query: any;

const logger = createLogger('ClaudeSDKManager');

class ClaudeSDKManager {
  constructor(db, config, eventEmitter, workspaceManager) {
    this.db = db;
    this.config = config;
    this.eventEmitter = eventEmitter;
    this.workspaceManager = workspaceManager;
    this.activeSessions = new Map(); // executionId -> { sessionId, abortController }
    this.pendingMessages = new Map(); // executionId -> originalMessage (for compact retry)
    this.sdkLoaded = false;
    this.loadSDK();
  }

  async loadSDK() {
    try {
      const claudeSDK = await import('@anthropic-ai/claude-code');
      query = claudeSDK.query;
      this.sdkLoaded = true;
      logger.info('Claude SDK loaded successfully');
    } catch (error) {
      logger.error('Failed to load Claude SDK', { error });
      throw new Error('Claude SDK not available');
    }
  }

  /**
   * Emit execution phase updates for frontend tracking
   */
  async emitPhaseUpdate(executionId, phase, message) {
    const phaseMessage = {
      type: 'system',
      subtype: 'phase',
      phase,
      message,
      timestamp: new Date().toISOString()
    };
    
    // Log to database for SSE streaming
    await this.db.run(
      'INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)',
      [executionId, LogType.SYSTEM, JSON.stringify(phaseMessage)]
    );
    
    // Also emit through event emitter
    this.eventEmitter.emit(Events.LOG_ENTRY, {
      executionId,
      timestamp: phaseMessage.timestamp,
      type: LogType.SYSTEM,
      content: JSON.stringify(phaseMessage)
    });
    
    logger.info('Emitted phase update', { executionId, phase, message });
  }

  async updateHeartbeat(executionId) {
    await this.db.run(
      'UPDATE executions SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?',
      [executionId]
    );
  }

  async startExecution(executionId, prompt, workingDir, options = {}) {
    // Ensure SDK is loaded
    if (!this.sdkLoaded) {
      await this.loadSDK();
    }
    
    // Check if there's already an active session for this execution
    if (this.activeSessions.has(executionId)) {
      if (options.isResume) {
        logger.info('Cleaning up existing session for resume', { executionId });
      } else {
        logger.warn('Execution already has an active session, stopping existing and starting new', { executionId });
      }
      await this.stopExecution(executionId);
    }
    
    try {
      // Always use the execution workspace directory
      const workspacePath = this.workspaceManager ? this.workspaceManager.getWorkspacePath() : process.cwd();
      const executionCwd = path.join(workspacePath, '.execution', `exec-${executionId}`);
      
      // Create the execution directory if it doesn't exist
      fs.mkdirSync(executionCwd, { recursive: true });
      
      if (options.isResume) {
        logger.info('Resuming Claude SDK execution', { 
          executionId, 
          executionCwd, 
          sessionId: options.sessionId,
          action: 'session_resume'
        });
      } else {
        logger.info('Starting Claude SDK execution', { 
          executionId, 
          executionCwd, 
          providedWorkingDir: workingDir,
          action: 'new_execution'
        });
      }

      // Create abort controller for this execution
      const abortController = new AbortController();
      
      // Prepare query options
      const queryOptions = {
        prompt,
        abortController,
        options: {
          verbose: true,
          print: true,
          outputFormat: 'stream-json',
          permissionMode: 'bypassPermissions',
          cwd: executionCwd,
          ...options
        }
      };
      
      logger.info('Claude SDK query options', { 
        executionId, 
        cwd: executionCwd,
        queryOptions
      });

      // If resuming a session, add the session ID
      if (options.sessionId) {
        queryOptions.options.resume = options.sessionId;
        logger.info('Resuming existing session', { executionId, sessionId: options.sessionId });
      }

      // Store session info
      this.activeSessions.set(executionId, {
        sessionId: null,
        abortController,
        messageCount: 0,
        startTime: Date.now()
      });

      // Update execution status
      await this.updateExecutionStatus(executionId, ExecutionStatus.RUNNING);

      // Start the query and process messages
      this.processExecution(executionId, queryOptions).catch(error => {
        logger.error('Execution processing error', { executionId, error });
        this.handleExecutionError(executionId, error);
      });

      return true;
    } catch (error) {
      logger.error('Failed to start execution', { executionId, error });
      await this.updateExecutionStatus(executionId, ExecutionStatus.FAILED);
      throw error;
    }
  }

  async processExecution(executionId, queryOptions) {
    const session = this.activeSessions.get(executionId);
    if (!session) {
      throw new Error('Session not found');
    }

    try {
      let heartbeatCounter = 0;
      
      for await (const message of query(queryOptions)) {
        // Update message count
        session.messageCount++;

        // Update heartbeat every 10 messages
        heartbeatCounter++;
        if (heartbeatCounter % 10 === 0) {
          await this.updateHeartbeat(executionId);
        }

        // Handle different message types
        await this.handleMessage(executionId, message);

        // Capture session ID from init message
        if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
          session.sessionId = message.session_id;
          
          // Update database with session ID
          await this.db.run(
            'UPDATE executions SET session_id = ? WHERE id = ?',
            [message.session_id, executionId]
          );
        }

        // Handle completion
        if (message.type === 'result') {
          await this.handleExecutionComplete(executionId, message);
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.info('Execution aborted', { executionId });
        await this.updateExecutionStatus(executionId, ExecutionStatus.CANCELLED);
        // Note: ready_for_preview phase is now emitted earlier for create refs
      } else {
        throw error;
      }
    }
  }

  async handleMessage(executionId, message) {
    const timestamp = new Date().toISOString();
    
    // Log the raw message for debugging
    logger.debug('Received message', { 
      executionId, 
      type: message.type,
      subtype: message.subtype,
      message: message 
    });

    // Check if this message contains "Prompt is too long" error
    const messageStr = JSON.stringify(message).toLowerCase();
    if (messageStr.includes('prompt is too long')) {
      logger.warn('DEBUG: Found "Prompt is too long" in message', {
        executionId,
        messageType: message.type,
        messageSubtype: message.subtype,
        messageContent: JSON.stringify(message, null, 2)
      });
    }

    // Determine log type based on message type
    let logType = LogType.STDOUT;
    
    switch (message.type) {
      case 'system':
      case 'result':
        logType = LogType.SYSTEM;
        break;
      case 'error':
        logType = LogType.STDERR;
        break;
      default:
        logType = LogType.STDOUT;
        break;
    }

    // Save to database with structured content
    await this.db.run(
      'INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)',
      [executionId, logType, JSON.stringify(message)]
    );

    // Emit log event for SSE streaming with structured message
    this.eventEmitter.emit(Events.LOG_ENTRY, {
      executionId,
      timestamp,
      type: logType,
      content: JSON.stringify(message)
    });
  }

  async sendMessage(executionId, message) {

    console.log('Sending message to execution', { executionId, message });

    const execution = await this.db.get(
      'SELECT * FROM executions WHERE id = ?',
      [executionId]
    );

    console.log('Execution found', { execution });

    if (!execution) {
      throw new Error(ErrorCodes.EXECUTION_NOT_FOUND);
    }

    // Check if we have a session ID
    if (!execution.session_id) {
      throw new Error('No session ID found for execution');
    }

    // Store the original message for potential compact retry
    this.pendingMessages.set(executionId, message);

    // Start a new execution with the message as prompt, resuming the session
    // Note: working_dir is ignored - we always use the execution workspace
    await this.startExecution(executionId, message, null, {
      sessionId: execution.session_id,
    });

    return true;
  }

  async stopExecution(executionId) {
    const session = this.activeSessions.get(executionId);
    
    if (!session) {
      return false;
    }

    logger.info('Stopping execution', { executionId });
    
    // Abort the query
    if (session.abortController) {
      session.abortController.abort();
    }

    // Clean up
    this.activeSessions.delete(executionId);
    
    return true;
  }

  async cleanup(executionId) {
    await this.stopExecution(executionId);
    this.pendingMessages.delete(executionId);
    this.eventEmitter.emit(Events.BUFFER_FLUSH, { executionId });
  }

  isExecutionRunning(executionId) {
    return this.activeSessions.has(executionId);
  }

  /**
   * Check if an execution is currently active (alias for isExecutionRunning)
   */
  isExecutionActive(executionId) {
    return this.activeSessions.has(executionId);
  }

  /**
   * Check if an error indicates the prompt is too long
   */
  isPromptTooLongError(error) {
    if (!error) return false;
    
    // Check if error message contains "Prompt is too long"
    const errorMessage = error.message || error.toString() || '';
    return errorMessage.toLowerCase().includes('prompt is too long');
  }

  /**
   * Wait for compact operation to complete
   */
  async waitForCompactCompletion(executionId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.error('Compact operation timed out', { executionId });
        reject(new Error('Compact operation timed out'));
      }, 120000); // 2 minute timeout for compact

      logger.info('Setting up compact completion listener', { executionId });

      // Listen for completion events - we need to wait for the result message type
      const completionHandler = ({ executionId: completedId, code, result }) => {
        logger.info('Received PROCESS_EXIT event', { 
          completedId, 
          targetExecutionId: executionId, 
          code, 
          hasResult: !!result 
        });
        
        if (completedId === executionId) {
          clearTimeout(timeout);
          this.eventEmitter.off(Events.PROCESS_EXIT, completionHandler);
          
          if (code === 0 || (result && !result.is_error)) {
            logger.info('Compact operation completed successfully', { executionId });
            resolve();
          } else {
            logger.error('Compact operation failed', { executionId, code, result });
            reject(new Error('Compact operation failed'));
          }
        }
      };

      // Also listen for the session to be removed from activeSessions (which happens when execution completes)
      const checkCompletion = setInterval(() => {
        if (!this.activeSessions.has(executionId)) {
          logger.info('Compact session no longer active, assuming completion', { executionId });
          clearTimeout(timeout);
          clearInterval(checkCompletion);
          this.eventEmitter.off(Events.PROCESS_EXIT, completionHandler);
          resolve();
        }
      }, 1000); // Check every second

      this.eventEmitter.on(Events.PROCESS_EXIT, completionHandler);
    });
  }

  /**
   * Compact conversation and retry with original message
   */
  async compactAndRetry(executionId, originalMessage, sessionId) {
    const timestamp = new Date().toISOString();
    
    try {
      // Log compacting start to database for frontend display
      const compactStartMessage = {
        type: 'assistant',
        message: {
          id: `msg_compact_start_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-code-system',
          content: [{
            type: 'text',
            text: '🔄 Compacting conversation to reduce context length...'
          }],
          stop_reason: null,
          stop_sequence: null,
          usage: null
        },
        parent_tool_use_id: null,
        session_id: sessionId
      };
      
      await this.db.run(
        'INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)',
        [executionId, LogType.SYSTEM, JSON.stringify(compactStartMessage)]
      );
      
      // Emit for SSE streaming
      this.eventEmitter.emit(Events.LOG_ENTRY, {
        executionId,
        timestamp,
        type: LogType.SYSTEM,
        content: JSON.stringify(compactStartMessage)
      });
      
      logger.info('Starting conversation compact', { executionId, action: 'compact_start' });
      
      // Send /compact command
      logger.info('Sending /compact command', { executionId, sessionId });
      await this.startExecution(executionId, '/compact', null, { 
        sessionId: sessionId,
        isCompact: true 
      });
      
      logger.info('Compact command sent, waiting for completion...', { executionId });
      
      // Wait for compact to complete
      await this.waitForCompactCompletion(executionId);
      
      logger.info('Compact wait completed', { executionId });
      
      // Log completion
      const compactCompleteMessage = {
        type: 'assistant',
        message: {
          id: `msg_compact_complete_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-code-system',
          content: [{
            type: 'text',
            text: '✅ Conversation compacted successfully. Sending original message...'
          }],
          stop_reason: null,
          stop_sequence: null,
          usage: null
        },
        parent_tool_use_id: null,
        session_id: sessionId
      };
      
      await this.db.run(
        'INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)',
        [executionId, LogType.SYSTEM, JSON.stringify(compactCompleteMessage)]
      );
      
      this.eventEmitter.emit(Events.LOG_ENTRY, {
        executionId,
        timestamp: new Date().toISOString(),
        type: LogType.SYSTEM,
        content: JSON.stringify(compactCompleteMessage)
      });
      
      logger.info('Compact completed, sending original message', { executionId, action: 'compact_complete' });
      
      // Send original message after compact
      await this.startExecution(executionId, originalMessage, null, { sessionId: sessionId });
      
    } catch (error) {
      logger.error('Compact and retry failed', { executionId, error });
      
      // Log error to database
      const errorMessage = {
        type: 'assistant',
        message: {
          id: `msg_compact_error_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-code-system',
          content: [{
            type: 'text',
            text: `❌ Compact failed: ${error.message}`
          }],
          stop_reason: null,
          stop_sequence: null,
          usage: null
        },
        parent_tool_use_id: null,
        session_id: sessionId
      };
      
      await this.db.run(
        'INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)',
        [executionId, LogType.SYSTEM, JSON.stringify(errorMessage)]
      );
      
      this.eventEmitter.emit(Events.LOG_ENTRY, {
        executionId,
        timestamp: new Date().toISOString(),
        type: LogType.SYSTEM,
        content: JSON.stringify(errorMessage)
      });
      
      throw error;
    }
  }

  async updateExecutionStatus(executionId, status) {
    const updates = ['status = ?'];
    const params = [status];

    if (status === ExecutionStatus.COMPLETED || status === ExecutionStatus.FAILED) {
      updates.push('completed_at = CURRENT_TIMESTAMP');
    }

    params.push(executionId);

    await this.db.run(
      `UPDATE executions SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  }

  async handleExecutionComplete(executionId, result) {
    logger.info('Execution completed', { 
      executionId, 
      turns: result.num_turns,
      duration: result.duration_ms,
      cost: result.total_cost_usd 
    });

    // Add comprehensive logging to debug prompt length detection
    logger.info('DEBUG: Complete result object structure', {
      executionId,
      resultKeys: Object.keys(result),
      resultType: typeof result,
      isError: result.is_error,
      hasResult: !!result.result,
      resultValueType: typeof result.result,
      resultContent: result.result ? result.result.toString().substring(0, 200) : 'null',
      resultIncludes: result.result ? result.result.toLowerCase().includes('prompt is too long') : false,
      fullResult: JSON.stringify(result, null, 2)
    });

    // Check if this is a "Prompt is too long" error
    const isPromptTooLong = result.is_error && 
                           result.result && 
                           result.result.toLowerCase().includes('prompt is too long');

    logger.info('DEBUG: Prompt too long check', {
      executionId,
      isPromptTooLong,
      isError: result.is_error,
      hasResult: !!result.result,
      resultLowerCase: result.result ? result.result.toLowerCase() : 'null'
    });

    if (isPromptTooLong) {
      logger.warn('Detected prompt too long error, attempting compact and retry', { executionId });
      
      // Get the original message that caused this issue
      const originalMessage = this.pendingMessages.get(executionId);
      
      if (originalMessage) {
        try {
          // Get execution details for session ID
          const execution = await this.db.get(
            'SELECT session_id FROM executions WHERE id = ?',
            [executionId]
          );
          
          if (execution && execution.session_id) {
            // Clean up current tracking
            this.activeSessions.delete(executionId);
            this.pendingMessages.delete(executionId);
            
            // Attempt compact and retry
            await this.compactAndRetry(executionId, originalMessage, execution.session_id);
            return; // Don't complete the execution yet
          }
        } catch (error) {
          logger.error('Failed to compact and retry', { executionId, error });
          // Fall through to normal completion handling
        }
      }
    }

    // Clean up pending message
    this.pendingMessages.delete(executionId);

    // Update execution with completion details
    await this.db.run(
      `UPDATE executions SET 
        status = ?, 
        completed_at = CURRENT_TIMESTAMP,
        message_count = ?,
        total_cost = ?
      WHERE id = ?`,
      [ExecutionStatus.COMPLETED, result.num_turns, result.total_cost_usd, executionId]
    );

    // Note: ready_for_preview phase is now emitted earlier for create refs

    // Emit completion event
    this.eventEmitter.emit(Events.PROCESS_EXIT, { 
      executionId, 
      code: 0, 
      signal: null,
      result 
    });

    // Clean up
    this.activeSessions.delete(executionId);
  }

  async handleExecutionError(executionId, error) {
    logger.error('Execution error', { executionId, error });
    
    await this.updateExecutionStatus(executionId, ExecutionStatus.FAILED);
    
    await this.db.run(
      'INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)',
      [executionId, LogType.SYSTEM, `Execution error: ${error.message}`]
    );

    // Note: ready_for_preview phase is now emitted earlier for create refs

    this.eventEmitter.emit(Events.PROCESS_ERROR, { executionId, error });
    
    // Clean up
    this.activeSessions.delete(executionId);
    this.pendingMessages.delete(executionId);
  }

  /**
   * Resume a Claude SDK session after server restart
   */
  async resumeSession(executionId, sessionId) {
    logger.info('Resuming Claude SDK session', { executionId, sessionId });
    
    try {
      // Get execution details
      const execution = await this.db.get(
        'SELECT * FROM executions WHERE id = ?',
        [executionId]
      );
      
      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }
      
      // Get the execution workspace directory
      const workspacePath = this.workspaceManager ? this.workspaceManager.getWorkspacePath() : process.cwd();
      const executionCwd = path.join(workspacePath, '.execution', `exec-${executionId}`);
      
      // Create a placeholder prompt for resumption
      const resumePrompt = 'Resuming session after server restart. Continue with the current task.';
      
      // Start execution with the session ID
      await this.startExecution(executionId, resumePrompt, executionCwd, {
        sessionId: sessionId,
        maxTurns: 50, // Allow more turns for resumed sessions
        isResume: true // Flag this as a session resumption
      });
      
      logger.info('Successfully resumed session', { executionId, sessionId });
      return true;
    } catch (error) {
      logger.error('Failed to resume session', { executionId, sessionId, error });
      
      // Update execution status to failed if resume fails
      await this.updateExecutionStatus(executionId, ExecutionStatus.FAILED);
      
      throw error;
    }
  }
}

export default ClaudeSDKManager;