import logger from './logger.js';
import { ApiClient } from '@twurple/api';

class AnalyticsHandler {
  constructor(apiClient) {
    logger.debug('Initializing AnalyticsHandler');
    this.apiClient = apiClient;
    this.messageStats = new Map();
    this.userStats = new Map();
    this.channelStats = new Map();
    this.moodHistory = new Map();
    
    // Analysis windows
    this.windows = {
      SHORT: 5 * 60 * 1000,    // 5 minutes
      MEDIUM: 30 * 60 * 1000,  // 30 minutes
      LONG: 2 * 60 * 60 * 1000 // 2 hours
    };
  }

  async trackMessage(channel, user, message, metadata = {}) {
    const timestamp = Date.now();
    
    try {
      logger.debug('Tracking message:', {
        channel,
        username: user.username,
        messageLength: message.length
      });

      // Get Twurple user data if available
      const userData = await this.apiClient.users.getUserById(user.id);
      
      // Update channel stats with Twurple data
      await this.updateChannelStats(channel, message, timestamp, userData);
      
      // Update user stats with Twurple data
      await this.updateUserStats(channel, user, message, timestamp, userData);
      
      // Update message stats
      this.updateMessageStats(channel, message, {
        ...metadata,
        userType: userData?.type || 'user',
        broadcasterType: userData?.broadcasterType || 'none'
      });
      
      // Track mood
      this.updateMoodHistory(channel, this.analyzeMood([{ message, timestamp }]));

      logger.debug('Message tracking complete');
    } catch (error) {
      logger.error('Error tracking message:', error);
    }
  }

  async updateChannelStats(channel, message, timestamp, userData) {
    logger.debug(`Updating channel stats for ${channel}`);
    const stats = this.channelStats.get(channel) || {
      messageCount: 0,
      uniqueUsers: new Set(),
      firstMessage: timestamp,
      lastMessage: timestamp,
      activityByHour: new Array(24).fill(0),
      userTypes: {
        normal: 0,
        subscriber: 0,
        vip: 0,
        moderator: 0
      }
    };

    stats.messageCount++;
    stats.lastMessage = timestamp;
    stats.activityByHour[new Date(timestamp).getHours()]++;
    stats.uniqueUsers.add(userData?.id || 'unknown');

    // Track user types using Twurple data
    if (userData) {
      if (userData.roles?.isSubscriber) stats.userTypes.subscriber++;
      if (userData.roles?.isVip) stats.userTypes.vip++;
      if (userData.roles?.isModerator) stats.userTypes.moderator++;
      if (!userData.roles?.isSubscriber && !userData.roles?.isVip && !userData.roles?.isModerator) {
        stats.userTypes.normal++;
      }
    }

    this.channelStats.set(channel, stats);
  }

  updateUserStats(channel, user, message, timestamp, userData) {
    const key = `${channel}_${user.username}`;
    const stats = this.userStats.get(key) || {
      messageCount: 0,
      firstSeen: timestamp,
      lastSeen: timestamp,
      interactions: []
    };

    stats.messageCount++;
    stats.lastSeen = timestamp;
    stats.interactions.push({
      timestamp,
      messageLength: message.length,
      type: 'message'
    });

    // Trim old interactions
    while (stats.interactions.length > 100) {
      stats.interactions.shift();
    }

    this.userStats.set(key, stats);
  }

  updateMessageStats(channel, message, metadata) {
    const stats = this.messageStats.get(channel) || {
      totalMessages: 0,
      averageLength: 0,
      emoteUsage: new Map(),
      commandUsage: new Map()
    };

    stats.totalMessages++;
    stats.averageLength = (stats.averageLength * (stats.totalMessages - 1) + message.length) / stats.totalMessages;

    // Track emotes
    if (metadata.emotes) {
      metadata.emotes.forEach(emote => {
        const count = stats.emoteUsage.get(emote) || 0;
        stats.emoteUsage.set(emote, count + 1);
      });
    }

    // Track commands
    if (metadata.isCommand) {
      const count = stats.commandUsage.get(metadata.command) || 0;
      stats.commandUsage.set(metadata.command, count + 1);
    }

    this.messageStats.set(channel, stats);
  }

  updateMoodHistory(channel, mood) {
    const history = this.moodHistory.get(channel) || [];
    history.push({
      mood,
      timestamp: Date.now()
    });

    // Keep last hour of mood data
    while (history.length > 0 && Date.now() - history[0].timestamp > 3600000) {
      history.shift();
    }

    this.moodHistory.set(channel, history);
  }

  getChannelActivity(channel, window = 'MEDIUM') {
    const stats = this.channelStats.get(channel);
    if (!stats) return 0;

    const now = Date.now();
    const windowMs = this.windows[window];
    
    return stats.activityByHour.reduce((sum, count) => sum + count, 0) / (windowMs / 3600000);
  }

  getUserEngagement(channel, username) {
    const key = `${channel}_${username}`;
    const stats = this.userStats.get(key);
    if (!stats) return 0;

    const now = Date.now();
    const recentInteractions = stats.interactions.filter(i => now - i.timestamp < this.windows.MEDIUM);
    
    return recentInteractions.length / (this.windows.MEDIUM / 60000); // Interactions per minute
  }

  getChannelMood(channel) {
    const history = this.moodHistory.get(channel) || [];
    if (history.length === 0) return 'neutral';

    const moodCounts = {};
    history.forEach(({ mood }) => {
      moodCounts[mood] = (moodCounts[mood] || 0) + 1;
    });

    return Object.entries(moodCounts)
      .sort(([,a], [,b]) => b - a)[0][0];
  }

  generateAnalytics(channel) {
    return {
      activity: this.getChannelActivity(channel),
      mood: this.getChannelMood(channel),
      messageStats: this.messageStats.get(channel) || {},
      channelStats: this.channelStats.get(channel) || {}
    };
  }

  cleanup() {
    const now = Date.now();
    
    // Cleanup old data
    for (const [channel, stats] of this.channelStats.entries()) {
      if (now - stats.lastMessage > this.windows.LONG) {
        this.channelStats.delete(channel);
      }
    }

    // Cleanup user stats
    for (const [key, stats] of this.userStats.entries()) {
      if (now - stats.lastSeen > this.windows.LONG) {
        this.userStats.delete(key);
      }
    }
  }
}

export function setupAnalytics(apiClient) {
  return new AnalyticsHandler(apiClient);
}
