import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import logger from '../logger.js';

class AFK {
  constructor(bot) {
    this.bot = bot;
    this.dbPath = 'bot.db';
    this.lastAfkMessageTime = new Map();
    this.db = null;
    this.currentlyAfkUsers = new Set();
  }

  async setupDatabase() {
    try {
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS afk (
          user_id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          afk_time REAL NOT NULL,
          reason TEXT,
          return_time REAL,
          active INTEGER NOT NULL DEFAULT 1
        )
      `);

      // Load currently AFK users from the database
      const activeAfkUsers = await this.db.all("SELECT user_id FROM afk WHERE active = 1");
      activeAfkUsers.forEach(user => this.currentlyAfkUsers.add(user.user_id));

      logger.info('AFK database setup complete');
    } catch (error) {
      logger.error(`Error setting up AFK database: ${error}`, error);
    }
  }

  async handleAfkCommand({ channel, user, args, command }) {
    logger.info(`Handling AFK command: ${command} for user ${user.username} (ID: ${user.userId})`);
    const userId = user.userId;
    const username = user.username;
    
    if (!userId || !username) {
      logger.error(`Invalid user object: ${JSON.stringify(user)}`);
      return;
    }

    const baseReason = {
      "afk": "AFK 🚶",
      "sleep": "sleeping 😴",
      "gn": "sleeping 😴",
      "bed": "sleeping 😴",
      "work": "working 💼",
      "food": "eating 🍽️",
      "gaming": "gaming 🎮",
    }[command] || "AFK 🚶";
    const reason = args.join(' ');
    const fullReason = reason ? `${baseReason}: ${reason}` : baseReason;
    const afkTime = Date.now() / 1000;

    try {
      await this.db.run(`
        INSERT OR REPLACE INTO afk (user_id, username, afk_time, reason, return_time, active)
        VALUES (?, ?, ?, ?, NULL, 1)
      `, [userId, username, afkTime, fullReason]);

      this.currentlyAfkUsers.add(userId);

      logger.info(`User ${username} (ID: ${userId}) is now ${fullReason}`);
      await this.bot.say(channel, `@${username} is now ${fullReason}`);
    } catch (error) {
      logger.error(`Error setting user AFK: ${error}`, error);
    }
  }

  async handleRafkCommand({ channel, user }) {
    logger.info(`Handling RAFK command for user ${user.username}`);
    const userId = user.userId;
    const username = user.username;

    try {
      const row = await this.db.get(
        "SELECT afk_time, reason, return_time, active FROM afk WHERE user_id = ?",
        userId
      );

      if (row) {
        const { afk_time, reason: fullReason, return_time, active } = row;
        if (active === 0 && return_time !== null) {
          const timeSinceReturn = Date.now() / 1000 - return_time;
          if (timeSinceReturn <= 5 * 60) { // 5 minutes
            await this.db.run(`
              UPDATE afk
              SET active = 1, return_time = NULL
              WHERE user_id = ?
            `, userId);

            this.currentlyAfkUsers.add(userId);

            const timeSinceAfk = this.formatDurationString(Date.now() / 1000 - afk_time);
            const resumeMessage = `${username} has resumed ${fullReason} (${timeSinceAfk} ago)`;
            logger.info(`User ${resumeMessage}`);
            await this.bot.say(channel, `@${resumeMessage}`);
          } else {
            logger.warning(`User ${username} attempted to resume AFK after more than 5 minutes`);
            await this.bot.say(channel, `@${username}, it's been more than 5 minutes since you returned. Cannot resume AFK.`);
          }
        } else {
          logger.warning(`User ${username} attempted to resume AFK but was not eligible`);
          await this.bot.say(channel, `@${username}, you are not eligible to resume AFK.`);
        }
      } else {
        logger.warning(`User ${username} attempted to resume AFK but had no AFK status`);
        await this.bot.say(channel, `@${username}, you have no AFK status to resume.`);
      }
    } catch (error) {
      logger.error(`Error handling rafk command: ${error}`, error);
    }
  }

  async handleMessage(channel, user, message) {
    if (this.isAfkCommand(message)) return;

    if (this.currentlyAfkUsers.has(user.userId)) {
      logger.info(`Handling return from AFK for user: ${user.username} (ID: ${user.userId})`);
      await this.handleAfkReturn(channel, user.userId, user.username);
    }
  }

  async handleAfkReturn(channel, userId, username) {
    try {
      const row = await this.db.get(
        "SELECT afk_time, reason FROM afk WHERE user_id = ? AND active = 1",
        userId
      );

      if (row) {
        await this.sendAfkReturnMessage(channel, userId, username, row.afk_time, row.reason);
        await this.db.run(`
          UPDATE afk
          SET active = 0, return_time = ?
          WHERE user_id = ?
        `, [Date.now() / 1000, userId]);

        this.currentlyAfkUsers.delete(userId);

        logger.info(`User ${username} has returned from AFK`);
      }
    } catch (error) {
      logger.error(`Error handling AFK return: ${error}`, error);
    }
  }

  async sendAfkReturnMessage(channel, userId, username, afkTime, fullReason) {
    const afkDuration = Date.now() / 1000 - afkTime;
    const timeString = this.formatDurationString(afkDuration);
    const [baseReason, userReason] = fullReason.includes(': ') ? fullReason.split(': ', 2) : [fullReason, null];
    const noLongerAfkMessage = userReason
      ? `@${username} is no longer ${baseReason}: ${userReason} (${timeString} ago)`
      : `@${username} is no longer ${baseReason} (${timeString} ago)`;

    if (this.lastAfkMessageTime.has(userId)) {
      const timeSinceLastMessage = Date.now() / 1000 - this.lastAfkMessageTime.get(userId);
      if (timeSinceLastMessage < 3) { // 3 seconds cooldown
        return;
      }
    }

    await this.bot.say(channel, noLongerAfkMessage);
    this.lastAfkMessageTime.set(userId, Date.now() / 1000);
  }

  isAfkCommand(message) {
    const command = message.trim().toLowerCase().split(' ')[0];
    return ['#afk', '#sleep', '#gn', '#work', '#food', '#gaming', '#bed', '#rafk'].includes(command);
  }

  formatDurationString(duration) {
    const days = Math.floor(duration / 86400);
    const hours = Math.floor((duration % 86400) / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.floor(duration % 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
  }
}

let afkInstance = null;
let isSetupComplete = false;

export function setupAfk(bot) {
  if (!afkInstance) {
    logger.info('Setting up AFK handlers');
    afkInstance = new AFK(bot);
    afkInstance.setupDatabase().then(() => {
      if (!isSetupComplete) {
        isSetupComplete = true;
        logger.info('AFK handlers set up');
      }
    });
  }
  return {
    handleAfkCommand: (context) => afkInstance.handleAfkCommand(context),
    handleRafkCommand: (context) => afkInstance.handleRafkCommand(context),
    handleMessage: (channel, user, message) => afkInstance.handleMessage(channel, user, message),
  };
}
