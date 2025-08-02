// Event names
export const Events = {
  PROCESS_START: 'process:start',
  PROCESS_EXIT: 'process:exit',
  PROCESS_ERROR: 'process:error',
  LOG_ENTRY: 'log:entry',
  BUFFER_FLUSH: 'buffer:flush'
} as const;

// State transitions
export const ValidTransitions: Record<string, string[]> = {
  'starting': ['running', 'failed'],
  'running': ['completed', 'failed'],
  'completed': [],  // terminal state
  'failed': []      // terminal state
};

// Resource limits
export const Limits = {
  MAX_BUFFER_SIZE: 1024 * 1024,  // 1MB per execution
  MAX_LINE_LENGTH: 10000,         // 10KB per line
  SPAWN_TIMEOUT: 5000             // 5s to start process
} as const;

// Error codes
export const ErrorCodes = {
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_AGENT: 'INVALID_AGENT',
  INVALID_PROMPT: 'INVALID_PROMPT',
  INVALID_PATH: 'INVALID_PATH',
  
  // Not Found
  EXECUTION_NOT_FOUND: 'EXECUTION_NOT_FOUND',
  
  // Process
  SPAWN_FAILED: 'SPAWN_FAILED',
  PROCESS_NOT_RUNNING: 'PROCESS_NOT_RUNNING',
  PROCESS_TERMINATED: 'PROCESS_TERMINATED',
  
  // System
  DATABASE_ERROR: 'DATABASE_ERROR',
  FILESYSTEM_ERROR: 'FILESYSTEM_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  
  // File operations
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  DIRECTORY_NOT_FOUND: 'DIRECTORY_NOT_FOUND',
  PATH_TRAVERSAL_ATTEMPT: 'PATH_TRAVERSAL_ATTEMPT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_ENCODING: 'INVALID_ENCODING',
  DIRECTORY_NOT_EMPTY: 'DIRECTORY_NOT_EMPTY',
  FILE_EXISTS: 'FILE_EXISTS',
  INVALID_FILE_OPERATION: 'INVALID_FILE_OPERATION'
} as const;

// Execution statuses
export const ExecutionStatus = {
  STARTING: 'starting',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
} as const;

// Log types
export const LogType = {
  STDOUT: 'stdout',
  STDERR: 'stderr',
  SYSTEM: 'system'
} as const;

// File operations
export const FileOperations = {
  READ: 'read',
  WRITE: 'write',
  CREATE: 'create',
  DELETE: 'delete',
  MOVE: 'move',
  COPY: 'copy',
  LIST: 'list',
  SEARCH: 'search'
} as const;

// File types
export const FileTypes = {
  FILE: 'file',
  DIRECTORY: 'directory',
  ALL: 'all'
} as const;

// Encoding types
export const FileEncodings = {
  UTF8: 'utf8',
  BASE64: 'base64',
  BINARY: 'binary'
} as const;

// Search types
export const SearchTypes = {
  FILENAME: 'filename',
  CONTENT: 'content',
  BOTH: 'both'
} as const;

// File operation limits
export const FileLimits = {
  MAX_FILE_SIZE: 10 * 1024 * 1024,    // 10MB default
  MAX_PATH_LENGTH: 255,                // Maximum path length
  MAX_SEARCH_RESULTS: 100,             // Default search results limit
  DEFAULT_LIST_LIMIT: 1000,            // Default directory listing limit
  MAX_LINE_LENGTH: 10000               // Maximum line length for partial reads
} as const;

// Type exports
export type EventType = typeof Events[keyof typeof Events];
export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
export type ExecutionStatusType = typeof ExecutionStatus[keyof typeof ExecutionStatus];
export type LogTypeValue = typeof LogType[keyof typeof LogType];
export type FileOperation = typeof FileOperations[keyof typeof FileOperations];
export type FileType = typeof FileTypes[keyof typeof FileTypes];
export type FileEncoding = typeof FileEncodings[keyof typeof FileEncodings];
export type SearchType = typeof SearchTypes[keyof typeof SearchTypes];