import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { MessageLogger } from '../utils/MessageLogger.js';
import TwitchEventManager from '../utils/TwitchEventManager.js';

class Stats {
  constructor(bot) {
    logger.startOperation('Initializing Stats Handler');
    this.bot = bot;
    this.startTime = new Date();
    logger.debug('Stats handler initialized');
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

    const parts = [];
    
    if (days > 0) parts.push(`${days}d`);
    if (hours % 24 > 0) parts.push(`${hours % 24}h`);
    if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
    parts.push(`${seconds % 60}s`);

    return parts.join(', ');
  }

  async handleStatsCommand(context) {
    const { channel, user } = context;
    logger.startOperation(`Processing stats command for ${user.username}`);
    
    try {
      const uptime = this.formatUptime(Date.now() - this.startTime.getTime());
      const ping = await this.getPing();
      const pingDisplay = ping >= 0 ? `${ping}ms` : 'unavailable';
      const memoryUsage = process.memoryUsage().heapUsed;
      const storageUsage = await this.getDirectorySize(process.cwd());

      const response = `@${user.username} • Uptime: ${uptime} • Ping: ${pingDisplay} • Memory: ${this.formatBytes(memoryUsage)} • Database: ${this.formatBytes(storageUsage)}`;
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
      logger.endOperation(`Processing stats command for ${user.username}`, true);
    } catch (error) {
      logger.error(`Error in handleStatsCommand: ${error}`);
      const errorResponse = `@${user.username}, an error occurred while fetching stats.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
      logger.endOperation(`Processing stats command for ${user.username}`, false);
    }
  }

  async getPing() {
    try {
      const start = Date.now();
      // Use the bot's apiClient instead of twitchService
      await this.bot.apiClient.users.getUserById('12826');  // Twitch's ID
      const ping = Date.now() - start;
      return ping;
    } catch (error) {
      logger.error(`Error in getPing: ${error}`);
      // Return a high number to indicate error instead of 0
      return -1;
    }
  }

  async handlePingCommand(context) {
    const { channel, user } = context;
    try {
      const ping = await this.getPing();
      const response = ping >= 0 
        ? `@${user.username}, Pong! Latency is ${ping}ms.`
        : `@${user.username}, Failed to measure latency.`;
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
      // Calculate uptime using the stored Date object
      const uptimeMs = Date.now() - this.startTime.getTime();
      const uptime = this.formatUptime(uptimeMs);
      const response = `@${user.username}, I've been running for ${uptime}.`;
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
    } catch (error) {
      logger.error(`Error in handleUptimeCommand: ${error.stack}`);
      const errorResponse = `@${user.username}, an error occurred while checking uptime.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }
}

export async function setupStats(bot) {
  logger.startOperation('Setting up Stats command');
  const stats = new Stats(bot);
  logger.endOperation('Setting up Stats command', true);
  return {
    stats: async (context) => await stats.handleStatsCommand(context),
    ping: async (context) => await stats.handlePingCommand(context),
    uptime: async (context) => await stats.handleUptimeCommand(context),
  };
}
