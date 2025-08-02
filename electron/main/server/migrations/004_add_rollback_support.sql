-- Add rollback support to ref_changes table

-- First, create a new table with the updated schema
CREATE TABLE ref_changes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  ref_id TEXT, -- Made nullable for rollback records
  change_type TEXT NOT NULL CHECK (change_type IN ('commit', 'merge', 'create', 'rollback')),
  branch_name TEXT,
  commit_hash TEXT,
  commit_message TEXT,
  merge_status TEXT CHECK (merge_status IN ('success', 'conflict', 'failed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id)
);

-- Copy existing data
INSERT INTO ref_changes_new (id, execution_id, ref_id, change_type, branch_name, commit_hash, commit_message, merge_status, created_at)
SELECT id, execution_id, ref_id, change_type, branch_name, commit_hash, commit_message, merge_status, created_at
FROM ref_changes;

-- Drop the old table
DROP TABLE ref_changes;

-- Rename the new table
ALTER TABLE ref_changes_new RENAME TO ref_changes;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_ref_changes_execution ON ref_changes(execution_id);
CREATE INDEX IF NOT EXISTS idx_ref_changes_ref ON ref_changes(ref_id);