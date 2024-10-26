import logger from './logger.js';

class MessageQueue {
  constructor(chatClient, options = {}) {
    logger.startOperation('Initializing MessageQueue');
    this.chatClient = chatClient;
    this.queue = new Map();
    this.processing = new Set();
    
    // Use Twurple's rate limit settings
    this.rateLimits = {
      normal: { messages: 20, time: 30000 },
      mod: { messages: 100, time: 30000 },
      known: { messages: 50, time: 30000 }
    };
    
    // Add Twurple-specific options
    this.options = {
      ...options,
      isModerated: options.isModerated || false,
      isVerifiedBot: options.isVerifiedBot || false
    };
    
    logger.debug('Message queue initialized with options:', this.options);
    
    // Start queue processor
    this.startProcessor();
  }

  async enqueue(channel, message, options = {}) {
    try {
      const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const queueItem = {
        id,
        channel,
        message,
        options,
        timestamp: Date.now(),
        retries: 0,
        priority: options.priority || 0
      };

      this.queue.set(id, queueItem);
      logger.debug(`Enqueued message for ${channel}:`, { id, message });
      
      return id;
    } catch (error) {
      logger.error('Error enqueueing message:', error);
      return null;
    }
  }

  async dequeue(id) {
    try {
      const item = this.queue.get(id);
      if (item) {
        this.queue.delete(id);
        logger.debug(`Dequeued message:`, { id });
      }
      return item;
    } catch (error) {
      logger.error('Error dequeuing message:', error);
      return null;
    }
  }

  startProcessor() {
    setInterval(async () => {
      try {
        if (this.processing.size >= this.processingLimit) {
          return;
        }

        const items = Array.from(this.queue.values())
          .sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);

        for (const item of items) {
          if (this.processing.size >= this.processingLimit) break;
          if (this.processing.has(item.id)) continue;
          
          // Check rate limits
          if (this.isRateLimited(item.channel)) continue;

          this.processing.add(item.id);
          this.processMessage(item).catch(error => {
            logger.error('Error processing message:', error);
          });
        }
      } catch (error) {
        logger.error('Error in queue processor:', error);
      }
    }, 100); // Check queue every 100ms
  }

  async processMessage(item) {
    try {
      const { id, channel, message, options } = item;

      // Update rate limit
      this.updateRateLimit(channel);

      // Process message
      await options.handler(channel, message);
      
      // Remove from queue and processing
      this.queue.delete(id);
      this.processing.delete(id);
      
      logger.debug(`Successfully processed message:`, { id, channel });
    } catch (error) {
      logger.error('Error processing message:', error);
      
      // Handle retries
      item.retries++;
      if (item.retries < this.retryLimit) {
        setTimeout(() => {
          this.processing.delete(item.id);
        }, this.retryDelay * item.retries);
      } else {
        // Remove failed message
        this.queue.delete(item.id);
        this.processing.delete(item.id);
        logger.error('Message failed after retries:', item);
      }
    }
  }

  isRateLimited(channel) {
    const limit = this.rateLimits.get(channel);
    if (!limit) return false;
    return Date.now() - limit < 1000; // 1 message per second per channel
  }

  updateRateLimit(channel) {
    this.rateLimits.set(channel, Date.now());
  }

  getQueueStats() {
    return {
      queueSize: this.queue.size,
      processing: this.processing.size,
      rateLimits: Object.fromEntries(this.rateLimits)
    };
  }

  clear() {
    this.queue.clear();
    this.processing.clear();
    this.rateLimits.clear();
  }

  async processQueue() {
    try {
      // Check Twurple's rate limit info
      const rateLimitInfo = await this.chatClient.getRateLimitInfo();
      
      if (rateLimitInfo.isRateLimited) {
        const waitTime = rateLimitInfo.remainingTime;
        logger.debug(`Rate limited, waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return;
      }

      // Process messages with Twurple's methods
      for (const [id, item] of this.queue.entries()) {
        if (this.processing.has(id)) continue;

        try {
          this.processing.add(id);
          
          // Use appropriate Twurple chat method
          if (item.options.announce) {
            await this.chatClient.announce(item.channel, item.message, item.options.announceColor);
          } else if (item.options.reply) {
            await this.chatClient.say(item.channel, item.message, { replyTo: item.options.reply });
          } else {
            await this.chatClient.say(item.channel, item.message);
          }

          this.queue.delete(id);
        } catch (error) {
          this.handleError(error, item);
        } finally {
          this.processing.delete(id);
        }
      }
    } catch (error) {
      logger.error('Error in queue processor:', error);
    }
  }

  handleError(error, item) {
    // Handle Twurple-specific errors
    if (error.message.includes('msg-ratelimit')) {
      // Requeue with backoff
      item.retryAfter = Date.now() + 1000;
      return;
    }
    
    if (error.message.includes('msg-banned')) {
      logger.error(`Bot is banned in channel: ${item.channel}`);
      this.queue.delete(item.id);
      return;
    }

    // Handle other errors
    logger.error('Error sending message:', error);
    if (item.retries < this.retryLimit) {
      item.retries++;
      item.nextRetry = Date.now() + (this.retryDelay * item.retries);
    } else {
      this.queue.delete(item.id);
    }
  }
}

export function setupMessageQueue(chatClient, options = {}) {
  return new MessageQueue(chatClient, options);
}
