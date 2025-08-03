# Vercel Deployment Integration

## Overview

This document outlines the implementation plan for integrating Vercel deployment functionality directly into the Intent Electron application. Users will be able to deploy their current artifacts to Vercel with a seamless in-app experience, including OAuth authentication, environment variable management, and deployment monitoring.

## Goals

- **Full In-App Experience**: Complete OAuth flow and deployment management without external browser redirects
- **Seamless Git Integration**: Automatic git remote setup and push to deployment
- **Environment Variables**: Comprehensive environment variable management for deployments
- **Real-time Monitoring**: Live deployment status and build logs
- **Clean UI/UX**: Stylish, minimal interface that matches the existing application design

## Technical Architecture

### 1. Core Components

#### 1.1 Vercel Service (`electron/main/server/services/VercelService.ts`)
- OAuth 2.0 authentication flow management
- Vercel API integration for deployments, projects, and environments
- Token management and refresh handling
- Project creation and configuration

#### 1.2 Git Remote Manager (`electron/main/server/services/GitRemoteManager.ts`)
- Extends existing RefManager for remote repository operations
- GitHub/GitLab repository creation and management
- Remote push operations for deployment preparation

#### 1.3 Deployment UI Components
- **Deploy Button**: Added to CodeArtifactView for current tab
- **OAuth Dialog**: In-app browser for Vercel authentication
- **Deployment Configuration**: Environment variables, project settings
- **Deployment Monitor**: Real-time status and logs display

### 2. OAuth 2.0 Integration

#### 2.1 Vercel OAuth App Configuration
```typescript
interface VercelOAuthConfig {
  clientId: string // Vercel OAuth app client ID
  clientSecret: string // Stored securely in main process
  redirectUri: string // http://localhost:3456/auth/vercel/callback
  scopes: ['user', 'projects:write', 'deployments:write']
}
```

#### 2.2 Authentication Flow
1. **Initiate OAuth**: User clicks "Deploy to Vercel" button
2. **In-App Browser**: Open Vercel OAuth URL in embedded browser window
3. **Authorization**: User authorizes the application
4. **Token Exchange**: Capture authorization code and exchange for access token
5. **Token Storage**: Securely store tokens in application database
6. **User Profile**: Fetch and display Vercel user information

#### 2.3 Token Management
```typescript
interface VercelTokens {
  accessToken: string
  tokenType: 'Bearer'
  scope: string
  teamId?: string
  userId: string
  expiresAt: Date
}
```

### 3. Git Repository Integration

#### 3.1 Remote Repository Setup
- **Repository Creation**: Create GitHub/GitLab repository via API
- **Remote Configuration**: Add remote origin to local git repository
- **Branch Management**: Ensure main branch is properly configured
- **Initial Push**: Push current code to remote repository

#### 3.2 Git Operations Extension
```typescript
class GitRemoteManager extends RefManager {
  async setupRemoteRepository(refId: string, repoConfig: RemoteRepoConfig): Promise<RemoteRepo>
  async pushToRemote(refId: string, branch: string = 'main'): Promise<PushResult>
  async createGitHubRepo(name: string, isPrivate: boolean): Promise<GitHubRepo>
  async addRemoteOrigin(refId: string, repoUrl: string): Promise<void>
}
```

### 4. Vercel API Integration

#### 4.1 Core API Operations
```typescript
class VercelService {
  // Authentication
  async initiateOAuth(): Promise<string> // Returns OAuth URL
  async exchangeCodeForTokens(code: string): Promise<VercelTokens>
  async refreshTokens(userId: string): Promise<VercelTokens>
  
  // Projects
  async createProject(config: ProjectConfig): Promise<VercelProject>
  async getProjects(): Promise<VercelProject[]>
  async updateProject(projectId: string, config: Partial<ProjectConfig>): Promise<VercelProject>
  
  // Deployments
  async createDeployment(projectId: string, gitRepo: string): Promise<Deployment>
  async getDeployments(projectId: string): Promise<Deployment[]>
  async getDeploymentLogs(deploymentId: string): Promise<DeploymentLog[]>
  
  // Environment Variables
  async setEnvironmentVariables(projectId: string, vars: EnvironmentVariable[]): Promise<void>
  async getEnvironmentVariables(projectId: string): Promise<EnvironmentVariable[]>
}
```

#### 4.2 Data Structures
```typescript
interface VercelProject {
  id: string
  name: string
  framework: string | null
  gitRepository: {
    type: 'github' | 'gitlab' | 'bitbucket'
    repo: string
  }
  env: EnvironmentVariable[]
  domains: Domain[]
}

interface Deployment {
  id: string
  url: string
  state: 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED'
  createdAt: Date
  buildingAt?: Date
  readyAt?: Date
  gitSource: {
    type: string
    repo: string
    ref: string
    sha: string
  }
}

interface EnvironmentVariable {
  key: string
  value: string
  target: ('production' | 'preview' | 'development')[]
  type: 'plain' | 'secret'
}
```

### 5. Database Schema Extensions

#### 5.1 Vercel Integration Tables
```sql
-- Vercel user authentication
CREATE TABLE vercel_auth (
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
CREATE TABLE vercel_projects (
  id TEXT PRIMARY KEY,
  ref_id TEXT NOT NULL,
  vercel_project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  framework TEXT,
  git_repo_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE CASCADE
);

-- Deployment history
CREATE TABLE vercel_deployments (
  id TEXT PRIMARY KEY,
  vercel_project_id TEXT NOT NULL,
  vercel_deployment_id TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  commit_sha TEXT,
  deployment_url TEXT,
  state TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (vercel_project_id) REFERENCES vercel_projects(id) ON DELETE CASCADE
);
```

### 6. UI/UX Implementation

#### 6.1 Deploy Button Integration
**Location**: `CodeArtifactView.tsx` - Current tab only
**Position**: Next to "Open in Browser" button in the status bar

```tsx
{activeTab === 'current' && (
  <Button
    onClick={handleDeploy}
    disabled={!status.running}
    variant="outline"
    size="sm"
    className="gap-2"
  >
    <Upload className="h-3 w-3" />
    Deploy to Vercel
  </Button>
)}
```

#### 6.2 Deployment Dialog Component
```tsx
interface DeploymentDialogProps {
  refId: string
  refName: string
  onSuccess: (deployment: Deployment) => void
  onError: (error: string) => void
}

const DeploymentDialog: React.FC<DeploymentDialogProps> = ({
  refId,
  refName,
  onSuccess,
  onError
}) => {
  // OAuth flow, configuration, and deployment logic
}
```

#### 6.3 OAuth Integration Component
```tsx
const VercelOAuthDialog: React.FC<{
  onSuccess: (tokens: VercelTokens) => void
  onError: (error: string) => void
}> = ({ onSuccess, onError }) => {
  // Embedded browser for OAuth flow
  // Token exchange and validation
}
```

#### 6.4 Environment Variables Manager
```tsx
const EnvironmentVariablesManager: React.FC<{
  projectId: string
  onUpdate: (vars: EnvironmentVariable[]) => void
}> = ({ projectId, onUpdate }) => {
  // CRUD operations for environment variables
  // Support for plain text and secret variables
  // Target environment selection (production, preview, development)
}
```

#### 6.5 Deployment Monitor
```tsx
const DeploymentMonitor: React.FC<{
  deploymentId: string
  onComplete: (deployment: Deployment) => void
}> = ({ deploymentId, onComplete }) => {
  // Real-time deployment status
  // Build logs streaming
  // Completion notifications
}
```

### 7. API Routes

#### 7.1 Authentication Routes
```typescript
// POST /auth/vercel/initiate
// Returns OAuth URL for user authorization

// POST /auth/vercel/callback
// Handles OAuth callback with authorization code
// Exchanges code for tokens and stores them

// GET /auth/vercel/status
// Returns current authentication status

// POST /auth/vercel/disconnect
// Revokes tokens and cleans up authentication
```

#### 7.2 Deployment Routes
```typescript
// POST /deploy/vercel/:refId
// Body: { projectName, framework, environmentVars, isPrivate }
// Creates project, sets up git remote, and initiates deployment

// GET /deploy/vercel/:refId/status
// Returns deployment status and logs

// GET /deploy/vercel/:refId/history
// Returns deployment history for the reference

// POST /deploy/vercel/:refId/redeploy
// Triggers a new deployment with current code
```

#### 7.3 Project Management Routes
```typescript
// GET /vercel/projects
// Lists all Vercel projects for authenticated user

// POST /vercel/projects/:projectId/env
// Sets environment variables for project

// GET /vercel/projects/:projectId/deployments
// Gets deployment history for project
```

### 8. Implementation Phases

#### Phase 1: Authentication & Core Services (Week 1)
- [ ] Create VercelService with OAuth 2.0 implementation
- [ ] Set up database schema for Vercel integration
- [ ] Implement authentication routes and token management
- [ ] Create OAuth dialog component for in-app authentication

#### Phase 2: Git Integration (Week 1)
- [ ] Extend RefManager with GitRemoteManager for remote operations
- [ ] Implement GitHub repository creation via API
- [ ] Add git remote setup and push functionality
- [ ] Test git operations with sample repositories

#### Phase 3: Deployment Core (Week 2)
- [ ] Implement Vercel project creation and management
- [ ] Add deployment initiation and monitoring
- [ ] Create deployment API routes
- [ ] Test end-to-end deployment flow

#### Phase 4: UI Integration (Week 2)
- [ ] Add deploy button to CodeArtifactView
- [ ] Create deployment configuration dialog
- [ ] Implement environment variables manager
- [ ] Add deployment monitoring and status display

#### Phase 5: Polish & Testing (Week 3)
- [ ] Add error handling and retry mechanisms
- [ ] Implement deployment history and management
- [ ] Add success/error notifications and toasts
- [ ] Comprehensive testing and bug fixes
- [ ] Documentation and user guides

### 9. Error Handling & Edge Cases

#### 9.1 Authentication Errors
- **Token Expiration**: Automatic token refresh with fallback to re-authentication
- **Invalid Credentials**: Clear error messages and re-authentication prompts
- **Network Issues**: Retry mechanisms with exponential backoff

#### 9.2 Git Operations Errors
- **Repository Creation Failures**: Fallback to manual repository setup
- **Push Conflicts**: Conflict resolution guidance and manual intervention options
- **Remote Connection Issues**: Network diagnostics and retry mechanisms

#### 9.3 Deployment Errors
- **Build Failures**: Display build logs and error analysis
- **Configuration Issues**: Validation and helpful error messages
- **Resource Limits**: Clear explanation of Vercel limits and upgrade options

#### 9.4 UI/UX Error Handling
- **Loading States**: Comprehensive loading indicators for all operations
- **Progress Tracking**: Step-by-step progress display for deployment process
- **Cancellation**: Ability to cancel deployments and clean up resources

### 10. Security Considerations

#### 10.1 Token Security
- **Encryption**: Encrypt stored tokens using Electron's safe storage
- **Expiration**: Respect token expiration and implement refresh logic
- **Scope Limitation**: Request minimal required scopes from Vercel

#### 10.2 Git Repository Security
- **Private Repositories**: Default to private repositories for sensitive code
- **Access Control**: Verify user permissions before repository operations
- **Credential Management**: Secure handling of git credentials and SSH keys

#### 10.3 Environment Variables
- **Secret Management**: Secure handling of secret environment variables
- **Validation**: Input validation for environment variable names and values
- **Exposure Prevention**: Prevent accidental exposure of sensitive data

### 11. Testing Strategy

#### 11.1 Unit Tests
- **VercelService**: Test all API operations and error handling
- **GitRemoteManager**: Test git operations and remote management
- **Authentication**: Test OAuth flow and token management

#### 11.2 Integration Tests
- **End-to-End Deployment**: Test complete deployment workflow
- **OAuth Flow**: Test authentication with mock Vercel API
- **Error Scenarios**: Test all error conditions and recovery

#### 11.3 Manual Testing
- **User Experience**: Test complete user journey from authentication to deployment
- **Performance**: Test with various project sizes and configurations
- **Cross-Platform**: Test on different operating systems

### 12. Documentation & Training

#### 12.1 User Documentation
- **Setup Guide**: How to connect Vercel account and configure deployments
- **Deployment Guide**: Step-by-step deployment process
- **Troubleshooting**: Common issues and solutions

#### 12.2 Developer Documentation
- **API Reference**: Complete API documentation for all endpoints
- **Service Documentation**: VercelService and GitRemoteManager usage
- **Component Guide**: UI component usage and customization

## Success Metrics

- **Deployment Success Rate**: >95% successful deployments
- **Time to Deploy**: <5 minutes from button click to live deployment
- **User Satisfaction**: Positive feedback on in-app deployment experience
- **Error Rate**: <5% deployment failures due to application issues

## Future Enhancements

- **Multi-Provider Support**: Add support for Netlify, AWS, and other platforms
- **Advanced Configuration**: Support for build commands, output directories, and framework detection
- **Team Management**: Support for Vercel teams and collaboration features
- **Analytics Integration**: Deployment analytics and performance monitoring