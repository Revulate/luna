import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import logger from './logger.js';

class DatabaseManager {
  constructor(db) {
    logger.startOperation('Initializing DatabaseManager');
    this.db = db;
    this.initialized = false;
    logger.debug('DatabaseManager constructor initialized');
  }

  async initialize() {
    // Prevent multiple initializations
    if (this.initialized) {
      logger.debug('Database already initialized, skipping');
      return this;
    }

    try {
      // Update path to use the existing 'databases' folder
      const dbDir = path.join(process.cwd(), 'databases');
      await fs.mkdir(dbDir, { recursive: true });
      
      const dbPath = path.join(dbDir, 'bot.db');
      this.db = new Database(dbPath, {
        verbose: logger.debug.bind(logger),
        fileMustExist: false,
        timeout: 5000,
        readonly: false,
        strictTables: true
      });

      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
      
      await this.createBaseTables();
      await this.createTwitchTables();
      await this.createIndexes();
      await this.checkAndRepairDatabase();
      
      this.initialized = true;
      logger.info('Database initialized successfully');
      return this;
    } catch (error) {
      logger.error('Error initializing database:', error);
      throw error;
    }
  }

  createBaseTables() {
    const tables = [
      // First create the users table (since it's referenced by other tables)
      `CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS channels (
        channel_name TEXT PRIMARY KEY,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        active BOOLEAN DEFAULT TRUE
      )`,

      // Update channel_messages to properly reference users
      `CREATE TABLE IF NOT EXISTS channel_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        user_id TEXT,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        badges TEXT,
        color TEXT,
        is_action BOOLEAN DEFAULT FALSE,
        is_cheer BOOLEAN DEFAULT FALSE,
        bits INTEGER DEFAULT 0,
        emotes TEXT,
        user_info TEXT,
        FOREIGN KEY (channel) REFERENCES channels(channel_name) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
      )`
    ];

    for (const table of tables) {
      this.db.prepare(table).run();
    }
  }

  createTwitchTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS channel_cheers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        bits INTEGER NOT NULL,
        message TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (channel) REFERENCES channels(channel_name)
      )`,
      `CREATE TABLE IF NOT EXISTS channel_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        tier TEXT NOT NULL,
        message TEXT,
        is_gift BOOLEAN DEFAULT FALSE,
        gifter_id TEXT,
        gifter_username TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (channel) REFERENCES channels(channel_name)
      )`,
      `CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT,
        profile_image_url TEXT,
        broadcaster_type TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(username)
      )`,
      `CREATE TABLE IF NOT EXISTS channel_emotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        emote_id TEXT NOT NULL,
        emote_name TEXT NOT NULL,
        emote_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel, emote_id, provider),
        FOREIGN KEY (channel) REFERENCES channels(channel_name)
      )`,
      `CREATE TABLE IF NOT EXISTS message_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        last_seen TIMESTAMP,
        UNIQUE(channel, type),
        FOREIGN KEY (channel) REFERENCES channels(channel_name)
      )`
    ];

    for (const table of tables) {
      this.db.prepare(table).run();
    }
  }

  createIndexes() {
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_user_history_last_seen 
       ON user_history(last_seen)`,
      `CREATE INDEX IF NOT EXISTS idx_channel_messages_timestamp 
       ON channel_messages(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_channel_messages_user 
       ON channel_messages(user_id, channel)`,
      `CREATE INDEX IF NOT EXISTS idx_channel_cheers_user 
       ON channel_cheers(user_id, channel)`,
      `CREATE INDEX IF NOT EXISTS idx_channel_subscriptions_user 
       ON channel_subscriptions(user_id, channel)`,
      `CREATE INDEX IF NOT EXISTS idx_channel_messages_timestamp_channel 
       ON channel_messages(timestamp, channel)`
    ];

    for (const index of indexes) {
      this.db.prepare(index).run();
    }
  }

  prepareStatements() {
    try {
      this.statements = {
        // Message statements
        addMessage: this.db.prepare(`
          INSERT INTO channel_messages (
            channel, user_id, username, message, badges, color,
            is_action, is_cheer, bits, emotes, user_info
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),

        // User statements
        updateUser: this.db.prepare(`
          INSERT INTO users (
            user_id, username, display_name, profile_image_url, 
            broadcaster_type, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            username = excluded.username,
            display_name = excluded.display_name,
            profile_image_url = excluded.profile_image_url,
            broadcaster_type = excluded.broadcaster_type,
            updated_at = CURRENT_TIMESTAMP
        `),

        // Channel statements
        addChannel: this.db.prepare(`
          INSERT INTO channels (channel_name) 
          VALUES (?) 
          ON CONFLICT(channel_name) DO NOTHING
        `),

        // Stats statements
        updateChannelStats: this.db.prepare(`
          INSERT INTO channel_stats (
            channel_name, message_count, user_count, last_active
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(channel_name) DO UPDATE SET
            message_count = message_count + 1,
            user_count = user_count + ?,
            last_active = CURRENT_TIMESTAMP
        `)
      };

      logger.info('Database statements prepared successfully');
    } catch (error) {
      logger.error('Error preparing database statements:', error);
      throw error;
    }
  }

  // Helper methods with proper error handling
  async run(query, params = []) {
    try {
      return this.db.prepare(query).run(params);
    } catch (error) {
      logger.error('Database run error:', { query, params, error });
      throw error;
    }
  }

  async get(query, params = []) {
    try {
      return this.db.prepare(query).get(params);
    } catch (error) {
      logger.error('Database get error:', { query, params, error });
      throw error;
    }
  }

  async all(query, params = []) {
    try {
      return this.db.prepare(query).all(params);
    } catch (error) {
      logger.error('Database all error:', { query, params, error });
      throw error;
    }
  }

  // Transaction wrapper
  transaction(fn) {
    try {
      return this.db.transaction(fn)();
    } catch (error) {
      logger.error('Transaction error:', error);
      throw error;
    }
  }

  async getUserHistory(userId, limit = 10) {
    try {
      const history = await this.db.all(`
        SELECT * FROM channel_messages 
        WHERE user_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `, [userId, limit]);
      
      return history;
    } catch (error) {
      logger.error('Error getting user history:', error);
      return [];
    }
  }

  async updateUserHistory(userId, message, context = {}) {
    try {
      await this.db.run(`
        INSERT INTO channel_messages (
          user_id, message, context, timestamp
        ) VALUES (?, ?, ?, ?)
      `, [
        userId,
        message,
        JSON.stringify(context),
        new Date().toISOString()
      ]);
    } catch (error) {
      logger.error('Error updating user history:', error);
    }
  }

  async setupForeignKeys() {
    try {
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
      
      // Add missing foreign key relationships
      await this.run(`
        ALTER TABLE channel_messages 
        ADD CONSTRAINT fk_channel_messages_users 
        FOREIGN KEY (user_id) REFERENCES users(id) 
        ON DELETE CASCADE
      `);

      await this.run(`
        ALTER TABLE user_history 
        ADD CONSTRAINT fk_user_history_users 
        FOREIGN KEY (user_id) REFERENCES users(id) 
        ON DELETE CASCADE
      `);

      logger.info('Foreign key constraints setup complete');
    } catch (error) {
      logger.error('Error setting up foreign keys:', error);
      throw error;
    }
  }

  async checkAndRepairDatabase() {
    try {
      // Create a default user for system messages if it doesn't exist
      await this.run(`
        INSERT OR IGNORE INTO users (user_id, username, display_name)
        VALUES ('0', 'System', 'System')
      `);

      // Fix any messages with missing user references
      await this.run(`
        UPDATE channel_messages 
        SET user_id = '0' 
        WHERE user_id IS NULL OR user_id NOT IN (SELECT user_id FROM users)
      `);

      logger.info('Database check and repair completed');
    } catch (error) {
      logger.error('Error during database check and repair:', error);
    }
  }
}

// Create a singleton instance
const dbManager = new DatabaseManager();

// Export both the class and the singleton instance
export { DatabaseManager };  // Named export for the class
export default dbManager;    // Default export for the singleton instance

// Add named exports for specific functions
export const getUserHistory = (userId, limit) => dbManager.getUserHistory(userId, limit);
export const updateUserHistory = (userId, message, context) => dbManager.updateUserHistory(userId, message, context);

// Export common query methods
export const runQuery = (query, params) => dbManager.run(query, params);
export const getQuery = (query, params) => dbManager.get(query, params);
export const allQuery = (query, params) => dbManager.all(query, params);
