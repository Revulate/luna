import logger from './logger.js';

class MemoryHandler {
  constructor(options = {}) {
    logger.startOperation('Initializing MemoryHandler');
    this.shortTerm = new Map();
    this.mediumTerm = new Map();
    this.longTerm = new Map();
    this.userProfiles = new Map();
    this.channelContexts = new Map();
    this.conversationThreads = new Map();
    this.memoryQueue = new Map();
    this.twitchMemory = {
      userProfiles: new Map(),
      channelStates: new Map(),
      streamHistory: new Map()
    };
    
    this.limits = {
      shortTerm: options.shortTermLimit || 100,
      mediumTerm: options.mediumTermLimit || 500,
      longTerm: options.longTermLimit || 1000
    };

    if (options.cleanupInterval) {
      setInterval(() => this.cleanup(), options.cleanupInterval);
    }

    logger.debug('Memory handler initialized with options:', options);
  }

  async addMemory(type, key, value, context = {}) {
    try {
      logger.debug(`Adding memory of type ${type}`, { key });
      
      const memory = {
        value,
        context: {
          type: 'GENERAL',
          timestamp: Date.now(),
          ...context
        },
        timestamp: Date.now(),
        type: type || 'SHORT_TERM',
        relevance: this.calculateRelevance(context)
      };

      this.storeMemory(type, key, memory);
      logger.debug(`Memory stored successfully`, { type, key });
      return true;
    } catch (error) {
      logger.error('Error adding memory:', { error, type, key });
      return false;
    }
  }

  storeMemory(type, key, memory) {
    const store = this.getStoreForType(type);
    if (store) {
      store.set(key, memory);
      this.scheduleCleanup(type, key);
    }
  }

  getStoreForType(type) {
    switch(type) {
      case 'SHORT_TERM': return this.shortTerm;
      case 'MEDIUM_TERM': return this.mediumTerm;
      case 'LONG_TERM': return this.longTerm;
      default: return this.memoryQueue;
    }
  }

  scheduleCleanup(type, key) {
    const timeouts = {
      SHORT_TERM: 5 * 60 * 1000,    // 5 minutes
      MEDIUM_TERM: 30 * 60 * 1000,  // 30 minutes
      LONG_TERM: 2 * 60 * 60 * 1000 // 2 hours
    };

    const timeout = timeouts[type];
    if (timeout) {
      setTimeout(() => {
        const store = this.getStoreForType(type);
        store?.delete(key);
      }, timeout);
    }
  }

  async addTwitchMemory(type, key, value, context = {}) {
    try {
      const memory = {
        value,
        context,
        timestamp: Date.now(),
        type: type || 'USER_PROFILE'
      };

      switch (type) {
        case 'USER_PROFILE':
          this.twitchMemory.userProfiles.set(key, memory);
          break;
        case 'CHANNEL_STATE':
          this.twitchMemory.channelStates.set(key, memory);
          break;
        case 'STREAM_HISTORY':
          const history = this.twitchMemory.streamHistory.get(key) || [];
          history.push(memory);
          this.twitchMemory.streamHistory.set(key, history);
          break;
      }
    } catch (error) {
      logger.error('Error adding Twitch memory:', error);
    }
  }

  // ... (continue with rest of memory management methods)
}

export function setupMemory(options = {}) {
  return new MemoryHandler(options);
}
