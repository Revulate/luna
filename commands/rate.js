import MessageLogger from '../MessageLogger.js';
import logger from '../logger.js';
import { DataObject } from '@twurple/common';
import { config } from '../config.js';
import { isMod, isVip } from '../index.js';
import { ChatClient } from '@twurple/chat';

class RateInfo extends DataObject {
  constructor(data) {
    super(data);
    this.percentage = data.percentage;
    this.rating = data.rating;
    this.description = data.description;
  }
}

class Rate {
  constructor(chatClient) {
    this.chatClient = chatClient;
    this.rateLimiter = new Map();
  }

  getMentionedUser(user, mentionedUser) {
    return mentionedUser ? mentionedUser.replace(/^@/, '') : user.username;
  }

  generateRateInfo(max = 100, highThreshold = 50) {
    const percentage = Math.floor(Math.random() * (max + 1));
    return new RateInfo({
      percentage,
      rating: percentage > highThreshold ? 'high' : 'low',
      description: percentage > highThreshold ? 'PogChamp' : 'NotLikeThis'
    });
  }

  async handleCuteCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% cute. ${rateInfo.percentage >= 50 ? 'MenheraCute' : 'SadgeCry'}`;
    await MessageLogger.logBotMessage(channel, response);
    await context.say(response);
  }

  async handleGayCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% gay. ${rateInfo.percentage > 50 ? 'Gayge' : '📏'}`;
    await MessageLogger.logBotMessage(channel, response);
    await context.say(response);
  }

  async handleStraightCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% straight. ${rateInfo.percentage > 50 ? '📏' : 'Hmm'}`;
    await MessageLogger.logBotMessage(channel, response);
    await context.say(response);
  }

  async handleMydCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const lengthCm = Math.floor(Math.random() * (20 - 7.5 + 1)) + 7.5;
    const girthCm = Math.floor(Math.random() * (15 - 7 + 1)) + 7;
    const response = `@${mentionedUser} 's pp is ${lengthCm} cm long and has a ${girthCm} cm girth. BillyApprove`;
    await MessageLogger.logBotMessage(channel, response);
    await context.say(response);
  }

  async handleRateCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(10, 5);
    const response = `I would give @${mentionedUser} a ${rateInfo.percentage}/10. ${rateInfo.percentage > 5 ? 'CHUG' : 'Hmm'}`;
    await MessageLogger.logBotMessage(channel, response);
    await context.say(response);
  }

  async handleHornyCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% horny right now. ${rateInfo.percentage > 50 ? 'HORNY' : 'Hmm'}`;
    await MessageLogger.logBotMessage(channel, response);
    await context.say(response);
  }

  async handleIqCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const iq = Math.floor(Math.random() * 201);
    let iqDescription = "thoughtless";
    if (iq > 50) iqDescription = "slowpoke";
    if (iq > 80) iqDescription = "NPC";
    if (iq > 115) iqDescription = "catNerd";
    if (iq > 199) iqDescription = "BrainGalaxy";
    const response = `@${mentionedUser} has ${iq} IQ. ${iqDescription}`;
    
    try {
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
    } catch (error) {
      logger.error(`Error in iq command: ${error}`);
      const errorResponse = `@${user.username}, an error occurred.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async handleSusCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% sus! ${rateInfo.percentage > 50 ? 'SUSSY' : 'Hmm'}`;
    await MessageLogger.logBotMessage(channel, response);
    await context.say(response);
  }

  async handleAllCommand(context) {
    const { channel, user, args } = context;
    const mentionedUser = this.getMentionedUser(user, args[0]);
    logger.info(`Running all rate commands for @${mentionedUser}`);

    const messages = [
      this.generateCuteMessage(mentionedUser),
      this.generateGayMessage(mentionedUser),
      this.generateStraightMessage(mentionedUser),
      this.generateMydMessage(mentionedUser),
      this.generateRateMessage(mentionedUser),
      this.generateHornyMessage(mentionedUser),
      this.generateIqMessage(mentionedUser),
      this.generateSusMessage(mentionedUser)
    ];

    try {
      for (const message of messages) {
        await MessageLogger.logBotMessage(channel, message);
        await context.say(message);
        // Add a delay between messages
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      logger.error(`Error in handleAllCommand: ${error.message}`);
      const errorResponse = `@${user.username}, Sorry, an error occurred.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async sendMessage(channel, message) {
    try {
      // Use the chatClient's say method directly
      await this.chatClient.say(channel, message);
      logger.debug(`Message sent to ${channel}: ${message}`);
    } catch (error) {
      logger.error(`Error sending message to ${channel}: ${error.message}`);
      throw error;
    }
  }

  // Helper methods for generating individual messages
  generateCuteMessage(user) {
    const rateInfo = this.generateRateInfo(100, 50);
    return `@${user} is ${rateInfo.percentage}% cute. ${rateInfo.percentage >= 50 ? 'MenheraCute' : 'SadgeCry'}`;
  }

  generateGayMessage(user) {
    const rateInfo = this.generateRateInfo(100, 50);
    return `@${user} is ${rateInfo.percentage}% gay. ${rateInfo.percentage > 50 ? 'Gayge' : '📏'}`;
  }

  generateStraightMessage(user) {
    const rateInfo = this.generateRateInfo(100, 50);
    return `@${user} is ${rateInfo.percentage}% straight. ${rateInfo.percentage > 50 ? '📏' : 'Hmm'}`;
  }

  generateMydMessage(user) {
    const lengthCm = Math.floor(Math.random() * (20 - 7.5 + 1)) + 7.5;
    const girthCm = Math.floor(Math.random() * (15 - 7 + 1)) + 7;
    return `@${user} 's pp is ${lengthCm} cm long and has a ${girthCm} cm girth. BillyApprove`;
  }

  generateRateMessage(user) {
    const rateInfo = this.generateRateInfo(10, 5);
    return `I would give @${user} a ${rateInfo.percentage}/10. ${rateInfo.percentage > 5 ? 'CHUG' : 'Hmm'}`;
  }

  generateHornyMessage(user) {
    const rateInfo = this.generateRateInfo(100, 50);
    return `@${user} is ${rateInfo.percentage}% horny right now. ${rateInfo.percentage > 50 ? 'HORNY' : 'Hmm'}`;
  }

  generateIqMessage(user) {
    const iq = Math.floor(Math.random() * 201);
    let iqDescription = "thoughtless";
    if (iq > 50) iqDescription = "slowpoke";
    if (iq > 80) iqDescription = "NPC";
    if (iq > 115) iqDescription = "catNerd";
    if (iq > 199) iqDescription = "BrainGalaxy";
    return `@${user} has ${iq} IQ. ${iqDescription}`;
  }

  generateSusMessage(user) {
    const rateInfo = this.generateRateInfo(100, 50);
    return `@${user} is ${rateInfo.percentage}% sus! ${rateInfo.percentage > 50 ? 'SUSSY' : 'Hmm'}`;
  }
}

// Add these aliases back for myd command
const mydAliases = ['myd', 'pp', 'kok', 'cock', 'dick'];

// Fix the all command to properly check if values exist
function handleAll(context) {
  try {
    const username = context.user.username;
    const responses = [];

    // Get all the rate values
    const cuteValue = getRateValue(username, 'cute');
    const gayValue = getRateValue(username, 'gay');
    const straightValue = getRateValue(username, 'straight');
    const mydValue = getMydValue(username);
    const hornyValue = getRateValue(username, 'horny');
    const iqValue = getIqValue(username);
    const susValue = getRateValue(username, 'sus');

    // Build response array with proper checks
    if (cuteValue !== undefined) responses.push(`${cuteValue}% cute`);
    if (gayValue !== undefined) responses.push(`${gayValue}% gay`);
    if (straightValue !== undefined) responses.push(`${straightValue}% straight`);
    if (mydValue) responses.push(`${mydValue.length}cm x ${mydValue.girth}cm pp`);
    if (hornyValue !== undefined) responses.push(`${hornyValue}% horny`);
    if (iqValue !== undefined) responses.push(`${iqValue} IQ`);
    if (susValue !== undefined) responses.push(`${susValue}% sus`);

    // Join all responses with commas
    const response = `@${username} is ${responses.join(', ')}`;
    return response;
  } catch (error) {
    logger.error('Error in all command:', error);
    return `@${context.user.username}, Sorry, an error occurred while getting your stats.`;
  }
}

// Export the Rate class and setup function
export function setupRate(chatClient) {
  const rateHandler = new Rate(chatClient);
  
  return {
    cute: (context) => rateHandler.handleCuteCommand(context),
    gay: (context) => rateHandler.handleGayCommand(context),
    straight: (context) => rateHandler.handleStraightCommand(context),
    // Add all myd aliases
    ...Object.fromEntries(mydAliases.map(alias => [
      alias, 
      (context) => rateHandler.handleMydCommand(context)
    ])),
    rate: (context) => rateHandler.handleRateCommand(context),
    horny: (context) => rateHandler.handleHornyCommand(context),
    iq: (context) => rateHandler.handleIqCommand(context),
    sus: (context) => rateHandler.handleSusCommand(context),
    all: (context) => rateHandler.handleAllCommand(context)
  };
}
