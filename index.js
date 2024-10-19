import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';

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
import { setupRate } from './commands/rate.js';
import { setupEventSub } from './eventSub.js';
import { setTimeout as setTimeoutPromise } from 'timers/promises';
import { isMod, isVip } from './utils.js';
import { commandQueue } from './commandQueue.js';
import { gracefulShutdown } from './utils.js';

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

    const apiClient = new ApiClient({ authProvider });
    const chatClient = new ChatClient({ authProvider, channels: config.twitch.channels });

    try {
      const user = await apiClient.users.getUserByName(config.twitch.botUsername);
      logger.info(`Successfully connected to Twitch API. Bot user ID: ${user.id}`);
    } catch (error) {
      logger.error(`Failed to connect to Twitch API: ${error}`);
      throw error;
    }

    const commandHandlers = {};

    const bot = {
      api: apiClient,
      chat: chatClient,
      say: (channel, message) => {
        const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
        logger.log('botMessage', `[BOT MESSAGE] ${formattedChannel}: ${message}`);
        return chatClient.say(channel, message);
      },
      addCommand: (command, handler) => {
        commandHandlers[command] = handler;
      }
    };

    const afkHandlers = setupAfk(bot);

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
    });

    chatClient.onDisconnect((manual, reason) => {
      logger.info(`Bot disconnected from Twitch chat. Manual: ${manual}, Reason: ${reason || 'No reason provided'}`);
      // Attempt to reconnect
      setTimeoutPromise(5000).then(() => chatClient.connect());
    });

    chatClient.onMessage((channel, user, message, msg) => {
      const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
      logger.info(`[MESSAGE] ${formattedChannel} @${user}: ${message}`);
      if (user === chatClient.currentNick) return;

      const userInfo = {
        userId: msg.userInfo.userId,
        username: user,
        displayName: msg.userInfo.displayName,
        isMod: msg.userInfo.isMod,
        isVip: msg.userInfo.isVip,
        isBroadcaster: msg.userInfo.isBroadcaster
      };

      if (message.startsWith('#')) {
        const [command, ...args] = message.slice(1).split(' ');
        if (['afk', 'sleep', 'gn', 'work', 'food', 'gaming', 'bed'].includes(command)) {
          commandQueue.add(() => afkHandlers.handleAfkCommand({ channel, user: userInfo, args, command }));
        } else if (command === 'rafk') {
          commandQueue.add(() => afkHandlers.handleRafkCommand({ channel, user: userInfo }));
        } else {
          const handler = commandHandlers[command];
          if (handler) {
            commandQueue.add(() => handler({ channel, user: userInfo, message: msg, args, bot }));
          } else {
            logger.info(`Unknown command: ${command}`);
          }
        }
      } else {
        commandQueue.add(() => afkHandlers.handleMessage(channel, userInfo, message));
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
