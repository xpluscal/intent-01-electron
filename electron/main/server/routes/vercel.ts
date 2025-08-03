import express from 'express';
import { createLogger } from '../logger.js';
import VercelService from '../services/VercelService.js';

const router = express.Router();
const logger = createLogger('vercel-routes');

// Initialize VercelService lazily to get database from app.locals
let vercelService: VercelService | null = null;

function getVercelService(req: express.Request): VercelService {
  if (!vercelService) {
    const config = {
      clientId: process.env.VERCEL_CLIENT_ID || 'demo-client-id',
      clientSecret: process.env.VERCEL_CLIENT_SECRET || 'demo-client-secret',
      redirectUri: `http://localhost:3456/auth/vercel/callback`,
      scopes: ['user', 'projects:write', 'deployments:write']
    };
    
    // For now, allow demo mode - we'll show instructions to user
    vercelService = new VercelService(config, req.app.locals.db);
  }
  return vercelService;
}

// Initiate OAuth flow
router.post('/auth/vercel/initiate', async (req, res, next) => {
  try {
    // Check if real credentials are configured
    if (!process.env.VERCEL_CLIENT_ID || !process.env.VERCEL_CLIENT_SECRET) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'OAUTH_NOT_CONFIGURED',
          message: 'Vercel OAuth is not configured. Please set VERCEL_CLIENT_ID and VERCEL_CLIENT_SECRET environment variables.',
          instructions: 'Visit https://vercel.com/account/tokens to create an OAuth app and get your credentials.'
        }
      });
    }

    const service = getVercelService(req);
    const { url, state } = await service.initiateOAuth();
    
    logger.info('Initiated Vercel OAuth flow', { state });
    
    res.json({
      success: true,
      authUrl: url,
      state
    });
  } catch (error) {
    logger.error('Failed to initiate Vercel OAuth', error);
    next(error);
  }
});

// Handle OAuth callback
router.post('/auth/vercel/callback', async (req, res, next) => {
  try {
    const { code, state } = req.body;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CODE',
          message: 'Authorization code is required'
        }
      });
    }
    
    const service = getVercelService(req);
    const tokens = await service.exchangeCodeForTokens(code, state);
    
    logger.info('Successfully completed Vercel OAuth', { userId: tokens.userId });
    
    res.json({
      success: true,
      user: {
        id: tokens.userId,
        teamId: tokens.teamId
      }
    });
  } catch (error) {
    logger.error('Failed to complete Vercel OAuth', error);
    res.status(400).json({
      success: false,
      error: {
        code: 'OAUTH_FAILED',
        message: error.message || 'OAuth authentication failed'
      }
    });
  }
});

// Get authentication status
router.get('/auth/vercel/status', async (req, res, next) => {
  try {
    const service = getVercelService(req);
    const isAuthenticated = await service.isAuthenticated();
    
    if (isAuthenticated) {
      const user = await service.getCurrentUser();
      res.json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          avatar: user.avatar
        }
      });
    } else {
      res.json({
        authenticated: false
      });
    }
  } catch (error) {
    logger.error('Failed to check Vercel auth status', error);
    res.json({
      authenticated: false,
      error: error.message
    });
  }
});

// Disconnect/revoke authentication
router.post('/auth/vercel/disconnect', async (req, res, next) => {
  try {
    const service = getVercelService(req);
    await service.disconnect();
    
    logger.info('Disconnected Vercel authentication');
    
    res.json({
      success: true,
      message: 'Successfully disconnected from Vercel'
    });
  } catch (error) {
    logger.error('Failed to disconnect Vercel authentication', error);
    next(error);
  }
});

// Get user's Vercel projects
router.get('/vercel/projects', async (req, res, next) => {
  try {
    const service = getVercelService(req);
    const projects = await service.getProjects();
    
    res.json({
      success: true,
      projects
    });
  } catch (error) {
    logger.error('Failed to get Vercel projects', error);
    if (error.message.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Vercel authentication required'
        }
      });
    }
    next(error);
  }
});

// Create a new Vercel project
router.post('/vercel/projects', async (req, res, next) => {
  try {
    const { name, framework, gitRepository, environmentVariables, buildCommand, outputDirectory, installCommand, devCommand } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_NAME',
          message: 'Project name is required'
        }
      });
    }
    
    const service = getVercelService(req);
    const projectConfig = {
      name,
      framework,
      gitRepository,
      environmentVariables,
      buildCommand,
      outputDirectory,
      installCommand,
      devCommand
    };
    
    const project = await service.createProject(projectConfig);
    
    logger.info('Created Vercel project', { projectId: project.id, name: project.name });
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    logger.error('Failed to create Vercel project', error);
    if (error.message.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Vercel authentication required'
        }
      });
    }
    next(error);
  }
});

// Get deployments for a project
router.get('/vercel/projects/:projectId/deployments', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { limit = 20 } = req.query;
    
    const service = getVercelService(req);
    const deployments = await service.getDeployments(projectId, parseInt(limit as string));
    
    res.json({
      success: true,
      projectId,
      deployments
    });
  } catch (error) {
    logger.error('Failed to get deployments', error);
    if (error.message.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Vercel authentication required'
        }
      });
    }
    next(error);
  }
});

// Create a deployment
router.post('/vercel/deployments', async (req, res, next) => {
  try {
    const { projectId, gitSource, projectSettings, env, meta } = req.body;
    
    if (!projectId || !gitSource) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'projectId and gitSource are required'
        }
      });
    }
    
    const service = getVercelService(req);
    const deploymentConfig = {
      gitSource,
      projectSettings,
      env,
      meta
    };
    
    const deployment = await service.createDeployment(projectId, deploymentConfig);
    
    logger.info('Created deployment', { deploymentId: deployment.id, projectId });
    
    res.json({
      success: true,
      deployment
    });
  } catch (error) {
    logger.error('Failed to create deployment', error);
    if (error.message.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Vercel authentication required'
        }
      });
    }
    next(error);
  }
});

// Get deployment details
router.get('/vercel/deployments/:deploymentId', async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    
    const service = getVercelService(req);
    const deployment = await service.getDeployment(deploymentId);
    
    res.json({
      success: true,
      deployment
    });
  } catch (error) {
    logger.error('Failed to get deployment details', error);
    if (error.message.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Vercel authentication required'
        }
      });
    }
    next(error);
  }
});

// Set environment variables for a project
router.post('/vercel/projects/:projectId/env', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { variables } = req.body;
    
    if (!variables || !Array.isArray(variables)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_VARIABLES',
          message: 'Variables must be an array'
        }
      });
    }
    
    const service = getVercelService(req);
    await service.setEnvironmentVariables(projectId, variables);
    
    logger.info('Set environment variables', { projectId, count: variables.length });
    
    res.json({
      success: true,
      message: `Set ${variables.length} environment variables`
    });
  } catch (error) {
    logger.error('Failed to set environment variables', error);
    if (error.message.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Vercel authentication required'
        }
      });
    }
    next(error);
  }
});

// Get environment variables for a project
router.get('/vercel/projects/:projectId/env', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    
    const service = getVercelService(req);
    const variables = await service.getEnvironmentVariables(projectId);
    
    res.json({
      success: true,
      projectId,
      variables
    });
  } catch (error) {
    logger.error('Failed to get environment variables', error);
    if (error.message.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Vercel authentication required'
        }
      });
    }
    next(error);
  }
});

export default router;