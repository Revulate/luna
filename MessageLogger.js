import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

class MessageLogger {
  constructor(baseDir = './logs') {
    this.baseDir = baseDir;
    this.databases = new Map();
    this.messageCache = new Map(); // Add message cache
    this.cacheTTL = 5000; // 5 seconds TTL
    this.ensureBaseDir();
  }

  ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getDatabase(channel) {
    if (!this.databases.has(channel)) {
      const dbPath = path.join(this.baseDir, `${channel}.db`);
      const db = new Database(dbPath);
      this.setupDatabase(db);
      this.databases.set(channel, db);
    }
    return this.databases.get(channel);
  }

  setupDatabase(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_user_id ON messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_username ON messages(username);
    `);
  }

  async logMessage(channel, userId, username, message) {
    const db = this.getDatabase(channel);
    const stmt = db.prepare('INSERT INTO messages (timestamp, user_id, username, message) VALUES (?, ?, ?, ?)');
    const timestamp = new Date().toISOString();
    stmt.run(timestamp, userId, username, message);
    logger.debug(`Logged message for ${channel}: [${timestamp}] ${username} (${userId}): ${message}`);
  }

  async getMessages(channel, username, startDate, endDate, limit = 1000) {
    const db = this.getDatabase(channel);
    let query = 'SELECT * FROM messages WHERE 1=1';
    const params = [];

    if (username) {
      query += ' AND username = ?';
      params.push(username);
    }
    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate.toISOString());
    }
    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate.toISOString());
    }

    query += ' ORDER BY timestamp ASC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  async getUserStats(channel, userId) {
    const db = this.getDatabase(channel);
    const stats = {
      messageCount: 0,
      firstMessage: null,
      lastMessage: null
    };

    const countStmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE user_id = ?');
    stats.messageCount = countStmt.get(userId).count;

    const firstMsgStmt = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY timestamp ASC LIMIT 1');
    stats.firstMessage = firstMsgStmt.get(userId);

    const lastMsgStmt = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1');
    stats.lastMessage = lastMsgStmt.get(userId);

    return stats;
  }

  async getRecentMessages(channel, count) {
    const cacheKey = `${channel}_${count}`;
    const now = Date.now();
    const cached = this.messageCache.get(cacheKey);
    
    if (cached && (now - cached.timestamp < this.cacheTTL)) {
      return cached.messages;
    }

    try {
      const db = this.getDatabase(channel);
      // Modified query to get better context and ordering
      const stmt = db.prepare(`
        WITH NumberedMessages AS (
          SELECT 
            *,
            ROW_NUMBER() OVER (ORDER BY timestamp DESC) as row_num
          FROM messages
          ORDER BY timestamp DESC
          LIMIT ?
        )
        SELECT 
          m.*,
          (
            SELECT GROUP_CONCAT(message, ' | ')
            FROM NumberedMessages
            WHERE row_num > m.row_num AND row_num <= m.row_num + 3
          ) as next_context,
          (
            SELECT GROUP_CONCAT(message, ' | ')
            FROM NumberedMessages
            WHERE row_num < m.row_num AND row_num >= m.row_num - 3
          ) as previous_context
        FROM NumberedMessages m
        ORDER BY timestamp DESC
      `);
      
      const messages = stmt.all(count);
      const formattedMessages = messages.map(msg => ({
        username: msg.username,
        message: msg.message,
        timestamp: new Date(msg.timestamp).getTime(),
        context: {
          previous: msg.previous_context ? msg.previous_context.split(' | ') : [],
          next: msg.next_context ? msg.next_context.split(' | ') : []
        }
      }));

      // Add conversation threads
      const conversationThreads = this.groupMessagesByConversation(formattedMessages);

      const messagesWithThreads = formattedMessages.map(msg => ({
        ...msg,
        thread: conversationThreads.find(thread => 
          thread.some(m => m.timestamp === msg.timestamp)
        ) || []
      }));

      this.messageCache.set(cacheKey, {
        messages: messagesWithThreads,
        timestamp: now
      });

      logger.debug(`Retrieved ${messagesWithThreads.length} messages with context for ${channel}`);
      return messagesWithThreads;
    } catch (error) {
      logger.error(`Error getting recent messages for ${channel}: ${error}`);
      return [];
    }
  }

  // Add a new method to get messages with more context
  async getMessagesWithContext(channel, username, limit = 5) {
    const db = this.getDatabase(channel);
    const stmt = db.prepare(`
      WITH MessageContext AS (
        SELECT 
          *,
          ROW_NUMBER() OVER (PARTITION BY username ORDER BY timestamp DESC) as row_num
        FROM messages 
        WHERE username = ?
      )
      SELECT 
        m.*,
        (
          SELECT message 
          FROM messages 
          WHERE timestamp < m.timestamp 
          ORDER BY timestamp DESC 
          LIMIT 1
        ) as previous_message,
        (
          SELECT message 
          FROM messages 
          WHERE timestamp > m.timestamp 
          ORDER BY timestamp ASC 
          LIMIT 1
        ) as next_message
      FROM MessageContext m
      WHERE row_num <= ?
      ORDER BY timestamp DESC
    `);

    return stmt.all(username, limit);
  }

  close() {
    for (const db of this.databases.values()) {
      db.close();
    }
  }

  // Add this helper method to group related messages
  groupMessagesByConversation(messages) {
    const threads = [];
    const timeThreshold = 30000; // 30 seconds between messages to be considered related

    let currentThread = [];
    let lastMessage = null;

    for (const message of messages) {
      if (!lastMessage || 
          message.timestamp - lastMessage.timestamp <= timeThreshold ||
          this.areMessagesRelated(message, lastMessage)) {
        currentThread.push(message);
      } else {
        if (currentThread.length > 0) {
          threads.push([...currentThread]);
        }
        currentThread = [message];
      }
      lastMessage = message;
    }

    if (currentThread.length > 0) {
      threads.push(currentThread);
    }

    return threads;
  }

  // Add this helper method to check if messages are related
  areMessagesRelated(msg1, msg2) {
    // Check for number-color patterns
    const numberColorPattern = /(\d+)\s+(red|blue|green|yellow|orange|purple|pink|brown|black|white)/i;
    const match1 = msg1.message.match(numberColorPattern);
    const match2 = msg2.message.match(numberColorPattern);

    if (match1 || match2) return true;

    // Check for direct references
    if (msg1.message.includes(msg2.username) || msg2.message.includes(msg1.username)) return true;

    // Check for command patterns
    if ((msg1.message.startsWith('#') && msg2.message.includes('@')) ||
        (msg2.message.startsWith('#') && msg1.message.includes('@'))) return true;

    return false;
  }
}

export default new MessageLogger();
