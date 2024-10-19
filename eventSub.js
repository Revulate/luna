import { EventSubWsListener } from '@twurple/eventsub-ws';
import { ApiClient } from '@twurple/api';
import { config } from './config.js';
import logger from './logger.js';

export async function setupEventSub(authProvider, bot) {
  try {
    const apiClient = new ApiClient({ authProvider });
    const user = await apiClient.users.getAuthenticatedUser();
    
    if (!user) {
      throw new Error('Failed to get authenticated user');
    }

    logger.info(`Authenticated as ${user.name} (ID: ${user.id})`);

    const listener = new EventSubWsListener({
      apiClient,
      logger: {
        minLevel: 'debug',
        log: (level, message) => logger.log(level, `[EventSub] ${message}`)
      }
    });

    // Use the authenticated user's ID for subscriptions
    const broadcasterId = user.id;

    await listener.onChannelFollow(broadcasterId, async (e) => {
      logger.info(`[EventSub] ${e.userDisplayName} followed the channel!`);
      bot.say(config.twitch.channels[0], `Thanks for the follow, ${e.userDisplayName}!`);
    });

    await listener.onChannelSubscription(broadcasterId, e => {
      logger.info(`[EventSub] ${e.userDisplayName} subscribed to the channel!`);
      bot.say(config.twitch.channels[0], `Thanks for subscribing, ${e.userDisplayName}!`);
    });

    await listener.onChannelCheer(broadcasterId, e => {
      logger.info(`[EventSub] ${e.userDisplayName} cheered ${e.bits} bits!`);
      bot.say(config.twitch.channels[0], `Thanks for the ${e.bits} bits, ${e.userDisplayName}!`);
    });

    await listener.onChannelRaid(broadcasterId, e => {
      logger.info(`[EventSub] ${e.raidingBroadcasterDisplayName} raided with ${e.viewers} viewers!`);
      bot.say(config.twitch.channels[0], `Welcome raiders from ${e.raidingBroadcasterDisplayName}'s channel!`);
    });

    await listener.start();
    logger.info('EventSub listener started successfully');

    return listener;
  } catch (error) {
    logger.error('Error setting up EventSub:', error);
    throw error;
  }
}
