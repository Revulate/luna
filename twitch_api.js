import { ApiClient } from '@twurple/api';
import { AppTokenAuthProvider } from '@twurple/auth';
import logger from './logger.js';
import { config } from './config.js';
import MessageLogger from './MessageLogger.js';
import axios from 'axios';

const IVR_API_BASE_URL = 'https://api.ivr.fi/v2';

class TwitchAPI {
  constructor() {
    this.messageCache = new Map();
    this.cacheTTL = 2000; // 2 seconds TTL
    const authProvider = new AppTokenAuthProvider(config.twitch.clientId, config.twitch.clientSecret);
    this.apiClient = new ApiClient({ authProvider });
  }

  // Use Twurple's built-in methods
  async getStreams(userLogins) {
    try {
      return await this.apiClient.streams.getStreamsByUserNames(userLogins);
    } catch (error) {
      logger.error(`Failed to fetch streams: ${error}`);
      throw error;
    }
  }

  async getUserByName(username) {
    try {
      return await this.apiClient.users.getUserByName(username);
    } catch (error) {
      logger.error(`Failed to get user by name: ${error}`);
      return null;
    }
  }

  async getStreamByUserId(userId) {
    try {
      return await this.apiClient.streams.getStreamByUserId(userId);
    } catch (error) {
      logger.error(`Failed to get stream by user ID: ${error}`);
      return null;
    }
  }

  async getChannelInfo(channelId) {
    try {
      const channel = await this.apiClient.channels.getChannelInfoById(channelId);
      return channel;
    } catch (error) {
      logger.error(`Failed to get channel info: ${error}`);
      return null;
    }
  }

  async getChannelVideos(channelId, options = { type: 'archive', limit: 1 }) {
    try {
      return await this.apiClient.videos.getVideosByUser(channelId, options);
    } catch (error) {
      logger.error(`Failed to get channel videos: ${error}`);
      return null;
    }
  }

  async getStreamByUsername(username) {
    try {
      const user = await this.apiClient.users.getUserByName(username);
      if (!user) {
        logger.warn(`Could not find user: ${username}`);
        return null;
      }
      
      const stream = await this.apiClient.streams.getStreamByUserId(user.id);
      if (stream) {
        // Use Twurple's built-in getThumbnailUrl method
        stream.thumbnailUrl = stream.getThumbnailUrl({
          width: 1280,
          height: 720
        });
      }
      return stream;
    } catch (error) {
      logger.error(`Failed to get stream for user ${username}: ${error}`);
      return null;
    }
  }

  async getRecentChannelMessages(channel, count) {
    const cacheKey = `${channel}_${count}`;
    const now = Date.now();
    const cached = this.messageCache.get(cacheKey);
    
    if (cached && (now - cached.timestamp < this.cacheTTL)) {
      return cached.messages;
    }

    try {
      let messages;
      // First try IVR API
      const ivrMessages = await this.getIvrRecentMessages(channel.replace('#', ''), count);
      if (Array.isArray(ivrMessages) && ivrMessages.length > 0) {
        messages = ivrMessages.map(msg => ({
          user: { 
            name: msg.author.login,
            displayName: msg.author.displayName || msg.author.login
          },
          message: msg.content,
          timestamp: new Date(msg.timestamp).getTime()
        }));
      } else {
        // Fall back to MessageLogger
        logger.debug(`Falling back to MessageLogger for channel ${channel}`);
        const loggedMessages = await MessageLogger.getRecentMessages(channel.replace('#', ''), count);
        if (Array.isArray(loggedMessages) && loggedMessages.length > 0) {
          messages = loggedMessages.map(msg => ({
            user: { 
              name: msg.username,
              displayName: msg.username
            },
            message: msg.message,
            timestamp: msg.timestamp
          }));
        } else {
          messages = [];
        }
      }

      // Cache the result before returning
      this.messageCache.set(cacheKey, {
        messages,
        timestamp: now
      });

      return messages;
    } catch (error) {
      logger.error(`Failed to fetch recent messages: ${error.message}`);
      return [];
    }
  }

  async getIvrChannelInfo(channelName) {
    try {
      const response = await axios.get(`${IVR_API_BASE_URL}/twitch/channel`, {
        params: { login: channelName }
      });
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch IVR channel info for ${channelName}: ${error}`);
      return null;
    }
  }

  async getIvrUserInfo(username) {
    try {
      const response = await axios.get(`${IVR_API_BASE_URL}/twitch/user`, {
        params: { login: username }
      });
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch IVR user info for ${username}: ${error}`);
      return null;
    }
  }

  async getIvrRecentMessages(channelName, limit = 100) {
    try {
      const response = await axios.get(`${IVR_API_BASE_URL}/twitch/messages`, {
        params: { channel: channelName, limit }
      });
      if (Array.isArray(response.data)) {
        return response.data;
      } else {
        logger.warn(`Unexpected response format from IVR API for channel ${channelName}`);
        return [];
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        logger.warn(`Channel ${channelName} not found in IVR API`);
      } else {
        logger.error(`Failed to fetch IVR recent messages for ${channelName}: ${error}`);
      }
      return [];
    }
  }

  async getIvrEmotes(channelName) {
    try {
      const response = await axios.get(`${IVR_API_BASE_URL}/twitch/emotes`, {
        params: { channel: channelName }
      });
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch IVR emotes for ${channelName}: ${error}`);
      return null;
    }
  }

  async getGameImageUrl(gameName) {
    try {
      const game = await this.apiClient.games.getGameByName(gameName);
      if (game) {
        return game.boxArtUrl.replace('{width}', '285').replace('{height}', '380');
      }
      return null;
    } catch (error) {
      logger.error(`Failed to get game image URL: ${error}`);
      return null;
    }
  }

  // You can add more methods for other IVR API endpoints as needed
}

export default TwitchAPI;
