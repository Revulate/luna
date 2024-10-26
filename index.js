import dotenv from 'dotenv';
import fs from 'fs/promises';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';
import logger from './utils/logger.js';
import { config } from './config.js';
import { twitchEventManager } from './utils/TwitchEventManager.js';
import messageLogger from './utils/MessageLogger.js';
import { webPanel } from './webPanel.js';
import dbManager from './utils/database.js';
import { setupCommands } from './utils/commandSetup.js';
import { serviceRegistry } from './utils/serviceRegistry.js';
import { performHealthCheck } from './utils/healthCheck.js';

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
  'commands',  // Make sure commands are initialized after twitchEventManager
  'webPanel'
];

// Add this function before initializeBot
async function initializeDatabase() {
  logger.startOperation('Initializing database');
  try {
    await dbManager.initialize();
    logger.info('Database initialized successfully');
    logger.endOperation('Initializing database', true);
  } catch (error) {
    logger.error('Error initializing database:', error);
    logger.endOperation('Initializing database', false);
    throw error;
  }
}

async function initializeBot() {
  logger.startOperation('Bot startup');
  
  try {
    // Initialize services
    logger.startOperation('Service initialization');
    
    // Setup auth and clients
    const authProvider = await setupAuth();
    const apiClient = new ApiClient({ authProvider });
    const chatClient = new ChatClient({ 
      authProvider,
      // Use config.twitch.channels instead of config.channels
      channels: config.twitch.channels,
      logger: logger
    });

    // Register core services
    serviceRegistry.register('apiClient', apiClient);
    serviceRegistry.register('chatClient', chatClient);

    // Initialize database and message logger
    await initializeDatabase();
    await messageLogger.initialize();
    serviceRegistry.register('messageLogger', messageLogger);

    // Initialize TwitchEventManager
    await twitchEventManager.initialize({
      chatClient,
      apiClient,
      messageLogger
    });

    // Setup commands after TwitchEventManager
    const commands = await setupCommands(chatClient);
    serviceRegistry.register('commands', commands);

    // Initialize web panel
    await webPanel.initialize();
    serviceRegistry.register('webPanel', webPanel);

    // Connect chat client
    await chatClient.connect();
    logger.info('Chat client connected successfully');

    // Join channels from config.twitch.channels
    const channelsToJoin = config.twitch.channels;
    logger.debug('Channels to join:', channelsToJoin);
    
    for (const channel of channelsToJoin) {
      try {
        await chatClient.join(channel);
        logger.info(`Joined channel: ${channel}`);
      } catch (error) {
        logger.error(`Failed to join channel ${channel}:`, error);
      }
    }

    logger.info('Bot initialization complete');
    logger.endOperation('Service initialization', true);

  } catch (error) {
    logger.error('Error during bot initialization:', error);
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
  await initializeBot();
  await performHealthCheck();
}

main();
