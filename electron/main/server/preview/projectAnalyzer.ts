import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';

const logger = createLogger('projectAnalyzer');

class ProjectAnalyzer {
  constructor() {
    this.frameworkDetection = {
      node: {
        react: ['react', 'react-dom', 'react-scripts'],
        vue: ['vue', '@vue/cli-service'],
        angular: ['@angular/core', '@angular/cli'],
        nextjs: ['next', 'react', 'react-dom'],
        express: ['express'],
        nestjs: ['@nestjs/core', '@nestjs/common'],
        gatsby: ['gatsby'],
        nuxt: ['nuxt'],
        svelte: ['svelte', '@sveltejs/kit'],
        vite: ['vite']
      }
    };

    this.defaultPorts = {
      react: 3000,
      vue: 8080,
      angular: 4200,
      nextjs: 3000,
      express: 3000,
      nestjs: 3000,
      gatsby: 8000,
      nuxt: 3000,
      svelte: 5173,
      vite: 5173,
      django: 8000,
      flask: 5000,
      fastapi: 8000
    };

    this.scriptPriority = ['dev', 'develop', 'start', 'serve', 'preview'];
  }

  async detectProjectType(workingDir) {
    try {
      const analysis = {
        projectType: 'unknown',
        framework: null,
        configFiles: {
          packageJson: false,
          packageLock: false,
          yarnLock: false,
          pnpmLock: false,
          requirements: false,
          pipfile: false,
          pyprojectToml: false,
          dockerfile: false,
          indexHtml: false
        },
        dependencies: {},
        devDependencies: {}
      };

      const files = await fs.readdir(workingDir);

      for (const file of files) {
        switch (file) {
          case 'package.json':
            analysis.configFiles.packageJson = true;
            const packageData = await this.readPackageJson(workingDir);
            if (packageData) {
              analysis.dependencies = packageData.dependencies || {};
              analysis.devDependencies = packageData.devDependencies || {};
              analysis.projectType = 'node';
              analysis.framework = this.detectNodeFramework(packageData);
            }
            break;
          case 'package-lock.json':
            analysis.configFiles.packageLock = true;
            break;
          case 'yarn.lock':
            analysis.configFiles.yarnLock = true;
            break;
          case 'pnpm-lock.yaml':
            analysis.configFiles.pnpmLock = true;
            break;
          case 'requirements.txt':
            analysis.configFiles.requirements = true;
            if (analysis.projectType === 'unknown') {
              analysis.projectType = 'python';
              analysis.framework = await this.detectPythonFramework(workingDir);
            }
            break;
          case 'Pipfile':
            analysis.configFiles.pipfile = true;
            if (analysis.projectType === 'unknown') {
              analysis.projectType = 'python';
            }
            break;
          case 'pyproject.toml':
            analysis.configFiles.pyprojectToml = true;
            if (analysis.projectType === 'unknown') {
              analysis.projectType = 'python';
            }
            break;
          case 'Dockerfile':
            analysis.configFiles.dockerfile = true;
            break;
          case 'index.html':
            analysis.configFiles.indexHtml = true;
            if (analysis.projectType === 'unknown') {
              analysis.projectType = 'static';
            }
            break;
        }
      }

      return analysis;
    } catch (error) {
      logger.error('Error detecting project type:', error);
      return {
        projectType: 'unknown',
        framework: null,
        configFiles: {},
        dependencies: {},
        devDependencies: {}
      };
    }
  }

  async readPackageJson(workingDir) {
    try {
      const packageJsonPath = path.join(workingDir, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('Error reading package.json:', error);
      return null;
    }
  }

  detectNodeFramework(packageData) {
    const allDeps = {
      ...packageData.dependencies,
      ...packageData.devDependencies
    };

    for (const [framework, indicators] of Object.entries(this.frameworkDetection.node)) {
      if (indicators.some(dep => dep in allDeps)) {
        return framework;
      }
    }

    return null;
  }

  async detectPythonFramework(workingDir) {
    try {
      const requirementsPath = path.join(workingDir, 'requirements.txt');
      const content = await fs.readFile(requirementsPath, 'utf8');
      const lines = content.toLowerCase().split('\n');

      if (lines.some(line => line.includes('django'))) {
        return 'django';
      }
      if (lines.some(line => line.includes('flask'))) {
        return 'flask';
      }
      if (lines.some(line => line.includes('fastapi'))) {
        return 'fastapi';
      }
    } catch (error) {
      logger.debug('Could not detect Python framework:', error.message);
    }

    return null;
  }

  async getAvailableScripts(workingDir, projectType) {
    const scripts = {};

    if (projectType === 'node') {
      const packageData = await this.readPackageJson(workingDir);
      if (packageData && packageData.scripts) {
        Object.assign(scripts, packageData.scripts);
      }
    } else if (projectType === 'python') {
      const framework = await this.detectPythonFramework(workingDir);
      if (framework === 'django') {
        scripts.runserver = 'python manage.py runserver';
      } else if (framework === 'flask') {
        scripts.run = 'flask run';
      } else if (framework === 'fastapi') {
        scripts.dev = 'uvicorn main:app --reload';
      }
    } else if (projectType === 'static') {
      scripts.serve = 'python -m http.server';
    }

    return scripts;
  }

  getSuggestedCommand(scripts) {
    for (const priority of this.scriptPriority) {
      if (scripts[priority]) {
        return priority;
      }
    }

    const scriptNames = Object.keys(scripts);
    if (scriptNames.length > 0) {
      return scriptNames[0];
    }

    return null;
  }

  async detectPort(workingDir, script, framework) {
    let detectedPort = null;

    if (framework && this.defaultPorts[framework]) {
      detectedPort = this.defaultPorts[framework];
    }

    try {
      const packageData = await this.readPackageJson(workingDir);
      if (packageData) {
        if (packageData.config && packageData.config.port) {
          detectedPort = packageData.config.port;
        }

        const scriptContent = packageData.scripts?.[script];
        if (scriptContent) {
          const portMatch = scriptContent.match(/--port[= ](\d+)|-p[= ](\d+)/);
          if (portMatch) {
            detectedPort = parseInt(portMatch[1] || portMatch[2]);
          }

          const envPortMatch = scriptContent.match(/PORT=(\d+)/);
          if (envPortMatch) {
            detectedPort = parseInt(envPortMatch[1]);
          }
        }
      }

      const envFiles = ['.env', '.env.local', '.env.development'];
      for (const envFile of envFiles) {
        try {
          const envPath = path.join(workingDir, envFile);
          const envContent = await fs.readFile(envPath, 'utf8');
          const portMatch = envContent.match(/^PORT=(\d+)/m);
          if (portMatch) {
            detectedPort = parseInt(portMatch[1]);
            break;
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      logger.debug('Error detecting port:', error.message);
    }

    return detectedPort || this.defaultPorts[framework] || 3000;
  }

  async checkDependenciesInstalled(workingDir, projectType) {
    if (projectType === 'node') {
      try {
        await fs.access(path.join(workingDir, 'node_modules'));
        return true;
      } catch {
        return false;
      }
    } else if (projectType === 'python') {
      try {
        await fs.access(path.join(workingDir, 'venv'));
        return true;
      } catch {
        try {
          await fs.access(path.join(workingDir, '.venv'));
          return true;
        } catch {
          return false;
        }
      }
    }

    return true;
  }

  detectPackageManager(configFiles) {
    if (configFiles.yarnLock) return 'yarn';
    if (configFiles.pnpmLock) return 'pnpm';
    if (configFiles.packageLock) return 'npm';
    if (configFiles.packageJson) return 'npm';
    if (configFiles.pipfile) return 'pipenv';
    if (configFiles.requirements) return 'pip';
    return null;
  }
}

export default ProjectAnalyzer;