import logger from './logger.js';
import { MessageLogger } from './MessageLogger.js';
import { ApiClient } from '@twurple/api';

class AutonomyHandler {
  constructor(chatClient, twitchEventManager, anthropic) {
    logger.startOperation('Initializing AutonomyHandler');
    this.chatClient = chatClient;
    this.twitchEventManager = twitchEventManager;
    this.anthropic = anthropic;
    this.apiClient = chatClient.apiClient;
    
    // Define constants here instead of importing
    this.CLAUDE_MODEL = "claude-3-sonnet-20240229";
    this.MAX_TOKENS = 85;
    this.TEMPERATURE = 0.8;
    
    // Autonomous chat settings
    this.lastAutonomousMessage = new Map();
    this.autonomousInterval = 5 * 60 * 1000; // 5 minutes
    this.autonomousChance = 0.15; // 15% chance
    
    // Add Twurple-specific tracking
    this.streamStates = new Map();
    this.userInteractions = new Map();
    this.channelMoods = new Map();
    
    logger.debug('AutonomyHandler initialized with settings', {
      model: this.CLAUDE_MODEL,
      interval: this.autonomousInterval,
      chance: this.autonomousChance
    });
    
    // Start autonomous chat if clients are available
    if (chatClient && twitchEventManager) {
      this.startAutonomousChat();
      this.setupStreamTracking();
    }
  }

  async setupStreamTracking() {
    // Use Twurple's EventSub for stream events
    for (const channel of this.twitchEventManager.getChannels()) {
      try {
        const user = await this.apiClient.users.getUserByName(channel);
        if (user) {
          this.streamStates.set(channel, {
            isLive: false,
            lastCheck: Date.now(),
            gameId: null,
            title: null
          });

          // Track stream state changes
          this.twitchEventManager.eventSubListener.onStreamOnline(user.id, async (e) => {
            await this.handleStreamOnline(channel, e);
          });

          this.twitchEventManager.eventSubListener.onStreamOffline(user.id, () => {
            this.handleStreamOffline(channel);
          });
        }
      } catch (error) {
        logger.error(`Error setting up stream tracking for ${channel}:`, error);
      }
    }
  }

  async handleStreamOnline(channel, streamData) {
    const state = this.streamStates.get(channel) || {};
    state.isLive = true;
    state.lastCheck = Date.now();
    state.gameId = streamData.gameId;
    state.title = streamData.title;
    this.streamStates.set(channel, state);

    // Generate welcome message
    await this.generateStreamStartMessage(channel, streamData);
  }

  handleStreamOffline(channel) {
    const state = this.streamStates.get(channel) || {};
    state.isLive = false;
    state.lastCheck = Date.now();
    this.streamStates.set(channel, state);
  }

  async generateStreamStartMessage(channel, streamData) {
    try {
      const prompt = `Generate a friendly stream start message for ${channel}'s stream:
        Title: ${streamData.title}
        Game: ${streamData.gameName}
        
        Create a natural, welcoming message that mentions the game/activity.
        Use 1-2 appropriate Twitch emotes.`;

      const response = await this.anthropic.messages.create({
        model: this.CLAUDE_MODEL,
        max_tokens: this.MAX_TOKENS,
        temperature: this.TEMPERATURE,
        system: "You are Luna (TatsLuna), a Gen Z Twitch chatbot...",
        messages: [{ role: "user", content: prompt }]
      });

      await this.chatClient.say(channel, response.content[0].text);
    } catch (error) {
      logger.error('Error generating stream start message:', error);
    }
  }

  startAutonomousChat() {
    if (!this.chatClient || !this.twitchEventManager) {
      logger.error('Cannot start autonomous chat: missing required clients');
      return;
    }

    setInterval(async () => {
      try {
        const channels = this.twitchEventManager.getChannels();
        logger.debug(`Checking autonomous chat for channels: ${channels.join(', ')}`);

        for (const channelName of channels) {
          try {
            await this.processChannelAutonomousChat(channelName);
          } catch (channelError) {
            logger.error(`Error processing autonomous chat for channel ${channelName}:`, channelError);
          }
        }
      } catch (error) {
        logger.error('Error in autonomous chat:', error);
      }
    }, 60000); // Check every minute
  }

  async processChannelAutonomousChat(channelName) {
    const lastMessage = this.lastAutonomousMessage.get(channelName) || 0;
    const now = Date.now();
    const AUTONOMOUS_COOLDOWN = 10 * 60 * 1000; // 10 minutes cooldown

    // Check if enough time has passed and RNG check passes
    if (now - lastMessage >= AUTONOMOUS_COOLDOWN && Math.random() < this.autonomousChance) {
      // Check if TwitchEventManager recently sent a message
      const lastAnalysis = this.twitchEventManager.lastStreamAnalysis.get(channelName);
      if (lastAnalysis && now - lastAnalysis < AUTONOMOUS_COOLDOWN) {
        logger.debug(`Skipping autonomous chat - recent analysis in ${channelName}`);
        return;
      }

      if (!await this.shouldSendAutonomousMessage(channelName)) {
        return;
      }

      await this.generateAndSendAutonomousMessage(channelName, now);
    }
  }

  async shouldSendAutonomousMessage(channelName) {
    const isLive = await this.twitchEventManager.isChannelLive(channelName);
    if (!isLive) {
      logger.debug(`Skipping autonomous chat for offline channel: ${channelName}`);
      return false;
    }

    const recentMessages = await MessageLogger.getRecentMessages(channelName, 10);
    if (!recentMessages || recentMessages.length === 0) {
      logger.debug(`No recent messages found for channel: ${channelName}`);
      return false;
    }

    return true;
  }

  async generateAndSendAutonomousMessage(channelName, timestamp) {
    const recentMessages = await MessageLogger.getRecentMessages(channelName, 10);
    const context = await this.buildMessageContext(channelName, recentMessages);

    const prompt = `Based on the current chat context and channel activity, generate a natural, engaging message to contribute to the conversation. Keep it casual and relevant to the ongoing discussion.

      Channel Context: ${JSON.stringify(context.channel)}
      Recent Messages: ${JSON.stringify(context.conversation.recentMessages)}
      Current Mood: ${context.channel.mood}

      Generate a single, natural chat message that fits the current conversation.`;

    const response = await this.anthropic.messages.create({
      model: this.CLAUDE_MODEL,
      max_tokens: this.MAX_TOKENS,
      temperature: this.TEMPERATURE,
      system: "You are Luna (TatsLuna), a Gen Z Twitch chatbot...",
      messages: [{ role: "user", content: prompt }]
    });

    const message = response.content[0].text.trim();
    
    await this.chatClient.say(channelName, message);
    await MessageLogger.logBotMessage(channelName, message);
    
    this.lastAutonomousMessage.set(channelName, timestamp);
    this.twitchEventManager.lastStreamAnalysis.set(channelName, timestamp);
    
    logger.info(`Sent autonomous message in ${channelName}: ${message}`);
  }

  async buildMessageContext(channelName, recentMessages) {
    // Simplified context building for autonomous messages
    return {
      channel: {
        name: channelName,
        mood: this.analyzeMood(recentMessages),
        activity: this.measureChannelActivity(recentMessages)
      },
      conversation: {
        recentMessages: this.formatMessages(recentMessages)
      }
    };
  }

  analyzeMood(messages) {
    // Implementation moved from ClaudeHandler
    // ... (keep existing mood analysis logic)
  }

  measureChannelActivity(messages) {
    // Implementation moved from ClaudeHandler
    // ... (keep existing activity measurement logic)
  }

  formatMessages(messages) {
    return messages.map(msg => ({
      content: msg.message,
      username: msg.username,
      timestamp: msg.timestamp
    }));
  }
}

export function setupAutonomy(chatClient, twitchEventManager, anthropic) {
  return new AutonomyHandler(chatClient, twitchEventManager, anthropic);
}
