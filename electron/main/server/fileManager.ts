import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mimeTypes from 'mime-types';

const mime = mimeTypes || {
  lookup: (filename) => {
    const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.css': 'text/css',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown'
      };
      return mimeTypes[ext] || 'application/octet-stream';
    }
  };
import { createLogger } from './logger.js';
import {
  FileOperations,
  FileTypes,
  FileEncodings,
  SearchTypes,
  FileLimits,
  ErrorCodes
} from './constants.js';
import {
  FileNotFoundError,
  DirectoryNotFoundError,
  PathTraversalError,
  FileTooLargeError,
  FileExistsError,
  DirectoryNotEmptyError,
  InvalidEncodingError,
  PermissionDeniedError,
  ValidationError,
  NotFoundError
} from './errors.js';

const logger = createLogger('file-manager');

class FileManager {
  constructor(db) {
    this.db = db;
  }

  async validatePath(executionId, relativePath) {
    const execution = await this.db.get(
      'SELECT working_dir FROM executions WHERE id = ?',
      [executionId]
    );

    if (!execution) {
      throw new NotFoundError(`Execution ${executionId} not found`);
    }

    if (!relativePath) {
      relativePath = '';
    }

    if (typeof relativePath !== 'string') {
      throw new ValidationError('Path must be a string');
    }

    const normalizedPath = path.normalize(relativePath);
    
    if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
      throw new PathTraversalError(relativePath);
    }

    const absolutePath = path.join(execution.working_dir, normalizedPath);
    
    if (!absolutePath.startsWith(execution.working_dir)) {
      throw new PathTraversalError(relativePath);
    }

    return {
      absolutePath,
      relativePath: normalizedPath,
      workingDir: execution.working_dir
    };
  }

  async logOperation(executionId, operation, filePath, targetPath = null, success = true, errorMessage = null, size = null) {
    try {
      await this.db.run(
        `INSERT INTO file_operations (execution_id, operation, path, target_path, size, success, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [executionId, operation, filePath, targetPath, size, success ? 1 : 0, errorMessage]
      );
    } catch (error) {
      logger.error('Failed to log file operation:', error);
    }
  }

  async listDirectory(executionId, relativePath = '', options = {}) {
    const { absolutePath, workingDir } = await this.validatePath(executionId, relativePath);
    
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        throw new ValidationError(`Path is not a directory: ${relativePath}`);
      }

      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      const items = [];

      for (const entry of entries) {
        const entryPath = path.join(absolutePath, entry.name);
        const entryRelativePath = path.relative(workingDir, entryPath);
        
        if (options.pattern) {
          const isMatch = (name, pattern) => {
            const regexPattern = pattern
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.');
            const regex = new RegExp(`^${regexPattern}$`);
            return regex.test(name);
          };
          
          if (!isMatch(entry.name, options.pattern)) {
            continue;
          }
        }

        const isDirectory = entry.isDirectory();
        const type = isDirectory ? FileTypes.DIRECTORY : FileTypes.FILE;

        if (options.type && options.type !== FileTypes.ALL && options.type !== type) {
          continue;
        }

        const item = {
          name: entry.name,
          path: entryRelativePath,
          type: type
        };

        if (options.details) {
          try {
            const stats = await fs.stat(entryPath);
            item.size = isDirectory ? null : stats.size;
            item.modified = stats.mtime.toISOString();
            item.permissions = stats.mode.toString(8).slice(-3);

            if (isDirectory) {
              const childEntries = await fs.readdir(entryPath);
              item.children = childEntries.length;
            } else {
              item.mimeType = mime.lookup(entry.name) || 'application/octet-stream';
            }
          } catch (error) {
            logger.warn(`Failed to get stats for ${entryPath}:`, error);
          }
        }

        items.push(item);
      }

      if (options.recursive && !options.pattern) {
        for (const item of items) {
          if (item.type === FileTypes.DIRECTORY) {
            const subItems = await this.listDirectory(
              executionId,
              item.path,
              { ...options, recursive: true }
            );
            items.push(...subItems.items);
          }
        }
      }

      await this.logOperation(executionId, FileOperations.LIST, relativePath);

      return {
        executionId,
        basePath: workingDir,
        currentPath: relativePath,
        items: items.slice(0, options.limit || FileLimits.DEFAULT_LIST_LIMIT),
        totalItems: items.length,
        hasMore: items.length > (options.limit || FileLimits.DEFAULT_LIST_LIMIT)
      };
    } catch (error) {
      await this.logOperation(executionId, FileOperations.LIST, relativePath, null, false, error.message);
      
      if (error.code === 'ENOENT') {
        throw new DirectoryNotFoundError(relativePath);
      } else if (error.code === 'EACCES') {
        throw new PermissionDeniedError(relativePath, FileOperations.LIST);
      }
      throw error;
    }
  }

  async readFile(executionId, relativePath, options = {}) {
    const { absolutePath } = await this.validatePath(executionId, relativePath);
    
    try {
      const stats = await fs.stat(absolutePath);
      
      if (!stats.isFile()) {
        throw new ValidationError(`Path is not a file: ${relativePath}`);
      }

      if (stats.size > FileLimits.MAX_FILE_SIZE) {
        throw new FileTooLargeError(relativePath, stats.size, FileLimits.MAX_FILE_SIZE);
      }

      const encoding = options.encoding || FileEncodings.UTF8;
      
      if (!Object.values(FileEncodings).includes(encoding)) {
        throw new InvalidEncodingError(encoding, relativePath);
      }

      let content;
      
      if (options.lineStart !== undefined || options.lineEnd !== undefined) {
        content = await this.readPartialFile(absolutePath, options.lineStart, options.lineEnd, encoding);
      } else {
        if (encoding === FileEncodings.BINARY) {
          content = await fs.readFile(absolutePath);
        } else {
          content = await fs.readFile(absolutePath, encoding);
        }
      }

      if (encoding === FileEncodings.BINARY || encoding === FileEncodings.BASE64) {
        content = content.toString('base64');
      }

      await this.logOperation(executionId, FileOperations.READ, relativePath, null, true, null, stats.size);

      return {
        executionId,
        path: relativePath,
        content,
        encoding: encoding === FileEncodings.BINARY ? FileEncodings.BASE64 : encoding,
        size: stats.size,
        lines: encoding === FileEncodings.UTF8 ? content.split('\n').length : undefined,
        mimeType: mime.lookup(relativePath) || 'application/octet-stream',
        modified: stats.mtime.toISOString()
      };
    } catch (error) {
      await this.logOperation(executionId, FileOperations.READ, relativePath, null, false, error.message);
      
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(relativePath);
      } else if (error.code === 'EACCES') {
        throw new PermissionDeniedError(relativePath, FileOperations.READ);
      }
      throw error;
    }
  }

  async readPartialFile(absolutePath, lineStart = 1, lineEnd, encoding) {
    const content = await fs.readFile(absolutePath, encoding);
    const lines = content.split('\n');
    
    const start = Math.max(0, lineStart - 1);
    const end = lineEnd ? Math.min(lines.length, lineEnd) : lines.length;
    
    return lines.slice(start, end).join('\n');
  }

  async writeFile(executionId, relativePath, content, options = {}) {
    const { absolutePath } = await this.validatePath(executionId, relativePath);
    
    try {
      const encoding = options.encoding || FileEncodings.UTF8;
      
      if (!Object.values(FileEncodings).includes(encoding)) {
        throw new InvalidEncodingError(encoding, relativePath);
      }

      const exists = await fs.access(absolutePath).then(() => true).catch(() => false);
      
      if (!exists && !options.createIfNotExists) {
        throw new FileNotFoundError(relativePath);
      }

      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });

      let dataToWrite = content;
      
      if (encoding === FileEncodings.BASE64) {
        dataToWrite = Buffer.from(content, 'base64');
      }

      await fs.writeFile(absolutePath, dataToWrite, encoding === FileEncodings.BASE64 ? undefined : encoding);
      
      const stats = await fs.stat(absolutePath);
      
      await this.logOperation(executionId, FileOperations.WRITE, relativePath, null, true, null, stats.size);

      return {
        success: true,
        path: relativePath,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        created: !exists
      };
    } catch (error) {
      await this.logOperation(executionId, FileOperations.WRITE, relativePath, null, false, error.message);
      
      if (error.code === 'EACCES') {
        throw new PermissionDeniedError(relativePath, FileOperations.WRITE);
      }
      throw error;
    }
  }

  async createItem(executionId, relativePath, type, content = '', encoding = FileEncodings.UTF8) {
    const { absolutePath } = await this.validatePath(executionId, relativePath);
    
    try {
      const exists = await fs.access(absolutePath).then(() => true).catch(() => false);
      
      if (exists) {
        throw new FileExistsError(relativePath);
      }

      if (type === FileTypes.DIRECTORY) {
        await fs.mkdir(absolutePath, { recursive: true });
      } else {
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        
        let dataToWrite = content;
        if (encoding === FileEncodings.BASE64) {
          dataToWrite = Buffer.from(content, 'base64');
        }
        
        await fs.writeFile(absolutePath, dataToWrite, encoding === FileEncodings.BASE64 ? undefined : encoding);
      }

      await this.logOperation(executionId, FileOperations.CREATE, relativePath);

      return {
        success: true,
        path: relativePath,
        type,
        created: new Date().toISOString()
      };
    } catch (error) {
      await this.logOperation(executionId, FileOperations.CREATE, relativePath, null, false, error.message);
      
      if (error.code === 'EACCES') {
        throw new PermissionDeniedError(relativePath, FileOperations.CREATE);
      }
      throw error;
    }
  }

  async deleteItem(executionId, relativePath, recursive = false) {
    const { absolutePath } = await this.validatePath(executionId, relativePath);
    
    try {
      const stats = await fs.stat(absolutePath);
      const isDirectory = stats.isDirectory();

      if (isDirectory) {
        if (!recursive) {
          const entries = await fs.readdir(absolutePath);
          if (entries.length > 0) {
            throw new DirectoryNotEmptyError(relativePath);
          }
        }
        await fs.rm(absolutePath, { recursive, force: true });
      } else {
        await fs.unlink(absolutePath);
      }

      await this.logOperation(executionId, FileOperations.DELETE, relativePath);

      return {
        success: true,
        path: relativePath,
        type: isDirectory ? FileTypes.DIRECTORY : FileTypes.FILE,
        deleted: new Date().toISOString()
      };
    } catch (error) {
      await this.logOperation(executionId, FileOperations.DELETE, relativePath, null, false, error.message);
      
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(relativePath);
      } else if (error.code === 'EACCES') {
        throw new PermissionDeniedError(relativePath, FileOperations.DELETE);
      }
      throw error;
    }
  }

  async moveItem(executionId, sourcePath, targetPath, overwrite = false) {
    const { absolutePath: sourceAbsolute } = await this.validatePath(executionId, sourcePath);
    const { absolutePath: targetAbsolute } = await this.validatePath(executionId, targetPath);
    
    try {
      const sourceExists = await fs.access(sourceAbsolute).then(() => true).catch(() => false);
      if (!sourceExists) {
        throw new FileNotFoundError(sourcePath);
      }

      const targetExists = await fs.access(targetAbsolute).then(() => true).catch(() => false);
      if (targetExists && !overwrite) {
        throw new FileExistsError(targetPath);
      }

      const targetDir = path.dirname(targetAbsolute);
      await fs.mkdir(targetDir, { recursive: true });

      await fs.rename(sourceAbsolute, targetAbsolute);

      await this.logOperation(executionId, FileOperations.MOVE, sourcePath, targetPath);

      return {
        success: true,
        sourcePath,
        targetPath,
        moved: new Date().toISOString()
      };
    } catch (error) {
      await this.logOperation(executionId, FileOperations.MOVE, sourcePath, targetPath, false, error.message);
      
      if (error.code === 'EACCES') {
        throw new PermissionDeniedError(sourcePath, FileOperations.MOVE);
      }
      throw error;
    }
  }

  async copyItem(executionId, sourcePath, targetPath, overwrite = false) {
    const { absolutePath: sourceAbsolute } = await this.validatePath(executionId, sourcePath);
    const { absolutePath: targetAbsolute } = await this.validatePath(executionId, targetPath);
    
    try {
      const sourceStats = await fs.stat(sourceAbsolute);
      
      const targetExists = await fs.access(targetAbsolute).then(() => true).catch(() => false);
      if (targetExists && !overwrite) {
        throw new FileExistsError(targetPath);
      }

      const targetDir = path.dirname(targetAbsolute);
      await fs.mkdir(targetDir, { recursive: true });

      if (sourceStats.isDirectory()) {
        await this.copyDirectory(sourceAbsolute, targetAbsolute);
      } else {
        await fs.copyFile(sourceAbsolute, targetAbsolute);
      }

      await this.logOperation(executionId, FileOperations.COPY, sourcePath, targetPath);

      return {
        success: true,
        sourcePath,
        targetPath,
        copied: new Date().toISOString()
      };
    } catch (error) {
      await this.logOperation(executionId, FileOperations.COPY, sourcePath, targetPath, false, error.message);
      
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(sourcePath);
      } else if (error.code === 'EACCES') {
        throw new PermissionDeniedError(sourcePath, FileOperations.COPY);
      }
      throw error;
    }
  }

  async copyDirectory(source, target) {
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  }

  async searchFiles(executionId, query, options = {}) {
    const { absolutePath: searchRoot, workingDir } = await this.validatePath(executionId, options.path || '');
    
    try {
      const searchType = options.type || SearchTypes.FILENAME;
      const results = [];
      const startTime = Date.now();

      if (searchType === SearchTypes.FILENAME || searchType === SearchTypes.BOTH) {
        await this.searchFilenames(searchRoot, workingDir, query, options, results);
      }

      if (searchType === SearchTypes.CONTENT || searchType === SearchTypes.BOTH) {
        await this.searchContent(searchRoot, workingDir, query, options, results);
      }

      await this.logOperation(executionId, FileOperations.SEARCH, options.path || '');

      const limitedResults = results.slice(0, options.maxResults || FileLimits.MAX_SEARCH_RESULTS);

      return {
        executionId,
        query,
        type: searchType,
        results: limitedResults,
        totalMatches: results.length,
        searchTime: Date.now() - startTime
      };
    } catch (error) {
      await this.logOperation(executionId, FileOperations.SEARCH, options.path || '', null, false, error.message);
      throw error;
    }
  }

  async searchFilenames(searchRoot, workingDir, query, options, results) {
    const walkDirectory = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(workingDir, fullPath);

        if (options.extensions && entry.isFile()) {
          const ext = path.extname(entry.name).slice(1);
          if (!options.extensions.split(',').includes(ext)) {
            continue;
          }
        }

        const matches = options.caseSensitive
          ? entry.name.includes(query)
          : entry.name.toLowerCase().includes(query.toLowerCase());

        if (matches) {
          results.push({
            path: relativePath,
            type: entry.isDirectory() ? FileTypes.DIRECTORY : FileTypes.FILE,
            matches: [{
              text: entry.name,
              context: `Filename: ${entry.name}`
            }]
          });
        }

        if (entry.isDirectory() && results.length < (options.maxResults || FileLimits.MAX_SEARCH_RESULTS)) {
          await walkDirectory(fullPath);
        }
      }
    };

    await walkDirectory(searchRoot);
  }

  async searchContent(searchRoot, workingDir, query, options, results) {
    return new Promise((resolve, reject) => {
      const args = [
        '--json',
        '--max-count', String(options.maxResults || FileLimits.MAX_SEARCH_RESULTS)
      ];

      if (!options.caseSensitive) {
        args.push('-i');
      }

      if (options.extensions) {
        const exts = options.extensions.split(',');
        exts.forEach(ext => {
          args.push('--glob', `*.${ext}`);
        });
      }

      args.push(query, searchRoot);

      const rg = spawn('rg', args);
      let buffer = '';

      rg.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line) {
            try {
              const match = JSON.parse(line);
              const relativePath = path.relative(workingDir, match.data.path.text);
              
              let existingResult = results.find(r => r.path === relativePath);
              if (!existingResult) {
                existingResult = {
                  path: relativePath,
                  type: FileTypes.FILE,
                  matches: []
                };
                results.push(existingResult);
              }

              existingResult.matches.push({
                line: match.data.line_number,
                column: match.data.submatches[0]?.start || 0,
                text: match.data.lines.text.trim(),
                context: match.data.lines.text
              });
            } catch (e) {
              logger.warn('Failed to parse ripgrep output:', e);
            }
          }
        }
      });

      rg.on('close', (code) => {
        if (code === 0 || code === 1) {
          resolve();
        } else {
          reject(new Error(`ripgrep exited with code ${code}`));
        }
      });

      rg.on('error', (error) => {
        if (error.code === 'ENOENT') {
          logger.warn('ripgrep not found, falling back to basic search');
          this.basicContentSearch(searchRoot, workingDir, query, options, results)
            .then(resolve)
            .catch(reject);
        } else {
          reject(error);
        }
      });
    });
  }

  async basicContentSearch(searchRoot, workingDir, query, options, results) {
    const walkDirectory = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile()) {
          if (options.extensions) {
            const ext = path.extname(entry.name).slice(1);
            if (!options.extensions.split(',').includes(ext)) {
              continue;
            }
          }

          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const lines = content.split('\n');
            const relativePath = path.relative(workingDir, fullPath);
            const matches = [];

            lines.forEach((line, index) => {
              const searchLine = options.caseSensitive ? line : line.toLowerCase();
              const searchQuery = options.caseSensitive ? query : query.toLowerCase();
              
              if (searchLine.includes(searchQuery)) {
                matches.push({
                  line: index + 1,
                  column: searchLine.indexOf(searchQuery),
                  text: line.trim(),
                  context: line
                });
              }
            });

            if (matches.length > 0) {
              results.push({
                path: relativePath,
                type: FileTypes.FILE,
                matches
              });
            }
          } catch (error) {
            logger.warn(`Failed to search file ${fullPath}:`, error);
          }
        } else if (entry.isDirectory()) {
          await walkDirectory(fullPath);
        }
      }
    };

    await walkDirectory(searchRoot);
  }
}

export default FileManager;