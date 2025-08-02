-- Add phase tracking and heartbeat for execution recovery
ALTER TABLE executions ADD COLUMN phase TEXT DEFAULT 'starting';
ALTER TABLE executions ADD COLUMN auto_preview BOOLEAN DEFAULT 1;
ALTER TABLE executions ADD COLUMN last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create index for finding active executions
CREATE INDEX idx_executions_heartbeat ON executions(status, last_heartbeat);