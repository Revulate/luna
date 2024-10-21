import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

class MessageLogger {
  constructor(baseDir = './logs') {
    this.baseDir = baseDir;
    this.databases = new Map();
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
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_username ON messages(username);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    `);
  }

  logMessage(channel, userId, username, message) {
    const db = this.getDatabase(channel);
    const stmt = db.prepare('INSERT INTO messages (user_id, username, message, timestamp) VALUES (?, ?, ?, ?)');
    const timestamp = Date.now();
    stmt.run(userId, username, message, timestamp);
    logger.debug(`Logged message for ${channel}: @${username}: ${message}`);
  }

  getRecentMessages(channel, count) {
    const db = this.getDatabase(channel);
    const stmt = db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?');
    const messages = stmt.all(count).reverse();
    logger.debug(`Retrieved ${messages.length} recent messages for channel: ${channel}`);
    return messages;
  }

  getUserFirstMessage(channel, username) {
    const db = this.getDatabase(channel);
    const stmt = db.prepare('SELECT * FROM messages WHERE username = ? ORDER BY timestamp ASC LIMIT 1');
    return stmt.get(username);
  }

  getUserLastMessage(channel, username) {
    const db = this.getDatabase(channel);
    const stmt = db.prepare('SELECT * FROM messages WHERE username = ? ORDER BY timestamp DESC LIMIT 1');
    return stmt.get(username);
  }

  getUserLastMessageBefore(channel, username, timestamp) {
    const db = this.getDatabase(channel);
    const stmt = db.prepare('SELECT * FROM messages WHERE username = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1');
    return stmt.get(username, timestamp);
  }

  getUserMessageCount(channel, username) {
    const db = this.getDatabase(channel);
    const stmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE username = ?');
    return stmt.get(username).count;
  }

  close() {
    for (const db of this.databases.values()) {
      db.close();
    }
  }
}

export default new MessageLogger();
