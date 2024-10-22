import logger from './logger.js';
import NodeCache from 'node-cache';
import { config } from './config.js';  // Changed to named import

class BotStatusManager {
  constructor() {
    this.channelStatuses = new Map();
    this.lastMessageTime = new Map();
    this.statusCache = new NodeCache({ 
      stdTTL: config.cache.defaultTTL,
      checkPeriod: config.cache.checkPeriod  // Fixed typo in property name
    });
    
    // Add queue tracking
    this.messageQueues = new Map();
    this.processingQueues = new Map();
  }

  updateStatus(channel, badges) {
    const channelName = channel.replace('#', '');
    let canBypassRateLimit = false;

    if (typeof badges === 'object' && badges !== null) {
      canBypassRateLimit = 'moderator' in badges || 'vip' in badges || 'broadcaster' in badges;
    }

    this.channelStatuses.set(channelName, canBypassRateLimit);
    this.statusCache.set(channelName, {
      status: canBypassRateLimit,
      timestamp: Date.now()
    });
    
    logger.debug(`Updated bot status in ${channelName}: Can bypass rate limit: ${canBypassRateLimit}, Badges: ${JSON.stringify(badges)}`);
  }

  canBypassRateLimit(channel) {
    const channelName = channel.replace('#', '');
    const cached = this.statusCache.get(channelName);
    
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.status;
    }
    
    const canBypass = this.channelStatuses.get(channelName) ?? false;
    logger.debug(`Checking rate limit for ${channelName}: Can bypass: ${canBypass}, Stored status: ${this.channelStatuses.get(channelName)}`);
    return canBypass;
  }

  async customRateLimit(channel, isMention = false) {
    // Skip rate limit for mentions
    if (isMention) {
      return;
    }

    const channelName = channel.replace('#', '');
    if (this.canBypassRateLimit(channelName)) {
      return;
    }

    const now = Date.now();
    const lastTime = this.lastMessageTime.get(channelName) || 0;
    const timeSinceLastMessage = now - lastTime;

    if (timeSinceLastMessage < 1200) {
      await new Promise(resolve => setTimeout(resolve, 1200 - timeSinceLastMessage));
    }

    this.lastMessageTime.set(channelName, now);
  }

  async applyRateLimit(channel, isMention = false, priority = 0) {
    if (isMention) return; // Skip rate limit for mentions
    
    const channelName = channel.replace('#', '');
    if (this.canBypassRateLimit(channelName)) {
      return;
    }

    const now = Date.now();
    const lastTime = this.lastMessageTime.get(channelName) || 0;
    const delay = this.getMessageDelay(channelName, priority);
    const waitTime = Math.max(0, delay - (now - lastTime));

    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastMessageTime.set(channelName, Date.now());
  }

  getMessageDelay(channel, priority) {
    const isMod = this.canBypassRateLimit(channel);
    const baseDelay = isMod ? config.rateLimit.modDelay : config.rateLimit.defaultDelay;
    return Math.max(100, baseDelay - (priority * 100)); // Priority reduces delay
  }
}

export const botStatusManager = new BotStatusManager();
