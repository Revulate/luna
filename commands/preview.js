import logger from '../logger.js';
import { config } from '../config.js';
import MessageLogger from '../MessageLogger.js';

class PreviewHandler {
  constructor(chatClient) {
    this.chatClient = chatClient;
    this.apiClient = chatClient.apiClient;
  }

  cleanChannelName(channelName) {
    return channelName.replace(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\//, '')
                     .replace(/[^a-zA-Z0-9_]/g, '')
                     .toLowerCase();
  }

  async getChannelInfo(channelName) {
    try {
      const cleanName = this.cleanChannelName(channelName);
      logger.debug(`Looking up channel: ${cleanName}`);

      const user = await this.apiClient.users.getUserByName(cleanName);
      if (!user) {
        logger.debug(`No user found for channel: ${cleanName}`);
        return null;
      }

      // Get channel info, stream data, and videos concurrently
      const [channel, stream, videos] = await Promise.all([
        this.apiClient.channels.getChannelInfoById(user.id),
        this.apiClient.streams.getStreamByUserId(user.id),
        this.apiClient.videos.getVideosByUser(user.id, { type: 'archive', limit: 1 })
      ]);

      const lastVideo = videos.data.length > 0 ? videos.data[0] : null;

      return { user, channel, stream, lastVideo };
    } catch (error) {
      logger.error(`Error fetching channel info for ${channelName}:`, error);
      return null;
    }
  }

  formatDuration(duration) {
    if (!duration) return "Unknown duration";
    const parts = [];
    const days = Math.floor(duration / (24 * 60 * 60 * 1000));
    const hours = Math.floor((duration / (60 * 60 * 1000)) % 24);
    const minutes = Math.floor((duration / (60 * 1000)) % 60);
    const seconds = Math.floor((duration / 1000) % 60);

    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(" ");
  }

  async handlePreview(context) {
    const { channel, user, args } = context;
    
    if (!args.length) {
      const response = `@${user.username}, Please provide a channel name to preview.`;
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
      return;
    }

    const targetChannel = args[0];
    const retryCount = 3;
    
    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        logger.debug(`Getting info for channel '${targetChannel}' (Attempt ${attempt + 1})`);
        const info = await this.getChannelInfo(targetChannel);
        
        if (!info || !info.user) {
          const response = `@${user.username}, Channel not found: ${targetChannel}`;
          await MessageLogger.logBotMessage(channel, response);
          await context.say(response);
          return;
        }

        const { user: channelUser, channel: channelInfo, stream, lastVideo } = info;
        const now = new Date();

        let response;
        if (stream) {
          const duration = stream.startDate ? now - new Date(stream.startDate) : null;
          const status = duration ? `LIVE (${this.formatDuration(duration)})` : "LIVE";
          const viewers = stream.viewers ? `${stream.viewers.toLocaleString()} viewers` : "Unknown viewers";
          const thumbnailUrl = stream.thumbnailUrl ? 
            stream.thumbnailUrl.replace("{width}", "1280").replace("{height}", "720") : 
            "No thumbnail available";

          response = `@${user.username}, twitch.tv/${channelUser.name} | ` +
                    `Status: ${status} | ` +
                    `Viewers: ${viewers} | ` +
                    `Category: ${channelInfo.gameName || "Unknown"} | ` +
                    `Title: ${channelInfo.title || "No title"} | ` +
                    `Preview: ${thumbnailUrl}`;
        } else {
          const status = "OFFLINE";
          let lastLive = "Unknown";
          if (lastVideo) {
            const timeSinceLive = now - new Date(lastVideo.creationDate);
            lastLive = this.formatDuration(timeSinceLive);
          }

          response = `@${user.username}, twitch.tv/${channelUser.name} | ` +
                    `Status: ${status} | ` +
                    `Last Live: ${lastLive} ago | ` +
                    `Category: ${channelInfo.gameName || "Unknown"} | ` +
                    `Title: ${channelInfo.title || "No title"}`;
        }

        await MessageLogger.logBotMessage(channel, response);
        await context.say(response);
        break; // Success, exit retry loop

      } catch (error) {
        logger.error(`Attempt ${attempt + 1} failed with error:`, error);
        if (attempt === retryCount - 1) {
          const errorResponse = `@${user.username}, Sorry, there was an error fetching channel information.`;
          await MessageLogger.logBotMessage(channel, errorResponse);
          await context.say(errorResponse);
        } else {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
        }
      }
    }
  }
}

export function setupPreview(chatClient) {
  const handler = new PreviewHandler(chatClient);
  
  return {
    preview: async (context) => await handler.handlePreview(context)
  };
}
