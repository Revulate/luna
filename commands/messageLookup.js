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

    try {
      const messagesWithContext = await MessageLogger.getMessagesWithContext(channelName, targetUser);
      
      if (messagesWithContext && messagesWithContext.length > 0) {
        const lastMessage = messagesWithContext[0];
        const date = new Date(lastMessage.timestamp);
        const formattedDate = this.formatDate(date);
        
        let response;
        if (isSelfLookup) {
          response = `@${user.username}, this was your last message • ${lastMessage.message} • (${formattedDate})`;
          if (lastMessage.previous_message) {
            response += ` • Context: "${lastMessage.previous_message}" ➜ "${lastMessage.message}"`;
          }
        } else {
          response = `@${user.username}, ${targetUser}'s last message was: ${lastMessage.message} • (${formattedDate})`;
          if (lastMessage.previous_message) {
            response += ` • Context: "${lastMessage.previous_message}" ➜ "${lastMessage.message}"`;
          }
        }
        
        await this.bot.say(channel, response);
      } else {
        const response = isSelfLookup
          ? `@${user.username}, I couldn't find any messages from you in this channel.`
          : `@${user.username}, I couldn't find any messages from ${targetUser} in this channel.`;
        await this.bot.say(channel, response);
      }
    } catch (error) {
      logger.error(`Error in handleLastMessageCommand: ${error.message}`, { error });
      await this.bot.say(channel, `@${user.username}, Sorry, an error occurred while retrieving messages.`);
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
    const { channel, user, message, args } = context;
    
    // Get the command from the first argument
    const command = args[0].toLowerCase();
    // Get the remaining args
    const commandArgs = args.slice(1);

    switch (command) {
      case '#lastmessage':
      case '#lm':
        await this.handleLastMessageCommand({ channel, user, args: commandArgs });
        break;
      case '#randommessage':
      case '#rm':
        if (commandArgs.length > 0) {
          await this.bot.say(channel, `@${user.username} sorry, but to respect their privacy I won't do that.`);
        } else {
          await this.handleRandomMessageCommand({ channel, user });
        }
        break;
      case '#wordcount':
      case '#wc':
        await this.handleWordCountCommand({ channel, user, args: commandArgs });
        break;
      default:
        logger.warn(`Unknown command: ${command}`);
    }
  }
}

export function setupMessageLookup(bot) {
  return {
    lm: async (context) => {
      try {
        const messages = await MessageLogger.getRecentMessages(context.channel.replace('#', ''), 100);
        if (!messages || messages.length === 0) {
          await context.bot.say(context.channel, `@${context.user.username}, No messages found.`);
          return;
        }

        const userMessages = messages.filter(msg => 
          msg.username.toLowerCase() === context.user.username.toLowerCase()
        );

        if (userMessages.length > 1) {
          const lastMessage = userMessages[1];
          await context.bot.say(context.channel, 
            `@${context.user.username} Your last message was: ${lastMessage.message}`
          );
        } else {
          await context.bot.say(context.channel, 
            `@${context.user.username} No previous messages found.`);
        }
      } catch (error) {
        logger.error(`Error in lm command: ${error.message}`, { error });
        await context.bot.say(context.channel, 
          `@${context.user.username}, Sorry, an error occurred.`);
      }
    },
    rm: async (context) => {
      try {
        const messages = await MessageLogger.getRecentMessages(context.channel.replace('#', ''), 100);
        if (!messages || messages.length === 0) {
          await context.bot.say(context.channel, `@${context.user.username}, No messages found.`);
          return;
        }

        // Get random message excluding the current command
        const filteredMessages = messages.filter(msg => 
          msg.username.toLowerCase() !== context.user.username.toLowerCase() &&
          !msg.message.startsWith('#')
        );
        
        if (filteredMessages.length === 0) {
          await context.bot.say(context.channel, `@${context.user.username}, No valid messages found.`);
          return;
        }

        const randomMessage = filteredMessages[Math.floor(Math.random() * filteredMessages.length)];
        await context.bot.say(context.channel, `@${context.user.username} Random message from ${randomMessage.username}: ${randomMessage.message}`);
      } catch (error) {
        logger.error(`Error in rm command: ${error.message}`, { error });
        await context.bot.say(context.channel, `@${context.user.username}, Sorry, an error occurred while processing your request.`);
      }
    }
  };
}
