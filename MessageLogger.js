import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import dbManager from './database.js';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MessageLogger {
  constructor() {
    this.logger = null;
    this.messageCache = new Map();
    this.listeners = new Set();
    this.dbPath = path.join(process.cwd(), 'data', 'bot.db'); // Fix database path
  }

  async initialize() {
    try {
      // Create logs directory if it doesn't exist
      const logsDir = path.join(__dirname, 'logs');
      await fs.mkdir(logsDir, { recursive: true });

      // Configure Winston logger
      this.logger = winston.createLogger({
        level: 'debug',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
        transports: [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.timestamp(),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                return `${timestamp} [${level.toUpperCase()}] ${message} ${
                  Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
                }`;
              })
            )
          }),
          new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'bot-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d'
          }),
          new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
            level: 'error'
          })
        ]
      });

      // Initialize database connection
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

  async logMessage(channel, messageData) {
    try {
      // First ensure channel exists in channels table
      await dbManager.run(`
        INSERT OR IGNORE INTO channels (channel_name)
        VALUES (?)
      `, [channel.toLowerCase()]);

      // Then log the message
      const formattedMessage = {
        channel: channel.toLowerCase(),
        username: messageData.username,
        user_id: messageData.userId,
        message: messageData.message,
        timestamp: new Date().toISOString(),
        badges: JSON.stringify(messageData.badges || {}),
        color: messageData.color || '#FFFFFF'
      };

      await dbManager.run(`
        INSERT INTO channel_messages (
          channel, username, user_id, message, timestamp, badges, color
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        formattedMessage.channel,
        formattedMessage.username,
        formattedMessage.user_id,
        formattedMessage.message,
        formattedMessage.timestamp,
        formattedMessage.badges,
        formattedMessage.color
      ]);

      // Update cache and notify listeners
      if (!this.messageCache.has(channel)) {
        this.messageCache.set(channel, []);
      }
      const channelCache = this.messageCache.get(channel);
      channelCache.push(formattedMessage);
      if (channelCache.length > 100) channelCache.shift();

      this.notifyListeners(formattedMessage);

    } catch (error) {
      this.logger.error('Error logging message:', {
        error: error.message,
        channel,
        messageData
      });
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

// Create and export a singleton instance
const messageLogger = new MessageLogger();
export default messageLogger;
