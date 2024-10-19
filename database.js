import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { config } from './config.js';
import logger from './logger.js';

class DatabasePool {
  constructor(maxConnections = 5) {
    this.pool = [];
    this.maxConnections = maxConnections;
  }

  async getConnection() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    if (this.pool.length + 1 <= this.maxConnections) {
      const db = await open({
        filename: config.database.path,
        driver: sqlite3.Database
      });
      await db.run('PRAGMA journal_mode = WAL;');
      return db;
    }
    throw new Error('Max connections reached');
  }

  async releaseConnection(db) {
    this.pool.push(db);
  }
}

const dbPool = new DatabasePool();

let db; // Define db variable

export async function initializeDatabase() {
  try {
    db = await open({
      filename: config.database.path,
      driver: sqlite3.Database
    });

    // Enable WAL mode for better concurrency
    await db.run('PRAGMA journal_mode = WAL;');

    await db.exec(`
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
    `);

    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Error initializing database:', error);
    throw error;
  }
}

export async function incrementMessageCount(userId, username) {
  try {
    const now = new Date().toISOString();
    await db.run(`
      INSERT INTO user_stats (user_id, username, message_count, first_seen, last_seen)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        message_count = message_count + 1,
        last_seen = ?
    `, [userId, username, now, now, now]);
  } catch (error) {
    logger.error('Error incrementing message count:', error);
  }
}

export async function getUserStats(userId) {
  try {
    return await db.get('SELECT * FROM user_stats WHERE user_id = ?', userId);
  } catch (error) {
    logger.error('Error getting user stats:', error);
    return null;
  }
}

export async function runQuery(query, params = []) {
  const connection = await dbPool.getConnection();
  try {
    return await connection.run(query, params);
  } finally {
    await dbPool.releaseConnection(connection);
  }
}

export async function getQuery(query, params = []) {
  const connection = await dbPool.getConnection();
  try {
    return await connection.get(query, params);
  } finally {
    await dbPool.releaseConnection(connection);
  }
}

export async function allQuery(query, params = []) {
  const connection = await dbPool.getConnection();
  try {
    return await connection.all(query, params);
  } finally {
    await dbPool.releaseConnection(connection);
  }
}
