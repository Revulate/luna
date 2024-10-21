import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';
import logger from './logger.js';
import { initializeDatabase } from './database.js';
import { config } from './config.js';
import { setupCommands } from './commands/index.js';
import { setupAfk } from './commands/afk.js';
import TwitchAPI from './twitch_api.js';
import { botStatusManager } from './BotStatusManager.js';

dotenv.config();

// Utility functions
function isMod(user) {
  return user.isMod || user.isBroadcaster;
}

function isVip(user) {
  return user.isVip;
}

async function gracefulShutdown() {
  logger.info('Initiating graceful shutdown...');
  // Add any necessary cleanup operations here
  process.exit(0);
}

async function initializeTokensFile() {
  const tokensPath = path.join(process.cwd(), 'tokens.json');
  try {
    await fs.access(tokensPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('tokens.json not found. Creating a new one with default values.');
      const defaultTokens = {
        accessToken: '',
        refreshToken: '',
        expiresIn: 0,
        obtainmentTimestamp: 0,
        scope: []
      };
      await fs.writeFile(tokensPath, JSON.stringify(defaultTokens, null, 2));
    } else {
      throw error;
    }
  }
}

async function main() {
  try {
    logger.info('Bot starting...');
    await initializeDatabase();
    await initializeTokensFile();

    const tokenData = JSON.parse(await fs.readFile('./tokens.json', 'utf-8'));
    logger.debug('Token data loaded successfully');

    const authProvider = new RefreshingAuthProvider(
      {
        clientId: config.twitch.clientId,
        clientSecret: config.twitch.clientSecret,
        onRefresh: async newTokenData => {
          await fs.writeFile('./tokens.json', JSON.stringify(newTokenData, null, 2));
          logger.debug('Token refreshed and saved');
        }
      },
      tokenData
    );

    // Add the chat intent to the auth provider
    await authProvider.addUserForToken(tokenData, ['chat']);

    const apiClient = new ApiClient({ authProvider });
    const twitchAPI = new TwitchAPI(apiClient);

    const chatClient = new ChatClient({
      authProvider,
      channels: config.twitch.channels,
      isAlwaysMod: true,
      requestMembershipEvents: true
    });

    const bot = {
      say: async (channel, message) => {
        const channelName = channel.replace('#', '');
        await botStatusManager.customRateLimit(channelName);
        await chatClient.say(channel, message);
        logger.debug(`Message sent to ${channel}: ${message}`);
      },
      api: apiClient,
      commands: {}, // Store commands
      addCommand: function(name, handler) {
        if (!this.commands[name]) {
          this.commands[name] = handler;
          // Remove this line: logger.debug(`Command '${name}' registered`);
        } else {
          logger.warn(`Command '${name}' already exists, not overwriting`);
        }
      },
    };

    // Setup commands
    const { handleAfkMessage } = await setupCommands(bot);
    bot.handleAfkMessage = handleAfkMessage;

    chatClient.onConnect(() => {
      logger.info('Bot connected to Twitch chat');
    });

    chatClient.onJoin((channel, user) => {
      if (user === chatClient.currentNick) {
        logger.info(`Joined channel: ${channel}`);
        // Request USERSTATE when joining a channel
        chatClient.say(channel, '').then(() => {
          const badges = chatClient.userStateTracker.getForChannel(channel).badges;
          botStatusManager.updateStatus(channel, Object.keys(badges));
        }).catch(error => {
          logger.error(`Error requesting USERSTATE in ${channel}: ${error.message}`);
        });
      }
    });

    chatClient.onMessage(async (channel, user, message, msg) => {
      const badges = msg.userInfo.badges ? Array.from(msg.userInfo.badges.keys()) : [];
      botStatusManager.updateStatus(channel, badges);
      logger.debug(`Updated bot status for ${channel} with badges: ${badges.join(', ')}`);

      const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
      logger.info(`[MESSAGE] ${formattedChannel} @${user}: ${message}`);

      try {
        const userInfo = await twitchAPI.getUserInfo(channel, msg.userInfo);

        if (message.startsWith('#')) {
          const [command, ...args] = message.slice(1).split(' ');
          logger.debug(`Attempting to execute command: ${command}`);
          const handler = bot.commands[command];
          if (handler) {
            logger.debug(`Handler found for command: ${command}`);
            await handler({ channel, user: userInfo, message: msg, args, bot });
          } else {
            logger.debug(`No handler found for command: ${command}`);
          }
        } else {
          await bot.handleAfkMessage(channel, userInfo, message);
        }
      } catch (error) {
        logger.error(`Error processing message: ${error.message}`);
      }
    });

    // Add this new event handler to check for errors
    chatClient.onAuthenticationFailure((text, retryCount) => {
      logger.error(`Authentication failed: ${text} (retry count: ${retryCount})`);
      if (retryCount >= 5) {
        logger.error('Max retry count reached. Shutting down.');
        gracefulShutdown();
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

export { isMod, isVip, gracefulShutdown };
