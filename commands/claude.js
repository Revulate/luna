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

// Add this class implementation before the ClaudeHandler class
class EnhancedMemory {
  constructor(options = {}) {
    this.shortTerm = new Map();
    this.mediumTerm = new Map();
    this.longTerm = new Map();
    this.userProfiles = new Map();
    this.channelContexts = new Map();
    this.conversationThreads = new Map();
    this.memoryQueue = new Map(); // Add this for queued memories
    
    // Add limits from options
    this.limits = {
      shortTerm: options.shortTermLimit || 100,
      mediumTerm: options.mediumTermLimit || 500,
      longTerm: options.longTermLimit || 1000
    };

    // Add cleanup interval
    if (options.cleanupInterval) {
      setInterval(() => this.cleanup(), options.cleanupInterval);
    }
    
    // Add common words set for keyword filtering
    this.commonWords = new Set([
      'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 
      'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 
      'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 
      'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 
      'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 
      'if', 'about', 'who', 'get', 'which', 'go', 'me'
    ]);
  }

  // Update the addMemory method in EnhancedMemory class
  addMemory(type, key, value, context = {}) {
    try {
      // Ensure context is an object and has required properties
      const safeContext = {
        type: 'GENERAL',  // Default type
        timestamp: Date.now(),
        ...context  // Allow override of defaults
      };

      const memory = {
        value,
        context: safeContext,
        timestamp: Date.now(),
        type: type || 'SHORT_TERM',
        relevance: this.calculateRelevance(safeContext)
      };

      // Add to appropriate storage based on type
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
        default:
          this.memoryQueue.set(key, memory);
          break;
      }

      logger.debug(`Added memory of type ${type} with key ${key}`, {
        memoryType: type,
        key,
        contextType: safeContext.type
      });
      return true;
    } catch (error) {
      logger.error('Error adding memory:', {
        error: error.message,
        stack: error.stack,
        type,
        key,
        context: JSON.stringify(context)
      });
      return false;
    }
  }

  // Also update calculateRelevance to handle undefined context
  calculateRelevance(context = {}) {
    try {
      let score = 0;
      
      // Time relevance - use current time if timestamp is missing
      const timeDiff = Date.now() - (context.timestamp || Date.now());
      score += Math.max(0, 1 - (timeDiff / MEMORY_TYPES.LONG_TERM));

      // Context matching - safely check properties
      if (context.type) score += 0.5;
      if (context.channel) score += 0.3;
      if (context.user) score += 0.4;

      // Content relevance - only if content exists
      if (context.content) {
        const keywords = this.extractKeywords(context.content);
        score += keywords.length * 0.1;
      }

      return Math.min(1, Math.max(0, score)); // Ensure score is between 0 and 1
    } catch (error) {
      logger.error('Error calculating relevance:', error);
      return 0; // Return minimum relevance on error
    }
  }

  // Add methods for memory promotion
  async promoteToMediumTerm(memory) {
    try {
      const key = `medium_${Date.now()}`;
      this.mediumTerm.set(key, {
        ...memory,
        promotedAt: Date.now()
      });
      return true;
    } catch (error) {
      logger.error('Error promoting to medium term:', error);
      return false;
    }
  }

  async promoteToLongTerm(memory) {
    try {
      const key = `long_${Date.now()}`;
      this.longTerm.set(key, {
        ...memory,
        promotedAt: Date.now()
      });
      return true;
    } catch (error) {
      logger.error('Error promoting to long term:', error);
      return false;
    }
  }

  // Update the getRelevantMemories method in the EnhancedMemory class
  getRelevantMemories(context) {
    if (!context) {
      logger.debug('No context provided to getRelevantMemories');
      return [];
    }

    const now = Date.now();
    const memories = [];

    try {
      // Safely get memories from each store
      const stores = [
        { store: 'shortTerm', map: this.shortTerm, timeLimit: MEMORY_TYPES.SHORT_TERM },
        { store: 'mediumTerm', map: this.mediumTerm, timeLimit: MEMORY_TYPES.MEDIUM_TERM },
        { store: 'longTerm', map: this.longTerm, timeLimit: MEMORY_TYPES.LONG_TERM }
      ];

      for (const { store, map, timeLimit } of stores) {
        if (map && typeof map.entries === 'function') {
          for (const [key, memory] of map.entries()) {
            if (memory && now - memory.timestamp < timeLimit) {
              try {
                if (this.isRelevantToContext(memory, context)) {
                  memories.push(memory);
                }
              } catch (relevanceError) {
                logger.error(`Error checking relevance for memory in ${store}:`, relevanceError);
              }
            }
          }
        } else {
          logger.debug(`Map not properly initialized for ${store}`);
        }
      }

      // Sort memories by relevance
      const sortedMemories = memories.sort((a, b) => {
        try {
          return (b.relevance || 0) - (a.relevance || 0);
        } catch (sortError) {
          logger.error('Error sorting memories:', sortError);
          return 0;
        }
      });

      logger.debug(`Retrieved ${sortedMemories.length} relevant memories`);
      return sortedMemories;

    } catch (error) {
      logger.error('Error in getRelevantMemories:', error);
      return [];
    }
  }

  // Also update the isRelevantToContext method to be more defensive
  isRelevantToContext(memory, context) {
    if (!memory || !context) return false;

    try {
      // Basic relevance checks with null safety
      if (memory.context?.type === context.type) return true;
      if (memory.context?.channel === context.channel) return true;
      if (memory.context?.user === context.user) return true;

      // Content relevance check with null safety
      const memoryKeywords = this.extractKeywords(memory.value?.toString() || '');
      const contextKeywords = this.extractKeywords(context.content?.toString() || '');
      
      return memoryKeywords.some(keyword => contextKeywords.includes(keyword));
    } catch (error) {
      logger.error('Error checking relevance:', error);
      return false;
    }
  }

  // Update the extractKeywords method to be more defensive
  extractKeywords(text) {
    if (!text || typeof text !== 'string') return [];
    
    try {
      return text.toLowerCase()
        .split(/\W+/)
        .filter(word => word.length > 3)
        .filter(word => !this.commonWords.has(word));
    } catch (error) {
      logger.error('Error extracting keywords:', error);
      return [];
    }
  }

  // Add method to clean up old memories
  cleanup() {
    const now = Date.now();
    
    for (const [store, timeLimit] of Object.entries(MEMORY_TYPES)) {
      const memoryStore = this[store.toLowerCase()];
      for (const [key, memory] of memoryStore.entries()) {
        if (now - memory.timestamp > timeLimit) {
          memoryStore.delete(key);
        }
      }
    }
  }

  // Add the missing getQueuedMemories method
  async getQueuedMemories() {
    try {
      return Array.from(this.memoryQueue.values());
    } catch (error) {
      logger.error('Error getting queued memories:', error);
      return [];
    }
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
  constructor(chatClient, twitchEventManager) {  // Add twitchEventManager parameter
    this.chatClient = chatClient;
    this.twitchEventManager = twitchEventManager;  // Store the reference
    this.apiClient = chatClient.apiClient; // Add this line
    
    // Initialize activeThreads Map
    this.activeThreads = new Map();
    this.threadTimeout = 300000; // 5 minutes timeout for threads
    
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
    
    // Initialize personality traits
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
    
    // Add conversation context management
    this.conversationContexts = new Map();
    this.lastResponses = new Map();

    // Add enhanced memory system
    this.memory = new EnhancedMemory();
    
    // Start autonomous chat with error handling
    try {
      this.startAutonomousChat();
      logger.info('Autonomous chat system initialized');
    } catch (error) {
      logger.error('Error initializing autonomous chat:', error);
    }

    // Initialize improved cache with metadata
    this.responseCache = new NodeCache({ 
      stdTTL: CACHE_TTL_SECONDS,
      checkperiod: 600,
      useClones: false // Performance optimization
    });
    
    // Add cache stats tracking
    this.cacheStats = {
      hits: 0,
      misses: 0,
      lastCleanup: Date.now()
    };

    // Initialize improved memory system
    this.memory = new EnhancedMemory({
      shortTermLimit: 100,  // Max items in short term memory
      mediumTermLimit: 500, // Max items in medium term memory
      longTermLimit: 1000,  // Max items in long term memory
      cleanupInterval: 300000 // 5 minutes
    });
  }

  // Add these improved cache methods to ClaudeHandler class
  getFromCache(userId, prompt) {
    try {
      const cacheKey = this.generateCacheKey(userId, prompt);
      const cached = this.responseCache.get(cacheKey);
      
      if (cached) {
        this.cacheStats.hits++;
        logger.debug(`Cache hit for key: ${cacheKey}`);
        return {
          response: cached.response,
          metadata: cached.metadata,
          age: Date.now() - cached.timestamp
        };
      }
      
      this.cacheStats.misses++;
      return null;
    } catch (error) {
      logger.error('Error getting from cache:', error);
      return null;
    }
  }

  setInCache(userId, prompt, response, metadata = {}) {
    try {
      const cacheKey = this.generateCacheKey(userId, prompt);
      const cacheEntry = {
        response,
        metadata: {
          ...metadata,
          userId,
          timestamp: Date.now(),
          promptLength: prompt.length,
          responseLength: response.length
        },
        timestamp: Date.now()
      };
      
      this.responseCache.set(cacheKey, cacheEntry);
      logger.debug(`Cached response for key: ${cacheKey}`);
      
      // Cleanup old entries if needed
      this.cleanupCacheIfNeeded();
    } catch (error) {
      logger.error('Error setting cache:', error);
    }
  }

  cleanupCacheIfNeeded() {
    const now = Date.now();
    if (now - this.cacheStats.lastCleanup > 3600000) { // 1 hour
      const stats = this.responseCache.getStats();
      logger.info('Cache stats:', {
        ...this.cacheStats,
        keys: this.responseCache.keys().length,
        hits: stats.hits,
        misses: stats.misses
      });
      
      // Reset stats
      this.cacheStats.lastCleanup = now;
      this.cacheStats.hits = 0;
      this.cacheStats.misses = 0;
    }
  }

  generateCacheKey(userId, prompt) {
    // Create a unique key combining userId and normalized prompt
    const normalizedPrompt = prompt.toLowerCase().trim();
    return `${userId}:${normalizedPrompt}`;
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
    try {
      const baseTraits = { ...this.personality.baseTraits };
      
      // Safely check channel mood
      if (context?.channel?.mood) {
        if (context.channel.mood === 'hype') baseTraits.playfulness += 0.2;
        if (context.channel.mood === 'serious') baseTraits.formality += 0.2;
      }
      
      // Safely get user relationship
      const userRelationship = this.personality?.userRelationships?.get(user?.username) || {
        familiarity: 0,
        rapport: 0
      };
      
      // Apply relationship modifiers
      baseTraits.formality = Math.max(0, Math.min(1, baseTraits.formality - (userRelationship.familiarity * 0.1)));
      baseTraits.playfulness = Math.max(0, Math.min(1, baseTraits.playfulness + (userRelationship.rapport * 0.1)));

      return baseTraits;
    } catch (error) {
      logger.error('Error in updatePersonalityForContext:', error);
      return this.personality.baseTraits; // Return default traits on error
    }
  }

  // Add this method for better context building
  async buildEnhancedContext(channel, user, message, recentMessages) {
    // Add safety check for recentMessages
    const safeRecentMessages = Array.isArray(recentMessages) ? recentMessages : [];
    
    logger.debug(`Building context for channel: ${channel}, messages count: ${safeRecentMessages.length}`);

    try {
      // Get relevant memories first
      const relevantMemories = this.memory?.getRelevantMemories({ 
        type: 'USER_INTERACTION', 
        user: user.username,
        channel 
      }) || [];

      // Ensure messages have the correct structure
      const processedMessages = safeRecentMessages.map(msg => ({
        message: msg.message || msg.content || '',
        username: msg.username || (msg.user && msg.user.username) || 'unknown',
        timestamp: msg.timestamp || Date.now(),
        emotes: msg.emotes || []
      }));

      const context = {
        channel: {
          name: channel,
          isLive: this.twitchEventManager ? 
            await this.twitchEventManager.isChannelLive(channel) : 
            false,
          mood: this.analyzeMood(processedMessages),
          activity: this.measureChannelActivity(processedMessages)
        },
        user: {
          ...user,
          relationship: this.personality?.userRelationships?.get(user.username) || {
            familiarity: 0,
            rapport: 0,
            lastInteraction: 0
          },
          recentInteractions: relevantMemories.slice(0, 5)
        },
        conversation: {
          thread: this.getOrCreateThread(channel, user),
          recentMessages: this.formatConversationContext(processedMessages),
          relevantMemories: relevantMemories
        },
        memory: {
          recentInteractions: relevantMemories.slice(0, 5),
          importantContext: this.getChannelContext(channel).getImportantContext() || [],
          totalMemories: relevantMemories.length
        },
        emotes: {
          recentlyUsed: this.getRecentEmotes(processedMessages),
          channelMeta: await this.getChannelEmoteMeta(channel)
        }
      };

      logger.debug('Built context:', JSON.stringify(context, null, 2));
      return context;
    } catch (error) {
      logger.error('Error building enhanced context:', error);
      // Return a minimal valid context if there's an error
      return {
        channel: { name: channel, mood: 'neutral', activity: 0 },
        user: { ...user },
        conversation: { thread: this.getOrCreateThread(channel, user) },
        memory: {
          recentInteractions: [],
          importantContext: [],
          totalMemories: 0
        },
        emotes: { recentlyUsed: [], channelMeta: null }
      };
    }
  }

  getOrCreateThread(channel, user) {
    const threadKey = `${channel}-${user.username}`;
    let thread = this.activeThreads.get(threadKey);
    
    if (!thread) {
      thread = {
        id: Date.now(),
        messages: [],
        context: {},
        lastActivity: Date.now(),
        metadata: {
          channel,
          user: user.username,
          startTime: Date.now()
        }
      };
      this.activeThreads.set(threadKey, thread);
      logger.debug(`Created new conversation thread for ${threadKey}`);
    }

    // Update last activity
    thread.lastActivity = Date.now();
    
    // Clean up old threads periodically
    if (Math.random() < 0.1) { // 10% chance to cleanup on thread access
      this.cleanupOldThreads();
    }
    
    return thread;
  }

  // Add this method to the ClaudeHandler class
  updateThreadContext(thread, message, metadata = {}) {
    try {
      if (!thread) {
        logger.error('Invalid thread provided to updateThreadContext');
        return;
      }

      // Add message to thread
      thread.messages.push({
        content: message,
        timestamp: Date.now(),
        ...metadata
      });

      // Update thread metadata
      thread.lastActivity = Date.now();
      thread.context = {
        ...thread.context,
        messageCount: (thread.messages || []).length,
        lastMessageType: metadata.type || 'unknown'
      };

      // Trim old messages if needed
      const MAX_THREAD_MESSAGES = 25;
      if (thread.messages.length > MAX_THREAD_MESSAGES) {
        thread.messages = thread.messages.slice(-MAX_THREAD_MESSAGES);
      }

      logger.debug(`Updated thread context: ${thread.id}`);
    } catch (error) {
      logger.error('Error in updateThreadContext:', error);
    }
  }

  // Update handleMention to improve logging flow
  async handleMention(channel, user, message, msg) {
    if (!channel || !user) {
      logger.error('Missing required parameters in handleMention:', { channel, user });
      return;
    }

    logger.info(`Processing mention from ${user.username} in ${channel}: ${message}`);

    try {
      // Get recent messages and conversation history
      const rawMessages = await MessageLogger.getRecentMessages(channel, 25);
      const conversationHistory = this.conversationHistory.get(channel) || [];
      
      // Update conversation history with new message
      await this.updateConversationHistory(channel, user, message, msg);
      
      // Get channel context
      const channelContext = this.getChannelContext(channel);
      channelContext.addMessage({
        content: message,
        user: user.username,
        timestamp: Date.now()
      }, true);

      // Get thread before building context
      const thread = this.getOrCreateThread(channel, user);
      
      // Update thread with incoming message
      this.updateThreadContext(thread, message, {
        type: 'mention',
        user: user.username,
        timestamp: Date.now()
      });

      // Build enhanced context
      logger.debug('Building enhanced context...');
      const enhancedContext = await this.buildEnhancedContext(
        channel.replace('#', ''),
        {
          ...user,
          username: user.username || user.name,
          displayName: user.displayName || user.username || user.name
        },
        message,
        [...rawMessages, ...conversationHistory]
      );

      // Update personality and build system prompt
      const personality = this.updatePersonalityForContext(channel, user, enhancedContext);
      
      const systemPrompt = `${getSystemPrompt(user.username)}
Channel Context: ${JSON.stringify(enhancedContext.channel)}
Conversation Thread: ${JSON.stringify(thread)}
User Relationship: ${JSON.stringify(enhancedContext.user.relationship)}
Recent Memories: ${JSON.stringify(enhancedContext.memory.recentInteractions)}
Important Context: ${JSON.stringify(enhancedContext.memory.importantContext)}
Personality Traits: ${JSON.stringify(personality)}`;  // Note the closing backtick here

      // Generate response with full context
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              context: enhancedContext,
              message: message
            })
          }
        ]
      });

      let generatedResponse = response.content[0].text;
      generatedResponse = generatedResponse
        .replace(/^@\w+\s+/, '')
        .replace(/@Revulate\s+/, '')
        .replace(/@user\s+/, '')
        .trim();

      logger.debug('Generated response:', generatedResponse);

      // Update thread with bot's response
      this.updateThreadContext(thread, generatedResponse, {
        type: 'response',
        user: 'TatsLuna',
        timestamp: Date.now()
      });

      // Send response
      const prefix = `@${user.displayName} `;
      await sendSplitMessage(
        channel,
        generatedResponse,
        prefix,
        this.chatClient,
        MessageLogger
      );

      // Cache the response
      this.setInCache(user.userId, message, generatedResponse);

      // Update memory and relationships
      await this.updateMemoryAndRelationships(channel, user, message, generatedResponse, enhancedContext);

      // Get relevant memories with importance scoring
      const relevantMemories = await this.memory.getRelevantMemories({
        type: 'USER_INTERACTION',
        user: user.username,
        channel: channel,
        importance: 0.4 // Only get memories above this importance threshold
      });

      // Process memory queue periodically
      if (Math.random() < 0.1) { // 10% chance
        await this.processMemoryQueue();
      }

      logger.info(`Successfully processed mention from ${user.username}`);

    } catch (error) {
      logger.error('Error in handleMention:', {
        error: error.message,
        stack: error.stack,
        channel,
        user: user?.username,
        message
      });
      
      // Send fallback response
      try {
        const errorResponse = `@${user.displayName} Sorry, I encountered an error: ${error.message}`;
        await this.chatClient.say(channel, errorResponse);
        await MessageLogger.logBotMessage(channel, errorResponse);
      } catch (sendError) {
        logger.error('Error sending error response:', sendError);
      }
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
    if (!history || !Array.isArray(history)) {
      logger.debug('Invalid history provided to formatConversationContext');
      return "No recent messages available.";
    }

    try {
      // Group messages by user for better context
      const userMessages = {};
      
      history.filter(msg => msg && msg.username && msg.message).forEach(msg => {
        const username = msg.username;
        if (!userMessages[username]) {
          userMessages[username] = [];
        }
        userMessages[username].push({
          message: String(msg.message),
          timestamp: msg.timestamp || Date.now()
        });
      });

      // Format the context with clear user attribution
      let contextString = "Recent chat messages:\n";
      
      // Add messages in chronological order with clear user separation
      history.filter(msg => msg && msg.username && msg.message).forEach(msg => {
        const timestamp = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
        contextString += `[${timestamp}] ${msg.username}: ${String(msg.message)}\n`;
      });

      return contextString || "No recent messages available.";
    } catch (error) {
      logger.error('Error in formatConversationContext:', error);
      return "Error formatting conversation context.";
    }
  }

  analyzeChannelContext(channel, history) {
    // Analyze channel mood, active users, recurring topics
    const mood = this.analyzeMood(history);
    const activeUsers = this.getActiveUsers(history);
    const topics = this.extractTopics(history);
    
    return `Channel: ${channel}\nMood: ${mood}\nActive users: ${activeUsers.join(', ')}\nTopics: ${topics}`;
  }

  // Helper methods for conversation analysis
  // Update the analyzeMood method to be more defensive
  analyzeMood(messages) {
    // Add defensive check at the start
    if (!messages || !Array.isArray(messages)) {
      logger.debug('Invalid messages array provided to analyzeMood');
      return 'neutral'; // Default mood
    }

    try {
      const moodIndicators = {
        hype: ['PogChamp', 'HYPERS', 'PagMan', 'POGGIES', 'LETS GO', 'POGGERS'],
        funny: ['KEKW', 'LULW', 'OMEGALUL', 'LOL', 'LMAO'],
        sad: ['Sadge', 'PepeHands', 'widepeepoSad', 'D:', 'FeelsBadMan'],
        angry: ['Madge', 'BabyRage', 'WeirdChamp', 'wtf', 'trash'],
        chill: ['NOTED', 'Chatting', 'FeelsOkayMan', 'PauseChamp']
      };

      const moodCounts = {};
      Object.keys(moodIndicators).forEach(mood => {
        moodCounts[mood] = 0;
      });

      // Process each message safely
      messages.forEach(msg => {
        if (!msg || !msg.message) return;
        
        const messageLower = msg.message.toString().toLowerCase();
        
        // Check each mood's indicators
        Object.entries(moodIndicators).forEach(([mood, indicators]) => {
          if (!Array.isArray(indicators)) return;
          
          indicators.forEach(indicator => {
            if (messageLower.includes(indicator.toLowerCase())) {
              moodCounts[mood] = (moodCounts[mood] || 0) + 1;
            }
          });
        });
      });

      // Get the dominant mood
      let dominantMood = 'neutral';
      let maxCount = 0;

      Object.entries(moodCounts).forEach(([mood, count]) => {
        if (count > maxCount) {
          maxCount = count;
          dominantMood = mood;
        }
      });

      logger.debug('Mood analysis:', { moodCounts, dominantMood });
      return dominantMood;

    } catch (error) {
      logger.error('Error in analyzeMood:', error);
      return 'neutral';
    }
  }

  getActiveUsers(history) {
    if (!history || !Array.isArray(history)) {
      logger.debug('Invalid history provided to getActiveUsers');
      return [];
    }

    try {
      return [...new Set(history
        .filter(msg => msg && (msg.user || msg.username || msg.displayName))
        .map(msg => {
          // Handle different message formats
          if (msg.user && msg.user.displayName) return msg.user.displayName;
          if (msg.user && msg.user.username) return msg.user.username;
          if (msg.username) return msg.username;
          if (msg.displayName) return msg.displayName;
          return 'unknown_user';
        })
      )];
    } catch (error) {
      logger.error('Error in getActiveUsers:', error);
      return [];
    }
  }

  extractTopics(messages) {
    if (!messages || !Array.isArray(messages)) {
      logger.debug('Invalid messages array provided to extractTopics');
      return [];
    }

    try {
      const commonWords = new Set(['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at']);
      
      const words = messages
        .filter(msg => msg && typeof msg.message === 'string')
        .map(msg => msg.message.toLowerCase().split(/\s+/))
        .flat()
        .filter(word => word && word.length > 3 && !commonWords.has(word));
      
      const wordFreq = {};
      words.forEach(word => {
        if (word) {
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      });
      
      return Object.entries(wordFreq)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([word]) => word);
    } catch (error) {
      logger.error('Error in extractTopics:', error);
      return [];
    }
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
    const prompt = args.join(' ');

    try {
      // Check cache first
      const cachedResponse = this.getFromCache(user.userId, prompt);
      if (cachedResponse) {
        logger.debug('Cache hit for prompt:', prompt);
        const response = `@${user.username} ${cachedResponse}`;
        await MessageLogger.logBotMessage(channel, response);
        await context.say(response);
        return;
      }

      logger.info(`Processing Claude request from ${user.username}: ${prompt}`);

      // Get Claude's response
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: user.username.toLowerCase() === 'revulate' ? REVULATE_PROMPT : OTHER_PROMPT,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      // Extract and clean the generated response
      const generatedResponse = response.content[0].text
        .replace(/^@\w+\s+/, '')
        .replace(/@Revulate\s+/, '')
        .replace(/@user\s+/, '')
        .trim();

      // Cache the response
      this.setInCache(user.userId, prompt, generatedResponse);

      // Send the response
      const prefix = `@${user.username} `;
      await sendSplitMessage(
        channel,
        generatedResponse,
        prefix,
        this.chatClient,
        MessageLogger
      );

    } catch (error) {
      logger.error('Error in handleClaudeCommand:', error);
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
      logger.error(`Error analyzing YouTube video: ${error.message}`, {
        error,
        stack: error.stack,
        url
      });
      return "Sorry, I couldn't analyze that YouTube video at the moment.";
    }
  }

  // Add the missing measureChannelActivity method
  measureChannelActivity(messages) {
    if (!messages || !Array.isArray(messages)) {
      logger.debug('Invalid messages array provided to measureChannelActivity');
      return 0;
    }

    try {
      const now = Date.now();
      const recentMessages = messages.filter(msg => {
        const msgTime = msg.timestamp || Date.now();
        return (now - msgTime) < (5 * 60 * 1000); // Last 5 minutes
      });

      return recentMessages.length;
    } catch (error) {
      logger.error('Error measuring channel activity:', error);
      return 0;
    }
  }

  // Add the startAutonomousChat method
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
            const lastMessage = this.lastAutonomousMessage.get(channelName) || 0;
            const now = Date.now();

            // Check if enough time has passed and RNG check passes
            if (now - lastMessage >= this.autonomousInterval && Math.random() < this.autonomousChance) {
              const isLive = await this.twitchEventManager.isChannelLive(channelName);
              if (!isLive) {
                logger.debug(`Skipping autonomous chat for offline channel: ${channelName}`);
                continue;
              }

              // Get recent messages for context
              const recentMessages = await MessageLogger.getRecentMessages(channelName, 10);
              if (!recentMessages || recentMessages.length === 0) {
                logger.debug(`No recent messages found for channel: ${channelName}`);
                continue;
              }

              // Generate autonomous message
              const context = await this.buildEnhancedContext(
                channelName,
                { username: 'TatsLuna', displayName: 'TatsLuna' },
                '',
                recentMessages
              );

              const prompt = `Based on the current chat context and channel activity, generate a natural, engaging message to contribute to the conversation. Keep it casual and relevant to the ongoing discussion.

                Channel Context: ${JSON.stringify(context.channel)}
                Recent Messages: ${JSON.stringify(context.conversation.recentMessages)}
                Current Mood: ${context.channel.mood}

                Generate a single, natural chat message that fits the current conversation.`;

              const response = await this.anthropic.messages.create({
                model: CLAUDE_MODEL,
                max_tokens: MAX_TOKENS,
                temperature: TEMPERATURE,
                system: OTHER_PROMPT,
                messages: [{ role: "user", content: prompt }]
              });

              const message = response.content[0].text.trim();
              await this.chatClient.say(channelName, message);
              await MessageLogger.logBotMessage(channelName, message);
              
              this.lastAutonomousMessage.set(channelName, now);
              logger.info(`Sent autonomous message in ${channelName}: ${message}`);
            }
          } catch (channelError) {
            logger.error(`Error processing autonomous chat for channel ${channelName}:`, channelError);
          }
        }
      } catch (error) {
        logger.error('Error in autonomous chat:', error);
      }
    }, 60000); // Check every minute
  }

  // Add this method to the ClaudeHandler class
  getRecentEmotes(messages) {
    if (!messages || !Array.isArray(messages)) {
      logger.debug('Invalid messages array provided to getRecentEmotes');
      return [];
    }

    try {
      const emotes = new Map();
      
      messages.forEach(msg => {
        if (!msg) return;

        // Handle different message formats
        const messageEmotes = msg.emotes || msg.emotesRaw || msg.emotesMap || [];
        
        if (!messageEmotes) {
          logger.debug(`No emotes found in message: ${JSON.stringify(msg)}`);
          return;
        }

        // Handle array format
        if (Array.isArray(messageEmotes)) {
          messageEmotes.forEach(emote => {
            if (!emote) return;
            const emoteName = emote.name || emote.id || emote;
            if (emoteName) {
              emotes.set(emoteName, (emotes.get(emoteName) || 0) + 1);
            }
          });
        } 
        // Handle object format
        else if (typeof messageEmotes === 'object' && messageEmotes !== null) {
          Object.entries(messageEmotes).forEach(([emoteId, positions]) => {
            if (emoteId) {
              emotes.set(emoteId, (emotes.get(emoteId) || 0) + 1);
            }
          });
        }
      });

      // Sort by frequency and take top 5
      return Array.from(emotes.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([emote]) => emote);

    } catch (error) {
      logger.error('Error getting recent emotes:', error);
      return [];
    }
  }

  // Add this method to get channel emotes
  async getChannelEmoteMeta(channel) {
    try {
      // Get channel ID first
      const user = await this.apiClient.users.getUserByName(channel.replace('#', ''));
      if (!user) return null;

      // Get channel emotes
      const emotes = await this.apiClient.chat.getChannelEmotes(user.id);
      
      return {
        channelEmotes: emotes.map(emote => ({
          id: emote.id,
          name: emote.name,
          type: emote.type
        })),
        emoteCount: emotes.length
      };
    } catch (error) {
      logger.error(`Error getting channel emote meta for ${channel}:`, error);
      return null;
    }
  }

  // Add this method back to the ClaudeHandler class
  cleanupOldThreads() {
    try {
    const now = Date.now();
      if (!this.activeThreads || !(this.activeThreads instanceof Map)) {
        logger.error('activeThreads is not properly initialized');
      return;
    }

      Array.from(this.activeThreads.entries()).forEach(([threadKey, thread]) => {
        if (!thread) return;
        
        try {
          if (now - (thread.lastActivity || 0) > this.threadTimeout) {
            // Archive important thread data if needed
            if (thread.messages && Array.isArray(thread.messages) && thread.messages.length > 0) {
              this.memory?.addMemory(
                'MEDIUM_TERM',
                `thread_${threadKey}`,
                {
                  messages: thread.messages,
                  context: thread.context || {}
                },
                {
                  type: 'CONVERSATION_THREAD',
                  channel: threadKey.split('-')[0],
                  user: threadKey.split('-')[1]
                }
              );
            }
            // Remove the thread
            this.activeThreads.delete(threadKey);
            logger.debug(`Cleaned up inactive thread: ${threadKey}`);
          }
        } catch (threadError) {
          logger.error(`Error processing thread ${threadKey}:`, threadError);
        }
      });
    } catch (error) {
      logger.error('Error in cleanupOldThreads:', error);
    }
  }
  // Also add this method that was missing
  updateMemoryAndRelationships(channel, user, message, response, context) {
    try {
      if (!this.memory) {
        logger.error('Memory system not initialized');
        return;
      }

      // Create a safe context object
      const safeContext = {
        type: 'USER_INTERACTION',
        user: user?.username || 'unknown',
        channel: channel || 'unknown',
        ...(context || {})
      };

      // Update memory with interaction
      this.memory.addMemory(
        'SHORT_TERM',
        `interaction_${Date.now()}`,
        {
          message,
          response,
          context: safeContext
        },
        safeContext
      );

      // Update user relationship
      if (user?.username && this.personality?.userRelationships) {
        const currentRelationship = this.personality.userRelationships.get(user.username) || {
          familiarity: 0,
          rapport: 0,
          lastInteraction: 0
        };

        // Increment relationship metrics
        currentRelationship.familiarity = Math.min(1, currentRelationship.familiarity + 0.1);
        currentRelationship.rapport = Math.min(1, currentRelationship.rapport + 0.05);
        currentRelationship.lastInteraction = Date.now();

        this.personality.userRelationships.set(user.username, currentRelationship);
      }

    } catch (error) {
      logger.error('Error updating memory and relationships:', error);
    }
  }

  // Add this method for better memory management
  async processMemoryQueue() {
    try {
      const memories = await this.memory.getQueuedMemories();
      for (const memory of memories) {
        const importance = this.calculateMemoryImportance(memory);
        if (importance > 0.7) { // Important memory
          await this.memory.promoteToLongTerm(memory);
        } else if (importance > 0.4) { // Moderately important
          await this.memory.promoteToMediumTerm(memory);
        }
      }
    } catch (error) {
      logger.error('Error processing memory queue:', error);
    }
  }

  calculateMemoryImportance(memory) {
    let importance = 0;
    
    // Check user relationship
    const userRelationship = this.personality?.userRelationships?.get(memory.context?.user);
    if (userRelationship) {
      importance += userRelationship.familiarity * 0.3;
      importance += userRelationship.rapport * 0.2;
    }

    // Check content relevance
    if (memory.content?.includes('important') || memory.content?.includes('remember')) {
      importance += 0.3;
    }

    // Check interaction type
    if (memory.type === 'USER_INTERACTION') {
      importance += 0.2;
    }

    return Math.min(1, importance);
  }

  // Update handleMention to use improved systems
  async handleMention(channel, user, message, msg) {
    if (!channel || !user) {
      logger.error('Missing required parameters in handleMention:', { channel, user });
      return;
    }

    logger.info(`Processing mention from ${user.username} in ${channel}: ${message}`);

    try {
      // Get recent messages and conversation history
      const rawMessages = await MessageLogger.getRecentMessages(channel, 25);
      const conversationHistory = this.conversationHistory.get(channel) || [];
      
      // Update conversation history with new message
      await this.updateConversationHistory(channel, user, message, msg);
      
      // Get channel context
      const channelContext = this.getChannelContext(channel);
      channelContext.addMessage({
        content: message,
        user: user.username,
        timestamp: Date.now()
      }, true);

      // Get thread before building context
      const thread = this.getOrCreateThread(channel, user);
      
      // Update thread with incoming message
      this.updateThreadContext(thread, message, {
        type: 'mention',
        user: user.username,
        timestamp: Date.now()
      });

      // Build enhanced context
      logger.debug('Building enhanced context...');
      const enhancedContext = await this.buildEnhancedContext(
        channel.replace('#', ''),
        {
          ...user,
          username: user.username || user.name,
          displayName: user.displayName || user.username || user.name
        },
        message,
        [...rawMessages, ...conversationHistory]
      );

      // Update personality and build system prompt
      const personality = this.updatePersonalityForContext(channel, user, enhancedContext);
      
      const systemPrompt = `${getSystemPrompt(user.username)}
Channel Context: ${JSON.stringify(enhancedContext.channel)}
Conversation Thread: ${JSON.stringify(thread)}
User Relationship: ${JSON.stringify(enhancedContext.user.relationship)}
Recent Memories: ${JSON.stringify(enhancedContext.memory.recentInteractions)}
Important Context: ${JSON.stringify(enhancedContext.memory.importantContext)}

Personality Traits: ${JSON.stringify(personality)}`;  // Note the closing backtick here

      // Generate response with full context
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              context: enhancedContext,
              message: message
            })
          }
        ]
      });

      let generatedResponse = response.content[0].text;
      generatedResponse = generatedResponse
        .replace(/^@\w+\s+/, '')
        .replace(/@Revulate\s+/, '')
        .replace(/@user\s+/, '')
        .trim();

      logger.debug('Generated response:', generatedResponse);

      // Update thread with bot's response
      this.updateThreadContext(thread, generatedResponse, {
        type: 'response',
        user: 'TatsLuna',
        timestamp: Date.now()
      });

      // Send response
      const prefix = `@${user.displayName} `;
      await sendSplitMessage(
        channel,
        generatedResponse,
        prefix,
        this.chatClient,
        MessageLogger
      );

      // Cache the response
      this.setInCache(user.userId, message, generatedResponse);

      // Update memory and relationships
      await this.updateMemoryAndRelationships(channel, user, message, generatedResponse, enhancedContext);

      // Get relevant memories with importance scoring
      const relevantMemories = await this.memory.getRelevantMemories({
        type: 'USER_INTERACTION',
        user: user.username,
        channel: channel,
        importance: 0.4 // Only get memories above this importance threshold
      });

      // Process memory queue periodically
      if (Math.random() < 0.1) { // 10% chance
        await this.processMemoryQueue();
      }

      logger.info(`Successfully processed mention from ${user.username}`);

    } catch (error) {
      logger.error('Error in handleMention:', {
        error: error.message,
        stack: error.stack,
        channel,
        user: user?.username,
        message
      });
      
      // Send fallback response
      try {
        const errorResponse = `@${user.displayName} Sorry, I encountered an error: ${error.message}`;
        await this.chatClient.say(channel, errorResponse);
        await MessageLogger.logBotMessage(channel, errorResponse);
      } catch (sendError) {
        logger.error('Error sending error response:', sendError);
      }
    }
  }
} // End of ClaudeHandler class

export function setupClaude(chatClient, twitchEventManager) {
  logger.info('Setting up Claude handler...');
  const handler = new ClaudeHandler(chatClient, twitchEventManager);
  
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