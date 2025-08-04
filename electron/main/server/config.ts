import path from 'node:path';

// Only load dotenv in development mode
// In production (packaged app), environment variables should be baked in during build time
// Check if we're in a packaged app by looking for app.asar
const isPackaged = process.resourcesPath?.includes('app.asar') || process.env.NODE_ENV === 'production';

if (!isPackaged) {
  try {
    // Use dynamic import to avoid bundling dotenv in production
    import('dotenv').then((dotenv) => {
      dotenv.config();
      console.log('[config] Loaded .env file in development mode');
    }).catch(() => {
      // .env file is optional
    });
  } catch (err) {
    // .env file is optional
  }
}

interface ServerConfig {
  port: number;
  corsOrigins: string[];
}

interface WorkspaceConfig {
  path: string;
  cleanupAge: number;
  maxConcurrent: number;
}

interface DatabaseConfig {
  path: string;
}

interface AgentConfig {
  command: string;
  defaultArgs: string[];
}

interface AgentsConfig {
  claude: AgentConfig;
  gemini: AgentConfig;
  [key: string]: AgentConfig;
}

interface ExecutionConfig {
  defaultWorkingDir: string;
  maxConcurrentExecutions: number;
  processTimeout: number;
}

interface LoggingConfig {
  level: string;
  maxLogLength: number;
}

interface StreamingConfig {
  heartbeatInterval: number;
  maxBufferSize: number;
}

export interface Config {
  server: ServerConfig;
  workspace: WorkspaceConfig;
  database: DatabaseConfig;
  agents: AgentsConfig;
  execution: ExecutionConfig;
  logging: LoggingConfig;
  streaming: StreamingConfig;
}

export const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3010'),
    corsOrigins: process.env.CORS_ORIGINS 
      ? process.env.CORS_ORIGINS.split(',') 
      : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'https://intentos.me', 'https://www.intentos.me']
  },
  workspace: {
    // Workspace can be set via CLI arg, env var, or config
    path: process.env.WORKSPACE_DIR || './workspace',
    // Auto-cleanup executions older than this (in hours)
    cleanupAge: process.env.WORKSPACE_CLEANUP_AGE !== undefined 
      ? parseInt(process.env.WORKSPACE_CLEANUP_AGE) 
      : 24,
    // Maximum concurrent executions
    maxConcurrent: process.env.WORKSPACE_MAX_CONCURRENT !== undefined
      ? parseInt(process.env.WORKSPACE_MAX_CONCURRENT)
      : 10
  },
  database: {
    // Database path is now relative to workspace/data by default
    // Can be overridden with absolute path
    path: process.env.DB_PATH || 'agent-wrapper.db'
  },
  agents: {
    claude: {
      command: process.env.CLAUDE_COMMAND || 'claude',
      defaultArgs: [
        '--dangerously-skip-permissions',
        '--verbose',
        '--output-format',
        'stream-json'
      ]
    },
    gemini: {
      command: process.env.GEMINI_COMMAND || 'gemini',
      defaultArgs: []
    }
  },
  execution: {
    defaultWorkingDir: process.cwd(),
    maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '10'),
    processTimeout: parseInt(process.env.PROCESS_TIMEOUT || '0') // 0 = no timeout
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxLogLength: parseInt(process.env.MAX_LOG_LENGTH || '10000')
  },
  streaming: {
    heartbeatInterval: parseInt(process.env.SSE_HEARTBEAT_INTERVAL || '30000'), // 30 seconds
    maxBufferSize: parseInt(process.env.MAX_BUFFER_SIZE || '65536') // 64KB
  }
};

// Validate configuration
function validateConfig(): boolean {
  if (config.server.port < 1 || config.server.port > 65535) {
    throw new Error(`Invalid port number: ${config.server.port}`);
  }

  if (!['claude', 'gemini'].every(agent => config.agents[agent])) {
    throw new Error('Missing agent configuration');
  }

  if (config.execution.maxConcurrentExecutions < 1) {
    throw new Error('maxConcurrentExecutions must be at least 1');
  }

  if (config.workspace.cleanupAge < 0) {
    throw new Error('workspace.cleanupAge must be non-negative');
  }

  if (config.workspace.maxConcurrent < 1) {
    throw new Error('workspace.maxConcurrent must be at least 1');
  }

  return true;
}

// Validate on module load
validateConfig();

export default config;