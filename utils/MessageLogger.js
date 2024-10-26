import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { EventEmitter } from 'events';
import { createLogger } from './loggerConfig.js';
import { serviceRegistry } from './serviceRegistry.js';

class MessageLogger extends EventEmitter {
  constructor() {
    super(); // Initialize EventEmitter
    this.initialized = false;
    this.logger = null;
  }

  async initialize() {
    if (this.initialized) {
      return this;
    }

    try {
      this.logger = createLogger('debug');
      this.logger.add(new winston.transports.DailyRotateFile({
        filename: path.join(process.cwd(), 'logs', 'chat-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'info',
        maxFiles: '14d'
      }));

      // Get database service
      this.db = serviceRegistry.getService('database');
      if (!this.db) {
        throw new Error('Database service not found');
      }

      this.initialized = true;
      return this;
    } catch (error) {
      this.logger?.error('Error initializing MessageLogger:', error);
      throw error;
    }
  }

  async logUserMessage(channel, username, message, metadata = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      this.logger.debug(`Processing user message from ${username} in ${channel}`);
      
      // Log to Winston
      this.logger.info('User Message', {
        type: 'user',
        channel,
        username,
        message,
        timestamp: new Date().toISOString(),
        ...metadata
      });

      // Log to database if available
      if (this.db) {
        await this.db.logMessage(channel, username, message, metadata.userId || '0', metadata);
      }

      // Emit message event
      this.emit('message', {
        type: 'user',
        channel,
        username,
        message,
        timestamp: new Date().toISOString(),
        ...metadata
      });
    } catch (error) {
      this.logger.error('Error logging user message:', { error, channel, username });
    }
  }

  async logBotMessage(channel, message, metadata = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      this.logger.debug(`Processing bot message in ${channel}`);
      
      // Log to Winston
      this.logger.info('Bot Message', {
        type: 'bot',
        channel,
        message,
        timestamp: new Date().toISOString(),
        ...metadata
      });

      // Log to database if available
      if (this.db) {
        await this.db.logMessage(channel, 'BOT', message, '0', metadata);
      }

      // Emit message event
      this.emit('message', {
        type: 'bot',
        channel,
        message,
        timestamp: new Date().toISOString(),
        ...metadata
      });
    } catch (error) {
      this.logger.error('Error logging bot message:', { error, channel });
    }
  }

  async logEvent(eventType, data = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      this.logger.debug(`Processing event: ${eventType}`);
      this.logger.info('Event', {
        type: eventType,
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      this.logger.error('Error logging event:', { error, eventType });
    }
  }

  async logError(error, context = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      this.logger.debug('Processing error log');
      this.logger.error('Error', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        ...context
      });
    } catch (err) {
      console.error('Error in logError:', err);
      // Fallback to console if logger fails
    }
  }

  async logConfig(configData, context = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      this.logger.debug('Processing config log');
      this.logger.info('Config', {
        config: configData,
        timestamp: new Date().toISOString(),
        ...context
      });
    } catch (error) {
      this.logger.error('Error logging config:', { error });
    }
  }

  async getUserMessages(channel, username, limit = 100) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (!this.db) {
        throw new Error('Database not available');
      }
      return await this.db.getUserMessages(channel, username, limit);
    } catch (error) {
      this.logger.error('Error getting user messages:', { error, channel, username });
      return [];
    }
  }
}

// Create singleton instance
const messageLogger = new MessageLogger();

// Register with service registry
serviceRegistry.register('messageLogger', messageLogger);

// Export both the class and singleton instance
export { MessageLogger };
export default messageLogger;
