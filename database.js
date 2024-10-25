import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import logger from './logger.js';

class DatabaseManager {
  constructor() {
    this.db = null;
    this.statements = {};
  }

  async initialize() {
    try {
      const dbDir = path.join(process.cwd(), 'data');
      await fs.mkdir(dbDir, { recursive: true });
      
      const dbPath = path.join(dbDir, 'bot.db');
      this.db = new Database(dbPath, {
        verbose: logger.debug.bind(logger),
        fileMustExist: false,
        timeout: 5000,
        readonly: false,
        strictTables: true
      });

      // Enable WAL mode and other optimizations
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('foreign_keys = ON');
      
      // Begin transaction for table creation
      this.db.prepare('BEGIN').run();

      // Create tables
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS channels (
          channel_name TEXT PRIMARY KEY,
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          active BOOLEAN DEFAULT TRUE
        );
      `).run();

      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS channel_stats (
          channel_name TEXT PRIMARY KEY,
          message_count INTEGER DEFAULT 0,
          user_count INTEGER DEFAULT 0,
          last_active TIMESTAMP,
          FOREIGN KEY (channel_name) REFERENCES channels(channel_name)
        );
      `).run();

      // Add channel_messages table
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS channel_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          message TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          badges TEXT,
          color TEXT,
          FOREIGN KEY (channel) REFERENCES channels(channel_name)
        );
      `).run();

      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS user_history (
          user_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          last_message TEXT,
          last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          message_count INTEGER DEFAULT 0,
          PRIMARY KEY (user_id, channel)
        );
      `).run();

      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS queries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query TEXT NOT NULL,
          params TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `).run();

      // Create indexes
      this.db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_user_history_last_seen
        ON user_history(last_seen);
      `).run();

      this.db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_channel_messages_timestamp
        ON channel_messages(timestamp);
      `).run();

      this.db.prepare('COMMIT').run();

      logger.debug('Database initialized successfully');
      
      // Initialize prepared statements
      this.prepareStatements();
      
      return this;
    } catch (error) {
      logger.error('Error initializing database:', error);
      throw error;
    }
  }

  prepareStatements() {
    // Add prepared statements for channel_messages
    this.statements = {
      ...this.statements,
      addMessage: this.db.prepare(`
        INSERT INTO channel_messages (channel, user_id, username, message, badges, color)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getChannelMessages: this.db.prepare(`
        SELECT * FROM channel_messages 
        WHERE channel = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `),
      getGlobalStats: this.db.prepare(`
        SELECT COUNT(*) as total_messages,
               COUNT(DISTINCT user_id) as unique_users,
               COUNT(DISTINCT channel) as active_channels
        FROM channel_messages
      `)
    };
    
    // Add these new prepared statements
    this.statements.getUserHistory = this.db.prepare(`
        SELECT * FROM user_history 
        WHERE user_id = ? AND channel = ?
    `);
    this.statements.updateUserHistory = this.db.prepare(`
        INSERT INTO user_history (user_id, channel, last_message, message_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(user_id, channel) 
        DO UPDATE SET 
            last_message = ?,
            last_seen = CURRENT_TIMESTAMP,
            message_count = message_count + 1
        WHERE user_id = ? AND channel = ?
    `);
  }

  // Helper methods with proper transaction handling
  run(query, params = []) {
    return this.db.prepare(query).run(params);
  }

  get(query, params = []) {
    return this.db.prepare(query).get(params);
  }

  all(query, params = []) {
    return this.db.prepare(query).all(params);
  }

  // User history methods
  getUserHistory(userId, channel) {
    return this.statements.getUserHistory.get(userId, channel);
  }

  updateUserHistory(userId, channel, lastMessage) {
    return this.db.transaction(() => {
      return this.statements.updateUserHistory.run(
        userId, channel, lastMessage, userId, channel
      );
    })();
  }

  // Channel methods
  getActiveChannels() {
    return this.statements.getActiveChannels.all();
  }

  addChannel(channel) {
    return this.statements.addChannel.run(channel);
  }

  removeChannel(channel) {
    return this.statements.removeChannel.run(channel);
  }
}

// Export singleton instance
const dbManager = new DatabaseManager();
export default dbManager;

// Export common query methods
export const runQuery = (query, params) => dbManager.run(query, params);
export const getQuery = (query, params) => dbManager.get(query, params);
export const allQuery = (query, params) => dbManager.all(query, params);

// Export user history methods
export const getUserHistory = (userId, channel) => dbManager.getUserHistory(userId, channel);
export const updateUserHistory = (userId, channel, lastMessage) => 
  dbManager.updateUserHistory(userId, channel, lastMessage);
