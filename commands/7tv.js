import logger from '../logger.js';
import SevenTvApi from '../sevenTvApi.js';

class SevenTVHandler {
  constructor(chatClient) {
    this.chatClient = chatClient;
    this.apiClient = chatClient.apiClient;
    this.sevenTvApi = new SevenTvApi();
  }

  async handleEmoteCommand(context) {
    const { user, args, channel } = context;

    if (!args.length) {
      await context.say(`@${user.username}, Usage: #emote <emote_name>`);
      return;
    }

    const emoteName = args.join(' ');
    try {
      logger.info(`User ${user.username} requested emote: ${emoteName} in channel: ${channel}`);
      const channelName = channel.replace(/^#/, '');
      const twitchID = await this.getTwitchUserID(channelName);
      const emotes = await this.sevenTvApi.getChannelEmotes(twitchID);

      const foundEmote = emotes.find(emote => 
        emote.name.toLowerCase() === emoteName.toLowerCase() ||
        emote.aliases.some(alias => alias.toLowerCase() === emoteName.toLowerCase())
      );

      if (!foundEmote) {
        logger.warn(`Emote not found: ${emoteName} for user: ${user.username}`);
        await context.say(`@${user.username} ⌲ No emote found matching "${emoteName}"`);
        return;
      }

      logger.debug(`Found emote: ${foundEmote.name} by ${foundEmote.uploader}`);

      // Fetch actor details
      let actorName = 'Unknown';
      if (foundEmote.actorId !== 'Unknown') {
        const actorDetails = await this.sevenTvApi.getUserDetailsById(foundEmote.actorId);
        actorName = actorDetails.displayName || actorDetails.username || 'Unknown';
      }

      const aliasText = foundEmote.aliases.length > 0 ? foundEmote.aliases.join(', ') : foundEmote.name;
      const response = `@${user.username} ${foundEmote.name} [${aliasText}] • Added by: ${actorName} • ${foundEmote.emotePageUrl}`;
      logger.info(`Responding to ${user.username} with emote details: ${response}`);
      await context.say(response);
    } catch (error) {
      logger.error('Error in emote command:', error);
      await context.say(`@${user.username} ⌲ Failed to check emote. Please try again later.`);
    }
  }

  async getTwitchUserID(username) {
    try {
      logger.debug(`Fetching Twitch ID for username: ${username}`);
      const user = await this.apiClient.users.getUserByName(username);
      if (!user) {
        logger.warn(`No Twitch user found for username: ${username}`);
        return null;
      }
      logger.info(`Found Twitch ID: ${user.id} for username: ${username}`);
      return user.id;
    } catch (error) {
      logger.error('Error fetching Twitch user ID:', error);
      return null;
    }
  }

  async handleEmoteChannelsCommand(context, emoteId) {
    const { user } = context;
    try {
      const data = await this.sevenTvApi.getEmoteChannels(emoteId);
      const channels = data.emote.channels.items;

      if (!channels || channels.length === 0) {
        await context.say(`@${user.username} ⌲ No channels found using this emote.`);
        return;
      }

      const channelList = channels.map(channel => channel.display_name).join(', ');
      await context.say(`@${user.username} ⌲ Channels using this emote: ${channelList}`);
    } catch (error) {
      logger.error('Error fetching emote channels:', error);
      await context.say(`@${user.username} ⌲ Failed to fetch channels using this emote. Please try again later.`);
    }
  }

  async handle7TVCommand(context) {
    const { user, args } = context;

    if (!args.length) {
      await context.say(`@${user.username}, Usage: #7tv search/animated/zero/trending <query>`);
      return;
    }

    const subCommand = args[0].toLowerCase();
    const query = args.slice(1).join(' ');

    switch (subCommand) {
      case 'search':
        await this.handleSearchCommand(context, args.slice(1));
        break;
      case 'animated':
        await this.handleAnimatedSearch(context, query);
        break;
      case 'zero':
        await this.handleZeroWidthSearch(context, query);
        break;
      case 'trending':
        await this.handleTrendingSearch(context, query);
        break;
      default:
        await context.say(`@${user.username}, Invalid subcommand. Use: search, animated, zero, or trending`);
    }
  }

  formatEmoteInfo(emote) {
    const tags = [];
    if (emote.animated) tags.push('ANIMATED');
    if (emote.flags & 1) tags.push('ZERO_WIDTH');

    const appUrl = `https://7tv.app/emotes/${emote.id}`;
    const cdnUrl = `https://cdn.7tv.app/emote/${emote.id}/4x`;

    return {
      name: emote.name,
      creator: emote.owner?.display_name || 'Unknown',
      tags,
      appUrl,
      cdnUrl
    };
  }

  async findExactEmote(emoteName) {
    try {
      logger.debug(`Finding exact emote: ${emoteName}`);
      const gqlQuery = {
        operationName: 'SearchEmotes',
        query: `
          query SearchEmotes($query: String!, $limit: Int!, $page: Int!) {
            emotes(query: $query, limit: $limit, page: $page) {
              items {
                id
                name
                flags
                state
                owner {
                  id
                  username
                  display_name
                }
                host {
                  url
                }
                animated
              }
            }
          }
        `,
        variables: {
          query: emoteName,
          page: 1,
          limit: 1
        }
      };

      const response = await fetch(this.gqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(gqlQuery)
      });

      const data = await response.json();
      logger.debug(`Exact emote lookup results: ${JSON.stringify(data)}`);
      
      const emote = data.data?.emotes?.items?.[0];
      if (emote && emote.name.toLowerCase() === emoteName.toLowerCase()) {
        logger.debug(`Found exact emote: ${emote.name}`);
        return emote;
      }

      return null;
    } catch (error) {
      logger.error('Error finding exact emote:', error);
      return null;
    }
  }

  async handleSearchCommand(context, args) {
    const { user } = context;
    if (!args.length) {
      await context.say(`@${user.username}, Usage: #7tv search <query>`);
      return;
    }

    const query = args.join(' ');
    try {
      const emotes = await this.sevenTvApi.getEmotesByQuery(query);

      if (emotes.length === 0) {
        await context.say(`@${user.username} ⌲ No emotes found for "${query}"`);
        return;
      }

      const formattedEmotes = emotes.map(emote => {
        const info = this.formatEmoteInfo(emote);
        return `${info.name} - ${info.appUrl}`;
      }).join(' | ');

      await context.say(`@${user.username} ⌲ Found: ${formattedEmotes}`);

    } catch (error) {
      logger.error('Error searching emotes:', error);
      await context.say(`@${user.username} ⌲ Failed to search emotes. Please try again later.`);
    }
  }

  async handleAnimatedSearch(context, query) {
    const { user } = context;
    if (!query) {
      await context.say(`@${user.username}, Usage: #7tv animated <query>`);
      return;
    }

    try {
      const emotes = await this.sevenTvApi.getEmotesByQuery(query);
      const animatedEmotes = emotes.filter(e => e.animated);

      if (animatedEmotes.length === 0) {
        await context.say(`@${user.username} ⌲ No animated emotes found for "${query}"`);
        return;
      }

      const formattedEmotes = animatedEmotes.slice(0, 5).map(emote => emote.name).join(', ');
      await context.say(`@${user.username} ⌲ Animated emotes: ${formattedEmotes}`);

    } catch (error) {
      logger.error('Error searching animated emotes:', error);
      await context.say(`@${user.username} ⌲ Failed to search animated emotes. Please try again later.`);
    }
  }

  async handleZeroWidthSearch(context, query) {
    const { user } = context;
    if (!query) {
      await context.say(`@${user.username}, Usage: #7tv zero <query>`);
      return;
    }

    try {
      const emotes = await this.sevenTvApi.getEmotesByQuery(query);
      const zeroWidthEmotes = emotes.filter(e => e.flags & 1);

      if (zeroWidthEmotes.length === 0) {
        await context.say(`@${user.username} ⌲ No zero-width emotes found for "${query}"`);
        return;
      }

      const formattedEmotes = zeroWidthEmotes.slice(0, 5).map(emote => emote.name).join(', ');
      await context.say(`@${user.username} ⌲ Zero-width emotes: ${formattedEmotes}`);

    } catch (error) {
      logger.error('Error searching zero-width emotes:', error);
      await context.say(`@${user.username} ⌲ Failed to search zero-width emotes. Please try again later.`);
    }
  }

  async handleTrendingSearch(context, query) {
    const { user } = context;
    if (!query) {
      await context.say(`@${user.username}, Usage: #7tv trending <query>`);
      return;
    }

    try {
      const emotes = await this.sevenTvApi.getEmotesByQuery(query, 'TRENDING_DESC');

      if (emotes.length === 0) {
        await context.say(`@${user.username} ⌲ No trending emotes found for "${query}"`);
        return;
      }

      const formattedEmotes = emotes.slice(0, 5).map(emote => emote.name).join(', ');
      await context.say(`@${user.username} ⌲ Trending emotes: ${formattedEmotes}`);

    } catch (error) {
      logger.error('Error searching trending emotes:', error);
      await context.say(`@${user.username} ⌲ Failed to search trending emotes. Please try again later.`);
    }
  }

  async reverseSearchEmote(emoteId) {
    try {
      const emote = await this.sevenTvApi.getEmoteDetails(emoteId);
      logger.debug(`Reverse search emote results: ${JSON.stringify(emote)}`);
      return emote;
    } catch (error) {
      logger.error('Error in reverse search emote:', error);
      return null;
    }
  }
}

export function setup7tv(chatClient) {
  if (!chatClient.apiClient) {
    logger.error('Missing API client in chat client');
    return {};
  }

  const handler = new SevenTVHandler(chatClient);
  return {
    'emote': async (context) => await handler.handleEmoteCommand(context),
    '7tv': async (context) => await handler.handle7TVCommand(context)
  };
}
