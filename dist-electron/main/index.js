var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { app, ipcMain, BrowserWindow, shell } from "electron";
import { createRequire } from "node:module";
import { URL, fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { spawn, exec } from "node:child_process";
import { promisify as promisify$1 } from "node:util";
import { EventEmitter } from "node:events";
import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import fs, { promises } from "node:fs";
import dotenv from "dotenv";
import { promisify } from "util";
import { v4 } from "uuid";
import axios from "axios";
import net from "node:net";
import http from "node:http";
import https from "node:https";
const { autoUpdater } = createRequire(import.meta.url)("electron-updater");
function update(win2) {
  autoUpdater.autoDownload = false;
  autoUpdater.disableWebInstaller = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("checking-for-update", function() {
  });
  autoUpdater.on("update-available", (arg) => {
    win2.webContents.send("update-can-available", { update: true, version: app.getVersion(), newVersion: arg == null ? void 0 : arg.version });
  });
  autoUpdater.on("update-not-available", (arg) => {
    win2.webContents.send("update-can-available", { update: false, version: app.getVersion(), newVersion: arg == null ? void 0 : arg.version });
  });
  ipcMain.handle("check-update", async () => {
    if (!app.isPackaged) {
      const error = new Error("The update feature is only available after the package.");
      return { message: error.message, error };
    }
    try {
      return await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      return { message: "Network error", error };
    }
  });
  ipcMain.handle("start-download", (event) => {
    startDownload(
      (error, progressInfo) => {
        if (error) {
          event.sender.send("update-error", { message: error.message, error });
        } else {
          event.sender.send("download-progress", progressInfo);
        }
      },
      () => {
        event.sender.send("update-downloaded");
      }
    );
  });
  ipcMain.handle("quit-and-install", () => {
    autoUpdater.quitAndInstall(false, true);
  });
}
function startDownload(callback, complete) {
  autoUpdater.on("download-progress", (info) => callback(null, info));
  autoUpdater.on("error", (error) => callback(error, null));
  autoUpdater.on("update-downloaded", complete);
  autoUpdater.downloadUpdate();
}
try {
  dotenv.config();
} catch (err) {
}
const config = {
  server: {
    port: parseInt(process.env.PORT || "3010"),
    corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "https://intentos.me", "https://www.intentos.me"]
  },
  workspace: {
    // Workspace can be set via CLI arg, env var, or config
    path: process.env.WORKSPACE_DIR || "./workspace",
    // Auto-cleanup executions older than this (in hours)
    cleanupAge: process.env.WORKSPACE_CLEANUP_AGE !== void 0 ? parseInt(process.env.WORKSPACE_CLEANUP_AGE) : 24,
    // Maximum concurrent executions
    maxConcurrent: process.env.WORKSPACE_MAX_CONCURRENT !== void 0 ? parseInt(process.env.WORKSPACE_MAX_CONCURRENT) : 10
  },
  database: {
    // Database path is now relative to workspace/data by default
    // Can be overridden with absolute path
    path: process.env.DB_PATH || "agent-wrapper.db"
  },
  agents: {
    claude: {
      command: process.env.CLAUDE_COMMAND || "claude",
      defaultArgs: [
        "--dangerously-skip-permissions",
        "--verbose",
        "--output-format",
        "stream-json"
      ]
    },
    gemini: {
      command: process.env.GEMINI_COMMAND || "gemini",
      defaultArgs: []
    }
  },
  execution: {
    defaultWorkingDir: process.cwd(),
    maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || "10"),
    processTimeout: parseInt(process.env.PROCESS_TIMEOUT || "0")
    // 0 = no timeout
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    maxLogLength: parseInt(process.env.MAX_LOG_LENGTH || "10000")
  },
  streaming: {
    heartbeatInterval: parseInt(process.env.SSE_HEARTBEAT_INTERVAL || "30000"),
    // 30 seconds
    maxBufferSize: parseInt(process.env.MAX_BUFFER_SIZE || "65536")
    // 64KB
  }
};
function validateConfig() {
  if (config.server.port < 1 || config.server.port > 65535) {
    throw new Error(`Invalid port number: ${config.server.port}`);
  }
  if (!["claude", "gemini"].every((agent) => config.agents[agent])) {
    throw new Error("Missing agent configuration");
  }
  if (config.execution.maxConcurrentExecutions < 1) {
    throw new Error("maxConcurrentExecutions must be at least 1");
  }
  if (config.workspace.cleanupAge < 0) {
    throw new Error("workspace.cleanupAge must be non-negative");
  }
  if (config.workspace.maxConcurrent < 1) {
    throw new Error("workspace.maxConcurrent must be at least 1");
  }
  return true;
}
validateConfig();
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};
class Logger {
  constructor(name) {
    __publicField(this, "name");
    __publicField(this, "level");
    this.name = name;
    this.level = LOG_LEVELS[config.logging.level] || LOG_LEVELS.info;
  }
  formatMessage(level, message, ...args) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.name}]`;
    const formattedArgs = args.map((arg) => {
      if (arg instanceof Error) {
        return `${arg.message}
${arg.stack}`;
      }
      if (typeof arg === "object") {
        return JSON.stringify(arg, null, 2);
      }
      return arg;
    });
    return `${prefix} ${message} ${formattedArgs.join(" ")}`.trim();
  }
  log(level, message, ...args) {
    if (LOG_LEVELS[level] <= this.level) {
      const formatted = this.formatMessage(level, message, ...args);
      if (level === "error") {
        console.error(formatted);
      } else if (level === "warn") {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    }
  }
  error(message, ...args) {
    this.log("error", message, ...args);
  }
  warn(message, ...args) {
    this.log("warn", message, ...args);
  }
  info(message, ...args) {
    this.log("info", message, ...args);
  }
  debug(message, ...args) {
    this.log("debug", message, ...args);
  }
}
function createLogger(name) {
  return new Logger(name);
}
const logger$l = createLogger("database");
class Database {
  constructor(dbPath = "./data/agent-wrapper.db") {
    __publicField(this, "dbPath");
    __publicField(this, "db", null);
    this.dbPath = dbPath;
  }
  async connect() {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const sqlite = sqlite3.verbose();
      this.db = new sqlite.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          logger$l.info("Connected to SQLite database");
          resolve();
        }
      });
    });
  }
  async initialize() {
    await this.connect();
    await this.createTables();
    await this.runMigrations();
  }
  async createTables() {
    const executionsSchema = `
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        agent_type TEXT NOT NULL,
        status TEXT NOT NULL,
        working_dir TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        pid INTEGER,
        workspace_path TEXT,
        cleanup_status TEXT,
        cleanup_at TIMESTAMP,
        rolled_back BOOLEAN DEFAULT 0,
        rollback_reason TEXT,
        needs_review BOOLEAN DEFAULT 0,
        review_reason TEXT,
        conflict_details TEXT,
        session_id TEXT,
        message_count INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0.0,
        phase TEXT DEFAULT 'starting',
        auto_preview BOOLEAN DEFAULT 1,
        last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    const logsSchema = `
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (execution_id) REFERENCES executions(id)
      )
    `;
    const fileOperationsSchema = `
      CREATE TABLE IF NOT EXISTS file_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        path TEXT NOT NULL,
        target_path TEXT,
        size INTEGER,
        success BOOLEAN NOT NULL,
        error_message TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (execution_id) REFERENCES executions(id)
      )
    `;
    const previewProcessesSchema = `
      CREATE TABLE IF NOT EXISTS preview_processes (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        command TEXT NOT NULL,
        port INTEGER,
        pid INTEGER,
        status TEXT NOT NULL,
        urls TEXT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        stopped_at TIMESTAMP,
        error_message TEXT,
        ref_type TEXT,
        ref_id TEXT,
        working_dir TEXT,
        restart_attempts INTEGER DEFAULT 0,
        last_health_check TIMESTAMP DEFAULT NULL,
        FOREIGN KEY (execution_id) REFERENCES executions(id)
      )
    `;
    const previewLogsSchema = `
      CREATE TABLE IF NOT EXISTS preview_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        preview_id TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (preview_id) REFERENCES preview_processes(id)
      )
    `;
    const portAllocationsSchema = `
      CREATE TABLE IF NOT EXISTS port_allocations (
        port INTEGER PRIMARY KEY,
        preview_id TEXT NOT NULL,
        allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (preview_id) REFERENCES preview_processes(id)
      )
    `;
    const executionRefsSchema = `
      CREATE TABLE IF NOT EXISTS execution_refs (
        execution_id TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('read', 'mutate', 'create')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (execution_id, ref_id, permission),
        FOREIGN KEY (execution_id) REFERENCES executions(id)
      )
    `;
    const refChangesSchema = `
      CREATE TABLE IF NOT EXISTS ref_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        ref_id TEXT,
        change_type TEXT NOT NULL CHECK (change_type IN ('commit', 'merge', 'create', 'rollback')),
        branch_name TEXT,
        commit_hash TEXT,
        commit_message TEXT,
        merge_status TEXT CHECK (merge_status IN ('success', 'conflict', 'failed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (execution_id) REFERENCES executions(id)
      )
    `;
    const resourceUsageSchema = `
      CREATE TABLE IF NOT EXISTS resource_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL CHECK (type IN ('disk_usage', 'concurrent_executions', 'system_resources')),
        current_value REAL NOT NULL,
        limit_value REAL NOT NULL,
        exceeded BOOLEAN NOT NULL DEFAULT 0,
        details TEXT,
        execution_id TEXT
      )
    `;
    const gitOperationsLogSchema = `
      CREATE TABLE IF NOT EXISTS git_operations_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT,
        ref_id TEXT,
        operation TEXT NOT NULL,
        branch TEXT,
        command TEXT NOT NULL,
        working_dir TEXT,
        success BOOLEAN NOT NULL DEFAULT 1,
        duration_ms INTEGER,
        output TEXT,
        error TEXT,
        metadata TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (execution_id) REFERENCES executions(id)
      )
    `;
    const executionEventsLogSchema = `
      CREATE TABLE IF NOT EXISTS execution_events_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        event TEXT NOT NULL,
        phase TEXT,
        details TEXT,
        success BOOLEAN NOT NULL DEFAULT 1,
        duration_ms INTEGER,
        error TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (execution_id) REFERENCES executions(id)
      )
    `;
    const performanceMetricsSchema = `
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT,
        operation TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        success BOOLEAN NOT NULL DEFAULT 1,
        metadata TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (execution_id) REFERENCES executions(id)
      )
    `;
    const indexSchemas = [
      "CREATE INDEX IF NOT EXISTS idx_logs_execution ON logs(execution_id)",
      "CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(execution_id, timestamp)",
      "CREATE INDEX IF NOT EXISTS idx_file_operations_execution ON file_operations(execution_id)",
      "CREATE INDEX IF NOT EXISTS idx_file_operations_timestamp ON file_operations(execution_id, timestamp)",
      "CREATE INDEX IF NOT EXISTS idx_preview_execution ON preview_processes(execution_id)",
      "CREATE INDEX IF NOT EXISTS idx_preview_logs ON preview_logs(preview_id, timestamp)",
      // Indexes from migrations
      "CREATE INDEX IF NOT EXISTS idx_execution_refs_execution ON execution_refs(execution_id)",
      "CREATE INDEX IF NOT EXISTS idx_execution_refs_ref ON execution_refs(ref_id)",
      "CREATE INDEX IF NOT EXISTS idx_ref_changes_execution ON ref_changes(execution_id)",
      "CREATE INDEX IF NOT EXISTS idx_ref_changes_ref ON ref_changes(ref_id)",
      "CREATE INDEX IF NOT EXISTS idx_executions_heartbeat ON executions(status, last_heartbeat)",
      "CREATE INDEX IF NOT EXISTS idx_git_operations_execution ON git_operations_log(execution_id)",
      "CREATE INDEX IF NOT EXISTS idx_git_operations_ref ON git_operations_log(ref_id)",
      "CREATE INDEX IF NOT EXISTS idx_execution_events_execution ON execution_events_log(execution_id)",
      "CREATE INDEX IF NOT EXISTS idx_performance_metrics_execution ON performance_metrics(execution_id)"
    ];
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not connected"));
        return;
      }
      this.db.serialize(() => {
        this.db.run(executionsSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(logsSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(fileOperationsSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(previewProcessesSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(previewLogsSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(portAllocationsSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(executionRefsSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(refChangesSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(resourceUsageSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(gitOperationsLogSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(executionEventsLogSchema, (err) => {
          if (err) reject(err);
        });
        this.db.run(performanceMetricsSchema, (err) => {
          if (err) reject(err);
        });
        indexSchemas.forEach((schema) => {
          this.db.run(schema, (err) => {
            if (err) reject(err);
          });
        });
        resolve();
      });
    });
  }
  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not connected"));
        return;
      }
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }
  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not connected"));
        return;
      }
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not connected"));
        return;
      }
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
  async runMigrations() {
    logger$l.info("All schema updates are handled in createTables()");
  }
  async close() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          logger$l.info("Database connection closed");
          resolve();
        }
      });
    });
  }
}
const Events = {
  PROCESS_START: "process:start",
  PROCESS_EXIT: "process:exit",
  PROCESS_ERROR: "process:error",
  LOG_ENTRY: "log:entry",
  BUFFER_FLUSH: "buffer:flush"
};
const Limits = {
  MAX_BUFFER_SIZE: 1024 * 1024,
  // 1MB per execution
  MAX_LINE_LENGTH: 1e4,
  // 10KB per line
  SPAWN_TIMEOUT: 5e3
  // 5s to start process
};
const ErrorCodes = {
  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_AGENT: "INVALID_AGENT",
  INVALID_PROMPT: "INVALID_PROMPT",
  INVALID_PATH: "INVALID_PATH",
  // Not Found
  EXECUTION_NOT_FOUND: "EXECUTION_NOT_FOUND",
  // Process
  SPAWN_FAILED: "SPAWN_FAILED",
  PROCESS_NOT_RUNNING: "PROCESS_NOT_RUNNING",
  PROCESS_TERMINATED: "PROCESS_TERMINATED",
  // System
  DATABASE_ERROR: "DATABASE_ERROR",
  FILESYSTEM_ERROR: "FILESYSTEM_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // File operations
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  DIRECTORY_NOT_FOUND: "DIRECTORY_NOT_FOUND",
  PATH_TRAVERSAL_ATTEMPT: "PATH_TRAVERSAL_ATTEMPT",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INVALID_ENCODING: "INVALID_ENCODING",
  DIRECTORY_NOT_EMPTY: "DIRECTORY_NOT_EMPTY",
  FILE_EXISTS: "FILE_EXISTS",
  INVALID_FILE_OPERATION: "INVALID_FILE_OPERATION"
};
const ExecutionStatus = {
  STARTING: "starting",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
};
const LogType = {
  STDOUT: "stdout",
  STDERR: "stderr",
  SYSTEM: "system"
};
class WorkspaceManager {
  constructor(workspacePath) {
    __publicField(this, "workspacePath");
    this.workspacePath = workspacePath || process.env.WORKSPACE_DIR || path.join(process.cwd(), "workspace");
    this.workspacePath = path.resolve(this.workspacePath);
  }
  async initialize() {
    console.log(`Initializing workspace at: ${this.workspacePath}`);
    if (!await this.exists(this.workspacePath)) {
      await promises.mkdir(this.workspacePath, { recursive: true });
      console.log(`Created workspace directory: ${this.workspacePath}`);
    }
    await this.verifyPermissions();
    const subdirs = [
      path.join(this.workspacePath, "refs"),
      path.join(this.workspacePath, ".execution"),
      path.join(this.workspacePath, "data")
    ];
    for (const dir of subdirs) {
      if (!await this.exists(dir)) {
        await promises.mkdir(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    }
    await this.cleanupOrphanedExecutions();
    return {
      workspace: this.workspacePath,
      refsDir: path.join(this.workspacePath, "refs"),
      executionsDir: path.join(this.workspacePath, ".execution"),
      dataDir: path.join(this.workspacePath, "data")
    };
  }
  async exists(path2) {
    try {
      await promises.access(path2);
      return true;
    } catch {
      return false;
    }
  }
  async verifyPermissions() {
    try {
      const testFile = path.join(this.workspacePath, ".permission-test");
      await promises.writeFile(testFile, "test");
      await promises.unlink(testFile);
    } catch (error) {
      if (error.code === "EACCES") {
        throw new Error(`No write permission for workspace directory: ${this.workspacePath}`);
      }
      throw error;
    }
  }
  async cleanupOrphanedExecutions() {
    const executionsDir = path.join(this.workspacePath, ".execution");
    try {
      const dirs = await promises.readdir(executionsDir);
      for (const dir of dirs) {
        if (dir.startsWith("exec-")) {
          const execPath = path.join(executionsDir, dir);
          const stats = await promises.stat(execPath);
          const ageInDays = (Date.now() - stats.mtime.getTime()) / (1e3 * 60 * 60 * 24);
          if (ageInDays > 7) {
            await promises.rm(execPath, { recursive: true, force: true });
            console.log(`Cleaned up old execution directory: ${dir}`);
          }
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("Error cleaning up executions:", error);
      }
    }
  }
  async createExecutionWorkspace(executionId) {
    const execPath = path.join(this.workspacePath, ".execution", `exec-${executionId}`);
    await promises.mkdir(execPath, { recursive: true });
    return execPath;
  }
  async createRefWorkspace(refId) {
    const refPath = path.join(this.workspacePath, "refs", refId);
    await promises.mkdir(refPath, { recursive: true });
    return refPath;
  }
  async cleanupExecution(executionId) {
    const execPath = path.join(this.workspacePath, ".execution", `exec-${executionId}`);
    try {
      await promises.rm(execPath, { recursive: true, force: true });
      console.log(`Cleaned up execution workspace: ${executionId}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error(`Failed to cleanup execution ${executionId}:`, error);
      }
    }
  }
  async cleanupOldExecutions(hoursOld = 24) {
    const executionsDir = path.join(this.workspacePath, ".execution");
    const cutoffTime = Date.now() - hoursOld * 60 * 60 * 1e3;
    let cleanedCount = 0;
    try {
      const dirs = await promises.readdir(executionsDir);
      for (const dir of dirs) {
        if (dir.startsWith("exec-")) {
          const execPath = path.join(executionsDir, dir);
          const stats = await promises.stat(execPath);
          if (stats.mtime.getTime() < cutoffTime) {
            await promises.rm(execPath, { recursive: true, force: true });
            cleanedCount++;
            console.log(`Cleaned up old execution: ${dir}`);
          }
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("Error cleaning up old executions:", error);
      }
    }
    return cleanedCount;
  }
  async getWorkspaceStats() {
    const stats = {
      totalSize: 0,
      executionCount: 0,
      refCount: 0
    };
    try {
      const execDirs = await promises.readdir(path.join(this.workspacePath, ".execution"));
      stats.executionCount = execDirs.filter((d) => d.startsWith("exec-")).length;
    } catch (error) {
    }
    try {
      const refDirs = await promises.readdir(path.join(this.workspacePath, "refs"));
      stats.refCount = refDirs.length;
    } catch (error) {
    }
    stats.totalSize = await this.getDirectorySize(this.workspacePath);
    return stats;
  }
  async getDirectorySize(dirPath) {
    let totalSize = 0;
    try {
      const entries = await promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(fullPath);
        } else {
          const stats = await promises.stat(fullPath);
          totalSize += stats.size;
        }
      }
    } catch (error) {
    }
    return totalSize;
  }
  getWorkspacePath() {
    return this.workspacePath;
  }
  getRefPath(refId) {
    return path.join(this.workspacePath, "refs", refId);
  }
  getExecutionPath(executionId) {
    return path.join(this.workspacePath, ".execution", `exec-${executionId}`);
  }
  getExecutionsDir() {
    return path.join(this.workspacePath, ".execution");
  }
}
const logger$k = createLogger("ProcessManager");
class ProcessManager {
  constructor(db, config2, eventEmitter) {
    __publicField(this, "db");
    __publicField(this, "config");
    __publicField(this, "eventEmitter");
    __publicField(this, "activeProcesses");
    this.db = db;
    this.config = config2;
    this.eventEmitter = eventEmitter;
    this.activeProcesses = /* @__PURE__ */ new Map();
  }
  async spawn(executionId, agent, prompt, workingDir = null, isContinuation = false) {
    try {
      if (!["claude", "gemini"].includes(agent)) {
        throw new Error(`Invalid agent type: ${agent}`);
      }
      const resolvedWorkingDir = this.validateWorkingDir(workingDir);
      await this.updateProcessStatus(executionId, ExecutionStatus.STARTING);
      logger$k.info(`Spawning ${agent} process`, { executionId, workingDir: resolvedWorkingDir, isContinuation });
      const { cmd, args } = this.buildCommand(agent, prompt, resolvedWorkingDir, isContinuation);
      const childProcess = spawn(cmd, args, {
        cwd: resolvedWorkingDir,
        env: process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.activeProcesses.set(executionId, childProcess);
      childProcess.on("spawn", () => {
        logger$k.info(`Process started`, { executionId, pid: childProcess.pid });
        this.updateProcessStatus(executionId, ExecutionStatus.RUNNING, childProcess.pid);
        this.eventEmitter.emit(Events.PROCESS_START, { executionId, pid: childProcess.pid });
        if (agent === "claude" && this.config.agents.claude.defaultArgs.includes("--print")) {
          childProcess.stdin.end();
        }
      });
      childProcess.on("exit", (code, signal) => {
        this.handleProcessExit(executionId, code, signal);
      });
      childProcess.on("error", (error) => {
        this.handleProcessError(executionId, error);
      });
      logger$k.info(`Spawning command`, {
        executionId,
        command: cmd,
        args,
        cwd: resolvedWorkingDir
      });
      const spawnTimeout = setTimeout(() => {
        if (this.getProcess(executionId) && !childProcess.pid) {
          childProcess.kill();
          this.handleProcessError(executionId, new Error("Process spawn timeout"));
        }
      }, Limits.SPAWN_TIMEOUT);
      childProcess.once("spawn", () => clearTimeout(spawnTimeout));
      return childProcess;
    } catch (error) {
      logger$k.error(`Failed to spawn process`, { executionId, error });
      await this.updateProcessStatus(executionId, ExecutionStatus.FAILED);
      throw error;
    }
  }
  buildCommand(agent, prompt, workingDir, isContinuation = false) {
    const agentConfig = this.config.agents[agent];
    if (!agentConfig) {
      throw new Error(`No configuration found for agent: ${agent}`);
    }
    const command = agentConfig.command;
    const args = [...agentConfig.defaultArgs];
    if (agent === "claude") {
      if (workingDir) {
        args.push("--cwd", workingDir);
      }
      if (!isContinuation) {
        args.push(prompt);
      }
    } else if (agent === "gemini") {
      args.push(prompt);
    }
    return { cmd: command, args };
  }
  validateWorkingDir(workingDir) {
    if (!workingDir) {
      return this.config.execution.defaultWorkingDir;
    }
    const resolved = path.resolve(workingDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Working directory does not exist: ${resolved}`);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved}`);
    }
    return resolved;
  }
  async sendInput(executionId, input) {
    const process2 = this.getProcess(executionId);
    if (!process2) {
      throw new Error("Process not found");
    }
    if (!process2.stdin || process2.stdin.destroyed) {
      throw new Error("Process stdin is not available");
    }
    return new Promise((resolve, reject) => {
      process2.stdin.write(input + "\n", (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  async terminate(executionId) {
    const process2 = this.getProcess(executionId);
    if (!process2) {
      logger$k.warn(`No process found for execution ${executionId}`);
      return;
    }
    logger$k.info(`Terminating process for execution ${executionId}`);
    process2.kill("SIGTERM");
    setTimeout(() => {
      if (this.getProcess(executionId)) {
        logger$k.warn(`Force killing process for execution ${executionId}`);
        process2.kill("SIGKILL");
      }
    }, 5e3);
  }
  getProcess(executionId) {
    return this.activeProcesses.get(executionId);
  }
  isProcessRunning(executionId) {
    const process2 = this.getProcess(executionId);
    return !!process2 && !process2.killed;
  }
  async updateProcessStatus(executionId, status, pid) {
    const updateFields = ["status = ?"];
    const updateValues = [status];
    if (pid !== void 0) {
      updateFields.push("pid = ?");
      updateValues.push(pid);
    }
    if (status === ExecutionStatus.COMPLETED || status === ExecutionStatus.FAILED) {
      updateFields.push("completed_at = CURRENT_TIMESTAMP");
    }
    updateValues.push(executionId);
    await this.db.run(
      `UPDATE executions SET ${updateFields.join(", ")} WHERE id = ?`,
      updateValues
    );
  }
  async handleProcessExit(executionId, code, signal) {
    logger$k.info(`Process exited`, { executionId, code, signal });
    this.activeProcesses.delete(executionId);
    const status = code === 0 ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED;
    await this.updateProcessStatus(executionId, status);
    this.eventEmitter.emit(Events.PROCESS_EXIT, { executionId, code, signal });
    this.eventEmitter.emit(Events.BUFFER_FLUSH, { executionId });
  }
  async handleProcessError(executionId, error) {
    logger$k.error(`Process error`, { executionId, error });
    this.activeProcesses.delete(executionId);
    await this.updateProcessStatus(executionId, ExecutionStatus.FAILED);
    await this.db.run(
      "INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)",
      [executionId, LogType.SYSTEM, `Process error: ${error.message}`]
    );
    this.eventEmitter.emit(Events.PROCESS_ERROR, { executionId, error });
  }
  async getAllActiveProcesses() {
    return Array.from(this.activeProcesses.keys());
  }
  async terminateAll() {
    const executionIds = await this.getAllActiveProcesses();
    for (const executionId of executionIds) {
      try {
        await this.terminate(executionId);
      } catch (error) {
        logger$k.error(`Failed to terminate process ${executionId}:`, error);
      }
    }
  }
}
const logger$j = createLogger("StreamHandler");
class StreamHandler {
  constructor(db, eventEmitter) {
    __publicField(this, "db");
    __publicField(this, "eventEmitter");
    __publicField(this, "buffers");
    this.db = db;
    this.eventEmitter = eventEmitter;
    this.buffers = /* @__PURE__ */ new Map();
  }
  async handleOutput(executionId, stream, data) {
    try {
      const content = data.toString("utf8");
      if (process.env.SHOW_PROCESS_OUTPUT === "true") {
        logger$j.debug(`Process ${stream}`, { executionId, content: content.trim() });
      }
      this.appendToBuffer(executionId, content);
      await this.processCompleteLines(executionId, stream);
    } catch (error) {
      logger$j.error(`Error handling output`, { executionId, error });
    }
  }
  appendToBuffer(executionId, data) {
    let buffer = this.buffers.get(executionId) || "";
    buffer += data;
    if (buffer.length > Limits.MAX_BUFFER_SIZE) {
      logger$j.warn(`Buffer size exceeded, truncating`, { executionId, size: buffer.length });
      buffer = buffer.slice(-1048576);
    }
    this.buffers.set(executionId, buffer);
  }
  async processCompleteLines(executionId, streamType) {
    let buffer = this.buffers.get(executionId) || "";
    const lines = buffer.split("\n");
    const incomplete = lines.pop() || "";
    this.buffers.set(executionId, incomplete);
    for (const line of lines) {
      if (line.length > 0) {
        await this.saveLog(executionId, streamType, line);
        this.emitLogEvent(executionId, {
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          type: streamType,
          content: line
        });
      }
    }
  }
  async flushBuffer(executionId) {
    const buffer = this.buffers.get(executionId);
    if (buffer && buffer.length > 0) {
      logger$j.debug(`Flushing buffer`, { executionId, length: buffer.length });
      await this.saveLog(executionId, LogType.STDOUT, buffer);
      this.emitLogEvent(executionId, {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        type: LogType.STDOUT,
        content: buffer
      });
    }
    this.clearBuffer(executionId);
  }
  clearBuffer(executionId) {
    this.buffers.delete(executionId);
  }
  async saveLog(executionId, type, content) {
    try {
      const truncatedContent = content.length > Limits.MAX_LINE_LENGTH ? content.substring(0, Limits.MAX_LINE_LENGTH) + "... [truncated]" : content;
      await this.db.run(
        "INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)",
        [executionId, type, truncatedContent]
      );
    } catch (error) {
      logger$j.error(`Failed to save log`, { executionId, error });
    }
  }
  emitLogEvent(executionId, logEntry) {
    this.eventEmitter.emit(Events.LOG_ENTRY, {
      executionId,
      ...logEntry
    });
  }
  parseOutput(data) {
    return data.toString("utf8").trim();
  }
}
const execAsync$1 = promisify(exec);
class RefManager {
  constructor(workspacePath, performanceMonitor = null) {
    this.workspacePath = workspacePath;
    this.refsDir = path.join(workspacePath, "refs");
    console.log(`[RefManager] Initialized with workspace: ${workspacePath}`);
    console.log(`[RefManager] Refs directory: ${this.refsDir}`);
    this.performanceMonitor = performanceMonitor;
  }
  /**
   * Execute a git command safely with proper escaping and performance monitoring
   */
  async execGit(cwd, command, options = {}) {
    const { executionId = null, refId = null, operation = "unknown" } = options;
    const gitOperation = this.extractGitOperation(command);
    if (this.performanceMonitor) {
      return await this.performanceMonitor.instrumentGitOperation({
        executionId,
        refId,
        operation: gitOperation,
        branch: options.branch || null,
        command: `git ${command}`,
        workingDir: cwd
      }, async () => {
        return await this._execGitInternal(cwd, command, options);
      });
    } else {
      return await this._execGitInternal(cwd, command, options);
    }
  }
  /**
   * Internal Git execution without monitoring
   */
  async _execGitInternal(cwd, command, options = {}) {
    try {
      const { stdout, stderr } = await execAsync$1(`git ${command}`, {
        cwd,
        encoding: options.encoding || "utf8",
        maxBuffer: 10 * 1024 * 1024,
        // 10MB buffer
        ...options
      });
      if (options.encoding === "buffer") {
        return stdout;
      }
      return stdout.trim();
    } catch (error) {
      if (error.stderr) {
        error.message = `${error.message}
${error.stderr}`;
      }
      throw error;
    }
  }
  /**
   * Extract Git operation name from command
   */
  extractGitOperation(command) {
    const parts = command.trim().split(" ");
    if (parts.length === 0) return "unknown";
    const operation = parts[0];
    if (operation === "worktree" && parts[1]) {
      return `worktree_${parts[1]}`;
    }
    if (operation === "ls-tree") {
      return "ls_tree";
    }
    return operation;
  }
  /**
   * List files in a reference without checkout using git ls-tree
   */
  async listFiles(refId, branch = "main", dirPath = "") {
    const refPath = path.join(this.refsDir, refId);
    await this.verifyRefExists(refId);
    try {
      let output;
      if (dirPath) {
        output = await this.execGit(
          refPath,
          `ls-tree -r --name-only --full-tree ${this.escapeArg(branch)} ${this.escapeArg(dirPath)}`
        );
      } else {
        output = await this.execGit(
          refPath,
          `ls-tree -r --name-only ${this.escapeArg(branch)}`
        );
      }
      return output.split("\n").filter(Boolean);
    } catch (error) {
      if (error.message.includes("Not a valid object name")) {
        throw new Error(`Branch '${branch}' not found in reference '${refId}'`);
      }
      throw error;
    }
  }
  /**
   * Read file content from any branch using git show
   */
  async readFile(refId, branch, filePath) {
    const refPath = path.join(this.refsDir, refId);
    await this.verifyRefExists(refId);
    try {
      const content = await this.execGit(
        refPath,
        `show ${this.escapeArg(branch)}:${this.escapeArg(filePath)}`,
        { encoding: "buffer" }
      );
      const isBinary = content.includes(0);
      return {
        content,
        found: true,
        isBinary,
        encoding: isBinary ? "base64" : "utf8"
      };
    } catch (error) {
      if (error.message.includes("does not exist")) {
        return { found: false };
      }
      if (error.message.includes("Not a valid object name")) {
        throw new Error(`Branch '${branch}' not found in reference '${refId}'`);
      }
      throw error;
    }
  }
  /**
   * Get directory listing with file metadata
   */
  async listDirectory(refId, branch = "main", dirPath = "") {
    const refPath = path.join(this.refsDir, refId);
    await this.verifyRefExists(refId);
    try {
      const treeRef = dirPath ? `${branch}:${dirPath}` : branch;
      const output = await this.execGit(
        refPath,
        `ls-tree -l ${this.escapeArg(treeRef)}`
      );
      const entries = [];
      for (const line of output.split("\n").filter(Boolean)) {
        const match = line.match(/^(\d+)\s+(blob|tree)\s+([a-f0-9]+)\s+(-|\d+)\s+(.+)$/);
        if (match) {
          entries.push({
            name: match[5],
            type: match[2] === "tree" ? "directory" : "file",
            size: match[4] === "-" ? null : parseInt(match[4]),
            mode: match[1],
            hash: match[3]
          });
        }
      }
      return entries;
    } catch (error) {
      if (error.message.includes("Not a valid object name")) {
        throw new Error(`Branch '${branch}' or path '${dirPath}' not found in reference '${refId}'`);
      }
      throw error;
    }
  }
  /**
   * Get file metadata without reading content
   */
  async getFileInfo(refId, branch, filePath) {
    const refPath = path.join(this.refsDir, refId);
    await this.verifyRefExists(refId);
    try {
      const info = await this.execGit(
        refPath,
        `ls-tree -l ${this.escapeArg(branch)} -- ${this.escapeArg(filePath)}`
      );
      if (!info.trim()) {
        return null;
      }
      const parts = info.trim().split(/\s+/);
      if (parts.length < 5) {
        return null;
      }
      const [mode, type, hash, size, ...nameParts] = parts;
      const name = nameParts.join(" ");
      const lastModified = await this.execGit(
        refPath,
        `log -1 --format=%aI ${this.escapeArg(branch)} -- ${this.escapeArg(filePath)}`
      );
      return {
        name,
        mode,
        type,
        size: parseInt(size),
        hash,
        lastModified: lastModified.trim()
      };
    } catch (error) {
      if (error.message.includes("Not a valid object name")) {
        throw new Error(`Branch '${branch}' not found in reference '${refId}'`);
      }
      throw error;
    }
  }
  /**
   * Create a git worktree for execution
   */
  async createWorktree(refId, executionId, targetPath) {
    const refPath = path.join(this.refsDir, refId);
    const branchName = `exec-${executionId}`;
    await this.verifyRefExists(refId);
    try {
      const gitCommand = `worktree add -b ${this.escapeArg(branchName)} ${this.escapeArg(targetPath)}`;
      console.log(`[RefManager] Creating worktree with command: git ${gitCommand}`);
      await this.execGit(refPath, gitCommand);
      console.log(`[RefManager] Worktree created successfully at ${targetPath} with branch ${branchName}`);
      return {
        worktreePath: targetPath,
        branch: branchName
      };
    } catch (error) {
      if (error.message.includes("already exists")) {
        throw new Error(`Worktree or branch for execution '${executionId}' already exists`);
      }
      throw error;
    }
  }
  /**
   * Remove a git worktree
   */
  async removeWorktree(refId, worktreePath) {
    const refPath = path.join(this.refsDir, refId);
    try {
      await this.execGit(
        refPath,
        `worktree remove --force ${this.escapeArg(worktreePath)}`
      );
    } catch (error) {
      if (!error.message.includes("not a working tree")) {
        throw error;
      }
    }
  }
  /**
   * List all worktrees for a reference
   */
  async listWorktrees(refId) {
    const refPath = path.join(this.refsDir, refId);
    await this.verifyRefExists(refId);
    const output = await this.execGit(refPath, "worktree list --porcelain");
    const worktrees = [];
    let current = {};
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push(current);
        }
        current = { path: line.substring(9) };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.substring(5);
      } else if (line.startsWith("branch ")) {
        current.branch = line.substring(7);
      } else if (line === "detached") {
        current.detached = true;
      } else if (line === "") {
        if (current.path) {
          worktrees.push(current);
          current = {};
        }
      }
    }
    if (current.path) {
      worktrees.push(current);
    }
    return worktrees;
  }
  /**
   * List branches for a reference
   */
  async listBranches(refId) {
    const refPath = path.join(this.refsDir, refId);
    await this.verifyRefExists(refId);
    const output = await this.execGit(refPath, 'branch -a --format="%(refname:short)|%(objectname)|%(committerdate:iso)|%(subject)"');
    const branches = [];
    for (const line of output.split("\n").filter(Boolean)) {
      const [name, hash, date, ...subjectParts] = line.split("|");
      branches.push({
        name: name.replace("origin/", ""),
        hash,
        date,
        subject: subjectParts.join("|")
      });
    }
    const currentBranch = await this.execGit(refPath, "rev-parse --abbrev-ref HEAD");
    return {
      current: currentBranch,
      branches
    };
  }
  /**
   * Create a new branch
   */
  async createBranch(refId, branchName, fromBranch = "main") {
    const refPath = path.join(this.refsDir, refId);
    await this.verifyRefExists(refId);
    await this.execGit(
      refPath,
      `checkout -b ${this.escapeArg(branchName)} ${this.escapeArg(fromBranch)}`
    );
  }
  /**
   * Delete a branch
   */
  async deleteBranch(refId, branchName, force = false) {
    const refPath = path.join(this.refsDir, refId);
    await this.verifyRefExists(refId);
    const flag = force ? "-D" : "-d";
    await this.execGit(refPath, `branch ${flag} ${this.escapeArg(branchName)}`);
  }
  /**
   * Initialize a new git repository
   */
  async initializeRepo(refId) {
    const refPath = path.join(this.refsDir, refId);
    await promises.mkdir(refPath, { recursive: true });
    await this.execGit(refPath, "init");
    await this.execGit(refPath, "config init.defaultBranch main");
    return refPath;
  }
  /**
   * Check if a reference exists
   */
  async refExists(refId) {
    const refPath = path.join(this.refsDir, refId);
    console.log(`[RefManager] Checking if ref exists: ${refId} at path: ${refPath}`);
    try {
      const stat = await promises.stat(refPath);
      if (!stat.isDirectory()) {
        console.log(`[RefManager] Path exists but is not a directory: ${refPath}`);
        return false;
      }
      console.log(`[RefManager] Directory exists: ${refPath}`);
      try {
        await this.execGit(refPath, "rev-parse --git-dir");
        console.log(`[RefManager] Git repository confirmed: ${refPath}`);
        return true;
      } catch (gitError) {
        console.log(`[RefManager] Directory exists but is not a git repository: ${refPath}`, gitError.message);
        return false;
      }
    } catch (error) {
      console.log(`[RefManager] Path does not exist: ${refPath}`, error.message);
      return false;
    }
  }
  /**
   * Verify that a reference exists, throw if not
   */
  async verifyRefExists(refId) {
    if (!await this.refExists(refId)) {
      throw new Error(`Reference '${refId}' does not exist`);
    }
  }
  /**
   * Get all references
   */
  async listRefs() {
    try {
      const entries = await promises.readdir(this.refsDir, { withFileTypes: true });
      const refs = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const refId = entry.name;
          if (await this.refExists(refId)) {
            refs.push(refId);
          }
        }
      }
      return refs;
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
  /**
   * Escape shell arguments to prevent injection
   */
  escapeArg(arg) {
    if (!arg) return "''";
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
class ExecutionContextManager {
  constructor(workspaceManager, refManager2, previewManager2) {
    this.workspaceManager = workspaceManager;
    const workspacePath = workspaceManager.getWorkspacePath();
    console.log(`[ExecutionContextManager] Workspace path: ${workspacePath}`);
    this.refManager = refManager2 || new RefManager(workspacePath);
    this.executionsDir = workspaceManager.getExecutionsDir();
    console.log(`[ExecutionContextManager] Executions directory: ${this.executionsDir}`);
    this.previewManager = previewManager2;
  }
  /**
   * Set up complete execution workspace with references
   */
  async setupExecutionWorkspace(executionId, refs = {}) {
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    const dirs = {
      root: executionPath,
      read: path.join(executionPath, "read"),
      mutate: path.join(executionPath, "mutate"),
      create: path.join(executionPath, "create")
    };
    for (const dir of Object.values(dirs)) {
      await promises.mkdir(dir, { recursive: true });
    }
    const normalizedRefs = {
      read: refs.read || [],
      mutate: refs.mutate || [],
      create: refs.create || []
    };
    const manifest = {
      executionId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      refs: normalizedRefs,
      paths: dirs
    };
    await promises.writeFile(
      path.join(executionPath, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );
    try {
      const skippedRefs = {
        read: [],
        mutate: []
      };
      if (refs.read && refs.read.length > 0) {
        skippedRefs.read = await this.setupReadOnlyRefs(executionId, refs.read);
      }
      if (refs.mutate && refs.mutate.length > 0) {
        const result = await this.setupMutableRefs(executionId, refs.mutate);
        manifest.worktrees = result.worktrees;
        skippedRefs.mutate = result.skippedRefs;
      }
      if (refs.create && refs.create.length > 0) {
        await this.setupCreateDirs(executionId, refs.create);
      }
      manifest.skippedRefs = skippedRefs;
      await promises.writeFile(
        path.join(executionPath, "manifest.json"),
        JSON.stringify(manifest, null, 2)
      );
      return {
        executionPath,
        manifest,
        paths: dirs,
        skippedRefs
      };
    } catch (error) {
      await this.cleanupExecutionWorkspace(executionId);
      throw error;
    }
  }
  /**
   * Set up read-only references using symlinks
   */
  async setupReadOnlyRefs(executionId, refIds) {
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    const readDir = path.join(executionPath, "read");
    const skippedRefs = [];
    for (const refId of refIds) {
      if (!await this.refManager.refExists(refId)) {
        console.error(`[ExecutionContextManager] Read reference '${refId}' does not exist!`);
        throw new Error(`Read reference '${refId}' does not exist. Please ensure all references are properly initialized.`);
      }
      const sourcePath = path.join(this.refManager.refsDir, refId);
      const linkPath = path.join(readDir, refId);
      console.log(`[ExecutionContextManager] Creating read-only symlink from ${sourcePath} to ${linkPath}`);
      await promises.symlink(sourcePath, linkPath, "dir");
    }
    return skippedRefs;
  }
  /**
   * Set up mutable references using git worktrees
   */
  async setupMutableRefs(executionId, refIds) {
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    const mutateDir = path.join(executionPath, "mutate");
    const worktrees = {};
    const skippedRefs = [];
    for (const refId of refIds) {
      if (!await this.refManager.refExists(refId)) {
        console.error(`[ExecutionContextManager] Mutate reference '${refId}' does not exist!`);
        throw new Error(`Mutate reference '${refId}' does not exist. Please ensure all references are properly initialized.`);
      }
      const worktreePath = path.join(mutateDir, refId);
      try {
        console.log(`[ExecutionContextManager] Creating worktree for ref ${refId} at ${worktreePath}`);
        const result = await this.refManager.createWorktree(refId, executionId, worktreePath);
        console.log(`[ExecutionContextManager] Worktree created successfully:`, result);
        worktrees[refId] = result;
        if (!this.pendingPreviews) {
          this.pendingPreviews = [];
        }
        this.pendingPreviews.push({
          executionId,
          refType: "mutate",
          refId
        });
      } catch (error) {
        for (const [createdRefId, worktreeInfo] of Object.entries(worktrees)) {
          try {
            await this.refManager.removeWorktree(createdRefId, worktreeInfo.worktreePath);
            await this.refManager.deleteBranch(createdRefId, worktreeInfo.branch, true);
          } catch (cleanupError) {
            console.error(`Failed to clean up worktree for ${createdRefId}:`, cleanupError);
          }
        }
        throw error;
      }
    }
    return { worktrees, skippedRefs };
  }
  /**
   * Set up directories for new references to be created
   */
  async setupCreateDirs(executionId, refIds) {
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    const createDir = path.join(executionPath, "create");
    for (const refId of refIds) {
      if (await this.refManager.refExists(refId)) {
        throw new Error(`Reference '${refId}' already exists`);
      }
      const refDir = path.join(createDir, refId);
      await promises.mkdir(refDir, { recursive: true });
      console.log(`[ExecutionContextManager] Created directory for new reference: ${refDir}`);
      await promises.writeFile(
        path.join(refDir, ".new-reference"),
        JSON.stringify({
          refId,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          executionId,
          type: "create"
        })
      );
      if (!this.pendingPreviews) {
        this.pendingPreviews = [];
      }
      this.pendingPreviews.push({
        executionId,
        refType: "create",
        refId
      });
    }
  }
  /**
   * Start pending previews after workspace_path is updated in database
   */
  async startPendingPreviews() {
    if (!this.pendingPreviews || this.pendingPreviews.length === 0) {
      return;
    }
    for (const preview of this.pendingPreviews) {
      if (this.previewManager) {
        console.log(`[ExecutionContextManager] Auto-starting preview for ${preview.refId}...`);
        try {
          const previewResult = await this.previewManager.startPreview(preview.executionId, {
            refType: preview.refType,
            refId: preview.refId,
            installDependencies: false
            // Already installed by create-next-app
          });
          console.log(`[ExecutionContextManager] Preview started successfully:`, previewResult);
        } catch (error) {
          console.error(`[ExecutionContextManager] Failed to auto-start preview for ${preview.refId}:`, error);
        }
      }
    }
    this.pendingPreviews = [];
  }
  /**
   * Get execution manifest
   */
  async getExecutionManifest(executionId) {
    const manifestPath = path.join(this.executionsDir, `exec-${executionId}`, "manifest.json");
    try {
      const content = await promises.readFile(manifestPath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
  /**
   * Clean up execution workspace
   */
  async cleanupExecutionWorkspace(executionId) {
    const manifest = await this.getExecutionManifest(executionId);
    if (manifest && manifest.worktrees) {
      for (const [refId, worktreeInfo] of Object.entries(manifest.worktrees)) {
        try {
          await this.refManager.removeWorktree(refId, worktreeInfo.worktreePath);
          console.log(`Preserved execution branch ${worktreeInfo.branch} for audit trail`);
        } catch (error) {
          console.error(`Failed to remove worktree for ${refId}:`, error);
        }
      }
    }
    const executionPath = path.join(this.executionsDir, `exec-${executionId}`);
    try {
      await promises.rm(executionPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  /**
   * List all active executions
   */
  async listExecutions() {
    try {
      const entries = await promises.readdir(this.executionsDir, { withFileTypes: true });
      const executions = [];
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("exec-")) {
          const executionId = entry.name.substring(5);
          const manifest = await this.getExecutionManifest(executionId);
          if (manifest) {
            executions.push({
              executionId,
              timestamp: manifest.timestamp,
              refs: manifest.refs
            });
          }
        }
      }
      return executions.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
  /**
   * Get changes in mutable references
   */
  async getExecutionChanges(executionId) {
    const manifest = await this.getExecutionManifest(executionId);
    if (!manifest || !manifest.worktrees) {
      return {};
    }
    const changes = {};
    for (const [refId, worktreeInfo] of Object.entries(manifest.worktrees)) {
      try {
        const status = await this.refManager.execGit(
          worktreeInfo.worktreePath,
          "status --porcelain"
        );
        const files = {
          added: [],
          modified: [],
          deleted: []
        };
        if (status) {
          for (const line of status.split("\n").filter(Boolean)) {
            const statusCode = line.substring(0, 2);
            const filePath = line.substring(2).trim();
            const indexStatus = statusCode[0];
            const workingStatus = statusCode[1];
            if (statusCode === "??") {
              files.added.push(filePath);
            } else if (indexStatus === "A" || workingStatus === "A") {
              files.added.push(filePath);
            } else if (indexStatus === "M" || workingStatus === "M") {
              files.modified.push(filePath);
            } else if (indexStatus === "D" || workingStatus === "D") {
              files.deleted.push(filePath);
            } else if (indexStatus === "R") {
              const renameParts = filePath.split(" -> ");
              if (renameParts.length === 2) {
                files.deleted.push(renameParts[0]);
                files.added.push(renameParts[1]);
              }
            }
          }
        }
        changes[refId] = {
          branch: worktreeInfo.branch,
          files,
          hasChanges: files.added.length > 0 || files.modified.length > 0 || files.deleted.length > 0
        };
      } catch (error) {
        console.error(`Failed to get changes for ${refId}:`, error);
        changes[refId] = {
          error: error.message
        };
      }
    }
    return changes;
  }
}
promisify$1(exec);
class ChangeManager {
  constructor(workspaceManager, refManager2, contextManager) {
    this.workspaceManager = workspaceManager;
    this.refManager = refManager2 || new RefManager(workspaceManager.getWorkspacePath());
    this.contextManager = contextManager || new ExecutionContextManager(workspaceManager, this.refManager);
  }
  /**
   * Commit changes in a worktree
   */
  async commitChanges(executionId, refId, message) {
    const manifest = await this.contextManager.getExecutionManifest(executionId);
    if (!manifest || !manifest.worktrees || !manifest.worktrees[refId]) {
      throw new Error(`No worktree found for reference '${refId}' in execution '${executionId}'`);
    }
    const worktreePath = manifest.worktrees[refId].worktreePath;
    const status = await this.refManager.execGit(worktreePath, "status --porcelain");
    if (!status.trim()) {
      return {
        committed: false,
        message: "No changes to commit"
      };
    }
    await this.refManager.execGit(worktreePath, "add -A");
    const fullMessage = `${message}

Execution: ${executionId}`;
    const commitCommand = `commit -m ${this.refManager.escapeArg(fullMessage)}`;
    try {
      const output = await this.refManager.execGit(worktreePath, commitCommand);
      const commitHash = await this.refManager.execGit(worktreePath, "rev-parse HEAD");
      return {
        committed: true,
        hash: commitHash,
        message: fullMessage,
        output
      };
    } catch (error) {
      if (error.message.includes("nothing to commit")) {
        return {
          committed: false,
          message: "No changes to commit after staging"
        };
      }
      throw error;
    }
  }
  /**
   * Sync execution branch to refs directory (preserves both main and exec branches separately)
   */
  async syncExecutionBranch(refId, executionBranch) {
    const refPath = path.join(this.refManager.refsDir, refId);
    try {
      const branches = await this.refManager.execGit(refPath, "branch -a");
      const branchExists = branches.includes(executionBranch);
      if (!branchExists) {
        throw new Error(`Execution branch '${executionBranch}' not found in repository`);
      }
      const execBranchHash = await this.refManager.execGit(refPath, `rev-parse ${this.refManager.escapeArg(executionBranch)}`);
      const mainBranchHash = await this.refManager.execGit(refPath, "rev-parse main");
      await this.refManager.execGit(refPath, "checkout main");
      return {
        synced: true,
        preservedBranches: ["main", executionBranch],
        execBranchHash,
        mainBranchHash,
        mainUpdated: false,
        // We intentionally do NOT update main for audit trail
        message: `Preserved execution branch '${executionBranch}' alongside unchanged main branch for complete audit trail`
      };
    } catch (error) {
      return {
        synced: false,
        error: error.message,
        message: `Failed to sync execution branch '${executionBranch}': ${error.message}`
      };
    }
  }
  /**
   * Initialize a new reference from created content
   */
  async initializeNewRef(executionId, refId) {
    const manifest = await this.contextManager.getExecutionManifest(executionId);
    if (!manifest) {
      throw new Error(`Execution '${executionId}' not found`);
    }
    if (!manifest.refs.create || !manifest.refs.create.includes(refId)) {
      throw new Error(`Reference '${refId}' was not marked for creation in execution '${executionId}'`);
    }
    if (await this.refManager.refExists(refId)) {
      throw new Error(`Reference '${refId}' already exists`);
    }
    const sourcePath = path.join(manifest.paths.create, refId);
    const allFiles = await this.listDirectoryRecursive(sourcePath);
    const files = allFiles.filter((f) => f !== ".new-reference");
    if (files.length === 0) {
      throw new Error(`No files found in create directory for reference '${refId}'`);
    }
    const refPath = await this.refManager.initializeRepo(refId);
    for (const file of files) {
      const sourceFile = path.join(sourcePath, file);
      const destFile = path.join(refPath, file);
      const destDir = path.dirname(destFile);
      await promises.mkdir(destDir, { recursive: true });
      await promises.copyFile(sourceFile, destFile);
    }
    await this.refManager.execGit(refPath, "add -A");
    const commitMessage = `Initial commit

Created from execution: ${executionId}`;
    await this.refManager.execGit(refPath, `commit -m ${this.refManager.escapeArg(commitMessage)}`);
    const commitHash = await this.refManager.execGit(refPath, "rev-parse HEAD");
    return {
      refId,
      refPath,
      files,
      commitHash
    };
  }
  /**
   * Process all changes from an execution
   */
  async processExecutionChanges(executionId, options = {}) {
    const manifest = await this.contextManager.getExecutionManifest(executionId);
    if (!manifest) {
      throw new Error(`Execution '${executionId}' not found`);
    }
    const results = {
      commits: {},
      merges: {},
      creates: {},
      errors: {}
    };
    if (manifest.worktrees) {
      for (const [refId, worktreeInfo] of Object.entries(manifest.worktrees)) {
        try {
          const commitResult = await this.commitChanges(
            executionId,
            refId,
            options.commitMessage || `Changes from execution ${executionId}`
          );
          results.commits[refId] = commitResult;
          if (commitResult.committed && options.merge !== false) {
            const syncResult = await this.syncExecutionBranch(
              refId,
              worktreeInfo.branch
            );
            results.merges[refId] = syncResult;
          }
        } catch (error) {
          results.errors[refId] = {
            phase: results.commits[refId] ? "merge" : "commit",
            error: error.message
          };
        }
      }
    }
    if (manifest.refs.create && manifest.refs.create.length > 0) {
      for (const refId of manifest.refs.create) {
        try {
          const createResult = await this.initializeNewRef(executionId, refId);
          results.creates[refId] = createResult;
        } catch (error) {
          results.errors[refId] = {
            phase: "create",
            error: error.message
          };
        }
      }
    }
    return results;
  }
  /**
   * List all files in a directory recursively
   */
  async listDirectoryRecursive(dir, basePath = "") {
    const files = [];
    try {
      const entries = await promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(basePath, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this.listDirectoryRecursive(fullPath, relativePath);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    return files;
  }
}
const logger$i = createLogger("IntegrationManager");
class IntegrationManager {
  constructor(workspaceManager, refManager2, contextManager, changeManager, db) {
    this.workspaceManager = workspaceManager;
    this.refManager = refManager2;
    this.contextManager = contextManager || new ExecutionContextManager(workspaceManager, refManager2);
    this.changeManager = changeManager || new ChangeManager(workspaceManager, refManager2, this.contextManager);
    this.db = db;
  }
  /**
   * Process all changes from an execution and integrate them
   */
  async integrateExecutionChanges(executionId, options = {}) {
    try {
      logger$i.info(`Starting integration for execution ${executionId}`);
      const manifest = await this.contextManager.getExecutionManifest(executionId);
      if (!manifest) {
        logger$i.warn(`No manifest found for execution ${executionId}`);
        return { success: false, message: "No execution manifest found" };
      }
      const results = await this.changeManager.processExecutionChanges(executionId, {
        commitMessage: options.commitMessage || `Changes from execution ${executionId}`,
        merge: options.merge !== false,
        mergeStrategy: options.mergeStrategy || "merge"
      });
      await this.saveChangeRecords(executionId, results);
      const hasSyncFailures = Object.values(results.merges || {}).some((m) => !m.synced);
      if (hasSyncFailures) {
        logger$i.warn(`Execution ${executionId} had sync failures`);
        await this.markExecutionNeedsReview(executionId, "sync_failures");
        const failureDetails = Object.entries(results.merges || {}).filter(([refId, result]) => !result.synced).reduce((acc, [refId, result]) => {
          acc[refId] = {
            error: result.error || "Unknown sync failure",
            message: result.message || "Sync operation failed",
            branch: `exec-${executionId}`
          };
          return acc;
        }, {});
        await this.db.run(
          "UPDATE executions SET conflict_details = ? WHERE id = ?",
          [JSON.stringify(failureDetails), executionId]
        );
      }
      if (options.cleanup !== false && !hasSyncFailures) {
        try {
          await this.contextManager.cleanupExecutionWorkspace(executionId);
          logger$i.info(`Cleaned up workspace for execution ${executionId}`);
        } catch (error) {
          logger$i.error(`Failed to clean up workspace for execution ${executionId}:`, error);
        }
      }
      logger$i.info(`Integration completed for execution ${executionId}`, results);
      return {
        success: true,
        results
      };
    } catch (error) {
      logger$i.error(`Integration failed for execution ${executionId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  /**
   * Save change records to the database
   */
  async saveChangeRecords(executionId, results) {
    const inserts = [];
    for (const [refId, commitResult] of Object.entries(results.commits || {})) {
      if (commitResult.committed) {
        inserts.push(this.db.run(
          `INSERT INTO ref_changes (execution_id, ref_id, change_type, branch_name, commit_hash, commit_message) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [executionId, refId, "commit", `exec-${executionId}`, commitResult.hash, commitResult.message]
        ));
      }
    }
    for (const [refId, syncResult] of Object.entries(results.merges || {})) {
      inserts.push(this.db.run(
        `INSERT INTO ref_changes (execution_id, ref_id, change_type, branch_name, commit_hash, merge_status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          executionId,
          refId,
          "merge",
          `exec-${executionId}`,
          syncResult.execBranchHash || null,
          syncResult.synced ? "success" : "failed"
        ]
      ));
    }
    for (const [refId, createResult] of Object.entries(results.creates || {})) {
      inserts.push(this.db.run(
        `INSERT INTO ref_changes (execution_id, ref_id, change_type, commit_hash, commit_message) 
         VALUES (?, ?, ?, ?, ?)`,
        [executionId, refId, "create", createResult.commitHash, `Initial commit

Created from execution: ${executionId}`]
      ));
    }
    await Promise.all(inserts);
  }
  /**
   * Mark an execution as needing manual review
   */
  async markExecutionNeedsReview(executionId, reason) {
    try {
      await this.db.run(
        "UPDATE executions SET status = ?, needs_review = 1, review_reason = ? WHERE id = ?",
        ["needs_review", reason, executionId]
      );
      logger$i.info(`Marked execution ${executionId} as needing review: ${reason}`);
    } catch (error) {
      logger$i.error(`Failed to mark execution ${executionId} as needing review:`, error);
      throw error;
    }
  }
  /**
   * Get integration status for an execution
   */
  async getIntegrationStatus(executionId) {
    const changes = await this.db.all(
      "SELECT * FROM ref_changes WHERE execution_id = ? ORDER BY created_at",
      [executionId]
    );
    const refs = await this.db.all(
      "SELECT * FROM execution_refs WHERE execution_id = ?",
      [executionId]
    );
    return {
      executionId,
      refs: refs.reduce((acc, ref) => {
        if (!acc[ref.ref_id]) {
          acc[ref.ref_id] = { permissions: [] };
        }
        acc[ref.ref_id].permissions.push(ref.permission);
        return acc;
      }, {}),
      changes: changes.reduce((acc, change) => {
        if (!acc[change.ref_id]) {
          acc[change.ref_id] = [];
        }
        acc[change.ref_id].push({
          type: change.change_type,
          branch: change.branch_name,
          commit: change.commit_hash,
          message: change.commit_message,
          mergeStatus: change.merge_status,
          timestamp: change.created_at
        });
        return acc;
      }, {})
    };
  }
}
const logger$h = createLogger("ResourceMonitor");
class ResourceMonitor {
  constructor(workspaceManager, db, options = {}) {
    this.workspaceManager = workspaceManager;
    this.db = db;
    this.limits = {
      maxConcurrentExecutions: options.maxConcurrentExecutions || 10,
      maxDiskUsageMB: options.maxDiskUsageMB || 1e4,
      // 1GB
      maxExecutionTimeMinutes: options.maxExecutionTimeMinutes || 60,
      maxWorkspaceAgeDays: options.maxWorkspaceAgeDays || 7
    };
    this.monitoringEnabled = true;
    this.checkInterval = options.checkInterval || 3e5;
    this.intervalId = null;
  }
  /**
   * Start resource monitoring
   */
  start() {
    if (this.intervalId) {
      logger$h.warn("Resource monitoring already started");
      return;
    }
    logger$h.info("Starting resource monitoring with limits:", this.limits);
    this.intervalId = setInterval(() => {
      this.performResourceCheck().catch((error) => {
        logger$h.error("Resource check failed:", error);
      });
    }, this.checkInterval);
  }
  /**
   * Stop resource monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger$h.info("Resource monitoring stopped");
    }
  }
  /**
   * Check if a new execution can be started
   */
  async canStartExecution() {
    const checks = await Promise.all([
      this.checkConcurrentExecutions(),
      this.checkDiskUsage(),
      this.checkSystemResources()
    ]);
    console.log("Resource checks:", checks);
    return checks.every((check) => check.allowed);
  }
  /**
   * Check concurrent execution limit
   */
  async checkConcurrentExecutions() {
    var _a;
    try {
      const runningExecutions = await this.db.all(
        "SELECT COUNT(*) as count FROM executions WHERE status IN ('running', 'starting')"
      );
      const currentCount = ((_a = runningExecutions[0]) == null ? void 0 : _a.count) || 0;
      const allowed = currentCount < this.limits.maxConcurrentExecutions;
      return {
        type: "concurrent_executions",
        allowed,
        current: currentCount,
        limit: this.limits.maxConcurrentExecutions,
        message: allowed ? null : `Maximum concurrent executions (${this.limits.maxConcurrentExecutions}) reached`
      };
    } catch (error) {
      logger$h.error("Failed to check concurrent executions:", error);
      return { type: "concurrent_executions", allowed: false, error: error.message };
    }
  }
  /**
   * Check disk usage in workspace
   */
  async checkDiskUsage() {
    try {
      const workspacePath = this.workspaceManager.getWorkspacePath();
      const usage = await this.calculateDirectorySize(workspacePath);
      const usageMB = usage / (1024 * 1024);
      const allowed = usageMB < this.limits.maxDiskUsageMB;
      return {
        type: "disk_usage",
        allowed,
        current: usageMB,
        limit: this.limits.maxDiskUsageMB,
        message: allowed ? null : `Disk usage (${usageMB.toFixed(2)}MB) exceeds limit (${this.limits.maxDiskUsageMB}MB)`
      };
    } catch (error) {
      logger$h.error("Failed to check disk usage:", error);
      return { type: "disk_usage", allowed: true, error: error.message };
    }
  }
  /**
   * Check system resources (memory, CPU if available)
   */
  async checkSystemResources() {
    try {
      const memUsage = process.memoryUsage();
      const memUsageMB = memUsage.heapUsed / (1024 * 1024);
      const memoryOk = memUsageMB < 512;
      return {
        type: "system_resources",
        allowed: memoryOk,
        memory: {
          heapUsed: memUsageMB,
          heapTotal: memUsage.heapTotal / (1024 * 1024),
          external: memUsage.external / (1024 * 1024)
        },
        message: memoryOk ? null : `High memory usage: ${memUsageMB.toFixed(2)}MB`
      };
    } catch (error) {
      logger$h.error("Failed to check system resources:", error);
      return { type: "system_resources", allowed: true, error: error.message };
    }
  }
  /**
   * Perform periodic resource check and cleanup
   */
  async performResourceCheck() {
    logger$h.debug("Performing resource check");
    try {
      const checks = await Promise.all([
        this.checkConcurrentExecutions(),
        this.checkDiskUsage(),
        this.checkSystemResources()
      ]);
      checks.forEach((check) => {
        if (!check.allowed && check.message) {
          logger$h.warn(`Resource limit warning: ${check.message}`);
        }
      });
      await this.checkLongRunningExecutions();
      await this.cleanupOldWorkspaces();
    } catch (error) {
      logger$h.error("Resource check failed:", error);
    }
  }
  /**
   * Check for executions that have been running too long
   */
  async checkLongRunningExecutions() {
    try {
      const cutoffTime = new Date(Date.now() - this.limits.maxExecutionTimeMinutes * 60 * 1e3);
      const longRunning = await this.db.all(
        "SELECT id, created_at FROM executions WHERE status = 'running' AND created_at < ?",
        [cutoffTime.toISOString()]
      );
      if (longRunning.length > 0) {
        logger$h.warn(`Found ${longRunning.length} long-running executions`);
        for (const execution of longRunning) {
          logger$h.warn(`Execution ${execution.id} has been running since ${execution.created_at}`);
          await this.db.run(
            "UPDATE executions SET needs_review = 1, review_reason = ? WHERE id = ?",
            [`Long-running execution (>${this.limits.maxExecutionTimeMinutes} minutes)`, execution.id]
          );
        }
      }
    } catch (error) {
      logger$h.error("Failed to check long-running executions:", error);
    }
  }
  /**
   * Clean up old workspace data
   */
  async cleanupOldWorkspaces() {
    try {
      const cutoffTime = new Date(Date.now() - this.limits.maxWorkspaceAgeDays * 24 * 60 * 60 * 1e3);
      const executionsDir = path.join(this.workspaceManager.getWorkspacePath(), ".execution");
      if (!await this.exists(executionsDir)) {
        return;
      }
      const entries = await promises.readdir(executionsDir, { withFileTypes: true });
      let cleanedCount = 0;
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("exec-")) {
          const executionPath = path.join(executionsDir, entry.name);
          const stat = await promises.stat(executionPath);
          if (stat.mtime < cutoffTime) {
            const executionId = entry.name.substring(5);
            const execution = await this.db.get(
              "SELECT status FROM executions WHERE id = ?",
              [executionId]
            );
            if (!execution || ["completed", "failed", "rolled_back"].includes(execution.status)) {
              logger$h.info(`Cleaning up old workspace: ${entry.name}`);
              await promises.rm(executionPath, { recursive: true, force: true });
              cleanedCount++;
            }
          }
        }
      }
      if (cleanedCount > 0) {
        logger$h.info(`Cleaned up ${cleanedCount} old workspace directories`);
      }
    } catch (error) {
      logger$h.error("Failed to cleanup old workspaces:", error);
    }
  }
  /**
   * Calculate total size of a directory
   */
  async calculateDirectorySize(dirPath) {
    let totalSize = 0;
    try {
      const entries = await promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(fullPath);
        } else {
          const stat = await promises.stat(fullPath);
          totalSize += stat.size;
        }
      }
    } catch (error) {
      logger$h.debug(`Error calculating directory size for ${dirPath}:`, error.message);
    }
    return totalSize;
  }
  /**
   * Check if file/directory exists
   */
  async exists(filePath) {
    try {
      await promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Get current resource usage report
   */
  async getResourceReport() {
    const checks = await Promise.all([
      this.checkConcurrentExecutions(),
      this.checkDiskUsage(),
      this.checkSystemResources()
    ]);
    return {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      limits: this.limits,
      usage: checks.reduce((acc, check) => {
        acc[check.type] = check;
        return acc;
      }, {}),
      healthy: checks.every((check) => check.allowed)
    };
  }
}
const logger$g = createLogger("AuditLogger");
class AuditLogger {
  constructor(db) {
    this.db = db;
  }
  /**
   * Log a Git operation with full context
   */
  async logGitOperation(operationData) {
    const {
      executionId = null,
      refId,
      operation,
      // 'clone', 'checkout', 'commit', 'merge', 'push', 'fetch', etc.
      branch = null,
      command,
      workingDir,
      success,
      duration,
      output = null,
      error = null,
      metadata = {}
    } = operationData;
    try {
      await this.db.run(`
        INSERT INTO git_operations_log (
          execution_id, ref_id, operation, branch, command, 
          working_dir, success, duration_ms, output, error, 
          metadata, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        executionId,
        refId,
        operation,
        branch,
        command,
        workingDir,
        success ? 1 : 0,
        duration,
        output,
        error,
        JSON.stringify(metadata)
      ]);
      logger$g.info(`Git operation logged: ${operation} on ${refId}`, {
        executionId,
        refId,
        operation,
        success,
        duration: `${duration}ms`
      });
    } catch (dbError) {
      logger$g.error("Failed to log Git operation:", dbError);
    }
  }
  /**
   * Log execution lifecycle events
   */
  async logExecutionEvent(eventData) {
    const {
      executionId,
      event,
      // 'started', 'workspace_setup', 'refs_configured', 'process_spawned', 'completed', 'failed', 'cleanup'
      phase = null,
      // 'initialization', 'execution', 'integration', 'cleanup'
      details = {},
      success = true,
      duration = null,
      error = null
    } = eventData;
    try {
      await this.db.run(`
        INSERT INTO execution_events_log (
          execution_id, event, phase, details, success, 
          duration_ms, error, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        executionId,
        event,
        phase,
        JSON.stringify(details),
        success ? 1 : 0,
        duration,
        error
      ]);
      logger$g.info(`Execution event logged: ${event}`, {
        executionId,
        event,
        phase,
        success
      });
    } catch (dbError) {
      logger$g.error("Failed to log execution event:", dbError);
    }
  }
  /**
   * Log resource usage metrics
   */
  async logResourceUsage(usageData) {
    const {
      type,
      // 'disk_usage', 'concurrent_executions', 'system_resources', 'execution_duration'
      currentValue,
      limitValue,
      exceeded,
      executionId = null,
      details = {}
    } = usageData;
    try {
      await this.db.run(`
        INSERT INTO resource_usage (
          type, current_value, limit_value, exceeded, 
          execution_id, details, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        type,
        currentValue,
        limitValue,
        exceeded ? 1 : 0,
        executionId,
        JSON.stringify(details)
      ]);
      if (exceeded) {
        logger$g.warn(`Resource limit exceeded: ${type}`, {
          type,
          current: currentValue,
          limit: limitValue,
          executionId
        });
      } else {
        logger$g.debug(`Resource usage logged: ${type}`, {
          type,
          current: currentValue,
          limit: limitValue
        });
      }
    } catch (dbError) {
      logger$g.error("Failed to log resource usage:", dbError);
    }
  }
  /**
   * Log performance metrics
   */
  async logPerformanceMetric(metricData) {
    const {
      executionId = null,
      operation,
      // 'git_operation', 'workspace_setup', 'file_read', 'integration', etc.
      duration,
      success,
      metadata = {}
    } = metricData;
    try {
      await this.db.run(`
        INSERT INTO performance_metrics (
          execution_id, operation, duration_ms, success, 
          metadata, timestamp
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        executionId,
        operation,
        duration,
        success ? 1 : 0,
        JSON.stringify(metadata)
      ]);
      if (duration > 5e3) {
        logger$g.warn(`Slow operation detected: ${operation}`, {
          executionId,
          operation,
          duration: `${duration}ms`,
          success
        });
      } else {
        logger$g.debug(`Performance metric logged: ${operation}`, {
          duration: `${duration}ms`,
          success
        });
      }
    } catch (dbError) {
      logger$g.error("Failed to log performance metric:", dbError);
    }
  }
  /**
   * Get audit trail for an execution
   */
  async getExecutionAuditTrail(executionId) {
    try {
      const [gitOps, events, resources, performance] = await Promise.all([
        this.db.all(`
          SELECT * FROM git_operations_log 
          WHERE execution_id = ? 
          ORDER BY timestamp
        `, [executionId]),
        this.db.all(`
          SELECT * FROM execution_events_log 
          WHERE execution_id = ? 
          ORDER BY timestamp
        `, [executionId]),
        this.db.all(`
          SELECT * FROM resource_usage 
          WHERE execution_id = ? 
          ORDER BY timestamp
        `, [executionId]),
        this.db.all(`
          SELECT * FROM performance_metrics 
          WHERE execution_id = ? 
          ORDER BY timestamp
        `, [executionId])
      ]);
      return {
        executionId,
        gitOperations: gitOps.map(this.parseLogRecord),
        events: events.map(this.parseLogRecord),
        resourceUsage: resources.map(this.parseLogRecord),
        performanceMetrics: performance.map(this.parseLogRecord)
      };
    } catch (error) {
      logger$g.error(`Failed to get audit trail for execution ${executionId}:`, error);
      throw error;
    }
  }
  /**
   * Get system-wide metrics summary
   */
  async getSystemMetrics(timeWindow = "24 hours") {
    try {
      const [gitOpStats, executionStats, resourceStats, perfStats] = await Promise.all([
        this.db.all(`
          SELECT 
            operation,
            COUNT(*) as total_operations,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_operations,
            AVG(duration_ms) as avg_duration_ms,
            MAX(duration_ms) as max_duration_ms
          FROM git_operations_log 
          WHERE timestamp > datetime('now', '-${timeWindow}')
          GROUP BY operation
        `),
        this.db.all(`
          SELECT 
            event,
            phase,
            COUNT(*) as total_events,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_events,
            AVG(duration_ms) as avg_duration_ms
          FROM execution_events_log 
          WHERE timestamp > datetime('now', '-${timeWindow}')
          GROUP BY event, phase
        `),
        this.db.all(`
          SELECT 
            type,
            AVG(current_value) as avg_usage,
            MAX(current_value) as peak_usage,
            COUNT(CASE WHEN exceeded = 1 THEN 1 END) as violations
          FROM resource_usage 
          WHERE timestamp > datetime('now', '-${timeWindow}')
          GROUP BY type
        `),
        this.db.all(`
          SELECT 
            operation,
            COUNT(*) as total_operations,
            AVG(duration_ms) as avg_duration_ms,
            MAX(duration_ms) as max_duration_ms,
            COUNT(CASE WHEN duration_ms > 5000 THEN 1 END) as slow_operations
          FROM performance_metrics 
          WHERE timestamp > datetime('now', '-${timeWindow}')
          GROUP BY operation
        `)
      ]);
      return {
        timeWindow,
        gitOperations: gitOpStats,
        executionEvents: executionStats,
        resourceUsage: resourceStats,
        performance: perfStats,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } catch (error) {
      logger$g.error("Failed to get system metrics:", error);
      throw error;
    }
  }
  /**
   * Parse log record and handle JSON fields
   */
  parseLogRecord(record) {
    const parsed = { ...record };
    ["metadata", "details"].forEach((field) => {
      if (parsed[field]) {
        try {
          parsed[field] = JSON.parse(parsed[field]);
        } catch (e) {
          logger$g.warn(`Failed to parse ${field} in log record:`, e);
        }
      }
    });
    return parsed;
  }
  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(retentionDays = 30) {
    const cutoffDate = `datetime('now', '-${retentionDays} days')`;
    try {
      const results = await Promise.all([
        this.db.run(`DELETE FROM git_operations_log WHERE timestamp < ${cutoffDate}`),
        this.db.run(`DELETE FROM execution_events_log WHERE timestamp < ${cutoffDate}`),
        this.db.run(`DELETE FROM resource_usage WHERE timestamp < ${cutoffDate}`),
        this.db.run(`DELETE FROM performance_metrics WHERE timestamp < ${cutoffDate}`)
      ]);
      const totalDeleted = results.reduce((sum, result) => sum + (result.changes || 0), 0);
      logger$g.info(`Cleaned up ${totalDeleted} old audit log records older than ${retentionDays} days`);
      return { deletedRecords: totalDeleted, retentionDays };
    } catch (error) {
      logger$g.error("Failed to cleanup old audit logs:", error);
      throw error;
    }
  }
}
const logger$f = createLogger("PerformanceMonitor");
class PerformanceMonitor {
  constructor(auditLogger = null) {
    this.auditLogger = auditLogger;
    this.activeOperations = /* @__PURE__ */ new Map();
    this.metrics = {
      operationCounts: /* @__PURE__ */ new Map(),
      averageDurations: /* @__PURE__ */ new Map(),
      errorCounts: /* @__PURE__ */ new Map()
    };
  }
  /**
   * Start timing an operation
   */
  startTiming(operationId, operation, metadata = {}) {
    const startTime = Date.now();
    this.activeOperations.set(operationId, {
      operation,
      startTime,
      metadata
    });
    logger$f.debug(`Started timing operation: ${operation}`, {
      operationId,
      operation,
      metadata
    });
    return operationId;
  }
  /**
   * End timing an operation
   */
  async endTiming(operationId, success = true, error = null, additionalMetadata = {}) {
    const operationData = this.activeOperations.get(operationId);
    if (!operationData) {
      logger$f.warn(`Operation ${operationId} not found in active operations`);
      return null;
    }
    const endTime = Date.now();
    const duration = endTime - operationData.startTime;
    this.updateMetrics(operationData.operation, duration, success);
    if (this.auditLogger) {
      const executionId = operationData.metadata.executionId || null;
      await this.auditLogger.logPerformanceMetric({
        executionId,
        operation: operationData.operation,
        duration,
        success,
        metadata: {
          ...operationData.metadata,
          ...additionalMetadata,
          error: (error == null ? void 0 : error.message) || null
        }
      });
    }
    this.activeOperations.delete(operationId);
    logger$f.debug(`Completed timing operation: ${operationData.operation}`, {
      operationId,
      operation: operationData.operation,
      duration: `${duration}ms`,
      success
    });
    return {
      operation: operationData.operation,
      duration,
      success,
      metadata: { ...operationData.metadata, ...additionalMetadata }
    };
  }
  /**
   * Instrument a function with automatic timing
   */
  async instrument(operation, fn, metadata = {}) {
    const operationId = this.generateOperationId();
    this.startTiming(operationId, operation, metadata);
    try {
      const result = await fn();
      await this.endTiming(operationId, true, null, { resultType: typeof result });
      return result;
    } catch (error) {
      await this.endTiming(operationId, false, error);
      throw error;
    }
  }
  /**
   * Instrument a Git operation specifically
   */
  async instrumentGitOperation(gitOperationData, fn) {
    const {
      executionId,
      refId,
      operation,
      branch,
      command,
      workingDir
    } = gitOperationData;
    const operationId = this.generateOperationId();
    const startTime = Date.now();
    this.startTiming(operationId, `git_${operation}`, {
      executionId,
      refId,
      operation,
      branch,
      command,
      workingDir
    });
    let output = null;
    let error = null;
    let success = false;
    try {
      output = await fn();
      success = true;
      return output;
    } catch (err) {
      error = err;
      success = false;
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      if (this.auditLogger) {
        await this.auditLogger.logGitOperation({
          ...gitOperationData,
          success,
          duration,
          output: typeof output === "string" ? output : null,
          error: (error == null ? void 0 : error.message) || null,
          metadata: {
            commandLength: command.length,
            hasOutput: !!output
          }
        });
      }
      await this.endTiming(operationId, success, error);
    }
  }
  /**
   * Update in-memory metrics
   */
  updateMetrics(operation, duration, success) {
    const currentCount = this.metrics.operationCounts.get(operation) || 0;
    this.metrics.operationCounts.set(operation, currentCount + 1);
    const currentAvg = this.metrics.averageDurations.get(operation) || { total: 0, count: 0 };
    currentAvg.total += duration;
    currentAvg.count += 1;
    this.metrics.averageDurations.set(operation, currentAvg);
    if (!success) {
      const currentErrors = this.metrics.errorCounts.get(operation) || 0;
      this.metrics.errorCounts.set(operation, currentErrors + 1);
    }
  }
  /**
   * Get current performance metrics
   */
  getMetrics() {
    const metrics = {};
    for (const [operation, count] of this.metrics.operationCounts) {
      const avgData = this.metrics.averageDurations.get(operation) || { total: 0, count: 0 };
      const errorCount = this.metrics.errorCounts.get(operation) || 0;
      metrics[operation] = {
        totalOperations: count,
        averageDuration: avgData.count > 0 ? Math.round(avgData.total / avgData.count) : 0,
        totalDuration: avgData.total,
        errorCount,
        successRate: count > 0 ? ((count - errorCount) / count * 100).toFixed(2) + "%" : "100%"
      };
    }
    return {
      metrics,
      activeOperations: this.activeOperations.size,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  /**
   * Get slow operations report
   */
  getSlowOperations(thresholdMs = 5e3) {
    const slowOps = [];
    for (const [operation, avgData] of this.metrics.averageDurations) {
      const avgDuration = avgData.count > 0 ? avgData.total / avgData.count : 0;
      if (avgDuration > thresholdMs) {
        slowOps.push({
          operation,
          averageDuration: Math.round(avgDuration),
          totalOperations: avgData.count,
          totalDuration: avgData.total
        });
      }
    }
    return slowOps.sort((a, b) => b.averageDuration - a.averageDuration);
  }
  /**
   * Reset metrics (useful for testing or periodic resets)
   */
  resetMetrics() {
    this.metrics = {
      operationCounts: /* @__PURE__ */ new Map(),
      averageDurations: /* @__PURE__ */ new Map(),
      errorCounts: /* @__PURE__ */ new Map()
    };
    logger$f.info("Performance metrics reset");
  }
  /**
   * Generate unique operation ID
   */
  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  /**
   * Get summary of active operations
   */
  getActiveOperations() {
    const operations = [];
    const now = Date.now();
    for (const [operationId, data] of this.activeOperations) {
      operations.push({
        operationId,
        operation: data.operation,
        duration: now - data.startTime,
        metadata: data.metadata
      });
    }
    return operations.sort((a, b) => b.duration - a.duration);
  }
  /**
   * Check for stuck operations (running too long)
   */
  getStuckOperations(thresholdMs = 3e5) {
    const now = Date.now();
    const stuckOps = [];
    for (const [operationId, data] of this.activeOperations) {
      const duration = now - data.startTime;
      if (duration > thresholdMs) {
        stuckOps.push({
          operationId,
          operation: data.operation,
          duration,
          startTime: new Date(data.startTime).toISOString(),
          metadata: data.metadata
        });
      }
    }
    if (stuckOps.length > 0) {
      logger$f.warn(`Found ${stuckOps.length} potentially stuck operations`, { stuckOps });
    }
    return stuckOps;
  }
}
let query;
const logger$e = createLogger("ClaudeSDKManager");
class ClaudeSDKManager {
  constructor(db, config2, eventEmitter, workspaceManager) {
    this.db = db;
    this.config = config2;
    this.eventEmitter = eventEmitter;
    this.workspaceManager = workspaceManager;
    this.activeSessions = /* @__PURE__ */ new Map();
    this.pendingMessages = /* @__PURE__ */ new Map();
    this.sdkLoaded = false;
    this.loadSDK();
  }
  async loadSDK() {
    try {
      const claudeSDK = await import("@anthropic-ai/claude-code");
      query = claudeSDK.query;
      this.sdkLoaded = true;
      logger$e.info("Claude SDK loaded successfully");
    } catch (error) {
      logger$e.error("Failed to load Claude SDK", { error });
      throw new Error("Claude SDK not available");
    }
  }
  /**
   * Emit execution phase updates for frontend tracking
   */
  async emitPhaseUpdate(executionId, phase, message) {
    const phaseMessage = {
      type: "system",
      subtype: "phase",
      phase,
      message,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.db.run(
      "INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)",
      [executionId, LogType.SYSTEM, JSON.stringify(phaseMessage)]
    );
    this.eventEmitter.emit(Events.LOG_ENTRY, {
      executionId,
      timestamp: phaseMessage.timestamp,
      type: LogType.SYSTEM,
      content: JSON.stringify(phaseMessage)
    });
    logger$e.info("Emitted phase update", { executionId, phase, message });
  }
  async updateHeartbeat(executionId) {
    await this.db.run(
      "UPDATE executions SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?",
      [executionId]
    );
  }
  async startExecution(executionId, prompt, workingDir, options = {}) {
    if (!this.sdkLoaded) {
      await this.loadSDK();
    }
    if (this.activeSessions.has(executionId)) {
      if (options.isResume) {
        logger$e.info("Cleaning up existing session for resume", { executionId });
      } else {
        logger$e.warn("Execution already has an active session, stopping existing and starting new", { executionId });
      }
      await this.stopExecution(executionId);
    }
    try {
      const workspacePath = this.workspaceManager ? this.workspaceManager.getWorkspacePath() : process.cwd();
      const executionCwd = path.join(workspacePath, ".execution", `exec-${executionId}`);
      fs.mkdirSync(executionCwd, { recursive: true });
      if (options.isResume) {
        logger$e.info("Resuming Claude SDK execution", {
          executionId,
          executionCwd,
          sessionId: options.sessionId,
          action: "session_resume"
        });
      } else {
        logger$e.info("Starting Claude SDK execution", {
          executionId,
          executionCwd,
          providedWorkingDir: workingDir,
          action: "new_execution"
        });
      }
      const abortController = new AbortController();
      const queryOptions = {
        prompt,
        abortController,
        options: {
          verbose: true,
          print: true,
          outputFormat: "stream-json",
          permissionMode: "bypassPermissions",
          cwd: executionCwd,
          ...options
        }
      };
      logger$e.info("Claude SDK query options", {
        executionId,
        cwd: executionCwd,
        queryOptions
      });
      if (options.sessionId) {
        queryOptions.options.resume = options.sessionId;
        logger$e.info("Resuming existing session", { executionId, sessionId: options.sessionId });
      }
      this.activeSessions.set(executionId, {
        sessionId: null,
        abortController,
        messageCount: 0,
        startTime: Date.now()
      });
      await this.updateExecutionStatus(executionId, ExecutionStatus.RUNNING);
      this.processExecution(executionId, queryOptions).catch((error) => {
        logger$e.error("Execution processing error", { executionId, error });
        this.handleExecutionError(executionId, error);
      });
      return true;
    } catch (error) {
      logger$e.error("Failed to start execution", { executionId, error });
      await this.updateExecutionStatus(executionId, ExecutionStatus.FAILED);
      throw error;
    }
  }
  async processExecution(executionId, queryOptions) {
    const session = this.activeSessions.get(executionId);
    if (!session) {
      throw new Error("Session not found");
    }
    try {
      let heartbeatCounter = 0;
      for await (const message of query(queryOptions)) {
        session.messageCount++;
        heartbeatCounter++;
        if (heartbeatCounter % 10 === 0) {
          await this.updateHeartbeat(executionId);
        }
        await this.handleMessage(executionId, message);
        if (message.type === "system" && message.subtype === "init" && message.session_id) {
          session.sessionId = message.session_id;
          await this.db.run(
            "UPDATE executions SET session_id = ? WHERE id = ?",
            [message.session_id, executionId]
          );
        }
        if (message.type === "result") {
          await this.handleExecutionComplete(executionId, message);
        }
      }
    } catch (error) {
      if (error.name === "AbortError") {
        logger$e.info("Execution aborted", { executionId });
        await this.updateExecutionStatus(executionId, ExecutionStatus.CANCELLED);
      } else {
        throw error;
      }
    }
  }
  async handleMessage(executionId, message) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    logger$e.debug("Received message", {
      executionId,
      type: message.type,
      subtype: message.subtype,
      message
    });
    const messageStr = JSON.stringify(message).toLowerCase();
    if (messageStr.includes("prompt is too long")) {
      logger$e.warn('DEBUG: Found "Prompt is too long" in message', {
        executionId,
        messageType: message.type,
        messageSubtype: message.subtype,
        messageContent: JSON.stringify(message, null, 2)
      });
    }
    let logType = LogType.STDOUT;
    switch (message.type) {
      case "system":
      case "result":
        logType = LogType.SYSTEM;
        break;
      case "error":
        logType = LogType.STDERR;
        break;
      default:
        logType = LogType.STDOUT;
        break;
    }
    await this.db.run(
      "INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)",
      [executionId, logType, JSON.stringify(message)]
    );
    this.eventEmitter.emit(Events.LOG_ENTRY, {
      executionId,
      timestamp,
      type: logType,
      content: JSON.stringify(message)
    });
  }
  async sendMessage(executionId, message) {
    console.log("Sending message to execution", { executionId, message });
    const execution = await this.db.get(
      "SELECT * FROM executions WHERE id = ?",
      [executionId]
    );
    console.log("Execution found", { execution });
    if (!execution) {
      throw new Error(ErrorCodes.EXECUTION_NOT_FOUND);
    }
    if (!execution.session_id) {
      throw new Error("No session ID found for execution");
    }
    this.pendingMessages.set(executionId, message);
    await this.startExecution(executionId, message, null, {
      sessionId: execution.session_id
    });
    return true;
  }
  async stopExecution(executionId) {
    const session = this.activeSessions.get(executionId);
    if (!session) {
      return false;
    }
    logger$e.info("Stopping execution", { executionId });
    if (session.abortController) {
      session.abortController.abort();
    }
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
    const errorMessage = error.message || error.toString() || "";
    return errorMessage.toLowerCase().includes("prompt is too long");
  }
  /**
   * Wait for compact operation to complete
   */
  async waitForCompactCompletion(executionId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger$e.error("Compact operation timed out", { executionId });
        reject(new Error("Compact operation timed out"));
      }, 12e4);
      logger$e.info("Setting up compact completion listener", { executionId });
      const completionHandler = ({ executionId: completedId, code, result }) => {
        logger$e.info("Received PROCESS_EXIT event", {
          completedId,
          targetExecutionId: executionId,
          code,
          hasResult: !!result
        });
        if (completedId === executionId) {
          clearTimeout(timeout);
          this.eventEmitter.off(Events.PROCESS_EXIT, completionHandler);
          if (code === 0 || result && !result.is_error) {
            logger$e.info("Compact operation completed successfully", { executionId });
            resolve();
          } else {
            logger$e.error("Compact operation failed", { executionId, code, result });
            reject(new Error("Compact operation failed"));
          }
        }
      };
      const checkCompletion = setInterval(() => {
        if (!this.activeSessions.has(executionId)) {
          logger$e.info("Compact session no longer active, assuming completion", { executionId });
          clearTimeout(timeout);
          clearInterval(checkCompletion);
          this.eventEmitter.off(Events.PROCESS_EXIT, completionHandler);
          resolve();
        }
      }, 1e3);
      this.eventEmitter.on(Events.PROCESS_EXIT, completionHandler);
    });
  }
  /**
   * Compact conversation and retry with original message
   */
  async compactAndRetry(executionId, originalMessage, sessionId) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const compactStartMessage = {
        type: "assistant",
        message: {
          id: `msg_compact_start_${Date.now()}`,
          type: "message",
          role: "assistant",
          model: "claude-code-system",
          content: [{
            type: "text",
            text: "🔄 Compacting conversation to reduce context length..."
          }],
          stop_reason: null,
          stop_sequence: null,
          usage: null
        },
        parent_tool_use_id: null,
        session_id: sessionId
      };
      await this.db.run(
        "INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)",
        [executionId, LogType.SYSTEM, JSON.stringify(compactStartMessage)]
      );
      this.eventEmitter.emit(Events.LOG_ENTRY, {
        executionId,
        timestamp,
        type: LogType.SYSTEM,
        content: JSON.stringify(compactStartMessage)
      });
      logger$e.info("Starting conversation compact", { executionId, action: "compact_start" });
      logger$e.info("Sending /compact command", { executionId, sessionId });
      await this.startExecution(executionId, "/compact", null, {
        sessionId,
        isCompact: true
      });
      logger$e.info("Compact command sent, waiting for completion...", { executionId });
      await this.waitForCompactCompletion(executionId);
      logger$e.info("Compact wait completed", { executionId });
      const compactCompleteMessage = {
        type: "assistant",
        message: {
          id: `msg_compact_complete_${Date.now()}`,
          type: "message",
          role: "assistant",
          model: "claude-code-system",
          content: [{
            type: "text",
            text: "✅ Conversation compacted successfully. Sending original message..."
          }],
          stop_reason: null,
          stop_sequence: null,
          usage: null
        },
        parent_tool_use_id: null,
        session_id: sessionId
      };
      await this.db.run(
        "INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)",
        [executionId, LogType.SYSTEM, JSON.stringify(compactCompleteMessage)]
      );
      this.eventEmitter.emit(Events.LOG_ENTRY, {
        executionId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        type: LogType.SYSTEM,
        content: JSON.stringify(compactCompleteMessage)
      });
      logger$e.info("Compact completed, sending original message", { executionId, action: "compact_complete" });
      await this.startExecution(executionId, originalMessage, null, { sessionId });
    } catch (error) {
      logger$e.error("Compact and retry failed", { executionId, error });
      const errorMessage = {
        type: "assistant",
        message: {
          id: `msg_compact_error_${Date.now()}`,
          type: "message",
          role: "assistant",
          model: "claude-code-system",
          content: [{
            type: "text",
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
        "INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)",
        [executionId, LogType.SYSTEM, JSON.stringify(errorMessage)]
      );
      this.eventEmitter.emit(Events.LOG_ENTRY, {
        executionId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        type: LogType.SYSTEM,
        content: JSON.stringify(errorMessage)
      });
      throw error;
    }
  }
  async updateExecutionStatus(executionId, status) {
    const updates = ["status = ?"];
    const params = [status];
    if (status === ExecutionStatus.COMPLETED || status === ExecutionStatus.FAILED) {
      updates.push("completed_at = CURRENT_TIMESTAMP");
    }
    params.push(executionId);
    await this.db.run(
      `UPDATE executions SET ${updates.join(", ")} WHERE id = ?`,
      params
    );
  }
  async handleExecutionComplete(executionId, result) {
    logger$e.info("Execution completed", {
      executionId,
      turns: result.num_turns,
      duration: result.duration_ms,
      cost: result.total_cost_usd
    });
    logger$e.info("DEBUG: Complete result object structure", {
      executionId,
      resultKeys: Object.keys(result),
      resultType: typeof result,
      isError: result.is_error,
      hasResult: !!result.result,
      resultValueType: typeof result.result,
      resultContent: result.result ? result.result.toString().substring(0, 200) : "null",
      resultIncludes: result.result ? result.result.toLowerCase().includes("prompt is too long") : false,
      fullResult: JSON.stringify(result, null, 2)
    });
    const isPromptTooLong = result.is_error && result.result && result.result.toLowerCase().includes("prompt is too long");
    logger$e.info("DEBUG: Prompt too long check", {
      executionId,
      isPromptTooLong,
      isError: result.is_error,
      hasResult: !!result.result,
      resultLowerCase: result.result ? result.result.toLowerCase() : "null"
    });
    if (isPromptTooLong) {
      logger$e.warn("Detected prompt too long error, attempting compact and retry", { executionId });
      const originalMessage = this.pendingMessages.get(executionId);
      if (originalMessage) {
        try {
          const execution = await this.db.get(
            "SELECT session_id FROM executions WHERE id = ?",
            [executionId]
          );
          if (execution && execution.session_id) {
            this.activeSessions.delete(executionId);
            this.pendingMessages.delete(executionId);
            await this.compactAndRetry(executionId, originalMessage, execution.session_id);
            return;
          }
        } catch (error) {
          logger$e.error("Failed to compact and retry", { executionId, error });
        }
      }
    }
    this.pendingMessages.delete(executionId);
    await this.db.run(
      `UPDATE executions SET 
        status = ?, 
        completed_at = CURRENT_TIMESTAMP,
        message_count = ?,
        total_cost = ?
      WHERE id = ?`,
      [ExecutionStatus.COMPLETED, result.num_turns, result.total_cost_usd, executionId]
    );
    this.eventEmitter.emit(Events.PROCESS_EXIT, {
      executionId,
      code: 0,
      signal: null,
      result
    });
    this.activeSessions.delete(executionId);
  }
  async handleExecutionError(executionId, error) {
    logger$e.error("Execution error", { executionId, error });
    await this.updateExecutionStatus(executionId, ExecutionStatus.FAILED);
    await this.db.run(
      "INSERT INTO logs (execution_id, type, content) VALUES (?, ?, ?)",
      [executionId, LogType.SYSTEM, `Execution error: ${error.message}`]
    );
    this.eventEmitter.emit(Events.PROCESS_ERROR, { executionId, error });
    this.activeSessions.delete(executionId);
    this.pendingMessages.delete(executionId);
  }
  /**
   * Resume a Claude SDK session after server restart
   */
  async resumeSession(executionId, sessionId) {
    logger$e.info("Resuming Claude SDK session", { executionId, sessionId });
    try {
      const execution = await this.db.get(
        "SELECT * FROM executions WHERE id = ?",
        [executionId]
      );
      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }
      const workspacePath = this.workspaceManager ? this.workspaceManager.getWorkspacePath() : process.cwd();
      const executionCwd = path.join(workspacePath, ".execution", `exec-${executionId}`);
      const resumePrompt = "Resuming session after server restart. Continue with the current task.";
      await this.startExecution(executionId, resumePrompt, executionCwd, {
        sessionId,
        maxTurns: 50,
        // Allow more turns for resumed sessions
        isResume: true
        // Flag this as a session resumption
      });
      logger$e.info("Successfully resumed session", { executionId, sessionId });
      return true;
    } catch (error) {
      logger$e.error("Failed to resume session", { executionId, sessionId, error });
      await this.updateExecutionStatus(executionId, ExecutionStatus.FAILED);
      throw error;
    }
  }
}
const logger$d = createLogger("portAllocator");
class PortAllocator {
  constructor(db) {
    this.db = db;
    this.basePort = 3e3;
    this.maxPort = 9e3;
  }
  async allocatePort(preferredPort = null) {
    try {
      if (preferredPort) {
        logger$d.info(`Checking if preferred port ${preferredPort} is available`);
        const isAvailable = await this.isPortAvailable(preferredPort);
        logger$d.info(`Port ${preferredPort} available: ${isAvailable}`);
        if (isAvailable) {
          await this.markPortAllocated(preferredPort);
          return preferredPort;
        }
      }
      logger$d.info(`Searching for available port starting from ${this.basePort}`);
      for (let port = this.basePort; port <= this.maxPort; port++) {
        const isAvailable = await this.isPortAvailable(port);
        if (isAvailable) {
          logger$d.info(`Found available port: ${port}`);
          await this.markPortAllocated(port);
          return port;
        }
      }
      throw new Error("No available ports in the configured range");
    } catch (error) {
      logger$d.error("Error allocating port:", error);
      throw error;
    }
  }
  async releasePort(port) {
    try {
      await this.db.run("DELETE FROM port_allocations WHERE port = ?", [port]);
      logger$d.info(`Released port ${port}`);
    } catch (error) {
      logger$d.error(`Error releasing port ${port}:`, error);
      throw error;
    }
  }
  async releasePortsByPreviewId(previewId) {
    try {
      await this.db.run("DELETE FROM port_allocations WHERE preview_id = ?", [previewId]);
      logger$d.info(`Released all ports for preview ${previewId}`);
    } catch (error) {
      logger$d.error(`Error releasing ports for preview ${previewId}:`, error);
      throw error;
    }
  }
  async isPortAvailable(port) {
    const dbAllocated = await this.isPortAllocatedInDb(port);
    if (dbAllocated) {
      return false;
    }
    const interfacesToTest = ["127.0.0.1", "0.0.0.0"];
    for (const host of interfacesToTest) {
      const available = await this.checkPortOnInterface(port, host);
      if (!available) {
        logger$d.info(`Port ${port} is not available on ${host}`);
        return false;
      }
    }
    return true;
  }
  async checkPortOnInterface(port, host) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
        } else {
          resolve(false);
        }
      });
      server.once("listening", () => {
        server.close(() => {
          resolve(true);
        });
      });
      try {
        server.listen(port, host);
      } catch (error) {
        resolve(false);
      }
    });
  }
  async isPortAllocatedInDb(port) {
    const result = await this.db.get(
      "SELECT port FROM port_allocations WHERE port = ?",
      [port]
    );
    return !!result;
  }
  async markPortAllocated(port, previewId) {
    await this.db.run(
      "INSERT INTO port_allocations (port, preview_id) VALUES (?, ?)",
      [port, previewId || "pending"]
    );
  }
  async updatePortAllocation(port, previewId) {
    await this.db.run(
      "UPDATE port_allocations SET preview_id = ? WHERE port = ?",
      [previewId, port]
    );
  }
  async getAllocatedPorts() {
    const rows = await this.db.all(
      "SELECT port, preview_id, allocated_at FROM port_allocations ORDER BY port"
    );
    return rows;
  }
  async cleanupStaleAllocations() {
    try {
      const staleAllocations = await this.db.all(`
        SELECT pa.port, pa.preview_id
        FROM port_allocations pa
        LEFT JOIN preview_processes pp ON pa.preview_id = pp.id
        WHERE pp.id IS NULL OR pp.status IN ('stopped', 'failed')
      `);
      for (const allocation of staleAllocations) {
        await this.releasePort(allocation.port);
      }
      logger$d.info(`Cleaned up ${staleAllocations.length} stale port allocations`);
      return staleAllocations.length;
    } catch (error) {
      logger$d.error("Error cleaning up stale allocations:", error);
      throw error;
    }
  }
}
const logger$c = createLogger("projectAnalyzer");
class ProjectAnalyzer {
  constructor() {
    this.frameworkDetection = {
      node: {
        react: ["react", "react-dom", "react-scripts"],
        vue: ["vue", "@vue/cli-service"],
        angular: ["@angular/core", "@angular/cli"],
        nextjs: ["next", "react", "react-dom"],
        express: ["express"],
        nestjs: ["@nestjs/core", "@nestjs/common"],
        gatsby: ["gatsby"],
        nuxt: ["nuxt"],
        svelte: ["svelte", "@sveltejs/kit"],
        vite: ["vite"]
      }
    };
    this.defaultPorts = {
      react: 3e3,
      vue: 8080,
      angular: 4200,
      nextjs: 3e3,
      express: 3e3,
      nestjs: 3e3,
      gatsby: 8e3,
      nuxt: 3e3,
      svelte: 5173,
      vite: 5173,
      django: 8e3,
      flask: 5e3,
      fastapi: 8e3
    };
    this.scriptPriority = ["dev", "develop", "start", "serve", "preview"];
  }
  async detectProjectType(workingDir) {
    try {
      const analysis = {
        projectType: "unknown",
        framework: null,
        configFiles: {
          packageJson: false,
          packageLock: false,
          yarnLock: false,
          pnpmLock: false,
          requirements: false,
          pipfile: false,
          pyprojectToml: false,
          dockerfile: false,
          indexHtml: false
        },
        dependencies: {},
        devDependencies: {}
      };
      const files = await promises.readdir(workingDir);
      for (const file of files) {
        switch (file) {
          case "package.json":
            analysis.configFiles.packageJson = true;
            const packageData = await this.readPackageJson(workingDir);
            if (packageData) {
              analysis.dependencies = packageData.dependencies || {};
              analysis.devDependencies = packageData.devDependencies || {};
              analysis.projectType = "node";
              analysis.framework = this.detectNodeFramework(packageData);
            }
            break;
          case "package-lock.json":
            analysis.configFiles.packageLock = true;
            break;
          case "yarn.lock":
            analysis.configFiles.yarnLock = true;
            break;
          case "pnpm-lock.yaml":
            analysis.configFiles.pnpmLock = true;
            break;
          case "requirements.txt":
            analysis.configFiles.requirements = true;
            if (analysis.projectType === "unknown") {
              analysis.projectType = "python";
              analysis.framework = await this.detectPythonFramework(workingDir);
            }
            break;
          case "Pipfile":
            analysis.configFiles.pipfile = true;
            if (analysis.projectType === "unknown") {
              analysis.projectType = "python";
            }
            break;
          case "pyproject.toml":
            analysis.configFiles.pyprojectToml = true;
            if (analysis.projectType === "unknown") {
              analysis.projectType = "python";
            }
            break;
          case "Dockerfile":
            analysis.configFiles.dockerfile = true;
            break;
          case "index.html":
            analysis.configFiles.indexHtml = true;
            if (analysis.projectType === "unknown") {
              analysis.projectType = "static";
            }
            break;
        }
      }
      return analysis;
    } catch (error) {
      logger$c.error("Error detecting project type:", error);
      return {
        projectType: "unknown",
        framework: null,
        configFiles: {},
        dependencies: {},
        devDependencies: {}
      };
    }
  }
  async readPackageJson(workingDir) {
    try {
      const packageJsonPath = path.join(workingDir, "package.json");
      const content = await promises.readFile(packageJsonPath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      logger$c.error("Error reading package.json:", error);
      return null;
    }
  }
  detectNodeFramework(packageData) {
    const allDeps = {
      ...packageData.dependencies,
      ...packageData.devDependencies
    };
    for (const [framework, indicators] of Object.entries(this.frameworkDetection.node)) {
      if (indicators.some((dep) => dep in allDeps)) {
        return framework;
      }
    }
    return null;
  }
  async detectPythonFramework(workingDir) {
    try {
      const requirementsPath = path.join(workingDir, "requirements.txt");
      const content = await promises.readFile(requirementsPath, "utf8");
      const lines = content.toLowerCase().split("\n");
      if (lines.some((line) => line.includes("django"))) {
        return "django";
      }
      if (lines.some((line) => line.includes("flask"))) {
        return "flask";
      }
      if (lines.some((line) => line.includes("fastapi"))) {
        return "fastapi";
      }
    } catch (error) {
      logger$c.debug("Could not detect Python framework:", error.message);
    }
    return null;
  }
  async getAvailableScripts(workingDir, projectType) {
    const scripts = {};
    if (projectType === "node") {
      const packageData = await this.readPackageJson(workingDir);
      if (packageData && packageData.scripts) {
        Object.assign(scripts, packageData.scripts);
      }
    } else if (projectType === "python") {
      const framework = await this.detectPythonFramework(workingDir);
      if (framework === "django") {
        scripts.runserver = "python manage.py runserver";
      } else if (framework === "flask") {
        scripts.run = "flask run";
      } else if (framework === "fastapi") {
        scripts.dev = "uvicorn main:app --reload";
      }
    } else if (projectType === "static") {
      scripts.serve = "python -m http.server";
    }
    return scripts;
  }
  getSuggestedCommand(scripts) {
    for (const priority of this.scriptPriority) {
      if (scripts[priority]) {
        return priority;
      }
    }
    const scriptNames = Object.keys(scripts);
    if (scriptNames.length > 0) {
      return scriptNames[0];
    }
    return null;
  }
  async detectPort(workingDir, script, framework) {
    var _a;
    let detectedPort = null;
    if (framework && this.defaultPorts[framework]) {
      detectedPort = this.defaultPorts[framework];
    }
    try {
      const packageData = await this.readPackageJson(workingDir);
      if (packageData) {
        if (packageData.config && packageData.config.port) {
          detectedPort = packageData.config.port;
        }
        const scriptContent = (_a = packageData.scripts) == null ? void 0 : _a[script];
        if (scriptContent) {
          const portMatch = scriptContent.match(/--port[= ](\d+)|-p[= ](\d+)/);
          if (portMatch) {
            detectedPort = parseInt(portMatch[1] || portMatch[2]);
          }
          const envPortMatch = scriptContent.match(/PORT=(\d+)/);
          if (envPortMatch) {
            detectedPort = parseInt(envPortMatch[1]);
          }
        }
      }
      const envFiles = [".env", ".env.local", ".env.development"];
      for (const envFile of envFiles) {
        try {
          const envPath = path.join(workingDir, envFile);
          const envContent = await promises.readFile(envPath, "utf8");
          const portMatch = envContent.match(/^PORT=(\d+)/m);
          if (portMatch) {
            detectedPort = parseInt(portMatch[1]);
            break;
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      logger$c.debug("Error detecting port:", error.message);
    }
    return detectedPort || this.defaultPorts[framework] || 3e3;
  }
  async checkDependenciesInstalled(workingDir, projectType) {
    if (projectType === "node") {
      try {
        await promises.access(path.join(workingDir, "node_modules"));
        return true;
      } catch {
        return false;
      }
    } else if (projectType === "python") {
      try {
        await promises.access(path.join(workingDir, "venv"));
        return true;
      } catch {
        try {
          await promises.access(path.join(workingDir, ".venv"));
          return true;
        } catch {
          return false;
        }
      }
    }
    return true;
  }
  detectPackageManager(configFiles) {
    if (configFiles.yarnLock) return "yarn";
    if (configFiles.pnpmLock) return "pnpm";
    if (configFiles.packageLock) return "npm";
    if (configFiles.packageJson) return "npm";
    if (configFiles.pipfile) return "pipenv";
    if (configFiles.requirements) return "pip";
    return null;
  }
}
const logger$b = createLogger("healthChecker");
class HealthChecker {
  constructor() {
    this.defaultTimeout = 5e3;
    this.maxAttempts = 30;
    this.initialDelay = 1e3;
    this.maxDelay = 5e3;
  }
  async checkHealth(url, timeout = this.defaultTimeout) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? https : http;
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: "GET",
        timeout,
        headers: {
          "User-Agent": "AI-Agent-Wrapper-HealthChecker/1.0"
        }
      };
      const req = client.request(options, (res) => {
        const responseTime = Date.now() - startTime;
        res.on("data", () => {
        });
        res.on("end", () => {
          resolve({
            responsive: true,
            statusCode: res.statusCode,
            responseTime,
            headers: res.headers
          });
        });
      });
      req.on("error", (error) => {
        logger$b.debug(`Health check failed for ${url}:`, error.message);
        resolve({
          responsive: false,
          error: error.message,
          responseTime: Date.now() - startTime
        });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve({
          responsive: false,
          error: "Request timeout",
          responseTime: timeout
        });
      });
      req.end();
    });
  }
  async waitForServer(url, options = {}) {
    const maxAttempts = options.maxAttempts || this.maxAttempts;
    const initialDelay = options.initialDelay || this.initialDelay;
    const maxDelay = options.maxDelay || this.maxDelay;
    const timeout = options.timeout || this.defaultTimeout;
    const acceptedStatusCodes = options.acceptedStatusCodes || [200, 201, 202, 204, 301, 302, 303, 304, 307, 308];
    logger$b.info(`Waiting for server at ${url} to become responsive...`);
    let attempt = 0;
    let delay = initialDelay;
    while (attempt < maxAttempts) {
      attempt++;
      const health = await this.checkHealth(url, timeout);
      if (health.responsive) {
        if (acceptedStatusCodes.includes(health.statusCode)) {
          logger$b.info(`Server at ${url} is responsive (attempt ${attempt}/${maxAttempts})`);
          return {
            success: true,
            attempts: attempt,
            health
          };
        } else {
          logger$b.debug(`Server responded with unexpected status ${health.statusCode}`);
        }
      }
      if (attempt < maxAttempts) {
        logger$b.debug(`Server not ready, waiting ${delay}ms before retry (attempt ${attempt}/${maxAttempts})`);
        await this.sleep(delay);
        delay = Math.min(delay * 1.5, maxDelay);
      }
    }
    logger$b.error(`Server at ${url} failed to become responsive after ${maxAttempts} attempts`);
    return {
      success: false,
      attempts: attempt,
      error: "Maximum attempts reached"
    };
  }
  async checkMultipleUrls(urls, timeout = this.defaultTimeout) {
    const checks = urls.map(
      (url) => this.checkHealth(url, timeout).then((result) => ({
        url,
        ...result
      }))
    );
    return Promise.all(checks);
  }
  async findResponsiveUrl(urls, options = {}) {
    for (const url of urls) {
      const result = await this.waitForServer(url, { ...options, maxAttempts: 5 });
      if (result.success) {
        return {
          url,
          ...result
        };
      }
    }
    return {
      success: false,
      error: "No responsive URL found"
    };
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  buildHealthReport(health) {
    if (!health.responsive) {
      return {
        status: "down",
        message: health.error || "Server not responding",
        responseTime: health.responseTime
      };
    }
    if (health.statusCode >= 200 && health.statusCode < 300) {
      return {
        status: "healthy",
        message: "Server is responding normally",
        statusCode: health.statusCode,
        responseTime: health.responseTime
      };
    }
    if (health.statusCode >= 300 && health.statusCode < 400) {
      return {
        status: "redirect",
        message: "Server is redirecting",
        statusCode: health.statusCode,
        responseTime: health.responseTime,
        location: health.headers.location
      };
    }
    if (health.statusCode >= 400 && health.statusCode < 500) {
      return {
        status: "client_error",
        message: "Client error",
        statusCode: health.statusCode,
        responseTime: health.responseTime
      };
    }
    if (health.statusCode >= 500) {
      return {
        status: "server_error",
        message: "Server error",
        statusCode: health.statusCode,
        responseTime: health.responseTime
      };
    }
    return {
      status: "unknown",
      message: "Unknown status",
      statusCode: health.statusCode,
      responseTime: health.responseTime
    };
  }
}
const logger$a = createLogger("previewManager");
class PreviewManager {
  constructor(db, processManager, eventEmitter) {
    this.db = db;
    this.processManager = processManager;
    this.eventEmitter = eventEmitter;
    this.portAllocator = new PortAllocator(db);
    this.projectAnalyzer = new ProjectAnalyzer();
    this.healthChecker = new HealthChecker();
    this.previewProcesses = /* @__PURE__ */ new Map();
    this.sseConnections = /* @__PURE__ */ new Map();
    this.healthCheckInterval = 12e4;
    this.maxRestartAttempts = 1;
    this.restartDelay = 5e3;
    this.errorPatterns = [
      // Build/compilation errors
      /error TS\d+:/i,
      // TypeScript errors
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
    this.recentErrors = /* @__PURE__ */ new Map();
    this.executionErrors = /* @__PURE__ */ new Map();
    this.errorBufferDelay = 2e3;
    this.startHealthMonitoring();
  }
  async analyzeProject(executionId, options = {}) {
    try {
      const execution = await this.db.get(
        "SELECT * FROM executions WHERE id = ?",
        [executionId]
      );
      if (!execution) {
        throw new Error("Execution not found");
      }
      let workingDir = execution.working_dir;
      if (options.refType && options.refId) {
        const baseWorkspace = execution.workspace_path || execution.working_dir;
        workingDir = path.join(baseWorkspace, options.refType, options.refId);
        logger$a.info(`Using reference-specific directory: ${workingDir}`);
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
      logger$a.error(`Error analyzing project for execution ${executionId}:`, error);
      throw error;
    }
  }
  async startPreview(executionId, options = {}) {
    try {
      const execution = await this.db.get(
        "SELECT * FROM executions WHERE id = ?",
        [executionId]
      );
      if (!execution) {
        throw new Error("Execution not found");
      }
      if (options.refType && options.refId) {
        const existingPreview = await this.db.get(
          "SELECT * FROM preview_processes WHERE execution_id = ? AND ref_type = ? AND ref_id = ? ORDER BY started_at DESC LIMIT 1",
          [executionId, options.refType, options.refId]
        );
        if (existingPreview) {
          logger$a.info(`Found existing preview for ${options.refType}/${options.refId}:`, {
            id: existingPreview.id,
            status: existingPreview.status,
            pid: existingPreview.pid,
            port: existingPreview.port,
            stopped_at: existingPreview.stopped_at,
            error_message: existingPreview.error_message
          });
          if (["installing", "starting", "running"].includes(existingPreview.status)) {
            logger$a.info(`Preview is marked as ${existingPreview.status}, verifying actual state...`);
            let isActuallyRunning = false;
            if (existingPreview.pid) {
              try {
                process.kill(existingPreview.pid, 0);
                isActuallyRunning = true;
                logger$a.info(`Process ${existingPreview.pid} is still running`);
              } catch (error) {
                logger$a.info(`Process ${existingPreview.pid} is not running: ${error.message}`);
              }
            }
            if (!isActuallyRunning && existingPreview.port) {
              const portInUse = !await this.portAllocator.isPortAvailable(existingPreview.port);
              if (portInUse) {
                logger$a.info(`Port ${existingPreview.port} is still in use, but not by our process`);
              } else {
                logger$a.info(`Port ${existingPreview.port} is available`);
              }
            }
            if (isActuallyRunning) {
              logger$a.info(`Preview is actually running, returning existing preview`);
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
              logger$a.info(`Preview process is not running, updating status to stopped`);
              await this.db.run(
                "UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP WHERE id = ?",
                ["stopped", existingPreview.id]
              );
              existingPreview.status = "stopped";
            }
          }
          if (["stopped", "failed"].includes(existingPreview.status)) {
            logger$a.info(`Preview is in ${existingPreview.status} state, stopping and restarting...`);
            try {
              await this.stopPreview(executionId, existingPreview.id);
              await new Promise((resolve) => setTimeout(resolve, 1e3));
            } catch (error) {
              logger$a.warn(`Error stopping preview ${existingPreview.id}:`, error);
            }
            logger$a.info(`Creating new preview for ${options.refType}/${options.refId} after stopping the old one`);
          } else {
            logger$a.warn(`Preview has unexpected status: ${existingPreview.status}`);
            return {
              success: false,
              error: `Preview has unexpected status: ${existingPreview.status}`,
              previewId: existingPreview.id
            };
          }
        }
      }
      let workingDir = execution.working_dir;
      if (options.refType && options.refId) {
        const baseWorkspace = execution.workspace_path || execution.working_dir;
        workingDir = path.join(baseWorkspace, options.refType, options.refId);
        logger$a.info(`Starting new preview in reference directory: ${workingDir}`, {
          refType: options.refType,
          refId: options.refId,
          baseWorkspace,
          "execution.workspace_path": execution.workspace_path,
          "execution.working_dir": execution.working_dir,
          "execution": execution,
          options
        });
      }
      const previewId = v4();
      await this.db.run(
        `INSERT INTO preview_processes (id, execution_id, command, port, status, urls, pid, ref_type, ref_id, working_dir)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          previewId,
          executionId,
          "pending",
          null,
          "installing",
          JSON.stringify({}),
          null,
          options.refType || null,
          options.refId || null,
          workingDir
        ]
      );
      this.setupPreviewAsync(previewId, executionId, workingDir, options).catch((error) => {
        logger$a.error(`Async preview setup failed for ${previewId}:`, error);
        this.db.run(
          "UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?",
          ["failed", error.message, previewId]
        ).catch((dbError) => {
          logger$a.error(`Failed to update preview status to failed:`, dbError);
        });
      });
      return {
        success: true,
        previewId,
        executionId,
        refType: options.refType,
        refId: options.refId,
        workingDir,
        status: "installing",
        command: "pending",
        pid: null,
        port: null,
        urls: {},
        startedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } catch (error) {
      logger$a.error("Error starting preview:", error);
      throw error;
    }
  }
  async setupPreviewAsync(previewId, executionId, workingDir, options) {
    try {
      logger$a.info(`Setting up preview ${previewId} in ${workingDir}`);
      const analysis = await this.analyzeProject(executionId, { refType: options.refType, refId: options.refId });
      if (options.installDependencies !== false) {
        logger$a.info(`Installing dependencies in ${workingDir}`);
        if (this.eventEmitter) {
          this.eventEmitter.emit("execution:log", {
            executionId,
            log: {
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              type: "system",
              content: JSON.stringify({
                type: "system",
                subtype: "phase",
                phase: "installing_dependencies",
                message: "Installing project dependencies"
              })
            }
          });
        }
        try {
          const installResult = await this.installDependencies(executionId, {
            manager: "auto",
            workingDir,
            refType: options.refType,
            refId: options.refId
          });
          logger$a.info(`Dependencies installed successfully`, installResult);
          if (this.eventEmitter) {
            this.eventEmitter.emit("execution:log", {
              executionId,
              log: {
                timestamp: (/* @__PURE__ */ new Date()).toISOString(),
                type: "system",
                content: JSON.stringify({
                  type: "system",
                  subtype: "phase",
                  phase: "ready_for_preview",
                  message: "Dependencies installed, project ready for preview"
                })
              }
            });
          }
        } catch (installError) {
          logger$a.error(`Failed to install dependencies: ${installError.message}`);
          throw new Error(`Dependency installation failed: ${installError.message}`);
        }
      }
      let command = options.customCommand || options.command && analysis.availableScripts[options.command] || analysis.availableScripts[analysis.suggestedCommand];
      if (!command) {
        throw new Error("No command specified or available");
      }
      if (analysis.projectType === "node" && !command.startsWith("npx") && !command.startsWith("npm") && !command.startsWith("yarn")) {
        command = `npx ${command}`;
        logger$a.info(`Modified command to use npx: ${command}`);
      }
      await this.db.run(
        "UPDATE preview_processes SET status = ?, command = ? WHERE id = ?",
        ["starting", command, previewId]
      );
      logger$a.info(`Starting app with command: ${command} in directory: ${workingDir}`);
      const env = {
        ...process.env,
        NODE_ENV: "development",
        ...options.env
      };
      delete env.PORT;
      const [cmd, ...args] = command.split(" ");
      const childProcess = spawn(cmd, args, {
        cwd: workingDir,
        env,
        shell: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      if (!childProcess.pid) {
        throw new Error("Failed to start process");
      }
      this.previewProcesses.set(previewId, childProcess);
      logger$a.info(`Started process with PID: ${childProcess.pid}`);
      await this.db.run(
        "UPDATE preview_processes SET pid = ? WHERE id = ?",
        [childProcess.pid, previewId]
      );
      let assignedPort = null;
      childProcess.stdout.on("data", (data) => {
        const output = data.toString();
        this.handleProcessOutput(previewId, "stdout", output);
        this.checkForErrors(previewId, output, executionId);
        if (!assignedPort) {
          assignedPort = this.parsePortFromOutput(output, analysis.framework);
          if (assignedPort) {
            logger$a.info(`Detected port ${assignedPort} for preview ${previewId}`);
            this.updatePreviewPort(previewId, assignedPort);
          }
        }
      });
      childProcess.stderr.on("data", (data) => {
        const output = data.toString();
        this.handleProcessOutput(previewId, "stderr", output);
        this.checkForErrors(previewId, output, executionId);
        if (!assignedPort) {
          assignedPort = this.parsePortFromOutput(output, analysis.framework);
          if (assignedPort) {
            logger$a.info(`Detected port ${assignedPort} for preview ${previewId} (from stderr)`);
            this.updatePreviewPort(previewId, assignedPort);
          }
        }
      });
      childProcess.on("error", (error) => {
        logger$a.error(`Process error for preview ${previewId}:`, error);
        this.handleProcessError(previewId, error);
      });
      childProcess.on("exit", (code, signal) => {
        logger$a.info(`Process exited for preview ${previewId} with code ${code}, signal ${signal}`);
        this.handleProcessExit(previewId, code, signal);
      });
    } catch (error) {
      logger$a.error(`Setup failed for preview ${previewId}:`, error);
      await this.db.run(
        "UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?",
        ["failed", error.message, previewId]
      );
      throw error;
    }
  }
  async stopPreview(executionId, previewId = null, options = {}) {
    try {
      let previewsToStop = [];
      if (previewId) {
        const preview = await this.db.get(
          "SELECT * FROM preview_processes WHERE id = ? AND execution_id = ?",
          [previewId, executionId]
        );
        if (preview) {
          previewsToStop.push(preview);
        }
      } else if (options.refType && options.refId) {
        previewsToStop = await this.db.all(
          "SELECT * FROM preview_processes WHERE execution_id = ? AND ref_type = ? AND ref_id = ? AND status IN (?, ?, ?)",
          [executionId, options.refType, options.refId, "installing", "starting", "running"]
        );
      } else {
        previewsToStop = await this.db.all(
          "SELECT * FROM preview_processes WHERE execution_id = ? AND status IN (?, ?, ?)",
          [executionId, "installing", "starting", "running"]
        );
      }
      const stoppedIds = [];
      for (const preview of previewsToStop) {
        const process2 = this.previewProcesses.get(preview.id);
        if (process2) {
          process2.kill("SIGTERM");
          setTimeout(() => {
            if (!process2.killed) {
              process2.kill("SIGKILL");
            }
          }, 5e3);
        }
        await this.portAllocator.releasePortsByPreviewId(preview.id);
        await this.db.run(
          "UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP WHERE id = ?",
          ["stopped", preview.id]
        );
        this.previewProcesses.delete(preview.id);
        stoppedIds.push(preview.id);
      }
      return {
        success: true,
        stopped: stoppedIds,
        stoppedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } catch (error) {
      logger$a.error(`Error stopping preview:`, error);
      throw error;
    }
  }
  async getPreviewStatus(executionId, options = {}) {
    try {
      let query2 = "SELECT * FROM preview_processes WHERE execution_id = ?";
      const params = [executionId];
      if (options.refType && options.refId) {
        query2 += " AND ref_type = ? AND ref_id = ?";
        params.push(options.refType, options.refId);
      }
      query2 += " ORDER BY started_at DESC";
      const previews = await this.db.all(query2, params);
      const results = [];
      for (const preview of previews) {
        const urls = JSON.parse(preview.urls || "{}");
        let health = null;
        if (preview.status === "running" && urls.local) {
          const healthCheck = await this.healthChecker.checkHealth(urls.local, 5e3);
          health = {
            responsive: healthCheck.responsive,
            lastCheck: (/* @__PURE__ */ new Date()).toISOString(),
            responseTime: healthCheck.responseTime
          };
        }
        const recentLogs = await this.db.all(
          "SELECT content FROM preview_logs WHERE preview_id = ? ORDER BY timestamp DESC LIMIT 10",
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
            recent: recentLogs.map((log) => log.content).reverse()
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
      logger$a.error(`Error getting preview status for execution ${executionId}:`, error);
      throw error;
    }
  }
  async installDependencies(executionId, options = {}) {
    try {
      const execution = await this.db.get(
        "SELECT * FROM executions WHERE id = ?",
        [executionId]
      );
      if (!execution) {
        throw new Error("Execution not found");
      }
      let workingDir = options.workingDir || execution.working_dir;
      if (options.refType && options.refId) {
        const baseWorkspace = execution.workspace_path || execution.working_dir;
        workingDir = path.join(baseWorkspace, options.refType, options.refId);
        logger$a.info(`Installing dependencies in reference directory: ${workingDir}`);
      }
      const analysis = await this.analyzeProject(executionId, { refType: options.refType, refId: options.refId });
      let manager = options.manager;
      if (manager === "auto") {
        manager = analysis.dependencies.manager;
      }
      if (!manager) {
        throw new Error("No package manager detected");
      }
      const commands = {
        npm: options.production ? "npm ci --production" : "npm install",
        yarn: options.production ? "yarn install --production" : "yarn install",
        pnpm: options.production ? "pnpm install --prod" : "pnpm install",
        pip: "pip install -r requirements.txt",
        pipenv: "pipenv install"
      };
      const command = commands[manager];
      if (!command) {
        throw new Error(`Unsupported package manager: ${manager}`);
      }
      const startTime = Date.now();
      return new Promise((resolve, reject) => {
        const [cmd, ...args] = command.split(" ");
        const childProcess = spawn(cmd, args, {
          cwd: workingDir,
          shell: true,
          env: { ...process.env, NODE_ENV: "development" }
        });
        let output = "";
        childProcess.stdout.on("data", (data) => {
          output += data.toString();
          logger$a.info(`Install output: ${data.toString().trim()}`);
        });
        childProcess.stderr.on("data", (data) => {
          output += data.toString();
          logger$a.info(`Install stderr: ${data.toString().trim()}`);
        });
        childProcess.on("error", (error) => {
          logger$a.error(`Install process error:`, error);
          reject(error);
        });
        childProcess.on("exit", (code) => {
          const duration = Date.now() - startTime;
          logger$a.info(`Install process exited with code ${code} after ${duration}ms`);
          if (code === 0) {
            resolve({
              success: true,
              manager,
              command,
              duration,
              workingDir,
              refType: options.refType,
              refId: options.refId,
              installedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          } else {
            reject(new Error(`Installation failed with code ${code}: ${output}`));
          }
        });
      });
    } catch (error) {
      logger$a.error(`Error installing dependencies for execution ${executionId}:`, error);
      throw error;
    }
  }
  async handleProcessOutput(previewId, type, content) {
    try {
      await this.db.run(
        "INSERT INTO preview_logs (preview_id, type, content) VALUES (?, ?, ?)",
        [previewId, type, content]
      );
      this.broadcastLog(previewId, type, content);
    } catch (error) {
      logger$a.error(`Error handling process output for preview ${previewId}:`, error);
    }
  }
  async handleProcessError(previewId, error) {
    try {
      await this.db.run(
        "UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?",
        ["failed", error.message, previewId]
      );
      await this.handleProcessOutput(previewId, "system", `Process error: ${error.message}`);
    } catch (dbError) {
      logger$a.error(`Error handling process error for preview ${previewId}:`, dbError);
    }
  }
  async handleProcessExit(previewId, code, signal) {
    try {
      const status = code === 0 ? "stopped" : "failed";
      const message = signal ? `Process killed by signal ${signal}` : `Process exited with code ${code}`;
      await this.db.run(
        "UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?",
        [status, code !== 0 ? message : null, previewId]
      );
      await this.handleProcessOutput(previewId, "system", message);
      await this.portAllocator.releasePortsByPreviewId(previewId);
      this.previewProcesses.delete(previewId);
      const isUnexpectedExit = code !== 0 && !(signal == null ? void 0 : signal.includes("SIGTERM")) && !(signal == null ? void 0 : signal.includes("SIGINT"));
      if (isUnexpectedExit) {
        const preview = await this.db.get(
          "SELECT * FROM preview_processes WHERE id = ?",
          [previewId]
        );
        if (preview && preview.execution_id) {
          logger$a.warn(`Preview ${previewId} exited unexpectedly (code: ${code}, signal: ${signal})`);
          const errorMessage = `⚠️ **Preview Process Exited**

Preview for ${preview.ref_type}/${preview.ref_id} stopped unexpectedly.

Exit code: ${code}
Signal: ${signal || "none"}

This might be due to:
- A crash in the application
- Memory issues
- Build/compilation errors
- Port conflicts

Please check the logs above for more details. You can restart the preview using the UI controls.`;
          try {
            await axios.post(`http://localhost:3010/message/${preview.execution_id}`, {
              message: errorMessage
            });
            logger$a.info(`Sent exit notification to Claude for preview ${previewId}`);
          } catch (error) {
            logger$a.error(`Failed to send exit notification to Claude:`, error);
          }
        }
      }
    } catch (error) {
      logger$a.error(`Error handling process exit for preview ${previewId}:`, error);
    }
  }
  addSSEConnection(previewId, res) {
    if (!this.sseConnections.has(previewId)) {
      this.sseConnections.set(previewId, /* @__PURE__ */ new Set());
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
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        type,
        content
      });
      connections.forEach((res) => {
        res.write(`event: log
data: ${data}

`);
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
      connections.forEach((res) => {
        res.write(`event: status
data: ${data}

`);
      });
    }
  }
  getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
    return "localhost";
  }
  parsePortFromOutput(output, framework) {
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
    const frameworkPatterns = patterns[framework] || [];
    for (const pattern of frameworkPatterns) {
      const match = output.match(pattern);
      if (match) {
        const port = parseInt(match[1], 10);
        logger$a.info(`Detected port ${port} for ${framework} from output`);
        return port;
      }
    }
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
        if (port >= 3e3 && port <= 9e3) {
          logger$a.info(`Detected port ${port} from generic pattern`);
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
        "UPDATE preview_processes SET port = ?, urls = ? WHERE id = ?",
        [port, JSON.stringify(urls), previewId]
      );
      await this.portAllocator.updatePortAllocation(port, previewId);
      logger$a.info(`Updated preview ${previewId} with detected port ${port}`);
      this.broadcastStatus(previewId, "port_detected", port, urls.local);
      this.startHealthCheck(previewId, port);
    } catch (error) {
      logger$a.error(`Error updating preview port for ${previewId}:`, error);
    }
  }
  async startHealthCheck(previewId, port) {
    const url = `http://localhost:${port}`;
    setTimeout(async () => {
      try {
        const waitResult = await this.healthChecker.waitForServer(url, {
          maxAttempts: 30,
          initialDelay: 2e3
        });
        if (waitResult.success) {
          await this.db.run(
            "UPDATE preview_processes SET status = ? WHERE id = ?",
            ["running", previewId]
          );
          this.broadcastStatus(previewId, "running", port, url);
        } else {
          await this.db.run(
            "UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?",
            ["failed", "Server failed to start", previewId]
          );
          this.broadcastStatus(previewId, "failed", port, null);
        }
      } catch (error) {
        logger$a.error(`Health check failed for preview ${previewId}:`, error);
      }
    }, 3e3);
  }
  /**
   * Forcefully stop a preview process and clean up resources
   */
  async forceStopPreview(previewId) {
    logger$a.info(`Force stopping preview ${previewId}`);
    try {
      const processInfo = this.previewProcesses.get(previewId);
      if (processInfo && processInfo.process) {
        const process2 = processInfo.process;
        if (!process2.killed) {
          process2.kill("SIGTERM");
          await new Promise((resolve) => setTimeout(resolve, 2e3));
          if (!process2.killed) {
            logger$a.warn(`Preview ${previewId} didn't respond to SIGTERM, using SIGKILL`);
            process2.kill("SIGKILL");
          }
        }
        this.previewProcesses.delete(previewId);
      }
      const preview = await this.db.get("SELECT port FROM preview_processes WHERE id = ?", [previewId]);
      if (preview && preview.port) {
        await this.killProcessOnPort(preview.port);
      }
      await this.portAllocator.releasePortsByPreviewId(previewId);
    } catch (error) {
      logger$a.error(`Error during force stop of preview ${previewId}:`, error);
    }
  }
  /**
   * Kill any process using the specified port
   */
  async killProcessOnPort(port) {
    try {
      const lsofProcess = spawn("lsof", ["-ti", `:${port}`]);
      let pids = "";
      lsofProcess.stdout.on("data", (data) => {
        pids += data.toString();
      });
      await new Promise((resolve, reject) => {
        lsofProcess.on("close", (code) => {
          resolve();
        });
        lsofProcess.on("error", reject);
      });
      const pidList = pids.trim().split("\n").filter((pid) => pid);
      for (const pid of pidList) {
        try {
          process.kill(parseInt(pid), "SIGKILL");
          logger$a.info(`Killed process ${pid} using port ${port}`);
        } catch (e) {
        }
      }
    } catch (error) {
      logger$a.warn(`Could not kill processes on port ${port}:`, error.message);
    }
  }
  /**
   * Restart a preview process after server restart
   */
  async restartPreview(previewData) {
    logger$a.info(`Attempting to restart preview ${previewData.id}`);
    try {
      await this.forceStopPreview(previewData.id);
      const urls = previewData.urls ? JSON.parse(previewData.urls) : {};
      const port = previewData.port;
      if (!port) {
        throw new Error("No port found for preview");
      }
      const isAvailable = await this.portAllocator.isPortAvailable(port);
      if (!isAvailable) {
        logger$a.warn(`Port ${port} is no longer available for preview ${previewData.id}`);
        const newPort = await this.portAllocator.allocatePort();
        logger$a.info(`Allocated new port ${newPort} for preview ${previewData.id}`);
        await this.portAllocator.updatePortAllocation(newPort, previewData.id);
        previewData.port = newPort;
      }
      await this.db.run(
        "UPDATE preview_processes SET status = ? WHERE id = ?",
        ["starting", previewData.id]
      );
      const command = JSON.parse(previewData.command);
      const env = { ...process.env };
      delete env.PORT;
      const childProcess = spawn(command.cmd, command.args, {
        cwd: previewData.working_dir,
        env,
        shell: true
      });
      this.previewProcesses.set(previewData.id, {
        process: childProcess,
        port: previewData.port,
        executionId: previewData.execution_id,
        refType: previewData.ref_type,
        refId: previewData.ref_id
      });
      childProcess.stdout.on("data", (data) => {
        const content = data.toString();
        this.handleProcessOutput(previewData.id, "stdout", content);
        this.checkForErrors(previewData.id, content, previewData.execution_id);
      });
      childProcess.stderr.on("data", (data) => {
        const content = data.toString();
        this.handleProcessOutput(previewData.id, "stderr", content);
        this.checkForErrors(previewData.id, content, previewData.execution_id);
      });
      childProcess.on("error", (error) => {
        logger$a.error(`Preview process error for ${previewData.id}:`, error);
        this.handlePreviewError(previewData.id, error.message);
      });
      childProcess.on("exit", (code, signal) => {
        logger$a.info(`Preview process exited for ${previewData.id}: code=${code}, signal=${signal}`);
        this.handlePreviewExit(previewData.id, code, signal);
      });
      const newUrls = {
        local: `http://localhost:${previewData.port}`,
        tunnel: null
      };
      await this.db.run(
        "UPDATE preview_processes SET urls = ?, pid = ? WHERE id = ?",
        [JSON.stringify(newUrls), childProcess.pid, previewData.id]
      );
      const url = newUrls.local;
      setTimeout(async () => {
        try {
          const waitResult = await this.healthChecker.waitForServer(url, {
            maxAttempts: 30,
            initialDelay: 2e3
          });
          if (waitResult.success) {
            await this.db.run(
              "UPDATE preview_processes SET status = ? WHERE id = ?",
              ["running", previewData.id]
            );
            logger$a.info(`Successfully restarted preview ${previewData.id}`);
          } else {
            await this.db.run(
              "UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?",
              ["failed", "Server failed to restart", previewData.id]
            );
          }
        } catch (error) {
          logger$a.error(`Health check failed for restarted preview ${previewData.id}:`, error);
        }
      }, 3e3);
      return {
        success: true,
        previewId: previewData.id,
        port: previewData.port,
        url: newUrls.local
      };
    } catch (error) {
      logger$a.error(`Failed to restart preview ${previewData.id}:`, error);
      await this.db.run(
        "UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?",
        ["failed", error.message, previewData.id]
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
        logger$a.error("Error during health monitoring:", error);
      }
    }, this.healthCheckInterval);
    logger$a.info(`Started preview health monitoring (interval: ${this.healthCheckInterval}ms)`);
  }
  /**
   * Check all running previews and restart failed ones
   */
  async checkAndRestartFailedPreviews() {
    const runningPreviews = await this.db.all(
      "SELECT * FROM preview_processes WHERE status = ?",
      ["running"]
    );
    for (const preview of runningPreviews) {
      try {
        await this.checkPreviewHealth(preview);
      } catch (error) {
        logger$a.error(`Health check failed for preview ${preview.id}:`, error);
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
      logger$a.warn(`Preview ${preview.id} has no URL, skipping health check`);
      return;
    }
    const processInfo = this.previewProcesses.get(preview.id);
    if (processInfo && processInfo.process && processInfo.process.killed) {
      logger$a.warn(`Preview ${preview.id} process was killed, restarting...`);
      await this.handlePreviewRestart(preview, "Process was killed");
      return;
    }
    try {
      const healthResult = await this.healthChecker.checkHealth(url, 1e4);
      if (!healthResult.success) {
        logger$a.warn(`Preview ${preview.id} health check failed: ${healthResult.error}`);
        await this.db.run(
          "UPDATE preview_processes SET last_health_check = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?",
          [`Health check failed: ${healthResult.error}`, preview.id]
        );
      } else {
        await this.db.run(
          "UPDATE preview_processes SET last_health_check = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ?",
          [preview.id]
        );
      }
    } catch (error) {
      logger$a.warn(`Preview ${preview.id} health check error:`, error);
    }
  }
  /**
   * Handle restarting a failed preview
   */
  async handlePreviewRestart(preview, reason) {
    const restartAttempts = preview.restart_attempts || 0;
    if (restartAttempts >= this.maxRestartAttempts) {
      logger$a.error(`Preview ${preview.id} exceeded max restart attempts (${this.maxRestartAttempts}), marking as failed`);
      await this.db.run(
        "UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?",
        ["failed", `Exceeded max restart attempts: ${reason}`, preview.id]
      );
      return;
    }
    logger$a.info(`Restarting preview ${preview.id} (attempt ${restartAttempts + 1}/${this.maxRestartAttempts}): ${reason}`);
    try {
      const processInfo = this.previewProcesses.get(preview.id);
      if (processInfo && processInfo.process) {
        try {
          processInfo.process.kill("SIGTERM");
        } catch (e) {
        }
      }
      await this.db.run(
        "UPDATE preview_processes SET status = ?, restart_attempts = ?, error_message = ? WHERE id = ?",
        ["starting", restartAttempts + 1, `Restarting: ${reason}`, preview.id]
      );
      await new Promise((resolve) => setTimeout(resolve, this.restartDelay));
      await this.restartPreview(preview);
      logger$a.info(`Successfully restarted preview ${preview.id}`);
    } catch (error) {
      logger$a.error(`Failed to restart preview ${preview.id}:`, error);
      await this.db.run(
        "UPDATE preview_processes SET status = ?, error_message = ? WHERE id = ?",
        ["failed", `Restart failed: ${error.message}`, preview.id]
      );
    }
  }
  /**
   * Check for errors in preview logs and send to Claude if needed
   */
  async checkForErrors(previewId, content, executionId) {
    let errorFound = null;
    for (const pattern of this.errorPatterns) {
      if (pattern.test(content)) {
        errorFound = content.trim();
        break;
      }
    }
    if (!errorFound) return;
    let execError = this.executionErrors.get(executionId);
    if (!execError) {
      execError = {
        errorBuffer: /* @__PURE__ */ new Set(),
        timeoutId: null,
        lastSent: 0,
        isHandling: false
      };
      this.executionErrors.set(executionId, execError);
    }
    if (execError.isHandling) {
      logger$a.debug(`Already handling error for execution ${executionId}, skipping`);
      return;
    }
    const now = Date.now();
    if (execError.lastSent && now - execError.lastSent < 6e4) {
      logger$a.debug(`Recently sent error for execution ${executionId}, skipping`);
      return;
    }
    execError.errorBuffer.add(errorFound);
    if (execError.timeoutId) {
      clearTimeout(execError.timeoutId);
    }
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
    execError.isHandling = true;
    try {
      const execution = await this.db.get(
        "SELECT agent_type FROM executions WHERE id = ?",
        [executionId]
      );
      if (execution && execution.agent_type === "claude") {
        logger$a.info(`Checking Claude session status for execution ${executionId}`);
      }
      logger$a.info(`Sending buffered errors to Claude for execution ${executionId}`);
      const preview = await this.db.get(
        "SELECT * FROM preview_processes WHERE id = ?",
        [previewId]
      );
      if (!preview) {
        execError.errorBuffer.clear();
        execError.isHandling = false;
        return;
      }
      const allErrors = Array.from(execError.errorBuffer).join("\n\n---\n\n");
      const errorMessage = `🚨 **Preview Error Detected**

Preview for ${preview.ref_type}/${preview.ref_id} encountered errors:

\`\`\`
${allErrors}
\`\`\`

The preview server needs attention. Please:
1. Review and fix the errors above
2. The preview will automatically restart once fixed
3. If needed, you can manually restart using the UI

Common solutions:
- Fix TypeScript/build errors
- Install missing dependencies
- Check import paths and module resolution
- Verify configuration files`;
      await axios.post(`http://localhost:3010/message/${executionId}`, {
        message: errorMessage
      });
      execError.lastSent = Date.now();
      execError.errorBuffer.clear();
      logger$a.info(`Successfully sent error message to Claude for execution ${executionId}`);
    } catch (error) {
      logger$a.error(`Failed to send error to Claude:`, error);
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
        "UPDATE preview_processes SET status = ?, error_message = ?, stopped_at = CURRENT_TIMESTAMP WHERE id = ?",
        ["failed", errorMessage, previewId]
      );
      logger$a.error(`Preview ${previewId} failed: ${errorMessage}`);
    } catch (error) {
      logger$a.error(`Failed to update preview error status:`, error);
    }
  }
  /**
   * Handle preview process exit
   */
  async handlePreviewExit(previewId, code, signal) {
    try {
      const status = code === 0 ? "stopped" : "failed";
      const message = signal ? `Process killed by signal ${signal}` : code !== 0 ? `Process exited with code ${code}` : null;
      await this.db.run(
        "UPDATE preview_processes SET status = ?, stopped_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?",
        [status, message, previewId]
      );
      this.previewProcesses.delete(previewId);
      const preview = await this.db.get(
        "SELECT execution_id FROM preview_processes WHERE id = ?",
        [previewId]
      );
      if (preview) {
        const otherPreviews = await this.db.get(
          'SELECT COUNT(*) as count FROM preview_processes WHERE execution_id = ? AND status IN ("running", "starting", "installing") AND id != ?',
          [preview.execution_id, previewId]
        );
        if (otherPreviews.count === 0) {
          const execError = this.executionErrors.get(preview.execution_id);
          if (execError) {
            if (execError.timeoutId) {
              clearTimeout(execError.timeoutId);
            }
            this.executionErrors.delete(preview.execution_id);
            logger$a.debug(`Cleaned up error tracking for execution ${preview.execution_id}`);
          }
        }
      }
      logger$a.info(`Preview ${previewId} exited with status: ${status}`);
    } catch (error) {
      logger$a.error(`Failed to handle preview exit:`, error);
    }
  }
}
class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    __publicField(this, "name", "ValidationError");
    __publicField(this, "code");
    __publicField(this, "details");
    this.code = ErrorCodes.VALIDATION_ERROR;
    this.details = details;
  }
}
class NotFoundError extends Error {
  constructor(message) {
    super(message);
    __publicField(this, "name", "NotFoundError");
    __publicField(this, "code");
    this.code = ErrorCodes.EXECUTION_NOT_FOUND;
  }
}
class ProcessError extends Error {
  constructor(code, message) {
    super(message);
    __publicField(this, "name", "ProcessError");
    __publicField(this, "code");
    this.code = code;
  }
}
function createErrorResponse(error) {
  const response = {
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
function validateAgent(agent) {
  if (!agent) {
    throw new ValidationError("Agent type is required", { field: "agent" });
  }
  if (!["claude", "gemini"].includes(agent)) {
    throw new ValidationError(
      "Invalid agent type. Must be 'claude' or 'gemini'",
      { field: "agent", value: agent }
    );
  }
  return agent;
}
function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== "string") {
    throw new ValidationError("Prompt is required and must be a string", { field: "prompt" });
  }
  if (prompt.trim().length === 0) {
    throw new ValidationError("Prompt cannot be empty", { field: "prompt" });
  }
  return prompt.trim();
}
function validateWorkingDir(workingDir) {
  if (!workingDir) {
    return null;
  }
  if (typeof workingDir !== "string") {
    throw new ValidationError("Working directory must be a string", { field: "workingDir" });
  }
  const absPath = path.resolve(workingDir);
  if (!fs.existsSync(absPath)) {
    throw new ValidationError(`Working directory does not exist: ${absPath}`, {
      field: "workingDir",
      path: absPath
    });
  }
  if (!fs.statSync(absPath).isDirectory()) {
    throw new ValidationError(`Path is not a directory: ${absPath}`, {
      field: "workingDir",
      path: absPath
    });
  }
  return absPath;
}
function validateExecutionId(executionId) {
  if (!executionId || typeof executionId !== "string") {
    throw new ValidationError("Execution ID is required", { field: "executionId" });
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(executionId)) {
    throw new ValidationError("Invalid execution ID format", {
      field: "executionId",
      value: executionId
    });
  }
  return executionId;
}
function validateMessage(message) {
  if (!message || typeof message !== "string") {
    throw new ValidationError("Message is required and must be a string", { field: "message" });
  }
  if (message.trim().length === 0) {
    throw new ValidationError("Message cannot be empty", { field: "message" });
  }
  if (message.length > 1e5) {
    throw new ValidationError("Message is too long (max 100000 characters)", {
      field: "message",
      length: message.length
    });
  }
  return message.trim();
}
const logger$9 = createLogger("routes/execute");
const router$b = express.Router();
router$b.post("/execute", async (req, res, next) => {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  try {
    const agent = validateAgent(req.body.agent);
    const prompt = validatePrompt(req.body.prompt);
    const providedWorkingDir = req.body.workingDir;
    let workingDir = null;
    if (providedWorkingDir) {
      workingDir = validateWorkingDir(providedWorkingDir);
    }
    const refs = req.body.refs || {};
    if (refs.read && !Array.isArray(refs.read)) {
      throw new ValidationError("refs.read must be an array");
    }
    if (refs.mutate && !Array.isArray(refs.mutate)) {
      throw new ValidationError("refs.mutate must be an array");
    }
    if (refs.create && !Array.isArray(refs.create)) {
      throw new ValidationError("refs.create must be an array");
    }
    const executionId = v4();
    const { db, eventEmitter, workspaceManager, resourceMonitor, auditLogger, performanceMonitor } = req.app.locals;
    const emitPhase = async (phase, message) => {
      const timestamp = (/* @__PURE__ */ new Date()).toISOString();
      await db.run(
        "UPDATE executions SET phase = ?, last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?",
        [phase, executionId]
      );
      eventEmitter.emit(Events.LOG_ENTRY, {
        executionId,
        timestamp,
        type: "system",
        content: JSON.stringify({
          type: "system",
          subtype: "phase",
          phase,
          message
        })
      });
    };
    await emitPhase("starting", "Execution started");
    if (resourceMonitor) {
      const canExecute = await resourceMonitor.canStartExecution();
      if (!canExecute) {
        const checks = await Promise.all([
          resourceMonitor.checkConcurrentExecutions(),
          resourceMonitor.checkDiskUsage(),
          resourceMonitor.checkSystemResources()
        ]);
        const blockedBy = checks.filter((check) => !check.allowed);
        const reasons = blockedBy.map((check) => check.message).filter(Boolean);
        return res.status(429).json({
          error: {
            code: "RESOURCE_LIMIT_EXCEEDED",
            message: "Cannot start execution due to resource limits",
            details: {
              blockedBy: blockedBy.map((check) => check.type),
              reasons
            }
          }
        });
      }
    }
    await db.run(
      `INSERT INTO executions (id, agent_type, status, working_dir, workspace_path, phase, last_heartbeat) 
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        executionId,
        agent,
        ExecutionStatus.STARTING,
        workingDir || process.cwd(),
        null,
        "starting"
      ]
      // workspace_path will be updated later
    );
    let executionWorkspace = null;
    let actualWorkingDir = workingDir || process.cwd();
    if (((_a = refs.read) == null ? void 0 : _a.length) > 0 || ((_b = refs.mutate) == null ? void 0 : _b.length) > 0 || ((_c = refs.create) == null ? void 0 : _c.length) > 0) {
      const workspacePath = workspaceManager.getWorkspacePath();
      const refManager2 = new RefManager(workspacePath, performanceMonitor);
      const previewManager2 = new PreviewManager(db, req.app.locals.processManager, eventEmitter);
      const contextManager = new ExecutionContextManager(workspaceManager, refManager2, previewManager2);
      try {
        await emitPhase("copying_files", "Setting up project files and references");
        executionWorkspace = await contextManager.setupExecutionWorkspace(executionId, refs);
        actualWorkingDir = executionWorkspace.executionPath;
        await db.run(
          "UPDATE executions SET workspace_path = ?, working_dir = ? WHERE id = ?",
          [executionWorkspace.executionPath, actualWorkingDir, executionId]
        );
        await contextManager.startPendingPreviews();
        logger$9.info("Execution workspace created", {
          executionId,
          workspace: executionWorkspace.executionPath,
          refs: executionWorkspace.manifest.refs
        });
      } catch (error) {
        logger$9.error("Failed to set up execution workspace", { executionId, error });
        throw new ValidationError(`Failed to set up references: ${error.message}`);
      }
    }
    if (auditLogger) {
      await auditLogger.logExecutionEvent({
        executionId,
        event: "started",
        phase: "initialization",
        details: {
          agent,
          prompt: prompt.substring(0, 100),
          // First 100 chars for brevity
          workingDir: actualWorkingDir,
          hasReferences: !!(((_d = refs.read) == null ? void 0 : _d.length) || ((_e = refs.mutate) == null ? void 0 : _e.length) || ((_f = refs.create) == null ? void 0 : _f.length)),
          referenceCounts: {
            read: ((_g = refs.read) == null ? void 0 : _g.length) || 0,
            mutate: ((_h = refs.mutate) == null ? void 0 : _h.length) || 0,
            create: ((_i = refs.create) == null ? void 0 : _i.length) || 0
          }
        }
      });
    }
    if (executionWorkspace) {
      const refInserts = [];
      for (const refId of refs.read || []) {
        refInserts.push(db.run(
          "INSERT INTO execution_refs (execution_id, ref_id, permission) VALUES (?, ?, ?)",
          [executionId, refId, "read"]
        ));
      }
      for (const refId of refs.mutate || []) {
        refInserts.push(db.run(
          "INSERT INTO execution_refs (execution_id, ref_id, permission) VALUES (?, ?, ?)",
          [executionId, refId, "mutate"]
        ));
      }
      for (const refId of refs.create || []) {
        refInserts.push(db.run(
          "INSERT INTO execution_refs (execution_id, ref_id, permission) VALUES (?, ?, ?)",
          [executionId, refId, "create"]
        ));
      }
      await Promise.all(refInserts);
    }
    if (agent === "claude") {
      if (!req.app.locals.claudeSDKManager) {
        req.app.locals.claudeSDKManager = new ClaudeSDKManager(
          db,
          req.app.locals.config || config,
          eventEmitter,
          workspaceManager
        );
      }
      const claudeManager = req.app.locals.claudeSDKManager;
      await claudeManager.startExecution(executionId, prompt, actualWorkingDir);
    } else {
      if (!req.app.locals.processManager) {
        req.app.locals.processManager = new ProcessManager(db, req.app.locals.config || config, eventEmitter);
      }
      if (!req.app.locals.streamHandler) {
        req.app.locals.streamHandler = new StreamHandler(db, eventEmitter);
      }
      const processManager = req.app.locals.processManager;
      const streamHandler = req.app.locals.streamHandler;
      const childProcess = await processManager.spawn(executionId, agent, prompt, actualWorkingDir, false);
      childProcess.stdout.on("data", (data) => {
        logger$9.info("Process stdout", { executionId, length: data.length, preview: data.toString().substring(0, 100) });
        streamHandler.handleOutput(executionId, "stdout", data);
      });
      childProcess.stderr.on("data", (data) => {
        logger$9.info("Process stderr", { executionId, length: data.length, preview: data.toString().substring(0, 100) });
        streamHandler.handleOutput(executionId, "stderr", data);
      });
    }
    const response = {
      executionId,
      status: ExecutionStatus.STARTING,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      workingDir: actualWorkingDir
    };
    if (executionWorkspace) {
      response.refs = executionWorkspace.manifest.refs;
      response.workspace = {
        path: executionWorkspace.executionPath,
        directories: executionWorkspace.paths
      };
      if (executionWorkspace.skippedRefs) {
        const hasSkipped = executionWorkspace.skippedRefs.read.length > 0 || executionWorkspace.skippedRefs.mutate.length > 0;
        if (hasSkipped) {
          response.skippedRefs = executionWorkspace.skippedRefs;
          response.warnings = [`Skipped ${executionWorkspace.skippedRefs.read.length + executionWorkspace.skippedRefs.mutate.length} non-existent references`];
        }
      }
    }
    logger$9.info("Execution started", { executionId, agent, workingDir: actualWorkingDir, refs });
    res.status(201).json(response);
  } catch (error) {
    if (error.name === "ValidationError") {
      logger$9.warn("Validation error", error);
      return res.status(400).json(createErrorResponse(error));
    }
    logger$9.error("Execution error", error);
    next(error);
  }
});
const router$a = express.Router();
router$a.get("/status/:executionId", async (req, res, next) => {
  try {
    const executionId = validateExecutionId(req.params.executionId);
    const { db } = req.app.locals;
    const execution = await db.get(
      "SELECT * FROM executions WHERE id = ?",
      [executionId]
    );
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    const previews = await db.all(
      `SELECT p1.* FROM preview_processes p1
       INNER JOIN (
         SELECT execution_id, ref_type, ref_id, MAX(started_at) as max_started
         FROM preview_processes
         WHERE execution_id = ?
         AND ref_type IS NOT NULL
         AND ref_id IS NOT NULL
         GROUP BY execution_id, ref_type, ref_id
       ) p2 ON p1.execution_id = p2.execution_id 
           AND p1.ref_type = p2.ref_type 
           AND p1.ref_id = p2.ref_id 
           AND p1.started_at = p2.max_started
       WHERE p1.execution_id = ?`,
      [executionId, executionId]
    );
    const previewsByType = {
      create: {},
      mutate: {}
    };
    for (const preview of previews) {
      if (preview.ref_type && preview.ref_id) {
        if (!previewsByType[preview.ref_type]) {
          previewsByType[preview.ref_type] = {};
        }
        const urls = preview.urls ? JSON.parse(preview.urls) : {};
        previewsByType[preview.ref_type][preview.ref_id] = {
          previewId: preview.id,
          status: preview.status,
          port: preview.port,
          url: urls.local || null,
          startedAt: preview.started_at,
          stoppedAt: preview.stopped_at || null,
          errorMessage: preview.error_message || null
        };
      }
    }
    const logCount = await db.get(
      "SELECT COUNT(*) as count FROM logs WHERE execution_id = ?",
      [executionId]
    );
    const lastLog = await db.get(
      "SELECT timestamp FROM logs WHERE execution_id = ? ORDER BY timestamp DESC LIMIT 1",
      [executionId]
    );
    const response = {
      executionId: execution.id,
      status: execution.status,
      phase: execution.phase || "unknown",
      startedAt: execution.created_at,
      completedAt: execution.completed_at || null,
      lastActivity: execution.last_heartbeat || (lastLog == null ? void 0 : lastLog.timestamp) || execution.created_at,
      sessionId: execution.session_id || null,
      // Preview information
      previews: previewsByType,
      // Log summary
      logSummary: {
        totalLogs: (logCount == null ? void 0 : logCount.count) || 0,
        lastLogTime: (lastLog == null ? void 0 : lastLog.timestamp) || null
      }
    };
    res.json(response);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json(createErrorResponse(error));
    }
    if (error.name === "NotFoundError") {
      return res.status(404).json(createErrorResponse(error));
    }
    next(error);
  }
});
const logger$8 = createLogger("routes/message");
const router$9 = express.Router();
router$9.post("/message/:executionId", async (req, res, next) => {
  try {
    const executionId = validateExecutionId(req.params.executionId);
    const message = validateMessage(req.body.message);
    const { db, processManager } = req.app.locals;
    const execution = await db.get(
      "SELECT * FROM executions WHERE id = ?",
      [executionId]
    );
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    if (execution.agent_type === "claude") {
      if (!req.app.locals.claudeSDKManager) {
        const { eventEmitter: eventEmitter2, workspaceManager: workspaceManager2 } = req.app.locals;
        req.app.locals.claudeSDKManager = new ClaudeSDKManager(
          db,
          req.app.locals.config || config,
          eventEmitter2,
          workspaceManager2
        );
      }
      const claudeManager = req.app.locals.claudeSDKManager;
      try {
        await claudeManager.sendMessage(executionId, message);
        res.json({
          success: true,
          continued: true,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        return;
      } catch (error) {
        if (error.message === ErrorCodes.EXECUTION_NOT_FOUND) {
          throw new NotFoundError(`Execution not found: ${executionId}`);
        }
        throw new ProcessError(
          ErrorCodes.INTERNAL_ERROR,
          `Failed to send message: ${error.message}`
        );
      }
    }
    if (execution.status !== ExecutionStatus.RUNNING) {
      if (execution.status === ExecutionStatus.COMPLETED || execution.status === ExecutionStatus.FAILED) {
        const { workspaceManager: workspaceManager2, eventEmitter: eventEmitter2 } = req.app.locals;
        const workspacePath2 = path.join(
          workspaceManager2.getWorkspacePath(),
          ".execution",
          `exec-${executionId}`
        );
        try {
          await promises.access(workspacePath2);
          logger$8.info(`Resuming execution ${executionId} in existing workspace`);
          await db.run(
            "UPDATE executions SET status = ?, completed_at = NULL WHERE id = ?",
            [ExecutionStatus.RUNNING, executionId]
          );
          const childProcess2 = await processManager.spawn(
            executionId,
            execution.agent_type,
            message,
            workspacePath2,
            true
            // isContinuation = true
          );
          const streamHandler2 = req.app.locals.streamHandler;
          childProcess2.stdout.on("data", (data) => {
            logger$8.info("Process stdout", { executionId, length: data.length, preview: data.toString().substring(0, 100) });
            streamHandler2.handleOutput(executionId, "stdout", data);
          });
          childProcess2.stderr.on("data", (data) => {
            logger$8.info("Process stderr", { executionId, length: data.length, preview: data.toString().substring(0, 100) });
            streamHandler2.handleOutput(executionId, "stderr", data);
          });
          eventEmitter2.emit("process-start", { executionId, pid: childProcess2.pid });
          res.json({
            success: true,
            resumed: true,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          return;
        } catch (error) {
          throw new ProcessError(
            ErrorCodes.PROCESS_NOT_RUNNING,
            `Process is not running and workspace no longer exists (status: ${execution.status})`
          );
        }
      } else {
        throw new ProcessError(
          ErrorCodes.PROCESS_NOT_RUNNING,
          `Process is not running (status: ${execution.status})`
        );
      }
    }
    if (!processManager) {
      throw new ProcessError(
        ErrorCodes.INTERNAL_ERROR,
        "ProcessManager not initialized"
      );
    }
    logger$8.info(`Stopping process for execution ${executionId} to restart with continuation`);
    await processManager.stopProcess(executionId);
    const updatedExecution = await db.get(
      "SELECT * FROM executions WHERE id = ?",
      [executionId]
    );
    const { workspaceManager, streamHandler, eventEmitter } = req.app.locals;
    const workspacePath = updatedExecution.working_dir || path.join(
      workspaceManager.getWorkspacePath(),
      ".execution",
      `exec-${executionId}`
    );
    const childProcess = await processManager.spawn(
      executionId,
      updatedExecution.agent_type,
      message,
      workspacePath,
      true
      // isContinuation = true
    );
    childProcess.stdout.on("data", (data) => {
      logger$8.info("Process stdout", { executionId, length: data.length, preview: data.toString().substring(0, 100) });
      streamHandler.handleOutput(executionId, "stdout", data);
    });
    childProcess.stderr.on("data", (data) => {
      logger$8.info("Process stderr", { executionId, length: data.length, preview: data.toString().substring(0, 100) });
      streamHandler.handleOutput(executionId, "stderr", data);
    });
    eventEmitter.emit("process-start", { executionId, pid: childProcess.pid });
    res.json({
      success: true,
      continued: true,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json(createErrorResponse(error));
    }
    if (error.name === "NotFoundError") {
      return res.status(404).json(createErrorResponse(error));
    }
    if (error.name === "ProcessError") {
      return res.status(400).json(createErrorResponse(error));
    }
    next(error);
  }
});
const logger$7 = createLogger("routes/logs");
const router$8 = express.Router();
router$8.get("/logs/:executionId", async (req, res, next) => {
  var _a;
  try {
    const executionId = validateExecutionId(req.params.executionId);
    const { db, eventEmitter, config: config2 } = req.app.locals;
    const execution = await db.get(
      "SELECT * FROM executions WHERE id = ?",
      [executionId]
    );
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    logger$7.info("Starting SSE stream", { executionId });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
      // Disable Nginx buffering
    });
    const historicalLogs = await db.all(
      "SELECT * FROM logs WHERE execution_id = ? ORDER BY timestamp ASC",
      [executionId]
    );
    for (const log of historicalLogs) {
      res.write(`event: log
`);
      res.write(`data: ${JSON.stringify({
        timestamp: log.timestamp,
        type: log.type,
        content: log.content
      })}

`);
    }
    const logHandler = (event) => {
      if (event.executionId === executionId) {
        res.write(`event: log
`);
        res.write(`data: ${JSON.stringify({
          timestamp: event.timestamp,
          type: event.type,
          content: event.content
        })}

`);
      }
    };
    eventEmitter.on(Events.LOG_ENTRY, logHandler);
    const heartbeatInterval = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, ((_a = config2 == null ? void 0 : config2.streaming) == null ? void 0 : _a.heartbeatInterval) || 3e4);
    req.on("close", () => {
      logger$7.info("SSE client disconnected", { executionId });
      eventEmitter.removeListener(Events.LOG_ENTRY, logHandler);
      clearInterval(heartbeatInterval);
    });
    const exitHandler = (event) => {
      if (event.executionId === executionId) {
        res.write(`event: end
`);
        res.write(`data: ${JSON.stringify({
          code: event.code,
          signal: event.signal
        })}

`);
        eventEmitter.removeListener(Events.LOG_ENTRY, logHandler);
        eventEmitter.removeListener(Events.PROCESS_EXIT, exitHandler);
        clearInterval(heartbeatInterval);
        res.end();
      }
    };
    eventEmitter.on(Events.PROCESS_EXIT, exitHandler);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json(createErrorResponse(error));
    }
    if (error.name === "NotFoundError") {
      return res.status(404).json(createErrorResponse(error));
    }
    next(error);
  }
});
const router$7 = express.Router();
const router$6 = express.Router();
const logger$6 = createLogger("preview-routes");
let previewManager;
router$6.use((req, res, next) => {
  if (!previewManager) {
    previewManager = new PreviewManager(req.app.locals.db, req.app.locals.processManager, req.app.locals.eventEmitter);
  }
  next();
});
router$6.get("/:executionId/analyze", async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    logger$6.info(`Analyzing project for execution ${executionId}`, { refType, refId });
    const analysis = await previewManager.analyzeProject(executionId, { refType, refId });
    res.json(analysis);
  } catch (error) {
    logger$6.error("Error analyzing project:", error);
    res.status(error.message === "Execution not found" ? 404 : 500).json({
      error: {
        code: error.message === "Execution not found" ? "EXECUTION_NOT_FOUND" : "ANALYSIS_FAILED",
        message: error.message,
        details: error.stack
      }
    });
  }
});
router$6.post("/:executionId/start", async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    const options = { ...req.body, refType, refId };
    logger$6.info(`Starting preview for execution ${executionId}`, {
      refType,
      refId,
      queryParams: req.query,
      fullUrl: req.originalUrl,
      options
    });
    const result = await previewManager.startPreview(executionId, options);
    res.json(result);
  } catch (error) {
    logger$6.error("Error starting preview:", error);
    let errorCode = "PREVIEW_START_FAILED";
    let statusCode = 500;
    if (error.message === "Execution not found") {
      errorCode = "EXECUTION_NOT_FOUND";
      statusCode = 404;
    } else if (error.message.includes("No available ports")) {
      errorCode = "PORT_UNAVAILABLE";
      statusCode = 503;
    } else if (error.message === "No command specified or available") {
      errorCode = "COMMAND_NOT_FOUND";
      statusCode = 400;
    }
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: error.message,
        details: error.stack
      }
    });
  }
});
router$6.get("/:executionId/status", async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    logger$6.info(`Getting preview status for execution ${executionId}`, { refType, refId });
    const status = await previewManager.getPreviewStatus(executionId, { refType, refId });
    res.json(status);
  } catch (error) {
    logger$6.error("Error getting preview status:", error);
    res.status(500).json({
      error: {
        code: "STATUS_FAILED",
        message: error.message,
        details: error.stack
      }
    });
  }
});
router$6.post("/:executionId/stop", async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    const { previewId, cleanup } = req.body;
    logger$6.info(`Stopping preview for execution ${executionId}`, { previewId, cleanup, refType, refId });
    const result = await previewManager.stopPreview(executionId, previewId, { refType, refId });
    res.json(result);
  } catch (error) {
    logger$6.error("Error stopping preview:", error);
    res.status(500).json({
      error: {
        code: "STOP_FAILED",
        message: error.message,
        details: error.stack
      }
    });
  }
});
router$6.post("/:executionId/restart", async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    const { previewId, force = false } = req.body;
    logger$6.info(`Restarting preview for execution ${executionId}`, { previewId, refType, refId, force });
    if (previewId) {
      const preview = await req.app.locals.db.get(
        "SELECT * FROM preview_processes WHERE id = ? AND execution_id = ?",
        [previewId, executionId]
      );
      if (!preview) {
        return res.status(404).json({
          error: {
            code: "PREVIEW_NOT_FOUND",
            message: "Preview not found"
          }
        });
      }
      if (["installing", "starting", "running"].includes(preview.status)) {
        await previewManager.stopPreview(executionId, previewId);
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
      const result = await previewManager.startPreview(executionId, {
        refType: preview.ref_type,
        refId: preview.ref_id,
        installDependencies: !force
        // Skip install if force=true
      });
      res.json({
        ...result,
        restarted: true,
        previousPreviewId: previewId
      });
    } else if (refType && refId) {
      const existingPreviews = await req.app.locals.db.all(
        "SELECT * FROM preview_processes WHERE execution_id = ? AND ref_type = ? AND ref_id = ? ORDER BY started_at DESC",
        [executionId, refType, refId]
      );
      for (const preview of existingPreviews) {
        if (["installing", "starting", "running"].includes(preview.status)) {
          await previewManager.stopPreview(executionId, preview.id);
        }
      }
      if (existingPreviews.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
      const result = await previewManager.startPreview(executionId, {
        refType,
        refId,
        installDependencies: !force
      });
      res.json({
        ...result,
        restarted: true,
        hadExistingPreviews: existingPreviews.length > 0
      });
    } else {
      return res.status(400).json({
        error: {
          code: "MISSING_PARAMETERS",
          message: "Either previewId or both refType and refId must be provided"
        }
      });
    }
  } catch (error) {
    logger$6.error("Error restarting preview:", error);
    let errorCode = "RESTART_FAILED";
    let statusCode = 500;
    if (error.message === "Execution not found") {
      errorCode = "EXECUTION_NOT_FOUND";
      statusCode = 404;
    } else if (error.message.includes("No available ports")) {
      errorCode = "PORT_UNAVAILABLE";
      statusCode = 503;
    }
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: error.message,
        details: error.stack
      }
    });
  }
});
router$6.get("/:executionId/logs", async (req, res) => {
  try {
    const { executionId } = req.params;
    const { previewId } = req.query;
    if (!previewId) {
      return res.status(400).json({
        error: {
          code: "PREVIEW_ID_REQUIRED",
          message: "Preview ID is required as a query parameter"
        }
      });
    }
    logger$6.info(`Starting log stream for preview ${previewId}`);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    previewManager.addSSEConnection(previewId, res);
    const preview = await req.app.locals.db.get(
      "SELECT * FROM preview_processes WHERE id = ? AND execution_id = ?",
      [previewId, executionId]
    );
    if (!preview) {
      res.write(`event: error
data: ${JSON.stringify({ message: "Preview not found" })}

`);
      res.end();
      return;
    }
    const recentLogs = await req.app.locals.db.all(
      "SELECT * FROM preview_logs WHERE preview_id = ? ORDER BY timestamp DESC LIMIT 50",
      [previewId]
    );
    recentLogs.reverse().forEach((log) => {
      res.write(`event: log
data: ${JSON.stringify({
        timestamp: log.timestamp,
        type: log.type,
        content: log.content
      })}

`);
    });
    const urls = JSON.parse(preview.urls || "{}");
    res.write(`event: status
data: ${JSON.stringify({
      status: preview.status,
      port: preview.port,
      url: urls.local
    })}

`);
    const heartbeat = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, 3e4);
    req.on("close", () => {
      clearInterval(heartbeat);
      previewManager.removeSSEConnection(previewId, res);
      logger$6.info(`Log stream closed for preview ${previewId}`);
    });
  } catch (error) {
    logger$6.error("Error streaming logs:", error);
    res.status(500).json({
      error: {
        code: "STREAM_FAILED",
        message: error.message,
        details: error.stack
      }
    });
  }
});
router$6.post("/:executionId/install", async (req, res) => {
  try {
    const { executionId } = req.params;
    const { refType, refId } = req.query;
    const options = { ...req.body, refType, refId };
    logger$6.info(`Installing dependencies for execution ${executionId}`, options);
    const result = await previewManager.installDependencies(executionId, options);
    res.json(result);
  } catch (error) {
    logger$6.error("Error installing dependencies:", error);
    let errorCode = "INSTALL_FAILED";
    let statusCode = 500;
    if (error.message === "Execution not found") {
      errorCode = "EXECUTION_NOT_FOUND";
      statusCode = 404;
    } else if (error.message === "No package manager detected") {
      errorCode = "NO_PACKAGE_MANAGER";
      statusCode = 400;
    }
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: error.message,
        details: error.stack
      }
    });
  }
});
const router$5 = express.Router();
const logger$5 = createLogger("refs-routes");
let refManager;
function getRefManager(req) {
  if (!refManager) {
    refManager = new RefManager(req.app.locals.workspace.workspace);
  }
  return refManager;
}
router$5.get("/refs", async (req, res, next) => {
  try {
    const manager = getRefManager(req);
    const refsDir = path.join(req.app.locals.workspace.workspace, "refs");
    const refs = [];
    try {
      const entries = await promises.readdir(refsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const refId = entry.name;
          const refPath = path.join(refsDir, refId);
          try {
            const branchInfo = await manager.listBranches(refId);
            const branches = branchInfo.branches;
            const currentBranch = branchInfo.current;
            const lastCommit = await manager.execGit(
              refPath,
              "log -1 --format=%H%n%an%n%ae%n%at%n%s"
            );
            const [hash, author, email, timestamp, subject] = lastCommit.split("\n");
            const worktrees = await manager.listWorktrees(refId);
            const activeExecutions = worktrees.filter((w) => w.branch && w.branch.startsWith("exec-")).map((w) => w.branch.replace("exec-", ""));
            refs.push({
              refId,
              currentBranch,
              branches: branches.map((b) => b.name),
              lastCommit: {
                hash,
                author,
                email,
                timestamp: new Date(parseInt(timestamp) * 1e3).toISOString(),
                message: subject
              },
              activeExecutions
            });
          } catch (error) {
            logger$5.error(`Error getting info for ref ${refId}:`, error);
            refs.push({
              refId,
              error: "Failed to get reference info"
            });
          }
        }
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.json({ refs: [] });
      }
      throw error;
    }
    res.json({ refs });
  } catch (error) {
    next(error);
  }
});
router$5.get("/refs/:refId/info", async (req, res, next) => {
  try {
    const { refId } = req.params;
    const manager = getRefManager(req);
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: "REF_NOT_FOUND",
          message: `Reference '${refId}' not found`
        }
      });
    }
    const refPath = path.join(req.app.locals.workspace.workspace, "refs", refId);
    const currentBranch = await manager.execGit(refPath, "rev-parse --abbrev-ref HEAD");
    const branchInfo = await manager.listBranches(refId);
    const branches = branchInfo.branches;
    const branchDetails = [];
    for (const branch of branches) {
      const commitInfo = await manager.execGit(
        refPath,
        `log -1 --format=%H%n%at%n%s ${branch.name}`
      );
      const [hash, timestamp, subject] = commitInfo.split("\n");
      branchDetails.push({
        name: branch.name,
        isHead: branch.isHead,
        lastCommit: {
          hash,
          timestamp: new Date(parseInt(timestamp) * 1e3).toISOString(),
          message: subject
        }
      });
    }
    const recentCommits = await manager.execGit(
      refPath,
      "log -10 --format=%H%n%an%n%ae%n%at%n%s%n"
    );
    const commits = [];
    const lines = recentCommits.trim().split("\n");
    for (let i = 0; i < lines.length; i += 6) {
      if (lines[i]) {
        commits.push({
          hash: lines[i],
          author: lines[i + 1],
          email: lines[i + 2],
          timestamp: new Date(parseInt(lines[i + 3]) * 1e3).toISOString(),
          message: lines[i + 4]
        });
      }
    }
    const worktrees = await manager.listWorktrees(refId);
    const activeExecutions = worktrees.filter((w) => w.branch && w.branch.startsWith("exec-")).map((w) => ({
      executionId: w.branch.replace("exec-", ""),
      branch: w.branch,
      path: w.worktree
    }));
    const fileCount = await manager.execGit(refPath, "ls-files | wc -l");
    const size = await manager.execGit(refPath, "count-objects -v");
    const sizeMatch = size.match(/size: (\d+)/);
    res.json({
      refId,
      currentBranch,
      branches: branchDetails,
      recentCommits: commits,
      activeExecutions,
      stats: {
        fileCount: parseInt(fileCount.trim()),
        sizeKB: sizeMatch ? parseInt(sizeMatch[1]) : 0
      }
    });
  } catch (error) {
    next(error);
  }
});
router$5.get("/refs/:refId/branches", async (req, res, next) => {
  try {
    const { refId } = req.params;
    const manager = getRefManager(req);
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: "REF_NOT_FOUND",
          message: `Reference '${refId}' not found`
        }
      });
    }
    const branchInfo = await manager.listBranches(refId);
    const branches = branchInfo.branches;
    const currentBranch = branchInfo.current;
    const refPath = path.join(req.app.locals.workspace.workspace, "refs", refId);
    const branchDetails = [];
    for (const branch of branches) {
      const commitInfo = await manager.execGit(
        refPath,
        `log -1 --format=%H%n%an%n%at%n%s ${branch.name}`
      );
      const [hash, author, timestamp, subject] = commitInfo.split("\n");
      branchDetails.push({
        name: branch.name,
        isHead: branch.isHead,
        isCurrent: branch.name === currentBranch,
        isExecutionBranch: branch.name.startsWith("exec-"),
        lastCommit: {
          hash,
          author,
          timestamp: new Date(parseInt(timestamp) * 1e3).toISOString(),
          message: subject
        }
      });
    }
    res.json({
      currentBranch,
      branches: branchDetails
    });
  } catch (error) {
    next(error);
  }
});
router$5.post("/refs/:refId/checkout", async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { branch } = req.body;
    const manager = getRefManager(req);
    if (!branch) {
      return res.status(400).json({
        error: {
          code: "MISSING_BRANCH",
          message: "Branch name is required"
        }
      });
    }
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: "REF_NOT_FOUND",
          message: `Reference '${refId}' not found`
        }
      });
    }
    const refPath = path.join(req.app.locals.workspace.workspace, "refs", refId);
    const branchInfo = await manager.listBranches(refId);
    const branchExists = branchInfo.branches.some((b) => b.name === branch);
    if (!branchExists) {
      return res.status(404).json({
        error: {
          code: "BRANCH_NOT_FOUND",
          message: `Branch '${branch}' not found in reference '${refId}'`
        }
      });
    }
    await manager.execGit(refPath, `checkout ${manager.escapeArg(branch)}`);
    res.json({
      refId,
      branch,
      success: true
    });
  } catch (error) {
    next(error);
  }
});
router$5.get("/refs/:refId/files", async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { branch = "HEAD", path: dirPath = "", recursive = false } = req.query;
    const manager = getRefManager(req);
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: "REF_NOT_FOUND",
          message: `Reference '${refId}' not found`
        }
      });
    }
    if (recursive === "true" || recursive === true) {
      const files = await manager.listFiles(refId, branch, dirPath);
      res.json({ files });
    } else {
      const entries = await manager.listDirectory(refId, branch, dirPath);
      res.json({ entries });
    }
  } catch (error) {
    if (error.message.includes("pathspec") && error.message.includes("did not match") || error.message.includes("Branch") && error.message.includes("or path") && error.message.includes("not found")) {
      return res.status(404).json({
        error: {
          code: "PATH_NOT_FOUND",
          message: "Path not found in repository"
        }
      });
    }
    if (error.message.includes("unknown revision")) {
      return res.status(404).json({
        error: {
          code: "BRANCH_NOT_FOUND",
          message: "Branch or revision not found"
        }
      });
    }
    next(error);
  }
});
router$5.get("/refs/:refId/file", async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { branch = "HEAD", path: filePath } = req.query;
    const manager = getRefManager(req);
    if (!filePath) {
      return res.status(400).json({
        error: {
          code: "MISSING_PATH",
          message: "File path is required"
        }
      });
    }
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: "REF_NOT_FOUND",
          message: `Reference '${refId}' not found`
        }
      });
    }
    try {
      const fileInfo = await manager.getFileInfo(refId, branch, filePath);
      if (!fileInfo) {
        return res.status(404).json({
          error: {
            code: "FILE_NOT_FOUND",
            message: "File not found in repository"
          }
        });
      }
      if (fileInfo.type !== "blob") {
        return res.status(400).json({
          error: {
            code: "NOT_A_FILE",
            message: "Path is not a file"
          }
        });
      }
      const fileData = await manager.readFile(refId, branch, filePath);
      if (!fileData.found) {
        return res.status(404).json({
          error: {
            code: "FILE_NOT_FOUND",
            message: "File not found in repository"
          }
        });
      }
      const buffer = fileData.content;
      const isBinary = fileData.isBinary;
      if (isBinary) {
        res.json({
          path: filePath,
          encoding: "base64",
          content: buffer.toString("base64"),
          size: fileInfo.size,
          mode: fileInfo.mode
        });
      } else {
        res.json({
          path: filePath,
          encoding: "utf8",
          content: buffer.toString("utf8"),
          size: fileInfo.size,
          mode: fileInfo.mode
        });
      }
    } catch (error) {
      if (error.message.includes("pathspec") && error.message.includes("did not match")) {
        return res.status(404).json({
          error: {
            code: "FILE_NOT_FOUND",
            message: "File not found in repository"
          }
        });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});
router$5.get("/refs/:refId/executions", async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { db } = req.app.locals;
    const executions = await db.all(`
      SELECT DISTINCT 
        e.id,
        e.status,
        e.phase,
        e.agent_type,
        e.created_at as created,
        e.completed_at as completed,
        e.rollback_reason as error,
        e.message_count,
        e.workspace_path
      FROM executions e
      INNER JOIN execution_refs er ON e.id = er.execution_id
      WHERE er.ref_id = ? AND er.permission = 'mutate'
      ORDER BY e.created_at DESC
    `, [refId]);
    const executionsWithRefs = await Promise.all(executions.map(async (exec2) => {
      const readRefs = await db.all(`
        SELECT ref_id
        FROM execution_refs
        WHERE execution_id = ? AND permission = 'read'
      `, [exec2.id]);
      return {
        ...exec2,
        readReferences: readRefs.map((r) => r.ref_id)
      };
    }));
    res.json({
      refId,
      executions: executionsWithRefs
    });
  } catch (error) {
    logger$5.error("Failed to get executions for ref", { refId: req.params.refId, error: error.message });
    next(error);
  }
});
router$5.post("/refs/:refId/merge", async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { sourceBranch, targetBranch = "main", strategy = "merge", commitMessage } = req.body;
    const manager = getRefManager(req);
    if (!sourceBranch) {
      return res.status(400).json({
        error: {
          code: "MISSING_SOURCE_BRANCH",
          message: "Source branch is required"
        }
      });
    }
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: "REF_NOT_FOUND",
          message: `Reference '${refId}' not found`
        }
      });
    }
    const refPath = path.join(req.app.locals.workspace.workspace, "refs", refId);
    const branchInfo = await manager.listBranches(refId);
    const branches = branchInfo.branches.map((b) => b.name);
    if (!branches.includes(sourceBranch)) {
      return res.status(404).json({
        error: {
          code: "SOURCE_BRANCH_NOT_FOUND",
          message: `Source branch '${sourceBranch}' not found`
        }
      });
    }
    if (!branches.includes(targetBranch)) {
      return res.status(404).json({
        error: {
          code: "TARGET_BRANCH_NOT_FOUND",
          message: `Target branch '${targetBranch}' not found`
        }
      });
    }
    const originalTargetCommit = await manager.execGit(refPath, `rev-parse ${manager.escapeArg(targetBranch)}`);
    await manager.execGit(refPath, `checkout ${manager.escapeArg(targetBranch)}`);
    try {
      let mergeOutput;
      let mergeCommit;
      if (strategy === "rebase") {
        mergeOutput = await manager.execGit(refPath, `rebase ${manager.escapeArg(sourceBranch)}`);
        mergeCommit = await manager.execGit(refPath, "rev-parse HEAD");
      } else if (strategy === "squash") {
        mergeOutput = await manager.execGit(refPath, `merge --squash ${manager.escapeArg(sourceBranch)}`);
        const message = commitMessage || `Squash merge of ${sourceBranch} into ${targetBranch}`;
        await manager.execGit(refPath, `commit -m ${manager.escapeArg(message)}`);
        mergeCommit = await manager.execGit(refPath, "rev-parse HEAD");
      } else if (strategy === "ff-only") {
        mergeOutput = await manager.execGit(refPath, `merge --ff-only ${manager.escapeArg(sourceBranch)}`);
        mergeCommit = await manager.execGit(refPath, "rev-parse HEAD");
      } else {
        const message = commitMessage || `Merge ${sourceBranch} into ${targetBranch}`;
        mergeOutput = await manager.execGit(
          refPath,
          `merge ${manager.escapeArg(sourceBranch)} -m ${manager.escapeArg(message)}`
        );
        mergeCommit = await manager.execGit(refPath, "rev-parse HEAD");
      }
      const commitInfo = await manager.execGit(refPath, "log -1 --format=%H%n%an%n%ae%n%at%n%s");
      const [hash, author, email, timestamp, subject] = commitInfo.split("\n");
      const diffOutput = await manager.execGit(refPath, `diff --stat ${originalTargetCommit}..HEAD`);
      if (req.app.locals.db) {
        try {
          await req.app.locals.db.run(
            `INSERT INTO ref_changes (execution_id, ref_id, change_type, branch_name, commit_hash, commit_message, merge_status) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [null, refId, "merge", sourceBranch, mergeCommit, subject, "success"]
          );
        } catch (dbError) {
          logger$5.warn("Failed to record merge in database:", dbError);
        }
      }
      res.json({
        success: true,
        refId,
        merge: {
          sourceBranch,
          targetBranch,
          strategy,
          commit: {
            hash,
            author,
            email,
            timestamp: new Date(parseInt(timestamp) * 1e3).toISOString(),
            message: subject
          },
          diff: {
            summary: diffOutput,
            originalCommit: originalTargetCommit,
            mergeCommit
          },
          output: mergeOutput
        }
      });
    } catch (error) {
      if (error.message.includes("CONFLICT") || error.message.includes("conflict")) {
        let conflictInfo = {};
        try {
          const status = await manager.execGit(refPath, "status --porcelain");
          const conflictFiles = status.split("\n").filter((line) => line.startsWith("UU ") || line.startsWith("AA ") || line.startsWith("DD ")).map((line) => line.substring(3).trim());
          conflictInfo = {
            files: conflictFiles,
            count: conflictFiles.length
          };
          if (conflictFiles.length > 0) {
            const conflictDetails = [];
            for (const file of conflictFiles.slice(0, 3)) {
              try {
                const content = await promises.readFile(path.join(refPath, file), "utf8");
                const conflicts = [];
                const lines = content.split("\n");
                let inConflict = false;
                let conflictStart = -1;
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].startsWith("<<<<<<<")) {
                    inConflict = true;
                    conflictStart = i;
                  } else if (lines[i].startsWith(">>>>>>>") && inConflict) {
                    conflicts.push({
                      startLine: conflictStart + 1,
                      endLine: i + 1,
                      lines: lines.slice(conflictStart, i + 1)
                    });
                    inConflict = false;
                  }
                }
                conflictDetails.push({
                  file,
                  conflicts
                });
              } catch (readError) {
                conflictDetails.push({
                  file,
                  error: "Could not read conflict details"
                });
              }
            }
            conflictInfo.details = conflictDetails;
          }
          try {
            if (strategy === "rebase") {
              await manager.execGit(refPath, "rebase --abort");
            } else {
              await manager.execGit(refPath, "merge --abort");
            }
          } catch (abortError) {
            logger$5.warn("Failed to abort merge:", abortError);
          }
        } catch (statusError) {
          logger$5.warn("Failed to get conflict details:", statusError);
        }
        return res.status(409).json({
          success: false,
          error: {
            code: "MERGE_CONFLICT",
            message: "Merge conflicts detected",
            conflicts: conflictInfo
          },
          refId,
          merge: {
            sourceBranch,
            targetBranch,
            strategy,
            aborted: true
          }
        });
      }
      throw error;
    }
  } catch (error) {
    logger$5.error(`Merge failed for ${req.params.refId}:`, error);
    try {
      const manager = getRefManager(req);
      const refPath = path.join(req.app.locals.workspace.workspace, "refs", req.params.refId);
      await manager.execGit(refPath, "checkout main");
    } catch (cleanupError) {
      logger$5.warn("Failed to cleanup after merge error:", cleanupError);
    }
    res.status(500).json({
      success: false,
      error: {
        code: "MERGE_FAILED",
        message: error.message
      },
      refId: req.params.refId
    });
  }
});
router$5.get("/refs/:refId/diff", async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { from, to = "main", format = "unified" } = req.query;
    const manager = getRefManager(req);
    if (!from) {
      return res.status(400).json({
        error: {
          code: "MISSING_FROM_BRANCH",
          message: "From branch is required"
        }
      });
    }
    if (!await manager.refExists(refId)) {
      return res.status(404).json({
        error: {
          code: "REF_NOT_FOUND",
          message: `Reference '${refId}' not found`
        }
      });
    }
    const refPath = path.join(req.app.locals.workspace.workspace, "refs", refId);
    const branchInfo = await manager.listBranches(refId);
    const branches = branchInfo.branches.map((b) => b.name);
    if (!branches.includes(from)) {
      return res.status(404).json({
        error: {
          code: "FROM_BRANCH_NOT_FOUND",
          message: `From branch '${from}' not found`
        }
      });
    }
    if (!branches.includes(to)) {
      return res.status(404).json({
        error: {
          code: "TO_BRANCH_NOT_FOUND",
          message: `To branch '${to}' not found`
        }
      });
    }
    const diffStat = await manager.execGit(
      refPath,
      `diff --stat ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
    );
    const commitCount = await manager.execGit(
      refPath,
      `rev-list --count ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
    );
    let diffContent;
    if (format === "name-only") {
      diffContent = await manager.execGit(
        refPath,
        `diff --name-only ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
      );
    } else if (format === "name-status") {
      diffContent = await manager.execGit(
        refPath,
        `diff --name-status ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
      );
    } else {
      diffContent = await manager.execGit(
        refPath,
        `diff ${manager.escapeArg(to)}..${manager.escapeArg(from)}`
      );
    }
    const changedFiles = [];
    if (diffStat) {
      const statLines = diffStat.split("\n").slice(0, -1);
      for (const line of statLines) {
        const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s+([+-]+)$/);
        if (match) {
          const [, filename, changes, indicators] = match;
          const additions = (indicators.match(/\+/g) || []).length;
          const deletions = (indicators.match(/-/g) || []).length;
          changedFiles.push({
            filename,
            changes: parseInt(changes),
            additions,
            deletions
          });
        }
      }
    }
    res.json({
      refId,
      diff: {
        from,
        to,
        format,
        commitCount: parseInt(commitCount) || 0,
        changedFiles,
        summary: diffStat,
        content: diffContent
      }
    });
  } catch (error) {
    next(error);
  }
});
router$5.get("/executions/:executionId/logs", async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { db } = req.app.locals;
    const logs = await db.all(`
      SELECT timestamp, type, content
      FROM logs
      WHERE execution_id = ?
      ORDER BY timestamp ASC
    `, [executionId]);
    res.json({
      executionId,
      logs: logs.map((log) => ({
        timestamp: log.timestamp,
        type: log.type,
        content: typeof log.content === "string" ? JSON.parse(log.content) : log.content
      }))
    });
  } catch (error) {
    logger$5.error("Failed to get logs for execution", { executionId: req.params.executionId, error: error.message });
    next(error);
  }
});
const logger$4 = createLogger("ref-preview-routes");
const router$4 = express.Router();
const activePreviews = /* @__PURE__ */ new Map();
let currentPort = 3e3;
const MAX_PORT = 3999;
function getNextAvailablePort() {
  currentPort++;
  if (currentPort > MAX_PORT) {
    currentPort = 3e3;
  }
  return currentPort;
}
async function detectPackageManager(refPath) {
  try {
    await promises.access(path.join(refPath, "package-lock.json"));
    return "npm";
  } catch {
  }
  try {
    await promises.access(path.join(refPath, "yarn.lock"));
    return "yarn";
  } catch {
  }
  try {
    await promises.access(path.join(refPath, "pnpm-lock.yaml"));
    return "pnpm";
  } catch {
  }
  try {
    await promises.access(path.join(refPath, "bun.lockb"));
    return "bun";
  } catch {
  }
  try {
    await promises.access(path.join(refPath, "package.json"));
    return "npm";
  } catch {
  }
  return null;
}
function getRefPath(workspace, refId) {
  return path.join(workspace, "refs", refId);
}
router$4.post("/refs/:refId/preview/start", async (req, res) => {
  try {
    const { refId } = req.params;
    const { workspace } = req.app.locals;
    logger$4.info(`Starting preview for ref ${refId}`);
    if (activePreviews.has(refId)) {
      const preview2 = activePreviews.get(refId);
      if (preview2.status === "running") {
        return res.json({
          success: true,
          previewId: preview2.id,
          port: preview2.port,
          url: `http://localhost:${preview2.port}`,
          status: "running"
        });
      }
    }
    const refPath = getRefPath(workspace.workspace, refId);
    try {
      await promises.access(refPath);
    } catch {
      return res.status(404).json({
        error: {
          code: "REF_NOT_FOUND",
          message: `Reference ${refId} not found`
        }
      });
    }
    const packageManager = await detectPackageManager(refPath);
    if (!packageManager) {
      return res.status(400).json({
        error: {
          code: "NO_PACKAGE_JSON",
          message: "No package.json found in reference"
        }
      });
    }
    const previewId = v4();
    const port = getNextAvailablePort();
    const preview = {
      id: previewId,
      refId,
      port,
      status: "installing",
      logs: [],
      process: null,
      eventEmitter: new EventEmitter()
    };
    activePreviews.set(refId, preview);
    logger$4.info(`Installing dependencies with ${packageManager} for ref ${refId}`);
    const installCmd = packageManager === "npm" ? "npm" : packageManager;
    const installArgs = ["install"];
    const installProcess = spawn(installCmd, installArgs, {
      cwd: refPath,
      env: { ...process.env, CI: "true" }
    });
    installProcess.stdout.on("data", (data) => {
      const log = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), type: "info", content: data.toString() };
      preview.logs.push(log);
      preview.eventEmitter.emit("log", log);
    });
    installProcess.stderr.on("data", (data) => {
      const log = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), type: "error", content: data.toString() };
      preview.logs.push(log);
      preview.eventEmitter.emit("log", log);
    });
    installProcess.on("close", (code) => {
      if (code !== 0) {
        preview.status = "error";
        preview.eventEmitter.emit("status", { status: "error" });
        return;
      }
      preview.status = "starting";
      preview.eventEmitter.emit("status", { status: "starting" });
      logger$4.info(`Starting dev server on port ${port} for ref ${refId}`);
      const devCmd = packageManager === "npm" ? "npm" : packageManager;
      const devArgs = ["run", "dev"];
      const devProcess = spawn(devCmd, devArgs, {
        cwd: refPath,
        env: {
          ...process.env,
          PORT: port.toString(),
          VITE_PORT: port.toString(),
          // For Vite
          NEXT_PORT: port.toString(),
          // For Next.js
          REACT_APP_PORT: port.toString()
          // For CRA
        }
      });
      preview.process = devProcess;
      devProcess.stdout.on("data", (data) => {
        const log = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), type: "info", content: data.toString() };
        preview.logs.push(log);
        preview.eventEmitter.emit("log", log);
        const output = data.toString().toLowerCase();
        if (output.includes("ready") || output.includes("running") || output.includes("started") || output.includes(`localhost:${port}`)) {
          preview.status = "running";
          preview.eventEmitter.emit("status", {
            status: "running",
            port: preview.port,
            url: `http://localhost:${preview.port}`
          });
        }
      });
      devProcess.stderr.on("data", (data) => {
        const log = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), type: "error", content: data.toString() };
        preview.logs.push(log);
        preview.eventEmitter.emit("log", log);
      });
      devProcess.on("close", (code2) => {
        logger$4.info(`Dev server for ref ${refId} exited with code ${code2}`);
        preview.status = "stopped";
        preview.eventEmitter.emit("status", { status: "stopped" });
        activePreviews.delete(refId);
      });
    });
    res.json({
      success: true,
      previewId,
      port,
      status: "installing"
    });
  } catch (error) {
    logger$4.error("Error starting preview:", error);
    res.status(500).json({
      error: {
        code: "PREVIEW_START_FAILED",
        message: error.message
      }
    });
  }
});
router$4.get("/refs/:refId/preview/status", async (req, res) => {
  try {
    const { refId } = req.params;
    const preview = activePreviews.get(refId);
    if (!preview) {
      return res.json({
        status: "stopped",
        running: false
      });
    }
    res.json({
      status: preview.status,
      running: preview.status === "running",
      port: preview.port,
      url: preview.status === "running" ? `http://localhost:${preview.port}` : void 0,
      previewId: preview.id
    });
  } catch (error) {
    logger$4.error("Error getting preview status:", error);
    res.status(500).json({
      error: {
        code: "STATUS_FAILED",
        message: error.message
      }
    });
  }
});
router$4.post("/refs/:refId/preview/stop", async (req, res) => {
  try {
    const { refId } = req.params;
    const preview = activePreviews.get(refId);
    if (!preview) {
      return res.json({ success: true });
    }
    if (preview.process) {
      preview.process.kill("SIGTERM");
      setTimeout(() => {
        if (preview.process && !preview.process.killed) {
          preview.process.kill("SIGKILL");
        }
      }, 5e3);
    }
    activePreviews.delete(refId);
    res.json({ success: true });
  } catch (error) {
    logger$4.error("Error stopping preview:", error);
    res.status(500).json({
      error: {
        code: "STOP_FAILED",
        message: error.message
      }
    });
  }
});
router$4.get("/refs/:refId/preview/logs", async (req, res) => {
  try {
    const { refId } = req.params;
    const { previewId } = req.query;
    const preview = activePreviews.get(refId);
    if (!preview || preview.id !== previewId) {
      return res.status(404).json({
        error: {
          code: "PREVIEW_NOT_FOUND",
          message: "Preview not found"
        }
      });
    }
    logger$4.info(`Starting log stream for ref ${refId} preview ${previewId}`);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    preview.logs.slice(-50).forEach((log) => {
      res.write(`event: log
data: ${JSON.stringify(log)}

`);
    });
    res.write(`event: status
data: ${JSON.stringify({
      status: preview.status,
      port: preview.port,
      url: preview.status === "running" ? `http://localhost:${preview.port}` : void 0
    })}

`);
    const logHandler = (log) => {
      res.write(`event: log
data: ${JSON.stringify(log)}

`);
    };
    const statusHandler = (status) => {
      res.write(`event: status
data: ${JSON.stringify(status)}

`);
    };
    preview.eventEmitter.on("log", logHandler);
    preview.eventEmitter.on("status", statusHandler);
    const heartbeat = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, 3e4);
    req.on("close", () => {
      clearInterval(heartbeat);
      preview.eventEmitter.off("log", logHandler);
      preview.eventEmitter.off("status", statusHandler);
      logger$4.info(`Log stream closed for ref ${refId}`);
    });
  } catch (error) {
    logger$4.error("Error streaming logs:", error);
    res.status(500).json({
      error: {
        code: "STREAM_FAILED",
        message: error.message
      }
    });
  }
});
const logger$3 = createLogger("CleanupManager");
class CleanupManager {
  constructor(workspaceManager, refManager2, contextManager, db) {
    this.workspaceManager = workspaceManager;
    this.refManager = refManager2;
    this.contextManager = contextManager;
    this.db = db;
  }
  /**
   * Clean up all resources for an execution
   */
  async cleanupExecution(executionId, options = {}) {
    logger$3.info(`Starting cleanup for execution ${executionId}`);
    const results = {
      success: true,
      worktrees: { removed: 0, failed: 0 },
      workspace: { removed: false },
      branches: { removed: 0, failed: 0 },
      errors: []
    };
    try {
      const manifest = await this.contextManager.getExecutionManifest(executionId);
      if (!manifest) {
        logger$3.warn(`No manifest found for execution ${executionId}, cleaning workspace only`);
        return await this.cleanupWorkspaceOnly(executionId, options);
      }
      if (manifest.worktrees) {
        const worktreeResults = await this.cleanupWorktrees(executionId, manifest.worktrees, options);
        results.worktrees = worktreeResults;
      }
      if (!options.keepBranches && manifest.worktrees) {
        const branchResults = await this.cleanupBranches(executionId, manifest.worktrees);
        results.branches = branchResults;
      }
      if (!options.keepWorkspace) {
        try {
          await this.contextManager.cleanupExecutionWorkspace(executionId);
          results.workspace.removed = true;
        } catch (error) {
          logger$3.error(`Failed to cleanup workspace for ${executionId}:`, error);
          results.errors.push({ type: "workspace", error: error.message });
          results.success = false;
        }
      }
      if (options.updateDatabase !== false) {
        await this.updateCleanupStatus(executionId, results);
      }
    } catch (error) {
      logger$3.error(`Cleanup failed for execution ${executionId}:`, error);
      results.success = false;
      results.errors.push({ type: "general", error: error.message });
    }
    logger$3.info(`Cleanup completed for execution ${executionId}`, results);
    return results;
  }
  /**
   * Clean up worktrees
   */
  async cleanupWorktrees(executionId, worktrees, options = {}) {
    const results = { removed: 0, failed: 0, details: {} };
    for (const [refId, worktreeInfo] of Object.entries(worktrees)) {
      try {
        logger$3.info(`Removing worktree for ref ${refId} in execution ${executionId}`);
        if (options.force) {
          try {
            await this.refManager.execGit(worktreeInfo.worktreePath, "reset --hard HEAD");
            await this.refManager.execGit(worktreeInfo.worktreePath, "clean -fd");
          } catch (e) {
          }
        }
        await this.refManager.removeWorktree(refId, worktreeInfo.worktreePath);
        results.removed++;
        results.details[refId] = { success: true };
      } catch (error) {
        logger$3.error(`Failed to remove worktree for ref ${refId}:`, error);
        results.failed++;
        results.details[refId] = { success: false, error: error.message };
      }
    }
    return results;
  }
  /**
   * Clean up execution branches (DISABLED - we preserve branches for audit trail)
   */
  async cleanupBranches(executionId, worktrees) {
    const results = { removed: 0, failed: 0, details: {} };
    const branchName = `exec-${executionId}`;
    logger$3.info(`Preserving execution branch ${branchName} for audit trail`);
    for (const [refId, worktreeInfo] of Object.entries(worktrees)) {
      results.details[refId] = {
        success: true,
        action: "preserved",
        message: "Execution branch preserved for audit trail"
      };
    }
    return results;
  }
  /**
   * Clean up workspace when no manifest exists
   */
  async cleanupWorkspaceOnly(executionId, options = {}) {
    const results = {
      success: true,
      workspace: { removed: false },
      errors: []
    };
    if (!options.keepWorkspace) {
      try {
        const executionPath = path.join(this.workspaceManager.getWorkspacePath(), ".execution", `exec-${executionId}`);
        await promises.rm(executionPath, { recursive: true, force: true });
        results.workspace.removed = true;
      } catch (error) {
        logger$3.error(`Failed to cleanup workspace for ${executionId}:`, error);
        results.success = false;
        results.errors.push({ type: "workspace", error: error.message });
      }
    }
    return results;
  }
  /**
   * Clean up orphaned executions older than specified hours
   */
  async cleanupOrphanedExecutions(olderThanHours = 24) {
    logger$3.info(`Cleaning up orphaned executions older than ${olderThanHours} hours`);
    const results = {
      checked: 0,
      cleaned: 0,
      failed: 0,
      errors: []
    };
    try {
      const executionsDir = path.join(this.workspaceManager.getWorkspacePath(), ".execution");
      const entries = await promises.readdir(executionsDir, { withFileTypes: true });
      const cutoffTime = Date.now() - olderThanHours * 60 * 60 * 1e3;
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("exec-")) {
          results.checked++;
          const executionId = entry.name.substring(5);
          const executionPath = path.join(executionsDir, entry.name);
          try {
            const execution = await this.db.get(
              "SELECT id, status, created_at, workspace_preserved FROM executions WHERE id = ?",
              [executionId]
            );
            const stat = await promises.stat(executionPath);
            const isOld = stat.mtimeMs < cutoffTime;
            if (!execution && isOld) {
              logger$3.info(`Cleaning orphaned execution ${executionId} (not in database)`);
              await this.cleanupExecution(executionId, { force: true });
              results.cleaned++;
            } else if (execution && isOld && ["completed", "failed"].includes(execution.status)) {
              if (execution.workspace_preserved === 1) {
                logger$3.info(`Skipping preserved execution ${executionId}`);
              } else {
                logger$3.info(`Cleaning old ${execution.status} execution ${executionId}`);
                await this.cleanupExecution(executionId, { force: true });
                results.cleaned++;
              }
            }
          } catch (error) {
            logger$3.error(`Failed to process execution ${executionId}:`, error);
            results.failed++;
            results.errors.push({ executionId, error: error.message });
          }
        }
      }
    } catch (error) {
      logger$3.error("Failed to list execution directories:", error);
      results.errors.push({ type: "list", error: error.message });
    }
    logger$3.info("Orphaned execution cleanup completed", results);
    return results;
  }
  /**
   * Rollback an execution (remove without merging)
   */
  async rollbackExecution(executionId, reason = "User requested rollback") {
    logger$3.info(`Rolling back execution ${executionId}: ${reason}`);
    try {
      const execution = await this.db.get(
        "SELECT * FROM executions WHERE id = ?",
        [executionId]
      );
      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }
      await this.db.run(
        `INSERT INTO ref_changes (execution_id, ref_id, change_type, commit_message) 
         VALUES (?, ?, ?, ?)`,
        [executionId, null, "rollback", reason]
      );
      const results = await this.cleanupExecution(executionId, {
        force: true,
        keepBranches: false,
        keepWorkspace: false
      });
      await this.db.run(
        "UPDATE executions SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
        ["rolled_back", executionId]
      );
      return {
        success: true,
        executionId,
        reason,
        cleanup: results
      };
    } catch (error) {
      logger$3.error(`Rollback failed for execution ${executionId}:`, error);
      return {
        success: false,
        executionId,
        error: error.message
      };
    }
  }
  /**
   * Update cleanup status in database
   */
  async updateCleanupStatus(executionId, results) {
    try {
      const cleanupData = JSON.stringify({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        results
      });
      await this.db.run(
        `UPDATE executions 
         SET cleanup_status = ?, cleanup_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [cleanupData, executionId]
      );
    } catch (error) {
      logger$3.error(`Failed to update cleanup status for ${executionId}:`, error);
    }
  }
  /**
   * Get cleanup status for an execution
   */
  async getCleanupStatus(executionId) {
    const execution = await this.db.get(
      "SELECT cleanup_status, cleanup_at FROM executions WHERE id = ?",
      [executionId]
    );
    if (!execution || !execution.cleanup_status) {
      return null;
    }
    try {
      return JSON.parse(execution.cleanup_status);
    } catch (error) {
      return execution.cleanup_status;
    }
  }
}
const logger$2 = createLogger("cleanup-routes");
const router$3 = express.Router();
router$3.post("/executions/:executionId/cleanup", async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { force = false, keepBranches = false, keepWorkspace = false } = req.body;
    const { workspaceManager, db } = req.app.locals;
    const refManager2 = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager2);
    const cleanupManager = new CleanupManager(workspaceManager, refManager2, contextManager, db);
    logger$2.info(`Manual cleanup requested for execution ${executionId}`, { force, keepBranches, keepWorkspace });
    const results = await cleanupManager.cleanupExecution(executionId, {
      force,
      keepBranches,
      keepWorkspace
    });
    res.json({
      executionId,
      cleanup: results
    });
  } catch (error) {
    logger$2.error("Cleanup error:", error);
    next(error);
  }
});
router$3.post("/executions/:executionId/rollback", async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { reason = "Manual rollback requested" } = req.body;
    const { workspaceManager, db } = req.app.locals;
    const refManager2 = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager2);
    const cleanupManager = new CleanupManager(workspaceManager, refManager2, contextManager, db);
    logger$2.info(`Rollback requested for execution ${executionId}`, { reason });
    const result = await cleanupManager.rollbackExecution(executionId, reason);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({
        error: {
          code: "ROLLBACK_FAILED",
          message: result.error
        }
      });
    }
  } catch (error) {
    logger$2.error("Rollback error:", error);
    next(error);
  }
});
router$3.get("/executions/:executionId/cleanup/status", async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { workspaceManager, db } = req.app.locals;
    const refManager2 = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager2);
    const cleanupManager = new CleanupManager(workspaceManager, refManager2, contextManager, db);
    const status = await cleanupManager.getCleanupStatus(executionId);
    if (status) {
      res.json({
        executionId,
        cleanupStatus: status
      });
    } else {
      res.status(404).json({
        error: {
          code: "NO_CLEANUP_STATUS",
          message: "No cleanup status found for this execution"
        }
      });
    }
  } catch (error) {
    logger$2.error("Get cleanup status error:", error);
    next(error);
  }
});
router$3.post("/cleanup/orphaned", async (req, res, next) => {
  try {
    const { olderThanHours = 24 } = req.body;
    const { workspaceManager, db } = req.app.locals;
    const refManager2 = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager2);
    const cleanupManager = new CleanupManager(workspaceManager, refManager2, contextManager, db);
    logger$2.info(`Cleaning orphaned executions older than ${olderThanHours} hours`);
    const results = await cleanupManager.cleanupOrphanedExecutions(olderThanHours);
    res.json({
      olderThanHours,
      results
    });
  } catch (error) {
    logger$2.error("Orphaned cleanup error:", error);
    next(error);
  }
});
router$3.delete("/executions/:executionId/workspace", async (req, res, next) => {
  try {
    const executionId = validateExecutionId(req.params.executionId);
    const { workspaceManager, db } = req.app.locals;
    const execution = await db.get(
      "SELECT id, status FROM executions WHERE id = ?",
      [executionId]
    );
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    if (execution.status === ExecutionStatus.RUNNING || execution.status === ExecutionStatus.STARTING) {
      throw new ProcessError(
        ErrorCodes.PROCESS_RUNNING,
        `Cannot delete workspace for running execution (status: ${execution.status})`
      );
    }
    logger$2.info(`Manual workspace deletion requested for execution ${executionId}`);
    const refManager2 = new RefManager(workspaceManager.getWorkspacePath());
    const contextManager = new ExecutionContextManager(workspaceManager, refManager2);
    const cleanupManager = new CleanupManager(workspaceManager, refManager2, contextManager, db);
    const results = await cleanupManager.cleanupExecution(executionId, {
      keepBranches: true,
      // Still preserve branches for audit
      keepWorkspace: false,
      updateDatabase: true
    });
    await db.run(
      "UPDATE executions SET workspace_preserved = 0 WHERE id = ?",
      [executionId]
    );
    res.json({
      success: results.success,
      executionId,
      cleanup: results
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json(createErrorResponse(error));
    }
    if (error.name === "NotFoundError") {
      return res.status(404).json(createErrorResponse(error));
    }
    if (error.name === "ProcessError") {
      return res.status(400).json(createErrorResponse(error));
    }
    next(error);
  }
});
const logger$1 = createLogger("resources-routes");
const router$2 = express.Router();
router$2.get("/resources/status", async (req, res, next) => {
  try {
    const { resourceMonitor } = req.app.locals;
    if (!resourceMonitor) {
      return res.status(503).json({
        error: {
          code: "RESOURCE_MONITOR_UNAVAILABLE",
          message: "Resource monitoring is not enabled"
        }
      });
    }
    const report = await resourceMonitor.getResourceReport();
    res.json({
      status: report.healthy ? "healthy" : "warning",
      timestamp: report.timestamp,
      limits: report.limits,
      usage: report.usage
    });
  } catch (error) {
    logger$1.error("Resource status error:", error);
    next(error);
  }
});
router$2.get("/resources/can-execute", async (req, res, next) => {
  try {
    const { resourceMonitor } = req.app.locals;
    if (!resourceMonitor) {
      return res.json({
        canExecute: true,
        reason: "Resource monitoring disabled"
      });
    }
    const canExecute = await resourceMonitor.canStartExecution();
    const checks = await Promise.all([
      resourceMonitor.checkConcurrentExecutions(),
      resourceMonitor.checkDiskUsage(),
      resourceMonitor.checkSystemResources()
    ]);
    const blockedBy = checks.filter((check) => !check.allowed);
    res.json({
      canExecute,
      checks: checks.reduce((acc, check) => {
        acc[check.type] = {
          allowed: check.allowed,
          current: check.current,
          limit: check.limit,
          message: check.message
        };
        return acc;
      }, {}),
      blockedBy: blockedBy.map((check) => check.type)
    });
  } catch (error) {
    logger$1.error("Can execute check error:", error);
    next(error);
  }
});
router$2.get("/resources/usage/history", async (req, res, next) => {
  try {
    const { db } = req.app.locals;
    const {
      hours = 24,
      type = null,
      limit = 100
    } = req.query;
    let sql = `
      SELECT * FROM resource_usage 
      WHERE timestamp > datetime('now', '-${parseInt(hours)} hours')
    `;
    const params = [];
    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }
    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(parseInt(limit));
    const history = await db.all(sql, params);
    res.json({
      history: history.map((record) => ({
        timestamp: record.timestamp,
        type: record.type,
        current: record.current_value,
        limit: record.limit_value,
        exceeded: Boolean(record.exceeded),
        details: record.details ? JSON.parse(record.details) : null
      })),
      totalRecords: history.length,
      hoursBack: parseInt(hours)
    });
  } catch (error) {
    logger$1.error("Resource history error:", error);
    next(error);
  }
});
const logger = createLogger("monitoring-routes");
const router$1 = express.Router();
router$1.get("/monitoring/metrics", async (req, res, next) => {
  try {
    const { performanceMonitor } = req.app.locals;
    if (!performanceMonitor) {
      return res.status(503).json({
        error: {
          code: "PERFORMANCE_MONITOR_UNAVAILABLE",
          message: "Performance monitoring is not enabled"
        }
      });
    }
    const metrics = performanceMonitor.getMetrics();
    const slowOps = performanceMonitor.getSlowOperations(parseInt(req.query.slowThreshold) || 5e3);
    const activeOps = performanceMonitor.getActiveOperations();
    const stuckOps = performanceMonitor.getStuckOperations(parseInt(req.query.stuckThreshold) || 3e5);
    res.json({
      metrics: metrics.metrics,
      summary: {
        activeOperations: metrics.activeOperations,
        slowOperations: slowOps.length,
        stuckOperations: stuckOps.length,
        generatedAt: metrics.generatedAt
      },
      slowOperations: slowOps,
      activeOperations: activeOps,
      stuckOperations: stuckOps
    });
  } catch (error) {
    logger.error("Get metrics error:", error);
    next(error);
  }
});
router$1.get("/monitoring/audit/:executionId", async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const { auditLogger } = req.app.locals;
    if (!auditLogger) {
      return res.status(503).json({
        error: {
          code: "AUDIT_LOGGER_UNAVAILABLE",
          message: "Audit logging is not enabled"
        }
      });
    }
    const auditTrail = await auditLogger.getExecutionAuditTrail(executionId);
    res.json({
      execution: executionId,
      auditTrail
    });
  } catch (error) {
    logger.error("Get audit trail error:", error);
    next(error);
  }
});
router$1.get("/monitoring/system", async (req, res, next) => {
  try {
    const { auditLogger } = req.app.locals;
    const { timeWindow = "24 hours" } = req.query;
    if (!auditLogger) {
      return res.status(503).json({
        error: {
          code: "AUDIT_LOGGER_UNAVAILABLE",
          message: "Audit logging is not enabled"
        }
      });
    }
    const systemMetrics = await auditLogger.getSystemMetrics(timeWindow);
    res.json(systemMetrics);
  } catch (error) {
    logger.error("Get system metrics error:", error);
    next(error);
  }
});
router$1.get("/monitoring/logs", async (req, res, next) => {
  try {
    const { db } = req.app.locals;
    const {
      type = "all",
      // 'git', 'events', 'performance', 'resources', 'all'
      executionId = null,
      operation = null,
      success = null,
      limit = 100,
      offset = 0,
      timeWindow = "24 hours"
    } = req.query;
    const results = {};
    const baseTimeFilter = `timestamp > datetime('now', '-${timeWindow}')`;
    const queries = [];
    if (type === "all" || type === "git") {
      let gitQuery = `
        SELECT 'git' as log_type, * FROM git_operations_log 
        WHERE ${baseTimeFilter}
      `;
      const gitParams = [];
      if (executionId) {
        gitQuery += " AND execution_id = ?";
        gitParams.push(executionId);
      }
      if (operation) {
        gitQuery += " AND operation = ?";
        gitParams.push(operation);
      }
      if (success !== null) {
        gitQuery += " AND success = ?";
        gitParams.push(success === "true" ? 1 : 0);
      }
      gitQuery += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
      gitParams.push(parseInt(limit), parseInt(offset));
      queries.push({ name: "git", query: gitQuery, params: gitParams });
    }
    if (type === "all" || type === "events") {
      let eventsQuery = `
        SELECT 'events' as log_type, * FROM execution_events_log 
        WHERE ${baseTimeFilter}
      `;
      const eventsParams = [];
      if (executionId) {
        eventsQuery += " AND execution_id = ?";
        eventsParams.push(executionId);
      }
      if (operation) {
        eventsQuery += " AND event = ?";
        eventsParams.push(operation);
      }
      if (success !== null) {
        eventsQuery += " AND success = ?";
        eventsParams.push(success === "true" ? 1 : 0);
      }
      eventsQuery += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
      eventsParams.push(parseInt(limit), parseInt(offset));
      queries.push({ name: "events", query: eventsQuery, params: eventsParams });
    }
    if (type === "all" || type === "performance") {
      let perfQuery = `
        SELECT 'performance' as log_type, * FROM performance_metrics 
        WHERE ${baseTimeFilter}
      `;
      const perfParams = [];
      if (executionId) {
        perfQuery += " AND execution_id = ?";
        perfParams.push(executionId);
      }
      if (operation) {
        perfQuery += " AND operation = ?";
        perfParams.push(operation);
      }
      if (success !== null) {
        perfQuery += " AND success = ?";
        perfParams.push(success === "true" ? 1 : 0);
      }
      perfQuery += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
      perfParams.push(parseInt(limit), parseInt(offset));
      queries.push({ name: "performance", query: perfQuery, params: perfParams });
    }
    if (type === "all" || type === "resources") {
      let resourceQuery = `
        SELECT 'resources' as log_type, * FROM resource_usage 
        WHERE ${baseTimeFilter}
      `;
      const resourceParams = [];
      if (executionId) {
        resourceQuery += " AND execution_id = ?";
        resourceParams.push(executionId);
      }
      resourceQuery += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
      resourceParams.push(parseInt(limit), parseInt(offset));
      queries.push({ name: "resources", query: resourceQuery, params: resourceParams });
    }
    for (const { name, query: query2, params } of queries) {
      const logs = await db.all(query2, params);
      results[name] = logs.map((log) => {
        if (log.metadata) {
          try {
            log.metadata = JSON.parse(log.metadata);
          } catch (e) {
          }
        }
        if (log.details) {
          try {
            log.details = JSON.parse(log.details);
          } catch (e) {
          }
        }
        return log;
      });
    }
    res.json({
      filters: {
        type,
        executionId,
        operation,
        success,
        timeWindow,
        limit: parseInt(limit),
        offset: parseInt(offset)
      },
      results,
      totalByType: Object.keys(results).reduce((acc, key) => {
        acc[key] = results[key].length;
        return acc;
      }, {})
    });
  } catch (error) {
    logger.error("Query logs error:", error);
    next(error);
  }
});
router$1.post("/monitoring/cleanup", async (req, res, next) => {
  try {
    const { auditLogger } = req.app.locals;
    const { retentionDays = 30 } = req.body;
    if (!auditLogger) {
      return res.status(503).json({
        error: {
          code: "AUDIT_LOGGER_UNAVAILABLE",
          message: "Audit logging is not enabled"
        }
      });
    }
    const result = await auditLogger.cleanupOldLogs(parseInt(retentionDays));
    res.json({
      message: "Audit log cleanup completed",
      result
    });
  } catch (error) {
    logger.error("Cleanup logs error:", error);
    next(error);
  }
});
router$1.post("/monitoring/reset-metrics", async (req, res, next) => {
  try {
    const { performanceMonitor } = req.app.locals;
    if (!performanceMonitor) {
      return res.status(503).json({
        error: {
          code: "PERFORMANCE_MONITOR_UNAVAILABLE",
          message: "Performance monitoring is not enabled"
        }
      });
    }
    performanceMonitor.resetMetrics();
    res.json({
      message: "Performance metrics reset successfully",
      resetAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (error) {
    logger.error("Reset metrics error:", error);
    next(error);
  }
});
createLogger("routes/executionFiles");
const router = express.Router();
router.get("/executions/:executionId/files", async (req, res, next) => {
  try {
    const executionId = validateExecutionId(req.params.executionId);
    const { path: dirPath = "", recursive = false } = req.query;
    const { db, workspaceManager } = req.app.locals;
    const execution = await db.get(
      "SELECT id, status FROM executions WHERE id = ?",
      [executionId]
    );
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    const workspacePath = path.join(
      workspaceManager.getWorkspacePath(),
      ".execution",
      `exec-${executionId}`
    );
    try {
      await promises.access(workspacePath);
    } catch (error) {
      return res.status(404).json({
        error: {
          code: "WORKSPACE_NOT_FOUND",
          message: "Execution workspace not found"
        }
      });
    }
    const fullPath = path.join(workspacePath, dirPath);
    if (!fullPath.startsWith(workspacePath)) {
      return res.status(400).json({
        error: {
          code: "INVALID_PATH",
          message: "Invalid path"
        }
      });
    }
    try {
      const stats = await promises.stat(fullPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({
          error: {
            code: "NOT_A_DIRECTORY",
            message: "Path is not a directory"
          }
        });
      }
      if (recursive === "true" || recursive === true) {
        const files = await listFilesRecursive(fullPath, workspacePath);
        res.json({ files });
      } else {
        const entries = await listDirectory(fullPath, workspacePath);
        res.json({ entries });
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({
          error: {
            code: "PATH_NOT_FOUND",
            message: "Path not found in workspace"
          }
        });
      }
      throw error;
    }
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json(createErrorResponse(error));
    }
    if (error.name === "NotFoundError") {
      return res.status(404).json(createErrorResponse(error));
    }
    next(error);
  }
});
router.get("/executions/:executionId/file", async (req, res, next) => {
  try {
    const executionId = validateExecutionId(req.params.executionId);
    const { path: filePath } = req.query;
    const { db, workspaceManager } = req.app.locals;
    if (!filePath) {
      return res.status(400).json({
        error: {
          code: "MISSING_PATH",
          message: "File path is required"
        }
      });
    }
    const execution = await db.get(
      "SELECT id, status FROM executions WHERE id = ?",
      [executionId]
    );
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    const workspacePath = path.join(
      workspaceManager.getWorkspacePath(),
      ".execution",
      `exec-${executionId}`
    );
    try {
      await promises.access(workspacePath);
    } catch (error) {
      return res.status(404).json({
        error: {
          code: "WORKSPACE_NOT_FOUND",
          message: "Execution workspace not found"
        }
      });
    }
    const fullPath = path.join(workspacePath, filePath);
    if (!fullPath.startsWith(workspacePath)) {
      return res.status(400).json({
        error: {
          code: "INVALID_PATH",
          message: "Invalid path"
        }
      });
    }
    try {
      const stats = await promises.stat(fullPath);
      if (!stats.isFile()) {
        return res.status(400).json({
          error: {
            code: "NOT_A_FILE",
            message: "Path is not a file"
          }
        });
      }
      const maxSize = 10 * 1024 * 1024;
      if (stats.size > maxSize) {
        return res.status(400).json({
          error: {
            code: "FILE_TOO_LARGE",
            message: `File too large (max ${maxSize} bytes)`
          }
        });
      }
      const content = await promises.readFile(fullPath, "utf8");
      res.json({
        path: path.relative(workspacePath, fullPath),
        size: stats.size,
        modified: stats.mtime,
        content
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({
          error: {
            code: "FILE_NOT_FOUND",
            message: "File not found in workspace"
          }
        });
      }
      if (error.code === "EISDIR") {
        return res.status(400).json({
          error: {
            code: "IS_DIRECTORY",
            message: "Path is a directory, not a file"
          }
        });
      }
      throw error;
    }
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json(createErrorResponse(error));
    }
    if (error.name === "NotFoundError") {
      return res.status(404).json(createErrorResponse(error));
    }
    next(error);
  }
});
async function listDirectory(dirPath, basePath) {
  const entries = [];
  const items = await promises.readdir(dirPath, { withFileTypes: true });
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const relativePath = path.relative(basePath, itemPath);
    const stats = await promises.stat(itemPath);
    entries.push({
      name: item.name,
      path: relativePath,
      type: item.isDirectory() ? "directory" : "file",
      size: stats.size,
      modified: stats.mtime
    });
  }
  entries.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === "directory" ? -1 : 1;
  });
  return entries;
}
async function listFilesRecursive(dirPath, basePath, files = []) {
  const items = await promises.readdir(dirPath, { withFileTypes: true });
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const relativePath = path.relative(basePath, itemPath);
    if (item.isDirectory()) {
      await listFilesRecursive(itemPath, basePath, files);
    } else {
      files.push(relativePath);
    }
  }
  return files;
}
path.dirname(fileURLToPath(import.meta.url));
class IntentServer {
  constructor(options = {}) {
    this.db = null;
    this.isRunning = false;
    this.port = options.port || 3e3;
    this.eventEmitter = new EventEmitter();
  }
  async start() {
    if (this.isRunning) {
      console.log("Intent server is already running");
      return;
    }
    try {
      const logger2 = createLogger("serverIntegration");
      const app$1 = express();
      app$1.use(express.json());
      app$1.use(cors({
        origin: ["http://localhost:5173", "http://localhost:3001"],
        // Allow Vite dev server and React app
        credentials: true
      }));
      app$1.use((req, res, next) => {
        console.log(`${(/* @__PURE__ */ new Date()).toISOString()} ${req.method} ${req.path}`);
        next();
      });
      app$1.get("/health", (req, res) => {
        res.json({
          status: "ok",
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          version: "1.0.0",
          electron: true
        });
      });
      const userDataPath = app.getPath("userData");
      const workspacePath = path.join(userDataPath, "intent-workspace");
      const workspaceManager = new WorkspaceManager(workspacePath);
      const workspace = await workspaceManager.initialize();
      app$1.locals.workspace = workspace;
      app$1.locals.workspaceManager = workspaceManager;
      const dbPath = path.join(workspace.dataDir, "agent-wrapper.db");
      this.db = new Database(dbPath);
      await this.db.initialize();
      app$1.locals.db = this.db;
      app$1.locals.eventEmitter = this.eventEmitter;
      app$1.locals.config = config;
      app$1.locals.processManager = new ProcessManager(this.db, config, this.eventEmitter);
      app$1.locals.streamHandler = new StreamHandler(this.db, this.eventEmitter);
      app$1.locals.auditLogger = new AuditLogger(this.db);
      app$1.locals.performanceMonitor = new PerformanceMonitor(app$1.locals.auditLogger);
      const refManager2 = new RefManager(workspace.workspace, app$1.locals.performanceMonitor);
      app$1.locals.integrationManager = new IntegrationManager(workspaceManager, refManager2, null, null, this.db);
      app$1.locals.resourceMonitor = new ResourceMonitor(workspaceManager, this.db, {
        maxConcurrentExecutions: process.env.MAX_CONCURRENT_EXECUTIONS || 100,
        maxDiskUsageMB: process.env.MAX_DISK_USAGE_MB || 1e4,
        maxExecutionTimeMinutes: process.env.MAX_EXECUTION_TIME_MINUTES || 60,
        checkInterval: process.env.RESOURCE_CHECK_INTERVAL || 3e5
        // 5 minutes
      });
      app$1.locals.resourceMonitor.start();
      app$1.use("/", router$b);
      app$1.use("/", router$a);
      app$1.use("/", router$9);
      app$1.use("/", router$8);
      app$1.use("/", router$7);
      app$1.use("/preview", router$6);
      app$1.use("/", router$5);
      app$1.use("/", router$4);
      app$1.use("/", router$3);
      app$1.use("/", router$2);
      app$1.use("/", router$1);
      app$1.use("/", router);
      app$1.use((err, req, res, next) => {
        console.error("Error:", err);
        if (err.name === "ValidationError") {
          return res.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: err.message,
              details: err.details || {}
            }
          });
        }
        if (err.name === "NotFoundError") {
          return res.status(404).json({
            error: {
              code: "NOT_FOUND",
              message: err.message
            }
          });
        }
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred",
            details: process.env.NODE_ENV === "development" ? err.message : void 0
          }
        });
      });
      app$1.use((req, res) => {
        res.status(404).json({
          error: {
            code: "ENDPOINT_NOT_FOUND",
            message: `Endpoint ${req.method} ${req.path} not found`
          }
        });
      });
      this.server = app$1.listen(this.port, () => {
        logger2.info(`Intent server running on port ${this.port}`);
        logger2.info(`Workspace: ${workspace.workspace}`);
        this.isRunning = true;
      });
      app$1.locals.claudeSDKManager = new ClaudeSDKManager(
        this.db,
        config,
        this.eventEmitter,
        workspaceManager
      );
      app$1.locals.previewManager = new PreviewManager(this.db, app$1.locals.processManager, this.eventEmitter);
      this.eventEmitter.on(Events.PROCESS_EXIT, async ({ executionId, code }) => {
        logger2.info(`Process exited for execution ${executionId} with code ${code}`);
        if (code === 0) {
          const refs = await this.db.all(
            "SELECT DISTINCT ref_id FROM execution_refs WHERE execution_id = ?",
            [executionId]
          );
          if (refs.length > 0) {
            logger2.info(`Starting integration for execution ${executionId} with ${refs.length} references`);
            setTimeout(async () => {
              try {
                const result = await app$1.locals.integrationManager.integrateExecutionChanges(executionId, {
                  commitMessage: `Changes from execution ${executionId}`,
                  merge: true,
                  cleanup: false
                  // Keep execution workspace for message resume
                });
                if (result.success) {
                  logger2.info(`Integration completed successfully for execution ${executionId}`);
                } else {
                  logger2.error(`Integration failed for execution ${executionId}:`, result.error);
                }
              } catch (error) {
                logger2.error(`Integration error for execution ${executionId}:`, error);
              }
            }, 1e3);
          }
        }
      });
    } catch (error) {
      console.error("Failed to start Intent server:", error);
      throw error;
    }
  }
  async stop() {
    if (!this.isRunning) {
      return;
    }
    const logger2 = createLogger("serverIntegration");
    logger2.info("Shutting down Intent server...");
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(() => {
          logger2.info("HTTP server closed");
          resolve();
        });
      });
    }
    if (this.db) {
      await this.db.close();
    }
    this.isRunning = false;
  }
  getPort() {
    return this.port;
  }
  isServerRunning() {
    return this.isRunning;
  }
}
createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "../..");
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration();
if (process.platform === "win32") app.setAppUserModelId(app.getName());
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
let win = null;
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");
let intentServer = null;
async function createWindow() {
  win = new BrowserWindow({
    title: "Main window",
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    width: 1440,
    height: 810,
    webPreferences: {
      preload
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,
      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    }
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(indexHtml);
  }
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });
  update(win);
}
app.whenReady().then(async () => {
  try {
    const { stdout } = await execAsync("git --version");
    console.log("Git is installed:", stdout.trim());
  } catch (error) {
    console.warn("Git is not installed. Some features may not work properly.");
  }
  try {
    intentServer = new IntentServer({ port: 3456 });
    await intentServer.start();
    console.log("Intent server started successfully on port 3456");
  } catch (error) {
    console.error("Failed to start Intent server:", error);
  }
  createWindow();
});
app.on("window-all-closed", async () => {
  win = null;
  if (intentServer) {
    try {
      await intentServer.stop();
      console.log("Intent server stopped");
    } catch (error) {
      console.error("Error stopping Intent server:", error);
    }
  }
  if (process.platform !== "darwin") app.quit();
});
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});
ipcMain.handle("open-win", (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`);
  } else {
    childWindow.loadFile(indexHtml, { hash: arg });
  }
});
ipcMain.handle("intent-server:status", () => {
  return {
    running: (intentServer == null ? void 0 : intentServer.isServerRunning()) || false,
    port: (intentServer == null ? void 0 : intentServer.getPort()) || null
  };
});
ipcMain.handle("intent:get-workspace-path", () => {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "intent-workspace", "refs");
});
ipcMain.handle("intent:list-files", async (event, dirPath) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, dirPath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  try {
    const items = await fs2.readdir(fullPath, { withFileTypes: true });
    return items.map((item) => ({
      name: item.name,
      path: path.join(dirPath, item.name),
      type: item.isDirectory() ? "directory" : "file"
    }));
  } catch (error) {
    console.error("Error listing files:", error);
    return [];
  }
});
ipcMain.handle("intent:read-file", async (event, filePath) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, filePath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  return fs2.readFile(fullPath, "utf-8");
});
ipcMain.handle("intent:write-file", async (event, filePath, content) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, filePath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  await fs2.writeFile(fullPath, content, "utf-8");
  return true;
});
ipcMain.handle("intent:create-file", async (event, filePath, content = "") => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, filePath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  await fs2.mkdir(path.dirname(fullPath), { recursive: true });
  await fs2.writeFile(fullPath, content, "utf-8");
  return true;
});
ipcMain.handle("intent:delete-file", async (event, filePath) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, filePath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  const stat = await fs2.stat(fullPath);
  if (stat.isDirectory()) {
    await fs2.rm(fullPath, { recursive: true, force: true });
  } else {
    await fs2.unlink(fullPath);
  }
  return true;
});
ipcMain.handle("intent:create-directory", async (event, dirPath) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, dirPath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  await fs2.mkdir(fullPath, { recursive: true });
  return true;
});
ipcMain.handle("intent:rename-file", async (event, oldPath, newPath) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullOldPath = path.join(workspacePath, oldPath);
  const fullNewPath = path.join(workspacePath, newPath);
  if (!fullOldPath.startsWith(workspacePath) || !fullNewPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  await fs2.rename(fullOldPath, fullNewPath);
  return true;
});
ipcMain.handle("intent:scan-refs", async () => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const refsPath = path.join(userDataPath, "intent-workspace", "refs");
  try {
    const items = await fs2.readdir(refsPath, { withFileTypes: true });
    const refs = items.filter((item) => item.isDirectory()).map((item) => ({
      id: item.name,
      name: item.name,
      path: path.join("refs", item.name)
    }));
    return refs;
  } catch (error) {
    console.error("Error scanning refs:", error);
    return [];
  }
});
ipcMain.handle("intent:check-metadata-exists", async (event, filePath) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, filePath);
  try {
    await fs2.access(fullPath);
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle("intent:copy-file", async (event, sourcePath, destPath) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullDestPath = path.join(workspacePath, destPath);
  if (!fullDestPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Destination path outside workspace");
  }
  const destDir = path.dirname(fullDestPath);
  await fs2.mkdir(destDir, { recursive: true });
  await fs2.copyFile(sourcePath, fullDestPath);
  return true;
});
ipcMain.handle("intent:write-file-buffer", async (event, filePath, buffer) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, filePath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  const dir = path.dirname(fullPath);
  await fs2.mkdir(dir, { recursive: true });
  await fs2.writeFile(fullPath, Buffer.from(buffer));
  return true;
});
ipcMain.handle("intent:get-file-url", async (event, filePath) => {
  const { promises: fs2 } = await import("node:fs");
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, filePath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  const buffer = await fs2.readFile(fullPath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  let mimeType = "application/octet-stream";
  const mimeTypes = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    webp: "image/webp",
    ico: "image/x-icon",
    // Videos
    mp4: "video/mp4",
    webm: "video/webm",
    ogg: "video/ogg",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
    mkv: "video/x-matroska",
    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    aac: "audio/aac",
    ogg: "audio/ogg",
    wma: "audio/x-ms-wma",
    m4a: "audio/mp4"
  };
  if (ext in mimeTypes) {
    mimeType = mimeTypes[ext];
  }
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
});
const execAsync = promisify$1(exec);
ipcMain.handle("intent:check-git", async () => {
  try {
    const { stdout } = await execAsync("git --version");
    return { installed: true, version: stdout.trim() };
  } catch (error) {
    return { installed: false };
  }
});
ipcMain.handle("intent:init-git", async (event, refPath) => {
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, refPath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  try {
    await execAsync("git init", { cwd: fullPath });
    const gitignoreContent = `# Intent Worker
.DS_Store
node_modules/
*.log
.env
.env.local
`;
    const { promises: fs2 } = await import("node:fs");
    await fs2.writeFile(path.join(fullPath, ".gitignore"), gitignoreContent);
    await execAsync("git add .", { cwd: fullPath });
    await execAsync('git commit -m "Initial commit"', { cwd: fullPath });
    return { success: true };
  } catch (error) {
    console.error("Git init error:", error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle("intent:create-next-app", async (event, refPath) => {
  const userDataPath = app.getPath("userData");
  const workspacePath = path.join(userDataPath, "intent-workspace");
  const fullPath = path.join(workspacePath, refPath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error("Access denied: Path outside workspace");
  }
  try {
    console.log(`[Main] Running create-next-app in ${fullPath}`);
    const { spawn: spawn2 } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      const createNextProcess = spawn2("npx", [
        "create-next-app@latest",
        ".",
        "--ts",
        "--tailwind",
        "--eslint",
        "--app",
        "--use-npm",
        "--import-alias",
        "@/*",
        "--src-dir",
        "--turbopack",
        "--example",
        "https://github.com/resonancelabsai/intent-01-app-starter"
      ], {
        cwd: fullPath,
        stdio: "pipe",
        shell: true
      });
      let output = "";
      createNextProcess.stdout.on("data", (data) => {
        output += data.toString();
        console.log(`[create-next-app] ${data.toString().trim()}`);
      });
      createNextProcess.stderr.on("data", (data) => {
        output += data.toString();
        console.log(`[create-next-app stderr] ${data.toString().trim()}`);
      });
      createNextProcess.on("close", (code) => {
        if (code === 0) {
          console.log(`[Main] create-next-app completed successfully`);
          resolve({ success: true });
        } else {
          reject(new Error(`create-next-app failed with code ${code}: ${output}`));
        }
      });
      createNextProcess.on("error", (error) => {
        reject(new Error(`Failed to run create-next-app: ${error.message}`));
      });
    });
  } catch (error) {
    console.error("create-next-app error:", error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle("intent:install-git", async () => {
  const platform = os.platform();
  try {
    if (platform === "darwin") {
      await execAsync("xcode-select --install");
      return { success: true, message: "Git installation initiated. Please follow the system prompts." };
    } else if (platform === "win32") {
      shell.openExternal("https://git-scm.com/download/win");
      return { success: true, message: "Please download and install Git from the opened webpage." };
    } else {
      return {
        success: false,
        message: "Please install Git using your package manager:\nUbuntu/Debian: sudo apt-get install git\nFedora: sudo dnf install git\nArch: sudo pacman -S git"
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
//# sourceMappingURL=index.js.map
