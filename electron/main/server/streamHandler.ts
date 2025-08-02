import { Events, Limits, LogType, LogTypeValue } from './constants.js';
import { createLogger } from './logger.js';
import type { Database } from './db.js';
import { EventEmitter } from 'node:events';

const logger = createLogger('StreamHandler');

interface LogEntry {
  timestamp: string;
  type: LogTypeValue;
  content: string;
}

export class StreamHandler {
  private db: Database;
  private eventEmitter: EventEmitter;
  private buffers: Map<string, string>;

  constructor(db: Database, eventEmitter: EventEmitter) {
    this.db = db;
    this.eventEmitter = eventEmitter;
    this.buffers = new Map();
  }

  async handleOutput(executionId: string, stream: LogTypeValue, data: Buffer): Promise<void> {
    try {
      const content = data.toString('utf8');
      
      // Log output in verbose mode
      if (process.env.SHOW_PROCESS_OUTPUT === 'true') {
        logger.debug(`Process ${stream}`, { executionId, content: content.trim() });
      }
      
      // Append to buffer
      this.appendToBuffer(executionId, content);
      
      // Process complete lines
      await this.processCompleteLines(executionId, stream);
      
    } catch (error) {
      logger.error(`Error handling output`, { executionId, error });
    }
  }

  private appendToBuffer(executionId: string, data: string): void {
    let buffer = this.buffers.get(executionId) || '';
    buffer += data;
    
    // Check buffer size limit
    if (buffer.length > Limits.MAX_BUFFER_SIZE) {
      logger.warn(`Buffer size exceeded, truncating`, { executionId, size: buffer.length });
      buffer = buffer.slice(-Limits.MAX_BUFFER_SIZE);
    }
    
    this.buffers.set(executionId, buffer);
  }

  private async processCompleteLines(executionId: string, streamType: LogTypeValue): Promise<void> {
    let buffer = this.buffers.get(executionId) || '';
    const lines = buffer.split('\n');
    
    // Keep the last incomplete line in the buffer
    const incomplete = lines.pop() || '';
    this.buffers.set(executionId, incomplete);
    
    // Process complete lines
    for (const line of lines) {
      if (line.length > 0) {
        await this.saveLog(executionId, streamType, line);
        this.emitLogEvent(executionId, {
          timestamp: new Date().toISOString(),
          type: streamType,
          content: line
        });
      }
    }
  }

  async flushBuffer(executionId: string): Promise<void> {
    const buffer = this.buffers.get(executionId);
    
    if (buffer && buffer.length > 0) {
      logger.debug(`Flushing buffer`, { executionId, length: buffer.length });
      // Save any remaining content
      await this.saveLog(executionId, LogType.STDOUT, buffer);
      this.emitLogEvent(executionId, {
        timestamp: new Date().toISOString(),
        type: LogType.STDOUT,
        content: buffer
      });
    }
    
    this.clearBuffer(executionId);
  }

  clearBuffer(executionId: string): void {
    this.buffers.delete(executionId);
  }

  private async saveLog(executionId: string, type: LogTypeValue, content: string): Promise<void> {
    try {
      // Truncate content if too long
      const truncatedContent = content.length > Limits.MAX_LINE_LENGTH
        ? content.substring(0, Limits.MAX_LINE_LENGTH) + '... [truncated]'
        : content;
      
      await this.db.run(
        'INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)',
        [executionId, type, truncatedContent]
      );
    } catch (error) {
      logger.error(`Failed to save log`, { executionId, error });
    }
  }

  private emitLogEvent(executionId: string, logEntry: LogEntry): void {
    this.eventEmitter.emit(Events.LOG_ENTRY, {
      executionId,
      ...logEntry
    });
  }

  parseOutput(data: Buffer): string {
    // Basic parsing - can be extended for specific formats
    return data.toString('utf8').trim();
  }
}

export default StreamHandler;