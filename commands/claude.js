import { config } from '../config.js';
import logger from '../utils/logger.js';
import { getUserHistory, updateUserHistory } from '../utils/database.js';
import { MessageLogger } from '../utils/MessageLogger.js';
import NodeCache from 'node-cache';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import fetch from 'node-fetch';
import { setupAutonomy } from '../utils/autonomy.js';

// 1. First consolidate all constants at the top of the file
const CONVERSATION_HISTORY_LIMIT = 25;
const CONTEXT_WINDOW_SIZE = 15;
const MEMORY_RETENTION_TIME = 10 * 60 * 1000; // 10 minutes
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
const MAX_TOKENS = 85;
const TEMPERATURE = 0.8;
const CONVERSATION_EXPIRY = 5 * 60 * 1000;
const CACHE_TTL_SECONDS = 3600;
const MAX_MESSAGE_LENGTH = 450;

// 2. Define enums/constant objects
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

// 3. Define response guides
const RESPONSE_GUIDE = `Response Guidelines:
1. Keep responses concise and natural
2. Use appropriate Twitch chat tone
3. Avoid excessive formatting
4. Stay within context
5. Be helpful but brief
6. Use emotes naturally
7. Maintain conversation flow`;

// 4. Define prompts using the single RESPONSE_GUIDE
const REVULATE_PROMPT = `You are Luna (TatsLuna), a Twitch chatbot with a special connection to Revulate...
${RESPONSE_GUIDE}`;

const OTHER_PROMPT = `You are Luna (TatsLuna), a Gen Z Twitch chatbot...
${RESPONSE_GUIDE}`;

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
  constructor(chatClient, twitchEventManager) {
    logger.startOperation('Initializing ClaudeHandler');
    this.chatClient = chatClient;
    this.twitchEventManager = twitchEventManager;
    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey
    });
    
    // Initialize caches and maps
    this.cache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS });
    this.lastResponseTime = new Map();
    this.lastAutonomousMessage = new Map();
    this.activeThreads = new Map();
    this.threadTimeout = CONVERSATION_EXPIRY;
    this.memory = new EnhancedMemory();
    
    logger.debug('Claude handler initialized with settings', {
      model: CLAUDE_MODEL,
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE
    });
  }

  async handleClaudeCommand(context) {
    const { channel, user, args } = context;
    logger.startOperation(`Processing Claude command from ${user.username}`);

    try {
      if (!args.length) {
        const response = `@${user.username}, Please provide a message after the #claude command.`;
        await MessageLogger.logBotMessage(channel, response);
        await context.say(response);
        logger.endOperation(`Processing Claude command from ${user.username}`, false);
        return;
      }

      const prompt = args.join(' ');
      logger.debug('Processing prompt:', { prompt });

      // Get conversation thread
      const thread = this.getOrCreateThread(channel, user);
      
      // Build enhanced context
      const enhancedContext = await this.buildEnhancedContext(channel, user, prompt);
      
      // Generate response
      const response = await this.generateResponse(prompt, enhancedContext);
      
      if (response) {
        const formattedResponse = `@${user.username} ${response}`;
        await MessageLogger.logBotMessage(channel, formattedResponse);
        await context.say(formattedResponse);
        
        // Update thread
        this.updateThreadContext(thread, response, {
          type: 'response',
          user: 'TatsLuna',
          timestamp: Date.now()
        });
      }

      logger.endOperation(`Processing Claude command from ${user.username}`, true);
    } catch (error) {
      logger.error('Error in Claude command:', error);
      const errorResponse = `@${user.username}, Sorry, an error occurred.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
      logger.endOperation(`Processing Claude command from ${user.username}`, false);
    }
  }

  async handleMention(channel, user, message) {
    try {
      // Get system prompt based on user
      const systemPrompt = getSystemPrompt(user.username);

      // Get or create conversation thread
      const thread = this.getOrCreateThread(channel, user);

      // Build enhanced context
      const enhancedContext = await this.buildEnhancedContext(channel, user, message);

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

  // ... keep all other class methods ...
}

// Single export at the end
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

export default {
  async execute({ channel, user, args, say }) {
    try {
      const handler = new ClaudeHandler();
      const input = args.join(' ');
      
      if (!input) {
        const response = `@${user.username}, Please provide a message after the #claude command.`;
        await say(response);
        return;
      }

      const response = await handler.generateResponse(input);
      const formattedResponse = `@${user.username} ${response}`;
      await say(formattedResponse);
    } catch (error) {
      logger.error('Error executing Claude command:', error);
      await say('Sorry, I encountered an error processing your request.');
    }
  }
};
