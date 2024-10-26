import dotenv from 'dotenv';
import fs from 'fs/promises';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';
import logger from './utils/logger.js';
import { config } from './config.js';
import TwitchEventManager from './utils/TwitchEventManager.js';
import { MessageLogger } from './utils/MessageLogger.js';
import { WebPanel } from './webPanel.js';
import { DatabaseManager } from './utils/database.js';
import { setupCommands } from './utils/commandSetup.js';
import { serviceRegistry } from './utils/serviceRegistry.js';
import { performHealthCheck } from './utils/healthCheck.js';
import Database from 'better-sqlite3';
import path from 'path';

// Add this constant at the top of the file
const MENTION_TRIGGERS = ['@tatsluna', 'tatsluna', '@TatsLuna', 'TatsLuna'].map(t => t.toLowerCase());

dotenv.config();

// Error handling with better logging
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { 
    reason, 
    stack: reason?.stack,
    promise: promise?.toString()
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { 
    error: error.message,
    stack: error.stack 
  });
});

// Verify Node.js version
const nodeVersion = process.versions.node;
if (parseInt(nodeVersion) >= 23) {
    logger.info(`Running on Node.js ${nodeVersion}`);
}

// Update logging level verification
logger.debug('Starting application in debug mode');
logger.debug('Logging configuration:', {
    logLevel: config.logging.level,
    twurpleLevel: config.logging.twurpleLevel
});

// Update initialization order with logging
const initializationOrder = [
  'database',
  'messageLogger', 
  'twitchEventManager',
  'commands',
  'webPanel'
];

async function initializeServices() {
  logger.startOperation('Service initialization');
  try {
    for (const serviceName of initializationOrder) {
      logger.debug(`Initializing service: ${serviceName}`);
      if (!serviceRegistry.isInitialized(serviceName)) {
        await serviceRegistry.initialize(serviceName);
        logger.debug(`Service initialized: ${serviceName}`);
      }
    }
    logger.info('Bot initialization complete');
    logger.endOperation('Service initialization', true);
  } catch (error) {
    logger.error('Error during initialization:', { error });
    logger.endOperation('Service initialization', false);
    throw error;
  }
}

async function setupAuth() {
  logger.startOperation('Auth setup');
  try {
    const authProvider = new RefreshingAuthProvider(
      {
        clientId: config.twitch.clientId,
        clientSecret: config.twitch.clientSecret,
        onRefresh: async (userId, newTokenData) => {
          logger.debug(`Token refreshed for user ${userId}`);
        }
      }
    );

    await authProvider.addUserForToken({
      accessToken: config.twitch.accessToken,
      refreshToken: config.twitch.refreshToken,
      expiresIn: parseInt(config.twitch.expiresIn || '0'),
      obtainmentTimestamp: parseInt(config.twitch.obtainmentTimestamp || '0')
    }, ['chat']);

    logger.info('Auth provider initialized with chat intents');
    logger.endOperation('Auth setup', true);
    return authProvider;
  } catch (error) {
    logger.error('Failed to setup auth provider:', { error });
    logger.endOperation('Auth setup', false);
    throw error;
  }
}

async function main() {
  logger.startOperation('Bot startup');
  try {
    // Perform health check
    await performHealthCheck();
    
    // Initialize auth and clients
    const authProvider = await setupAuth();
    const apiClient = new ApiClient({ authProvider });
    const chatClient = new ChatClient({ authProvider });
    
    // Register core services
    serviceRegistry.register('apiClient', apiClient);
    serviceRegistry.register('chatClient', chatClient);
    
    // Initialize all services
    await initializeServices();
    
    // Connect chat client after all services are ready
    await chatClient.connect();
    logger.info('Chat client connected successfully');
    
    logger.endOperation('Bot startup', true);
  } catch (error) {
    logger.error('Failed to start bot:', { error });
    logger.endOperation('Bot startup', false);
    process.exit(1);
  }
}

main();
