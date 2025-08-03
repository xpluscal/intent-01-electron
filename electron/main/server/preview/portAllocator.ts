import net from 'node:net';
import { createLogger } from '../logger.js';

const logger = createLogger('portAllocator');

class PortAllocator {
  constructor(db) {
    this.db = db;
    this.basePort = 3000;
    this.maxPort = 9000;
  }

  async allocatePort(preferredPort = null) {
    try {
      if (preferredPort) {
        logger.info(`Checking if preferred port ${preferredPort} is available`);
        const isAvailable = await this.isPortAvailable(preferredPort);
        logger.info(`Port ${preferredPort} available: ${isAvailable}`);
        
        if (isAvailable) {
          await this.markPortAllocated(preferredPort);
          return preferredPort;
        }
      }

      logger.info(`Searching for available port starting from ${this.basePort}`);
      for (let port = this.basePort; port <= this.maxPort; port++) {
        const isAvailable = await this.isPortAvailable(port);
        if (isAvailable) {
          logger.info(`Found available port: ${port}`);
          await this.markPortAllocated(port);
          return port;
        }
      }

      throw new Error('No available ports in the configured range');
    } catch (error) {
      logger.error('Error allocating port:', error);
      throw error;
    }
  }

  async releasePort(port) {
    try {
      await this.db.run('DELETE FROM port_allocations WHERE port = ?', [port]);
      logger.info(`Released port ${port}`);
    } catch (error) {
      logger.error(`Error releasing port ${port}:`, error);
      throw error;
    }
  }

  async releasePortsByPreviewId(previewId) {
    try {
      await this.db.run('DELETE FROM port_allocations WHERE preview_id = ?', [previewId]);
      logger.info(`Released all ports for preview ${previewId}`);
    } catch (error) {
      logger.error(`Error releasing ports for preview ${previewId}:`, error);
      throw error;
    }
  }

  async isPortAvailable(port) {
    const dbAllocated = await this.isPortAllocatedInDb(port);
    if (dbAllocated) {
      return false;
    }

    // Test both localhost and all interfaces to be thorough
    const interfacesToTest = ['127.0.0.1', '0.0.0.0'];
    
    for (const host of interfacesToTest) {
      const available = await this.checkPortOnInterface(port, host);
      if (!available) {
        logger.info(`Port ${port} is not available on ${host}`);
        return false;
      }
    }
    
    return true;
  }

  async checkPortOnInterface(port, host) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          // Other errors also mean the port is not available
          resolve(false);
        }
      });

      server.once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      });

      try {
        server.listen(port, host);
      } catch (error) {
        resolve(false);
      }
    });
  }

  async isPortAllocatedInDb(port) {
    const result = await this.db.get(
      'SELECT port FROM port_allocations WHERE port = ?',
      [port]
    );
    return !!result;
  }

  async markPortAllocated(port, previewId) {
    await this.db.run(
      'INSERT INTO port_allocations (port, preview_id) VALUES (?, ?)',
      [port, previewId || 'pending']
    );
  }

  async updatePortAllocation(port, previewId) {
    await this.db.run(
      'UPDATE port_allocations SET preview_id = ? WHERE port = ?',
      [previewId, port]
    );
  }

  async allocatePortForPreview(port, previewId) {
    // Upsert: Insert or update port allocation
    await this.db.run(
      'INSERT OR REPLACE INTO port_allocations (port, preview_id) VALUES (?, ?)',
      [port, previewId]
    );
  }

  async getAllocatedPorts() {
    const rows = await this.db.all(
      'SELECT port, preview_id, allocated_at FROM port_allocations ORDER BY port'
    );
    return rows;
  }

  async cleanupStaleAllocations() {
    try {
      const staleAllocations = await this.db.all(`
        SELECT pa.port, pa.preview_id
        FROM port_allocations pa
        LEFT JOIN preview_processes pp ON pa.preview_id = pp.id
        WHERE pp.id IS NULL OR pp.status IN ('stopped', 'failed')
      `);

      for (const allocation of staleAllocations) {
        await this.releasePort(allocation.port);
      }

      logger.info(`Cleaned up ${staleAllocations.length} stale port allocations`);
      return staleAllocations.length;
    } catch (error) {
      logger.error('Error cleaning up stale allocations:', error);
      throw error;
    }
  }
}

export default PortAllocator;