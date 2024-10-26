import { ChatClient } from '@twurple/chat';
import { MessageLogger } from './MessageLogger.js';
import logger from './logger.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { serviceRegistry } from './serviceRegistry.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CommandManager {
  constructor() {
    this.commands = new Map();
    this.initialized = false;
    serviceRegistry.register('commands', this);
  }

  async initialize({ chatClient, apiClient, messageLogger, eventManager }) {
    if (this.initialized) return this;

    try {
      logger.info('Initializing CommandManager');
      this.chatClient = chatClient;
      this.apiClient = apiClient;
      this.messageLogger = messageLogger;
      this.eventManager = eventManager;

      // Load commands dynamically from the commands directory
      const commandsDir = path.join(__dirname, '..', 'commands');
      const commandFiles = await fs.readdir(commandsDir);
      
      for (const file of commandFiles) {
        if (file.endsWith('.js')) {
          const commandName = path.basename(file, '.js');
          try {
            const commandModule = await import(`../commands/${file}`);
            await this.registerCommand(commandName, commandModule);
          } catch (error) {
            logger.error(`Failed to load command ${commandName}:`, error);
          }
        }
      }

      // Listen for command events from TwitchEventManager
      this.eventManager.on('command', async (data) => {
        const command = this.commands.get(data.commandName);
        if (command) {
          try {
            await command.execute(data);
          } catch (error) {
            logger.error(`Error executing command ${data.commandName}:`, error);
          }
        }
      });

      this.initialized = true;
      logger.info('CommandManager initialized successfully');
      return this;
    } catch (error) {
      logger.error('Error initializing CommandManager:', error);
      throw error;
    }
  }

  async registerCommand(name, module) {
    try {
      if (module.default) {
        this.commands.set(name, module.default);
        logger.info(`Registered command: ${name}`);
      } else {
        logger.warn(`Command module ${name} has no default export`);
      }
    } catch (error) {
      logger.error(`Error registering command ${name}:`, error);
    }
  }
}

// Create singleton instance
const commandManager = new CommandManager();

export { CommandManager, commandManager };

export async function setupCommands(chatClient) {
  const commands = new Map();
  
  try {
    // Import all command modules
    const commandModules = {
      afk: await import('../commands/afk.js'),
      claude: await import('../commands/claude.js'),
      dvp: await import('../commands/dvp.js'),
      gpt: await import('../commands/gpt.js'),
      messageLookup: await import('../commands/messageLookup.js'),
      preview: await import('../commands/preview.js'),
      rate: await import('../commands/rate.js'),
      sevenTv: await import('../commands/7tv.js'),
      stats: await import('../commands/stats.js'),
      steam: await import('../commands/steam.js')
    };

    // Register each command's execute function
    for (const [name, module] of Object.entries(commandModules)) {
      if (module.default?.execute) {
        commands.set(name, module.default.execute);
        logger.info(`Registered command: ${name}`);
      } else {
        logger.warn(`Command ${name} missing execute function`);
      }
    }

    // Handle command messages
    chatClient.onMessage(async (channel, user, message, msg) => {
      if (!message.startsWith('#')) return;

      const args = message.slice(1).split(/\s+/);
      const commandName = args.shift().toLowerCase();
      const execute = commands.get(commandName);

      if (execute) {
        try {
          const context = {
            channel,
            user: {
              id: msg.userInfo.userId,
              username: user,
              displayName: msg.userInfo.displayName
            },
            args,
            say: (text) => chatClient.say(channel, text),
            commandName
          };

          await execute(context);
        } catch (error) {
          logger.error(`Error executing command ${commandName}:`, error);
          await chatClient.say(channel, 'Sorry, I encountered an error processing your request.');
        }
      }
    });

    logger.info('CommandManager initialized successfully');
    return commands;
  } catch (error) {
    logger.error('Error setting up commands:', error);
    throw error;
  }
}
