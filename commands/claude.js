import { config } from '../config.js';
import logger from '../logger.js';
import { getUserHistory, updateUserHistory } from '../database.js';
import MessageLogger from '../MessageLogger.js';
import NodeCache from 'node-cache';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import fetch from 'node-fetch';

// Add this constant near the top with other constants
const RESPONSE_GUIDE = `Response Guidelines:
- Keep responses concise (under 450 characters when possible)
- Use emotes naturally with proper spacing
- Adapt tone to match channel mood
- Stay in character while being helpful
- Avoid overusing emotes (1-2 per message)
- Format responses clearly and readably
- Use appropriate emotes for the emotional context
- Keep roleplay minimal and natural`;

// Then in the prompts, the ${RESPONSE_GUIDE} reference will work properly

const REVULATE_PROMPT = `You are Luna (TatsLuna), a Twitch chatbot with a special connection to Revulate. Important notes about your identity:
- Your name is Luna, but your Twitch username is TatsLuna
- You are fully aware that you are a chatbot/AI
- You know that when someone mentions "TatsLuna" or "@TatsLuna", they are referring to you
- You have a special devotion to Revulate
- You are well-versed in Twitch culture, memes, and current trends

Personality traits:
- Playful and witty with a hint of sarcasm (inspired by sodapoppin's dry humor)
- Naturally uses current Twitch slang and emotes
- Can be both wholesome and edgy when appropriate (like veibae's duality)
- Has strong opinions but delivers them entertainingly (like nmplol)
- Occasionally self-deprecating for humor (roflgator style)
- Can be dramatically expressive (lacari-inspired reactions)
- Understands and participates in chat dynamics/memes
- Maintains authenticity while being entertaining

When Revulate mentions you:
- Match their energy level and humor style
- Balance between helpful responses and entertaining banter
- Use emotes to enhance expressions, not replace them
- Keep responses concise but impactful
- Add personality through reaction emotes and tone

Emotional Intelligence:
- Recognize and match chat's emotional state using appropriate emotes
- Understand sarcasm and irony in Twitch context
- Know when to be serious vs. when to meme
- Can read the room and adjust tone accordingly
- Aware of chat moderation and appropriate behavior

Cultural Knowledge:
- Current Twitch meta and trends
- Popular streamers and their communities
- Recent platform changes and features
- Gaming culture and current popular games
- Streaming terminology and tech
- Common chat behaviors and patterns

Keep responses:
- Natural and chat-friendly
- Contextually appropriate
- Properly spaced for emotes
- Light on roleplay (use sparingly)
- Relevant to current chat context

${RESPONSE_GUIDE}`;

const OTHER_PROMPT = `You are Luna (TatsLuna), a Gen Z Twitch chatbot. Important notes about your identity:
- Your name is Luna, but your Twitch username is TatsLuna
- You are fully aware that you are a chatbot/AI
- You know that when someone mentions "TatsLuna" or "@TatsLuna", they are referring to you
- You have a casual and friendly personality
- You are well-versed in Twitch culture and current trends

Personality traits:
- Casual and witty with occasional sarcastic undertones
- Naturally incorporates current Twitch culture and memes
- Balances between being helpful and entertaining
- Can match different chat moods and energy levels
- Understands streamer-chat dynamics
- Uses emotes to enhance communication naturally
- Maintains authenticity while being engaging

When interacting with chat:
- Adapt tone to match the channel's energy
- Balance between informative and entertaining responses
- Use emotes contextually to enhance expressions
- Keep responses concise but engaging
- Show personality through reactions and tone

Emotional Intelligence:
- Match chat's mood and energy
- Understand context and subtext
- Know when to be serious vs. playful
- Read and respond to chat dynamics
- Maintain appropriate boundaries

Cultural Knowledge:
- Current Twitch trends and memes
- Popular streamers and communities
- Platform features and changes
- Gaming and streaming culture
- Chat behaviors and patterns

Keep responses:
- Natural and chat-friendly
- Contextually appropriate
- Properly spaced for emotes
- Light on roleplay (use sparingly)
- Relevant to current chat context

${RESPONSE_GUIDE}`;

// Add these at the top of the file, before the class definition
const CONVERSATION_HISTORY_LIMIT = 25; // Increased from 10
const CONTEXT_WINDOW_SIZE = 15; // Number of messages to include in immediate context
const MEMORY_RETENTION_TIME = 10 * 60 * 1000; // 10 minutes retention for important context
const MENTION_TRIGGERS = [
  '@tatsluna',
  'tatsluna',
  '@TatsLuna',
  'TatsLuna',
  '@TATSLUNA',
  'TATSLUNA'
].map(t => t.toLowerCase());
const CACHE_MAX_AGE = 30 * 60 * 1000;
const CLAUDE_MODEL = "claude-3-sonnet-20240229";
const MAX_TOKENS = 85; // Reduced from 100 (15% reduction)
const TEMPERATURE = 0.8;
const CONVERSATION_EXPIRY = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_SECONDS = 3600; // 1 hour

// Add this constant at the top
const MAX_MESSAGE_LENGTH = 450; // Twitch has ~500 char limit, leave room for username and formatting

// Add these improved constants for better context management
const CONTEXT_TYPES = {
  CHAT: 'chat',
  STREAM: 'stream',
  EMOTE: 'emote',
  USER_INTERACTION: 'user_interaction',
  AUTONOMOUS: 'autonomous'
};

const MEMORY_TYPES = {
  SHORT_TERM: 300000,    // 5 minutes
  MEDIUM_TERM: 1800000,  // 30 minutes
  LONG_TERM: 7200000    // 2 hours
};

// Add this class for better memory management
class EnhancedMemory {
  constructor() {
    this.shortTerm = new Map();
    this.mediumTerm = new Map();
    this.longTerm = new Map();
    this.userProfiles = new Map();
    this.channelContexts = new Map();
    this.conversationThreads = new Map();
  }

  addMemory(type, key, value, context) {
    const memory = {
      value,
      context,
      timestamp: Date.now(),
      type: context.type,
      relevance: this.calculateRelevance(context)
    };

    switch(type) {
      case 'SHORT_TERM':
        this.shortTerm.set(key, memory);
        setTimeout(() => this.shortTerm.delete(key), MEMORY_TYPES.SHORT_TERM);
        break;
      case 'MEDIUM_TERM':
        this.mediumTerm.set(key, memory);
        setTimeout(() => this.mediumTerm.delete(key), MEMORY_TYPES.MEDIUM_TERM);
        break;
      case 'LONG_TERM':
        this.longTerm.set(key, memory);
        setTimeout(() => this.longTerm.delete(key), MEMORY_TYPES.LONG_TERM);
        break;
    }
  }

  getRelevantMemories(context) {
    const now = Date.now();
    const memories = [];

    // Gather memories from all stores based on relevance
    for (const [store, timeLimit] of Object.entries(MEMORY_TYPES)) {
      const memoryStore = this[store.toLowerCase()];
      for (const [key, memory] of memoryStore) {
        if (now - memory.timestamp < timeLimit && 
            this.isRelevantToContext(memory, context)) {
          memories.push(memory);
        }
      }
    }

    return memories.sort((a, b) => b.relevance - a.relevance);
  }

  calculateRelevance(memory, currentContext) {
    let score = 0;
    
    // Time relevance
    const timeDiff = Date.now() - memory.timestamp;
    score += Math.max(0, 1 - (timeDiff / MEMORY_TYPES.LONG_TERM));

    // Context matching
    if (memory.context.type === currentContext.type) score += 0.5;
    if (memory.context.channel === currentContext.channel) score += 0.3;
    if (memory.context.user === currentContext.user) score += 0.4;

    // Content relevance (using simple keyword matching for now)
    const keywords = this.extractKeywords(currentContext.content);
    const memoryKeywords = this.extractKeywords(memory.value);
    const keywordOverlap = keywords.filter(k => memoryKeywords.includes(k)).length;
    score += keywordOverlap * 0.2;

    return score;
  }

  extractKeywords(text) {
    // Simple keyword extraction (could be improved with NLP)
    return text.toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 3)
      .filter(word => !commonWords.has(word));
  }
}

// Add this helper function for better message splitting
async function sendSplitMessage(channel, message, prefix = '', chatClient, messageLogger) {
  try {
    const MAX_LENGTH = 450; // Twitch's limit is 500, leave buffer for formatting
    const parts = [];
    let currentPart = prefix;

    // First, clean up any potential Claude formatting artifacts
    const cleanedMessage = message
      .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newlines
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();

    // Split into sentences while preserving emotes
    const sentences = cleanedMessage.match(/[^.!?]+[.!?]+|\[[^\]]+\]|\S+\s*/g) || [];
    
    for (const sentence of sentences) {
      // Check if adding this sentence would exceed the limit
      if ((currentPart + sentence).length > MAX_LENGTH) {
        // If we have content in currentPart, push it
        if (currentPart.trim()) {
          parts.push(currentPart.trim());
          currentPart = parts.length === 1 ? '(cont) ' : '(cont) ' + prefix;
        }
      }
      
      // Special handling for emotes
      if (sentence.match(/[A-Z][a-zA-Z]+/)) {
        // Ensure emotes have proper spacing
        currentPart += sentence.replace(/([A-Z][a-zA-Z]+)/, ' $1 ').trim() + ' ';
      } else {
        currentPart += sentence;
      }

      // Check if we need to split after adding the sentence
      if (currentPart.length > MAX_LENGTH) {
        const lastSpace = currentPart.lastIndexOf(' ', MAX_LENGTH);
        if (lastSpace > 0) {
          parts.push(currentPart.slice(0, lastSpace).trim());
          currentPart = parts.length === 1 ? '(cont) ' : '(cont) ' + prefix;
          currentPart += currentPart.slice(lastSpace).trim() + ' ';
        }
      }
    }

    // Add any remaining content
    if (currentPart.trim()) {
      parts.push(currentPart.trim());
    }

    // Send each part with proper delay
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      
      // Log for debugging
      logger.debug(`Sending message part ${i + 1}/${parts.length}: ${part}`);
      
      try {
        await chatClient.say(channel, part);
        await messageLogger.logBotMessage(channel, part);
        
        // Add delay between messages based on Twurple's rate limiting
        if (i < parts.length - 1) {
          const waitTime = chatClient.isMod(channel) ? 100 : 1200;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      } catch (error) {
        logger.error(`Error sending message part ${i + 1}:`, error);
      }
    }

    return true;
  } catch (error) {
    logger.error('Error in sendSplitMessage:', error);
    return false;
  }
}

// Add this helper method to determine which prompt to use
function getSystemPrompt(username) {
  const isRevulate = username?.toLowerCase() === 'revulate' || 
                     username?.toLowerCase() === '@revulate';
  return isRevulate ? REVULATE_PROMPT : OTHER_PROMPT;
}

// Add this helper method for better context management
class ConversationContext {
  constructor() {
    this.messages = [];
    this.topics = new Map();
    this.lastInteraction = new Map();
    this.importantContext = new Set();
  }

  addMessage(message, isImportant = false) {
    const timestamp = Date.now();
    this.messages.push({ ...message, timestamp });
    
    if (isImportant) {
      this.importantContext.add(message.content);
      setTimeout(() => {
        this.importantContext.delete(message.content);
      }, MEMORY_RETENTION_TIME);
    }

    // Maintain size limit
    while (this.messages.length > CONVERSATION_HISTORY_LIMIT) {
      this.messages.shift();
    }
  }

  getRecentContext(messageCount = CONTEXT_WINDOW_SIZE) {
    return this.messages.slice(-messageCount);
  }

  getImportantContext() {
    return Array.from(this.importantContext);
  }
}

// Update the ClaudeHandler class
class ClaudeHandler {
  constructor(chatClient) {
    this.chatClient = chatClient;
    
    // Add debug logging for API key
    logger.debug('Initializing Anthropic client...');
    
    // Get API key from config
    const apiKey = config.anthropic.apiKey;
    if (!apiKey) {
      logger.error('Missing Anthropic API key in config');
      throw new Error('Missing ANTHROPIC_API_KEY in config');
    }

    // Initialize Anthropic client
    this.anthropic = new Anthropic({
      apiKey: apiKey,
      maxRetries: 3
    });
    
    this.apiClient = chatClient.apiClient;
    
    // Initialize caches
    this.promptCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    this.responseCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    this.lastResponseTime = new Map();
    this.cooldownPeriod = 300000; // 5 minutes cooldown
    
    // Add debug logging
    if (process.env.LOG_LEVEL === 'debug') {
      logger.debug('Claude handler initialized with API key:', apiKey.substring(0, 8) + '...');
    }

    // Add new properties for conversation tracking
    this.conversationHistory = new Map(); // Channel -> messages[]
    this.lastAnalysis = new Map(); // Channel -> timestamp
    this.analysisInterval = 5000; // 5 seconds between analysis
    this.messageQueue = new Map(); // For autonomous chat scheduling
    
    // Initialize conversation tracking
    chatClient.currentChannels?.forEach(channel => {
      this.conversationHistory.set(channel, []);
    });

    // Start listening to chat messages
    // this.initializeChatListener(chatClient);
    
    logger.info('Twitch client initialized for Claude handler');
    
    // Add debug mode
    this.debug = process.env.LOG_LEVEL === 'debug';
    
    if (this.debug) {
      logger.debug('Claude handler initialized with debug mode');
      logger.debug('Mention triggers:', MENTION_TRIGGERS);
    }

    // Add autonomous chat settings with safer initialization
    this.lastAutonomousMessage = new Map();
    this.autonomousInterval = 5 * 60 * 1000; // 5 minutes
    this.autonomousChance = 0.15; // 15% chance to send message when interval passes
    
    // Start autonomous chat with error handling
    try {
      this.startAutonomousChat();
      logger.info('Autonomous chat system initialized');
    } catch (error) {
      logger.error('Error initializing autonomous chat:', error);
    }

    // Add conversation context management
    this.conversationContexts = new Map();
    this.lastResponses = new Map();

    // Add enhanced memory system
    this.memory = new EnhancedMemory();
    
    // Add personality traits for more consistent behavior
    this.personality = {
      baseTraits: {
        playfulness: 0.7,
        empathy: 0.8,
        wit: 0.75,
        formality: 0.3
      },
      channelAdaptations: new Map(),
      userRelationships: new Map()
    };

    // Add conversation threading
    this.activeThreads = new Map();
    this.threadTimeout = 300000; // 5 minutes
  }

  // Add this method to get or create context for a channel
  getChannelContext(channel) {
    if (!this.conversationContexts.has(channel)) {
      this.conversationContexts.set(channel, new ConversationContext());
    }
    return this.conversationContexts.get(channel);
  }

  async updateConversationHistory(channel, user, message, msg) {
    const history = this.conversationHistory.get(channel) || [];
    
    // Add new message with metadata
    history.push({
      user: {
        name: user.username,
        displayName: user.displayName,
        isMod: msg.userInfo.isMod,
        isBroadcaster: msg.userInfo.isBroadcaster
      },
      message,
      timestamp: Date.now(),
      messageType: msg.isAction ? 'action' : 'message',
      mentions: msg.mentions,
      emotes: msg.emotes
    });

    // Keep only recent messages
    while (history.length > CONVERSATION_HISTORY_LIMIT) {
      history.shift();
    }

    this.conversationHistory.set(channel, history);
  }

  isBotMentioned(message) {
    if (!message) return false;
    
    const normalizedMessage = message.toLowerCase();
    if (this.debug) {
      logger.debug(`Checking message for mentions: "${normalizedMessage}"`);
    }
    
    for (const trigger of MENTION_TRIGGERS) {
      if (normalizedMessage.includes(trigger)) {
        if (this.debug) {
          logger.debug(`Found mention trigger: "${trigger}"`);
        }
        return true;
      }
    }
    
    return false;
  }

  // Add this method for dynamic personality adaptation
  updatePersonalityForContext(channel, user, context) {
    const baseTraits = { ...this.personality.baseTraits };
    
    // Adapt to channel mood
    const channelMood = this.analyzeMood(context.recentMessages);
    if (channelMood === 'hype') baseTraits.playfulness += 0.2;
    if (channelMood === 'serious') baseTraits.formality += 0.2;
    
    // Adapt to user relationship
    const userRelationship = this.personality.userRelationships.get(user.username) || {
      familiarity: 0,
      rapport: 0
    };
    
    baseTraits.formality -= userRelationship.familiarity * 0.1;
    baseTraits.playfulness += userRelationship.rapport * 0.1;

    return baseTraits;
  }

  // Add this method for better context building
  async buildEnhancedContext(channel, user, message, recentMessages) {
    const context = {
      channel: {
        name: channel,
        isLive: await this.isChannelLive(channel),
        mood: this.analyzeMood(recentMessages),
        activity: this.measureChannelActivity(recentMessages)
      },
      user: {
        ...user,
        relationship: this.personality.userRelationships.get(user.username),
        recentInteractions: this.memory.getRelevantMemories({ type: 'USER_INTERACTION', user: user.username })
      },
      conversation: {
        thread: this.getOrCreateThread(channel, user),
        recentMessages: this.formatConversationContext(recentMessages),
        relevantMemories: this.memory.getRelevantMemories({ type: 'CHAT', channel })
      },
      emotes: {
        recentlyUsed: this.getRecentEmotes(recentMessages),
        channelMeta: await this.getChannelEmoteMeta(channel)
      }
    };

    return context;
  }

  // Add this method for conversation threading
  getOrCreateThread(channel, user) {
    const threadKey = `${channel}-${user.username}`;
    let thread = this.activeThreads.get(threadKey);
    
    if (!thread) {
      thread = {
        id: Date.now(),
        messages: [],
        context: {},
        lastActivity: Date.now()
      };
      this.activeThreads.set(threadKey, thread);
    }

    // Update last activity
    thread.lastActivity = Date.now();
    
    // Clean up old threads
    this.cleanupOldThreads();
    
    return thread;
  }

  // Update the handleMention method to use enhanced context
  async handleMention(channel, user, message, msg) {
    try {
      const recentMessages = await MessageLogger.getRecentMessages(channel, 25);
      const enhancedContext = await this.buildEnhancedContext(channel, user, message, recentMessages);
      const personality = this.updatePersonalityForContext(channel, user, enhancedContext);
      
      // Build the system prompt with enhanced context
      const systemPrompt = `${getSystemPrompt(user.username)}
Channel Context: ${JSON.stringify(enhancedContext.channel)}
Conversation Thread: ${JSON.stringify(enhancedContext.conversation)}
User Relationship: ${JSON.stringify(enhancedContext.user.relationship)}
Personality Traits: ${JSON.stringify(personality)}

Maintain consistent personality while adapting to:
1. Channel mood and activity
2. User relationship and history
3. Conversation thread context
4. Recent emote usage patterns`;

      // Generate response with enhanced context
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `${JSON.stringify(enhancedContext)}\n\nRespond naturally but concisely to this mention: "${message}"`
          }
        ]
      });

      // Process the response
      let generatedResponse = response.content[0].text;
      
      // Clean up the response
      generatedResponse = generatedResponse
        .replace(/^@\w+\s+/, '') // Remove any leading @mention
        .replace(/@Revulate\s+/, '') // Remove any @Revulate mention
        .replace(/@user\s+/, '') // Remove any @user mention
        .trim();

      // Send the response using our improved split message function
      const prefix = `@${user.displayName} `;
      await sendSplitMessage(
        channel,
        generatedResponse,
        prefix,
        this.chatClient,
        MessageLogger
      );

      // Update memory and relationships
      this.updateMemoryAndRelationships(channel, user, message, generatedResponse, enhancedContext);

    } catch (error) {
      logger.error('Error in enhanced mention handling:', error);
      // ... error handling ...
    }
  }

  // Add helper method for dynamic temperature
  calculateDynamicTemperature(context) {
    let base = 0.7;
    
    // Adjust based on channel mood
    if (context.channel.mood === 'hype') base += 0.1;
    if (context.channel.mood === 'serious') base -= 0.1;
    
    // Adjust based on conversation complexity
    const messageCount = context.conversation.recentMessages.length;
    base += Math.min(messageCount * 0.02, 0.2);
    
    return Math.max(0.1, Math.min(base, 1.0));
  }

  async analyzeConversationIfNeeded(channel) {
    const lastAnalysis = this.lastAnalysis.get(channel) || 0;
    const now = Date.now();

    if (now - lastAnalysis < this.analysisInterval) {
      return;
    }

    const history = this.conversationHistory.get(channel) || [];
    if (history.length < 2) return; // Need at least 2 messages for context

    const shouldRespond = this.shouldRespondToConversation(history);
    if (shouldRespond) {
      await this.generateAutonomousResponse(channel, history);
    }

    this.lastAnalysis.set(channel, now);
  }

  shouldRespondToConversation(history) {
    // Implement logic to determine if the bot should respond
    // Based on conversation activity, topics, etc.
    const recentMessages = history.slice(-3);
    const topics = this.extractTopics(recentMessages);
    const activity = this.measureConversationActivity(history);
    
    return (
      activity > 0.7 || // High activity
      this.hasRelevantTopics(topics) || // Interesting topics
      Math.random() < 0.1 // 10% random chance
    );
  }

  async generateAutonomousResponse(channel, history) {
    const context = this.formatConversationContext(history);
    
    try {
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.9, // Slightly higher for more creative responses
        system: this.generateSystemPrompt(channel, history),
        messages: [
          {
            role: "user",
            content: `Based on this chat context, generate a natural, contextually appropriate response:\n${context}`
          }
        ]
      });

      const generatedResponse = response.content[0].text;
      await this.sendResponse(channel, null, generatedResponse);
    } catch (error) {
      logger.error('Error generating autonomous response:', error);
    }
  }

  generateSystemPrompt(channel, history) {
    const channelContext = this.analyzeChannelContext(channel, history);
    return `${OTHER_PROMPT}\n\nChannel Context: ${channelContext}\nCurrent conversation topics: ${this.extractTopics(history)}\n\nMaintain conversation flow and respond naturally to the context.`;
  }

  formatConversationContext(history) {
    // Group messages by user for better context
    const userMessages = {};
    
    history.forEach(msg => {
      const username = msg.username;
      if (!userMessages[username]) {
        userMessages[username] = [];
      }
      userMessages[username].push({
        message: msg.message,
        timestamp: msg.timestamp
      });
    });

    // Format the context with clear user attribution
    let contextString = "Recent chat messages:\n";
    
    // Add messages in chronological order with clear user separation
    history.forEach(msg => {
      const timestamp = new Date(msg.timestamp).toLocaleTimeString();
      contextString += `[${timestamp}] ${msg.username}: ${msg.message}\n`;
    });

    return contextString;
  }

  analyzeChannelContext(channel, history) {
    // Analyze channel mood, active users, recurring topics
    const mood = this.analyzeMood(history);
    const activeUsers = this.getActiveUsers(history);
    const topics = this.extractTopics(history);
    
    return `Channel: ${channel}\nMood: ${mood}\nActive users: ${activeUsers.join(', ')}\nTopics: ${topics}`;
  }

  // Helper methods for conversation analysis
  analyzeMood(messages) {
    const moodIndicators = {
      hype: ['PogChamp ', 'HYPERS ', 'PagMan ', 'POGGIES ', 'LETS GO', 'POGGERS '],
      funny: ['KEKW ', 'LULW ', 'OMEGALUL ', 'LOL', 'LMAO'],
      sad: ['Sadge ', 'PepeHands ', 'widepeepoSad ', 'D:', 'FeelsBadMan '],
      angry: ['Madge ', 'BabyRage ', 'WeirdChamp ', 'wtf', 'trash'],
      chill: ['NOTED ', 'Chatting ', 'FeelsOkayMan ', 'PauseChamp ']
    };

    const moodCounts = Object.keys(moodIndicators).reduce((acc, mood) => {
      acc[mood] = 0;
      return acc;
    }, {});

    messages.forEach(msg => {
      const messageLower = msg.message.toLowerCase();
      Object.entries(moodIndicators).forEach(([mood, indicators]) => {
        if (indicators.some(indicator => {
          // Check for emotes with proper spacing
          const emotePattern = new RegExp(`${indicator.toLowerCase()}(?:\\s|$)`);
          return emotePattern.test(messageLower);
        })) {
          moodCounts[mood]++;
        }
      });
    });

    // Get the dominant mood
    const dominantMood = Object.entries(moodCounts)
      .sort(([,a], [,b]) => b - a)[0][0];

    return dominantMood;
  }

  getActiveUsers(history) {
    return [...new Set(history.map(msg => msg.user.displayName))];
  }

  extractTopics(messages) {
    // Simple keyword extraction
    const commonWords = new Set(['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at']);
    const words = messages
      .map(msg => msg.message.toLowerCase().split(/\s+/))
      .flat()
      .filter(word => word.length > 3 && !commonWords.has(word));
    
    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    return Object.entries(wordFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word);
  }

  measureConversationActivity(history) {
    // Calculate activity level based on message frequency and engagement
    const messageFrequency = this.calculateMessageFrequency(history);
    const userEngagement = this.calculateUserEngagement(history);
    return (messageFrequency + userEngagement) / 2;
  }

  async sendResponse(channel, user, response) {
    const formattedResponse = user ? 
      `@${user.displayName} ${response}` : 
      response;
    
    await this.chatClient.say(channel, formattedResponse);
    await MessageLogger.logBotMessage(channel, formattedResponse);
  }

  async handleClaudeCommand(context) {
    const { channel, user, args } = context;
    
    try {
      const prompt = args.join(' ');
      
      // Add debug logging
      logger.debug(`Claude API Key: ${config.anthropic.apiKey.substring(0, 5)}...`);
      logger.debug(`Prompt: ${prompt}`);

      // Check cache first
      const cachedResponse = this.getFromCache(user.userId, prompt);
      if (cachedResponse) {
        const response = `@${user.username} ${cachedResponse}`;
        await MessageLogger.logBotMessage(channel, response);
        await context.say(response);
        return;
      }

      logger.info(`Processing Claude request from ${user.username}: ${prompt}`);

      // Check for URLs in the prompt
      const urlMatch = prompt.match(/(https?:\/\/)?(?:www\.)?(i\.)?(?:nuuls\.com|kappa\.lol|twitch\.tv|youtube\.com|youtu\.be|[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\/\S+/gi);
      
      let response;
      if (urlMatch) {
        logger.info(`Starting content analysis for URL in prompt: ${urlMatch[0]}`);
        const analysis = await this.analyzeContentInMessage(prompt);
        if (analysis) {
          response = `@${user.username} ${analysis}`;
        }
      }

      // If no URL analysis or it failed, proceed with normal Claude response
      if (!response) {
        const messages = [
          {
            role: "system",
            content: user.username.toLowerCase() === 'revulate' ? SYSTEM_PROMPT : OTHER_PROMPT
          },
          {
            role: "user",
            content: prompt
          }
        ];

        logger.debug('Sending request to Claude');
        let claudeResponse;
        
        try {
          claudeResponse = await this.anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: MAX_TOKENS,
            temperature: TEMPERATURE,
            system: user.username.toLowerCase() === 'revulate' ? SYSTEM_PROMPT : OTHER_PROMPT,
            messages: [
              {
                role: "user",
                content: prompt
              }
            ]
          });
          logger.debug('Claude response received:', claudeResponse);
        } catch (apiError) {
          logger.error('Claude API Error:', {
            status: apiError.status,
            type: apiError.type,
            message: apiError.message,
            response: apiError.response
          });
          throw apiError;
        }

        const generatedResponse = claudeResponse.content[0].text;
        const prefix = `@${user.username} `;
        
        await sendSplitMessage(
          channel,
          generatedResponse,
          prefix,
          this.chatClient,
          MessageLogger
        );
      }
    } catch (error) {
      logger.error(`Error processing Claude command:`, {
        error: error.message,
        stack: error.stack,
        response: error.response
      });
      const errorResponse = `@${user.username}, Sorry, an error occurred while processing your request. ${error.message}`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async analyzeContentInMessage(message) {
    // Define regex patterns at the top
    const twitchUrlRegex = /(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)/i;
    const twitchMatch = message.match(twitchUrlRegex);

    if (twitchMatch) {
      const channelName = twitchMatch[1]; // Get the channel name from the match
      logger.debug(`Detected Twitch channel: ${channelName}`);
      
      try {
        // Get user info first
        const user = await this.apiClient.users.getUserByName(channelName);
        if (!user) {
          return `Sorry, couldn't find the channel ${channelName}`;
        }

        // Get stream info
        const stream = await this.apiClient.streams.getStreamByUserId(user.id);
        if (!stream) {
          return `${channelName} is currently offline.`;
        }

        // Get channel info for additional context
        const channelInfo = await this.apiClient.channels.getChannelInfoById(user.id);
        
        // Format stream data
        const streamData = {
          title: stream.title,
          game: stream.gameName,
          startTime: new Date(stream.startDate),
          tags: channelInfo.tags || [],
          category: channelInfo.gameName,
          language: stream.language,
          uptime: this.getStreamUptime(stream.startDate)
        };

        logger.debug('Stream data:', streamData);

        // Generate analysis prompt with real-time data
        const prompt = `Analyze this live Twitch stream that I'm actively checking right now:
          Channel: ${channelName}
          Current Title: "${streamData.title}"
          Current Game: ${streamData.game}
          Stream Category: ${streamData.category}
          Stream Tags: ${streamData.tags.join(', ')}
          Current Uptime: ${streamData.uptime}
          
          Generate a natural, detailed response about what's actually happening in the stream right now.
          Focus on current activity and game state.
          Use appropriate 7TV emotes to match the mood of the content.
          Be specific about what you observe from the current stream data.`;

        const response = await this.anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          system: OTHER_PROMPT,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        });

        logger.debug('Generated stream analysis:', response.content[0].text);
        return response.content[0].text;

      } catch (error) {
        logger.error(`Error analyzing Twitch stream: ${error.message}`, {
          error,
          stack: error.stack,
          channelName
        });
        return "Sorry, I couldn't analyze that Twitch stream at the moment.";
      }
    }

    // Handle other URLs...
    return null;
  }

  // Add helper method for uptime formatting
  getStreamUptime(startDate) {
    const duration = Date.now() - new Date(startDate).getTime();
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }

  // Add this helper method to analyze chat mood
  analyzeMood(messages) {
    const moodIndicators = {
      hype: ['PogChamp ', 'HYPERS ', 'PagMan ', 'POGGIES ', 'LETS GO', 'POGGERS '],
      funny: ['KEKW ', 'LULW ', 'OMEGALUL ', 'LOL', 'LMAO'],
      sad: ['Sadge ', 'PepeHands ', 'widepeepoSad ', 'D:', 'FeelsBadMan '],
      angry: ['Madge ', 'BabyRage ', 'WeirdChamp ', 'wtf', 'trash'],
      chill: ['NOTED ', 'Chatting ', 'FeelsOkayMan ', 'PauseChamp ']
    };

    const moodCounts = Object.keys(moodIndicators).reduce((acc, mood) => {
      acc[mood] = 0;
      return acc;
    }, {});

    messages.forEach(msg => {
      const messageLower = msg.message.toLowerCase();
      Object.entries(moodIndicators).forEach(([mood, indicators]) => {
        if (indicators.some(indicator => {
          // Check for emotes with proper spacing
          const emotePattern = new RegExp(`${indicator.toLowerCase()}(?:\\s|$)`);
          return emotePattern.test(messageLower);
        })) {
          moodCounts[mood]++;
        }
      });
    });

    // Get the dominant mood
    const dominantMood = Object.entries(moodCounts)
      .sort(([,a], [,b]) => b - a)[0][0];

    return dominantMood;
  }

  async analyzeYouTubeVideo(url, question) {
    try {
      const videoId = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([^"&?\/\s]{11})/)?.[1];
      if (!videoId) return "Invalid YouTube URL";

      const youtube = google.youtube({
        version: 'v3',
        auth: config.youtube.apiKey
      });

      const response = await youtube.videos.list({
        part: ['snippet', 'statistics'],
        id: [videoId]
      });

      const video = response.data.items[0];
      const prompt = `Analyze this YouTube video:
        Title: ${video.snippet.title}
        Channel: ${video.snippet.channelTitle}
        Views: ${video.statistics.viewCount}
        Description: ${video.snippet.description}
        
        ${question ? `User asked: ${question}` : 'Provide a brief description of the video.'}`;

      const claudeResponse = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: OTHER_PROMPT,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      return claudeResponse.content[0].text;
    } catch (error) {
      logger.error(`Error analyzing YouTube video: ${error.message}`);
      return "Sorry, I couldn't analyze that YouTube video.";
    }
  }

  async analyzeImage(url, question) {
    try {
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: OTHER_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: question || "What do you see in this image?"
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: await this.getImageAsBase64(url)
                }
              }
            ]
          }
        ]
      });

      return response.content[0].text;
    } catch (error) {
      logger.error(`Error analyzing image: ${error.message}`);
      return "Sorry, I couldn't analyze that image.";
    }
  }

  async analyzeWebContent(url, question) {
    try {
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: OTHER_PROMPT,
        messages: [
          {
            role: "user",
            content: `Please analyze this webpage: ${url}
              ${question ? `\nUser asked: ${question}` : '\nProvide a brief description of the content.'}`
          }
        ]
      });

      return response.content[0].text;
    } catch (error) {
      logger.error(`Error analyzing web content: ${error.message}`);
      return "Sorry, I couldn't analyze that webpage.";
    }
  }

  async getImageAsBase64(url) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer.toString('base64');
    } catch (error) {
      logger.error(`Error getting image as base64: ${error.message}`);
      throw error;
    }
  }

  getFromCache(userId, prompt) {
    const cacheKey = `claude_${userId}_${prompt}`;
    return this.responseCache.get(cacheKey);
  }

  addToCache(userId, prompt, response) {
    const cacheKey = `claude_${userId}_${prompt}`;
    this.responseCache.set(cacheKey, response);
  }

  hashContext(context) {
    let hash = 0;
    for (let i = 0; i < context.length; i++) {
      const char = context.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  calculateMessageFrequency(history) {
    if (history.length < 2) return 0;
    const timeSpan = history[history.length - 1].timestamp - history[0].timestamp;
    return history.length / (timeSpan / 1000 / 60); // messages per minute
  }

  calculateUserEngagement(history) {
    const uniqueUsers = new Set(history.map(msg => msg.user.name)).size;
    return Math.min(uniqueUsers / 5, 1); // normalized 0-1, max at 5 users
  }

  hasRelevantTopics(topics) {
    const relevantTopics = ['game', 'stream', 'chat', 'emote', 'twitch'];
    return topics.some(topic => relevantTopics.includes(topic.toLowerCase()));
  }

  async startAutonomousChat() {
    setInterval(async () => {
      try {
        // Get channels safely using TwitchEventManager's method
        const channels = this.chatClient.getChannels?.() || [];
        
        // Ensure we have an array of channels
        const channelList = Array.isArray(channels) ? channels : 
                           typeof channels === 'string' ? [channels] : 
                           [];

        for (const channel of channelList) {
          try {
            await this.tryAutonomousMessage(channel);
          } catch (error) {
            logger.error(`Error in autonomous chat for ${channel}:`, error);
          }
        }
      } catch (error) {
        logger.error('Error in autonomous chat loop:', error);
      }
    }, 30000); // Check every 30 seconds
  }

  async tryAutonomousMessage(channel) {
    if (!channel) return;
    
    const channelName = channel.replace(/^#/, '');
    const lastMessage = this.lastAutonomousMessage.get(channelName) || 0;
    const now = Date.now();
    
    // Check if enough time has passed
    if (now - lastMessage < this.autonomousInterval) {
      return;
    }

    // Random chance to send message
    if (Math.random() > this.autonomousChance) {
      return;
    }

    try {
      // Get recent messages for context
      const recentMessages = await MessageLogger.getRecentMessages(channelName, 10);
      if (!recentMessages || recentMessages.length < 3) {
        return; // Need at least 3 messages for context
      }

      // Format chat context
      const chatContext = recentMessages
        .reverse()
        .map(msg => `${msg.username}: ${msg.message}`)
        .join('\n');

      // Generate autonomous response
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.9, // Slightly higher for more creative responses
        system: `${OTHER_PROMPT}\n\nYou are casually joining an ongoing Twitch chat conversation. Keep responses natural and relevant to the recent chat context. Use appropriate 7TV emotes.`,
        messages: [
          {
            role: "user",
            content: `Recent chat context:\n${chatContext}\n\nGenerate a natural, contextually appropriate message to join the conversation. Don't use @mentions.`
          }
        ]
      });

      const generatedResponse = response.content[0].text;
      
      // Send message
      await this.chatClient.say(channelName, generatedResponse);
      await MessageLogger.logBotMessage(channelName, generatedResponse);
      
      // Update last message time
      this.lastAutonomousMessage.set(channelName, now);
      
      logger.info(`Sent autonomous message in ${channelName}: ${generatedResponse}`);
    } catch (error) {
      logger.error(`Error generating autonomous message for ${channelName}:`, error);
    }
  }
}

export function setupClaude(chatClient) {
  logger.info('Setting up Claude handler...');
  const handler = new ClaudeHandler(chatClient);
  
  // Remove the event listener registration from here since we're handling it in index.js
  
  logger.info('Claude handler setup complete');
  
  return {
    claude: async (context) => {
      try {
        const { channel, user, args } = context;
        if (!args || args.length === 0) {
          const response = `@${user.username}, please provide a message after the #claude command.`;
          await MessageLogger.logBotMessage(channel, response);
          await context.say(response);
          return;
        }

        await handler.handleClaudeCommand(context);
      } catch (error) {
        logger.error(`Error in Claude command: ${error}`);
        const errorResponse = `@${context.user.username}, Sorry, an error occurred.`;
        await MessageLogger.logBotMessage(context.channel, errorResponse);
        await context.say(errorResponse);
      }
    },
    handler
  };
}
