import logger from '../logger.js';
import fetch from 'node-fetch';

class SevenTVHandler {
  constructor(chatClient) {
    this.chatClient = chatClient;
    this.apiClient = chatClient.apiClient;
    this.baseUrl = 'https://7tv.io/v3';
    this.gqlUrl = 'https://7tv.io/v3/gql';
  }

  async searchEmotes(query, filters = [], limit = 5) {
    try {
      const gqlQuery = {
        operationName: 'SearchEmotes',
        query: `
          query SearchEmotes($query: String!, $limit: Int!, $page: Int!, $filter: EmoteSearchFilter) {
            emotes(query: $query, limit: $limit, page: $page, filter: $filter) {
              items {
                id
                name
                owner {
                  username
                  display_name
                }
                flags
                animated
                host {
                  url
                  files {
                    name
                    format
                  }
                }
              }
            }
          }
        `,
        variables: {
          query,
          limit,
          page: 0,
          filter: {
            exact_match: filters.includes('exact'),
            animated: filters.includes('animated'),
            zero_width: filters.includes('zero'),
            case_sensitive: false
          }
        }
      };

      const response = await fetch(this.gqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gqlQuery)
      });

      if (!response.ok) {
        logger.debug(`Search response status: ${response.status}`);
        const errorText = await response.text();
        logger.debug(`Error response: ${errorText}`);
        return [];
      }

      const data = await response.json();
      logger.debug(`Search results: ${JSON.stringify(data)}`);
      
      return data.data?.emotes?.items || [];
    } catch (error) {
      logger.error('Error searching 7TV emotes:', error);
      return [];
    }
  }

  async getChannelEmotes(channelName) {
    try {
      const twitchId = await this.getTwitchUserID(channelName);
      if (!twitchId) {
        logger.debug(`Could not find Twitch ID for: ${channelName}`);
        return [];
      }

      // GraphQL query for getting channel emotes
      const gqlQuery = {
        operationName: 'GetUserEmotes',
        query: `
          query GetUserEmotes($id: String!) {
            user(id: $id) {
              emote_set {
                emotes {
                  id
                  name
                  owner {
                    username
                    display_name
                  }
                  flags
                  animated
                  host {
                    url
                    files {
                      name
                      format
                    }
                  }
                }
              }
            }
          }
        `,
        variables: {
          id: twitchId
        }
      };

      const response = await fetch(this.gqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gqlQuery)
      });

      if (!response.ok) {
        logger.debug(`User response status: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.data?.user?.emote_set?.emotes || [];
    } catch (error) {
      logger.error('Error fetching channel emotes:', error);
      return [];
    }
  }

  formatEmoteInfo(emote, isChannelEmote = false) {
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

  async handleSearchCommand(context, args) {
    const query = args.join(' ');

    if (!query) {
      await context.say(`@${context.user.username}, Please provide a search term.`);
      return;
    }

    const emotes = await this.searchEmotes(query);
    
    if (emotes.length === 0) {
      await context.say(`@${context.user.username} ⌲ No emotes found matching "${query}"`);
      return;
    }

    const results = emotes.map((emote, index) => {
      const tags = [];
      if (emote.animated) tags.push('ANIMATED');
      if (emote.flags & 1) tags.push('ZERO_WIDTH');
      
      const tagString = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      return `${index + 1}. ${emote.name}${tagString} by ${emote.owner?.display_name || 'Unknown'} | ${emote.host.url}/3x (7tv.app/emotes/${emote.id})`;
    }).join(' | ');

    await context.say(`@${context.user.username} ⌲ Found: ${results}`);
  }

  async handle7tvCommand(context) {
    const { channel, user, args } = context;

    if (!args.length) {
      await context.say(
        `@${user.username}, Usage: #emote <emote_name> | #7tv search/animated/zero <query>`
      );
      return;
    }

    const firstArg = args[0].toLowerCase();

    if (firstArg === 'search') {
      const query = args.slice(1).join(' ');
      const emotes = await this.searchEmotes(query, [], 5);
      await this.displaySearchResults(context, emotes, query, 'matching');
      return;
    }
    
    if (firstArg === 'animated') {
      const query = args.slice(1).join(' ');
      const emotes = await this.searchEmotes(query, ['animated']);
      await this.displaySearchResults(context, emotes, query, 'animated');
      return;
    }
    
    if (firstArg === 'zero') {
      const query = args.slice(1).join(' ');
      const emotes = await this.searchEmotes(query, ['zero']);
      await this.displaySearchResults(context, emotes, query, 'zero-width');
      return;
    }

    // Default behavior: search with exact match
    const emoteName = args.join(' ');
    const cleanChannelName = channel.replace(/^#/, '');
    
    try {
      logger.debug(`Searching for emote: ${emoteName} in channel: ${cleanChannelName}`);
      
      const channelEmotes = await this.getChannelEmotes(cleanChannelName);
      logger.debug(`Found ${channelEmotes.length} channel emotes`);

      const channelEmote = channelEmotes.find(e => 
        e.name.toLowerCase() === emoteName.toLowerCase()
      );

      if (channelEmote) {
        const info = this.formatEmoteInfo(channelEmote, true);
        const response = `@${user.username} ⌲ ${info.name} [${info.tags.join(', ')}] by ${info.creator} | ${info.cdnUrl} (${info.appUrl})`;
        await context.say(response);
      } else {
        // Search with exact match filter
        const searchResults = await this.searchEmotes(emoteName, ['exact'], 1);
        if (searchResults.length > 0) {
          const info = this.formatEmoteInfo(searchResults[0], false);
          const response = `@${user.username} ⌲ ${info.name} [${info.tags.join(', ')}] by ${info.creator} | ${info.cdnUrl} (${info.appUrl})`;
          await context.say(response);
        } else {
          await context.say(
            `@${user.username} ⌲ No emote found matching "${emoteName}"`
          );
        }
      }
    } catch (error) {
      logger.error('Error in 7tv command:', error);
      await context.say(
        `@${user.username} ⌲ Failed to check emote. Please try again later.`
      );
    }
  }

  // Helper method to display search results
  async displaySearchResults(context, emotes, query, filterType) {
    if (emotes.length === 0) {
      await context.say(`@${context.user.username} ⌲ No ${filterType} emotes found matching "${query}"`);
      return;
    }

    const results = emotes.map((emote, index) => {
      const tags = [];
      if (emote.animated) tags.push('ANIMATED');
      if (emote.flags & 1) tags.push('ZERO_WIDTH');
      
      const tagString = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      const appUrl = `https://7tv.app/emotes/${emote.id}`;
      return `${index + 1}. ${emote.name}${tagString} by ${emote.owner?.display_name || 'Unknown'} | ${appUrl}`;
    }).join(' | ');

    await context.say(`@${context.user.username} ⌲ Found ${filterType} emotes: ${results}`);
  }
}

export function setup7tv(chatClient) {
  const handler = new SevenTVHandler(chatClient);
  return {
    '7tv': async (context) => await handler.handle7tvCommand(context),
    'emote': async (context) => await handler.handle7tvCommand(context) // Add emote command
  };
}
