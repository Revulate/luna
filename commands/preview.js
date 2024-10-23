import logger from '../logger.js';

class PreviewHandler {
  constructor(bot) {
    this.bot = bot;
    this.apiClient = bot.api;
  }

  cleanChannelName(channelName) {
    // Remove twitch.tv/ prefix if present
    return channelName.replace(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\//, '')
                     .replace(/[^a-zA-Z0-9_]/g, ''); // Remove any invalid characters
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

      const [channel, stream] = await Promise.all([
        this.apiClient.channels.getChannelInfoById(user.id),
        this.apiClient.streams.getStreamByUserId(user.id)
      ]);

      return { user, channel, stream };
    } catch (error) {
      logger.error(`Error fetching channel info for ${channelName}: ${error}`);
      return null;
    }
  }

  async handlePreviewCommand(context) {
    const channelName = context.args[0];

    if (!channelName) {
      await this.bot.say(context.channel, 
        `@${context.user.username}, please provide a channel name.`);
      return;
    }

    try {
      const channelData = await this.getChannelInfo(channelName);
      if (!channelData) {
        await this.bot.say(context.channel, 
          `@${context.user.username}, channel not found.`);
        return;
      }

      const { user, channel, stream } = channelData;
      
      if (stream) {
        await this.bot.say(context.channel,
          `@${context.user.username}, twitch.tv/${user.name} | ` +
          `Status: LIVE | ` +
          `Viewers: ${stream.viewers.toLocaleString()} | ` +
          `Category: ${channel.gameName || "Unknown"} | ` +
          `Title: ${channel.title || "No title"}`
        );
      } else {
        await this.bot.say(context.channel,
          `@${context.user.username}, twitch.tv/${user.name} | ` +
          `Status: OFFLINE | ` +
          `Category: ${channel.gameName || "Unknown"} | ` +
          `Title: ${channel.title || "No title"}`
        );
      }
    } catch (error) {
      logger.error(`Error in preview command: ${error}`);
      await this.bot.say(context.channel,
        `@${context.user.username}, an error occurred while fetching channel info.`);
    }
  }
}

export function setupPreview(bot) {
  const previewHandler = new PreviewHandler(bot);
  return {
    preview: async (context) => await previewHandler.handlePreviewCommand(context),
  };
}
