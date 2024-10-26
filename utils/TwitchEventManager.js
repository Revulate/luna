import { ApiClient } from '@twurple/api';
import { EventEmitter } from 'events';
import logger from './logger.js';
import { config } from '../config.js';
import { EventSubWsListener } from '@twurple/eventsub-ws';

export default class TwitchEventManager extends EventEmitter {
  constructor(apiClient, chatClient, initialChannels = []) {
    super();
    logger.startOperation('Initializing TwitchEventManager');
    this.apiClient = apiClient;
    this.chatClient = chatClient;
    this.botUsername = config.twitch.botUsername.toLowerCase();
    this.streamMonitors = new Map();
    this.lastStreamAnalysis = new Map();
    
    logger.debug('Constructor parameters:', { 
      initialChannels,
      botUsername: this.botUsername 
    });
    
    // Ensure channels are properly formatted and non-empty
    this.channels = new Set(
      initialChannels
        .filter(channel => channel && channel.trim())
        .map(channel => channel.toLowerCase().replace(/^#/, ''))
    );
    
    this.messageLogger = null;
    this.eventSubListener = null;
    
    // Initialize EventSub listener
    this.eventSubListener = new EventSubWsListener({
      apiClient: this.apiClient,
      strictHostCheck: false
    });

    // Add API client to chat client for other modules
    if (this.chatClient && this.apiClient) {
      this.chatClient.apiClient = this.apiClient;
    }

    logger.info('TwitchEventManager initialized with channels:', 
      Array.from(this.channels).join(', ')
    );
    logger.endOperation('Initializing TwitchEventManager', true);
  }

  async initialize() {
    try {
      logger.info('Starting TwitchEventManager initialization...');

      // Validate required clients
      if (!this.apiClient || !this.chatClient) {
        throw new Error('Missing required clients in TwitchEventManager');
      }

      // Setup event handlers first
      this.setupEventHandlers();
      
      // Setup EventSub subscriptions
      await this.setupEventSub();
      
      // Start stream monitoring
      await this.startStreamMonitoring();
      
      logger.info('TwitchEventManager initialization complete');
    } catch (error) {
      logger.error('Error initializing TwitchEventManager:', error);
      throw error;
    }
  }

  async setupEventSub() {
    try {
      if (!this.botUsername) {
        throw new Error('Bot username not configured');
      }

      for (const channel of this.channels) {
        try {
          const user = await this.apiClient.users.getUserByName(channel);
          if (!user) continue;

          // Only subscribe to events for the bot's channel
          if (channel.toLowerCase() === this.botUsername.toLowerCase()) {
            this.eventSubListener.onStreamOnline(user.id, async (e) => {
              this.emit('streamOnline', { channel, stream: e });
              await this.handleStreamOnline(channel, e);
            });

            this.eventSubListener.onStreamOffline(user.id, async () => {
              this.emit('streamOffline', { channel });
              await this.handleStreamOffline(channel);
            });

            logger.info(`EventSub subscriptions setup for channel: ${channel}`);
          }
        } catch (error) {
          logger.warn(`Skipping EventSub setup for ${channel}:`, error.message);
        }
      }

      // Start the listener after all subscriptions are set up
      if (this.eventSubListener) {
        await this.eventSubListener.start();
        logger.info('EventSub listener started successfully');
      }
    } catch (error) {
      logger.error('Error setting up EventSub:', error);
      throw error;
    }
  }

  async handleStreamOnline(channel, streamInfo) {
    try {
      this.lastStreamAnalysis.delete(channel); // Reset analysis timer
      logger.info(`Stream went online in channel ${channel}`);
      
      // Schedule first analysis
      setTimeout(() => this.analyzeStream(channel, streamInfo), 5 * 60 * 1000); // Wait 5 minutes
    } catch (error) {
      logger.error(`Error handling stream online for ${channel}:`, error);
    }
  }

  async handleStreamOffline(channel) {
    try {
      this.lastStreamAnalysis.delete(channel);
      this.streamMonitors.delete(channel);
      logger.info(`Stream went offline in channel ${channel}`);
    } catch (error) {
      logger.error(`Error handling stream offline for ${channel}:`, error);
    }
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
    if (!this.chatClient) {
      throw new Error('Chat client not initialized');
    }

    // Use addListener instead of on for Twurple v7
    this.chatClient.addListener('message', async (channel, user, message, msg) => {
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
            chatClient: this.chatClient,
            apiClient: this.apiClient,
            say: async (text) => {
              if (this.messageLogger) {
                await this.messageLogger.logBotMessage(channel, text);
              }
              await this.chatClient.say(channel, text);
            }
          });
        }

        const messageData = {
          channel: channel.replace('#', ''),
          userId: msg.userInfo.userId,
          username: user,
          message: message,
          badges: msg.userInfo.badges,
          color: msg.userInfo.color
        };

        this.emit('chatMessage', messageData);

        if (this.messageLogger) {
          await this.messageLogger.logMessage(channel.replace('#', ''), messageData);
        }
      } catch (error) {
        logger.error('Error handling chat message:', error);
      }
    });

    this.chatClient.addListener('join', (channel, username) => {
      const channelName = channel.replace(/^#/, '').toLowerCase();
      if (!this.channels.has(channelName)) {
        this.channels.add(channelName);
        logger.info(`Joined channel: ${channelName}`);
        this.emit('channelJoined', channelName);
      }
    });

    this.chatClient.addListener('part', (channel, username) => {
      const channelName = channel.replace(/^#/, '').toLowerCase();
      this.channels.delete(channelName);
      logger.info(`Left channel: ${channelName}`);
      this.emit('channelLeft', channelName);
    });

    // Update error handling for Twurple v7
    this.chatClient.addListener('authenticationFailure', (message) => {
      logger.error('Authentication failure:', message);
      this.emit('error', new Error(`Authentication failure: ${message}`));
    });

    this.chatClient.addListener('disconnected', (manually, reason) => {
      logger.error('Chat disconnected:', { manually, reason });
      this.emit('error', new Error(`Chat disconnected: ${reason}`));
    });

    // Add general error handling through EventEmitter
    this.addListener('error', (error) => {
      logger.error('TwitchEventManager error:', error);
    });

    logger.debug('Event handlers set up successfully');
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

  async startStreamMonitoring() {
    // Check initial stream status for all channels
    for (const channel of this.channels) {
      try {
        const isLive = await this.isChannelLive(channel);
        if (isLive) {
          const user = await this.apiClient.users.getUserByName(channel);
          const stream = await this.apiClient.streams.getStreamByUserId(user.id);
          await this.handleStreamOnline(channel, stream);
        }
      } catch (error) {
        logger.error(`Error checking initial stream status for ${channel}:`, error);
      }
    }
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
      // Add a cooldown check
      const lastAnalysis = this.lastStreamAnalysis.get(channel);
      const now = Date.now();
      const ANALYSIS_COOLDOWN = 10 * 60 * 1000; // 10 minutes

      if (lastAnalysis && now - lastAnalysis < ANALYSIS_COOLDOWN) {
        logger.debug(`Skipping analysis for ${channel} - cooldown active`);
        return;
      }

      const streamData = {
        title: stream.title,
        game: stream.gameName,
        startTime: stream.startDate,
        thumbnailUrl: stream.thumbnailUrl
          .replace('{width}', '1280')
          .replace('{height}', '720')
      };

      // Only proceed if Claude handler exists and no recent message was sent
      if (this.claudeHandler?.anthropic) {
        // Check if Claude handler recently sent a message
        const lastAutonomousMessage = this.claudeHandler.lastAutonomousMessage.get(channel);
        if (lastAutonomousMessage && now - lastAutonomousMessage < ANALYSIS_COOLDOWN) {
          logger.debug(`Skipping analysis - Claude recently sent message in ${channel}`);
          return;
        }

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
        
        // Send the comment and update both tracking systems
        await this.chatClient.say(channel, `@${channel} ${comment}`);
        this.lastStreamAnalysis.set(channel, now);
        this.claudeHandler.lastAutonomousMessage.set(channel, now);
        
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

  // Add this method to set the Claude handler
  setCluadeHandler(handler) {
    this.claudeHandler = handler;
    logger.info('Claude handler set in TwitchEventManager');
  }

  // Add method to cleanup resources
  async cleanup() {
    try {
      // Stop EventSub listener
      if (this.eventSubListener) {
        await this.eventSubListener.stop();
      }
      
      // Clear any existing timers or monitors
      this.streamMonitors.clear();
      this.lastStreamAnalysis.clear();
      
      logger.info('TwitchEventManager cleanup completed');
    } catch (error) {
      logger.error('Error during TwitchEventManager cleanup:', error);
    }
  }

  // Add these utility methods
  isMod(userInfo) {
    return userInfo.isMod || userInfo.isBroadcaster;
  }

  isVip(userInfo) {
    return userInfo.isVip || userInfo.isMod || userInfo.isBroadcaster;
  }

  // Helper method to check broadcaster
  isBroadcaster(userInfo) {
    return userInfo.isBroadcaster;
  }

  // Helper method to check user levels
  getUserLevel(userInfo) {
    if (this.isBroadcaster(userInfo)) return 'broadcaster';
    if (this.isMod(userInfo)) return 'moderator';
    if (this.isVip(userInfo)) return 'vip';
    return 'user';
  }
}
