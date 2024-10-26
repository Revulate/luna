import { serviceRegistry } from './serviceRegistry.js';
import logger from './logger.js';
import path from 'path';
import fs from 'fs/promises';

const SYMBOLS = {
  success: '✓',
  failure: '✗'
};

function formatHealthLine(name, status) {
  const symbol = status ? SYMBOLS.success : SYMBOLS.failure;
  const paddedName = name.toLowerCase().padEnd(25, ' ');
  return `${paddedName}${symbol}`;
}

export async function performHealthCheck() {
  logger.startOperation('System health check');
  
  // Increase delay and add retry mechanism
  const maxRetries = 3;
  const retryDelay = 2000;
  
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    
    const checks = {
      database: async () => {
        const db = serviceRegistry.getService('database');
        return db && db.initialized;
      },
      messageLogger: async () => {
        const msgLogger = serviceRegistry.getService('messageLogger');
        return msgLogger && msgLogger.initialized;
      },
      apiClient: async () => {
        const client = serviceRegistry.getService('apiClient');
        return client && typeof client.users?.getUserByName === 'function';
      },
      chatClient: async () => {
        const client = serviceRegistry.getService('chatClient');
        return client && client.isConnected;
      },
      eventManager: async () => {
        const manager = serviceRegistry.getService('twitchEventManager') || 
                       serviceRegistry.getService('eventManager');
        return manager && manager.initialized;
      },
      webPanel: async () => {
        const panel = serviceRegistry.getService('webPanel');
        return panel && panel.initialized;
      }
    };

    const results = {};
    let allServicesHealthy = true;
    
    for (const [service, check] of Object.entries(checks)) {
      try {
        results[service.toLowerCase()] = await check();
        if (!results[service.toLowerCase()]) {
          logger.warn(`Service check failed: ${service}`);
          allServicesHealthy = false;
        }
      } catch (error) {
        logger.error(`Error checking ${service}:`, error);
        results[service.toLowerCase()] = false;
        allServicesHealthy = false;
      }
    }

    if (allServicesHealthy) {
      logger.info('All services healthy');
      return results;
    }

    if (i === maxRetries - 1) {
      logger.warn('Health check failed after retries');
    }
  }

  return results;
}

async function checkDirectory(dirName) {
  try {
    const dirPath = path.join(process.cwd(), dirName);
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
}

function checkMemoryUsage() {
  const used = process.memoryUsage();
  const maxMemory = 1024 * 1024 * 1024; // 1GB threshold
  return used.heapUsed < maxMemory;
}

export async function getHealthStatus() {
  const health = await performHealthCheck();
  
  return {
    status: Object.values(health).every(status => status) ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    details: Object.entries(health).map(([service, status]) => ({
      service,
      status: status ? 'healthy' : 'unhealthy'
    })),
    memory: process.memoryUsage(),
    uptime: process.uptime()
  };
}

export async function checkServiceHealth(serviceName) {
  const health = await performHealthCheck();
  return {
    service: serviceName,
    status: health[serviceName] ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString()
  };
}
