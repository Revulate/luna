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
// Add this import
import { setupCommands } from './commands/commandSetup.js';

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
    logger.info('Bot starting...');

    // Initialize services
    await initializeServices();

    // Set up auth and clients
    const authProvider = new RefreshingAuthProvider({
      clientId: config.twitch.clientId,
      clientSecret: config.twitch.clientSecret,
      onRefresh: async newTokenData => {
        await fs.writeFile('./tokens.json', JSON.stringify(newTokenData, null, 2));
        logger.info('Token refreshed and saved to file');
      }
    });

    const tokenData = JSON.parse(await fs.readFile('./tokens.json', 'utf-8'));
    await authProvider.addUserForToken(tokenData, ['chat']);
    logger.info('Auth provider initialized with token data');

    const apiClient = new ApiClient({ authProvider });
    const chatClient = new ChatClient({ 
      authProvider,
      channels: config.twitch.channels
    });

    // Attach API client to chat client for easy access
    chatClient.apiClient = apiClient;

    // Connect chat client FIRST
    logger.info('Connecting to Twitch chat...');
    await chatClient.connect();
    logger.info('Connected to Twitch chat');

    // Initialize TwitchEventManager with both clients
    const eventManager = new TwitchEventManager(apiClient, chatClient, config.twitch.channels);
    eventManager.setMessageLogger(messageLogger);
    
    // Initialize WebPanel before joining channels
    const webPanel = new WebPanel({
      chatClient,
      eventManager,
      messageLogger,
      startTime: Date.now(),
      commandCount: 0,
      isConnected: () => chatClient.isConnected,
      joinChannel: async (channel) => await eventManager.joinChannel(channel),
      leaveChannel: async (channel) => await eventManager.leaveChannel(channel)
    });

    await webPanel.initialize();
    logger.info('WebPanel initialized successfully');

    // Initialize command system
    const { commands } = await setupCommands(chatClient);
    logger.info(`Commands setup complete. Registered commands: ${Array.from(commands.keys()).join(', ')}`);

    // Set up command handling on the event manager
    eventManager.on('command', async (context) => {
      const command = commands.get(context.commandName);
      if (command) {
        try {
          await command(context);
        } catch (error) {
          logger.error(`Error executing command ${context.commandName}:`, error);
          await chatClient.say(context.channel, 
            `@${context.user.userName}, an error occurred while executing the command.`);
        }
      }
    });

    // Finally, initialize the event manager to join channels
    await eventManager.initialize();
    logger.info('EventManager initialized and channels joined');

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
