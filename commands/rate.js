import { DataObject } from '@twurple/common';
import { config } from '../config.js';
import logger from '../logger.js';
import { isMod, isVip } from '../utils.js';
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
  constructor(bot) {
    this.bot = bot;
    this.chatClient = bot.chat;
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

  async handleCuteCommand({ channel, user, args, bot }) {
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% cute. ${rateInfo.percentage >= 50 ? 'MenheraCute' : 'SadgeCry'}`;
    await this.sendMessage(bot, channel, response);
  }

  async handleGayCommand({ channel, user, args, bot }) {
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% gay. ${rateInfo.percentage > 50 ? 'Gayge' : '📏'}`;
    await this.sendMessage(bot, channel, response);
  }

  async handleStraightCommand({ channel, user, args, bot }) {
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% straight. ${rateInfo.percentage > 50 ? '📏' : 'Hmm'}`;
    await this.sendMessage(bot, channel, response);
  }

  async handleMydCommand({ channel, user, args, bot }) {
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const lengthCm = Math.floor(Math.random() * (20 - 7.5 + 1)) + 7.5;
    const girthCm = Math.floor(Math.random() * (15 - 7 + 1)) + 7;
    const response = `@${mentionedUser} 's pp is ${lengthCm} cm long and has a ${girthCm} cm girth. BillyApprove`;
    await this.sendMessage(bot, channel, response);
  }

  async handleRateCommand({ channel, user, args, bot }) {
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(10, 5);
    const response = `I would give @${mentionedUser} a ${rateInfo.percentage}/10. ${rateInfo.percentage > 5 ? 'CHUG' : 'Hmm'}`;
    await this.sendMessage(bot, channel, response);
  }

  async handleHornyCommand({ channel, user, args, bot }) {
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% horny right now. ${rateInfo.percentage > 50 ? 'HORNY' : 'Hmm'}`;
    await this.sendMessage(bot, channel, response);
  }

  async handleIqCommand({ channel, user, args, bot }) {
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const iq = Math.floor(Math.random() * 201);
    let iqDescription = "thoughtless";
    if (iq > 50) iqDescription = "slowpoke";
    if (iq > 80) iqDescription = "NPC";
    if (iq > 115) iqDescription = "catNerd";
    if (iq > 199) iqDescription = "BrainGalaxy";
    const response = `@${mentionedUser} has ${iq} IQ. ${iqDescription}`;
    await this.sendMessage(bot, channel, response);
  }

  async handleSusCommand({ channel, user, args, bot }) {
    const mentionedUser = this.getMentionedUser(user, args[0]);
    const rateInfo = this.generateRateInfo(100, 50);
    const response = `@${mentionedUser} is ${rateInfo.percentage}% sus! ${rateInfo.percentage > 50 ? 'SUSSY' : 'Hmm'}`;
    await this.sendMessage(bot, channel, response);
  }

  async handleAllCommand({ channel, user, args, bot, isPrivilegedUser }) {
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
      if (isPrivilegedUser) {
        // Send messages rapidly for privileged users
        const promises = messages.map(message => 
          this.chatClient.say(channel, message, { ignoreRateLimit: true })
        );
        await Promise.all(promises);
      } else {
        // For non-privileged users, send messages with a small delay
        for (const message of messages) {
          await this.chatClient.say(channel, message);
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay between messages
        }
      }
      
      logger.info(`Successfully sent all messages for #all command in ${channel}`);
      messages.forEach(msg => logger.botMessage(`${channel}: ${msg}`));
    } catch (error) {
      logger.error(`Error in handleAllCommand: ${error.message}`);
    }
  }

  async sendMessage(bot, channel, message) {
    try {
      await bot.say(channel, message);
    } catch (error) {
      logger.error(`Error sending message to ${channel}: ${error.message}`);
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

export function setupRate(bot) {
  const rate = new Rate(bot);
  return {
    cute: (context) => rate.handleCuteCommand(context),
    gay: (context) => rate.handleGayCommand(context),
    straight: (context) => rate.handleStraightCommand(context),
    myd: (context) => rate.handleMydCommand(context),
    pp: (context) => rate.handleMydCommand(context),
    kok: (context) => rate.handleMydCommand(context),
    cock: (context) => rate.handleMydCommand(context),
    penis: (context) => rate.handleMydCommand(context),
    rate: (context) => rate.handleRateCommand(context),
    horny: (context) => rate.handleHornyCommand(context),
    iq: (context) => rate.handleIqCommand(context),
    sus: (context) => rate.handleSusCommand(context),
    all: (context) => rate.handleAllCommand(context),
  };
}
