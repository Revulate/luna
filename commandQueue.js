import { setTimeout } from 'timers/promises';
import logger from './logger.js';
import { botStatusManager } from './BotStatusManager.js';

class CommandQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  async add(command, channel) {
    this.queue.push({ command, channel });
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  async processQueue() {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const { command, channel } = this.queue.shift();
      try {
        const ignoreRateLimit = botStatusManager.canIgnoreRateLimit(channel);
        await command({ ignoreRateLimit });
        if (!ignoreRateLimit) {
          logger.debug(`Applying rate limit delay for channel: ${channel}`);
          await setTimeout(1000); // 1 second delay between commands if bot is not mod/VIP in the channel
        } else {
          logger.debug(`Bypassing rate limit for channel: ${channel}`);
        }
      } catch (error) {
        logger.error(`Error processing command: ${error}`);
      }
    }
    this.isProcessing = false;
  }
}

export const commandQueue = new CommandQueue();
