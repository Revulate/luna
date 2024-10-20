import logger from './logger.js';

class BotStatusManager {
  constructor() {
    this.channelStatuses = new Map();
    this.lastMessageTime = new Map();
  }

  updateStatus(channel, badges) {
    const channelName = channel.replace('#', '');
    const canBypassRateLimit = badges.includes('moderator') || badges.includes('vip') || badges.includes('broadcaster');
    this.channelStatuses.set(channelName, canBypassRateLimit);
    logger.debug(`Updated bot status in ${channelName}: Can bypass rate limit: ${canBypassRateLimit}, Badges: ${badges.join(', ')}`);
  }

  canBypassRateLimit(channel) {
    const channelName = channel.replace('#', '');
    const canBypass = this.channelStatuses.get(channelName) ?? false;
    logger.debug(`Checking rate limit for ${channelName}: Can bypass: ${canBypass}, Stored status: ${this.channelStatuses.get(channelName)}`);
    return canBypass;
  }

  async customRateLimit(channel) {
    const channelName = channel.replace('#', '');
    if (this.canBypassRateLimit(channelName)) {
      logger.debug(`Bypassing rate limit for ${channelName} (Mod/VIP/Broadcaster)`);
      return;
    }

    const now = Date.now();
    const lastTime = this.lastMessageTime.get(channelName) || 0;
    const timeSinceLastMessage = now - lastTime;

    if (timeSinceLastMessage < 1200) { // 1.2 second rate limit to be safe
      const waitTime = 1200 - timeSinceLastMessage;
      logger.debug(`Applying custom rate limit for ${channelName}. Waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastMessageTime.set(channelName, now);
    logger.debug(`Updated last message time for ${channelName}: ${now}`);
  }

  async applyRateLimit(channel) {
    const channelName = channel.replace('#', '');
    if (!this.canBypassRateLimit(channelName)) {
      await this.customRateLimit(channelName);
    } else {
      logger.debug(`Skipping rate limit for ${channelName} (Can bypass)`);
    }
  }
}

export const botStatusManager = new BotStatusManager();
