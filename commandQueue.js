import { setTimeout as setTimeoutPromise } from 'timers/promises';
import logger from './logger.js';

class CommandQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  async add(command) {
    this.queue.push(command);
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  async processQueue() {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const command = this.queue.shift();
      try {
        await command();
        await setTimeoutPromise(1000); // 1 second delay between commands
      } catch (error) {
        logger.error(`Error processing command: ${error}`);
      }
    }
    this.isProcessing = false;
  }
}

export const commandQueue = new CommandQueue();
