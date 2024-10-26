import { ChatClient } from '@twurple/chat';
import { MessageLogger } from './MessageLogger.js';
import logger from './logger.js';
import { setupRate } from '../commands/rate.js';
import { setupPreview } from '../commands/preview.js';
import { setupAfk } from '../commands/afk.js';
import { setupGpt } from '../commands/gpt.js';
import { setup7tv } from '../commands/7tv.js';
import { setupMessageLookup } from '../commands/messageLookup.js';
import { setupSteam } from '../commands/steam.js';
import { setupDvp } from '../commands/dvp.js';
import { setupStats } from '../commands/stats.js';
import { setupLastMessage } from '../commands/lm.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { serviceRegistry } from './serviceRegistry.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define command setup configurations
const commandSetups = [
  { name: 'rate', setup: setupRate },
  { name: 'preview', setup: setupPreview },
  { name: 'afk', setup: setupAfk },
  { name: 'gpt', setup: setupGpt },
  { name: '7tv', setup: setup7tv },
  { name: 'messageLookup', setup: setupMessageLookup },
  { name: 'steam', setup: setupSteam },
  { name: 'dvp', setup: setupDvp },
  { name: 'stats', setup: setupStats },
  { name: 'lastMessage', setup: setupLastMessage }
];

function createCommandContext(channel, user, message, msg, chatClient, apiClient) {
  logger.debug('Creating command context', {
    channel,
    username: user,
    command: message.split(' ')[0]
  });

  return {
    channel,
    user: {
      username: user,
      displayName: msg.userInfo.displayName || user,
      ...msg.userInfo
    },
    message,
    args: message.slice(config.twitch.commandPrefix.length).trim().split(/\s+/).slice(1),
    say: async (text) => {
      await chatClient.say(channel, text);
    },
    chatClient,
    apiClient
  };
}

async function setupCommands(chatClient) {
  logger.startOperation('Setting up commands');
  const commands = new Map();
  const failedCommands = [];

  // Create context with services
  const context = {
    chatClient,
    apiClient: chatClient.apiClient,
    messageLogger: serviceRegistry.getService('messageLogger')
  };

  // Setup each command with proper client initialization
  for (const { name, setup } of commandSetups) {
    try {
      logger.debug(`Setting up command: ${name}`);
      
      // Pass chatClient directly for AFK command
      if (name === 'afk') {
        const command = await setup(chatClient);
        if (command) {
          commands.set(name, command);
          logger.info(`Loaded command: ${name}`);
        }
        continue;
      }

      // Regular command setup
      const command = await setup(context);
      if (command) {
        commands.set(name, command);
        logger.info(`Loaded command: ${name}`);
      }
    } catch (error) {
      logger.error(`Failed to load command ${name}:`, error);
      failedCommands.push(name);
    }
  }

  logger.debug('Failed commands:', failedCommands);
  logger.endOperation('Setting up commands', failedCommands.length === 0);

  return { commands, failedCommands };
}

async function handleCommand(commandName, context, ...args) {
  logger.startOperation(`Executing command: ${commandName}`);
  try {
    const command = serviceRegistry.getService('commands')?.getCommand(commandName.toLowerCase());
    if (!command) {
      logger.debug(`Command not found: ${commandName}`);
      logger.endOperation(`Executing command: ${commandName}`, false);
      return false;
    }

    await command.execute(context, ...args);
    logger.endOperation(`Executing command: ${commandName}`, true);
    return true;
  } catch (error) {
    logger.error(`Error executing command ${commandName}:`, error);
    logger.endOperation(`Executing command: ${commandName}`, false);
    return false;
  }
}

export { setupCommands, handleCommand, createCommandContext };
