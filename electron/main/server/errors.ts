import { ErrorCodes, ErrorCode } from './constants.js';

export class ValidationError extends Error {
  name = 'ValidationError';
  code: ErrorCode;
  details: Record<string, any>;

  constructor(message: string, details: Record<string, any> = {}) {
    super(message);
    this.code = ErrorCodes.VALIDATION_ERROR;
    this.details = details;
  }
}

export class NotFoundError extends Error {
  name = 'NotFoundError';
  code: ErrorCode;

  constructor(message: string) {
    super(message);
    this.code = ErrorCodes.EXECUTION_NOT_FOUND;
  }
}

export class ProcessError extends Error {
  name = 'ProcessError';
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class FileSystemError extends Error {
  name = 'FileSystemError';
  code: ErrorCode;
  path: string;
  details: Record<string, any>;

  constructor(code: ErrorCode, message: string, path: string, details: Record<string, any> = {}) {
    super(message);
    this.code = code;
    this.path = path;
    this.details = { ...details, path };
  }
}

export class FileNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(
      ErrorCodes.FILE_NOT_FOUND,
      `File not found: ${path}`,
      path
    );
  }
}

export class DirectoryNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(
      ErrorCodes.DIRECTORY_NOT_FOUND,
      `Directory not found: ${path}`,
      path
    );
  }
}

export class PathTraversalError extends FileSystemError {
  constructor(path: string) {
    super(
      ErrorCodes.PATH_TRAVERSAL_ATTEMPT,
      `Path traversal attempt detected: ${path}`,
      path
    );
  }
}

export class FileTooLargeError extends FileSystemError {
  constructor(path: string, size: number, maxSize: number) {
    super(
      ErrorCodes.FILE_TOO_LARGE,
      `File ${path} exceeds maximum size of ${maxSize} bytes`,
      path,
      { size, maxSize }
    );
  }
}

export class FileExistsError extends FileSystemError {
  constructor(path: string) {
    super(
      ErrorCodes.FILE_EXISTS,
      `File already exists: ${path}`,
      path
    );
  }
}

export class DirectoryNotEmptyError extends FileSystemError {
  constructor(path: string) {
    super(
      ErrorCodes.DIRECTORY_NOT_EMPTY,
      `Directory is not empty: ${path}`,
      path
    );
  }
}

export class InvalidEncodingError extends FileSystemError {
  constructor(encoding: string, path: string) {
    super(
      ErrorCodes.INVALID_ENCODING,
      `Invalid encoding '${encoding}' for file: ${path}`,
      path,
      { encoding }
    );
  }
}

export class PermissionDeniedError extends FileSystemError {
  constructor(path: string, operation: string) {
    super(
      ErrorCodes.PERMISSION_DENIED,
      `Permission denied for ${operation} on: ${path}`,
      path,
      { operation }
    );
  }
}

interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, any>;
  };
}

export function createErrorResponse(error: any): ErrorResponse {
  const response: ErrorResponse = {
    error: {
      code: error.code || ErrorCodes.INTERNAL_ERROR,
      message: error.message
    }
  };

  if (error.details) {
    response.error.details = error.details;
  }

  return response;
}