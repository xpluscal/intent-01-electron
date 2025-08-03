-- Migration 012: Add Vercel Integration Tables
-- This migration adds tables for Vercel OAuth authentication, projects, and deployments

-- Vercel user authentication
CREATE TABLE IF NOT EXISTS vercel_auth (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  team_id TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Vercel projects linked to refs
CREATE TABLE IF NOT EXISTS vercel_projects (
  id TEXT PRIMARY KEY,
  ref_id TEXT NOT NULL,
  vercel_project_id TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  framework TEXT,
  git_repo_url TEXT,
  git_repo_type TEXT, -- 'github', 'gitlab', 'bitbucket'
  build_command TEXT,
  output_directory TEXT,
  install_command TEXT,
  dev_command TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE CASCADE
);

-- Deployment history
CREATE TABLE IF NOT EXISTS vercel_deployments (
  id TEXT PRIMARY KEY,
  vercel_project_id TEXT NOT NULL,
  vercel_deployment_id TEXT NOT NULL UNIQUE,
  ref_id TEXT NOT NULL,
  commit_sha TEXT,
  deployment_url TEXT,
  state TEXT, -- 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'QUEUED'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  building_at DATETIME,
  completed_at DATETIME,
  error_message TEXT,
  meta_data TEXT, -- JSON string for additional metadata
  FOREIGN KEY (vercel_project_id) REFERENCES vercel_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE CASCADE
);

-- Environment variables for Vercel projects
CREATE TABLE IF NOT EXISTS vercel_environment_variables (
  id TEXT PRIMARY KEY,
  vercel_project_id TEXT NOT NULL,
  vercel_env_id TEXT, -- ID from Vercel API
  key_name TEXT NOT NULL,
  value_encrypted TEXT, -- Encrypted value for security
  variable_type TEXT DEFAULT 'plain', -- 'plain' or 'secret'
  target_environments TEXT, -- JSON array: ['production', 'preview', 'development']
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vercel_project_id) REFERENCES vercel_projects(id) ON DELETE CASCADE,
  UNIQUE(vercel_project_id, key_name)
);

-- Git repositories for deployment (can be linked to multiple refs)
CREATE TABLE IF NOT EXISTS git_repositories (
  id TEXT PRIMARY KEY,
  repo_url TEXT NOT NULL UNIQUE,
  repo_type TEXT NOT NULL, -- 'github', 'gitlab', 'bitbucket'
  repo_owner TEXT,
  repo_name TEXT,
  is_private BOOLEAN DEFAULT FALSE,
  access_token_encrypted TEXT, -- Encrypted access token for the repository
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Link refs to git repositories (many-to-many)
CREATE TABLE IF NOT EXISTS ref_git_repositories (
  ref_id TEXT NOT NULL,
  git_repository_id TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE, -- Primary repository for deployments
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ref_id, git_repository_id),
  FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE CASCADE,
  FOREIGN KEY (git_repository_id) REFERENCES git_repositories(id) ON DELETE CASCADE
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_vercel_auth_user_id ON vercel_auth(user_id);
CREATE INDEX IF NOT EXISTS idx_vercel_projects_ref_id ON vercel_projects(ref_id);
CREATE INDEX IF NOT EXISTS idx_vercel_projects_vercel_id ON vercel_projects(vercel_project_id);
CREATE INDEX IF NOT EXISTS idx_vercel_deployments_project_id ON vercel_deployments(vercel_project_id);
CREATE INDEX IF NOT EXISTS idx_vercel_deployments_ref_id ON vercel_deployments(ref_id);
CREATE INDEX IF NOT EXISTS idx_vercel_deployments_state ON vercel_deployments(state);
CREATE INDEX IF NOT EXISTS idx_vercel_env_vars_project_id ON vercel_environment_variables(vercel_project_id);
CREATE INDEX IF NOT EXISTS idx_git_repos_url ON git_repositories(repo_url);
CREATE INDEX IF NOT EXISTS idx_ref_git_repos_ref_id ON ref_git_repositories(ref_id);
CREATE INDEX IF NOT EXISTS idx_ref_git_repos_primary ON ref_git_repositories(ref_id, is_primary);