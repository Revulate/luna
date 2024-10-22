import Database from 'better-sqlite3';
import { config } from './config.js';
import logger from './logger.js';
import path from 'path';
import fs from 'fs';

function ensureDatabaseDirectory() {
  const dbDir = path.join(process.cwd(), 'databases');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return dbDir;
}

class DatabasePool {
  constructor(maxConnections = 5) {
    this.pool = [];
    this.maxConnections = maxConnections;
    this.dbDir = ensureDatabaseDirectory();
  }

  getConnection() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    if (this.pool.length + 1 <= this.maxConnections) {
      const dbPath = path.join(this.dbDir, config.database.filename);
      const db = new Database(dbPath, { verbose: logger.debug });
      db.pragma('journal_mode = WAL');
      return db;
    }
    throw new Error('Max connections reached');
  }

  releaseConnection(db) {
    this.pool.push(db);
  }
}

const dbPool = new DatabasePool();

let db; // Define db variable

export async function initializeDatabase() {
  try {
    const dbDir = ensureDatabaseDirectory();
    const dbPath = path.join(dbDir, config.database.filename);
    db = new Database(dbPath, { verbose: logger.debug });

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_stats (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        message_count INTEGER DEFAULT 0,
        first_seen TIMESTAMP,
        last_seen TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS steam_games (
        appid INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_histories (
        user_id TEXT PRIMARY KEY,
        history TEXT NOT NULL
      );
    `);

    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Error initializing database:', error);
    throw error;
  }
}

export function incrementMessageCount(userId, username) {
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_stats (user_id, username, message_count, first_seen, last_seen)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        message_count = message_count + 1,
        last_seen = ?
    `).run(userId, username, now, now, now);
  } catch (error) {
    logger.error('Error incrementing message count:', error);
  }
}

export function getUserStats(userId) {
  try {
    return db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
  } catch (error) {
    logger.error('Error getting user stats:', error);
    return null;
  }
}

export function runQuery(query, params = []) {
  const connection = dbPool.getConnection();
  try {
    return connection.prepare(query).run(...params);
  } finally {
    dbPool.releaseConnection(connection);
  }
}

export function getQuery(query, params = []) {
  const connection = dbPool.getConnection();
  try {
    return connection.prepare(query).get(...params);
  } finally {
    dbPool.releaseConnection(connection);
  }
}

export function allQuery(query, params = []) {
  const connection = dbPool.getConnection();
  try {
    return connection.prepare(query).all(...params);
  } finally {
    dbPool.releaseConnection(connection);
  }
}

export function getUserHistory(userId) {
  return getQuery('SELECT history FROM user_histories WHERE user_id = ?', [userId]);
}

export function updateUserHistory(userId, history) {
  return runQuery('INSERT OR REPLACE INTO user_histories (user_id, history) VALUES (?, ?)', [userId, JSON.stringify(history)]);
}
