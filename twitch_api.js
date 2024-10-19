import { ApiClient } from '@twurple/api';
import { StaticAuthProvider } from '@twurple/auth';
import logger from './logger.js';
import { config } from './config.js';

class TwitchAPI {
  constructor() {
    const authProvider = new StaticAuthProvider(config.twitch.clientId, config.twitch.accessToken);
    this.apiClient = new ApiClient({ authProvider });
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
        logger.warning(`Could not find user ID for channel: ${channelName}`);
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
    } catch (error) {
      logger.error(`Error fetching image URL for ${gameName}: ${error}`);
    }
    return "";
  }
}

export default TwitchAPI;
