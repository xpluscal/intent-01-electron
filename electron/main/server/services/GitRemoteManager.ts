import RefManager from './RefManager.js';
import { createLogger } from '../logger.js';
import crypto from 'crypto';

const logger = createLogger('git-remote-manager');

export interface RemoteRepoConfig {
  name: string;
  description?: string;
  isPrivate: boolean;
  owner?: string; // For GitHub/GitLab - will use authenticated user if not provided
}

export interface RemoteRepo {
  id: string;
  name: string;
  fullName: string;
  url: string;
  cloneUrl: string;
  sshUrl: string;
  isPrivate: boolean;
  owner: string;
  defaultBranch: string;
}

export interface GitHubRepo extends RemoteRepo {
  htmlUrl: string;
  description: string;
}

export interface PushResult {
  success: boolean;
  branch: string;
  commitHash: string;
  message?: string;
  error?: string;
}

class GitRemoteManager extends RefManager {
  private db: any;

  constructor(workspacePath: string, db: any, performanceMonitor = null) {
    super(workspacePath, performanceMonitor);
    this.db = db;
  }

  /**
   * Create a GitHub repository using GitHub API
   */
  async createGitHubRepo(config: RemoteRepoConfig, accessToken: string): Promise<GitHubRepo> {
    try {
      const payload: any = {
        name: config.name,
        private: config.isPrivate,
        auto_init: false, // We'll push our existing code
        description: config.description || `Repository for ${config.name}`
      };

      // If owner is specified and it's not the authenticated user, create in organization
      const endpoint = config.owner 
        ? `https://api.github.com/orgs/${config.owner}/repos`
        : 'https://api.github.com/user/repos';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Intent-Electron-App'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`GitHub API error: ${errorData.message || response.statusText}`);
      }

      const repo = await response.json();

      const gitHubRepo: GitHubRepo = {
        id: repo.id.toString(),
        name: repo.name,
        fullName: repo.full_name,
        url: repo.git_url,
        cloneUrl: repo.clone_url,
        sshUrl: repo.ssh_url,
        htmlUrl: repo.html_url,
        isPrivate: repo.private,
        owner: repo.owner.login,
        defaultBranch: repo.default_branch || 'main',
        description: repo.description || ''
      };

      // Store repository info in database
      await this.storeRepositoryInfo(gitHubRepo, 'github', accessToken);

      logger.info('Created GitHub repository', { 
        repoName: gitHubRepo.name, 
        fullName: gitHubRepo.fullName,
        isPrivate: gitHubRepo.isPrivate 
      });

      return gitHubRepo;
    } catch (error) {
      logger.error('Failed to create GitHub repository', error);
      throw error;
    }
  }

  /**
   * Set up remote origin for a reference
   */
  async addRemoteOrigin(refId: string, repoUrl: string, remoteName = 'origin'): Promise<void> {
    const refPath = this.getRefPath(refId);
    
    await this.verifyRefExists(refId);

    try {
      // Check if remote already exists
      try {
        await this.execGit(refPath, `remote get-url ${this.escapeArg(remoteName)}`);
        // If we get here, remote exists - remove it first
        await this.execGit(refPath, `remote remove ${this.escapeArg(remoteName)}`);
        logger.info('Removed existing remote', { refId, remoteName });
      } catch (error) {
        // Remote doesn't exist, which is fine
      }

      // Add the new remote
      await this.execGit(refPath, `remote add ${this.escapeArg(remoteName)} ${this.escapeArg(repoUrl)}`);
      
      logger.info('Added remote origin', { refId, repoUrl, remoteName });
    } catch (error) {
      logger.error('Failed to add remote origin', error);
      throw error;
    }
  }

  /**
   * Push to remote repository
   */
  async pushToRemote(refId: string, branch = 'main', remoteName = 'origin', force = false): Promise<PushResult> {
    const refPath = this.getRefPath(refId);
    
    await this.verifyRefExists(refId);

    try {
      // Ensure we have the branch checked out
      try {
        await this.execGit(refPath, `checkout ${this.escapeArg(branch)}`);
      } catch (error) {
        // Branch might not exist, create it
        await this.execGit(refPath, `checkout -b ${this.escapeArg(branch)}`);
      }

      // Add all files and commit if there are changes
      await this.execGit(refPath, 'add .');
      
      try {
        const commitMessage = `Deploy: ${new Date().toISOString()}`;
        await this.execGit(refPath, `commit -m ${this.escapeArg(commitMessage)}`);
      } catch (error) {
        // No changes to commit, which is fine
        logger.info('No changes to commit', { refId, branch });
      }

      // Get current commit hash
      const commitHash = await this.execGit(refPath, 'rev-parse HEAD');

      // Push to remote
      const pushCommand = force 
        ? `push --force-with-lease ${this.escapeArg(remoteName)} ${this.escapeArg(branch)}`
        : `push -u ${this.escapeArg(remoteName)} ${this.escapeArg(branch)}`;
      
      const pushOutput = await this.execGit(refPath, pushCommand);

      const result: PushResult = {
        success: true,
        branch,
        commitHash,
        message: pushOutput
      };

      logger.info('Successfully pushed to remote', { refId, branch, remoteName, commitHash });
      return result;
    } catch (error) {
      logger.error('Failed to push to remote', error);
      
      return {
        success: false,
        branch,
        commitHash: '',
        error: error.message
      };
    }
  }

  /**
   * Setup complete remote repository workflow
   */
  async setupRemoteRepository(refId: string, config: RemoteRepoConfig, accessToken: string): Promise<{ repo: GitHubRepo; pushResult: PushResult }> {
    try {
      // Step 1: Create GitHub repository
      logger.info('Creating GitHub repository', { refId, repoName: config.name });
      const repo = await this.createGitHubRepo(config, accessToken);

      // Step 2: Add remote origin
      logger.info('Adding remote origin', { refId, repoUrl: repo.cloneUrl });
      await this.addRemoteOrigin(refId, repo.cloneUrl);

      // Step 3: Push code to remote
      logger.info('Pushing code to remote', { refId, branch: repo.defaultBranch });
      const pushResult = await this.pushToRemote(refId, repo.defaultBranch);

      if (!pushResult.success) {
        throw new Error(`Failed to push code: ${pushResult.error}`);
      }

      // Step 4: Link repository to ref in database
      await this.linkRepositoryToRef(refId, repo.id, true);

      logger.info('Successfully set up remote repository', { 
        refId, 
        repoName: repo.name, 
        repoUrl: repo.htmlUrl 
      });

      return { repo, pushResult };
    } catch (error) {
      logger.error('Failed to setup remote repository', error);
      throw error;
    }
  }

  /**
   * Get repository information for a ref
   */
  async getRepositoryForRef(refId: string): Promise<RemoteRepo | null> {
    try {
      const result = await this.db.get(`
        SELECT gr.*, rgr.is_primary
        FROM git_repositories gr
        INNER JOIN ref_git_repositories rgr ON gr.id = rgr.git_repository_id
        WHERE rgr.ref_id = ? AND rgr.is_primary = TRUE
        LIMIT 1
      `, [refId]);

      if (!result) {
        return null;
      }

      return {
        id: result.id,
        name: result.repo_name,
        fullName: `${result.repo_owner}/${result.repo_name}`,
        url: result.repo_url,
        cloneUrl: result.repo_url,
        sshUrl: result.repo_url.replace('https://github.com/', 'git@github.com:') + '.git',
        isPrivate: Boolean(result.is_private),
        owner: result.repo_owner,
        defaultBranch: 'main' // Default assumption
      };
    } catch (error) {
      logger.error('Failed to get repository for ref', error);
      return null;
    }
  }

  /**
   * Check if ref has a remote repository configured
   */
  async hasRemoteRepository(refId: string): Promise<boolean> {
    const repo = await this.getRepositoryForRef(refId);
    return repo !== null;
  }

  /**
   * Store repository information in database
   */
  private async storeRepositoryInfo(repo: RemoteRepo, type: string, accessToken?: string): Promise<void> {
    const repoId = crypto.randomUUID();
    
    // Encrypt access token if provided
    const encryptedToken = accessToken ? this.encryptToken(accessToken) : null;

    await this.db.run(`
      INSERT OR REPLACE INTO git_repositories 
      (id, repo_url, repo_type, repo_owner, repo_name, is_private, access_token_encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      repoId,
      repo.cloneUrl,
      type,
      repo.owner,
      repo.name,
      repo.isPrivate,
      encryptedToken
    ]);

    // Store the repo ID for linking
    (repo as any).dbId = repoId;
  }

  /**
   * Link repository to ref
   */
  private async linkRepositoryToRef(refId: string, repoDbId: string, isPrimary = false): Promise<void> {
    // If this is primary, unset any existing primary repos for this ref
    if (isPrimary) {
      await this.db.run(`
        UPDATE ref_git_repositories 
        SET is_primary = FALSE 
        WHERE ref_id = ?
      `, [refId]);
    }

    await this.db.run(`
      INSERT OR REPLACE INTO ref_git_repositories 
      (ref_id, git_repository_id, is_primary)
      VALUES (?, ?, ?)
    `, [refId, repoDbId, isPrimary]);
  }

  /**
   * Simple token encryption (in production, use proper encryption)
   */
  private encryptToken(token: string): string {
    // In a real implementation, you'd use proper encryption with a key
    // For now, just base64 encode as placeholder
    return Buffer.from(token).toString('base64');
  }

  /**
   * Simple token decryption
   */
  private decryptToken(encryptedToken: string): string {
    // In a real implementation, you'd use proper decryption
    return Buffer.from(encryptedToken, 'base64').toString();
  }

  /**
   * Get ref path helper
   */
  private getRefPath(refId: string): string {
    return this.refsDir ? 
      require('path').join(this.refsDir, refId) : 
      require('path').join(this.workspacePath, 'refs', refId);
  }
}

export default GitRemoteManager;