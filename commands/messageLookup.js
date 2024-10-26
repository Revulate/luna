import { MessageLogger } from '../utils/MessageLogger.js';
import logger from '../utils/logger.js';

class MessageLookup {
  constructor(chatClient) {
    logger.startOperation('Initializing MessageLookup');
    this.chatClient = chatClient;
    logger.debug('MessageLookup handler initialized');
  }

  formatDate(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  async handleCommand(command, context) {
    const { channel, user, args } = context;
    const channelName = channel.replace('#', '');
    logger.startOperation(`Processing ${command} command for ${user.username}`);

    try {
      switch (command) {
        case 'lm':
        case 'lastmessage': {
          const targetUser = args[0]?.replace('@', '') || user.username;
          const messages = await MessageLogger.getUserMessages(channelName, targetUser);
          
          if (messages.length === 0) {
            const response = `@${user.username}, No messages found ${targetUser === user.username ? '' : `for ${targetUser}`}.`;
            await MessageLogger.logBotMessage(channel, response);
            await context.say(response);
            return;
          }

          const [last, ...older] = messages;
          const olderMsg = older.find(msg => Date.now() - new Date(msg.timestamp) > 300000); // 5 minutes
          
          let response = `@${user.username}, ${targetUser === user.username ? 'Your' : `${targetUser}'s`} last message: ${last.message} (${this.formatDate(new Date(last.timestamp))})`;
          if (olderMsg) {
            response += ` • Previous: ${olderMsg.message} (${this.formatDate(new Date(olderMsg.timestamp))})`;
          }
          
          await MessageLogger.logBotMessage(channel, response);
          await context.say(response);
          break;
        }

        case 'rm':
        case 'randommessage': {
          const messages = await MessageLogger.getUserMessages(channelName, user.username, 10000);
          if (messages.length === 0) {
            const response = `@${user.username}, No messages found.`;
            await MessageLogger.logBotMessage(channel, response);
            await context.say(response);
            return;
          }

          const random = messages[Math.floor(Math.random() * messages.length)];
          const date = new Date(random.timestamp);
          const response = `@${user.username} • Random message from ${this.formatDate(date)} • ${random.message}`;
          await MessageLogger.logBotMessage(channel, response);
          await context.say(response);
          break;
        }

        case 'wc':
        case 'count': {
          if (!args.length) {
            const response = `@${user.username}, Please provide a word to count.`;
            await MessageLogger.logBotMessage(channel, response);
            await context.say(response);
            return;
          }

          const word = args.join(' ').toLowerCase();
          const messages = await MessageLogger.getUserMessages(channelName, user.username, 50000);
          
          const matches = messages.filter(msg => 
            msg.message.toLowerCase().includes(word)
          );

          if (matches.length === 0) {
            const response = `@${user.username}, You haven't used "${word}" in your messages.`;
            await MessageLogger.logBotMessage(channel, response);
            await context.say(response);
            return;
          }

          const count = matches.reduce((acc, msg) => {
            const regex = new RegExp(word, 'gi');
            return acc + (msg.message.match(regex) || []).length;
          }, 0);

          const first = new Date(Math.min(...matches.map(m => m.timestamp)));
          const last = new Date(Math.max(...matches.map(m => m.timestamp)));

          const response = `@${user.username}, You've used "${word}" ${count} time${count === 1 ? '' : 's'} ` +
            `• First: ${this.formatDate(first)} • Last: ${this.formatDate(last)}`;
          
          await MessageLogger.logBotMessage(channel, response);
          await context.say(response);
          break;
        }
      }
      logger.endOperation(`Processing ${command} command for ${user.username}`, true);
    } catch (error) {
      logger.error(`Error in ${command} command:`, error);
      const errorResponse = `@${user.username}, An error occurred while processing your request.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
      logger.endOperation(`Processing ${command} command for ${user.username}`, false);
    }
  }
}

export function setupMessageLookup(chatClient) {
  logger.startOperation('Setting up MessageLookup command');
  const handler = new MessageLookup(chatClient);
  
  logger.info('MessageLookup command setup complete');
  logger.endOperation('Setting up MessageLookup command');
  return handler;
}

export default {
  async execute({ channel, user, args, say, commandName }) {
    try {
      const handler = new MessageLookup();
      await handler.handleCommand(commandName, { channel, user, args, say });
    } catch (error) {
      logger.error('Error executing message lookup command:', error);
      await say('Sorry, I encountered an error looking up messages.');
    }
  }
};