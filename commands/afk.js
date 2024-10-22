import { runQuery, getQuery, allQuery } from '../database.js';
import logger from '../logger.js';
import MessageLogger from '../MessageLogger.js';

class AFK {
  constructor(bot) {
    this.bot = bot;
    this.lastAfkMessageTime = new Map();
    this.currentlyAfkUsers = new Map();
    this.afkCommands = new Set(['afk', 'sleep', 'gn', 'work', 'food', 'gaming', 'bed', 'rafk']);
    this.initialized = false;
    
    // Improved emoji mappings
    this.reasonEmojis = {
      afk: '🚶',
      sleep: '😴',
      work: '💼',
      food: '🍽️',
      gaming: '🎮',
      bed: '🛏️',
      gn: '💤'
    };
  }

  async setupDatabase() {
    try {
      // Wait for database to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create or modify the AFK table
      await runQuery(`
        CREATE TABLE IF NOT EXISTS afk_status (
          user_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          username TEXT NOT NULL,
          afk_time INTEGER NOT NULL,
          reason TEXT NOT NULL,
          return_time INTEGER,
          active INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (user_id, channel)
        )
      `);

      // Clear any stale AFK statuses that are more than 24 hours old
      const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
      await runQuery(`
        UPDATE afk_status 
        SET active = 0, 
            return_time = ?
        WHERE active = 1 
        AND afk_time < ?
      `, [Math.floor(Date.now() / 1000), twentyFourHoursAgo]);

      // Load active AFK users
      const activeUsers = await allQuery("SELECT * FROM afk_status WHERE active = 1");
      for (const user of activeUsers) {
        const key = this.getUserKey(user.user_id, user.channel);
        this.currentlyAfkUsers.set(key, user);
        logger.debug(`Loaded active AFK: ${user.username} in ${user.channel}`);
      }

      this.initialized = true;
      logger.info('AFK module database setup complete');
    } catch (error) {
      logger.error(`Error in AFK setup: ${error}`);
      throw error; // Propagate the error to prevent partial initialization
    }
  }

  // Add a check for initialization
  async ensureInitialized() {
    if (!this.initialized) {
      logger.debug('AFK module not initialized, waiting...');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!this.initialized) {
        throw new Error('AFK module failed to initialize');
      }
    }
  }

  getUserKey(userId, channel) {
    return `${userId}:${channel}`;
  }

  getBaseReason(command) {
    // Get normalized command
    const normalizedCommand = this.reasonAliases[command] || command;
    
    // Get base text and emoji
    const emoji = this.reasonEmojis[normalizedCommand] || this.reasonEmojis.afk;
    const baseText = normalizedCommand === 'afk' ? 'AFK' : `${normalizedCommand}ing`;
    
    return `${baseText} ${emoji}`;
  }

  async handleAfkCommand({ channel, user, args, command }) {
    await this.ensureInitialized();
    const userId = user.id || user.userId;
    const username = user.username;
    const cleanChannel = channel.replace('#', '');

    try {
        // First check if user is already AFK
        const existingAfk = await getQuery(`
            SELECT * FROM afk_status 
            WHERE user_id = ? 
            AND channel = ? 
            AND active = 1
        `, [userId, cleanChannel]);

        if (existingAfk) {
            await this.bot.say(channel, `@${username}, you are already AFK: ${existingAfk.reason}`);
            return;
        }

        // Deactivate ALL previous AFK statuses for this user in this channel
        await runQuery(`
            UPDATE afk_status 
            SET active = 0,
                return_time = ?
            WHERE user_id = ? 
            AND channel = ?
        `, [Math.floor(Date.now() / 1000), userId, cleanChannel]);

        // Create new AFK status
        const emoji = this.reasonEmojis[command] || this.reasonEmojis.afk;
        const baseReason = command === 'afk' ? 'AFK' : `${command}ing`;
        const reason = args.join(' ');
        const fullReason = reason ? `${baseReason} ${emoji}: ${reason}` : `${baseReason} ${emoji}`;
        const timestamp = Math.floor(Date.now() / 1000);

        // Delete any existing rows for this user/channel combination
        await runQuery(`
            DELETE FROM afk_status 
            WHERE user_id = ? 
            AND channel = ?
        `, [userId, cleanChannel]);

        // Insert new AFK status
        await runQuery(`
            INSERT INTO afk_status (
                user_id, 
                channel, 
                username, 
                afk_time, 
                reason, 
                active
            ) VALUES (?, ?, ?, ?, ?, 1)
        `, [userId, cleanChannel, username, timestamp, fullReason]);

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

        await this.bot.say(channel, `@${username} is now ${fullReason}`);

    } catch (error) {
        logger.error(`Error in AFK command: ${error}`);
        // Clean up any partial state
        await this.clearAfkStatus(userId, cleanChannel);
        await this.bot.say(channel, `@${username}, there was an error processing your AFK status.`);
    }
  }

  async handleMessage(channel, user, message) {
    await this.ensureInitialized();
    // Don't process bot messages or commands
    if (user.bot || message.startsWith('#')) return;

    const userId = user.id || user.userId;
    const username = user.username;
    const cleanChannel = channel.replace('#', '');

    try {
        // Check if user is AFK
        const afkStatus = await getQuery(`
            SELECT * FROM afk_status 
            WHERE user_id = ? 
            AND channel = ? 
            AND active = 1
        `, [userId, cleanChannel]);

        if (afkStatus) {
            const returnTime = Math.floor(Date.now() / 1000);
            const duration = this.formatDurationString(returnTime - afkStatus.afk_time);
            
            // First send the return message
            await this.bot.say(channel, 
                `@${username} is no longer ${afkStatus.reason} (was away for ${duration})`
            );

            // Then update the database
            await runQuery(`
                UPDATE afk_status 
                SET active = 0,
                    return_time = ?
                WHERE user_id = ? 
                AND channel = ? 
                AND active = 1
            `, [returnTime, userId, cleanChannel]);

            // Update cache
            const userKey = this.getUserKey(userId, cleanChannel);
            this.currentlyAfkUsers.delete(userKey);

            logger.debug(`Broke AFK for ${username} in ${cleanChannel}`);
        }
    } catch (error) {
        logger.error(`Error checking message for AFK: ${error}`);
    }
  }

  async handleAfkReturn(channel, userId, username) {
    const cleanChannel = channel.replace('#', '');
    
    try {
        const afkStatus = await getQuery(`
            SELECT * FROM afk_status 
            WHERE user_id = ? 
            AND channel = ? 
            AND active = 1
        `, [userId, cleanChannel]);

        if (afkStatus) {
            const returnTime = Math.floor(Date.now() / 1000);
            
            // Delete the AFK status instead of just marking inactive
            await runQuery(`
                DELETE FROM afk_status 
                WHERE user_id = ? 
                AND channel = ?
            `, [userId, cleanChannel]);

            // Update cache
            const userKey = this.getUserKey(userId, cleanChannel);
            this.currentlyAfkUsers.delete(userKey);

            // Send return message
            const duration = this.formatDurationString(returnTime - afkStatus.afk_time);
            await this.bot.say(channel, 
                `@${username} is no longer ${afkStatus.reason} (was away for ${duration})`
            );

            logger.debug(`Broke AFK for ${username} in ${cleanChannel}`);
        }
    } catch (error) {
        logger.error(`Error handling AFK return: ${error}`);
        await this.clearAfkStatus(userId, cleanChannel);
    }
  }

  async handleRafkCommand({ channel, user }) {
    await this.ensureInitialized();
    const userId = user.id || user.userId;
    const username = user.username;
    const cleanChannel = channel.replace('#', '');

    try {
        // Check for recent AFK status - increased window to 30 minutes
        const recentAfk = await getQuery(`
            SELECT * FROM afk_status 
            WHERE user_id = ? 
            AND channel = ? 
            AND active = 0 
            AND return_time > ? 
            ORDER BY return_time DESC 
            LIMIT 1
        `, [userId, cleanChannel, Math.floor(Date.now() / 1000) - 1800]); // 30 minutes

        if (recentAfk) {
            // Delete any existing active status first
            await runQuery(`
                DELETE FROM afk_status 
                WHERE user_id = ? 
                AND channel = ?
            `, [userId, cleanChannel]);

            // Insert new active status based on the recent one
            await runQuery(`
                INSERT INTO afk_status (
                    user_id, 
                    channel, 
                    username, 
                    afk_time, 
                    reason, 
                    active
                ) VALUES (?, ?, ?, ?, ?, 1)
            `, [userId, cleanChannel, username, recentAfk.afk_time, recentAfk.reason]);

            // Update cache
            const userKey = this.getUserKey(userId, cleanChannel);
            this.currentlyAfkUsers.set(userKey, {
                userId,
                channel: cleanChannel,
                username,
                afkTime: recentAfk.afk_time,
                reason: recentAfk.reason,
                active: 1
            });

            const timeSinceAfk = this.formatDurationString(Date.now() / 1000 - recentAfk.afk_time);
            await this.bot.say(channel, 
                `@${username} has resumed their AFK status: ${recentAfk.reason} (originally went AFK ${timeSinceAfk} ago)`
            );
        } else {
            await this.bot.say(channel, 
                `@${username}, you don't have any recent AFK status to resume.`
            );
        }
    } catch (error) {
        logger.error(`Error handling RAFK command: ${error}`);
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
    
    let parts = [];
    let remaining = Math.floor(duration);
    
    for (const { value, label } of units) {
      if (remaining >= value) {
        const count = Math.floor(remaining / value);
        parts.push(`${count}${label}`);
        remaining %= value;
        
        // Only show up to 2 most significant units
        if (parts.length === 2) break;
      }
    }
    
    // Ensure we show at least seconds if duration is very short
    if (parts.length === 0) {
      parts.push('0s');
    }
    
    return parts.join(' ');
  }

  async getActiveAfkStatus(userId, channel) {
    return await getQuery(`
      SELECT * FROM afk_status 
      WHERE user_id = ? 
      AND channel = ? 
      AND active = 1
    `, [userId, channel]);
  }

  async setAfkStatus(userId, channel, username, timestamp, fullReason) {
    await runQuery(`
        UPDATE afk_status 
        SET active = 0, 
            return_time = ? 
        WHERE user_id = ? 
        AND channel = ?
    `, [timestamp, userId, channel]);

    await runQuery(`
        INSERT INTO afk_status (
            user_id, 
            channel, 
            username, 
            afk_time, 
            reason, 
            active
        ) VALUES (?, ?, ?, ?, ?, 1)
    `, [userId, channel, username, timestamp, fullReason]);
  }

  // Add to AFK class
  async _prepareStatements() {
    this.preparedStatements = {
      getActiveAfk: await this.db.prepare(`
        SELECT * FROM afk_status 
        WHERE user_id = ? AND channel = ? AND active = 1
      `),
      insertAfk: await this.db.prepare(`
        INSERT INTO afk_status (user_id, channel, username, afk_time, reason, active)
        VALUES (?, ?, ?, ?, ?, 1)
      `),
      updateAfkReturn: await this.db.prepare(`
        UPDATE afk_status 
        SET active = 0, return_time = ? 
        WHERE user_id = ? AND channel = ? AND active = 1
      `)
    };
  }

  // Add a method to manually clear AFK status
  async clearAfkStatus(userId, channel) {
    await this.ensureInitialized();
    const cleanChannel = channel.replace('#', '');
    try {
        // First delete any existing entries
        await runQuery(`
            DELETE FROM afk_status 
            WHERE user_id = ? 
            AND channel = ?
        `, [userId, cleanChannel]);

        const userKey = this.getUserKey(userId, cleanChannel);
        this.currentlyAfkUsers.delete(userKey);
        
        logger.debug(`Manually cleared AFK status for user ${userId} in ${cleanChannel}`);
    } catch (error) {
        logger.error(`Error clearing AFK status: ${error}`);
    }
  }
}

// Modify the setup function to properly expose the message handler
export async function setupAfk(bot) {
  const afk = new AFK(bot);
  await afk.setupDatabase();

  // Create a message handler that will be used by the chat client
  const messageHandler = async (channel, user, message, msg) => {
    // Skip if it's a command
    if (message.startsWith('#')) return;
    
    // Check if user is AFK and handle the return
    await afk.handleMessage(channel, user, message);
  };

  // Return both commands and the message handler
  return {
    // Commands
    afk: async (context) => await afk.handleAfkCommand({
      channel: context.channel,
      user: context.user,
      args: context.args,
      command: 'afk'
    }),
    // ... other commands ...

    // Export the message handler to be registered by the bot
    messageHandler
  };
}
