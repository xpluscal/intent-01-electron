-- Add fields for preview auto-restart functionality
ALTER TABLE preview_processes ADD COLUMN restart_attempts INTEGER DEFAULT 0;
ALTER TABLE preview_processes ADD COLUMN last_health_check TIMESTAMP DEFAULT NULL;

-- Index for health monitoring queries
CREATE INDEX idx_preview_status_health ON preview_processes(status, last_health_check);