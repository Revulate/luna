import logger from './logger.js';
import MessageLogger from './MessageLogger.js';

class ConversationHandler {
  constructor() {
    logger.startOperation('Initializing ConversationHandler');
    this.conversations = new Map();
    this.threads = new Map();
    this.threadTimeout = 300000; // 5 minutes
    this.historyLimit = 25;
    logger.debug('Conversation handler initialized');
  }

  async updateHistory(channel, user, message, metadata = {}) {
    logger.debug(`Updating conversation history for ${channel}`, {
      username: user.username,
      messageLength: message.length
    });

    const history = this.conversations.get(channel) || [];
    
    history.push({
      user: {
        name: user.username,
        displayName: user.displayName,
        ...metadata
      },
      message,
      timestamp: Date.now(),
      messageType: metadata.isAction ? 'action' : 'message',
      mentions: metadata.mentions,
      emotes: metadata.emotes
    });

    while (history.length > this.historyLimit) {
      history.shift();
    }

    this.conversations.set(channel, history);
    logger.debug(`History updated for ${channel}, current size: ${history.length}`);
  }

  getOrCreateThread(channel, user) {
    const threadKey = `${channel}-${user.username}`;
    let thread = this.threads.get(threadKey);
    
    if (!thread) {
      thread = {
        id: Date.now(),
        messages: [],
        context: {},
        lastActivity: Date.now(),
        metadata: {
          channel,
          user: user.username,
          startTime: Date.now()
        }
      };
      this.threads.set(threadKey, thread);
      logger.debug(`Created new conversation thread for ${threadKey}`);
    }

    thread.lastActivity = Date.now();
    return thread;
  }

  updateThreadContext(thread, message, metadata = {}) {
    if (!thread) {
      logger.error('Invalid thread provided to updateThreadContext');
      return;
    }

    thread.messages.push({
      content: message,
      timestamp: Date.now(),
      ...metadata
    });

    thread.lastActivity = Date.now();
    thread.context = {
      ...thread.context,
      messageCount: (thread.messages || []).length,
      lastMessageType: metadata.type || 'unknown'
    };

    // Trim old messages if needed
    const MAX_THREAD_MESSAGES = 25;
    if (thread.messages.length > MAX_THREAD_MESSAGES) {
      thread.messages = thread.messages.slice(-MAX_THREAD_MESSAGES);
    }
  }

  cleanupOldThreads() {
    const now = Date.now();
    for (const [threadKey, thread] of this.threads.entries()) {
      if (now - thread.lastActivity > this.threadTimeout) {
        this.threads.delete(threadKey);
        logger.debug(`Cleaned up inactive thread: ${threadKey}`);
      }
    }
  }

  formatConversationContext(messages) {
    if (!messages || !Array.isArray(messages)) {
      return "No recent messages available.";
    }

    try {
      const userMessages = {};
      messages.forEach(msg => {
        if (!msg?.username || !msg?.message) return;
        
        if (!userMessages[msg.username]) {
          userMessages[msg.username] = [];
        }
        userMessages[msg.username].push({
          message: String(msg.message),
          timestamp: msg.timestamp || Date.now()
        });
      });

      let contextString = "Recent chat messages:\n";
      messages.forEach(msg => {
        if (!msg?.username || !msg?.message) return;
        const timestamp = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
        contextString += `[${timestamp}] ${msg.username}: ${String(msg.message)}\n`;
      });

      return contextString;
    } catch (error) {
      logger.error('Error formatting conversation context:', error);
      return "Error formatting conversation context.";
    }
  }
}

export function setupConversation() {
  return new ConversationHandler();
}
