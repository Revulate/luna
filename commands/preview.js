import { config } from '../config.js';
import logger from '../logger.js';

class PreviewHandler {
  constructor(bot) {
    this.bot = bot;
    this.clientId = config.twitch.clientId;
    this.clientSecret = config.twitch.clientSecret;
    if (!this.clientId || !this.clientSecret) {
      throw new Error("TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set in the environment variables.");
    }
  }

  async getChannelInfo(channelName) {
    try {
      const user = await this.bot.api.users.getUserByName(channelName);
      if (!user) return null;

      const channel = await this.bot.api.channels.getChannelInfoById(user.id);
      const stream = await this.bot.api.streams.getStreamByUserId(user.id);
      const videos = await this.bot.api.videos.getVideosByUser(user.id, { type: 'archive', limit: 1 });
      const lastVideo = videos.data.length > 0 ? videos.data[0] : null;

      return { user, channel, stream, lastVideo };
    } catch (error) {
      logger.error(`Error fetching channel info: ${error}`);
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

  async handlePreviewCommand(context) {
    const channelName = context.args[0];

    if (!channelName) {
      await context.bot.say(context.channel, `@${context.user.username}, please provide a channel name to get the preview information.`);
      return;
    }

    const retryCount = 3;
    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        logger.debug(`Getting info for channel '${channelName}' (Attempt ${attempt + 1})`);
        const channelData = await this.getChannelInfo(channelName);

        if (!channelData) {
          logger.error(`Invalid or missing channel information for '${channelName}'.`);
          await context.bot.say(context.channel, `@${context.user.username}, could not retrieve valid channel information for '${channelName}'. Please ensure the channel name is correct.`);
          return;
        }

        const { user: channelUser, channel: channelInfo, stream, lastVideo } = channelData;
        const now = new Date();

        if (stream) {
          const duration = stream.startDate ? now - stream.startDate : null;
          const status = duration ? `LIVE (${this.formatDuration(duration)})` : "LIVE";
          const viewers = stream.viewers ? `${stream.viewers.toLocaleString()} viewers` : "Unknown viewers";
          const thumbnailUrl = stream.thumbnailUrl ? stream.thumbnailUrl.replace("{width}", "").replace("{height}", "") : "No thumbnail available";

          const response = `@${context.user.username}, twitch.tv/${channelUser.name} | ` +
                           `Status: ${status} | ` +
                           `Viewers: ${viewers} | ` +
                           `Category: ${channelInfo.gameName || "Unknown"} | ` +
                           `Title: ${channelInfo.title || "No title"} | ` +
                           `Preview: ${thumbnailUrl}`;

          logger.info(`Sending preview response for ${channelName}: ${response}`);
          await context.bot.say(context.channel, response);
        } else {
          const status = "OFFLINE";
          let lastLive = "Unknown";
          if (lastVideo) {
            const timeSinceLive = now - lastVideo.creationDate;
            lastLive = this.formatDuration(timeSinceLive);
          }

          const response = `@${context.user.username}, twitch.tv/${channelUser.name} | ` +
                           `Status: ${status} | ` +
                           `Last Live: ${lastLive} ago | ` +
                           `Category: ${channelInfo.gameName || "Unknown"} | ` +
                           `Title: ${channelInfo.title || "No title"}`;

          logger.info(`Sending offline preview response for ${channelName}: ${response}`);
          await context.bot.say(context.channel, response);
        }

        logger.debug(`Sent preview info for '${channelName}' to chat.`);
        break;
      } catch (error) {
        logger.error(`Attempt ${attempt + 1} failed with error: ${error}`);
        if (attempt < retryCount - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          await context.bot.say(context.channel, `@${context.user.username}, an error occurred while processing your request. Please try again later.`);
        }
      }
    }
  }
}

export function setupPreview(bot) {
  const previewHandler = new PreviewHandler(bot);
  return {
    preview: async (context) => await previewHandler.handlePreviewCommand(context),
  };
}
