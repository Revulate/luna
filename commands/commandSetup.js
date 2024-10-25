import logger from '../logger.js';
import { setupRate } from './rate.js';
import { setupPreview } from './preview.js';
import { setupAfk } from './afk.js';
import { setupGpt } from './gpt.js';
import MessageLogger from '../MessageLogger.js';
import { setup7tv } from './7tv.js';
import { setupMessageLookup } from './messageLookup.js';
import { setupSpc } from './spc.js';
import { setupDvp } from './dvp.js';
import { setupStats } from './stats.js';

export async function setupCommands(chatClient) {
  logger.info('Starting setupCommands function');
  
  // Initialize MessageLogger if not already initialized
  if (!MessageLogger.db) {
    await MessageLogger.initialize();
  }
  
  const registeredCommands = new Map();

  // Create a wrapper that includes both chatClient and apiClient
  const createCommandContext = (context) => ({
    ...context,
    chatClient,
    apiClient: chatClient.apiClient,
    say: async (text) => await chatClient.say(context.channel, text)
  });

  const registerCommand = (name, handler, source) => {
    if (!registeredCommands.has(name)) {
      const wrappedHandler = async (context) => {
        try {
          await handler(createCommandContext(context));
        } catch (error) {
          logger.error(`Error in ${name} command:`, error);
          await chatClient.say(context.channel, 
            `@${context.user.username}, Sorry, an error occurred.`);
        }
      };
      
      registeredCommands.set(name, wrappedHandler);
      logger.debug(`Command '${name}' registered from ${source}`);
    }
  };

  // Setup commands with proper context
  logger.debug('Setting up rate commands...');
  const rateCommands = setupRate(chatClient);
  Object.entries(rateCommands).forEach(([name, handler]) => {
    registerCommand(name.toLowerCase(), handler, 'Rate');
  });

  logger.debug('Setting up preview commands...');
  const previewCommands = setupPreview(chatClient);
  Object.entries(previewCommands).forEach(([name, handler]) => {
    const commandName = name.toLowerCase();
    logger.debug(`Registering preview command: ${commandName}`);
    registerCommand(commandName, handler, 'Preview');
  });

  logger.debug('Setting up AFK commands...');
  const afkSetup = await setupAfk(chatClient);
  if (afkSetup && afkSetup.commands) {
    Object.entries(afkSetup.commands).forEach(([name, handler]) => {
      const commandName = name.toLowerCase();
      logger.debug(`Registering AFK command: ${commandName}`);
      registerCommand(commandName, handler, 'AFK');
    });
  }

  logger.debug('Setting up GPT commands...');
  const gptCommands = setupGpt(chatClient);
  Object.entries(gptCommands).forEach(([name, handler]) => {
    const commandName = name.toLowerCase();
    logger.debug(`Registering GPT command: ${commandName}`);
    registerCommand(commandName, handler, 'GPT');
  });

  logger.debug('Setting up 7TV commands...');
  const sevenTvCommands = setup7tv(chatClient);
  Object.entries(sevenTvCommands).forEach(([name, handler]) => {
    const commandName = name.toLowerCase();
    logger.debug(`Registering 7TV command: ${commandName}`);
    registerCommand(commandName, handler, '7TV');
  });

  // Setup message lookup commands
  logger.debug('Setting up message lookup commands...');
  const messageLookupCommands = setupMessageLookup(chatClient);
  Object.entries(messageLookupCommands).forEach(([name, handler]) => {
    registerCommand(name.toLowerCase(), handler, 'MessageLookup');
  });

  // Setup SPC commands
  logger.debug('Setting up SPC commands...');
  const spcCommands = setupSpc(chatClient);
  Object.entries(spcCommands).forEach(([name, handler]) => {
    registerCommand(name.toLowerCase(), handler, 'SPC');
  });

  // Setup DVP commands
  logger.debug('Setting up DVP commands...');
  const dvpCommands = await setupDvp(chatClient);
  Object.entries(dvpCommands).forEach(([name, handler]) => {
    const commandName = name.toLowerCase();
    logger.debug(`Registering DVP command: ${commandName}`);
    registerCommand(commandName, handler, 'DVP');
  });

  // Setup Stats commands
  logger.debug('Setting up Stats commands...');
  const statsCommands = setupStats(chatClient);
  Object.entries(statsCommands).forEach(([name, handler]) => {
    registerCommand(name.toLowerCase(), handler, 'Stats');
  });

  // Add utility commands
  logger.debug('Setting up utility commands...');
  const utilityCommands = {
    stats: async (context) => {
      const { channel, user } = context;
      try {
        const uptime = process.uptime();
        const memory = process.memoryUsage();
        const response = `@${user.username} Bot Stats • Uptime: ${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m • Memory: ${Math.round(memory.heapUsed/1024/1024)}MB`;
        await context.say(response);
      } catch (error) {
        logger.error('Error in stats command:', error);
        await context.say(`@${user.username}, Error getting stats.`);
      }
    },
    ping: async (context) => {
      const { channel, user } = context;
      try {
        const start = Date.now();
        await context.apiClient.users.getUserByName('twitch');
        const ping = Date.now() - start;
        await context.say(`@${user.username} Pong! Latency: ${ping}ms`);
      } catch (error) {
        logger.error('Error in ping command:', error);
        await context.say(`@${user.username}, Error checking ping.`);
      }
    }
  };

  Object.entries(utilityCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'Utility');
  });

  logger.info('All commands registered successfully');
  logger.debug(`Registered commands: ${Array.from(registeredCommands.keys()).join(', ')}`);

  // Add at the end of setupCommands before return
  logger.info(`Registered ${registeredCommands.size} commands:`);
  registeredCommands.forEach((handler, name) => {
    logger.debug(`- ${name}`);
  });

  // Just return the commands map
  return {
    commands: registeredCommands
  };
}
