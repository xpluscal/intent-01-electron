-- Add review fields to executions table

-- Add review status and reason
ALTER TABLE executions ADD COLUMN needs_review BOOLEAN DEFAULT 0;
ALTER TABLE executions ADD COLUMN review_reason TEXT;

-- Create index for review queries
CREATE INDEX IF NOT EXISTS idx_executions_review ON executions(needs_review, status);