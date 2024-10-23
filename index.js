import dotenv from 'dotenv';
import fs from 'fs/promises';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';
import logger from './logger.js';
import { config } from './config.js';
import TwitchEventManager from './TwitchEventManager.js';
import messageLogger from './MessageLogger.js';
import { WebPanel } from './webPanel.js';
import dbManager from './database.js';

dotenv.config();

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

async function initializeServices() {
  try {
    // Initialize database first
    if (!dbManager.db) {
      await dbManager.initialize();
      logger.info('Database initialized successfully');
    }

    // Initialize MessageLogger
    await messageLogger.initialize();
    logger.info('MessageLogger initialized successfully');

    logger.info('Services initialized successfully');
  } catch (error) {
    logger.error('Error initializing services:', error);
    throw error;
  }
}

async function main() {
  try {
    logger.debug('Configuration loaded successfully');
    logger.info('Bot starting...');

    // Initialize services
    await initializeServices();

    // Set up auth and clients
    const authProvider = new RefreshingAuthProvider({
      clientId: config.twitch.clientId,
      clientSecret: config.twitch.clientSecret,
      onRefresh: async newTokenData => {
        await fs.writeFile('./tokens.json', JSON.stringify(newTokenData, null, 2));
      }
    });

    const tokenData = JSON.parse(await fs.readFile('./tokens.json', 'utf-8'));
    await authProvider.addUserForToken(tokenData, ['chat']);

    const apiClient = new ApiClient({ authProvider });
    const chatClient = new ChatClient({ authProvider });

    // Initialize TwitchEventManager with empty channels array
    const eventManager = new TwitchEventManager(apiClient, chatClient, config.channels || []);
    eventManager.setMessageLogger(messageLogger);
    await eventManager.initialize();

    // Initialize WebPanel with all required dependencies
    const webPanel = new WebPanel({
      chatClient,
      eventManager,
      messageLogger,
      getChannels: () => eventManager.getChannels(),
      startTime: Date.now(),
      commandCount: 0,
      isConnected: () => chatClient.isConnected,
      joinChannel: async (channel) => await eventManager.joinChannel(channel),
      leaveChannel: async (channel) => await eventManager.leaveChannel(channel)
    });

    await webPanel.initialize();

    // Connect chat client
    await chatClient.connect();

    logger.info('Bot started successfully');
  } catch (error) {
    logger.error('Fatal error:', error);
    throw error;
  }
}

// Helper functions
export const isMod = (user) => user.isMod || user.isBroadcaster;
export const isVip = (user) => user.isVip;

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
