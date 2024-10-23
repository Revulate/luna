import logger from '../logger.js';
import { setupRate } from './rate.js';
import { setupPreview } from './preview.js';
import { setupAfk } from './afk.js';
import { setupGpt } from './gpt.js';
import MessageLogger from '../MessageLogger.js';

export async function setupCommands(bot) {
  logger.info('Starting setupCommands function');
  
  // Initialize MessageLogger if not already initialized
  if (!MessageLogger.db) {
    await MessageLogger.initialize();
  }
  
  const registeredCommands = new Map();

  // Simplified helper function without queue
  const registerCommand = (name, handler, source) => {
    if (!registeredCommands.has(name)) {
      const wrappedHandler = async (context) => {
        try {
          await handler({ ...context, bot });
        } catch (error) {
          logger.error(`Error in ${name} command: ${error}`);
          await bot.say(context.channel, `@${context.user.username}, Sorry, an error occurred.`);
        }
      };
      
      registeredCommands.set(name, wrappedHandler);
      if (handler.aliases) {
        handler.aliases.forEach(alias => {
          registeredCommands.set(alias, wrappedHandler);
          logger.debug(`Alias '${alias}' registered for '${name}'`);
        });
      }
      logger.debug(`Command '${name}' registered from ${source}`);
    }
  };

  // Setup commands
  const rateCommands = setupRate(bot);
  Object.entries(rateCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'Rate');
  });

  const previewCommands = setupPreview(bot);
  Object.entries(previewCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'Preview');
  });

  const { commands: afkCommands, handleAfkMessage } = await setupAfk(bot);
  Object.entries(afkCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'AFK');
  });

  const gptCommands = setupGpt(bot);
  Object.entries(gptCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'GPT');
  });

  logger.info('All commands registered successfully');
  logger.debug(`Registered commands: ${Array.from(registeredCommands.keys()).join(', ')}`);
  logger.info('Finished setupCommands function');

  return {
    commands: registeredCommands,
    handleAfkMessage
  };
}
