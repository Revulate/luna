import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import logger from './logger.js';
import { EventEmitter } from 'events';

export default class TwitchEventManager extends EventEmitter {
  constructor(apiClient, chatClient, initialChannels = []) {
    super();
    this.apiClient = apiClient;
    this.chatClient = chatClient;
    this.channels = new Set(initialChannels);
    this.messageLogger = null;
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.chatClient.onMessage(async (channel, user, message, msg) => {
      try {
        const messageData = {
          channel: channel.replace('#', ''),
          userId: msg.userInfo.userId,
          username: user,
          message: message,
          badges: msg.userInfo.badges,
          color: msg.userInfo.color
        };

        // Emit the chat message event before logging
        this.emit('chatMessage', messageData);

        // Then log the message
        if (this.messageLogger) {
          await this.messageLogger.logMessage(messageData);
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
      // Join initial channels
      for (const channel of this.channels) {
        await this.joinChannel(channel);
      }
    } catch (error) {
      logger.error('Error initializing TwitchEventManager:', error);
      throw error;
    }
  }
}
