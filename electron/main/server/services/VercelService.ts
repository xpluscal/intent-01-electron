import { createLogger } from '../logger.js';
import crypto from 'crypto';

const logger = createLogger('vercel-service');

export interface VercelOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface VercelTokens {
  accessToken: string;
  tokenType: 'Bearer';
  scope: string;
  teamId?: string;
  userId: string;
  expiresAt?: Date;
}

export interface VercelUser {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar?: string;
}

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  gitRepository?: {
    type: 'github' | 'gitlab' | 'bitbucket';
    repo: string;
  };
  env: EnvironmentVariable[];
  domains: VercelDomain[];
  createdAt: Date;
  updatedAt: Date;
}

export interface VercelDeployment {
  id: string;
  url: string;
  state: 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'QUEUED';
  createdAt: Date;
  buildingAt?: Date;
  readyAt?: Date;
  gitSource?: {
    type: string;
    repo: string;
    ref: string;
    sha: string;
  };
  meta?: Record<string, any>;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  target: ('production' | 'preview' | 'development')[];
  type: 'plain' | 'secret';
  id?: string;
}

export interface VercelDomain {
  name: string;
  verified: boolean;
  primary: boolean;
}

export interface ProjectConfig {
  name: string;
  framework?: string;
  gitRepository?: {
    type: 'github' | 'gitlab' | 'bitbucket';
    repo: string;
  };
  buildCommand?: string;
  outputDirectory?: string;
  installCommand?: string;
  devCommand?: string;
  environmentVariables?: EnvironmentVariable[];
}

export interface DeploymentConfig {
  gitSource: {
    type: 'github' | 'gitlab' | 'bitbucket';
    repo: string;
    ref: string;
  };
  projectSettings?: {
    buildCommand?: string;
    outputDirectory?: string;
    installCommand?: string;
    devCommand?: string;
  };
  env?: Record<string, string>;
  meta?: Record<string, any>;
}

class VercelService {
  private config: VercelOAuthConfig;
  private db: any;
  private baseUrl = 'https://api.vercel.com';

  constructor(config: VercelOAuthConfig, db: any) {
    this.config = config;
    this.db = db;
  }

  /**
   * Generate OAuth authorization URL
   */
  async initiateOAuth(): Promise<{ url: string; state: string }> {
    const state = crypto.randomBytes(32).toString('hex');
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state
    });

    const url = `https://vercel.com/oauth/authorize?${params.toString()}`;
    
    logger.info('Generated OAuth URL', { state });
    return { url, state };
  }

  /**
   * Exchange authorization code for access tokens
   */
  async exchangeCodeForTokens(code: string, state?: string): Promise<VercelTokens> {
    try {
      const response = await fetch('https://api.vercel.com/v2/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OAuth token exchange failed: ${error}`);
      }

      const data = await response.json();
      
      const tokens: VercelTokens = {
        accessToken: data.access_token,
        tokenType: data.token_type || 'Bearer',
        scope: data.scope || this.config.scopes.join(' '),
        teamId: data.team_id,
        userId: data.user_id,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined
      };

      // Get user info to complete the tokens
      const user = await this.getCurrentUser(tokens.accessToken);
      tokens.userId = user.id;

      // Store tokens in database
      await this.storeTokens(tokens);

      logger.info('Successfully exchanged OAuth code for tokens', { userId: tokens.userId });
      return tokens;
    } catch (error) {
      logger.error('Failed to exchange OAuth code for tokens', error);
      throw error;
    }
  }

  /**
   * Get current user information
   */
  async getCurrentUser(accessToken?: string): Promise<VercelUser> {
    const token = accessToken || await this.getStoredAccessToken();
    if (!token) {
      throw new Error('No access token available');
    }

    const response = await this.makeRequest('/v2/user', 'GET', token);
    
    return {
      id: response.user.id,
      email: response.user.email,
      name: response.user.name,
      username: response.user.username,
      avatar: response.user.avatar
    };
  }

  /**
   * Get user's Vercel projects
   */
  async getProjects(): Promise<VercelProject[]> {
    const token = await this.getStoredAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await this.makeRequest('/v9/projects', 'GET', token);
    
    return response.projects.map((project: any) => ({
      id: project.id,
      name: project.name,
      framework: project.framework,
      gitRepository: project.link ? {
        type: project.link.type,
        repo: project.link.repo
      } : undefined,
      env: [], // Will be populated separately if needed
      domains: project.targets?.production?.alias || [],
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt)
    }));
  }

  /**
   * Create a new Vercel project
   */
  async createProject(config: ProjectConfig): Promise<VercelProject> {
    const token = await this.getStoredAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const payload: any = {
      name: config.name,
      framework: config.framework || null,
    };

    if (config.gitRepository) {
      payload.gitRepository = config.gitRepository;
    }

    if (config.buildCommand || config.outputDirectory || config.installCommand || config.devCommand) {
      payload.buildCommand = config.buildCommand;
      payload.outputDirectory = config.outputDirectory;
      payload.installCommand = config.installCommand;
      payload.devCommand = config.devCommand;
    }

    const response = await this.makeRequest('/v10/projects', 'POST', token, payload);
    
    const project: VercelProject = {
      id: response.id,
      name: response.name,
      framework: response.framework,
      gitRepository: response.link ? {
        type: response.link.type,
        repo: response.link.repo
      } : undefined,
      env: [],
      domains: response.targets?.production?.alias || [],
      createdAt: new Date(response.createdAt),
      updatedAt: new Date(response.updatedAt)
    };

    // Set environment variables if provided
    if (config.environmentVariables && config.environmentVariables.length > 0) {
      await this.setEnvironmentVariables(project.id, config.environmentVariables);
      project.env = config.environmentVariables;
    }

    logger.info('Created Vercel project', { projectId: project.id, name: project.name });
    return project;
  }

  /**
   * Create a deployment
   */
  async createDeployment(projectId: string, config: DeploymentConfig): Promise<VercelDeployment> {
    const token = await this.getStoredAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const payload: any = {
      name: projectId, // Using project ID as deployment name
      gitSource: config.gitSource,
      target: 'production'
    };

    if (config.projectSettings) {
      Object.assign(payload, config.projectSettings);
    }

    if (config.env) {
      payload.env = config.env;
    }

    if (config.meta) {
      payload.meta = config.meta;
    }

    const response = await this.makeRequest('/v13/deployments', 'POST', token, payload);
    
    const deployment: VercelDeployment = {
      id: response.id,
      url: response.url,
      state: response.readyState || 'QUEUED',
      createdAt: new Date(response.createdAt),
      buildingAt: response.buildingAt ? new Date(response.buildingAt) : undefined,
      readyAt: response.readyAt ? new Date(response.readyAt) : undefined,
      gitSource: response.gitSource,
      meta: response.meta
    };

    logger.info('Created deployment', { deploymentId: deployment.id, projectId });
    return deployment;
  }

  /**
   * Get deployments for a project
   */
  async getDeployments(projectId: string, limit = 20): Promise<VercelDeployment[]> {
    const token = await this.getStoredAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const params = new URLSearchParams({
      projectId,
      limit: limit.toString()
    });

    const response = await this.makeRequest(`/v6/deployments?${params}`, 'GET', token);
    
    return response.deployments.map((deployment: any) => ({
      id: deployment.id,
      url: deployment.url,
      state: deployment.readyState || deployment.state,
      createdAt: new Date(deployment.createdAt),
      buildingAt: deployment.buildingAt ? new Date(deployment.buildingAt) : undefined,
      readyAt: deployment.readyAt ? new Date(deployment.readyAt) : undefined,
      gitSource: deployment.gitSource,
      meta: deployment.meta
    }));
  }

  /**
   * Get deployment details
   */
  async getDeployment(deploymentId: string): Promise<VercelDeployment> {
    const token = await this.getStoredAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await this.makeRequest(`/v13/deployments/${deploymentId}`, 'GET', token);
    
    return {
      id: response.id,
      url: response.url,
      state: response.readyState || response.state,
      createdAt: new Date(response.createdAt),
      buildingAt: response.buildingAt ? new Date(response.buildingAt) : undefined,
      readyAt: response.readyAt ? new Date(response.readyAt) : undefined,
      gitSource: response.gitSource,
      meta: response.meta
    };
  }

  /**
   * Set environment variables for a project
   */
  async setEnvironmentVariables(projectId: string, variables: EnvironmentVariable[]): Promise<void> {
    const token = await this.getStoredAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    // Vercel requires individual API calls for each environment variable
    for (const variable of variables) {
      const payload = {
        key: variable.key,
        value: variable.value,
        type: variable.type,
        target: variable.target
      };

      await this.makeRequest(`/v9/projects/${projectId}/env`, 'POST', token, payload);
    }

    logger.info('Set environment variables', { projectId, count: variables.length });
  }

  /**
   * Get environment variables for a project
   */
  async getEnvironmentVariables(projectId: string): Promise<EnvironmentVariable[]> {
    const token = await this.getStoredAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await this.makeRequest(`/v9/projects/${projectId}/env`, 'GET', token);
    
    return response.envs.map((env: any) => ({
      id: env.id,
      key: env.key,
      value: env.type === 'secret' ? '[HIDDEN]' : env.value,
      type: env.type,
      target: env.target
    }));
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const token = await this.getStoredAccessToken();
      if (!token) return false;

      // Verify token by making a simple API call
      await this.getCurrentUser(token);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Disconnect/revoke authentication
   */
  async disconnect(): Promise<void> {
    try {
      await this.db.run('DELETE FROM vercel_auth');
      logger.info('Disconnected Vercel authentication');
    } catch (error) {
      logger.error('Failed to disconnect Vercel authentication', error);
      throw error;
    }
  }

  /**
   * Store tokens in database
   */
  private async storeTokens(tokens: VercelTokens): Promise<void> {
    const query = `
      INSERT OR REPLACE INTO vercel_auth 
      (user_id, access_token, token_type, scope, team_id, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    
    await this.db.run(query, [
      tokens.userId,
      tokens.accessToken,
      tokens.tokenType,
      tokens.scope,
      tokens.teamId,
      tokens.expiresAt?.toISOString()
    ]);
  }

  /**
   * Get stored access token
   */
  private async getStoredAccessToken(): Promise<string | null> {
    try {
      const result = await this.db.get(
        'SELECT access_token, expires_at FROM vercel_auth ORDER BY updated_at DESC LIMIT 1'
      );
      
      if (!result) return null;

      // Check if token is expired
      if (result.expires_at) {
        const expiresAt = new Date(result.expires_at);
        if (expiresAt <= new Date()) {
          logger.warn('Stored Vercel token is expired');
          return null;
        }
      }

      return result.access_token;
    } catch (error) {
      logger.error('Failed to get stored access token', error);
      return null;
    }
  }

  /**
   * Make authenticated request to Vercel API
   */
  private async makeRequest(endpoint: string, method: string, token: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Vercel API request failed: ${response.status} ${response.statusText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // If error response is not JSON, use the raw text
        errorMessage = errorText || errorMessage;
      }
      
      throw new Error(errorMessage);
    }

    return await response.json();
  }
}

export default VercelService;