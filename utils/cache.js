import logger from './logger.js';
import NodeCache from 'node-cache';

class CacheHandler {
  constructor(options = {}) {
    logger.startOperation('Initializing CacheHandler');
    this.cache = new NodeCache({
      stdTTL: options.ttl || 3600, // Default 1 hour
      checkperiod: options.checkperiod || 600, // Check every 10 minutes
      useClones: false // Performance optimization
    });

    this.stats = {
      hits: 0,
      misses: 0,
      lastCleanup: Date.now()
    };

    this.metadata = new Map();
    this.cleanupInterval = options.cleanupInterval || 3600000; // 1 hour

    logger.debug('Cache initialized with options:', options);

    // Start cleanup interval
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  async get(key, fetchFn = null) {
    try {
      const value = this.cache.get(key);
      
      if (value !== undefined) {
        this.stats.hits++;
        logger.debug(`Cache hit for key: ${key}`);
        return value;
      }

      this.stats.misses++;
      logger.debug(`Cache miss for key: ${key}`);
      
      if (fetchFn) {
        const fetchedValue = await fetchFn();
        if (fetchedValue !== undefined) {
          this.set(key, fetchedValue);
        }
        return fetchedValue;
      }

      return null;
    } catch (error) {
      logger.error('Error getting from cache:', error);
      return null;
    }
  }

  set(key, value, ttl = undefined, metadata = {}) {
    try {
      this.cache.set(key, value, ttl);
      
      this.metadata.set(key, {
        ...metadata,
        timestamp: Date.now(),
        accessCount: 0
      });

      logger.debug(`Cached value for key: ${key}`);
      return true;
    } catch (error) {
      logger.error('Error setting cache:', error);
      return false;
    }
  }

  delete(key) {
    try {
      this.cache.del(key);
      this.metadata.delete(key);
      return true;
    } catch (error) {
      logger.error('Error deleting from cache:', error);
      return false;
    }
  }

  has(key) {
    return this.cache.has(key);
  }

  getMetadata(key) {
    return this.metadata.get(key);
  }

  updateMetadata(key, updates) {
    const current = this.metadata.get(key) || {};
    this.metadata.set(key, { ...current, ...updates });
  }

  cleanup() {
    try {
      const now = Date.now();
      
      // Log stats before cleanup
      logger.info('Cache stats before cleanup:', {
        ...this.stats,
        size: this.cache.getStats().keys,
        memoryUsage: process.memoryUsage().heapUsed
      });

      // Clear old metadata
      for (const [key, meta] of this.metadata.entries()) {
        if (!this.cache.has(key)) {
          this.metadata.delete(key);
        }
      }

      // Reset stats
      this.stats.hits = 0;
      this.stats.misses = 0;
      this.stats.lastCleanup = now;

    } catch (error) {
      logger.error('Error during cache cleanup:', error);
    }
  }

  getStats() {
    return {
      ...this.stats,
      keys: this.cache.keys().length,
      memory: process.memoryUsage().heapUsed,
      cacheStats: this.cache.getStats()
    };
  }
}

export function setupCache(options = {}) {
  return new CacheHandler(options);
}
