import MessageLogger from '../MessageLogger.js';
import logger from '../logger.js';

class MessageLookup {
  constructor(bot) {
    this.bot = bot;
  }

  async handleLastMessageCommand({ channel, user, args }) {
    const channelName = channel.replace('#', '');
    let targetUser = user.username;
    let isSelfLookup = true;

    if (args.length > 0) {
      targetUser = args[0].replace('@', '');
      isSelfLookup = targetUser.toLowerCase() === user.username.toLowerCase();
    }

    let lastMessage;
    if (isSelfLookup) {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      lastMessage = MessageLogger.getUserLastMessageBefore(channelName, user.username, fiveMinutesAgo);
    } else {
      lastMessage = MessageLogger.getUserLastMessage(channelName, targetUser);
    }

    if (lastMessage) {
      const date = new Date(lastMessage.timestamp);
      const formattedDate = this.formatDate(date);
      let response;
      if (isSelfLookup) {
        response = `@${user.username}, this was your last message before 5 minutes ago • ${lastMessage.message} • (${formattedDate})`;
      } else {
        response = `@${user.username}, ${targetUser}'s last message was: ${lastMessage.message} • (${formattedDate})`;
      }
      await this.bot.say(channel, response);
    } else {
      const response = isSelfLookup
        ? `@${user.username}, I couldn't find any messages from you older than 5 minutes in this channel.`
        : `@${user.username}, I couldn't find any messages from ${targetUser} in this channel.`;
      await this.bot.say(channel, response);
    }
  }

  formatDate(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;
    
    return date.toLocaleString();
  }

  async handleRandomMessageCommand({ channel, user }) {
    const channelName = channel.replace('#', '');
    const messages = MessageLogger.getRecentMessages(channelName, 1000); // Get last 1000 messages
    const userMessages = messages.filter(msg => msg.username === user.username);

    if (userMessages.length > 0) {
      const randomMessage = userMessages[Math.floor(Math.random() * userMessages.length)];
      const date = new Date(randomMessage.timestamp);
      const formattedDate = this.formatDate(date);
      await this.bot.say(channel, `@${user.username} • ${randomMessage.message} • (${formattedDate})`);
    } else {
      await this.bot.say(channel, `@${user.username}, I couldn't find any messages from you in this channel.`);
    }
  }

  async handleWordCountCommand({ channel, user, args }) {
    if (args.length === 0) {
      await this.bot.say(channel, `@${user.username}, please provide a word or phrase to search for.`);
      return;
    }

    const searchTerm = args.join(' ').toLowerCase();
    const channelName = channel.replace('#', '');
    const messages = MessageLogger.getRecentMessages(channelName, 10000); // Get last 10000 messages
    const userMessages = messages.filter(msg => msg.username === user.username);

    const count = userMessages.reduce((acc, msg) => {
      return acc + (msg.message.toLowerCase().split(searchTerm).length - 1);
    }, 0);

    await this.bot.say(channel, `@${user.username}, you've used "${searchTerm}" ${count} times in your recent messages.`);
  }

  async handleCommand(context) {
    const { channel, user, message } = context;
    
    // Extract the actual message content
    let messageContent;
    if (typeof message === 'object' && message._parsedParams && message._parsedParams.text) {
      messageContent = message._parsedParams.text.value;
    } else if (typeof message === 'string') {
      messageContent = message;
    } else {
      logger.error(`Invalid message format: ${JSON.stringify(message)}`);
      return;
    }

    // Extract command and args
    const [command, ...args] = messageContent.split(' ');

    switch (command.toLowerCase()) {
      case '#lastmessage':
      case '#lm':
        await this.handleLastMessageCommand({ channel, user, args });
        break;
      case '#randommessage':
      case '#rm':
        if (args.length > 0) {
          await this.bot.say(channel, `@${user.username} sorry, but to respect their privacy I won't do that.`);
        } else {
          await this.handleRandomMessageCommand({ channel, user });
        }
        break;
      case '#wordcount':
      case '#wc':
        await this.handleWordCountCommand({ channel, user, args });
        break;
      default:
        logger.warn(`Unknown command: ${command}`);
    }
  }
}

export function setupMessageLookup(bot) {
  const messageLookup = new MessageLookup(bot);
  return {
    rm: (context) => messageLookup.handleCommand(context),
    randommessage: (context) => messageLookup.handleCommand(context),
    lm: (context) => messageLookup.handleCommand(context),
    lastmessage: (context) => messageLookup.handleCommand(context),
    wc: (context) => messageLookup.handleCommand(context),
    wordcount: (context) => messageLookup.handleCommand(context)
  };
}
