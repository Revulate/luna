import logger from './logger.js';
import { ApiClient } from '@twurple/api';

class ContextBuilder {
  constructor(apiClient, emoteHandler, messageFormatter) {
    logger.debug('Initializing ContextBuilder');
    this.apiClient = apiClient;
    this.emoteHandler = emoteHandler;
    this.messageFormatter = messageFormatter;
  }

  async buildEnhancedContext(channel, user, message, recentMessages, options = {}) {
    logger.startOperation('Building enhanced context');
    try {
      // Get Twitch user data
      const userData = await this.apiClient.users.getUserByName(user.username);
      logger.debug('Retrieved user data:', { 
        username: user.username,
        displayName: userData?.displayName 
      });
      
      const context = {
        channel: await this.buildChannelContext(channel, recentMessages),
        user: await this.buildUserContext(user, userData),
        conversation: this.buildConversationContext(recentMessages),
        emotes: await this.buildEmoteContext(channel, recentMessages),
        metadata: {
          timestamp: Date.now(),
          messageType: options.messageType || 'chat',
          platform: 'twitch',
          userType: userData?.broadcasterType || 'user'
        }
      };

      logger.debug('Context built successfully');
      logger.endOperation('Building enhanced context', true);
      return context;
    } catch (error) {
      logger.error('Error building enhanced context:', error);
      logger.endOperation('Building enhanced context', false);
      return this.buildFallbackContext(channel, user);
    }
  }

  async buildChannelContext(channel, messages) {
    return {
      name: channel,
      mood: this.analyzeMood(messages),
      activity: this.measureChannelActivity(messages),
      recentTopics: this.extractTopics(messages),
      messageFrequency: this.calculateMessageFrequency(messages)
    };
  }

  async buildUserContext(user, userData) {
    // Enhanced with Twurple user data
    return {
      username: user.username || user.name,
      displayName: userData?.displayName || user.displayName || user.username,
      id: userData?.id || user.id,
      isMod: user.isMod || false,
      isBroadcaster: user.isBroadcaster || false,
      isSubscriber: userData?.roles?.isSubscriber || false,
      isVip: userData?.roles?.isVip || false,
      broadcasterType: userData?.broadcasterType || 'none',
      profileImageUrl: userData?.profilePictureUrl,
      createdAt: userData?.creationDate,
      followDate: await this.getFollowDate(user.id, channel),
      badges: await this.getBadges(user.id, channel)
    };
  }

  async getBadges(userId, channel) {
    try {
      const [globalBadges, channelBadges] = await Promise.all([
        this.apiClient.chat.getGlobalBadges(),
        this.apiClient.chat.getChannelBadges(channel)
      ]);
      return { global: globalBadges, channel: channelBadges };
    } catch (error) {
      logger.error('Error fetching badges:', error);
      return { global: [], channel: [] };
    }
  }

  async getFollowDate(userId, channel) {
    try {
      const follow = await this.apiClient.users.getFollowFromUserToBroadcaster(userId, channel);
      return follow?.followDate || null;
    } catch (error) {
      logger.error('Error getting follow date:', error);
      return null;
    }
  }

  buildConversationContext(messages) {
    return {
      recentMessages: this.formatMessages(messages),
      participants: this.getUniqueParticipants(messages),
      mood: this.analyzeMood(messages),
      topics: this.extractTopics(messages)
    };
  }

  async buildEmoteContext(channel, messages) {
    return {
      recentEmotes: this.emoteHandler.getEmotesFromMessage(messages),
      channelMeta: await this.emoteHandler.getChannelEmotes(channel),
      moodEmotes: this.emoteHandler.getEmotesForMood(this.analyzeMood(messages))
    };
  }

  buildFallbackContext(channel, user) {
    return {
      channel: { name: channel, mood: 'neutral', activity: 0 },
      user: this.buildUserContext(user),
      conversation: { recentMessages: [], participants: [] },
      emotes: { recentEmotes: [], channelMeta: null },
      metadata: {
        timestamp: Date.now(),
        messageType: 'chat',
        platform: 'twitch'
      }
    };
  }

  analyzeMood(messages) {
    // Implementation moved to analytics.js
    return 'neutral';
  }

  measureChannelActivity(messages) {
    if (!messages || !Array.isArray(messages)) return 0;

    const now = Date.now();
    const recentMessages = messages.filter(msg => {
      const msgTime = msg.timestamp || Date.now();
      return (now - msgTime) < (5 * 60 * 1000); // Last 5 minutes
    });

    return recentMessages.length;
  }

  extractTopics(messages) {
    if (!messages || !Array.isArray(messages)) return [];

    const words = messages
      .filter(msg => msg?.message)
      .map(msg => msg.message.toLowerCase().split(/\s+/))
      .flat()
      .filter(word => word && word.length > 3);

    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    return Object.entries(wordFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word);
  }

  formatMessages(messages) {
    return messages
      ?.filter(msg => msg?.message && msg?.username)
      .map(msg => ({
        content: msg.message,
        username: msg.username,
        timestamp: msg.timestamp || Date.now(),
        emotes: msg.emotes || []
      })) || [];
  }

  getUniqueParticipants(messages) {
    return [...new Set(messages?.map(msg => msg?.username).filter(Boolean) || [])];
  }

  calculateMessageFrequency(messages) {
    if (!messages || messages.length < 2) return 0;
    
    const timeSpan = messages[messages.length - 1].timestamp - messages[0].timestamp;
    return messages.length / (timeSpan / 1000 / 60); // Messages per minute
  }
}

export function setupContextBuilder(apiClient, emoteHandler, messageFormatter) {
  return new ContextBuilder(apiClient, emoteHandler, messageFormatter);
}
