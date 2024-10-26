import Database from 'better-sqlite3';
import { google } from 'googleapis';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import * as fuzzball from 'fuzzball';
import logger from '../logger.js';
import { ApiClient } from '@twurple/api';
import { AppTokenAuthProvider } from '@twurple/auth'; // Use AppTokenAuthProvider
import { JWT } from 'google-auth-library';
import validators from 'validator';
import { parse, format } from 'date-fns';
import NodeCache from 'node-cache';
import JSONStream from 'jsonstream/index.js';
import { pipeline } from 'stream/promises';
import { config } from '../config.js';
import path from 'path';
import TwitchEventManager from '../TwitchEventManager.js'; // Import TwitchEventManager
import { authenticate } from '@google-cloud/local-auth';
import fs from 'fs';
import MessageLogger from '../MessageLogger.js';

dotenv.config();

// Move the class closing brace up before the export
class DVP {
  constructor(bot) {
    this.bot = bot;
    this.dbPath = path.join(process.cwd(), 'databases', 'vulpes_games.db');
    this.channelName = 'vulpeshd';
    this.sheetId = process.env.GOOGLE_SHEET_ID;
    this.credsFile = process.env.GOOGLE_CREDENTIALS_FILE;
    this.imageUrlCache = new Map();
    this.lastScrapeTime = null;
    this.db = null;
    this.cache = new NodeCache({ stdTTL: 600 }); // 10 minutes TTL
    this.youtubeAccessToken = process.env.YOUTUBE_ACCESS_TOKEN;

    this.abbreviationMapping = {
      'ff7': 'FINAL FANTASY VII REMAKE',
      'ff16': 'FINAL FANTASY XVI',
      'ffxvi': 'FINAL FANTASY XVI',
      'ff14': 'FINAL FANTASY XIV',
      'rebirth': 'FINAL FANTASY VII REBIRTH',
      'rdr2': 'Red Dead Redemption 2',
      'er': 'ELDEN RING',
      'ds3': 'DARK SOULS III',
      'gow': 'God of War',
      'gta': 'Grand Theft Auto V',
      'gta5': 'Grand Theft Auto V',
      'botw': 'The Legend of Zelda: Breath of the Wild',
      'totk': 'The Legend of Zelda: Tears of the Kingdom',
      'ac': 'Assassin\'s Creed',
      'ac origins': 'Assassin\'s Creed Origins',
      'ac odyssey': 'Assassin\'s Creed Odyssey',
      'ffx': 'FINAL FANTASY X',
      'bb': 'Bloodborne',
      'tw3': 'The Witcher 3: Wild Hunt',
      'witcher 3': 'The Witcher 3: Wild Hunt',
      'boneworks': 'BONEWORKS',
    };

    this.sheetUrl = process.env.GOOGLE_SHEET_URL || `https://docs.google.com/spreadsheets/d/${this.sheetId}/edit?usp=sharing`;

    // Initialize Twurple ApiClient with AppTokenAuthProvider
    const authProvider = new AppTokenAuthProvider(config.twitch.clientId, config.twitch.clientSecret);
    this.apiClient = new ApiClient({ authProvider });

    // Initialize TwitchEventManager
    this.twitchEventManager = new TwitchEventManager(this.apiClient, bot.chatClient, config.twitch.channels);

    // Update scopes to include both read and write permissions
    this.SCOPES = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/script.projects'
    ];
    
    // Update paths for token storage
    this.TOKEN_PATH = path.join(process.cwd(), 'token.json');
    this.CREDENTIALS_PATH = this.credsFile; // using existing credentials path

    // Move database and auth initialization to async init
    this.db = null;
    this.auth = null;
    this.sheets = null;

    // Remove immediate initialization calls
    // this.verifyGoogleCredentials();
    // this.initializeCog();
    // this._prepareStatements();

    // Initialize async
    this.init(bot).catch(err => {
      logger.error(`Failed to initialize DVP: ${err}`);
    });

    // Add new cache properties
    this.GAME_IMAGE_REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days
    this.lastGameImageUpdate = null;
    this.mostRecentGame = null;
  }

  async init(bot) {
    try {
      // Setup database first
      await this.setupDatabase();
      
      // Initialize Google Sheets auth
      await this.initializeGoogleSheets();
      
      // Load caches and data
      await this.loadLastImageUpdate();
      await this.loadImageUrlCache();
      await this.initializeData();
      
      // Start periodic updates
      this.startPeriodicScrapeUpdate();
      
      // Set initialized flag after everything is ready
      this.initialized = true;
      
      logger.info('DVP module initialized successfully');
    } catch (error) {
      logger.error(`Error in DVP init: ${error}`);
      throw error;
    }
  }

  async initializeGoogleSheets() {
    try {
      this.sheets = google.sheets({ version: 'v4' });
      
      // Use service account authentication
      this.auth = new JWT({
        keyFile: this.credsFile,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/script.projects',
          'https://www.googleapis.com/auth/script.external_request'
        ]
      });

      // Verify credentials with minimal request
      await this.sheets.spreadsheets.get({
        auth: this.auth,
        spreadsheetId: this.sheetId,
        fields: 'properties.title'
      });

      logger.info('Google Sheets authentication successful');
    } catch (error) {
      logger.error(`Google Sheets authentication failed: ${error}`);
      throw error;
    }
  }

  async setupDatabase() {
    logger.info(`Setting up database at ${this.dbPath}`);
    try {
      // Ensure database directory exists
      const dbDir = path.dirname(this.dbPath);
      await fs.promises.mkdir(dbDir, { recursive: true });

      // Initialize database
      this.db = new Database(this.dbPath, { 
        verbose: process.env.LOG_LEVEL === 'debug' ? logger.debug : undefined 
      });

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS games (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          time_played INTEGER NOT NULL,
          last_played TEXT NOT NULL,
          image_url TEXT
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Prepare statements only after database is initialized
      this._prepareStatements();

      logger.info('Database setup complete');
    } catch (error) {
      logger.error(`Error setting up database: ${error}`);
      throw error;
    }
  }

  async _prepareStatements() {
    this.preparedStatements = {
      insertGame: this.db.prepare(`
        INSERT OR REPLACE INTO games (name, time_played, last_played, image_url)
        VALUES (?, ?, ?, ?)
      `),
      selectGame: this.db.prepare('SELECT * FROM games WHERE name = ?'),
      updateGameImageUrl: this.db.prepare('UPDATE games SET image_url = ? WHERE name = ?'),
      selectAllGames: this.db.prepare(`
        SELECT * FROM games 
        ORDER BY date(last_played) DESC, time_played DESC
      `),
      getMetadata: this.db.prepare('SELECT value FROM metadata WHERE key = ?'),
      setMetadata: this.db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)'),
      selectActiveGames: this.db.prepare('SELECT * FROM games ORDER BY last_played DESC'),
      updateLastPlayed: this.db.prepare('UPDATE games SET last_played = ? WHERE name = ?'),
    };
  }

  async loadLastScrapeTime() {
    const result = this.preparedStatements.getMetadata.get('last_scrape_time');
    if (result) {
      try {
        this.lastScrapeTime = new Date(result.value);
        logger.info(`Last scrape time loaded: ${this.lastScrapeTime}`);
      } catch (error) {
        logger.error(`Invalid datetime format in metadata: ${result.value}. Error: ${error}`);
        this.lastScrapeTime = null;
      }
    }
  }

  async saveLastScrapeTime() {
    const currentTime = new Date().toISOString();
    this.preparedStatements.setMetadata.run('last_scrape_time', currentTime);
    this.lastScrapeTime = new Date(currentTime);
    logger.info(`Last scrape time saved: ${this.lastScrapeTime}`);
  }

  async initializeData() {
    logger.info('initializeData method called');
    try {
      logger.info('Initializing data');
      // Always perform web scraping
      logger.info('Performing web scraping to update data');
      await this.scrapeInitialData();
      await this.saveLastScrapeTime();

      await this.updateInitialsMapping();
      const imagesFetched = await this.fetchMissingImages();
      if (imagesFetched) {
        await this.updateGoogleSheet();
      }
      logger.info('Data initialization completed successfully.');
    } catch (error) {
      logger.error(`Error initializing data: ${error}`);
    }
  }

  async scrapeInitialData() {
    logger.info('Starting optimized data scraping...');
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto(`https://twitchtracker.com/${this.channelName}/games`);
        await page.waitForSelector('#games');

        // Check if Last Seen is already in descending order
        const lastSeenHeader = await page.$('th[aria-label*="Last Seen"]');
        const isDescending = await lastSeenHeader.evaluate(el => 
            el.classList.contains('sorting_desc') || 
            el.getAttribute('aria-sort') === 'descending'
        );

        // Only click if not already in descending order
        if (!isDescending) {
            await lastSeenHeader.click();
            await page.waitForTimeout(1000);
            
            // Click again if needed to get to descending order
            const isNowDescending = await lastSeenHeader.evaluate(el => 
                el.classList.contains('sorting_desc') || 
                el.getAttribute('aria-sort') === 'descending'
            );
            if (!isNowDescending) {
                await lastSeenHeader.click();
                await page.waitForTimeout(1000);
            }
        }

        // Get initial batch of rows (first page only)
        const initialRows = await page.$$('#games tbody tr');
        if (!initialRows.length) {
            logger.info('No game rows found');
            return;
        }

        // Process rows and handle dates properly
        for (const row of initialRows) {
            const gameData = await this.extractGameData(row);
            
            // Keep existing image URL when updating
            const existingGame = this.preparedStatements.selectGame.get(gameData.name);
            const imageUrl = existingGame?.image_url || null;
            
            // Update database with correct date and preserve image URL
            this.preparedStatements.insertGame.run(
                gameData.name,
                gameData.timePlayed,
                gameData.lastPlayed,
                imageUrl
            );

            logger.debug(`Updated game: ${gameData.name}, Last played: ${gameData.lastPlayed}`);
        }

        logger.info('Data scraping completed successfully');
    } catch (error) {
        logger.error(`Error during data scraping: ${error}`);
    } finally {
        await browser.close();
    }
  }

  // Update the parseDate method to handle timezone correctly
  parseDate(dateStr) {
    try {
        // Parse the date string assuming it's in the format 'DD/MMM/YYYY'
        const parsedDate = parse(dateStr, 'dd/MMM/yyyy', new Date());
        
        // Create UTC date to avoid timezone offsets
        const utcDate = new Date(
            parsedDate.getUTCFullYear(),
            parsedDate.getUTCMonth(),
            parsedDate.getUTCDate()
        );
        
        // Format the date as 'YYYY-MM-DD'
        return format(utcDate, 'yyyy-MM-dd');
    } catch (error) {
        logger.error(`Error parsing date '${dateStr}': ${error}`);
        // Return current date in UTC as fallback
        const now = new Date();
        const utcNow = new Date(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
        );
        return format(utcNow, 'yyyy-MM-dd');
    }
  }

  // Update extractGameData method to handle dates properly
  async extractGameData(row) {
    const name = await row.$eval('td:nth-child(2)', el => el.textContent.trim());
    const timePlayedStr = await row.$eval('td:nth-child(3) > span', el => el.textContent.trim());
    const lastSeenStr = await row.$eval('td:nth-child(7)', el => el.textContent.trim());

    // Log the raw date string for debugging
    logger.debug(`Raw last seen date for ${name}: ${lastSeenStr}`);

    return {
        name,
        timePlayed: this.parseTime(timePlayedStr),
        lastPlayed: this.parseDate(lastSeenStr)
    };
  }

  async loadImageUrlCache() {
    logger.info('Loading image URL cache from database');
    try {
      const rows = this.preparedStatements.selectActiveGames.all();
      for (const { name, image_url } of rows) {
        if (image_url) {  // Only cache valid URLs
          this.imageUrlCache.set(name, image_url);
        }
      }
      logger.info(`Loaded ${this.imageUrlCache.size} valid image URLs into cache`);
    } catch (error) {
      logger.error(`Error loading image URL cache: ${error}`);
    }
  }

  parseTime(timeStr) {
    const hours = parseFloat(timeStr);
    const totalMinutes = Math.round(hours * 60);
    return totalMinutes;
  }

  formatPlaytime(minutes) {
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const remainingMinutes = minutes % 60;

    let result = [];
    if (days > 0) result.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) result.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (remainingMinutes > 0) result.push(`${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`);

    return result.join(', ');
  }

  // Update the getGameImageUrl method
  async getGameImageUrl(gameName) {
    try {
        // First check cache
        if (this.imageUrlCache.has(gameName)) {
            const cachedUrl = this.imageUrlCache.get(gameName);
            if (cachedUrl) {  // Only use cache if URL exists
                logger.info(`Using cached image URL for '${gameName}': ${cachedUrl}`);
                return cachedUrl;
            }
        }

        logger.info(`Fetching image URL for game: ${gameName}`);
        try {
            const url = await this.twitchEventManager.getGameImageUrl(gameName);
            if (url && validators.isURL(url)) {
                this.imageUrlCache.set(gameName, url);
                await this.saveGameImageUrl(gameName, url);
                logger.info(`Generated and cached new image URL for '${gameName}': ${url}`);
                return url;
            } else {
                logger.warn(`Invalid image URL generated for '${gameName}': ${url}`);
            }
        } catch (error) {
            logger.error(`Error fetching image URL for '${gameName}': ${error}`);
        }

        // If we get here, try to fetch from Twitch again
        try {
            const gameInfo = await this.apiClient.games.getGameByName(gameName);
            if (gameInfo && gameInfo.boxArtUrl) {
                const url = gameInfo.boxArtUrl.replace('{width}', '285').replace('{height}', '380');
                this.imageUrlCache.set(gameName, url);
                await this.saveGameImageUrl(gameName, url);
                logger.info(`Fetched new image URL for '${gameName}': ${url}`);
                return url;
            }
        } catch (error) {
            logger.error(`Error in fallback image fetch for '${gameName}': ${error}`);
        }

        return null;
    } catch (error) {
        logger.error(`Error in getGameImageUrl for '${gameName}': ${error}`);
        return null;
    }
  }

  async saveGameImageUrl(gameName, url) {
    try {
      this.preparedStatements.updateGameImageUrl.run(url, gameName);
      logger.info(`Saved image URL for '${gameName}' to database.`);
    } catch (error) {
      logger.error(`Error saving image URL to database for '${gameName}': ${error}`);
    }
  }

  async updateGoogleSheet() {
    logger.info('Starting Google Sheet update...');
    try {
      const games = this.preparedStatements.selectAllGames.all();
      const profilePictureUrl = await this.twitchEventManager.getUserProfilePicture('vulpeshd');
      
      logger.info(`Retrieved ${games.length} games from the database`);

      // Prepare batch requests for values
      const batchRequests = {
        spreadsheetId: this.sheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            // Update header with profile picture and stream status
            {
              range: 'VulpesHD Games!A1',
              values: [[`=IMAGE("${profilePictureUrl}", 1)`]]
            },
            {
              range: 'VulpesHD Games!B1',
              values: [[await this.formatStreamStatus()]]
            },
            // Update timestamp
            {
              range: 'VulpesHD Games!A2:D2',
              values: [[
                `Last Updated: ${format(new Date(), 'MMMM d, yyyy')} at ${format(new Date(), 'h:mm:ss a')} MST (GMT-7)`,
                '', '', ''
              ]]
            },
            // Update column headers
            {
              range: 'VulpesHD Games!A3:D3',
              values: [['Artwork', 'Game', 'Time Played', 'Last Played']]
            },
            // Update game data with corrected date handling
            {
              range: `VulpesHD Games!A4:D${games.length + 3}`,
              values: await Promise.all(games.map(async game => {
                // Parse the date string and format it correctly
                const lastPlayedDate = parse(game.last_played, 'yyyy-MM-dd', new Date());
                const formattedDate = format(lastPlayedDate, 'MMMM do, yyyy');
                
                return [
                  game.image_url ? `=IMAGE("${game.image_url}", 4, 190, 142)` : '',
                  game.name,
                  this.formatPlaytime(game.time_played),
                  formattedDate
                ];
              }))
            }
          ]
        }
      };

      // Execute batch update for values
      await this.sheets.spreadsheets.values.batchUpdate({
        auth: this.auth,
        spreadsheetId: this.sheetId,
        requestBody: batchRequests.resource
      });

      // Get and apply the formatting
      const formatRequests = await this.getFormatRequests();
      await this.sheets.spreadsheets.batchUpdate({
        auth: this.auth,
        spreadsheetId: this.sheetId,
        requestBody: formatRequests
      });

      logger.info('Google Sheet updated successfully');
    } catch (error) {
      logger.error(`Error updating Google Sheet: ${error}`);
      throw error;
    }
  }

  async getSheetId() {
    try {
      const response = await this.sheets.spreadsheets.get({
        auth: this.auth,
        spreadsheetId: this.sheetId,
        fields: 'sheets.properties(sheetId,title)' // Request only needed fields
      });

      const sheet = response.data.sheets.find(s => s.properties.title === 'VulpesHD Games');
      if (!sheet) {
        throw new Error('Sheet "VulpesHD Games" not found');
      }
      return sheet.properties.sheetId;
    } catch (error) {
      logger.error(`Error retrieving sheet ID: ${error}`);
      throw error;
    }
  }

  startPeriodicScrapeUpdate() {
    setInterval(() => this.periodicScrapeUpdate(), 24 * 60 * 60 * 1000); // 24 hours
    setInterval(() => this.updateGoogleSheet(), 6 * 60 * 60 * 1000); // 6 hours
  }

  async periodicScrapeUpdate() {
    logger.info('Starting periodic scrape update');
    await this.scrapeInitialData();
    await this.fetchMissingImages();
    await this.updateGoogleSheet();
    await this.saveLastScrapeTime();
    logger.info('Periodic scrape update completed');
  }

  async updateInitialsMapping() {
    this.initialsMapping = Object.fromEntries(
      Object.entries(this.abbreviationMapping).map(([abbrev, gameName]) => [abbrev.toLowerCase(), gameName])
    );
    logger.info('Updated initials mapping');
  }

  // Update fetchMissingImages method
  async fetchMissingImages() {
    const now = Date.now();
    
    // Check if we need to update images based on interval
    if (this.lastGameImageUpdate && 
        (now - this.lastGameImageUpdate) < this.GAME_IMAGE_REFRESH_INTERVAL) {
        logger.info('Skipping image update, not yet time');
        return false;
    }

    logger.info('Checking for missing or outdated game images');
    const games = this.preparedStatements.selectActiveGames.all();
    let imagesFetched = false;

    for (const game of games) {
        // Check if game needs image update
        if (!game.image_url || !this.imageUrlCache.has(game.name)) {
            try {
                const imageUrl = await this.getGameImageUrl(game.name);
                if (imageUrl) {
                    this.preparedStatements.updateGameImageUrl.run(imageUrl, game.name);
                    this.imageUrlCache.set(game.name, imageUrl);
                    imagesFetched = true;
                    logger.info(`Updated image URL for ${game.name}: ${imageUrl}`);
                }
            } catch (error) {
                logger.error(`Error fetching image URL for ${game.name}: ${error}`);
            }
            // Add small delay between requests to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    if (imagesFetched) {
        this.lastGameImageUpdate = now;
        this.preparedStatements.setMetadata.run('last_image_update', now.toString());
        logger.info('Image URLs updated successfully');
    }

    logger.info(`Image update completed, ${imagesFetched ? 'changes made' : 'no changes needed'}`);
    return imagesFetched;
  }

  async handleDvpCommand(context) {
    const { channel, user, args, command = 'afk' } = context;
    if (!this.initialized) {
      const errorResponse = `@${user.username}, DVP module not initialized`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
      return;
    }

    const userId = user.id || user.userId || context.rawMessage?.userInfo?.userId;
    const username = user.username || user.name || user.displayName;

    if (!userId) {
      logger.error('No user ID found in context:', { user, rawMessage: context.rawMessage });
      const errorResponse = `@${username}, an error occurred: User ID is missing.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
      return;
    }

    let gameName = args.join(' ').trim();
    if (!gameName) {
      const usageResponse = `@${username}, please provide a game name.`;
      await MessageLogger.logBotMessage(channel, usageResponse);
      await context.say(usageResponse);
      return;
    }

    try {
      // First check abbreviations
      let gameNameToSearch = this.abbreviationMapping[gameName.toLowerCase()] || gameName;

      // Get all games from database for fuzzy matching
      const allGames = this.preparedStatements.selectAllGames.all();
      
      // Try exact match first
      let result = this.preparedStatements.selectGame.get(gameNameToSearch);

      // If no exact match found, try fuzzy matching
      if (!result) {
        const matches = fuzzball.extract(gameNameToSearch, allGames.map(g => g.name), {
          scorer: fuzzball.partial_ratio,
          limit: 3,
          cutoff: 65
        });

        if (matches.length > 0) {
          const [bestMatchName, score] = matches[0];
          
          if (score >= 65) {
            result = allGames.find(g => g.name === bestMatchName);
            gameNameToSearch = bestMatchName;
          } else if (matches.length > 1) {
            const suggestions = matches
              .map(([name, score]) => name)
              .join(', ');
            const suggestionResponse = `@${username}, couldn't find an exact match. Did you mean one of these: ${suggestions}?`;
            await MessageLogger.logBotMessage(channel, suggestionResponse);
            await context.say(suggestionResponse);
            return;
          }
        }
      }

      if (result) {
        const { time_played, last_played } = result;
        const formattedTime = this.formatPlaytime(time_played);
        const lastPlayedDate = parse(last_played, 'yyyy-MM-dd', new Date());
        const lastPlayedFormatted = format(lastPlayedDate, 'MMMM do, yyyy');

        const response = `@${username}, Vulpes last played ${gameNameToSearch} on ${lastPlayedFormatted} • Total playtime: ${formattedTime}.`;
        await MessageLogger.logBotMessage(channel, response);
        await context.say(response);
      } else {
        const notFoundResponse = `@${username}, couldn't find any games matching "${gameName}".`;
        await MessageLogger.logBotMessage(channel, notFoundResponse);
        await context.say(notFoundResponse);
      }
    } catch (error) {
      logger.error(`Error executing dvp command: ${error}`);
      const errorResponse = `@${username}, an error occurred while processing your request. Please try again later.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async handleDvpUpdateCommand(context) {
    const { channel, user } = context;
    
    if (user.username.toLowerCase() !== 'revulate') {
      const unauthorizedResponse = `@${user.username}, sorry, only Revulate can use this command.`;
      await MessageLogger.logBotMessage(channel, unauthorizedResponse);
      await context.say(unauthorizedResponse);
      return;
    }

    logger.info(`Force update initiated by ${user.username}`);
    const initResponse = `@${user.username}, initiating force update. This may take a moment...`;
    await MessageLogger.logBotMessage(channel, initResponse);
    await context.say(initResponse);

    try {
      logger.info('Starting web scraping update');
      await this.scrapeInitialData();
      
      logger.info('Fetching missing game images');
      await this.fetchMissingImages();
      
      logger.info('Updating Google Sheet');
      await this.updateGoogleSheet();
      
      logger.info('Saving last scrape time');
      await this.saveLastScrapeTime();

      const successResponse = `@${user.username}, force update completed successfully!`;
      await MessageLogger.logBotMessage(channel, successResponse);
      await context.say(successResponse);
      logger.info('Force update completed successfully');
    } catch (error) {
      logger.error(`Error during force update: ${error}`);
      const errorResponse = `@${user.username}, an error occurred during the force update. Please check the logs.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async handleSheetCommand(context) {
    try {
      const { user, channel } = context;
      if (!this.sheetUrl) {
        const errorResponse = `@${user.username}, Sorry, the sheet URL is not configured.`;
        await MessageLogger.logBotMessage(channel, errorResponse);
        await context.say(errorResponse);
        return;
      }
      const response = `@${user.username}, you can view Vulpes's game stats here: ${this.sheetUrl}`;
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
      logger.info(`Sheet command executed by ${user.username}`);
    } catch (error) {
      logger.error(`Error in sheet command: ${error}`);
      const errorResponse = `@${user.username}, Sorry, an error occurred while retrieving the sheet URL.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async updateLastPlayedDate(gameName, lastPlayed) {
    try {
      this.preparedStatements.updateLastPlayed.run(lastPlayed, gameName);
      logger.info(`Updated last played date for ${gameName} to ${lastPlayed}`);
    } catch (error) {
      logger.error(`Error updating last played date for ${gameName}: ${error}`);
    }
  }

  async updateLastPlayedDates() {
    logger.info('Updating last played dates');
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    const context = await this.browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`https://twitchtracker.com/${this.channelName}/games`);
      await page.waitForSelector('#games');

      const rows = await page.$$('#games tbody tr');
      logger.info(`Processing ${rows.length} rows for updates`); // Process all rows

      for (const row of rows) {
        const name = await row.$eval('td:nth-child(2)', el => el.textContent.trim());
        const timePlayedStr = await row.$eval('td:nth-child(3) > span', el => el.textContent.trim());
        const lastSeenStr = await row.$eval('td:nth-child(7)', el => el.textContent.trim());

        logger.info(`Raw data - Name: ${name}, Time played: ${timePlayedStr}, Last seen: ${lastSeenStr}`);

        const lastPlayed = this.parseDate(lastSeenStr);
        const timePlayed = this.parseTime(timePlayedStr);

        logger.info(`Processed data - Name: ${name}, Time played: ${this.formatPlaytime(timePlayed)}, Last played: ${lastPlayed}`);
        await this.updateGameInfo(name, timePlayed, lastPlayed);
      }

      logger.info('Last played dates and times updated successfully');
    } catch (error) {
      logger.error(`Error updating last played dates: ${error}`);
    } finally {
      await context.close();
    }
  }

  async updateGameInfo(gameName, timePlayed, lastPlayed) {
    try {
      const existingGame = this.preparedStatements.selectGame.get(gameName);
      if (existingGame) {
        // Update existing game entry
        this.preparedStatements.insertGame.run(gameName, timePlayed, lastPlayed, existingGame.image_url);
      } else {
        // Insert new game entry
        this.preparedStatements.insertGame.run(gameName, timePlayed, lastPlayed, null);
      }
      logger.info(`Updated info for ${gameName}: Time played: ${this.formatPlaytime(timePlayed)}, Last played: ${lastPlayed}`);
    } catch (error) {
      logger.error(`Error updating info for ${gameName}: ${error}`);
    }
  }

  startPeriodicUpdates() {
    const now = new Date();
    const msUntilNextUpdate = this.getMillisecondsUntilNextUpdate(now);
    
    setTimeout(() => {
      this.runPeriodicUpdate();
      setInterval(() => this.runPeriodicUpdate(), 6 * 60 * 60 * 1000); // Run every 6 hours after the first update
    }, msUntilNextUpdate);

    logger.info(`Next periodic update scheduled in ${msUntilNextUpdate / 1000 / 60} minutes`);
  }

  getMillisecondsUntilNextUpdate(now) {
    const targetHours = [0, 6, 12, 18];
    const currentHour = now.getUTCHours();
    const currentMinutes = now.getUTCMinutes();
    const currentSeconds = now.getUTCSeconds();
    const currentMilliseconds = now.getUTCMilliseconds();

    let nextUpdateHour = targetHours.find(hour => hour > currentHour);
    if (!nextUpdateHour) nextUpdateHour = targetHours[0]; // If it's past 18:00, the next update is at 00:00

    let milliseconds = (nextUpdateHour - currentHour) * 60 * 60 * 1000;
    milliseconds -= currentMinutes * 60 * 1000;
    milliseconds -= currentSeconds * 1000;
    milliseconds -= currentMilliseconds;

    if (milliseconds < 0) milliseconds += 24 * 60 * 60 * 1000; // If negative, add 24 hours

    return milliseconds;
  }

  async runPeriodicUpdate() {
    const now = new Date();
    logger.info(`Running periodic update at ${now.toUTCString()}`);
    
    try {
      await this.updateLastPlayedDates();
      await this.updateGoogleSheet();  // This will now update the timestamp as well
      logger.info('Periodic update completed successfully');
    } catch (error) {
      logger.error(`Error during periodic update: ${error}`);
    }

    // Schedule the next update
    const msUntilNextUpdate = this.getMillisecondsUntilNextUpdate(new Date());
    setTimeout(() => this.runPeriodicUpdate(), msUntilNextUpdate);
    logger.info(`Next periodic update scheduled in ${msUntilNextUpdate / 1000 / 60} minutes`);
  }

  // Add helper method for sheet formatting
  async applySheetFormatting() {
    try {
      const sheetId = await this.getSheetId();
      
      // Get the current row count
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.sheetId,
        ranges: ['VulpesHD Games!A:D'],
        fields: 'sheets.data.rowData',
        auth: this.auth
      });

      const rowCount = response.data.sheets[0].data[0].rowData.length;

      // Apply formatting
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        resource: {
          requests: [
            // Format header row
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 4
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.1, green: 0.11, blue: 0.14, alpha: 0.6 },
                    textFormat: {
                      foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                      fontSize: 16,
                      bold: true
                    },
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE'
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
              }
            },
            // Format timestamp row
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 1,
                  endRowIndex: 2,
                  startColumnIndex: 0,
                  endColumnIndex: 4
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.09, green: 0.1, blue: 0.13, alpha: 0.75 },
                    textFormat: {
                      foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                      fontSize: 14,
                      italic: true
                    },
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE'
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
              }
            },
            // Format data rows
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 2,
                  endRowIndex: rowCount,
                  startColumnIndex: 0,
                  endColumnIndex: 4
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.15, green: 0.1, blue: 0.2, alpha: 0.85 },
                    textFormat: {
                      foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                      fontSize: 14
                    },
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE'
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
              }
            }
          ]
        },
        auth: this.auth
      });

      logger.info('Sheet formatting applied successfully');
    } catch (error) {
      logger.error(`Error applying sheet formatting: ${error}`);
      throw error;
    }
  }

  async getGameInfo(gameName) {
    // Check if the gameName is an abbreviation and map it to the full name
    const fullGameName = this.abbreviationMapping[gameName.toLowerCase()] || gameName;
    const cacheKey = `game:${fullGameName}`;
    let gameInfo = this.cache.get(cacheKey);
    if (gameInfo) {
        return gameInfo;
    }

    // Use fuzzy searching to find the closest match in the database
    const allGames = this.preparedStatements.selectAllGames.all();
    const matches = fuzzball.extract(fullGameName, allGames.map(game => game.name), { scorer: fuzzball.partial_ratio });

    if (matches.length > 0 && matches[0][1] > 50) { // Adjust the threshold as needed
        const bestMatch = matches[0][0];
        gameInfo = this.fetchGameInfoFromDatabase(bestMatch);
        this.cache.set(cacheKey, gameInfo);
        return gameInfo;
    }

    return null;
  }

  async fetchGameInfoFromDatabase(gameName) {
    return this.preparedStatements.selectGame.get(gameName);
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
    // Close database connection and perform other cleanup
  }

  async updateRange(range = 'B1:D1') {
    try {
      logger.info('Starting range update with Apps Script');
      
      const script = google.script({ version: 'v1', auth: this.auth });
      
      // Use config instead of process.env
      const response = await script.scripts.run({
        scriptId: config.google.scriptId,
        resource: {
          function: 'insertMixedFormatContent',
          devMode: true
        }
      });

      // Check for execution errors
      if (response.data.error) {
        throw new Error(`Script execution error: ${JSON.stringify(response.data.error)}`);
      }

      logger.info(`Successfully updated range ${range} with formatted content`);
    } catch (error) {
      if (error.code === 404) {
        logger.error('Apps Script not found. Please verify the Script ID and deployment');
      } else {
        logger.error(`Error updating range ${range}: ${error.message}`);
      }
      if (error.response) {
        logger.error(`Response error details: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async updateRangeWithFormatting(range = 'A1:D1') {
    try {
      const sheetId = await this.getSheetId();
      
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        auth: this.auth,
        resource: {
          requests: [
            // Merge A1:D1 cells
            {
              mergeCells: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 4
                },
                mergeType: 'MERGE_ALL'
              }
            },
            // Apply formatting to merged range
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 4
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.1, green: 0.1, blue: 0.1 },
                    textFormat: {
                      foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                      fontSize: 14,
                      bold: true
                    },
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE',
                    padding: {
                      top: 8,
                      bottom: 8
                    }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)'
              }
            }
          ]
        }
      });

      logger.info(`Successfully updated range ${range} formatting`);
    } catch (error) {
      logger.error(`Error updating range ${range} formatting: ${error}`);
      throw error;
    }
  }

  async loadSavedCredentialsIfExist() {
    try {
      const content = await fs.readFile(this.TOKEN_PATH);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

  async saveCredentials(client) {
    try {
      const content = await fs.readFile(this.CREDENTIALS_PATH);
      const keys = JSON.parse(content);
      const key = keys.installed || keys.web;
      const payload = {
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
      };
      await fs.writeFile(this.TOKEN_PATH, JSON.stringify(payload));
    } catch (error) {
      logger.error(`Error saving credentials: ${error}`);
    }
  }

  async authorize() {
    try {
      let client = await this.loadSavedCredentialsIfExist();
      if (client) {
        this.auth = client;
        return client;
      }
      
      client = await authenticate({
        scopes: this.SCOPES,
        keyfilePath: this.CREDENTIALS_PATH,
      });

      if (client.credentials) {
        await this.saveCredentials(client);
      }
      
      this.auth = client;
      return client;
    } catch (error) {
      logger.error(`Error during authorization: ${error}`);
      throw error;
    }
  }

  // Update the formatStreamStatus method
  async formatStreamStatus() {
    try {
      const status = await this.twitchEventManager.getUserStreamStatus('vulpeshd');
      let statusText = '';

      if (status?.isLive) {
        // Get channel info for current game
        const user = await this.apiClient.users.getUserByName('vulpeshd');
        const channelInfo = await this.apiClient.channels.getChannelInfoById(user.id);
        
        statusText = `🟢 LIVE${channelInfo?.gameName ? ` • Playing ${channelInfo.gameName}` : ''}`;
      } else {
        statusText = `🔴 Offline (Last live: ${status?.lastLive ? format(new Date(status.lastLive), 'MMMM d, yyyy') : 'Unknown'})`;
      }

      // Return the formula string
      return `=HYPERLINK("https://twitch.tv/vulpeshd", "VulpesHD's Game Stats")&CHAR(10)&"${statusText}"`;
    } catch (error) {
      logger.error(`Error formatting stream status: ${error}`);
      return '=HYPERLINK("https://twitch.tv/vulpeshd", "VulpesHD\'s Game Stats")';
    }
  }

  // Comment out the executeAppsScript method for now
  // async executeAppsScript() {
  //   try {
  //     const script = google.script('v1');
  //     
  //     // Execute the script
  //     const response = await script.scripts.run({
  //       auth: this.auth,
  //       scriptId: '1iIGNSXmES_E2MNJeAM2RQpT8h5AKDthGCGPg07RojU_794b1ubnRVlcz',
  //       resource: {
  //         function: 'insertMixedFormatContent',
  //         parameters: []
  //       }
  //     });

  //     if (response.data.error) {
  //       throw new Error(`Script execution error: ${response.data.error.message}`);
  //     }

  //     logger.info('Apps Script executed successfully');
  //     return response.data;
  //   } catch (error) {
  //     logger.error(`Error executing Apps Script: ${error}`);
  //     throw error;
  //   }
  // }

  // Update the text formatting in getFormatRequests
  async getFormatRequests() {
    const sheetId = await this.getSheetId();
    return {
      requests: [
        // Header row (A1:D1) - Lightest gray with lowest alpha
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 4
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.1, green: 0.11, blue: 0.14, alpha: 0.6 }, // Lighter gray, much lower alpha
                textFormat: {
                  foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                  fontSize: 16,
                  bold: true
                },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE'
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
          }
        },
        // Last Updated row (A2:D2) - Medium gray with medium alpha
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 0,
              endColumnIndex: 4
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.09, green: 0.1, blue: 0.13, alpha: 0.75 }, // Medium gray, medium alpha
                textFormat: {
                  foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                  fontSize: 14,
                  italic: true
                },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE'
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
          }
        },
        // Column Headers (A3:D3) - Even darker gray with highest alpha
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 2,
              endRowIndex: 3,
              startColumnIndex: 0,
              endColumnIndex: 4
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.06, green: 0.07, blue: 0.09, alpha: 0.98 }, // Darker values
                textFormat: {
                  foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                  fontSize: 16,
                  bold: true
                },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE'
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
          }
        },
        // Data rows (A4:D{end}) - Purple theme
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 3,
              endRowIndex: 1000,
              startColumnIndex: 0,
              endColumnIndex: 4
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.15, green: 0.1, blue: 0.2, alpha: 0.85 },
                textFormat: {
                  foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 }, // Pure white
                  fontSize: 14,
                  bold: true
                },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE'
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
          }
        },
        // Alternate row coloring with purple tint
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{
                sheetId: sheetId,
                startRowIndex: 3,
                endRowIndex: 1000,
                startColumnIndex: 0,
                endColumnIndex: 4
              }],
              booleanRule: {
                condition: {
                  type: 'CUSTOM_FORMULA',
                  values: [{
                    userEnteredValue: '=MOD(ROW(),2)=0'
                  }]
                },
                format: {
                  backgroundColor: { red: 0.18, green: 0.12, blue: 0.24, alpha: 0.8 }
                }
              }
            }
          }
        },
        // Borders with purple tint
        {
          updateBorders: {
            range: {
              sheetId: sheetId,
              startRowIndex: 0,
              endRowIndex: 1000,
              startColumnIndex: 0,
              endColumnIndex: 4
            },
            top: {
              style: 'SOLID',
              color: { red: 0.4, green: 0.3, blue: 0.5 }
            },
            bottom: {
              style: 'SOLID',
              color: { red: 0.4, green: 0.3, blue: 0.5 }
            },
            innerHorizontal: {
              style: 'SOLID',
              color: { red: 0.35, green: 0.25, blue: 0.45 }
            },
            innerVertical: {
              style: 'SOLID',
              color: { red: 0.35, green: 0.25, blue: 0.45 }
            }
          }
        }
      ]
    };
  }

  // Add method to load last image update timestamp
  async loadLastImageUpdate() {
    const result = this.preparedStatements.getMetadata.get('last_image_update');
    if (result) {
      this.lastGameImageUpdate = parseInt(result.value);
      logger.info(`Loaded last image update timestamp: ${new Date(this.lastGameImageUpdate)}`);
    }
  }

  // Update database setup to include new metadata field
  async _setupDatabase() {
    // ... (existing setup code) ...

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async findGameIdByName(gameName) {
    logger.info(`Searching for game by name: ${gameName}`);
    const normalizedGameName = this._normalizeGameName(gameName);
    const lowerGameName = normalizedGameName.toLowerCase();
    
    // Check if input is too short or vague
    if (lowerGameName.length < 2 || /^[a-z]$/i.test(lowerGameName)) {
      throw new Error('Please provide a more specific game name.');
    }

    // First check abbreviations
    if (this.abbreviationMapping[lowerGameName]) {
      return await this.findGameIdByName(this.abbreviationMapping[lowerGameName]);
    }

    try {
        // Get all games from database
        const allGames = this.preparedStatements.selectAllGames.all();
        
        // Calculate scores for each game
        const matches = allGames.map(game => {
            const gameName = game.name.toLowerCase();
            
            // Split game name to handle prefixes and suffixes
            const parts = gameName.split(/[:|-]/);
            const mainTitle = parts[parts.length - 1].trim();
            const prefix = parts.length > 1 ? parts[0].trim() : '';

            // Calculate various match scores
            const scores = {
                // Exact match with full name (highest priority)
                exactMatch: gameName === lowerGameName ? 100 : 0,
                
                // Exact match with main title
                mainTitleExact: mainTitle === lowerGameName ? 90 : 0,
                
                // Partial ratio for substring matching
                partialRatio: fuzzball.partial_ratio(lowerGameName, mainTitle),
                
                // Token sort ratio for word order independence
                tokenSortRatio: fuzzball.token_sort_ratio(lowerGameName, gameName),
                
                // Token set ratio for handling extra/missing words
                tokenSetRatio: fuzzball.token_set_ratio(lowerGameName, mainTitle),
                
                // Length penalty for very short queries
                lengthPenalty: lowerGameName.length < 3 ? -50 : 0,
                
                // Bonus for exact word matches
                wordMatchBonus: (() => {
                    const searchWords = lowerGameName.split(' ');
                    const gameWords = gameName.split(' ');
                    const exactMatches = searchWords.filter(word => 
                        word.length > 2 && gameWords.includes(word)
                    ).length;
                    return (exactMatches / searchWords.length) * 30;
                })(),
                
                // Penalty for common words
                commonWordPenalty: (() => {
                    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to'];
                    return lowerGameName.split(' ').every(word => commonWords.includes(word)) ? -50 : 0;
                })()
            };

            // Calculate weighted total score
            const totalScore = (
                (scores.exactMatch * 0.35) +
                (scores.mainTitleExact * 0.25) +
                (scores.partialRatio * 0.15) +
                (scores.tokenSortRatio * 0.10) +
                (scores.tokenSetRatio * 0.10) +
                scores.lengthPenalty +
                scores.wordMatchBonus +
                scores.commonWordPenalty
            );

            return {
                game,
                scores,
                totalScore
            };
        });

        // Filter and sort matches
        const validMatches = matches
            .filter(m => m.totalScore > 60) // Increased threshold
            .sort((a, b) => b.totalScore - a.totalScore);

        // Log top matches for debugging
        logger.debug(`Top matches for "${normalizedGameName}":`, 
            validMatches.slice(0, 3).map(m => ({
                name: m.game.name,
                score: m.totalScore,
                scores: m.scores
            }))
        );

        // If we have a clear best match
        if (validMatches.length > 0 && 
            validMatches[0].totalScore >= 75 && // Increased threshold
            (validMatches.length === 1 || validMatches[0].totalScore - validMatches[1].totalScore > 15)) {
            return validMatches[0].game.id;
        }

        // If we have multiple close matches, suggest them
        if (validMatches.length > 0) {
            const suggestions = validMatches
                .slice(0, 3)
                .map(m => m.game.name)
                .join(', ');
            throw new Error(`Multiple matches found. Did you mean: ${suggestions}?`);
        }

        // No good matches found
        throw new Error(`No games found matching "${gameName}".`);

    } catch (error) {
        logger.error(`Error during game search: ${error}`);
        throw error;
    }
  }

  // Helper method to normalize game names
  _normalizeGameName(name) {
    return name
        .toLowerCase()
        .replace(/[!?:]/g, '') // Remove special characters
        .replace(/\s+/g, ' ')  // Normalize spaces
        .trim();
  }
} // <-- Class definition ends here

// Export both the class and the setup function
export { DVP };
export async function setupDvp(bot) {
  try {
    const dvp = new DVP(bot);
    
    // Wait for initialization to complete
    await dvp.init(bot);
    
    // Only return commands if initialization was successful
    if (!dvp.initialized) {
      throw new Error('DVP module failed to initialize');
    }
    
    // Return all command handlers with proper binding
    return {
      'dvp': (context) => dvp.handleDvpCommand(context),
      'dvpupdate': (context) => dvp.handleDvpUpdateCommand(context),
      'sheet': (context) => dvp.handleSheetCommand(context)
    };
  } catch (error) {
    logger.error(`Failed to setup DVP module: ${error}`);
    // Return empty object to prevent undefined errors
    return {};
  }
}
