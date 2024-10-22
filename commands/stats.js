import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import logger from '../logger.js';
import TwitchAPI from '../twitch_api.js';

class Stats {
  constructor(bot) {
    this.bot = bot;
    this.startTime = Date.now();
    this.twitchAPI = new TwitchAPI();
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

  async handleStatsCommand({ channel, user }) {
    try {
      const uptime = this.formatUptime(Date.now() - this.startTime);
      const ping = await this.getPing();
      const memoryUsage = process.memoryUsage().heapUsed;
      const storageUsage = await this.getDirectorySize(process.cwd());

      const response = `• Uptime: ${uptime} • Ping: ${ping}ms • Memory: ${this.formatBytes(memoryUsage)} • Database: ${this.formatBytes(storageUsage)}`;
      await this.bot.say(channel, response);
    } catch (error) {
      logger.error(`Error in handleStatsCommand: ${error}`);
      await this.bot.say(channel, `@${user.username}, an error occurred while fetching stats.`);
    }
  }

  async getPing() {
    const start = Date.now();
    try {
      // Use the Twitch API client directly
      await this.twitchAPI.apiClient.users.getUserByName('twitch');
      return Date.now() - start;
    } catch (error) {
      logger.error(`Error in getPing: ${error}`);
      return 0; // Return 0 if there's an error
    }
  }

  async handlePingCommand({ channel, user }) {
    try {
      const ping = await this.getPing();
      await this.bot.say(channel, `@${user.username}, Pong! Latency is ${ping}ms.`);
    } catch (error) {
      logger.error(`Error in handlePingCommand: ${error}`);
      await this.bot.say(channel, `@${user.username}, an error occurred while checking ping.`);
    }
  }

  // New method for handling the uptime command
  async handleUptimeCommand({ channel, user }) {
    try {
      const uptime = this.formatUptime(Date.now() - this.startTime);
      await this.bot.say(channel, `@${user.username}, I've been running for ${uptime}.`);
    } catch (error) {
      logger.error(`Error in handleUptimeCommand: ${error}`);
      await this.bot.say(channel, `@${user.username}, an error occurred while checking uptime.`);
    }
  }
}

export function setupStats(bot) {
  const stats = new Stats(bot);
  return {
    stats: (context) => stats.handleStatsCommand(context),
    ping: (context) => stats.handlePingCommand(context),
    uptime: (context) => stats.handleUptimeCommand(context), // Add this line
  };
}
