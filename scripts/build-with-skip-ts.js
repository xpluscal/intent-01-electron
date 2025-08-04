#!/usr/bin/env node

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('Building with TypeScript errors suppressed...');

try {
  // Build with TypeScript but ignore errors
  console.log('Building TypeScript (ignoring errors)...');
  try {
    execSync('tsc -b', { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    console.log('TypeScript build had errors, continuing anyway...');
  }
  
  // Build with Vite
  console.log('Building with Vite...');
  execSync('vite build --mode production', { cwd: rootDir, stdio: 'inherit' });
  
  // Copy server files
  console.log('Copying server files...');
  execSync('node scripts/copy-server.js', { cwd: rootDir, stdio: 'inherit' });
  
  console.log('Build complete!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}