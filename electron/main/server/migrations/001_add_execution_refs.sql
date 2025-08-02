-- Add reference tracking tables for executions

-- Table to track which references are used by each execution
CREATE TABLE IF NOT EXISTS execution_refs (
  execution_id TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'mutate', 'create')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (execution_id, ref_id, permission),
  FOREIGN KEY (execution_id) REFERENCES executions(id)
);

-- Table to track changes made to references during execution
CREATE TABLE IF NOT EXISTS ref_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('commit', 'merge', 'create')),
  branch_name TEXT,
  commit_hash TEXT,
  commit_message TEXT,
  merge_status TEXT CHECK (merge_status IN ('success', 'conflict', 'failed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id)
);

-- Add workspace_path column to executions table if it doesn't exist
ALTER TABLE executions ADD COLUMN workspace_path TEXT;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_execution_refs_execution ON execution_refs(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_refs_ref ON execution_refs(ref_id);
CREATE INDEX IF NOT EXISTS idx_ref_changes_execution ON ref_changes(execution_id);
CREATE INDEX IF NOT EXISTS idx_ref_changes_ref ON ref_changes(ref_id);