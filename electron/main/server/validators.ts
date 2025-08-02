import { ValidationError } from './errors.js';
import path from 'node:path';
import fs from 'node:fs';

export function validateAgent(agent: any): string {
  if (!agent) {
    throw new ValidationError('Agent type is required', { field: 'agent' });
  }
  
  if (!['claude', 'gemini'].includes(agent)) {
    throw new ValidationError(
      "Invalid agent type. Must be 'claude' or 'gemini'",
      { field: 'agent', value: agent }
    );
  }
  
  return agent;
}

export function validatePrompt(prompt: any): string {
  if (!prompt || typeof prompt !== 'string') {
    throw new ValidationError('Prompt is required and must be a string', { field: 'prompt' });
  }
  
  if (prompt.trim().length === 0) {
    throw new ValidationError('Prompt cannot be empty', { field: 'prompt' });
  }
  
  return prompt.trim();
}

export function validateWorkingDir(workingDir: any): string | null {
  if (!workingDir) {
    return null; // Optional field
  }
  
  if (typeof workingDir !== 'string') {
    throw new ValidationError('Working directory must be a string', { field: 'workingDir' });
  }
  
  const absPath = path.resolve(workingDir);
  
  if (!fs.existsSync(absPath)) {
    throw new ValidationError(`Working directory does not exist: ${absPath}`, { 
      field: 'workingDir',
      path: absPath 
    });
  }
  
  if (!fs.statSync(absPath).isDirectory()) {
    throw new ValidationError(`Path is not a directory: ${absPath}`, { 
      field: 'workingDir',
      path: absPath 
    });
  }
  
  return absPath;
}

export function validateExecutionId(executionId: any): string {
  if (!executionId || typeof executionId !== 'string') {
    throw new ValidationError('Execution ID is required', { field: 'executionId' });
  }
  
  // Basic UUID v4 validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(executionId)) {
    throw new ValidationError('Invalid execution ID format', { 
      field: 'executionId',
      value: executionId 
    });
  }
  
  return executionId;
}

export function validateMessage(message: any): string {
  if (!message || typeof message !== 'string') {
    throw new ValidationError('Message is required and must be a string', { field: 'message' });
  }
  
  if (message.trim().length === 0) {
    throw new ValidationError('Message cannot be empty', { field: 'message' });
  }
  
  if (message.length > 100000) {
    throw new ValidationError('Message is too long (max 100000 characters)', { 
      field: 'message', 
      length: message.length 
    });
  }
  
  return message.trim();
}

// Export all validators as a namespace for backward compatibility
export const validators = {
  validateAgent,
  validatePrompt,
  validateWorkingDir,
  validateExecutionId,
  validateMessage
};

// Re-export ValidationError for convenience
export { ValidationError } from './errors.js';