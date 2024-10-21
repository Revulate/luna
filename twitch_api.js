import { ApiClient } from '@twurple/api';
import logger from './logger.js';
import { config } from './config.js';

class TwitchAPI {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async getStreams(userLogins) {
    try {
      return await this.apiClient.streams.getStreamsByUserNames(userLogins);
    } catch (error) {
      logger.error(`Failed to fetch streams: ${error}`);
      throw error;
    }
  }

  async getUsers(userLogins) {
    try {
      return await this.apiClient.users.getUsersByNames(userLogins);
    } catch (error) {
      logger.error(`Failed to fetch users: ${error}`);
      throw error;
    }
  }

  async getChannelGames(channelName) {
    try {
      const user = await this.apiClient.users.getUserByName(channelName);
      if (!user) {
        logger.warn(`Could not find user ID for channel: ${channelName}`);
        return null;
      }
      const channel = await this.apiClient.channels.getChannelInfoById(user.id);
      return channel ? channel.gameName : null;
    } catch (error) {
      logger.error(`Failed to fetch channel info for ${channelName}: ${error}`);
      return null;
    }
  }

  async getGameImageUrl(gameName) {
    try {
      const game = await this.apiClient.games.getGameByName(gameName);
      if (game) {
        const boxArtUrl = game.boxArtUrl;
        const formattedUrl = boxArtUrl.replace('{width}', '285').replace('{height}', '380');
        logger.info(`Generated image URL for '${gameName}': ${formattedUrl}`);
        return formattedUrl;
      }
      logger.warn(`No image found for game: ${gameName}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching image URL for ${gameName}: ${error}`);
      return null;
    }
  }

  async getUserInfo(channel, userInfo) {
    try {
      const badges = userInfo.badges ? Array.from(userInfo.badges.keys()) : [];
      const isMod = badges.includes('moderator');
      const isVip = badges.includes('vip');
      const isBroadcaster = userInfo.isBroadcaster;

      logger.debug(`Badges for user ${userInfo.userName} in channel ${channel}: ${badges.join(', ')}`);
      logger.debug(`User ${userInfo.userName} isMod: ${isMod}, isVip: ${isVip}, isBroadcaster: ${isBroadcaster}`);

      return {
        userId: userInfo.userId,
        username: userInfo.userName,
        displayName: userInfo.displayName,
        isMod,
        isVip,
        isBroadcaster,
        isSubscriber: userInfo.isSubscriber,
        badges,
      };
    } catch (error) {
      logger.error(`Failed to get user info for ${userInfo.userName} in channel ${channel}: ${error.message}`);
      return {
        userId: userInfo.userId,
        username: userInfo.userName,
        displayName: userInfo.displayName,
        isMod: false,
        isVip: false,
        isBroadcaster: false,
        isSubscriber: false,
        badges: [],
      };
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

  async getStreamByUsername(username) {
    try {
      const user = await this.getUserByName(username);
      if (!user) {
        logger.warn(`Could not find user: ${username}`);
        return null;
      }
      return await this.apiClient.streams.getStreamByUserId(user.id);
    } catch (error) {
      logger.error(`Failed to get stream for user ${username}: ${error}`);
      return null;
    }
  }

  async getChannelId(channelName) {
    const user = await this.apiClient.users.getUserByName(channelName);
    if (!user) {
      throw new Error(`Could not find channel with name: ${channelName}`);
    }
    return user.id;
  }
}

export default TwitchAPI;
