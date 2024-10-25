import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import dbManager from './database.js';
import fs from 'fs/promises';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MessageLogger {
  constructor() {
    this.logger = null;
    this.messageCache = new Map();
    this.listeners = new Set();
    this.dbPath = path.join(process.cwd(), 'data', 'bot.db');
  }

  async initialize() {
    try {
      const logsDir = path.join(__dirname, 'logs');
      await fs.mkdir(logsDir, { recursive: true });

      // Time formatter
      const timeFormat = {
        format: 'h:mm:ss A'
      };

      // Date formatter
      const dateFormat = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      };

      let currentDate = new Date().toLocaleDateString('en-US', dateFormat);

      // Helper function to wrap long messages
      function wrapMessage(message, maxLength = 100) {
        if (message.length <= maxLength) return message;
        
        const words = message.split(' ');
        let lines = [];
        let currentLine = '';
        
        words.forEach(word => {
          if ((currentLine + ' ' + word).length <= maxLength) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          }
        });
        
        if (currentLine) lines.push(currentLine);
        // Match padding with logger.js (20 spaces)
        const padding = '                    '; // 20 spaces to align with message start
        return lines.join('\n' + padding);
      }

      // Custom format for chat messages
      const levelColors = {
        error: 'redBright',
        warn: 'yellowBright',
        info: 'cyanBright',
        debug: 'blueBright',
        chat: 'magentaBright'
      };

      const chatFormat = winston.format.printf(({ timestamp, level, message, channel, username, content }) => {
        const now = new Date(timestamp);
        const time = now.toLocaleTimeString('en-US', timeFormat);
        const grayTime = chalk.gray(time);
        
        // Keep level indicator white
        const levelIndicator = chalk.white(`[${level.toUpperCase()}]`);
        
        let coloredMessage;
        // Check if it's a chat message by looking for the "Chat:" prefix
        if (message.startsWith('Chat:')) {
          coloredMessage = chalk.magentaBright(message);
        } else {
          switch(level) {
            case 'error':
              coloredMessage = chalk.redBright(message);
              break;
            case 'warn':
              coloredMessage = chalk.yellowBright(message);
              break;
            case 'info':
              coloredMessage = chalk.cyanBright(message);
              break;
            case 'debug':
              coloredMessage = chalk.blueBright(message);
              break;
            default:
              coloredMessage = message;
          }
        }
        
        // Check if we've crossed to a new day
        const newDate = now.toLocaleDateString('en-US', dateFormat);
        if (newDate !== currentDate) {
          currentDate = newDate;
          return `\n${currentDate}\n${grayTime} ${levelIndicator} ${wrapMessage(coloredMessage)}`;
        }
        
        return `${grayTime} ${levelIndicator} ${wrapMessage(coloredMessage)}`;
      });

      // Update colors in initialize() to use standard Winston color names
      const colors = {
        levels: {
          error: 0,
          warn: 1,
          info: 2,
          debug: 3,
          chat: 4
        },
        colors: {
          error: 'redBright',
          warn: 'yellowBright',
          info: 'cyanBright',
          debug: 'blueBright',
          chat: 'magentaBright'
        }
      };

      winston.addColors(colors.colors);

      this.logger = winston.createLogger({
        levels: colors.levels,
        level: process.env.LOG_LEVEL || 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
        transports: [
          // Console transport for chat messages
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.timestamp(),
              chatFormat
            )
          }),
          // File transport for detailed logging
          new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'chat-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json()
            )
          })
        ]
      });

      await dbManager.initialize();
      this.logger.info('MessageLogger initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize MessageLogger:', error);
      throw error;
    }
  }

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners(messageData) {
    this.listeners.forEach(callback => callback(messageData));
  }

  async logMessage(channel, messageData, silent = false) {
    try {
      // Log to database
      await dbManager.run(`
        INSERT INTO channel_messages (
          channel, username, user_id, message, timestamp, badges, color
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        channel.toLowerCase(),
        messageData.username,
        messageData.userId,
        messageData.message,
        messageData.timestamp,
        JSON.stringify(messageData.badges || {}),
        messageData.color || '#FFFFFF'
      ]);

      // Only log to console if not silent
      if (!silent) {
        this.logger.info(`Chat: #${channel} @${messageData.username}: ${messageData.message}`);
      }

      // Update cache and notify listeners
      if (!this.messageCache.has(channel)) {
        this.messageCache.set(channel, []);
      }
      const channelCache = this.messageCache.get(channel);
      channelCache.push(messageData);
      if (channelCache.length > 100) channelCache.shift();

      this.notifyListeners(messageData);

    } catch (error) {
      this.logger.error('Error logging message:', error);
    }
  }

  async getChannelMessages(channel, limit = 100) {
    try {
      return await dbManager.all(`
        SELECT *
        FROM channel_messages
        WHERE channel = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `, [channel.toLowerCase(), limit]);
    } catch (error) {
      this.logger.error('Error fetching channel messages:', {
        error: error.message,
        channel
      });
      return [];
    }
  }

  async getChannelStats(channel) {
    try {
      return await dbManager.get(`
        SELECT 
          COUNT(*) as messageCount,
          COUNT(DISTINCT user_id) as uniqueUsers,
          MIN(timestamp) as firstMessage,
          MAX(timestamp) as lastMessage
        FROM channel_messages
        WHERE channel = ?
      `, [channel.toLowerCase()]);
    } catch (error) {
      this.logger.error('Error fetching channel stats:', {
        error: error.message,
        channel
      });
      return null;
    }
  }

  async getRecentLogs(limit = 100, level = 'all') {
    try {
      // Since Winston doesn't have getRecentLogs, we'll read from the log file directly
      const logs = await dbManager.all(`
        SELECT timestamp, level, message, metadata
        FROM logs
        ORDER BY timestamp DESC
        LIMIT ?
      `, [limit]);
      
      if (level === 'all') {
        return logs;
      }
      return logs.filter(log => log.level === level);
    } catch (error) {
      this.logger.error('Error getting recent logs:', error);
      return [];
    }
  }

  async getGlobalStats() {
    try {
      const stats = await dbManager.get(`
        SELECT 
          COUNT(*) as totalMessages,
          COUNT(DISTINCT user_id) as uniqueUsers,
          COUNT(DISTINCT channel) as channelCount,
          MIN(timestamp) as firstMessage,
          MAX(timestamp) as lastMessage
        FROM channel_messages
      `);

      const hourAgo = new Date(Date.now() - 3600000);
      const recentMessages = await dbManager.get(`
        SELECT COUNT(*) as count
        FROM channel_messages
        WHERE timestamp > ?
      `, [hourAgo.toISOString()]);

      const dbSize = await this.getDatabaseSize();

      return {
        totalMessages: stats.totalMessages || 0,
        uniqueUsers: stats.uniqueUsers || 0,
        channelCount: stats.channelCount || 0,
        messageRate: Math.round((recentMessages.count || 0) / 60),
        firstMessage: stats.firstMessage,
        lastMessage: stats.lastMessage,
        dbSize
      };
    } catch (error) {
      this.logger.error('Error getting global stats:', error);
      return {
        totalMessages: 0,
        uniqueUsers: 0,
        channelCount: 0,
        messageRate: 0,
        dbSize: 0
      };
    }
  }

  async getMessageCount() {
    try {
      const result = await dbManager.get(`
        SELECT COUNT(*) as count
        FROM channel_messages
      `);
      return result.count;
    } catch (error) {
      this.logger.error('Error getting message count:', error);
      return 0;
    }
  }

  async getUniqueUserCount() {
    try {
      const result = await dbManager.get(`
        SELECT COUNT(DISTINCT user_id) as count
        FROM channel_messages
        WHERE user_id IS NOT NULL
      `);
      return result.count;
    } catch (error) {
      this.logger.error('Error getting unique user count:', error);
      return 0;
    }
  }

  async getChannelMessageStats(channel, timeframe = '24h') {
    try {
      const timeCondition = timeframe === 'all' ? '' : 
        `AND timestamp > datetime('now', '-${timeframe}')`;

      const stats = await dbManager.get(`
        SELECT 
          COUNT(*) as messageCount,
          COUNT(DISTINCT user_id) as uniqueUsers,
          MIN(timestamp) as firstMessage,
          MAX(timestamp) as lastMessage
        FROM channel_messages
        WHERE channel = ? ${timeCondition}
      `, [channel.toLowerCase()]);

      return stats;
    } catch (error) {
      this.logger.error('Error fetching channel message stats:', error);
      return null;
    }
  }

  getLogger() {
    return this.logger;
  }

  async getDatabaseSize() {
    try {
      let totalSize = 0;
      
      // Get main database file size
      const mainDbStats = await fs.stat(this.dbPath);
      totalSize += mainDbStats.size;
      this.logger.debug(`Main DB size: ${mainDbStats.size} bytes`);

      // Get WAL file size
      try {
        const walStats = await fs.stat(`${this.dbPath}-wal`);
        totalSize += walStats.size;
        this.logger.debug(`WAL size: ${walStats.size} bytes`);
      } catch (err) {
        this.logger.debug('No WAL file found');
      }
      
      // Get SHM file size
      try {
        const shmStats = await fs.stat(`${this.dbPath}-shm`);
        totalSize += shmStats.size;
        this.logger.debug(`SHM size: ${shmStats.size} bytes`);
      } catch (err) {
        this.logger.debug('No SHM file found');
      }

      this.logger.debug(`Total database size: ${totalSize} bytes`);
      return totalSize;
    } catch (error) {
      this.logger.error('Error getting database size:', error);
      return 0;
    }
  }
}

export default new MessageLogger();
