-- Add fields for Claude SDK integration
ALTER TABLE executions ADD COLUMN session_id TEXT;
ALTER TABLE executions ADD COLUMN message_count INTEGER DEFAULT 0;
ALTER TABLE executions ADD COLUMN total_cost REAL DEFAULT 0.0;

-- Create index on session_id for faster lookups
CREATE INDEX idx_executions_session_id ON executions(session_id);