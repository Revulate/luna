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
  
  const health = {
    // Core Services
    database: Boolean(serviceRegistry.getService('database')?.db),
    messageLogger: Boolean(serviceRegistry.getService('messageLogger')),
    apiClient: Boolean(serviceRegistry.getService('apiClient')),
    chatClient: Boolean(serviceRegistry.getService('chatClient')),
    eventManager: Boolean(serviceRegistry.getService('eventManager')),
    webPanel: Boolean(serviceRegistry.getService('webPanel')),
    
    // Command Systems
    commands: Boolean(serviceRegistry.getService('commands')),
    dvp: Boolean(serviceRegistry.getService('dvp')),
    claude: Boolean(serviceRegistry.getService('claude')?.handler),
    gpt: Boolean(serviceRegistry.getService('gpt')?.handler),
    afk: Boolean(serviceRegistry.getService('afk')?.handler),
    
    // Connection States
    chatConnection: Boolean(serviceRegistry.getService('chatClient')?.isConnected),
    apiConnection: Boolean(serviceRegistry.getService('apiClient')?.hasScope),
    
    // File Systems
    databaseDir: await checkDirectory('databases'),
    logsDir: await checkDirectory('logs'),
    
    // Additional Services
    sevenTv: Boolean(serviceRegistry.getService('sevenTv')),
    steam: Boolean(serviceRegistry.getService('steam')),
    autonomy: Boolean(serviceRegistry.getService('autonomy')),
    analytics: Boolean(serviceRegistry.getService('analytics')),
    messageQueue: Boolean(serviceRegistry.getService('messageQueue')),
    
    // Memory Usage
    memoryUsage: checkMemoryUsage()
  };

  // Log results
  logger.info('Health Check Results:');
  Object.entries(health).forEach(([service, status]) => {
    logger.info(formatHealthLine(service, status));
  });

  // Log overall status
  const overallStatus = Object.values(health).every(status => status);
  logger.info('-'.repeat(35));
  logger.info(formatHealthLine('overall status', overallStatus));

  logger.endOperation('System health check', overallStatus);
  return health;
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
