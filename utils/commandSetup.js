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
  }

  async initialize({ chatClient, apiClient, twitchEventManager }) {
    if (this.initialized) {
      return this;
    }

    try {
      logger.startOperation('Initializing CommandManager');
      
      // Store required services
      this.chatClient = chatClient;
      this.apiClient = apiClient;
      this.twitchEventManager = twitchEventManager;

      if (!this.chatClient || !this.apiClient) {
        throw new Error('Required services not found: chatClient or apiClient');
      }

      // Create context with services
      const context = {
        chatClient: this.chatClient,
        apiClient: this.apiClient,
        messageLogger: serviceRegistry.getService('messageLogger'),
        twitchEventManager: this.twitchEventManager
      };

      // Setup commands with context
      await this.setupCommands(context);

      this.initialized = true;
      logger.info('CommandManager initialized successfully');
      return this;
    } catch (error) {
      logger.error('Error initializing CommandManager:', error);
      throw error;
    }
  }

  async setupCommands(context) {
    const commandSetups = [
      { name: 'steam', setup: setupSteam },
      { name: 'dvp', setup: setupDvp },
      { name: 'stats', setup: setupStats },
      // ... other commands
    ];

    for (const { name, setup } of commandSetups) {
      try {
        logger.debug(`Setting up command: ${name}`);
        const command = await setup(context);
        if (command) {
          this.commands.set(name, command);
          logger.info(`Loaded command: ${name}`);
        }
      } catch (error) {
        logger.error(`Failed to load command ${name}:`, error);
      }
    }
  }

  getCommand(name) {
    return this.commands.get(name);
  }

  async handleCommand(commandName, context, ...args) {
    logger.startOperation(`Executing command: ${commandName}`);
    try {
      const command = this.getCommand(commandName.toLowerCase());
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
}

// Create singleton instance
const commandManager = new CommandManager();

// Register with service registry
serviceRegistry.register('commands', commandManager);

// Export both the class and singleton instance
export { CommandManager, commandManager };

// Export setup function for backward compatibility
export async function setupCommands(chatClient) {
  await commandManager.initialize();
  return {
    commands: commandManager.commands,
    failedCommands: []
  };
}
