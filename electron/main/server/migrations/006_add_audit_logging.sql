-- Add comprehensive audit logging tables

-- Git operations audit log
CREATE TABLE IF NOT EXISTS git_operations_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT,
  ref_id TEXT,
  operation TEXT NOT NULL, -- 'clone', 'checkout', 'commit', 'merge', 'push', 'fetch', etc.
  branch TEXT,
  command TEXT NOT NULL,
  working_dir TEXT,
  success BOOLEAN NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  output TEXT,
  error TEXT,
  metadata TEXT, -- JSON
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id)
);

-- Execution lifecycle events log
CREATE TABLE IF NOT EXISTS execution_events_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  event TEXT NOT NULL, -- 'started', 'workspace_setup', 'refs_configured', 'process_spawned', 'completed', 'failed', 'cleanup'
  phase TEXT, -- 'initialization', 'execution', 'integration', 'cleanup'
  details TEXT, -- JSON
  success BOOLEAN NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  error TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id)
);

-- Performance metrics log
CREATE TABLE IF NOT EXISTS performance_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT,
  operation TEXT NOT NULL, -- 'git_operation', 'workspace_setup', 'file_read', 'integration', etc.
  duration_ms INTEGER NOT NULL,
  success BOOLEAN NOT NULL DEFAULT 1,
  metadata TEXT, -- JSON
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id)
);

-- Update resource_usage table to include execution_id if not exists
ALTER TABLE resource_usage ADD COLUMN execution_id TEXT;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_git_operations_execution ON git_operations_log(execution_id);
CREATE INDEX IF NOT EXISTS idx_git_operations_timestamp ON git_operations_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_git_operations_ref ON git_operations_log(ref_id);
CREATE INDEX IF NOT EXISTS idx_git_operations_operation ON git_operations_log(operation);

CREATE INDEX IF NOT EXISTS idx_execution_events_execution ON execution_events_log(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_events_timestamp ON execution_events_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_execution_events_event ON execution_events_log(event);

CREATE INDEX IF NOT EXISTS idx_performance_execution ON performance_metrics(execution_id);
CREATE INDEX IF NOT EXISTS idx_performance_timestamp ON performance_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_performance_operation ON performance_metrics(operation);

CREATE INDEX IF NOT EXISTS idx_resource_usage_execution ON resource_usage(execution_id);