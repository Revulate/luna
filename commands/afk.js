import Database from 'better-sqlite3';
import logger from '../logger.js';

class AFK {
  constructor(bot) {
    this.bot = bot;
    this.dbPath = 'bot.db';
    this.lastAfkMessageTime = new Map();
    this.db = null;
    this.currentlyAfkUsers = new Map(); // Changed to Map to store more info
    this.preparedStatements = {};
    this.afkCommands = new Set(['#afk', '#sleep', '#gn', '#work', '#food', '#gaming', '#bed', '#rafk']);
  }

  async setupDatabase() {
    const start = process.hrtime();
    try {
      this.db = new Database(this.dbPath, { verbose: logger.debug });

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS afk (
          user_id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          afk_time REAL NOT NULL,
          reason TEXT,
          return_time REAL,
          active INTEGER NOT NULL DEFAULT 1
        )
      `);

      // Prepare statements
      this.preparedStatements = {
        insertAfk: this.db.prepare(`
          INSERT OR REPLACE INTO afk (user_id, username, afk_time, reason, return_time, active)
          VALUES (?, ?, ?, ?, NULL, 1)
        `),
        selectAfk: this.db.prepare("SELECT * FROM afk WHERE user_id = ?"),
        updateAfkReturn: this.db.prepare("UPDATE afk SET active = 0, return_time = ? WHERE user_id = ?"),
        loadActiveAfkUsers: this.db.prepare("SELECT * FROM afk WHERE active = 1")
      };

      // Load currently AFK users from the database
      const activeAfkUsers = this.preparedStatements.loadActiveAfkUsers.all();
      activeAfkUsers.forEach(user => this.currentlyAfkUsers.set(user.user_id, user));

      const end = process.hrtime(start);
      logger.info(`AFK database setup complete in ${end[0]}s ${end[1] / 1000000}ms`);
    } catch (error) {
      const end = process.hrtime(start);
      logger.error(`Error setting up AFK database (took ${end[0]}s ${end[1] / 1000000}ms): ${error}`);
    }
  }

  handleAfkCommand({ channel, user, args, command }) {
    const start = process.hrtime();
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
      this.preparedStatements.insertAfk.run(userId, username, afkTime, fullReason);
      this.currentlyAfkUsers.set(userId, { user_id: userId, username, afk_time: afkTime, reason: fullReason, active: 1 });

      this.bot.say(channel, `@${username} is now ${fullReason}`);
      
      const end = process.hrtime(start);
      logger.debug(`Total AFK command handling took ${end[0]}s ${end[1] / 1000000}ms`);
    } catch (error) {
      const end = process.hrtime(start);
      logger.error(`Error setting user AFK (took ${end[0]}s ${end[1] / 1000000}ms): ${error}`);
    }
  }

  handleRafkCommand({ channel, user }) {
    const start = process.hrtime();
    const userId = user.userId;
    const username = user.username;

    try {
      const afkInfo = this.currentlyAfkUsers.get(userId) || this.preparedStatements.selectAfk.get(userId);

      if (afkInfo) {
        const { afk_time, reason: fullReason, return_time, active } = afkInfo;
        if (active === 0) {
          const timeSinceReturn = Date.now() / 1000 - (return_time || 0);
          if (timeSinceReturn <= 5 * 60) { // 5 minutes
            this.preparedStatements.insertAfk.run(userId, username, afk_time, fullReason);
            this.currentlyAfkUsers.set(userId, { ...afkInfo, active: 1, return_time: null });

            const timeSinceAfk = this.formatDurationString(Date.now() / 1000 - afk_time);
            const resumeMessage = `${username} has resumed ${fullReason} (${timeSinceAfk} ago)`;
            this.bot.say(channel, `@${resumeMessage}`);
          } else {
            this.bot.say(channel, `@${username}, it's been more than 5 minutes since you returned. Cannot resume AFK.`);
          }
        } else {
          this.bot.say(channel, `@${username}, you are already AFK.`);
        }
      } else {
        this.bot.say(channel, `@${username}, you have no AFK status to resume.`);
      }
      
      const end = process.hrtime(start);
      logger.debug(`Total RAFK command handling took ${end[0]}s ${end[1] / 1000000}ms`);
    } catch (error) {
      const end = process.hrtime(start);
      logger.error(`Error handling rafk command (took ${end[0]}s ${end[1] / 1000000}ms): ${error}`);
    }
  }

  handleMessage(channel, user, message) {
    if (this.isAfkCommand(message)) return;

    if (this.currentlyAfkUsers.has(user.userId)) {
      this.handleAfkReturn(channel, user.userId, user.username);
    }
  }

  handleAfkReturn(channel, userId, username) {
    const start = process.hrtime();
    try {
      const afkInfo = this.currentlyAfkUsers.get(userId);

      if (afkInfo && afkInfo.active === 1) {
        this.sendAfkReturnMessage(channel, userId, username, afkInfo.afk_time, afkInfo.reason);
        this.preparedStatements.updateAfkReturn.run(Date.now() / 1000, userId);
        this.currentlyAfkUsers.delete(userId);
      }
      
      const end = process.hrtime(start);
      logger.debug(`Total AFK return handling took ${end[0]}s ${end[1] / 1000000}ms`);
    } catch (error) {
      const end = process.hrtime(start);
      logger.error(`Error handling AFK return (took ${end[0]}s ${end[1] / 1000000}ms): ${error}`);
    }
  }

  sendAfkReturnMessage(channel, userId, username, afkTime, fullReason) {
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

    this.bot.say(channel, noLongerAfkMessage);
    this.lastAfkMessageTime.set(userId, Date.now() / 1000);
  }

  isAfkCommand(message) {
    return this.afkCommands.has(message.trim().toLowerCase().split(' ')[0]);
  }

  formatDurationString(duration) {
    const units = [
      { value: 86400, label: 'd' },
      { value: 3600, label: 'h' },
      { value: 60, label: 'm' },
      { value: 1, label: 's' }
    ];
    
    const parts = [];
    for (const { value, label } of units) {
      if (duration >= value || (parts.length === 0 && value === 1)) {
        const count = Math.floor(duration / value);
        parts.push(`${count}${label}`);
        duration %= value;
        
        // Break after adding seconds, or if we have two parts
        if (label === 's' || parts.length === 2) break;
      }
    }
    
    return parts.join(' ');
  }
}

let afkInstance = null;

export async function setupAfk(bot) {
  if (!afkInstance) {
    logger.info('Setting up AFK handlers');
    afkInstance = new AFK(bot);
    await afkInstance.setupDatabase();
    logger.info('AFK handlers set up');
  }
  return {
    afk: (context) => afkInstance.handleAfkCommand({ ...context, command: 'afk' }),
    sleep: (context) => afkInstance.handleAfkCommand({ ...context, command: 'sleep' }),
    gn: (context) => afkInstance.handleAfkCommand({ ...context, command: 'gn' }),
    work: (context) => afkInstance.handleAfkCommand({ ...context, command: 'work' }),
    food: (context) => afkInstance.handleAfkCommand({ ...context, command: 'food' }),
    gaming: (context) => afkInstance.handleAfkCommand({ ...context, command: 'gaming' }),
    bed: (context) => afkInstance.handleAfkCommand({ ...context, command: 'bed' }),
    rafk: (context) => afkInstance.handleRafkCommand(context),
    handleMessage: (channel, user, message) => afkInstance.handleMessage(channel, user, message),
  };
}
