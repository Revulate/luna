import { setupAfk } from './afk.js';
import { setupRate } from './rate.js';
import { setupDvp } from './dvp.js';
import { setupGpt } from './gpt.js';
import { setupSpc } from './spc.js';
import { setupPreview } from './preview.js';
import logger from '../logger.js';

export async function setupCommands(bot) {
  const commandSetups = [
    setupRate,
    setupDvp,
    setupGpt,
    setupSpc,
    setupPreview
  ];

  for (const setup of commandSetups) {
    const commands = await setup(bot);
    Object.entries(commands).forEach(([name, handler]) => {
      bot.addCommand(name, handler);
      logger.debug(`Command '${name}' registered`);
    });
  }

  // Setup AFK commands separately
  const { handleMessage: handleAfkMessage, ...afkCommands } = await setupAfk(bot);
  Object.entries(afkCommands).forEach(([name, handler]) => {
    bot.addCommand(name, handler);
    logger.debug(`AFK Command '${name}' registered`);
  });
  bot.handleAfkMessage = handleAfkMessage;

  logger.info('All commands registered successfully');
  logger.debug(`Registered commands: ${Object.keys(bot.commands).join(', ')}`);
}
