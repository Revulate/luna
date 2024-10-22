import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import { config } from '../config.js';
import logger from '../logger.js';
import { setTimeout as setTimeoutPromise } from 'timers/promises';
import jsonStream from 'jsonstream/index.js';
import { pipeline } from 'stream/promises';
import path from 'path';

class Spc {
  constructor(bot) {
    this.bot = bot;
    this.logger = logger;
    this.steamApiKey = config.steam.apiKey;
    this.dbPath = path.join(process.cwd(), 'databases', 'steam_game.db');
    this.isDataFetching = false;
    this.gameCache = new Map();
    this.playerCountCache = new Map();
    this.reviewsCache = new Map();
    this.gameDetailsCache = new Map();
    this.MAX_CACHE_SIZE = 1000;
    this.PLAYER_COUNT_CACHE_EXPIRY = 300000; // 5 minutes in milliseconds
    this.REVIEWS_CACHE_EXPIRY = 3600000; // 1 hour in milliseconds
    this.GAME_DETAILS_CACHE_EXPIRY = 86400000; // 24 hours in milliseconds
    this.isInTransaction = false;
    this.isFetchingData = false;
    this.preparedStatements = {};
    this.db = null;
    this.dbConnection = null;
    this.FETCH_INTERVAL = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds
  }

  async initialize() {
    await this._setupDatabase();
    await this._prepareStatements();
    await this.checkAndFetchGamesData();
    setInterval(() => this.clearOldCacheEntries(), 3600000); // Clear old cache entries every hour
    this.logger.info("Spc module initialized.");
  }

  async _setupDatabase() {
    this.db = new Database(this.dbPath, { verbose: this.logger.debug });
    // No need to create a connection, better-sqlite3 manages it internally
    this.dbConnection = this.db; // Use the db instance directly

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS Steam_Game (
        ID INTEGER PRIMARY KEY,
        Name TEXT NOT NULL,
        LastUpdated INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_name ON Steam_Game(Name);

      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        time_played INTEGER NOT NULL,
        last_played TEXT NOT NULL,
        image_url TEXT
      );

      CREATE TABLE IF NOT EXISTS last_fetch (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        timestamp INTEGER NOT NULL
      );
    `);
    this.logger.info("Steam_Game, games, and last_fetch tables and index set up.");
  }

  async _prepareStatements() {
    this.preparedStatements = {
      insertGame: this.db.prepare('INSERT OR REPLACE INTO Steam_Game (ID, Name, LastUpdated) VALUES (?, ?, ?)'),
      findGameByName: this.db.prepare('SELECT ID, Name FROM Steam_Game WHERE Name LIKE ?'),
      getAllGames: this.db.prepare('SELECT name, image_url FROM games WHERE image_url IS NOT NULL'),
      getLastFetch: this.db.prepare('SELECT timestamp FROM last_fetch WHERE id = 1'),
      updateLastFetch: this.db.prepare('INSERT OR REPLACE INTO last_fetch (id, timestamp) VALUES (1, ?)'),
      bulkInsertGames: this.db.prepare(`
        INSERT OR REPLACE INTO Steam_Game (ID, Name, LastUpdated)
        VALUES (@id, @name, @lastUpdated)
      `)
    };
  }

  async checkAndFetchGamesData() {
    const lastFetch = this.preparedStatements.getLastFetch.get();
    const currentTime = Date.now();

    if (!lastFetch || (currentTime - lastFetch.timestamp) >= this.FETCH_INTERVAL) {
      this.logger.info('Starting Steam games data fetch');
      await this.fetchSteamGamesData();
      this.preparedStatements.updateLastFetch.run(currentTime);
      this.logger.info('Steam games data fetch completed');
    } else {
      this.logger.info('Skipping Steam games data fetch, last fetch was recent');
    }

    // Schedule the next check
    setTimeout(() => this.checkAndFetchGamesData(), this.FETCH_INTERVAL);
  }

  async fetchSteamGamesData() {
    if (this.isFetchingData) {
      this.logger.info('Steam games data fetch already in progress. Skipping.');
      return;
    }

    this.isFetchingData = true;
    try {
      if (!this.steamApiKey) {
        this.logger.error('Steam API key is not set');
        return;
      }
      const url = `http://api.steampowered.com/ISteamApps/GetAppList/v0002/?key=${this.steamApiKey}&format=json`;
      const response = await fetch(url, { 
        timeout: 30000,
        headers: { 'Accept-Encoding': 'gzip,deflate' }
      });
      
      const jsonParser = jsonStream.parse('applist.apps.*');
      
      // Start a transaction
      this.db.exec('BEGIN TRANSACTION');
      
      const gameBatch = [];
      const batchSize = 1000;

      await new Promise((resolve, reject) => {
        pipeline(
          response.body,
          jsonParser,
          async function (source) {
            for await (const game of source) {
              const { appid, name } = game;
              if (appid && name) {
                gameBatch.push({ id: appid, name, lastUpdated: Date.now() });
                if (gameBatch.length >= batchSize) {
                  await this._bulkInsertGames(gameBatch);
                  gameBatch.length = 0;
                }
              }
            }
            if (gameBatch.length > 0) {
              await this._bulkInsertGames(gameBatch);
            }
          }.bind(this)
        )
        .then(resolve)
        .catch(reject);
      });

      // Commit the transaction
      this.db.exec('COMMIT');
      
      this.logger.info("Steam games data updated successfully.");
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.logger.error(`Error updating the database: ${error}`, error);
    } finally {
      this.isFetchingData = false;
    }
  }

  async _bulkInsertGames(games) {
    const transaction = this.db.transaction((games) => {
      const stmt = this.preparedStatements.bulkInsertGames;
      for (const game of games) {
        stmt.run(game);
      }
    });
    transaction(games);
  }

  async handleSpcCommand({ channel, user, args, bot }) {
    const username = user.username || user.name || user['display-name'] || 'Unknown User';
    const userId = user.userId || user.id || 'Unknown ID';
    this.logger.info(`[MESSAGE] Processing #spc command from ${username} (ID: ${userId})`);

    if (!this.steamApiKey) {
      await bot.say(channel, `@${username}, Steam API key is not configured.`);
      return;
    }

    const { gameID, skipReviews, gameName } = this.parseArguments(args);
    if (gameID === null && gameName === null) {
      await bot.say(channel, `@${username}, please provide a game ID or name.`);
      return;
    }

    let finalGameID = gameID;
    if (!finalGameID && gameName) {
      finalGameID = await this.findGameIdByName(gameName);
      if (!finalGameID) {
        await bot.say(channel, `@${username}, no games found for your query: '${gameName}'.`);
        return;
      }
      this.logger.debug(`Game name provided. Found Game ID: ${finalGameID}`);
    }

    const playerCount = await this.getCurrentPlayerCount(finalGameID);
    if (playerCount === null) {
      await bot.say(channel, `@${username}, could not retrieve player count for game ID ${finalGameID}.`);
      return;
    }

    const reviewsString = skipReviews ? "" : await this.getGameReviews(finalGameID);
    const gameDetails = await this.getGameDetails(finalGameID);
    if (!gameDetails) {
      await bot.say(channel, `@${username}, could not retrieve details for game ID ${finalGameID}.`);
      return;
    }

    const steamUrl = `https://store.steampowered.com/app/${finalGameID}`;
    let reply = `${gameDetails.name} (by ${gameDetails.developers.join(', ')}) currently has **${playerCount}** players in-game.`;
    reply += ` Steam URL: ${steamUrl}`;
    if (reviewsString) {
      reply += ` ${reviewsString}`;
    }

    await bot.say(channel, reply);
  }

  parseArguments(args) {
    let gameID = null;
    let skipReviews = false;
    let gameName = null;

    if (args.length === 0) {
      return { gameID, skipReviews, gameName };
    }

    if (/^\d+$/.test(args[0])) {
      gameID = parseInt(args[0], 10);
      args = args.slice(1);
      if (args.length > 0 && ["true", "1", "yes"].includes(args[0].toLowerCase())) {
        skipReviews = true;
        args = args.slice(1);
      }
    }

    if (args.length > 0) {
      gameName = args.join(" ");
    }

    return { gameID, skipReviews, gameName };
  }

  async findGameIdByName(gameName) {
    this.logger.info(`Searching for game by name: ${gameName}`);
    const lowerGameName = gameName.toLowerCase();
    if (this.gameCache.has(lowerGameName)) {
      return this.gameCache.get(lowerGameName);
    }

    try {
      const games = await this.preparedStatements.findGameByName.all(`%${gameName}%`);

      if (games.length === 0) return null;

      const bestMatch = this._findBestMatch(gameName, games);

      if (bestMatch) {
        this._updateGameCache(lowerGameName, bestMatch.ID);
        this.logger.debug(`Fuzzy match found: '${bestMatch.Name}' with App ID ${bestMatch.ID}`);
        return bestMatch.ID;
      }
    } catch (error) {
      this.logger.error(`Error during game search: ${error}`, error);
    }

    this.logger.info(`No suitable fuzzy match found for game name: ${gameName}`);
    return null;
  }

  _findBestMatch(gameName, games) {
    return games.reduce((best, game) => {
      const similarity = this.levenshteinDistance(gameName.toLowerCase(), game.Name.toLowerCase());
      return similarity < best.similarity ? { game, similarity } : best;
    }, { game: null, similarity: Infinity }).game;
  }

  _updateGameCache(key, value) {
    this.gameCache.set(key, value);
    if (this.gameCache.size > this.MAX_CACHE_SIZE) {
      const firstKey = this.gameCache.keys().next().value;
      this.gameCache.delete(firstKey);
    }
  }

  levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  async getCurrentPlayerCount(appId) {
    const cachedData = this.playerCountCache.get(appId);
    if (cachedData && Date.now() - cachedData.timestamp < this.PLAYER_COUNT_CACHE_EXPIRY) {
      return cachedData.count;
    }

    try {
      const params = new URLSearchParams({ appid: appId, key: this.steamApiKey });
      const response = await fetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?${params}`, { timeout: 10000 });
      if (!response.ok) {
        throw new Error(`Failed to fetch player count for App ID ${appId}: ${response.status}`);
      }
      const data = await response.json();
      const playerCount = data.response.player_count;
      this._updatePlayerCountCache(appId, playerCount);
      return playerCount;
    } catch (error) {
      this.logger.error(`Exception during player count fetch: ${error}`, error);
      return null;
    }
  }

  _updatePlayerCountCache(appId, count) {
    this.playerCountCache.set(appId, { count, timestamp: Date.now() });
    if (this.playerCountCache.size > this.MAX_CACHE_SIZE) {
      const firstKey = this.playerCountCache.keys().next().value;
      this.playerCountCache.delete(firstKey);
    }
  }

  async getGameReviews(appId) {
    const cachedData = this.reviewsCache.get(appId);
    if (cachedData && Date.now() - cachedData.timestamp < this.REVIEWS_CACHE_EXPIRY) {
      return cachedData.reviews;
    }

    const url = `https://store.steampowered.com/appreviews/${appId}/?json=1&filter=all&language=all`;
    try {
      const response = await fetch(url, { timeout: 10000 });
      if (!response.ok) {
        throw new Error(`Failed to fetch reviews for App ID ${appId}: ${response.status}`);
      }
      const data = await response.json();
      const summary = data.query_summary;
      const totalReviews = summary.total_reviews;
      const totalPositive = summary.total_positive;
      const reviewScoreDesc = summary.review_score_desc;

      let reviews;
      if (totalReviews > 0) {
        const scorePercentage = ((totalPositive / totalReviews) * 100).toFixed(1);
        reviews = `Rating: ${reviewScoreDesc} (${scorePercentage}% positive)`;
      } else {
        reviews = `Rating: ${reviewScoreDesc}`;
      }

      this.reviewsCache.set(appId, { reviews, timestamp: Date.now() });
      if (this.reviewsCache.size > this.MAX_CACHE_SIZE) {
        const firstKey = this.reviewsCache.keys().next().value;
        this.reviewsCache.delete(firstKey);
      }
      return reviews;
    } catch (error) {
      this.logger.error(`Exception during reviews fetch: ${error}`, error);
      return "Could not fetch reviews data.";
    }
  }

  async getGameDetails(appId) {
    const cachedData = this.gameDetailsCache.get(appId);
    if (cachedData && Date.now() - cachedData.timestamp < this.GAME_DETAILS_CACHE_EXPIRY) {
      return cachedData.details;
    }

    const params = new URLSearchParams({ appids: appId });
    try {
      const response = await fetch(`https://store.steampowered.com/api/appdetails?${params}`, { timeout: 10000 });
      if (!response.ok) {
        throw new Error(`Failed to fetch game details for App ID ${appId}: ${response.status}`);
      }
      const data = await response.json();
      if (!data[appId] || !data[appId].success || !data[appId].data) {
        this.logger.error(`No valid data found for App ID ${appId}.`);
        return null;
      }
      const gameData = data[appId].data;
      const details = {
        name: gameData.name || "Unknown",
        developers: gameData.developers || []
      };

      this.gameDetailsCache.set(appId, { details, timestamp: Date.now() });
      if (this.gameDetailsCache.size > this.MAX_CACHE_SIZE) {
        const firstKey = this.gameDetailsCache.keys().next().value;
        this.gameDetailsCache.delete(firstKey);
      }
      return details;
    } catch (error) {
      this.logger.error(`Exception during game details fetch: ${error}`, error);
      return null;
    }
  }

  clearOldCacheEntries() {
    const now = Date.now();
    this.playerCountCache.forEach((value, key) => {
      if (now - value.timestamp > this.PLAYER_COUNT_CACHE_EXPIRY) {
        this.playerCountCache.delete(key);
      }
    });
    this.reviewsCache.forEach((value, key) => {
      if (now - value.timestamp > this.REVIEWS_CACHE_EXPIRY) {
        this.reviewsCache.delete(key);
      }
    });
    this.gameDetailsCache.forEach((value, key) => {
      if (now - value.timestamp > this.GAME_DETAILS_CACHE_EXPIRY) {
        this.gameDetailsCache.delete(key);
      }
    });
  }

  async cleanup() {
    if (this.db) {
      await this.db.close();
      this.logger.info("Database connection closed.");
    }
  }
}

export function setupSpc(bot) {
  const spc = new Spc(bot);
  spc.initialize();
  
  process.on('exit', () => {
    spc.cleanup();
  });
  
  return {
    spc: async (context) => await spc.handleSpcCommand(context),
  };
}
