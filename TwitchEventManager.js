import { ApiClient } from '@twurple/api';
import { EventEmitter } from 'events';
import logger from './logger.js';
import { config } from './config.js';

export default class TwitchEventManager extends EventEmitter {
  constructor(apiClient, chatClient, initialChannels = []) {
    super();
    this.apiClient = apiClient;
    this.chatClient = chatClient;
    
    // Debug initial channels input
    logger.debug(`Constructor received initialChannels: ${JSON.stringify(initialChannels)}`);
    
    // Ensure channels are properly formatted and non-empty
    this.channels = new Set(
      initialChannels
        .filter(channel => {
          const isValid = channel && channel.trim();
          if (!isValid) logger.debug(`Filtered out invalid channel: ${channel}`);
          return isValid;
        })
        .map(channel => {
          const formatted = channel.toLowerCase().replace(/^#/, '');
          logger.debug(`Formatted channel ${channel} to ${formatted}`);
          return formatted;
        })
    );
    
    this.messageLogger = null;
    logger.info(`TwitchEventManager initialized with channels: ${Array.from(this.channels).join(', ')}`);
  }

  async getGameImageUrl(gameName) {
    try {
      const game = await this.apiClient.games.getGameByName(gameName);
      if (game) {
        const boxArtUrl = game.boxArtUrl.replace('{width}', '285').replace('{height}', '380');
        logger.info(`Generated image URL for '${gameName}': ${boxArtUrl}`);
        return boxArtUrl;
      }
      logger.warn(`No image found for game: ${gameName}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching game image URL for ${gameName}:`, error);
      return null;
    }
  }

  async getUserProfilePicture(username) {
    try {
      const user = await this.apiClient.users.getUserByName(username);
      if (user) {
        logger.info(`Fetched profile picture URL for '${username}': ${user.profilePictureUrl}`);
        return user.profilePictureUrl;
      }
      logger.warn(`No profile picture found for user: ${username}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching profile picture for ${username}:`, error);
      return null;
    }
  }

  async getUserStreamStatus(username) {
    try {
      const user = await this.apiClient.users.getUserByName(username);
      if (!user) {
        return null;
      }

      const stream = await this.apiClient.streams.getStreamByUserId(user.id);
      if (stream) {
        return {
          isLive: true,
          startedAt: stream.startDate
        };
      } else {
        // Get last stream info
        const videos = await this.apiClient.videos.getVideosByUser(user.id, {
          type: 'archive',
          limit: 1
        });
        
        const lastStream = videos.data[0];
        return {
          isLive: false,
          lastLive: lastStream ? lastStream.creationDate : null
        };
      }
    } catch (error) {
      logger.error(`Error fetching stream status for ${username}:`, error);
      return null;
    }
  }

  setupEventHandlers() {
    this.chatClient.onMessage(async (channel, user, message, msg) => {
      try {
        logger.debug(`Received message: ${message}`);
        
        if (message.startsWith(config.twitch.commandPrefix)) {
          logger.debug(`Detected command message: ${message}`);
          const args = message.slice(config.twitch.commandPrefix.length).trim().split(/\s+/);
          const commandName = args.shift().toLowerCase();
          
          logger.debug(`Parsed command: ${commandName}, args: ${args.join(', ')}`);
          
          this.emit('command', {
            channel,
            user: {
              username: user,
              ...msg.userInfo,
              displayName: msg.userInfo.displayName || user
            },
            message,
            args,
            commandName,
            rawMessage: msg,
            // Add required clients
            chatClient: this.chatClient,
            apiClient: this.apiClient,
            say: async (text) => await this.chatClient.say(channel, text)
          });
        }

        // Fix: Pass channel string directly instead of object
        const messageData = {
          channel: channel.replace('#', ''),
          userId: msg.userInfo.userId,
          username: user,
          message: message,
          badges: msg.userInfo.badges,
          color: msg.userInfo.color
        };

        // Emit the chat message event
        this.emit('chatMessage', messageData);

        // Log the message
        if (this.messageLogger) {
          await this.messageLogger.logMessage(channel.replace('#', ''), messageData);
        }
      } catch (error) {
        logger.error('Error handling chat message:', error);
      }
    });

    this.chatClient.onJoin((channel, username) => {
      const channelName = channel.replace('#', '');
      this.channels.add(channelName);
      logger.info(`Joined channel: ${channelName}`);
    });

    this.chatClient.onPart((channel, username) => {
      const channelName = channel.replace('#', '');
      this.channels.delete(channelName);
      logger.info(`Left channel: ${channelName}`);
    });
  }

  getChannels() {
    return Array.from(this.channels);
  }

  async joinChannel(channel) {
    try {
      const channelName = channel.replace('#', '').toLowerCase();
      await this.chatClient.join(channelName);
      this.channels.add(channelName);
      return true;
    } catch (error) {
      logger.error(`Failed to join channel ${channel}:`, error);
      throw error;
    }
  }

  async leaveChannel(channel) {
    try {
      const channelName = channel.replace('#', '').toLowerCase();
      await this.chatClient.part(channelName);
      this.channels.delete(channelName);
      return true;
    } catch (error) {
      logger.error(`Failed to leave channel ${channel}:`, error);
      throw error;
    }
  }

  setMessageLogger(logger) {
    this.messageLogger = logger;
  }

  async initialize() {
    try {
      logger.info('Starting TwitchEventManager initialization...');
      this.setupEventHandlers();

      // Debug channels before joining
      logger.debug(`Channels before joining: ${Array.from(this.channels).join(', ')}`);

      // Join initial channels
      for (const channel of this.channels) {
        try {
          logger.debug(`Attempting to join channel: ${channel}`);
          await this.joinChannel(channel);
          logger.info(`Successfully joined channel: ${channel}`);
          this.emit('channelJoined', channel);
        } catch (error) {
          logger.error(`Failed to join initial channel ${channel}:`, error);
        }
      }

      // Debug final channel state
      logger.debug(`Final channel state: ${Array.from(this.channels).join(', ')}`);
    } catch (error) {
      logger.error('Error initializing TwitchEventManager:', error);
      throw error;
    }
  }
}
