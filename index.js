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

// Add this constant at the top of the file
const MENTION_TRIGGERS = ['@tatsluna', 'tatsluna', '@TatsLuna', 'TatsLuna'].map(t => t.toLowerCase());

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
      channels: config.twitch.channels,
      // Add these options for better chat handling
      requestMembershipEvents: true,
      ignoreUnhandledPromiseRejections: true
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

    // Initialize commands and get both commands and handlers - pass eventManager
    const { commands, claudeHandler } = await setupCommands(chatClient, eventManager);
    logger.info(`Commands setup complete. Registered commands: ${Array.from(commands.keys()).join(', ')}`);

    // Set claudeHandler in eventManager
    eventManager.claudeHandler = claudeHandler;

    // Update the message handler
    chatClient.onMessage(async (channel, userstate, message, msg) => {
      try {
        // Add null checks and default values
        if (!userstate || !message) {
          logger.debug('Received message with missing user or message data');
          return;
        }

        // Ensure user properties exist with proper Twurple format
        const userData = {
          username: userstate.username || msg.userInfo.userName,
          displayName: userstate['display-name'] || msg.userInfo.displayName || userstate.username || msg.userInfo.userName,
          id: userstate['user-id'] || msg.userInfo.userId,
          isMod: Boolean(userstate.mod || msg.userInfo.isMod),
          isBroadcaster: channel.replace('#', '') === (userstate.username || msg.userInfo.userName),
          badges: userstate.badges || msg.userInfo.badges || {}
        };

        // Check if it's the bot's message
        if (userData.username.toLowerCase() === config.twitch.botUsername.toLowerCase()) {
          return;
        }

        logger.debug(`Received message in ${channel}: ${message}`);
        logger.debug('Message metadata:', { userData, message, msg });

        // Check for mentions using MENTION_TRIGGERS
        const isMentioned = MENTION_TRIGGERS.some(trigger => 
          message.toLowerCase().includes(trigger)
        );

        if (isMentioned) {
          logger.info(`Bot mentioned in ${channel} by ${userData.displayName}: ${message}`);
          
          try {
            if (claudeHandler) {
              logger.debug('Claude handler found, processing mention');
              await claudeHandler.handleMention(channel, userData, message, msg);
            } else {
              logger.error('Claude handler not found');
            }
          } catch (mentionError) {
            logger.error('Error handling mention:', mentionError);
          }
        }

        // Handle commands
        if (message.startsWith(config.twitch.commandPrefix)) {
          const commandName = message.split(' ')[0].slice(1).toLowerCase();
          const command = commands.get(commandName);
          if (command) {
            const context = {
              channel,
              user: userData,
              message,
              args: message.split(' ').slice(1),
              msg,
              say: async (text) => {
                try {
                  await chatClient.say(channel, text);
                  await messageLogger.logBotMessage(channel, text);
                } catch (error) {
                  logger.error('Error sending message:', error);
                }
              }
            };
            await command(context);
          }
        }
      } catch (error) {
        logger.error('Error processing chat message:', error);
        logger.error('Error details:', {
          error: error.message,
          stack: error.stack,
          userstate: JSON.stringify(userstate),
          message
        });
      }
    });

    // Initialize WebPanel before joining channels
    const webPanel = new WebPanel({
      chatClient,
      eventManager,
      messageLogger,
      startTime: Date.now(),
      commandCount: 0,
      isConnected: () => chatClient.isConnected,
      joinChannel: async (channel) => {
        // Add check to prevent duplicate joins
        if (!chatClient.channels.includes(channel)) {
          await eventManager.joinChannel(channel);
        }
      },
      leaveChannel: async (channel) => await eventManager.leaveChannel(channel)
    });

    await webPanel.initialize();
    logger.info('WebPanel initialized successfully');

    // Initialize event manager with duplicate join prevention
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
