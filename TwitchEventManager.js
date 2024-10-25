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
    
    // Add stream monitoring
    this.streamMonitors = new Map();
    this.lastStreamAnalysis = new Map();
    this.streamAnalysisInterval = 10 * 60 * 1000; // 10 minutes
    
    // Start stream monitoring
    this.startStreamMonitoring();
    
    this.claudeHandler = null; // Add this line
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
            say: async (text) => {
              // Log first, then send
              if (this.messageLogger) {
                await this.messageLogger.logBotMessage(channel, text);
              }
              await this.chatClient.say(channel, text);
            }
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
      const channelName = channel.replace(/^#/, '').toLowerCase();
      // Only add to channels if it's not already there
      if (!this.channels.has(channelName)) {
        this.channels.add(channelName);
        logger.info(`Joined channel: ${channelName}`);
      }
    });

    this.chatClient.onPart((channel, username) => {
      const channelName = channel.replace(/^#/, '').toLowerCase();
      this.channels.delete(channelName);
      logger.info(`Left channel: ${channelName}`);
    });
  }

  getChannels() {
    return Array.from(this.channels);
  }

  async joinChannel(channel) {
    const normalizedChannel = channel.replace(/^#/, '').toLowerCase();
    
    // Check if already in channel using both the Set and chatClient's channels
    if (this.channels.has(normalizedChannel) || 
        this.chatClient.channels.includes(`#${normalizedChannel}`)) {
      logger.debug(`Already in channel: ${normalizedChannel}`);
      return;
    }

    try {
      await this.chatClient.join(normalizedChannel);
      this.channels.add(normalizedChannel);
      logger.info(`Joined channel: ${normalizedChannel}`);
    } catch (error) {
      logger.error(`Error joining channel ${normalizedChannel}:`, error);
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

      // Get current channels from chatClient
      const currentChannels = (this.chatClient.channels || [])
        .map(ch => ch.replace(/^#/, ''));
      
      // Filter out channels we're already in
      const channelsToJoin = [...this.channels].filter(ch => 
        !currentChannels.includes(ch.toLowerCase())
      );

      logger.debug(`Current channels: ${currentChannels.join(', ')}`);
      logger.debug(`Channels to join: ${channelsToJoin.join(', ')}`);

      // Join only new channels
      for (const channel of channelsToJoin) {
        try {
          await this.joinChannel(channel);
          // Add small delay between joins to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`Failed to join channel ${channel}:`, error);
        }
      }

      // Start stream monitoring
      this.startStreamMonitoring();
    } catch (error) {
      logger.error('Error initializing TwitchEventManager:', error);
      throw error;
    }
  }

  async startStreamMonitoring() {
    // Check streams every minute
    setInterval(async () => {
      for (const channel of this.channels) {
        try {
          await this.checkStreamStatus(channel);
        } catch (error) {
          logger.error(`Error checking stream status for ${channel}:`, error);
        }
      }
    }, 60000); // Check every minute
  }

  async checkStreamStatus(channel) {
    try {
      const isLive = await this.isChannelLive(channel);
      const lastAnalysis = this.lastStreamAnalysis.get(channel) || 0;
      const now = Date.now();

      if (isLive) {
        // Stream is live
        if (now - lastAnalysis >= this.streamAnalysisInterval) {
          const user = await this.apiClient.users.getUserByName(channel);
          const stream = await this.apiClient.streams.getStreamByUserId(user.id);
          await this.analyzeStream(channel, stream);
          this.lastStreamAnalysis.set(channel, now);
        }
      } else {
        // Stream is offline, reset analysis timer
        this.lastStreamAnalysis.delete(channel);
      }
    } catch (error) {
      logger.error(`Error checking stream for ${channel}:`, error);
    }
  }

  async analyzeStream(channel, stream) {
    try {
      const streamData = {
        title: stream.title,
        game: stream.gameName,
        startTime: stream.startDate,
        thumbnailUrl: stream.thumbnailUrl
          .replace('{width}', '1280')
          .replace('{height}', '720')
      };

      // Generate analysis prompt without viewer count
      const prompt = `Analyze this Twitch stream:
        Channel: ${channel}
        Title: ${streamData.title}
        Game: ${streamData.game}
        Uptime: ${this.getStreamUptime(streamData.startTime)}
        
        Generate a casual, friendly comment about the stream as if you're talking to the broadcaster.
        Reference specific details about what they're doing in the game or stream.
        Keep it natural and chat-friendly, using appropriate 7TV emotes.`;

      // Use Claude to analyze if handler is available
      if (this.claudeHandler?.anthropic) {
        const response = await this.claudeHandler.anthropic.messages.create({
          model: "claude-3-sonnet-20240229",
          max_tokens: 100,
          temperature: 0.8,
          system: `You are Luna, a Twitch chatbot casually commenting on a stream. Keep responses natural and chat-friendly. Use appropriate 7TV emotes.`,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        });

        const comment = response.content[0].text;
        
        // Send the comment to chat
        await this.chatClient.say(channel, `@${channel} ${comment}`);
        logger.info(`Sent stream analysis comment in ${channel}: ${comment}`);
      }
    } catch (error) {
      logger.error(`Error analyzing stream for ${channel}:`, error);
    }
  }

  getStreamUptime(startTime) {
    const duration = Date.now() - new Date(startTime).getTime();
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }

  // Add this method to the TwitchEventManager class
  async isChannelLive(channel) {
    try {
      // Remove # if present and convert to lowercase
      const channelName = channel.replace(/^#/, '').toLowerCase();
      
      // Get user info
      const user = await this.apiClient.users.getUserByName(channelName);
      if (!user) {
        logger.debug(`Channel ${channelName} not found`);
        return false;
      }

      // Check stream status
      const stream = await this.apiClient.streams.getStreamByUserId(user.id);
      
      // Debug logging
      logger.debug(`Stream status for ${channelName}: ${stream ? 'live' : 'offline'}`);
      
      return !!stream; // Returns true if stream exists, false otherwise
    } catch (error) {
      logger.error(`Error checking live status for ${channel}:`, error);
      return false; // Return false on error
    }
  }
}
