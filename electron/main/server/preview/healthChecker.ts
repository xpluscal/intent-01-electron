import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { createLogger } from '../logger.js';

const logger = createLogger('healthChecker');

class HealthChecker {
  constructor() {
    this.defaultTimeout = 5000;
    this.maxAttempts = 30;
    this.initialDelay = 1000;
    this.maxDelay = 5000;
  }

  async checkHealth(url, timeout = this.defaultTimeout) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: 'GET',
        timeout: timeout,
        headers: {
          'User-Agent': 'AI-Agent-Wrapper-HealthChecker/1.0'
        }
      };

      const req = client.request(options, (res) => {
        const responseTime = Date.now() - startTime;
        
        res.on('data', () => {});
        res.on('end', () => {
          resolve({
            responsive: true,
            statusCode: res.statusCode,
            responseTime: responseTime,
            headers: res.headers
          });
        });
      });

      req.on('error', (error) => {
        logger.debug(`Health check failed for ${url}:`, error.message);
        resolve({
          responsive: false,
          error: error.message,
          responseTime: Date.now() - startTime
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          responsive: false,
          error: 'Request timeout',
          responseTime: timeout
        });
      });

      req.end();
    });
  }

  async waitForServer(url, options = {}) {
    const maxAttempts = options.maxAttempts || this.maxAttempts;
    const initialDelay = options.initialDelay || this.initialDelay;
    const maxDelay = options.maxDelay || this.maxDelay;
    const timeout = options.timeout || this.defaultTimeout;
    const acceptedStatusCodes = options.acceptedStatusCodes || [200, 201, 202, 204, 301, 302, 303, 304, 307, 308];

    logger.info(`Waiting for server at ${url} to become responsive...`);

    let attempt = 0;
    let delay = initialDelay;

    while (attempt < maxAttempts) {
      attempt++;
      
      const health = await this.checkHealth(url, timeout);
      
      if (health.responsive) {
        if (acceptedStatusCodes.includes(health.statusCode)) {
          logger.info(`Server at ${url} is responsive (attempt ${attempt}/${maxAttempts})`);
          return {
            success: true,
            attempts: attempt,
            health: health
          };
        } else {
          logger.debug(`Server responded with unexpected status ${health.statusCode}`);
        }
      }

      if (attempt < maxAttempts) {
        logger.debug(`Server not ready, waiting ${delay}ms before retry (attempt ${attempt}/${maxAttempts})`);
        await this.sleep(delay);
        delay = Math.min(delay * 1.5, maxDelay);
      }
    }

    logger.error(`Server at ${url} failed to become responsive after ${maxAttempts} attempts`);
    return {
      success: false,
      attempts: attempt,
      error: 'Maximum attempts reached'
    };
  }

  async checkMultipleUrls(urls, timeout = this.defaultTimeout) {
    const checks = urls.map(url => 
      this.checkHealth(url, timeout).then(result => ({
        url,
        ...result
      }))
    );

    return Promise.all(checks);
  }

  async findResponsiveUrl(urls, options = {}) {
    for (const url of urls) {
      const result = await this.waitForServer(url, { ...options, maxAttempts: 5 });
      if (result.success) {
        return {
          url,
          ...result
        };
      }
    }

    return {
      success: false,
      error: 'No responsive URL found'
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  buildHealthReport(health) {
    if (!health.responsive) {
      return {
        status: 'down',
        message: health.error || 'Server not responding',
        responseTime: health.responseTime
      };
    }

    if (health.statusCode >= 200 && health.statusCode < 300) {
      return {
        status: 'healthy',
        message: 'Server is responding normally',
        statusCode: health.statusCode,
        responseTime: health.responseTime
      };
    }

    if (health.statusCode >= 300 && health.statusCode < 400) {
      return {
        status: 'redirect',
        message: 'Server is redirecting',
        statusCode: health.statusCode,
        responseTime: health.responseTime,
        location: health.headers.location
      };
    }

    if (health.statusCode >= 400 && health.statusCode < 500) {
      return {
        status: 'client_error',
        message: 'Client error',
        statusCode: health.statusCode,
        responseTime: health.responseTime
      };
    }

    if (health.statusCode >= 500) {
      return {
        status: 'server_error',
        message: 'Server error',
        statusCode: health.statusCode,
        responseTime: health.responseTime
      };
    }

    return {
      status: 'unknown',
      message: 'Unknown status',
      statusCode: health.statusCode,
      responseTime: health.responseTime
    };
  }
}

export default HealthChecker;