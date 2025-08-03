import express from 'express';
import { createLogger } from '../logger.js';
import VercelService from '../services/VercelService.js';
import GitRemoteManager from '../services/GitRemoteManager.js';
import crypto from 'crypto';

const router = express.Router();
const logger = createLogger('deploy-routes');

// Initialize services lazily
let vercelService: VercelService | null = null;
let gitRemoteManager: GitRemoteManager | null = null;

function getVercelService(req: express.Request): VercelService {
  if (!vercelService) {
    const config = {
      clientId: process.env.VERCEL_CLIENT_ID || '',
      clientSecret: process.env.VERCEL_CLIENT_SECRET || '',
      redirectUri: `http://localhost:3456/auth/vercel/callback`,
      scopes: ['user', 'projects:write', 'deployments:write']
    };
    
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Vercel OAuth credentials not configured');
    }
    
    vercelService = new VercelService(config, req.app.locals.db);
  }
  return vercelService;
}

function getGitRemoteManager(req: express.Request): GitRemoteManager {
  if (!gitRemoteManager) {
    gitRemoteManager = new GitRemoteManager(
      req.app.locals.workspace.workspace,
      req.app.locals.db
    );
  }
  return gitRemoteManager;
}

// Deploy a ref to Vercel
router.post('/deploy/vercel/:refId', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { 
      projectName, 
      framework, 
      environmentVariables = [], 
      isPrivate = true,
      buildCommand,
      outputDirectory,
      installCommand,
      devCommand,
      gitHubToken
    } = req.body;

    if (!projectName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PROJECT_NAME',
          message: 'Project name is required'
        }
      });
    }

    const vercelSvc = getVercelService(req);
    const gitManager = getGitRemoteManager(req);

    // Check if user is authenticated with Vercel
    const isAuthenticated = await vercelSvc.isAuthenticated();
    if (!isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'VERCEL_NOT_AUTHENTICATED',
          message: 'Vercel authentication required'
        }
      });
    }

    // Check if ref exists
    if (!await gitManager.refExists(refId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'REF_NOT_FOUND',
          message: `Reference '${refId}' not found`
        }
      });
    }

    logger.info('Starting deployment process', { refId, projectName });

    // Step 1: Check if GitHub token is provided or get from environment
    const githubToken = gitHubToken || process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_REQUIRED',
          message: 'GitHub token is required for repository creation'
        }
      });
    }

    // Step 2: Create GitHub repository and push code
    const repoConfig = {
      name: projectName,
      description: `Deployed from ${refId}`,
      isPrivate
    };

    const { repo, pushResult } = await gitManager.setupRemoteRepository(
      refId, 
      repoConfig, 
      githubToken
    );

    if (!pushResult.success) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'GIT_PUSH_FAILED',
          message: pushResult.error || 'Failed to push code to repository'
        }
      });
    }

    // Step 3: Create Vercel project
    const projectConfig = {
      name: projectName,
      framework: framework || undefined,
      gitRepository: {
        type: 'github' as const,
        repo: repo.fullName
      },
      environmentVariables,
      buildCommand,
      outputDirectory,
      installCommand,
      devCommand
    };

    const vercelProject = await vercelSvc.createProject(projectConfig);

    // Step 4: Create initial deployment
    const deploymentConfig = {
      gitSource: {
        type: 'github' as const,
        repo: repo.fullName,
        ref: 'main'
      },
      projectSettings: {
        buildCommand,
        outputDirectory,
        installCommand,
        devCommand
      },
      meta: {
        refId,
        deployedAt: new Date().toISOString()
      }
    };

    const deployment = await vercelSvc.createDeployment(vercelProject.id, deploymentConfig);

    // Step 5: Store deployment info in database
    const deploymentId = crypto.randomUUID();
    await req.app.locals.db.run(`
      INSERT INTO vercel_projects 
      (id, ref_id, vercel_project_id, project_name, framework, git_repo_url, git_repo_type, build_command, output_directory, install_command, dev_command)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      deploymentId,
      refId,
      vercelProject.id,
      projectName,
      framework,
      repo.htmlUrl,
      'github',
      buildCommand,
      outputDirectory,
      installCommand,
      devCommand
    ]);

    await req.app.locals.db.run(`
      INSERT INTO vercel_deployments 
      (id, vercel_project_id, vercel_deployment_id, ref_id, commit_sha, deployment_url, state)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      crypto.randomUUID(),
      deploymentId,
      deployment.id,
      refId,
      pushResult.commitHash,
      deployment.url,
      deployment.state
    ]);

    logger.info('Deployment completed successfully', { 
      refId, 
      projectName, 
      repoUrl: repo.htmlUrl,
      deploymentUrl: deployment.url 
    });

    res.json({
      success: true,
      deployment: {
        id: deployment.id,
        url: deployment.url,
        state: deployment.state,
        createdAt: deployment.createdAt
      },
      project: {
        id: vercelProject.id,
        name: vercelProject.name,
        framework: vercelProject.framework
      },
      repository: {
        name: repo.name,
        fullName: repo.fullName,
        url: repo.htmlUrl,
        isPrivate: repo.isPrivate
      },
      git: {
        commitHash: pushResult.commitHash,
        branch: pushResult.branch
      }
    });

  } catch (error) {
    logger.error('Deployment failed', error);
    
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'RESOURCE_EXISTS',
          message: 'Repository or project with this name already exists'
        }
      });
    }
    
    if (error.message.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_FAILED',
          message: error.message
        }
      });
    }
    
    next(error);
  }
});

// Get deployment status and logs
router.get('/deploy/vercel/:refId/status', async (req, res, next) => {
  try {
    const { refId } = req.params;

    // Get latest deployment for this ref
    const deployment = await req.app.locals.db.get(`
      SELECT vd.*, vp.project_name, vp.vercel_project_id
      FROM vercel_deployments vd
      INNER JOIN vercel_projects vp ON vd.vercel_project_id = vp.id
      WHERE vd.ref_id = ?
      ORDER BY vd.created_at DESC
      LIMIT 1
    `, [refId]);

    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DEPLOYMENT_NOT_FOUND',
          message: 'No deployment found for this reference'
        }
      });
    }

    const vercelSvc = getVercelService(req);
    
    // Get latest deployment status from Vercel
    try {
      const latestDeployment = await vercelSvc.getDeployment(deployment.vercel_deployment_id);
      
      // Update local database with latest status
      if (latestDeployment.state !== deployment.state) {
        await req.app.locals.db.run(`
          UPDATE vercel_deployments 
          SET state = ?, completed_at = ?
          WHERE vercel_deployment_id = ?
        `, [
          latestDeployment.state,
          latestDeployment.readyAt?.toISOString() || null,
          deployment.vercel_deployment_id
        ]);
      }

      res.json({
        success: true,
        deployment: {
          id: latestDeployment.id,
          url: latestDeployment.url,
          state: latestDeployment.state,
          createdAt: latestDeployment.createdAt,
          buildingAt: latestDeployment.buildingAt,
          readyAt: latestDeployment.readyAt
        },
        project: {
          name: deployment.project_name,
          id: deployment.vercel_project_id
        }
      });
    } catch (vercelError) {
      // Fallback to database info if Vercel API fails
      logger.warn('Failed to get deployment status from Vercel API, using cached data', vercelError);
      
      res.json({
        success: true,
        deployment: {
          id: deployment.vercel_deployment_id,
          url: deployment.deployment_url,
          state: deployment.state,
          createdAt: deployment.created_at,
          cached: true
        },
        project: {
          name: deployment.project_name,
          id: deployment.vercel_project_id
        }
      });
    }

  } catch (error) {
    logger.error('Failed to get deployment status', error);
    next(error);
  }
});

// Get deployment history for a ref
router.get('/deploy/vercel/:refId/history', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { limit = 10 } = req.query;

    const deployments = await req.app.locals.db.all(`
      SELECT vd.*, vp.project_name, vp.vercel_project_id
      FROM vercel_deployments vd
      INNER JOIN vercel_projects vp ON vd.vercel_project_id = vp.id
      WHERE vd.ref_id = ?
      ORDER BY vd.created_at DESC
      LIMIT ?
    `, [refId, parseInt(limit as string)]);

    res.json({
      success: true,
      refId,
      deployments: deployments.map(d => ({
        id: d.vercel_deployment_id,
        url: d.deployment_url,
        state: d.state,
        commitSha: d.commit_sha,
        createdAt: d.created_at,
        completedAt: d.completed_at,
        project: {
          name: d.project_name,
          id: d.vercel_project_id
        }
      }))
    });

  } catch (error) {
    logger.error('Failed to get deployment history', error);
    next(error);
  }
});

// Redeploy (create new deployment from latest commit)
router.post('/deploy/vercel/:refId/redeploy', async (req, res, next) => {
  try {
    const { refId } = req.params;

    // Get latest project info
    const project = await req.app.locals.db.get(`
      SELECT * FROM vercel_projects WHERE ref_id = ? ORDER BY created_at DESC LIMIT 1
    `, [refId]);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: 'No Vercel project found for this reference'
        }
      });
    }

    const vercelSvc = getVercelService(req);
    const gitManager = getGitRemoteManager(req);

    // Get repository info
    const repo = await gitManager.getRepositoryForRef(refId);
    if (!repo) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'REPOSITORY_NOT_FOUND',
          message: 'No repository configured for this reference'
        }
      });
    }

    // Create new deployment
    const deploymentConfig = {
      gitSource: {
        type: 'github' as const,
        repo: repo.fullName,
        ref: 'main'
      },
      projectSettings: {
        buildCommand: project.build_command,
        outputDirectory: project.output_directory,
        installCommand: project.install_command,
        devCommand: project.dev_command
      },
      meta: {
        refId,
        redeployedAt: new Date().toISOString()
      }
    };

    const deployment = await vercelSvc.createDeployment(project.vercel_project_id, deploymentConfig);

    // Store new deployment in database
    await req.app.locals.db.run(`
      INSERT INTO vercel_deployments 
      (id, vercel_project_id, vercel_deployment_id, ref_id, deployment_url, state)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      crypto.randomUUID(),
      project.id,
      deployment.id,
      refId,
      deployment.url,
      deployment.state
    ]);

    logger.info('Redeployment started', { refId, deploymentId: deployment.id });

    res.json({
      success: true,
      deployment: {
        id: deployment.id,
        url: deployment.url,
        state: deployment.state,
        createdAt: deployment.createdAt
      }
    });

  } catch (error) {
    logger.error('Redeployment failed', error);
    next(error);
  }
});

export default router;