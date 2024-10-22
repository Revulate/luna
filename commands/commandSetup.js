import { setupAfk } from './afk.js';
import { setupRate } from './rate.js';
import { setupDvp } from './dvp.js';
import { setupGpt } from './gpt.js';
import { setupSpc } from './spc.js';
import { setupPreview } from './preview.js';
import { setupStats } from './stats.js';
import { setupMessageLookup } from './messageLookup.js';
import logger from '../logger.js';
import MessageLogger from '../MessageLogger.js';
import { commandQueue } from '../commandQueue.js';

export async function setupCommands(bot, twitchAPI) {
  logger.info('Starting setupCommands function');
  
  await MessageLogger.ensureBaseDir();
  
  const registeredCommands = new Map();

  // Helper function to register commands
  const registerCommand = (name, handler, source) => {
    if (!registeredCommands.has(name)) {
      const wrappedHandler = async (context) => {
        try {
          await commandQueue.add(async () => {
            await handler({ ...context, bot });
          }, context.channel);
        } catch (error) {
          logger.error(`Error in ${name} command: ${error}`);
          await bot.say(context.channel, `@${context.user.username}, Sorry, an error occurred.`);
        }
      };
      
      bot.addCommand(name, wrappedHandler);
      registeredCommands.set(name, wrappedHandler);
      logger.debug(`Command '${name}' registered from ${source}`);
    }
  };

  // Setup Rate commands
  const rateCommands = setupRate(bot);
  Object.entries(rateCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'Rate');
  });

  // Setup DVP commands
  const dvpCommands = setupDvp(bot);
  Object.entries(dvpCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'DVP');
  });

  // Setup SPC commands
  const spcCommands = setupSpc(bot);
  Object.entries(spcCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'SPC');
  });

  // Setup Preview commands
  const previewCommands = setupPreview(bot);
  Object.entries(previewCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'Preview');
  });

  // Setup Stats commands
  const statsCommands = setupStats(bot);
  Object.entries(statsCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'Stats');
  });

  // Setup Message Lookup commands
  const lookupCommands = setupMessageLookup(bot);
  Object.entries(lookupCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'MessageLookup');
  });

  // Setup AFK commands
  const { handleMessage: handleAfkMessage, ...afkCommands } = await setupAfk(bot);
  Object.entries(afkCommands).forEach(([name, handler]) => {
    if (name !== 'handleMessage') {
      registerCommand(name, handler, 'AFK');
    }
  });

  // Setup GPT commands last
  const gptCommands = setupGpt(bot, twitchAPI);
  Object.entries(gptCommands).forEach(([name, handler]) => {
    if (name === 'tryGenerateAndSendMessage') {
      registerCommand(name, async (context) => {
        await handler(context.channel, context.isMention, context.user);
      }, 'GPT');
    } else {
      registerCommand(name, handler, 'GPT');
    }
  });

  // Add missing commands that were previously registered
  const additionalCommands = {
    gn: afkCommands.sleep, // Alias for sleep
    work: async (context) => await afkCommands.afk({ ...context, args: ['working 💼'] }),
    food: async (context) => await afkCommands.afk({ ...context, args: ['eating 🍽️'] }),
    gaming: async (context) => await afkCommands.afk({ ...context, args: ['gaming 🎮'] }),
    bed: afkCommands.sleep, // Alias for sleep
    wordcount: lookupCommands.wc, // Alias for wc
    randommessage: lookupCommands.rm, // Alias for rm
    lastmessage: lookupCommands.lm, // Alias for lm
  };

  Object.entries(additionalCommands).forEach(([name, handler]) => {
    registerCommand(name, handler, 'Additional');
  });

  logger.info('All commands registered successfully');
  logger.debug(`Registered commands: ${Array.from(registeredCommands.keys()).join(', ')}`);
  logger.info('Finished setupCommands function');

  return {
    handleAfkMessage,
    commands: Object.fromEntries(registeredCommands)
  };
}
