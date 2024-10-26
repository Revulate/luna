import logger from './logger.js';

class MessageFormatter {
  constructor() {
    logger.startOperation('Initializing MessageFormatter');
    this.MAX_MESSAGE_LENGTH = 450; // Twitch's limit is 500, leave buffer
    this.MAX_SPLIT_PARTS = 3; // Maximum number of message parts
    logger.debug('Message formatter initialized with limits:', {
      maxLength: this.MAX_MESSAGE_LENGTH,
      maxParts: this.MAX_SPLIT_PARTS
    });
  }

  async splitMessage(message, prefix = '', options = {}) {
    logger.startOperation('Splitting message');
    try {
      const parts = [];
      let currentPart = prefix;

      // Clean up formatting artifacts
      const cleanedMessage = message
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+/g, ' ')
        .trim();

      logger.debug('Processing message split', {
        originalLength: message.length,
        cleanedLength: cleanedMessage.length,
        hasPrefix: Boolean(prefix)
      });

      // Split into sentences while preserving emotes
      const sentences = cleanedMessage.match(/[^.!?]+[.!?]+|\[[^\]]+\]|\S+\s*/g) || [];
      
      for (const sentence of sentences) {
        if ((currentPart + sentence).length > this.MAX_MESSAGE_LENGTH) {
          if (currentPart.trim()) {
            parts.push(currentPart.trim());
            currentPart = parts.length === 1 ? '(cont) ' : '(cont) ' + prefix;
          }
        }
        
        // Special handling for emotes
        if (sentence.match(/[A-Z][a-zA-Z]+/)) {
          currentPart += sentence.replace(/([A-Z][a-zA-Z]+)/, ' $1 ').trim() + ' ';
        } else {
          currentPart += sentence;
        }

        if (currentPart.length > this.MAX_MESSAGE_LENGTH) {
          const lastSpace = currentPart.lastIndexOf(' ', this.MAX_MESSAGE_LENGTH);
          if (lastSpace > 0) {
            parts.push(currentPart.slice(0, lastSpace).trim());
            currentPart = parts.length === 1 ? '(cont) ' : '(cont) ' + prefix;
            currentPart += currentPart.slice(lastSpace).trim() + ' ';
          }
        }
      }

      if (currentPart.trim()) {
        parts.push(currentPart.trim());
      }

      // Limit number of parts
      const finalParts = parts.slice(0, this.MAX_SPLIT_PARTS);
      logger.debug('Message split complete', {
        partCount: finalParts.length,
        truncated: parts.length > finalParts.length
      });
      
      logger.endOperation('Splitting message', true);
      return finalParts;
    } catch (error) {
      logger.error('Error splitting message:', error);
      logger.endOperation('Splitting message', false);
      return [message.slice(0, this.MAX_MESSAGE_LENGTH)];
    }
  }

  formatUserMention(user) {
    return `@${user.displayName || user.username}`;
  }

  formatEmoteMessage(message, emotes) {
    let formattedMessage = message;
    
    // Add proper spacing around emotes
    emotes.forEach(emote => {
      const emoteRegex = new RegExp(`${emote}`, 'g');
      formattedMessage = formattedMessage.replace(emoteRegex, ` ${emote} `);
    });

    // Clean up extra spaces
    return formattedMessage.replace(/\s+/g, ' ').trim();
  }

  formatTimestamp(date) {
    return new Date(date).toLocaleTimeString();
  }

  cleanResponse(response) {
    return response
      .replace(/^@\w+\s+/, '')
      .replace(/@Revulate\s+/, '')
      .replace(/@user\s+/, '')
      .trim();
  }
}

export function setupMessageFormatter() {
  return new MessageFormatter();
}
