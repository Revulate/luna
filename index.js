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
        obtainmentTimestamp: 0
      };
      await fs.writeFile(tokensPath, JSON.stringify(defaultTokens, null, 2));
    }
  }
}

let globalBot = null; // Add this to store bot reference globally

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

    await authProvider.addUserForToken(tokenData, ['chat']);

    const apiClient = new ApiClient({ authProvider });
    const chatClient = new ChatClient({
      authProvider,
      channels: config.twitch.channels,
      isAlwaysMod: true,
      requestMembershipEvents: true
    });

    const twitchAPI = new TwitchAPI(apiClient);

    // Initialize bot object with all required methods
    const bot = {
      say: async (channel, message) => {
        await chatClient.say(channel, message);
        logger.debug(`Message sent to ${channel}: ${message}`);
      },
      api: apiClient,
      twitchAPI,
      chatClient,
      commands: {},
      addCommand: function(name, handler) {
        this.commands[name] = handler;
      },
      getChannels: function() {
        return config.twitch.channels;
      }
    };

    globalBot = bot; // Store bot reference globally

    // Add message handling
    chatClient.onMessage(async (channel, user, message, msg) => {
      try {
        // Update bot status based on badges
        botStatusManager.updateStatus(channel, msg.userInfo.badges);

        // Log the message
        await MessageLogger.logMessage(channel, user, message, msg);

        // Handle commands if message starts with prefix
        if (message.startsWith('#')) {
          const [command, ...args] = message.slice(1).split(' ');
          const handler = bot.commands[command];
          if (handler) {
            const context = {
              channel,
              user: {
                id: msg.userInfo.userId,
                username: user,
                isMod: msg.userInfo.isMod,
                isBroadcaster: msg.userInfo.isBroadcaster,
                isVip: msg.userInfo.isVip,
                badges: msg.userInfo.badges
              },
              args,
              message: message.slice(command.length + 2), // +2 for # and space
              rawMessage: msg
            };
            await handler(context);
          }
        } else {
          // Handle AFK status for non-command messages
          if (afkModule && afkModule.messageHandler) {
            await afkModule.messageHandler(channel, {
              id: msg.userInfo.userId,
              username: user,
              badges: msg.userInfo.badges
            }, message);
          }
        }
      } catch (error) {
        logger.error(`Error handling message: ${error}`);
      }
    });

    // Setup base commands first
    const { handleAfkMessage, commands } = await setupCommands(bot, twitchAPI);
    bot.handleAfkMessage = handleAfkMessage;
    Object.assign(bot.commands, commands);  // Assign base commands

    // Set up AFK module and add its commands
    const afkModule = await setupAfk(bot);
    
    // Add AFK commands to existing commands
    bot.commands.afk = afkModule.afk;
    bot.commands.sleep = afkModule.sleep;
    bot.commands.gn = afkModule.gn;
    bot.commands.work = afkModule.work;
    bot.commands.food = afkModule.food;
    bot.commands.gaming = afkModule.gaming;
    bot.commands.bed = afkModule.bed;
    bot.commands.rafk = afkModule.rafk;
    bot.commands.clearafk = afkModule.clearafk;

    await chatClient.connect();
    logger.info(`Bot started successfully and joined channels: ${config.twitch.channels.join(', ')}`);

    // Set up autonomous chat interval using the global bot reference
    setInterval(() => {
      if (globalBot) {
        globalBot.getChannels().forEach(channel => {
          if (globalBot.commands.tryGenerateAndSendMessage) {
            globalBot.commands.tryGenerateAndSendMessage(channel);
          }
        });
      }
    }, 5 * 60 * 1000); // Every 5 minutes

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
