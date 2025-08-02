-- Add reference fields to preview_processes table
ALTER TABLE preview_processes ADD COLUMN ref_type TEXT;
ALTER TABLE preview_processes ADD COLUMN ref_id TEXT;
ALTER TABLE preview_processes ADD COLUMN working_dir TEXT;

-- Create index for faster lookups by reference
CREATE INDEX idx_preview_processes_ref ON preview_processes(execution_id, ref_type, ref_id);