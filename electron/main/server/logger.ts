import { config } from './config.js';

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

export class Logger {
  private name: string;
  private level: number;

  constructor(name: string) {
    this.name = name;
    this.level = LOG_LEVELS[config.logging.level as LogLevel] || LOG_LEVELS.info;
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.name}]`;
    
    // Handle objects and errors specially
    const formattedArgs = args.map(arg => {
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack}`;
      }
      if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2);
      }
      return arg;
    });

    return `${prefix} ${message} ${formattedArgs.join(' ')}`.trim();
  }

  private log(level: LogLevel, message: string, ...args: any[]): void {
    if (LOG_LEVELS[level] <= this.level) {
      const formatted = this.formatMessage(level, message, ...args);
      
      if (level === 'error') {
        console.error(formatted);
      } else if (level === 'warn') {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    }
  }

  error(message: string, ...args: any[]): void {
    this.log('error', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log('warn', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log('info', message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.log('debug', message, ...args);
  }
}

// Factory function to create loggers
export function createLogger(name: string): Logger {
  return new Logger(name);
}