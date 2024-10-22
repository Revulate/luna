import { setTimeout } from 'timers/promises';
import logger from './logger.js';
import { botStatusManager } from './BotStatusManager.js';

class CommandQueue {
  constructor() {
    this.queue = new Map(); // Separate queue per channel
    this.processing = new Map(); // Track processing state per channel
  }

  async add(command, channel, isMention = false) {
    const channelName = channel.replace('#', '');
    
    // Execute mentions immediately, bypassing queue
    if (isMention) {
      try {
        await command();
      } catch (error) {
        logger.error(`Error executing mention command: ${error.message}`);
      }
      return;
    }

    if (!this.queue.has(channelName)) {
      this.queue.set(channelName, []);
    }

    this.queue.get(channelName).push(command);

    if (!this.processing.get(channelName)) {
      await this.processQueue(channelName);
    }
  }

  async processQueue(channelName) {
    this.processing.set(channelName, true);
    
    while (this.queue.get(channelName)?.length > 0) {
      const command = this.queue.get(channelName).shift();
      try {
        await botStatusManager.applyRateLimit(channelName);
        await command();
      } catch (error) {
        logger.error(`Error processing command in ${channelName}: ${error.message}`);
      }
    }

    this.processing.set(channelName, false);
  }
}

export const commandQueue = new CommandQueue();
