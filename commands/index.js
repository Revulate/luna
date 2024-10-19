import { setupAfk } from './afk.js';
import { setupRate } from './rate.js';
import { setupDvp } from './dvp.js';
import { setupGpt } from './gpt.js';
import { setupSpc } from './spc.js';
import { setupPreview } from './preview.js';
import logger from '../logger.js';

export async function setupCommands(bot) {
  const commandSetups = [
    setupAfk,
    setupRate,
    setupDvp,
    setupGpt,
    setupSpc,
    setupPreview
  ];

  for (const setup of commandSetups) {
    const commands = setup(bot);
    Object.entries(commands).forEach(([name, handler]) => {
      bot.addCommand(name, handler);
    });
  }

  logger.info('All commands registered successfully');
}
