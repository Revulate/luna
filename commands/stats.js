import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import logger from '../logger.js';
import MessageLogger from '../MessageLogger.js';
import TwitchEventManager from '../TwitchEventManager.js';

class Stats {
  constructor(bot) {
    this.bot = bot;
    this.startTime = Date.now();
  }

  async getDirectorySize(directory) {
    let totalSize = 0;
    const files = await fs.readdir(directory);
    for (const file of files) {
      const filePath = path.join(directory, file);
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        totalSize += await this.getDirectorySize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
    return totalSize;
  }

  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return `${bytes.toFixed(2)}${units[i]}`;
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d, ${hours % 24}h, ${minutes % 60}m, ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h, ${minutes % 60}m, ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m, ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async handleStatsCommand(context) {
    const { channel, user } = context;
    try {
      const uptime = this.formatUptime(Date.now() - this.startTime);
      const ping = await this.getPing();
      const memoryUsage = process.memoryUsage().heapUsed;
      const storageUsage = await this.getDirectorySize(process.cwd());

      const response = `@${user.username} • Uptime: ${uptime} • Ping: ${ping}ms • Memory: ${this.formatBytes(memoryUsage)} • Database: ${this.formatBytes(storageUsage)}`;
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
    } catch (error) {
      logger.error(`Error in handleStatsCommand: ${error}`);
      const errorResponse = `@${user.username}, an error occurred while fetching stats.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async getPing() {
    try {
      const start = Date.now();
      await this.bot.twitchService.getUser('twitch');
      return Date.now() - start;
    } catch (error) {
      logger.error(`Error in getPing: ${error}`);
      return 0;
    }
  }

  async handlePingCommand(context) {
    const { channel, user } = context;
    try {
      const ping = await this.getPing();
      const response = `@${user.username}, Pong! Latency is ${ping}ms.`;
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
    } catch (error) {
      logger.error(`Error in handlePingCommand: ${error}`);
      const errorResponse = `@${user.username}, an error occurred while checking ping.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async handleUptimeCommand(context) {
    const { channel, user } = context;
    try {
      const uptime = this.formatUptime(Date.now() - this.startTime);
      const response = `@${user.username}, I've been running for ${uptime}.`;
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
    } catch (error) {
      logger.error(`Error in handleUptimeCommand: ${error}`);
      const errorResponse = `@${user.username}, an error occurred while checking uptime.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }
}

export async function setupStats(bot) {
  const stats = new Stats(bot);
  return {
    stats: async (context) => await stats.handleStatsCommand(context),
    ping: async (context) => await stats.handlePingCommand(context),
    uptime: async (context) => await stats.handleUptimeCommand(context),
  };
}
