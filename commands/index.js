import { setupAfk } from './afk.js';
import { setupRate } from './rate.js';
import { setupDvp } from './dvp.js';
import { setupGpt } from './gpt.js';
import { setupSpc } from './spc.js';
import { setupPreview } from './preview.js';
import logger from '../logger.js';

export async function setupCommands(bot) {
  logger.info('Starting setupCommands function');
  const commandSetups = [
    setupRate,
    setupDvp,
    setupGpt,
    setupSpc,
    setupPreview
  ];

  const registeredCommands = new Set();

  for (const setup of commandSetups) {
    logger.debug(`Running setup function: ${setup.name}`);
    const commands = await setup(bot);
    logger.debug(`Commands returned by ${setup.name}: ${Object.keys(commands).join(', ')}`);
    Object.entries(commands).forEach(([name, handler]) => {
      if (!registeredCommands.has(name)) {
        bot.addCommand(name, handler);
        registeredCommands.add(name);
        logger.debug(`Command '${name}' registered from ${setup.name}`);
      } else {
        logger.warn(`Command '${name}' already registered, skipping duplicate from ${setup.name}`);
      }
    });
  }

  // Setup AFK commands separately
  logger.debug('Setting up AFK commands');
  const { handleMessage: handleAfkMessage, ...afkCommands } = await setupAfk(bot);
  Object.entries(afkCommands).forEach(([name, handler]) => {
    if (!registeredCommands.has(name)) {
      bot.addCommand(name, handler);
      registeredCommands.add(name);
      logger.debug(`AFK Command '${name}' registered`);
    } else {
      logger.warn(`AFK Command '${name}' already registered, skipping duplicate`);
    }
  });

  logger.info('All commands registered successfully');
  logger.debug(`Registered commands: ${Array.from(registeredCommands).join(', ')}`);
  logger.info('Finished setupCommands function');

  return {
    commands: bot.commands,
    handleAfkMessage
  };
}
