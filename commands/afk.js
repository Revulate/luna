import { runQuery, getQuery, allQuery } from '../database.js';
import logger from '../logger.js';
import Database from 'better-sqlite3';
import path from 'path';

class AFK {
  constructor(chatClient) {
    this.chatClient = chatClient;
    this.db = null;
    this.statements = {};
    this.initialized = false;
    this.currentlyAfkUsers = new Map();
    this.reasonEmojis = {
      afk: '•',
      sleep: '•',
      gn: '•',
      work: '•',
      food: '•',
      gaming: '•',
      bed: '•',
      eating: '•',
      working: '•',
      bedge: '•'
    };
    this.statusMessages = {
      afk: 'AFK',
      sleep: 'sleeping',
      gn: 'sleeping',
      work: 'working',
      food: 'eating',
      gaming: 'gaming',
      bed: 'sleeping',
      eating: 'eating',
      working: 'working',
      bedge: 'sleeping'
    };
  }

  getUserKey(userId, channel) {
    return `${userId}-${channel}`;
  }

  async handleAfkCommand(context) {
    const { channel, user, args, command = 'afk' } = context;
    if (!this.initialized) {
      logger.error('AFK module not initialized');
      return;
    }

    // Fix user ID extraction from Twurple context
    const userId = user.id || user.userId || context.rawMessage?.userInfo?.userId;
    const username = user.username || user.name || user.displayName;

    if (!userId) {
      logger.error('No user ID found in context:', { user, rawMessage: context.rawMessage });
      return;
    }

    const cleanChannel = channel.replace('#', '');

    try {
      // First check if user is already AFK
      const existingAfk = this.statements.getActiveAfk.get(userId, cleanChannel);
      if (existingAfk) {
        await context.say(`@${username}, you are already AFK: ${existingAfk.reason}`);
        return;
      }

      const emoji = this.reasonEmojis[command];
      const baseReason = this.statusMessages[command] || 'AFK';
      const reason = args.length > 0 ? args.join(' ') : '';
      const fullReason = reason ? `${baseReason} ${emoji} ${reason}` : baseReason;
      const timestamp = Math.floor(Date.now() / 1000);

      // Begin transaction
      this.db.transaction(() => {
        this.statements.deleteAfk.run(userId, cleanChannel);
        this.statements.insertAfk.run(
          userId,
          cleanChannel,
          username,
          timestamp,
          fullReason
        );
      })();

      // Update cache
      const userKey = this.getUserKey(userId, cleanChannel);
      this.currentlyAfkUsers.set(userKey, {
        userId,
        channel: cleanChannel,
        username,
        afkTime: timestamp,
        reason: fullReason,
        active: 1
      });

      await context.say(`@${username} is now ${fullReason}`);
    } catch (error) {
      logger.error(`Error in AFK command: ${error}`);
      await this.clearAfkStatus(userId, cleanChannel);
    }
  }

  async handleRafkCommand(context) {
    if (!this.initialized) {
      logger.error('AFK module not initialized');
      return;
    }

    // Ensure user ID is available
    const userId = context.user?.userId || context.rawMessage?.userInfo?.userId;
    if (!userId) {
      logger.error('No user ID found in context:', { user: context.user });
      await this.chatClient.say(context.channel, 
        `@${context.user.username}, an error occurred: User ID is missing.`);
      return;
    }

    const cleanChannel = context.channel.replace('#', '');
    const cutoffTime = Math.floor(Date.now() / 1000) - (30 * 60); // 30 minutes ago

    try {
      // Check for recent AFK status
      const recentAfk = this.statements.getRecentAfk.get(userId, cleanChannel, cutoffTime);
      
      if (!recentAfk) {
        await this.chatClient.say(context.channel, 
          `@${context.user.username}, you don't have any recent AFK status to resume.`);
        return;
      }

      // Set new AFK with previous reason
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Begin transaction
      this.db.transaction(() => {
        // Delete any existing AFK status first
        this.statements.deleteAfk.run(userId, cleanChannel);

        // Insert new AFK status with the previous reason
        this.statements.insertAfk.run(
          userId,
          cleanChannel,
          context.user.username,
          timestamp,
          recentAfk.reason // Use the original reason without modification
        );
      })();

      // Update cache
      const userKey = this.getUserKey(userId, cleanChannel);
      this.currentlyAfkUsers.set(userKey, {
        userId,
        channel: cleanChannel,
        username: context.user.username,
        afkTime: timestamp,
        reason: recentAfk.reason,
        active: 1
      });

      await this.chatClient.say(context.channel, `@${context.user.username} is now ${recentAfk.reason}`);
    } catch (error) {
      logger.error('Error in RAFK command:', error);
      await this.chatClient.say(context.channel, 
        `@${context.user.username}, an error occurred while processing your command.`);
    }
  }

  async getActiveAfkStatus(userId, channel) {
    try {
      return this.statements.getActiveAfk.get(userId.toString(), channel);
    } catch (error) {
      logger.error(`Error getting active AFK status: ${error}`);
      return null;
    }
  }

  formatDurationString(duration) {
    const units = [
      { value: 86400, label: 'd' },
      { value: 3600, label: 'h' },
      { value: 60, label: 'm' },
      { value: 1, label: 's' }
    ];
    
    let parts = [];
    let remaining = Math.floor(duration);
    
    for (const { value, label } of units) {
      if (remaining >= value) {
        const count = Math.floor(remaining / value);
        parts.push(`${count}${label}`);
        remaining %= value;
        if (parts.length === 2) break;
      }
    }
    
    return parts.length ? parts.join(' ') : '0s';
  }

  async clearStaleAfkStatuses(cutoffTime) {
    try {
      // Convert timestamps to integers for SQLite
      const now = Math.floor(Date.now() / 1000);
      await runQuery(`
        UPDATE afk_status 
        SET active = 0, 
            return_time = ?
        WHERE active = 1 
        AND afk_time < ?
      `, [now, parseInt(cutoffTime)]);

      // Also clear from cache
      for (const [key, user] of this.currentlyAfkUsers.entries()) {
        if (user.afkTime < cutoffTime) {
          this.currentlyAfkUsers.delete(key);
        }
      }
    } catch (error) {
      logger.error(`Error clearing stale AFK statuses: ${error}`);
    }
  }

  async setupDatabase() {
    try {
      const dbPath = path.join(process.cwd(), 'databases', 'afk.db');
      this.db = new Database(dbPath);

      // Create tables with proper constraints
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS afk_status (
          user_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          username TEXT NOT NULL,
          afk_time INTEGER NOT NULL,
          return_time INTEGER,
          reason TEXT,
          active INTEGER DEFAULT 1,
          PRIMARY KEY (user_id, channel)
        );
        CREATE INDEX IF NOT EXISTS idx_active_afk ON afk_status(user_id, channel, active);
        CREATE INDEX IF NOT EXISTS idx_return_time ON afk_status(return_time);
      `);

      // Prepare all statements at once
      this.statements = {
        getActiveAfk: this.db.prepare(`
          SELECT * FROM afk_status
          WHERE user_id = ? AND channel = ? AND active = 1
        `),
        getRecentAfk: this.db.prepare(`
          SELECT * FROM afk_status
          WHERE user_id = ?
          AND channel = ?
          AND active = 0
          AND return_time > ?
          ORDER BY return_time DESC
          LIMIT 1
        `),
        insertAfk: this.db.prepare(`
          INSERT OR REPLACE INTO afk_status (user_id, channel, username, afk_time, reason, active)
          VALUES (?, ?, ?, ?, ?, 1)
        `),
        updateAfk: this.db.prepare(`
          UPDATE afk_status
          SET active = 0, return_time = ?
          WHERE user_id = ? AND channel = ? AND active = 1
        `),
        deleteAfk: this.db.prepare(`
          DELETE FROM afk_status
          WHERE user_id = ? AND channel = ?
        `)
      };

      // Set up message handler using Twurple's chat client
      if (this.chatClient) {
        this.chatClient.onMessage(async (channel, user, message, msg) => {
          if (!message.startsWith('#')) {
            await this.handleUserMessage(channel, user, message, msg);
          }
        });
      }

      this.initialized = true;
      logger.info('AFK module database setup complete');
    } catch (error) {
      logger.error('Error setting up AFK database:', error);
      throw error;
    }
  }

  async handleUserMessage(channel, user, message, msg) {
    if (!this.initialized || !msg.userInfo) return;

    try {
      const userId = msg.userInfo.userId.toString();
      const cleanChannel = channel.replace('#', '');

      // Check for active AFK status
      const activeAfk = this.statements.getActiveAfk.get(userId, cleanChannel);
      if (activeAfk) {
        const returnTime = Math.floor(Date.now() / 1000);
        const duration = this.formatDurationString(returnTime - activeAfk.afk_time);

        // Update database first
        this.statements.updateAfk.run(returnTime, userId, cleanChannel);

        // Remove from cache
        const userKey = this.getUserKey(userId, cleanChannel);
        this.currentlyAfkUsers.delete(userKey);

        // Extract base status from the stored reason
        const storedReason = activeAfk.reason;
        const hasCustomReason = storedReason.includes('•');
        const returnMessage = hasCustomReason 
          ? `@${user} is no longer ${storedReason} (was away for ${duration})`
          : `@${user} is no longer ${storedReason} (was away for ${duration})`;

        await this.chatClient.say(channel, returnMessage);
      }
    } catch (error) {
      logger.error(`Error handling message for AFK: ${error}`);
    }
  }

  async clearAfkStatus(userId, channel, returnTime = null) {
    const cleanChannel = channel.replace('#', '');
    try {
      if (returnTime) {
        this.statements.updateAfk.run(
          Math.floor(returnTime), 
          userId.toString(), 
          cleanChannel
        );
      } else {
        this.statements.deleteAfk.run(userId.toString(), cleanChannel);
      }

      const userKey = this.getUserKey(userId, cleanChannel);
      this.currentlyAfkUsers.delete(userKey);
      
      logger.debug(`Cleared AFK status for user ${userId} in ${cleanChannel}`);
    } catch (error) {
      logger.error(`Error clearing AFK status: ${error}`);
    }
  }
}

// Export setup function
export async function setupAfk(chatClient) {
  try {
    const afk = new AFK(chatClient);
    await afk.setupDatabase();

    return {
      commands: {
        afk: async (context) => await afk.handleAfkCommand(context),
        sleep: async (context) => await afk.handleAfkCommand({ ...context, command: 'sleep' }),
        gn: async (context) => await afk.handleAfkCommand({ ...context, command: 'gn' }),
        work: async (context) => await afk.handleAfkCommand({ ...context, command: 'work' }),
        working: async (context) => await afk.handleAfkCommand({ ...context, command: 'working' }),
        food: async (context) => await afk.handleAfkCommand({ ...context, command: 'food' }),
        eating: async (context) => await afk.handleAfkCommand({ ...context, command: 'eating' }),
        gaming: async (context) => await afk.handleAfkCommand({ ...context, command: 'gaming' }),
        bed: async (context) => await afk.handleAfkCommand({ ...context, command: 'bed' }),
        bedge: async (context) => await afk.handleAfkCommand({ ...context, command: 'bedge' }),
        rafk: async (context) => await afk.handleRafkCommand(context),
        clearafk: async (context) => await afk.clearAfkStatus(context.user.id, context.channel)
      }
    };
  } catch (error) {
    logger.error(`Error setting up AFK module: ${error}`);
    throw error;
  }
}
