import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';
import logger from './logger.js';
import { initializeDatabase } from './database.js';
import { config } from './config.js';
import { setupCommands } from './commands/commandSetup.js';
import { setupAfk } from './commands/afk.js';
import TwitchAPI from './twitch_api.js';
import { botStatusManager } from './BotStatusManager.js';
import MessageLogger from './MessageLogger.js';
import { setupGpt } from './commands/gpt.js';

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

// Add this line near the top of the file
let lastCommandTime = 0;
const commandCooldown = 5000; // 5 seconds cooldown after a command

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
        this.commands[name] = async (context) => {
          await handler(context);
          lastCommandTime = Date.now(); // Set the last command time
        };
      },
      // Add this new method
      getChannels: function() {
        return config.twitch.channels;
      },
      getLastCommandTime: function() {
        return lastCommandTime;
      },
    };

    // Setup commands
    const { handleAfkMessage } = await setupCommands(bot, twitchAPI);
    bot.handleAfkMessage = handleAfkMessage;

    const gptCommands = setupGpt(bot, twitchAPI);
    
    // Add the gpt command to the bot's commands
    bot.addCommand('gpt', gptCommands.gpt);

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
      // Use a Map for faster lookups
      const badgeSet = new Set(msg.userInfo.badges ? msg.userInfo.badges.keys() : []);
      botStatusManager.updateStatus(channel, badgeSet);

      const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
      logger.info(`[MESSAGE] ${formattedChannel} @${user}: ${message}`);

      try {
        const userInfo = await twitchAPI.getUserInfo(channel, msg.userInfo);

        // Log the message
        MessageLogger.logMessage(channel.replace('#', ''), msg.userInfo.userId, user, message);

        if (message.startsWith('#')) {
          const [command, ...args] = message.slice(1).split(' ');
          const handler = bot.commands[command];
          if (handler) {
            await handler({ channel, user: userInfo, message: msg, args, bot });
          }
        } else {
          await bot.handleAfkMessage(channel, userInfo, message);
        }

        // Trigger the autonomous chat check
        await gptCommands.tryGenerateAndSendMessage(channel);
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
