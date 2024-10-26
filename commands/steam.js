import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import { config } from '../config.js';
import logger from '../utils/logger.js';
import { setTimeout as setTimeoutPromise } from 'timers/promises';
import jsonStream from 'jsonstream/index.js';
import { pipeline } from 'stream/promises';
import path from 'path';
import * as fuzzball from 'fuzzball';
import { metaphone } from 'metaphone';
import { MessageLogger } from '../utils/MessageLogger.js';
import { serviceRegistry } from '../utils/serviceRegistry.js';
import FuzzySearcher from '../utils/fuzzySearch.js';

class Spc {
  constructor(bot) {
    logger.startOperation('Initializing Steam Handler');
    this.bot = bot;
    this.steamApiKey = config.steam.apiKey;
    this.dbPath = path.join(process.cwd(), 'databases', 'steam_game.db');
    this.isDataFetching = false;
    this.gameCache = new Map();
    this.playerCountCache = new Map();
    this.reviewsCache = new Map();
    this.gameDetailsCache = new Map();
    this.MAX_CACHE_SIZE = 1000;
    this.PLAYER_COUNT_CACHE_EXPIRY = 300000; // 5 minutes
    this.REVIEWS_CACHE_EXPIRY = 3600000; // 1 hour
    this.GAME_DETAILS_CACHE_EXPIRY = 86400000; // 24 hours
    this.isInTransaction = false;
    this.isFetchingData = false;
    this.preparedStatements = {};
    this.db = null;
    this.dbConnection = null;
    this.FETCH_INTERVAL = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds
    this.textVariations = {
      // Roman numerals
      'i': '1',
      'ii': '2',
      'iii': '3',
      'iv': '4',
      'v': '5',
      'vi': '6',
      'vii': '7',
      'viii': '8',
      'ix': '9',
      'x': '10',
      // Common variations
      '&': 'and',
      '+': 'plus',
      // Common abbreviations
      'ff': 'final fantasy',
      'ff7': 'final fantasy vii',
      'ffvii': 'final fantasy vii',
      'ff 7': 'final fantasy vii',
      'gta': 'grand theft auto',
      'cod': 'call of duty',
      'ac': "assassin's creed",
      'dmc': 'devil may cry',
      'tlou': 'the last of us',
      'botw': 'breath of the wild',
      'totk': 'tears of the kingdom',
      'dbd': 'dead by daylight',
      'btd': 'bloons td',
      'btd6': 'bloons td 6',
      'ds': 'dark souls',
      'ds3': 'dark souls 3',
      'er': 'elden ring',
      'p5': 'persona 5',
      'p5r': 'persona 5 royal',
      'mhw': 'monster hunter world',
      'rdr2': 'red dead redemption 2',
      // Common typos or variations
      'witcher': 'the witcher',
      'scrolls': 'the elder scrolls',
      'souls': 'dark souls',
      'd4': 'diablo 4',
      'd3': 'diablo 3',
      'd2': 'destiny 2',  // Changed from 'diablo 2' to 'destiny 2'
      'diablo': 'diablo',
      'destiny': 'destiny'
    };
    this.gamePatterns = {
      'divinity 2': 'divinity original sin 2',
      'divinity ii': 'divinity original sin 2',
      'dos2': 'divinity original sin 2',
      'ff7r': 'final fantasy vii remake',
      'ff7 r': 'final fantasy vii remake',
      'ff 7 r': 'final fantasy vii remake',
      'ff7 remake': 'final fantasy vii remake',
      'ff 7 remake': 'final fantasy vii remake',
      'ffvii remake': 'final fantasy vii remake',
      'ff vii remake': 'final fantasy vii remake',
      'final fantasy 7 remake': 'final fantasy vii remake',
      'final fantasy vii remake': 'final fantasy vii remake',
      'ff7rb': 'final fantasy vii rebirth',
      'ff7 rebirth': 'final fantasy vii rebirth',
      'ff 7 rebirth': 'final fantasy vii rebirth',
      'ffvii rebirth': 'final fantasy vii rebirth',
      'ff vii rebirth': 'final fantasy vii rebirth',
      'persona5': 'persona 5',
      'p5r': 'persona 5 royal',
      'mgs': 'metal gear solid',
      'dmc': 'devil may cry',
      're': 'resident evil',
      'yakuza 0': 'yakuza zero',
      'nier': 'nier automata',
      'borderlands 3': 'borderlands iii',
      'borderlands 2': 'borderlands ii',
      'mass effect': 'mass effect legendary edition',
      'me1': 'mass effect legendary edition',
      'me2': 'mass effect 2',
      'me3': 'mass effect 3',
      'dbd': 'dead by daylight',
      'bloons': 'bloons td',
      'btd': 'bloons td',
      'd4': 'diablo iv',
      'diablo 4': 'diablo iv',
      'diablo four': 'diablo iv',
      'diablo iv': 'diablo iv',
      'd3': 'diablo iii',
      'diablo 3': 'diablo iii',
      'diablo three': 'diablo iii',
      'diablo iii': 'diablo iii',
      'd2': 'destiny 2',
      'destiny2': 'destiny 2',
      'destiny 2': 'destiny 2',
      'destiny two': 'destiny 2',
      'diablo 2': 'diablo ii',
      'diablo two': 'diablo ii',
      'diablo ii': 'diablo ii',
      'gta5': 'grand theft auto v',
      'gtav': 'grand theft auto v',
      'gta 5': 'grand theft auto v',
      'gta v': 'grand theft auto v',
      'gta': 'grand theft auto',
      'kakarot': 'dragon ball z: kakarot',
      'dbz kakarot': 'dragon ball z: kakarot',
      'dragon ball kakarot': 'dragon ball z: kakarot',
      'dbz': 'dragon ball z',
      'sparking zero': 'dragon ball: sparking! zero',
      'sparking': 'dragon ball: sparking! zero',
      'dbz sparking': 'dragon ball: sparking! zero',
      'dragon ball sparking': 'dragon ball: sparking! zero'
    };
    // Add new cache for sales data
    this.salesCache = new Map();
    this.SALES_CACHE_EXPIRY = 300000; // 5 minutes
    
    logger.debug('Steam handler initialized with settings', {
      maxCacheSize: this.MAX_CACHE_SIZE,
      cacheExpiry: {
        playerCount: this.PLAYER_COUNT_CACHE_EXPIRY,
        reviews: this.REVIEWS_CACHE_EXPIRY,
        gameDetails: this.GAME_DETAILS_CACHE_EXPIRY
      }
    });

    this.fuzzySearcher = new FuzzySearcher({
      abbreviations: this.textVariations,
      patterns: this.gamePatterns
    });
  }

  async initialize() {
    await this._setupDatabase();
    await this._prepareStatements();
    await this.checkAndFetchGamesData();
    setInterval(() => this.clearOldCacheEntries(), 3600000); // Clear old cache entries every hour
    logger.endOperation('Initializing Steam Handler', true);
  }

  async _setupDatabase() {
    this.db = new Database(this.dbPath, { verbose: logger.debug });
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
    logger.info("Steam_Game, games, and last_fetch tables and index set up.");
  }

  async _prepareStatements() {
    this.preparedStatements = {
      insertGame: this.db.prepare('INSERT OR REPLACE INTO Steam_Game (ID, Name, LastUpdated) VALUES (?, ?, ?)'),
      // Update the findGameByName query to be more flexible
      findGameByName: this.db.prepare(`
        SELECT DISTINCT ID, Name 
        FROM Steam_Game 
        WHERE LOWER(Name) LIKE LOWER(?)
        OR LOWER(Name) LIKE LOWER(?)
        OR LOWER(Name) LIKE LOWER(?)
        OR LOWER(Name) LIKE LOWER(?)
        OR LOWER(Name) LIKE LOWER(?)
        OR LOWER(Name) LIKE LOWER(?)
      `),
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
      logger.info('Starting Steam games data fetch');
      await this.fetchSteamGamesData();
      this.preparedStatements.updateLastFetch.run(currentTime);
      logger.info('Steam games data fetch completed');
    } else {
      logger.info('Skipping Steam games data fetch, last fetch was recent');
    }

    // Schedule the next check
    setTimeout(() => this.checkAndFetchGamesData(), this.FETCH_INTERVAL);
  }

  async fetchSteamGamesData() {
    if (this.isFetchingData) {
      logger.info('Steam games data fetch already in progress. Skipping.');
      return;
    }

    this.isFetchingData = true;
    try {
      if (!this.steamApiKey) {
        logger.error('Steam API key is not set');
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
      
      logger.info("Steam games data updated successfully.");
    } catch (error) {
      this.db.exec('ROLLBACK');
      logger.error(`Error updating the database: ${error}`, error);
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

  async handleCommand({ channel, user, args, say, commandName }) {
    const username = user.username || user.name || user['display-name'] || 'Unknown User';
    const userId = user.userId || user.id || 'Unknown ID';
    logger.info(`[MESSAGE] Processing #${commandName} command from ${username} (ID: ${userId})`);

    // Handle steam command
    if (commandName === 'steam') {
        if (!args || args.length === 0) {
            await say(`@${username}, Usage: #steam <profile/recent/avatar/sales> [Steam ID/Profile URL]`);
            return;
        }

        const subCommand = args[0].toLowerCase();
        const subCommandArgs = args.slice(1).join(' ');

        switch (subCommand) {
            case 'profile':
                await this.handleProfileCommand(username, subCommandArgs, say, channel);
                break;
            case 'recent':
                await this.handleRecentGamesCommand(username, subCommandArgs, say, channel);
                break;
            case 'avatar':
                await this.handleAvatarCommand(username, subCommandArgs, say, channel);
                break;
            case 'sales':
            case 'sale':
                await this.handleSalesCommand(username, say, channel);
                break;
            default:
                const response = `@${username}, Invalid subcommand. Available commands: profile, recent, avatar, sales`;
                await MessageLogger.logBotMessage(channel, response);
                await say(response);
        }
        return;
    }

    // Handle spc command (existing logic)
    if (!this.steamApiKey) {
        await say(`@${username}, Steam API key is not configured.`);
        return;
    }

    // Rest of the existing spc command logic...
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

  async findGameByName(gameName) {
    try {
      const allGames = this.preparedStatements.selectAllGames.all();
      const { match, suggestions } = await this.fuzzySearcher.findMatch(gameName, allGames);
      
      if (match) return match;
      if (suggestions.length > 0) {
        throw new Error(`Did you mean one of these: ${suggestions.join(' • ')}?`);
      }
      return null;
    } catch (error) {
      if (error.message.includes('Did you mean')) throw error;
      logger.error('Error finding game:', error);
      throw error;
    }
  }

  _updateGameCache(key, value) {
    this.gameCache.set(key, {
        id: value,
        timestamp: Date.now()
    });
    if (this.gameCache.size > this.MAX_CACHE_SIZE) {
        // Remove oldest entries first
        const now = Date.now();
        for (const [k, v] of this.gameCache.entries()) {
            if (now - v.timestamp > 3600000) { // 1 hour
                this.gameCache.delete(k);
            }
        }
        // If still over size, remove oldest entry
        if (this.gameCache.size > this.MAX_CACHE_SIZE) {
            const firstKey = this.gameCache.keys().next().value;
            this.gameCache.delete(firstKey);
        }
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
      logger.error(`Exception during player count fetch: ${error}`, error);
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
      logger.error(`Exception during reviews fetch: ${error}`, error);
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
        logger.error(`No valid data found for App ID ${appId}.`);
        return null;
      }
      const gameData = data[appId].data;
      const details = {
        name: gameData.name || "Unknown",
        developers: gameData.developers || [],
        // Add price information
        price: gameData.is_free ? "Free to Play" : 
               gameData.price_overview ? `${gameData.price_overview.final_formatted}` : "N/A",
        // Add if game is on sale
        discount: gameData.price_overview?.discount_percent > 0 ? 
                 `${gameData.price_overview.discount_percent}% OFF` : null,
        // Add to getGameDetails method
        genres: gameData.genres?.map(g => g.description).join(', ') || "N/A",
        categories: gameData.categories?.map(c => c.description).join(', ') || "N/A",
        // Add multiplayer/singleplayer status
        multiplayer: gameData.categories?.some(c => 
            c.description.includes("Multi-player") || 
            c.description.includes("Co-op")
        ),
        minRequirements: gameData.pc_requirements?.minimum || "N/A",
        recommendedRequirements: gameData.pc_requirements?.recommended || "N/A",
        releaseDate: gameData.release_date?.date || "N/A",
        publisher: gameData.publishers?.[0] || "N/A",
        developer: gameData.developers?.[0] || "N/A"
      };

      this.gameDetailsCache.set(appId, { details, timestamp: Date.now() });
      if (this.gameDetailsCache.size > this.MAX_CACHE_SIZE) {
        const firstKey = this.gameDetailsCache.keys().next().value;
        this.gameDetailsCache.delete(firstKey);
      }
      return details;
    } catch (error) {
      logger.error(`Exception during game details fetch: ${error}`, error);
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
      logger.info("Database connection closed.");
    }
  }

  // Add new method to fetch DLC info
  async getGameDLC(appId) {
    const url = `https://store.steampowered.com/api/dlc/${appId}`;
    const response = await fetch(url);
    const data = await response.json();
    return {
        dlcCount: data.items?.length || 0,
        dlcList: data.items?.map(dlc => dlc.name) || []
    };
  }

  // Move all methods inside the class
  async handleStatsCommand(username, gameName, say) {
    if (!gameName) {
      await say(`@${username}, Please provide a game name.`);
      return;
    }

    try {
      const gameID = await this.findGameIdByName(gameName);
      if (!gameID) {
        await say(`@${username}, no games found for your query: '${gameName}'.`);
        return;
      }

      // Get current players from Steam API
      const playerCount = await this.getCurrentPlayerCount(gameID);
      if (!playerCount) {
        await say(`@${username}, could not retrieve player count for ${gameName}.`);
        return;
      }

      const gameDetails = await this.getGameDetails(gameID);
      if (!gameDetails) {
        await say(`@${username}, could not retrieve details for game ID ${gameID}.`);
        return;
      }

      // Get Steam Charts data for peaks
      try {
        const steamChartsUrl = `https://steamcharts.com/app/${gameID}/chart-data.json`;
        const response = await fetch(steamChartsUrl);
        const steamChartsData = await response.json();

        // Calculate peaks from Steam Charts data
        const last24Hours = steamChartsData.slice(-24);
        const peak24h = Math.max(...last24Hours.map(d => d[1]).filter(Boolean));
        const allTimePeak = Math.max(...steamChartsData.map(d => d[1]).filter(Boolean));

        await say(
          `@${username}, ${gameDetails.name} Stats • Current Players: ${playerCount.toLocaleString()} • 24h Peak: ${peak24h.toLocaleString()} • All-Time Peak: ${allTimePeak.toLocaleString()}`
        );
      } catch (chartsError) {
        // If Steam Charts fails, just show current players
        logger.error(`Steam Charts fetch failed: ${chartsError}`);
        await say(
          `@${username}, ${gameDetails.name} Stats • Current Players: ${playerCount.toLocaleString()}`
        );
      }
    } catch (error) {
      logger.error(`Error in SPC stats command: ${error}`);
      await say(
        `@${username}, an error occurred while fetching player statistics.`
      );
    }
  }

  // Add all other methods that were after the export
  _generateTypoPatterns(name) {
    const patterns = [];
    // Handle common typos by replacing similar characters
    const typoMap = {
        'a': ['e', '@'],
        'e': ['a', '3'],
        'i': ['1', 'l', '!'],
        'o': ['0'],
        's': ['5', '$'],
        't': ['7'],
        'b': ['6'],
        'g': ['9'],
        'z': ['2']
    };

    // Generate patterns with common typos
    for (let i = 0; i < name.length; i++) {
        const char = name[i].toLowerCase();
        if (typoMap[char]) {
            typoMap[char].forEach(replacement => {
                patterns.push(
                    name.slice(0, i) + replacement + name.slice(i + 1)
                );
            });
        }
    }

    return patterns;
  }

  _calculateAcronymScore(searchTerm, gameName) {
    // Create acronym from game name
    const acronym = gameName.split(' ')
        .map(word => word[0])
        .join('')
        .toLowerCase();

    // Check if search term matches acronym
    if (searchTerm === acronym) {
        return 100;
    }

    // Check if search term is part of acronym
    if (acronym.includes(searchTerm)) {
        return 50;
    }

    return 0;
  }

  _simplePhonetic(str) {
    return str.toLowerCase()
        .replace(/[aeiou]/g, 'a')  // Convert all vowels to 'a'
        .replace(/[bfpv]/g, 'b')   // Similar sounding consonants
        .replace(/[cghjkq]/g, 'c')
        .replace(/[dt]/g, 'd')
        .replace(/[mn]/g, 'm')
        .replace(/[lr]/g, 'r')
        .replace(/[sz]/g, 's')
        .replace(/[xy]/g, 'x')
        .replace(/w/g, 'v')
        .replace(/(\w)\1+/g, '$1'); // Remove repeated characters
  }

  async _fuzzySearch(searchTerm) {
    const searchPhonetic = this._simplePhonetic(searchTerm);
    
    const allGames = await this.preparedStatements.getAllGames.all();
    
    const matches = allGames
        .map(game => ({
            game,
            phoneticScore: this._simplePhonetic(game.Name) === searchPhonetic ? 100 : 0,
            levenScore: 100 - (this.levenshteinDistance(searchTerm, game.Name.toLowerCase()) * 10)
        }))
        .map(match => ({
            ...match,
            totalScore: (match.phoneticScore + match.levenScore) / 2
        }))
        .filter(match => match.totalScore > 50)
        .sort((a, b) => b.totalScore - a.totalScore);

    return matches.length > 0 ? matches[0].game.ID : null;
  }

  _calculateSeriesScore(searchTerm, fullGameName) {
    const seriesPatterns = {
        'dragon ball': ['dbz', 'dragon ball z', 'kakarot', 'sparking', 'sparking zero'],
        'final fantasy': ['ff', 'ffvii', 'ff7'],
        'grand theft auto': ['gta'],
        // Add more series patterns as needed
    };

    const lowerFullName = fullGameName.toLowerCase();
    const searchTermLower = searchTerm.toLowerCase();

    for (const [series, patterns] of Object.entries(seriesPatterns)) {
        if (lowerFullName.includes(series)) {
            // Check if search term matches any pattern for this series
            if (patterns.some(pattern => 
                searchTermLower.includes(pattern) || 
                pattern.includes(searchTermLower)
            )) {
                return 100;
            }
        }
    }

    return 0;
  }

  _normalizeWithArticles(name) {
    // List of articles to handle
    const articles = ['the', 'a', 'an'];
    const words = name.toLowerCase().split(' ');
    
    // Create variations with and without articles
    let variations = [words.join(' ')];
    
    // If first word is an article, add version without it
    if (articles.includes(words[0])) {
        variations.push(words.slice(1).join(' '));
    }
    
    // If it doesn't start with an article, add versions with articles
    if (!articles.includes(words[0])) {
        articles.forEach(article => {
            variations.push(`${article} ${words.join(' ')}`);
        });
    }
    
    return variations;
  }

  _normalizeGameName(name) {
    return name.toLowerCase()
        .replace(/[!?:]/g, '') // Remove special characters
        .replace(/\s+/g, ' ')  // Normalize spaces
        .trim();
  }

  async handleSalesCommand(username, say, channel) {
    const cachedData = this.salesCache.get('current');
    if (cachedData && Date.now() - cachedData.timestamp < this.SALES_CACHE_EXPIRY) {
      await say(cachedData.message);
      return;
    }

    try {
      const storeUrl = 'https://store.steampowered.com/api/featuredcategories';
      const storeResponse = await fetch(storeUrl);
      const storeData = await storeResponse.json();

      if (storeData.specials?.items?.length > 0) {
        const sales = storeData.specials.items
          .slice(0, 3)
          .map(item => {
            const finalPrice = (item.final_price / 100).toFixed(2);
            return `${item.name} (-${item.discount_percent}% • $${finalPrice})`;
          })
          .join(' • ');

        const message = `@${username}, Current top sales: ${sales}`;
        this.salesCache.set('current', { message, timestamp: Date.now() });
        await MessageLogger.logBotMessage(channel, message);
        await say(message);
      } else {
        const message = `@${username}, No featured sales found at the moment.`;
        await MessageLogger.logBotMessage(channel, message);
        await say(message);
      }
    } catch (error) {
      logger.error('Error fetching Steam sales:', error);
      throw new Error(`Sales fetch failed: ${error.message}`);
    }
  }

  async handleProfileCommand(username, query, say, channel) {
    try {
      const steamId = await this.resolveSteamId(query || username);
      if (!steamId) {
        const noIdMsg = `@${username}, Could not find Steam ID for that user.`;
        const messageLogger = serviceRegistry.getService('messageLogger');
        await messageLogger.logUserMessage(channel, 'BOT', noIdMsg);
        await say(noIdMsg);
        return;
      }

      // Fetch profile, owned games, and recent playtime in parallel
      const [profileResponse, gamesResponse] = await Promise.all([
        fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${this.steamApiKey}&steamids=${steamId}`),
        fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${this.steamApiKey}&steamid=${steamId}&include_played_free_games=true&include_appinfo=true`)
      ]);

      const [profileData, gamesData] = await Promise.all([
        profileResponse.json(),
        gamesResponse.json()
      ]);

      if (!profileData.response?.players?.[0]) {
        const noProfileMsg = `@${username}, No profile data found for: ${query}`;
        const messageLogger = serviceRegistry.getService('messageLogger');
        await messageLogger.logUserMessage(channel, 'BOT', noProfileMsg);
        await say(noProfileMsg);
        return;
      }

      const profile = profileData.response.players[0];
      const games = gamesData.response;
      const status = this.getPlayerStatus(profile);
      
      // Calculate statistics with proper formatting
      const totalGames = games?.game_count || 0;
      const totalPlaytime = games?.games?.reduce((total, game) => total + (game.playtime_forever || 0), 0) || 0;
      const totalHours = (Math.round(totalPlaytime / 60)).toLocaleString(); // Add thousands separator
      const recentPlaytime = games?.games?.reduce((total, game) => total + (game.playtime_2weeks || 0), 0) || 0;
      const recentHours = Math.round(recentPlaytime / 60 * 10) / 10;

      // Get currently playing game if any
      const currentGame = profile.gameextrainfo ? ` (${profile.gameextrainfo})` : '';
      const statusText = status === 'Online' ? `${status}${currentGame}` : status;

      // Most played game with formatted hours
      const mostPlayed = games?.games?.reduce((max, game) => 
        (game.playtime_forever > (max?.playtime_forever || 0)) ? game : max, null);
      const mostPlayedHours = mostPlayed ? 
        Math.round(mostPlayed.playtime_forever / 60).toLocaleString() : '0';
      const mostPlayedStr = mostPlayed ? 
        `${mostPlayed.name} (${mostPlayedHours}hrs)` : 
        'None';

      const response = `@${username}, Profile: ${profile.personaname} • ` +
                      `Status: ${statusText} • ` +
                      `Games: ${totalGames.toLocaleString()} • ` +
                      `Total: ${totalHours}hrs • ` +
                      `Recent: ${recentHours}hrs • ` +
                      `Most Played: ${mostPlayedStr} • ` +
                      `Profile: ${profile.profileurl}`;

      const messageLogger = serviceRegistry.getService('messageLogger');
      await messageLogger.logUserMessage(channel, 'BOT', response);
      await say(response);

    } catch (error) {
      logger.error('Error in handleProfileCommand:', error);
      const errorMsg = `@${username}, Failed to fetch profile.`;
      const messageLogger = serviceRegistry.getService('messageLogger');
      await messageLogger.logUserMessage(channel, 'BOT', errorMsg);
      await say(errorMsg);
    }
  }

  async resolveSteamId(query) {
    // If it's already a Steam64 ID
    if (/^\d{17}$/.test(query)) {
        return query;
    }

    // If it's a custom URL
    let vanityUrl = query;
    if (query.includes('steamcommunity.com')) {
        const match = query.match(/steamcommunity\.com\/id\/([^\/]+)/);
        if (match) {
            vanityUrl = match[1];
        }
    }

    try {
        const response = await fetch(
            `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${this.steamApiKey}&vanityurl=${vanityUrl}`
        );
        const data = await response.json();
        
        if (data.response?.success === 1) {
            return data.response.steamid;
        }
    } catch (error) {
        logger.error('Error resolving Steam ID:', error);
        throw new Error('Failed to resolve Steam ID');
    }

    return null;
  }

  getPlayerStatus(profile) {
    const statusMap = {
        0: 'Offline',
        1: 'Online',
        2: 'Busy',
        3: 'Away',
        4: 'Snooze',
        5: 'Looking to Trade',
        6: 'Looking to Play'
    };

    if (profile.gameextrainfo) {
        return `In-Game: ${profile.gameextrainfo}`;
    }

    return statusMap[profile.personastate] || 'Unknown';
  }

  async handleRecentGamesCommand(username, query, say, channel) {
    try {
      const steamId = await this.resolveSteamId(query || username);
      if (!steamId) {
        const noIdMsg = `@${username}, Could not find Steam ID for that user.`;
        const messageLogger = serviceRegistry.getService('messageLogger');
        await messageLogger.logUserMessage(channel, 'BOT', noIdMsg);
        await say(noIdMsg);
        return;
      }

      const apiResponse = await fetch(
        `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${this.steamApiKey}&steamid=${steamId}&count=5`
      );
      const data = await apiResponse.json();

      if (!data.response || !data.response.games || data.response.games.length === 0) {
        const noGamesMsg = `@${username}, No recently played games found for that user.`;
        const messageLogger = serviceRegistry.getService('messageLogger');
        await messageLogger.logUserMessage(channel, 'BOT', noGamesMsg);
        await say(noGamesMsg);
        return;
      }

      const games = data.response.games.map(game => {
        const hours = Math.round(game.playtime_2weeks / 60 * 10) / 10;
        return `${game.name} (${hours}hrs)`;
      });

      const totalHours = Math.round(data.response.games.reduce((total, game) => 
        total + (game.playtime_2weeks / 60), 0) * 10) / 10;

      const recentGamesMsg = `@${username}, Recent games: ${games.join(', ')} • Total past 2 weeks: ${totalHours}hrs`;
      const messageLogger = serviceRegistry.getService('messageLogger');
      await messageLogger.logUserMessage(channel, 'BOT', recentGamesMsg);
      await say(recentGamesMsg);

    } catch (error) {
      logger.error('Error in handleRecentGamesCommand:', error);
      const errorMsg = `@${username}, Failed to fetch recent games.`;
      const messageLogger = serviceRegistry.getService('messageLogger');
      await messageLogger.logUserMessage(channel, 'BOT', errorMsg);
      await say(errorMsg);
    }
  }

  async handleAvatarCommand(username, query, say, channel) {
    try {
      const steamId = await this.resolveSteamId(query || username);
      if (!steamId) {
        const noIdMsg = `@${username}, Could not find Steam ID for that user.`;
        const messageLogger = serviceRegistry.getService('messageLogger');
        await messageLogger.logUserMessage(channel, 'BOT', noIdMsg);
        await say(noIdMsg);
        return;
      }

      const apiResponse = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${this.steamApiKey}&steamids=${steamId}`
      );
      const data = await apiResponse.json();

      if (!data.response?.players?.[0]) {
        const noProfileMsg = `@${username}, Could not find Steam profile for that user.`;
        const messageLogger = serviceRegistry.getService('messageLogger');
        await messageLogger.logUserMessage(channel, 'BOT', noProfileMsg);
        await say(noProfileMsg);
        return;
      }

      const profile = data.response.players[0];
      const avatarMsg = `@${username}, ${profile.personaname}'s avatar: ${profile.avatarfull}`;
      const messageLogger = serviceRegistry.getService('messageLogger');
      await messageLogger.logUserMessage(channel, 'BOT', avatarMsg);
      await say(avatarMsg);

    } catch (error) {
      logger.error('Error in handleAvatarCommand:', error);
      const errorMsg = `@${username}, Failed to fetch avatar.`;
      const messageLogger = serviceRegistry.getService('messageLogger');
      await messageLogger.logUserMessage(channel, 'BOT', errorMsg);
      await say(errorMsg);
    }
  }
}

// Create single instance
const steamHandler = new Spc();

// Single default export
export default {
  name: 'steam',
  aliases: ['spc'], // Add aliases property
  description: 'Steam-related commands',
  async execute({ channel, user, args, say }) {
    try {
      // Initialize if not already done
      if (!steamHandler.initialized) {
        await steamHandler.initialize();
      }

      // No arguments provided
      if (!args.length) {
        const messageLogger = serviceRegistry.getService('messageLogger');
        const helpMsg = `@${user.username}, Usage: #steam [profile|recent|avatar|stats] [steamID/URL/game]`;
        await messageLogger.logUserMessage(channel, 'BOT', helpMsg);
        await say(helpMsg);
        return;
      }

      const subCommand = args[0].toLowerCase();
      const query = args.slice(1).join(' ');

      // Special handling for spc alias
      if (this.name === 'spc') {
        await steamHandler.handleStatsCommand(user.username, args.join(' '), say);
        return;
      }

      switch (subCommand) {
        case 'profile':
          await steamHandler.handleProfileCommand(user.username, query, say, channel);
          break;
        case 'recent':
          await steamHandler.handleRecentGamesCommand(user.username, query, say, channel);
          break;
        case 'avatar':
          await steamHandler.handleAvatarCommand(user.username, query, say, channel);
          break;
        case 'stats':
          await steamHandler.handleStatsCommand(user.username, query, say);
          break;
        default:
          // Try stats command if no subcommand matches
          const messageLogger = serviceRegistry.getService('messageLogger');
          const invalidMsg = `@${user.username}, Invalid subcommand. Available commands: profile, recent, avatar, stats`;
          await messageLogger.logUserMessage(channel, 'BOT', invalidMsg);
          await say(invalidMsg);
      }
    } catch (error) {
      logger.error('Error executing Steam command:', error);
      const messageLogger = serviceRegistry.getService('messageLogger');
      const errorMsg = `@${user.username}, An error occurred while processing your request.`;
      await messageLogger.logUserMessage(channel, 'BOT', errorMsg);
      await say(errorMsg);
    }
  }
};
