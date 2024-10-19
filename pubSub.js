import { PubSubClient } from '@twurple/pubsub';
import logger from './logger.js';

export function setupPubSub(authProvider, channelId, bot) {
  const pubSubClient = new PubSubClient();

  const userId = channelId;

  pubSubClient.onRedemption(userId, (message) => {
    logger.info(`[PubSub] Redemption: ${message.rewardTitle} by ${message.userDisplayName}`);
    bot.say(bot.chat.channel, `${message.userDisplayName} redeemed ${message.rewardTitle}!`);
  });

  pubSubClient.onBits(userId, (message) => {
    logger.info(`[PubSub] Bits: ${message.bits} from ${message.userName}`);
    bot.say(bot.chat.channel, `Thanks for the ${message.bits} bits, ${message.userName}!`);
  });

  pubSubClient.onSubscription(userId, (message) => {
    logger.info(`[PubSub] Subscription: ${message.userDisplayName}`);
    bot.say(bot.chat.channel, `Thanks for subscribing, ${message.userDisplayName}!`);
  });

  pubSubClient.connect();

  return pubSubClient;
}
