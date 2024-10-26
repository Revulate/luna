import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { createLogger } from './loggerConfig.js';

class MessageLogger {
  constructor() {
    this.logger = createLogger('debug');
    this.logger.add(new winston.transports.DailyRotateFile({
      filename: path.join(process.cwd(), 'logs', 'chat-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'info',
      maxFiles: '14d'
    }));
  }

  async logUserMessage(channel, username, message, metadata = {}) {
    try {
      this.logger.debug(`Processing user message from ${username} in ${channel}`);
      this.logger.info('User Message', {
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
    try {
      this.logger.debug(`Processing bot message in ${channel}`);
      this.logger.bot(`[${channel}] ${message}`, {
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
    try {
      this.logger.debug('Processing config log');
      this.logger.config(configData, {
        timestamp: new Date().toISOString(),
        ...context
      });
    } catch (error) {
      this.logger.error('Error logging config:', { error });
    }
  }
}

// Create singleton instance
const messageLogger = new MessageLogger();

// Export both the class and singleton instance
export { MessageLogger, messageLogger };
