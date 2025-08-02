import sqlite3 from 'sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from './logger.js';

const logger = createLogger('database');

interface RunResult {
  id: number;
  changes: number;
}

export class Database {
  private dbPath: string;
  private db: sqlite3.Database | null = null;

  constructor(dbPath: string = './data/agent-wrapper.db') {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
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
          logger.info('Connected to SQLite database');
          resolve();
        }
      });
    });
  }

  async initialize(): Promise<void> {
    await this.connect();
    await this.createTables();
    await this.runMigrations();
  }

  async createTables(): Promise<void> {
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

    // Tables from migrations
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
      'CREATE INDEX IF NOT EXISTS idx_logs_execution ON logs(execution_id)',
      'CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(execution_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_file_operations_execution ON file_operations(execution_id)',
      'CREATE INDEX IF NOT EXISTS idx_file_operations_timestamp ON file_operations(execution_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_preview_execution ON preview_processes(execution_id)',
      'CREATE INDEX IF NOT EXISTS idx_preview_logs ON preview_logs(preview_id, timestamp)',
      // Indexes from migrations
      'CREATE INDEX IF NOT EXISTS idx_execution_refs_execution ON execution_refs(execution_id)',
      'CREATE INDEX IF NOT EXISTS idx_execution_refs_ref ON execution_refs(ref_id)',
      'CREATE INDEX IF NOT EXISTS idx_ref_changes_execution ON ref_changes(execution_id)',
      'CREATE INDEX IF NOT EXISTS idx_ref_changes_ref ON ref_changes(ref_id)',
      'CREATE INDEX IF NOT EXISTS idx_executions_heartbeat ON executions(status, last_heartbeat)',
      'CREATE INDEX IF NOT EXISTS idx_git_operations_execution ON git_operations_log(execution_id)',
      'CREATE INDEX IF NOT EXISTS idx_git_operations_ref ON git_operations_log(ref_id)',
      'CREATE INDEX IF NOT EXISTS idx_execution_events_execution ON execution_events_log(execution_id)',
      'CREATE INDEX IF NOT EXISTS idx_performance_metrics_execution ON performance_metrics(execution_id)'
    ];

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.serialize(() => {
        this.db!.run(executionsSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(logsSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(fileOperationsSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(previewProcessesSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(previewLogsSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(portAllocationsSchema, (err) => {
          if (err) reject(err);
        });

        // Create tables from migrations
        this.db!.run(executionRefsSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(refChangesSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(resourceUsageSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(gitOperationsLogSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(executionEventsLogSchema, (err) => {
          if (err) reject(err);
        });

        this.db!.run(performanceMetricsSchema, (err) => {
          if (err) reject(err);
        });

        indexSchemas.forEach(schema => {
          this.db!.run(schema, (err) => {
            if (err) reject(err);
          });
        });

        resolve();
      });
    });
  }

  async run(sql: string, params: any[] = []): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
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

  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row as T);
        }
      });
    });
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  async runMigrations(): Promise<void> {
    // All migrations have been consolidated into createTables()
    // This method is kept for compatibility but does nothing
    logger.info('All schema updates are handled in createTables()');
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          logger.info('Database connection closed');
          resolve();
        }
      });
    });
  }
}

export default Database;