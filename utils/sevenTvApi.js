import fetch from 'node-fetch';
import logger from './logger.js';

class SevenTvApi {
  constructor() {
    logger.startOperation('Initializing SevenTvApi');
    this.baseUrl = 'https://7tv.io/v3';
    this.gqlUrl = 'https://7tv.io/v3/gql';
    this.retryLimit = 3;
    this.retryDelay = 1000;
    logger.debug('SevenTV API initialized');
  }

  async fetchJson(url, options = {}) {
    try {
      logger.debug(`Fetching JSON from ${url}`);
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to fetch:', { 
          status: response.status, 
          statusText: response.statusText, 
          error: errorText 
        });
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Error fetching JSON:', { error, url });
      throw error;
    }
  }

  async fetchGraphQL(query, variables = {}) {
    logger.debug('Executing GraphQL query', { variables });
    try {
      const response = await fetch(this.gqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('GraphQL request failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      logger.error('Error fetching GraphQL data:', error);
      throw error;
    }
  }

  async getUserByTwitchID(twitchID) {
    logger.debug(`Getting user by Twitch ID: ${twitchID}`);
    const url = `${this.baseUrl}/users/twitch/${twitchID}`;
    return this.fetchJson(url);
  }

  async getEmoteSet(emoteSetID) {
    const url = `${this.baseUrl}/emote-sets/${emoteSetID}`;
    return this.fetchJson(url);
  }

  async getChannelEmotes(twitchID) {
    try {
      const user = await this.getUserByTwitchID(twitchID);
      if (!user || !user.emote_set) {
        throw new Error('Emote set not found for this user.');
      }
      const emoteSet = await this.getEmoteSet(user.emote_set.id);
      logger.debug('Fetched Emote Set:', emoteSet.name);
      return emoteSet.emotes.map(emote => ({
        id: emote.id,
        name: emote.name,
        aliases: emote.aliases || [],
        uploader: emote.owner ? emote.owner.display_name : 'Unknown',
        actorId: emote.actor_id || 'Unknown',
        emotePageUrl: `https://7tv.app/emotes/${emote.id}`
      }));
    } catch (error) {
      logger.error('Error fetching channel emotes:', error);
      throw error;
    }
  }

  async getEmotesByQuery(queryString, sort = null) {
    const query = `
      query SearchEmotes($query: String!, $limit: Int!, $page: Int!, $sort: String) {
        emotes(query: $query, limit: $limit, page: $page, sort: $sort) {
          items {
            id
            name
            flags
            owner {
              display_name
            }
            animated
          }
        }
      }
    `;

    const variables = {
      query: queryString,
      limit: 10,
      page: 1,
      sort
    };

    return this.fetchGraphQL(query, variables);
  }

  async getEmoteChannels(emoteId) {
    const query = `
      query GetEmoteChannels($id: ObjectID!, $page: Int, $limit: Int) {
        emote(id: $id) {
          id
          channels(page: $page, limit: $limit) {
            total
            items {
              id
              username
              display_name
              avatar_url
              style {
                color
                paint_id
                __typename
              }
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `;

    const variables = {
      id: emoteId,
      page: 1,
      limit: 10
    };

    return this.fetchGraphQL(query, variables);
  }

  async getUserDetails(userId) {
    const query = `
      query GetUser($id: ObjectID!) {
        user(id: $id) {
          id
          username
          display_name
          emote_sets {
            id
            name
            emotes {
              id
              name
            }
          }
        }
      }
    `;

    const variables = { id: userId };
    return this.fetchGraphQL(query, variables);
  }

  async getEmoteDetails(emoteId) {
    const query = `
      query GetEmote($id: ObjectID!) {
        emote(id: $id) {
          id
          name
          owner {
            display_name
          }
          channels {
            total
            items {
              display_name
            }
          }
        }
      }
    `;

    const variables = { id: emoteId };
    const data = await this.fetchGraphQL(query, variables);
    return {
      owner: data.emote.owner?.display_name || 'Unknown',
      channels: data.emote.channels.items.map(channel => channel.display_name),
      totalChannels: data.emote.channels.total
    };
  }

  async getUserDetailsById(userId) {
    const query = `
      query GetUser($id: ObjectID!) {
        user(id: $id) {
          id
          username
          display_name
        }
      }
    `;

    const variables = { id: userId };
    const data = await this.fetchGraphQL(query, variables);
    return {
      username: data.user.username,
      displayName: data.user.display_name
    };
  }

  async fetchWithRetry(url, options = {}, retries = 0) {
    try {
      const response = await fetch(url, {
        ...options,
        timeout: 5000, // Add timeout
        headers: {
          ...options.headers,
          'User-Agent': 'TwitchBot/1.0' // Add user agent
        }
      });

      if (response.status === 429 && retries < this.retryLimit) {
        const delay = parseInt(response.headers.get('Retry-After')) * 1000 || this.retryDelay;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, options, retries + 1);
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (retries < this.retryLimit) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.fetchWithRetry(url, options, retries + 1);
      }
      throw error;
    }
  }
}

export default SevenTvApi;
