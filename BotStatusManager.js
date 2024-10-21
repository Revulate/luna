import logger from './logger.js';

class BotStatusManager {
  constructor() {
    this.channelStatuses = new Map();
    this.lastMessageTime = new Map();
  }

  updateStatus(channel, badges) {
    const channelName = channel.replace('#', '');
    let canBypassRateLimit = false;

    if (typeof badges === 'object' && badges !== null) {
      canBypassRateLimit = 'moderator' in badges || 'vip' in badges || 'broadcaster' in badges;
    }

    this.channelStatuses.set(channelName, canBypassRateLimit);
    logger.debug(`Updated bot status in ${channelName}: Can bypass rate limit: ${canBypassRateLimit}, Badges: ${JSON.stringify(badges)}`);
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
