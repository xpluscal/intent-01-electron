-- Add conflict details and resource monitoring fields

-- Add conflict details to executions table
ALTER TABLE executions ADD COLUMN conflict_details TEXT;

-- Create resource monitoring table
CREATE TABLE IF NOT EXISTS resource_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  type TEXT NOT NULL CHECK (type IN ('disk_usage', 'concurrent_executions', 'system_resources')),
  current_value REAL NOT NULL,
  limit_value REAL NOT NULL,
  exceeded BOOLEAN NOT NULL DEFAULT 0,
  details TEXT
);

-- Create index for resource usage queries
CREATE INDEX IF NOT EXISTS idx_resource_usage_timestamp ON resource_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_resource_usage_type ON resource_usage(type);