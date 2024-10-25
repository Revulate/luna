import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import { config } from '../config.js';
import logger from '../logger.js';
import { setTimeout as setTimeoutPromise } from 'timers/promises';
import jsonStream from 'jsonstream/index.js';
import { pipeline } from 'stream/promises';
import path from 'path';
import * as fuzzball from 'fuzzball';
import { metaphone } from 'metaphone';

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

  async handleSpcCommand({ channel, user, args, say }) {
    const username = user.username || user.name || user['display-name'] || 'Unknown User';
    const userId = user.userId || user.id || 'Unknown ID';
    this.logger.info(`[MESSAGE] Processing #spc command from ${username} (ID: ${userId})`);

    if (!this.steamApiKey) {
      await say(`@${username}, Steam API key is not configured.`);
      return;
    }

    // Check if first argument is 'stats'
    if (args[0]?.toLowerCase() === 'stats') {
      await this.handleStatsCommand(username, args.slice(1).join(' '), say);
      return;
    }

    const { gameID, skipReviews, gameName } = this.parseArguments(args);
    if (gameID === null && gameName === null) {
      await say(`@${username}, please provide a game ID or name.`);
      return;
    }

    let finalGameID = gameID;
    if (!finalGameID && gameName) {
      finalGameID = await this.findGameIdByName(gameName);
      if (!finalGameID) {
        await say(`@${username}, no games found for your query: '${gameName}'.`);
        return;
      }
      this.logger.debug(`Game name provided. Found Game ID: ${finalGameID}`);
    }

    try {
      const playerCount = await this.getCurrentPlayerCount(finalGameID);
      if (!playerCount) {
        await say(
          `@${username}, could not retrieve player count for ${gameName}.`
        );
        return;
      }

      const reviewsString = skipReviews ? "" : await this.getGameReviews(finalGameID);
      const gameDetails = await this.getGameDetails(finalGameID);
      if (!gameDetails) {
        await say(`@${username}, could not retrieve details for game ID ${finalGameID}.`);
        return;
      }

      const steamUrl = `https://store.steampowered.com/app/${finalGameID}`;
      let reply = `${gameDetails.name} (by ${gameDetails.developer}) • Current Players: ${playerCount.toLocaleString()}`;
      if (gameDetails.price && gameDetails.price !== "N/A") {
        reply += ` • ${gameDetails.price}`;
        if (gameDetails.discount) reply += ` (${gameDetails.discount})`;
      }
      if (reviewsString) reply += ` • ${reviewsString}`;
      if (gameDetails.genres) reply += ` • Genres: ${gameDetails.genres}`;
      if (gameDetails.multiplayer) reply += ` • Multiplayer`;
      reply += ` • Steam URL: ${steamUrl}`;

      await say(reply);
    } catch (error) {
      logger.error(`Error in SPC command: ${error}`);
      await say(
        `@${username}, an error occurred while fetching player count.`
      );
    }
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
    const normalizedGameName = this._normalizeGameName(gameName);
    const lowerGameName = normalizedGameName.toLowerCase();
    
    // First check cache
    if (this.gameCache.has(lowerGameName)) {
        return this.gameCache.get(lowerGameName).id;
    }

    try {
        // First try exact matches with common variations
        const variationMatch = this.gamePatterns[lowerGameName];
        if (variationMatch) {
            const searchName = variationMatch;
            // Add variations with and without special characters
            const searchVariations = [
                searchName,
                searchName.replace(/[!?:]/g, ''),
                searchName.replace(/[!?:]/g, ' '),
                `%${searchName}%`,
                `%${searchName.replace(/[!?:]/g, '')}%`,
                `%${searchName.replace(/[!?:]/g, ' ')}%`
            ];
            
            const exactMatches = this.preparedStatements.findGameByName.all(...searchVariations);
            if (exactMatches.length > 0) {
                const match = exactMatches[0];
                this._updateGameCache(lowerGameName, match.ID);
                return match.ID;
            }
        }

        // If no variation match, try with original name
        const searchPatterns = [
            normalizedGameName,
            `%${normalizedGameName}%`,
            normalizedGameName.replace(/\s+/g, '%'),
            `${normalizedGameName}%`,
            `%${normalizedGameName}`,
            `%${normalizedGameName}%`
        ];

        // Add patterns with special characters removed
        const noSpecialChars = normalizedGameName.replace(/[!?:]/g, '');
        searchPatterns.push(
            noSpecialChars,
            `%${noSpecialChars}%`,
            noSpecialChars.replace(/\s+/g, '%')
        );

        // Ensure we have exactly 6 patterns
        while (searchPatterns.length < 6) {
            searchPatterns.push(searchPatterns[0]);
        }
        searchPatterns.length = 6;  // Trim to exactly 6 if we have too many

        const results = this.preparedStatements.findGameByName.all(...searchPatterns);
        let games = [...results];

        // Only try typo patterns if we don't have good matches yet
        if (games.length === 0) {
            const typoPatterns = this._generateTypoPatterns(normalizedGameName);
            for (let i = 0; i < typoPatterns.length; i += 6) {
                const batch = typoPatterns.slice(i, i + 6);
                while (batch.length < 6) {
                    batch.push(batch[0]); // Pad with duplicates to match parameter count
                }
                const typoResults = this.preparedStatements.findGameByName.all(...batch);
                games.push(...typoResults);
            }
        }

        // Remove duplicates and filter out unwanted entries
        games = [...new Map(games.map(game => [game.ID, game])).values()]
            .filter(game => {
                const name = game.Name.toLowerCase();
                return !name.includes('soundtrack') &&
                       !name.includes('artbook') &&
                       !name.includes('dlc pack') &&
                       !name.includes('season pass') &&
                       !name.includes('demo version');
            });

        if (games.length === 0) {
            return null;
        }

        // Enhanced scoring system
        const matches = games.map(game => {
            const gameName = game.Name.toLowerCase();
            
            // Split game name to handle prefixes and suffixes
            const parts = gameName.split(/[:|-]/);
            const mainTitle = parts[parts.length - 1].trim();
            const prefix = parts.length > 1 ? parts[0].trim() : '';

            // Calculate various fuzzy match scores
            const scores = {
                // Exact match with full name
                exactMatch: gameName === lowerGameName ? 100 : 0,
                
                // Exact match with main title
                mainTitleExact: mainTitle === lowerGameName ? 90 : 0,
                
                // Partial ratio for substring matching
                partialRatio: fuzzball.partial_ratio(lowerGameName, mainTitle),
                
                // Token sort ratio for word order independence
                tokenSortRatio: fuzzball.token_sort_ratio(lowerGameName, gameName),
                
                // Token set ratio for handling extra/missing words
                tokenSetRatio: fuzzball.token_set_ratio(lowerGameName, mainTitle),
                
                // Prefix bonus if search term matches game series
                prefixBonus: prefix && (
                    lowerGameName.includes(prefix) || 
                    prefix.includes(lowerGameName)
                ) ? 20 : 0,
                
                // Article-aware matching
                articleMatch: (() => {
                    const searchVariations = this._normalizeWithArticles(lowerGameName);
                    const gameVariations = this._normalizeWithArticles(mainTitle);
                    
                    // Check if any variations match
                    const hasMatch = searchVariations.some(searchVar => 
                        gameVariations.some(gameVar => gameVar === searchVar)
                    );
                    
                    return hasMatch ? 100 : 0;
                })(),
                
                // Main title contains search term (boosted for exact word matches)
                containsBonus: (() => {
                    const searchVariations = this._normalizeWithArticles(lowerGameName);
                    if (searchVariations.some(v => mainTitle === v)) return 30;
                    if (searchVariations.some(v => mainTitle.includes(` ${v} `))) return 25;
                    if (searchVariations.some(v => mainTitle.includes(v))) return 20;
                    return 0;
                })(),
                
                // Acronym matching
                acronymScore: this._calculateAcronymScore(lowerGameName, mainTitle),
                
                // Series matching
                seriesScore: this._calculateSeriesScore(lowerGameName, gameName)
            };

            // Calculate total score
            const totalScore = (
                (scores.exactMatch * 0.25) +
                (scores.mainTitleExact * 0.15) +
                (scores.partialRatio * 0.15) +
                (scores.tokenSortRatio * 0.10) +
                (scores.tokenSetRatio * 0.10) +
                (scores.prefixBonus * 0.05) +
                (scores.containsBonus * 0.05) +
                (scores.acronymScore * 0.025) +
                (scores.seriesScore * 0.025) +
                (scores.articleMatch * 0.15)
            );

            return {
                game,
                scores,
                totalScore
            };
        });

        // Sort by total score
        matches.sort((a, b) => b.totalScore - a.totalScore);

        // Log top matches for debugging
        this.logger.debug(`Top matches for "${normalizedGameName}":`, 
            matches.slice(0, 3).map(m => ({
                name: m.game.Name,
                score: m.totalScore,
                scores: m.scores
            }))
        );

        // Return best match if score is high enough
        if (matches[0].totalScore >= 50 || 
            (matches[0].scores.partialRatio === 100 && 
             matches[0].scores.tokenSetRatio === 100 && 
             matches[0].totalScore >= 35)) {
            const bestMatch = matches[0].game;
            this._updateGameCache(lowerGameName, bestMatch.ID);
            return bestMatch.ID;
        }

        // If no good match, return suggestions
        if (matches.length > 0) {
            const suggestions = matches
                .slice(0, 3)
                .map(m => `${m.game.Name} (${Math.round(m.totalScore)}% match)`)
                .join(', ');
            throw new Error(`No exact match found. Did you mean: ${suggestions}?`);
        }

        return null;
    } catch (error) {
        this.logger.error(`Error during game search: ${error}`);
        throw error;
    }
  }

  // Helper method to convert roman numerals
  romanToArabic(roman) {
    const romanNumerals = {
        'i': 1,
        'iv': 4,
        'v': 5,
        'ix': 9,
        'x': 10,
        'xl': 40,
        'l': 50,
        'xc': 90,
        'c': 100,
        'cd': 400,
        'd': 500,
        'cm': 900,
        'm': 1000
    };

    let result = 0;
    let input = roman.toLowerCase();

    for (let i = 0; i < input.length; i++) {
        const current = romanNumerals[input[i]];
        const next = romanNumerals[input[i + 1]];

        if (next && current < next) {
            result += next - current;
            i++;
        } else {
            result += current;
        }
    }

    return result;
  }

  // Helper method to convert arabic to roman
  arabicToRoman(num) {
    const romanNumerals = [
        ['m', 1000],
        ['cm', 900],
        ['d', 500],
        ['cd', 400],
        ['c', 100],
        ['xc', 90],
        ['l', 50],
        ['xl', 40],
        ['x', 10],
        ['ix', 9],
        ['v', 5],
        ['iv', 4],
        ['i', 1]
    ];

    let result = '';
    for (const [roman, value] of romanNumerals) {
        while (num >= value) {
            result += roman;
            num -= value;
        }
    }
    return result;
  }

  _findBestMatch(gameName, games) {
    return games.reduce((best, game) => {
      const similarity = this.levenshteinDistance(gameName.toLowerCase(), game.Name.toLowerCase());
      return similarity < best.similarity ? { game, similarity } : best;
    }, { game: null, similarity: Infinity }).game;
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

  normalizeGameName(gameName) {
    let normalized = gameName.toLowerCase().trim();
    
    // Handle special game variations first
    const gamePatterns = {
        'gta 5': 'grand theft auto v',
        'gta v': 'grand theft auto v',
        'gta5': 'grand theft auto v',
        'gtav': 'grand theft auto v',
        'gta': 'grand theft auto',
        'd4': 'diablo iv',
        'd 4': 'diablo iv',
        'diablo 4': 'diablo iv',
        'diablo four': 'diablo iv',
        'diablo': 'diablo iv'
    };

    // Check for exact pattern matches
    for (const [pattern, replacement] of Object.entries(gamePatterns)) {
        if (normalized === pattern || normalized.startsWith(pattern + ' ')) {
            normalized = normalized.replace(pattern, replacement);
            break;
        }
    }

    // Handle number and roman numeral variations
    const numberMap = {
        '4': 'iv',
        'four': 'iv',
        'iv': 'iv',
        '5': 'v',
        'five': 'v',
        'v': 'v',
        '6': 'vi',
        'six': 'vi',
        'vi': 'vi'
    };

    // Replace number variations
    for (const [num, replacement] of Object.entries(numberMap)) {
        const regex = new RegExp(`\\b${num}\\b`, 'gi');
        normalized = normalized.replace(regex, replacement);
    }

    // Basic text normalization
    normalized = normalized
        .replace(/[-_:]/g, ' ')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized;
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

  // Add new helper method for number variations
  checkNumberVariations(name1, name2) {
    const numberMap = {
        '4': ['iv', 'four'],
        'iv': ['4', 'four'],
        'four': ['4', 'iv'],
        '5': ['v', 'five'],
        'v': ['5', 'five'],
        'five': ['5', 'v'],
        '6': ['vi', 'six'],
        'vi': ['6', 'six'],
        'six': ['6', 'vi']
    };

    // Check if either string contains a number or roman numeral
    const numbers = Object.keys(numberMap).join('|');
    const regex = new RegExp(`\\b(${numbers})\\b`, 'gi');
    
    const matches1 = name1.match(regex);
    const matches2 = name2.match(regex);
    
    if (!matches1 || !matches2) return false;
    
    // Check if the numbers are equivalent
    for (const num1 of matches1) {
        const variations = numberMap[num1.toLowerCase()] || [];
        for (const num2 of matches2) {
            if (num2.toLowerCase() === num1.toLowerCase() || 
                variations.includes(num2.toLowerCase())) {
                return true;
            }
        }
    }
    
    return false;
  }

  // Add new method for handling stats
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
        this.logger.error(`Steam Charts fetch failed: ${chartsError}`);
        await say(
          `@${username}, ${gameDetails.name} Stats • Current Players: ${playerCount.toLocaleString()}`
        );
      }
    } catch (error) {
      this.logger.error(`Error in SPC stats command: ${error}`);
      await say(
        `@${username}, an error occurred while fetching player statistics.`
      );
    }
  }

  // Add new helper methods
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

  // Add this method to the class
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

  // Then modify the _fuzzySearch method to use the simple phonetic algorithm
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

  // Add new helper method for series matching
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

  // Add this method to handle articles
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

  // Add a method to handle special characters in game names
  _normalizeGameName(name) {
    return name.toLowerCase()
        .replace(/[!?:]/g, '') // Remove special characters
        .replace(/\s+/g, ' ')  // Normalize spaces
        .trim();
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
