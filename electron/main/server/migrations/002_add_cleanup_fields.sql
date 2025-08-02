-- Add cleanup tracking fields to executions table

-- Add cleanup status and timestamp
ALTER TABLE executions ADD COLUMN cleanup_status TEXT;
ALTER TABLE executions ADD COLUMN cleanup_at TIMESTAMP;

-- Add rollback status
ALTER TABLE executions ADD COLUMN rolled_back BOOLEAN DEFAULT 0;
ALTER TABLE executions ADD COLUMN rollback_reason TEXT;

-- Create index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_executions_cleanup ON executions(status, created_at, cleanup_at);