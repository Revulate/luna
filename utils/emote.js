import logger from './logger.js';
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';

class EmoteHandler {
  constructor(apiClient, chatClient) {
    logger.debug('Initializing EmoteHandler');
    this.apiClient = apiClient;
    this.chatClient = chatClient;
    this.emoteCache = new Map();
    this.emoteUsageStats = new Map();
    this.lastUpdate = new Map();
    
    // Common emote categories
    this.emoteCategories = {
      POSITIVE: ['PETTHEPEEPO', 'Chatting', 'GIGACHAD', 'PagMan', 'HYPERS', 'NOTED', 'POGGIES'],
      FUNNY: ['KEKW', 'LULW', 'Clueless', 'monkaHmm', 'PepeLaugh', 'OMEGALUL', 'ICANT'],
      LOVE: ['peepoLove', 'FeelsOkayMan', 'xqcL', 'peepoComfy'],
      NEGATIVE: ['Sadge', 'peepoSad', 'Madge', 'PepeHands', 'Bedge'],
      COOL: ['EZ', 'catJAM', 'peepoGiggles', 'pepeDS', 'monkaW'],
      REACTIONS: ['monkaS', 'PauseChamp', 'peepoBlush', 'COPIUM', 'Deadge']
    };
  }

  async getChannelEmotes(channelId) {
    logger.startOperation(`Fetching emotes for channel ${channelId}`);
    try {
      const cacheKey = `channel_${channelId}`;
      const cached = this.emoteCache.get(cacheKey);
      
      if (cached && Date.now() - this.lastUpdate.get(cacheKey) < 3600000) {
        logger.debug('Using cached emotes');
        return cached;
      }

      // Get all emote types using Twurple
      const [globalEmotes, channelEmotes, followerEmotes] = await Promise.all([
        this.apiClient.chat.getGlobalEmotes(),
        this.apiClient.chat.getChannelEmotes(channelId),
        this.apiClient.chat.getChannelFollowerEmotes(channelId)
      ]);

      const emotes = {
        global: globalEmotes,
        channel: channelEmotes,
        follower: followerEmotes
      };

      this.emoteCache.set(cacheKey, emotes);
      this.lastUpdate.set(cacheKey, Date.now());
      
      logger.debug('Emotes fetched and cached successfully', {
        globalCount: globalEmotes.length,
        channelCount: channelEmotes.length,
        followerCount: followerEmotes.length
      });
      
      logger.endOperation(`Fetching emotes for channel ${channelId}`, true);
      return emotes;
    } catch (error) {
      logger.error('Error getting channel emotes:', error);
      logger.endOperation(`Fetching emotes for channel ${channelId}`, false);
      return [];
    }
  }

  getEmotesFromMessage(message, parsedMessage) {
    const emotes = new Set();
    
    // Use Twurple's parsed emotes if available
    if (parsedMessage?.emoteOffsets) {
      for (const [emoteId, positions] of Object.entries(parsedMessage.emoteOffsets)) {
        emotes.add(emoteId);
      }
    }

    // Check for emote patterns
    for (const category of Object.values(this.emoteCategories)) {
      for (const emote of category) {
        if (message.includes(emote)) {
          emotes.add(emote);
        }
      }
    }

    return Array.from(emotes);
  }

  getEmotesForMood(mood) {
    switch(mood.toLowerCase()) {
      case 'hype':
        return this.emoteCategories.POSITIVE;
      case 'funny':
        return this.emoteCategories.FUNNY;
      case 'sad':
        return this.emoteCategories.NEGATIVE;
      case 'love':
        return this.emoteCategories.LOVE;
      case 'cool':
        return this.emoteCategories.COOL;
      default:
        return this.emoteCategories.REACTIONS;
    }
  }

  trackEmoteUsage(emote, channel) {
    const key = `${channel}_${emote}`;
    const current = this.emoteUsageStats.get(key) || 0;
    this.emoteUsageStats.set(key, current + 1);
  }

  getMostUsedEmotes(channel, limit = 5) {
    const channelEmotes = Array.from(this.emoteUsageStats.entries())
      .filter(([key]) => key.startsWith(`${channel}_`))
      .map(([key, count]) => ({
        emote: key.split('_')[1],
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return channelEmotes;
  }

  formatEmotes(emotes) {
    return emotes.map(emote => `${emote} `).join('');
  }
}

export function setupEmoteHandler(apiClient, chatClient) {
  return new EmoteHandler(apiClient, chatClient);
}
