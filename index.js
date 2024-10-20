import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import backoff from 'backoff';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  logger.info('.env file found, loading environment variables');
  dotenv.config();
} else {
  logger.warn('.env file not found, environment variables may not be set correctly');
}

import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';
import logger from './logger.js';
import { initializeDatabase } from './database.js';
import { config } from './config.js';
import { setupCommands } from './commands/index.js';
import { setupAfk } from './commands/afk.js';
import { setupEventSub } from './eventSub.js';
import { setTimeout as setTimeoutPromise } from 'timers/promises';
import { isMod, isVip } from './utils.js';
import { commandQueue } from './commandQueue.js';
import { gracefulShutdown } from './utils.js';
import TwitchAPI from './twitch_api.js';

const broadcasterUsername = process.env.BROADCASTER_USERNAME;

if (broadcasterUsername) {
  logger.info(`Broadcaster Username: ${broadcasterUsername}`);
} else {
  logger.warn('BROADCASTER_USERNAME is not set in the environment variables');
}

// Log only non-sensitive environment variables
logger.debug('Relevant environment variables:', {
  TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID ? '(set)' : '(not set)',
  TWITCH_CLIENT_SECRET: '(hidden)',
  ACCESS_TOKEN: '(hidden)',
  REFRESH_TOKEN: '(hidden)',
  BOT_NICK: process.env.BOT_NICK,
  TWITCH_CHANNELS: process.env.TWITCH_CHANNELS,
  BROADCASTER_USERNAME: process.env.BROADCASTER_USERNAME,
  BROADCASTER_USER_ID: process.env.BROADCASTER_USER_ID,
  DB_PATH: process.env.DB_PATH,
  LOG_LEVEL: process.env.LOG_LEVEL,
});

let isReconnecting = false;

let reconnectBackoff = backoff.exponential({
  initialDelay: 1000,
  maxDelay: 60000
});

reconnectBackoff.on('ready', async () => {
  try {
    await chatClient.connect();
    reconnectBackoff.reset();
    isReconnecting = false;
  } catch (error) {
    logger.error(`Failed to reconnect: ${error}`);
    reconnectBackoff.backoff();
  }
});

async function main() {
  try {
    logger.info('Bot starting...');
    await initializeDatabase();
    await setTimeoutPromise(1000); // 1 second delay

    const tokenData = JSON.parse(await fsPromises.readFile('./tokens.json', 'utf-8'));

    const authProvider = new RefreshingAuthProvider(
      {
        clientId: config.twitch.clientId,
        clientSecret: config.twitch.clientSecret,
        onRefresh: async (userId, newTokenData) => {
          tokenData.accessToken = newTokenData.accessToken;
          tokenData.refreshToken = newTokenData.refreshToken;
          tokenData.expiresIn = newTokenData.expiresIn;
          tokenData.obtainmentTimestamp = newTokenData.obtainmentTimestamp;
          await fs.writeFile('./tokens.json', JSON.stringify(tokenData, null, 4), 'utf-8');
        }
      }
    );

    await authProvider.addUserForToken(tokenData, ['chat']);

    const apiClient = new ApiClient({ authProvider, scopes: ['chat:read'] });
    const chatClient = new ChatClient({
      authProvider,
      channels: config.twitch.channels,
      isAlwaysMod: true, // Set this to true to ignore some rate limits
      requestMembershipEvents: true
    });

    const twitchAPI = new TwitchAPI(apiClient);

    // Define bot object
    const bot = {
      api: apiClient,
      chat: chatClient,
      say: async (channel, message, options = {}) => {
        const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
        logger.log('botMessage', `[BOT MESSAGE] ${formattedChannel}: ${message}`);
        return chatClient.say(channel, message, options);
      },
      addCommand: (command, handler) => {
        commandHandlers[command] = handler;
      }
    };

    // Function to determine if the bot should ignore rate limits
    async function determineIsAlwaysMod() {
      const channelStatuses = await Promise.all(config.twitch.channels.map(channel => checkBotStatus(channel, apiClient)));
      return channelStatuses.every(status => status.isMod || status.isVip);
    }

    // Update the bot's say method to use dynamic privilege status
    bot.say = async (channel, message, options = {}) => {
      const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
      logger.log('botMessage', `[BOT MESSAGE] ${formattedChannel}: ${message}`);

      const isAlwaysMod = await determineIsAlwaysMod();
      if (isAlwaysMod || options.ignoreRateLimit) {
        return chatClient.say(channel, message, options);
      } else {
        // Implement a simple rate limiter
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second delay
        return chatClient.say(channel, message);
      }
    };

    // Get the bot's user information
    const botUser = await apiClient.users.getUserByName(config.twitch.botUsername);
    if (!botUser) {
      throw new Error(`Could not find bot user: ${config.twitch.botUsername}`);
    }

    // Helper function to check bot status in a channel
    async function checkBotStatus(channel, apiClient) {
      try {
        const channelUser = await apiClient.users.getUserByName(channel);
        if (!channelUser) {
          logger.warn(`Could not get user info for ${channel}`);
          return { channel, isMod: false, isVip: false };
        }

        const channelBadges = await apiClient.chat.getChannelBadges(channelUser.id);

        let isMod = false;
        let isVip = false;

        // Check if the bot has moderator or VIP badge
        channelBadges.forEach(badgeSet => {
          if (badgeSet.id === 'moderator') {
            isMod = badgeSet.versions.some(version => version.id === '1');
          }
          if (badgeSet.id === 'vip') {
            isVip = badgeSet.versions.some(version => version.id === '1');
          }
        });

        return { channel, isMod, isVip };
      } catch (error) {
        logger.error(`Error checking bot status for ${channel}: ${error.message}`);
        return { channel, isMod: false, isVip: false };
      }
    }

    // Check the bot's status in each channel
    const channelStatuses = await Promise.all(config.twitch.channels.map(checkBotStatus));

    // Instead of updating the ChatClient, we'll use this information when needed
    const isAlwaysMod = channelStatuses.every(status => status.isMod);

    const commandHandlers = {};

    // Set up AFK handlers
    const afkHandlers = await setupAfk(bot);
    Object.entries(afkHandlers).forEach(([command, handler]) => {
      if (command !== 'handleMessage') {
        commandHandlers[command] = handler;
      }
    });

    await setupCommands(bot);
    await setTimeoutPromise(500); // 0.5 second delay
    logger.info('Commands set up');

    // Make sure all rate commands are registered
    const rateCommands = commandHandlers;
    ['pp', 'kok', 'cock', 'penis'].forEach(cmd => {
      bot.addCommand(cmd, rateCommands.myd);
    });

    try {
      const eventSubListener = await setupEventSub(authProvider, bot);
      logger.info('EventSub set up successfully');
    } catch (error) {
      logger.error(`Failed to set up EventSub: ${error}`);
      // You might want to decide whether to continue running the bot without EventSub
      // or to throw an error and stop the bot
    }

    chatClient.onConnect(() => {
      logger.info('Bot connected to Twitch chat');
      isReconnecting = false;
    });

    chatClient.onDisconnect((manual, reason) => {
      logger.info(`Bot disconnected from Twitch chat. Manual: ${manual}, Reason: ${reason || 'No reason provided'}`);
      if (!manual && !isReconnecting) {
        isReconnecting = true;
        logger.info('Attempting to reconnect...');
        reconnectBackoff.backoff();
      }
    });

    chatClient.onMessage(async (channel, user, message, msg) => {
      const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
      logger.info(`[MESSAGE] ${formattedChannel} @${user}: ${message}`);
      if (user === chatClient.currentNick) return;

      try {
        const channelUser = await apiClient.users.getUserByName(channel.replace('#', ''));
        if (!channelUser) {
          logger.warn(`Could not get user info for channel: ${channel}`);
          return;
        }

        const userBadgeInfo = await twitchAPI.getUserBadges(channelUser.id, msg.userInfo);

        const userInfo = {
          userId: msg.userInfo.userId,
          username: user,
          displayName: msg.userInfo.displayName,
          isMod: userBadgeInfo.isMod,
          isVip: userBadgeInfo.isVip,
          isBroadcaster: userBadgeInfo.isBroadcaster,
          isSubscriber: userBadgeInfo.isSubscriber,
          badges: userBadgeInfo.badges
        };

        const isPrivilegedUser = userInfo.isBroadcaster || userInfo.isMod || userInfo.isVip;

        if (message.startsWith('#')) {
          const [command, ...args] = message.slice(1).split(' ');
          const handler = commandHandlers[command];
          if (handler) {
            const context = { 
              channel, 
              user: userInfo, 
              message: msg, 
              args, 
              bot: {
                ...bot,
                say: (ch, msg, opts = {}) => chatClient.say(ch, msg, { ...opts, ignoreRateLimit: isPrivilegedUser })
              },
              isPrivilegedUser
            };
            await handler(context);
          }
        } else {
          await afkHandlers.handleMessage(channel, userInfo, message);
        }

      } catch (error) {
        logger.error(`Error processing message: ${error.message}`);
      }
    });

    await chatClient.connect();

    logger.info(`Bot started successfully and joined channels: ${config.twitch.channels.join(', ')}`);
  } catch (error) {
    logger.error(`Critical error in main function: ${error}`);
    await gracefulShutdown();
  }
}

main().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
