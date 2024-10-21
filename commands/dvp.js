import Database from 'better-sqlite3';
import { google } from 'googleapis';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import * as fuzzball from 'fuzzball';
import logger from '../logger.js';
import TwitchAPI from '../twitch_api.js';
import { JWT } from 'google-auth-library';
import validators from 'validator';
import { parse, format } from 'date-fns';
import NodeCache from 'node-cache';
import JSONStream from 'jsonstream/index.js';
import { pipeline } from 'stream/promises';
import { config } from '../config.js';

dotenv.config();

class DVP {
  constructor(bot) {
    this.bot = bot;
    this.dbPath = 'vulpes_games.db';
    this.channelName = 'vulpeshd';
    this.sheetId = process.env.GOOGLE_SHEET_ID;
    this.credsFile = process.env.GOOGLE_CREDENTIALS_FILE;
    this.imageUrlCache = new Map();
    this.lastScrapeTime = null;
    this.db = null;
    this.cache = new NodeCache({ stdTTL: 600 }); // 10 minutes TTL
    this.steamApiKey = config.steam.apiKey;  // Load Steam API key from config
    if (!this.steamApiKey) {
      logger.error('Steam API key is not set in the configuration');
    }

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

    this.twitchApi = new TwitchAPI();

    this.sheets = google.sheets({ version: 'v4' });
    this.auth = new JWT({
      keyFile: this.credsFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.verifyGoogleCredentials();
    this.initializeCog();

    this.preparedStatements = {};
    this._prepareStatements();  // Call this method to initialize prepared statements

    this.browser = null;
  }

  async verifyGoogleCredentials() {
    try {
      const response = await this.sheets.spreadsheets.get({
        auth: this.auth,
        spreadsheetId: this.sheetId,
      });
      logger.info(`Successfully verified Google Sheets credentials. Sheet title: ${response.data.properties.title}`);
    } catch (error) {
      logger.error(`Failed to verify Google Sheets credentials: ${error}`);
    }
  }

  async initializeCog() {
    logger.info('DVP module is initializing');
    await this.setupDatabase();
    this._prepareStatements();  // Add this line
    await this.loadLastScrapeTime();
    await this.initializeData();
    await this.loadImageUrlCache();
    this.startPeriodicScrapeUpdate();
    logger.info('DVP module initialized successfully');

    this.browser = await chromium.launch({ headless: true });
  }

  async setupDatabase() {
    logger.info(`Setting up database at ${this.dbPath}`);
    try {
      this.db = new Database(this.dbPath, { verbose: logger.debug });

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
          value TEXT
        )
      `);

      this._prepareStatements();

      logger.info('Database setup complete');
    } catch (error) {
      logger.error(`Error setting up database: ${error}`);
      throw error;
    }
  }

  _prepareStatements() {
    this.preparedStatements = {
      insertGame: this.db.prepare(`
        INSERT OR REPLACE INTO games (name, time_played, last_played, image_url)
        VALUES (?, ?, ?, ?)
      `),
      selectGame: this.db.prepare('SELECT * FROM games WHERE name = ?'),
      updateGameImageUrl: this.db.prepare('UPDATE games SET image_url = ? WHERE name = ?'),
      selectAllGames: this.db.prepare('SELECT * FROM games ORDER BY time_played DESC'),
      getMetadata: this.db.prepare('SELECT value FROM metadata WHERE key = ?'),
      setMetadata: this.db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)'),
      selectActiveGames: this.db.prepare('SELECT * FROM games WHERE image_url IS NOT NULL'),
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
      let dataUpdated = false;
      if (!this.lastScrapeTime || (new Date() - this.lastScrapeTime) > 7 * 24 * 60 * 60 * 1000) {
        logger.info('Performing initial web scraping');
        await this.scrapeInitialData();
        await this.saveLastScrapeTime();
        dataUpdated = true;
      } else {
        logger.info('Skipping web scraping, using existing data');
      }
      await this.updateInitialsMapping();
      const imagesFetched = await this.fetchMissingImages();
      if (dataUpdated || imagesFetched) {
        await this.updateGoogleSheet();
      }
      logger.info('Data initialization completed successfully.');
    } catch (error) {
      logger.error(`Error initializing data: ${error}`);
    }
  }

  async scrapeInitialData() {
    logger.info('Initializing data from web scraping using Playwright...');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(`https://twitchtracker.com/${this.channelName}/games`);
      await page.waitForSelector('#games');

      await page.selectOption('select[name="games_length"]', '-1');
      await page.waitForTimeout(5000);

      const rows = await page.$$('#games tbody tr');
      logger.info(`Found ${rows.length} rows in the games table.`);

      for (const row of rows) {
        try {
          const name = await row.$eval('td:nth-child(2)', el => el.textContent.trim());
          const timePlayedStr = await row.$eval('td:nth-child(3) > span', el => el.textContent.trim());
          const lastSeenStr = await row.$eval('td:nth-child(7)', el => el.textContent.trim());

          logger.info(`Raw data - Name: ${name}, Time played: ${timePlayedStr}, Last seen: ${lastSeenStr}`);

          const timePlayed = this.parseTime(timePlayedStr);
          let lastPlayed;
          try {
            lastPlayed = this.parseDate(lastSeenStr);
          } catch (error) {
            logger.error(`Error parsing date '${lastSeenStr}': ${error}`);
            lastPlayed = new Date().toISOString().split('T')[0];
          }

          logger.info(`Processed data - Name: ${name}, Time played: ${timePlayed} minutes (${this.formatPlaytime(timePlayed)}), Last played: ${lastPlayed}`);

          if (name) {
            this.preparedStatements.insertGame.run(name, timePlayed, lastPlayed, null);
          } else {
            logger.warning('Skipping row due to empty game name');
          }
        } catch (rowError) {
          logger.error(`Error processing row: ${rowError}`);
        }
      }

      logger.info('Initial data scraping completed and data inserted into the database.');
    } catch (error) {
      logger.error(`Error during data scraping: ${error}`);
    } finally {
      await browser.close();
    }
  }

  async loadImageUrlCache() {
    logger.info('Loading image URL cache from database');
    try {
      const rows = this.preparedStatements.selectActiveGames.all();
      for (const { name, image_url } of rows) {
        this.imageUrlCache.set(name, image_url);
      }
      logger.info(`Loaded ${this.imageUrlCache.size} image URLs into cache`);
    } catch (error) {
      logger.error(`Error loading image URL cache: ${error}`);
    }
  }

  parseDate(dateStr) {
    try {
      // Parse the date string assuming it's in the format 'DD/MMM/YYYY'
      const parsedDate = parse(dateStr, 'dd/MMM/yyyy', new Date());
      
      // Check if the parsed date is valid
      if (isNaN(parsedDate.getTime())) {
        throw new Error(`Invalid date: ${dateStr}`);
      }
      
      // Format the date as 'YYYY-MM-DD' in UTC
      return format(parsedDate, 'yyyy-MM-dd', { timeZone: 'UTC' });
    } catch (error) {
      logger.error(`Error parsing date '${dateStr}': ${error}`);
      return format(new Date(), 'yyyy-MM-dd', { timeZone: 'UTC' }); // Return current date as fallback
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

  async getGameImageUrl(gameName) {
    if (this.imageUrlCache.has(gameName)) {
      logger.info(`Using cached image URL for '${gameName}': ${this.imageUrlCache.get(gameName)}`);
      return this.imageUrlCache.get(gameName);
    }

    logger.info(`Fetching image URL for game: ${gameName}`);
    const url = await this.twitchApi.getGameImageUrl(gameName);
    if (url) {
      if (validators.isURL(url)) {
        this.imageUrlCache.set(gameName, url);
        await this.saveGameImageUrl(gameName, url);
        logger.info(`Generated and cached new image URL for '${gameName}': ${url}`);
      } else {
        logger.warn(`Invalid image URL generated for '${gameName}': ${url}`);
      }
    } else {
      logger.warn(`No image found for game: ${gameName}`);
    }

    return url;
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
      logger.info(`Retrieved ${games.length} games from the database`);

      const rows = await Promise.all(games.map(async (game, index) => {
        logger.info(`Processing game: ${game.name}`);
        let imageUrl = game.image_url;
        if (!imageUrl) {
          try {
            imageUrl = await this.twitchApi.getGameImageUrl(game.name);
            if (imageUrl) {
              this.preparedStatements.updateGameImageUrl.run(imageUrl, game.name);
            }
          } catch (error) {
            logger.error(`Error fetching image URL for ${game.name}: ${error}`);
          }
        }

        return [
          `=IMAGE("${imageUrl || ''}")`,
          game.name,
          this.formatPlaytime(game.time_played),
          game.last_played
        ];
      }));

      // Update the game data
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: 'VulpesHD Games!A4:D',
        valueInputOption: 'USER_ENTERED',
        resource: { values: rows },
        auth: this.auth,
      });

      // Update the last updated timestamp
      const now = new Date();
      const formattedDate = format(now, 'MMMM d, yyyy');
      const formattedTime = format(now, 'h:mm:ss a');
      const timestamp = `Last Updated: ${formattedDate} at ${formattedTime} MST (GMT-7)`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: 'VulpesHD Games!A2:D2',  // Changed from 'B2' to 'A2:D2'
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[timestamp, '', '', '']] },  // Fill the entire row
        auth: this.auth,
      });

      logger.info(`Google Sheet updated successfully with ${games.length} games. ${timestamp}`);
    } catch (error) {
      logger.error(`Error updating Google Sheet: ${error}`);
    }
  }

  async applySheetFormatting(dataRowCount) {
    try {
      const sheetId = await this.getSheetId();

      const requests = [
        {
          updateSheetProperties: {
            properties: {
              sheetId: sheetId,
              gridProperties: { frozenRowCount: 1 },  // Only freeze the header row
            },
            fields: "gridProperties.frozenRowCount",
          }
        },
        {
          repeatCell: {
            range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1 },  // Format only the header row
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.0, green: 0.0, blue: 0.0 },
                textFormat: {
                  foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                  bold: true,
                },
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          }
        },
      ];

      await this.sheets.spreadsheets.batchUpdate({
        auth: this.auth,
        spreadsheetId: this.sheetId,
        resource: { requests },
      });

      logger.info('Applied formatting to the Google Sheet.');
    } catch (error) {
      logger.error(`Error applying sheet formatting: ${error}`);
    }
  }

  async getSheetId() {
    try {
      const response = await this.sheets.spreadsheets.get({
        auth: this.auth,
        spreadsheetId: this.sheetId,
      });

      const sheet = response.data.sheets.find(s => s.properties.title === 'Sheet1') || response.data.sheets[0];
      return sheet.properties.sheetId;
    } catch (error) {
      logger.error(`Error retrieving sheet ID: ${error}`);
      return 0;
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

  async fetchMissingImages() {
    logger.info('Fetching missing images');
    const games = this.db.prepare("SELECT name FROM games WHERE image_url IS NULL").all();
    let imagesFetched = false;
    for (const game of games) {
      const imageUrl = await this.getGameImageUrl(game.name);
      if (imageUrl) {
        await this.db.run("UPDATE games SET image_url = ? WHERE name = ?", [imageUrl, game.name]);
        this.imageUrlCache.set(game.name, imageUrl);
        imagesFetched = true;
      }
    }
    logger.info(`Fetched images for ${games.length} games`);
    return imagesFetched;
  }

  async handleDvpCommand({ channel, user, args, bot }) {
    try {
      let gameName = args.join(' ').trim();
      if (!gameName) {
        await bot.say(channel, `@${user.username}, please provide a game name.`);
        return;
      }

      // Check for abbreviations first
      let gameNameToSearch = this.abbreviationMapping[gameName.toLowerCase()] || gameName;

      // If not found in abbreviations, try fuzzy matching
      if (gameNameToSearch === gameName) {
        const games = this.preparedStatements.selectAllGames.all();
        const gameNames = games.map(g => g.name);
        const matches = fuzzball.extract(gameName, gameNames, { scorer: fuzzball.token_set_ratio, limit: 1 });
        if (matches.length > 0 && matches[0][1] > 80) {
          gameNameToSearch = matches[0][0];
        }
      }

      const result = this.preparedStatements.selectGame.get(gameNameToSearch);

      if (result) {
        const { time_played, last_played } = result;
        const formattedTime = this.formatPlaytime(time_played);
        
        // Parse the last_played date and format it
        const lastPlayedDate = parse(last_played, 'yyyy-MM-dd', new Date());
        const lastPlayedFormatted = format(lastPlayedDate, 'MMMM d, yyyy', { timeZone: 'UTC' });

        await bot.say(channel, `@${user.username}, Vulpes played ${gameNameToSearch} for ${formattedTime}. Last played on ${lastPlayedFormatted}.`);
      } else {
        await bot.say(channel, `@${user.username}, couldn't find data for ${gameNameToSearch}.`);
      }
    } catch (error) {
      logger.error(`Error executing dvp command: ${error}`);
      await bot.say(channel, `@${user.username}, an error occurred while processing your request. Please try again later.`);
    }
  }

  async handleSheetCommand({ channel, user, bot }) {
    await bot.say(channel, `@${user.username}, you can view Vulpes's game stats here: ${this.sheetUrl}`);
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

      const existingEntries = this.db.prepare("SELECT COUNT(*) as count FROM games").get();
      const numRowsToCheck = existingEntries.count > 0 ? 5 : -1;

      const rows = await page.$$('#games tbody tr');
      const rowsToProcess = numRowsToCheck === -1 ? rows : rows.slice(0, numRowsToCheck);

      logger.info(`Processing ${rowsToProcess.length} rows for updates`);

      for (const row of rowsToProcess) {
        const name = await row.$eval('td:nth-child(2)', el => el.textContent.trim());
        const timePlayedStr = await row.$eval('td:nth-child(3) > span', el => el.textContent.trim());
        const lastSeenStr = await row.$eval('td:nth-child(7)', el => el.textContent.trim());

        logger.info(`Raw data - Name: ${name}, Time played: ${timePlayedStr}, Last seen: ${lastSeenStr}`);

        const lastPlayed = this.parseDate(lastSeenStr);
        const timePlayed = this.parseTime(timePlayedStr);

        logger.info(`Processed data - Name: ${name}, Time played: ${timePlayed} minutes (${this.formatPlaytime(timePlayed)}), Last played: ${lastPlayed}`);
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
      this.preparedStatements.insertGame.run(gameName, timePlayed, lastPlayed, null);
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

  async handleDvpUpdateCommand({ channel, user, bot }) {
    // Check if the user is Revulate
    if (user.username.toLowerCase() !== 'revulate') {
      await bot.say(channel, `@${user.username}, sorry, only Revulate can use this command.`);
      return;
    }

    logger.info('Force update initiated by Revulate');
    await bot.say(channel, `@${user.username}, initiating force update. This may take a moment...`);

    try {
      await this.updateLastPlayedDates();
      await this.updateGoogleSheet();
      await bot.say(channel, `@${user.username}, force update completed successfully!`);
    } catch (error) {
      logger.error(`Error during force update: ${error}`);
      await bot.say(channel, `@${user.username}, an error occurred during the force update. Please check the logs.`);
    }
  }

  async getGameInfo(gameName) {
    const cacheKey = `game:${gameName}`;
    let gameInfo = this.cache.get(cacheKey);
    if (gameInfo) {
      return gameInfo;
    }
    gameInfo = await this.fetchGameInfoFromDatabase(gameName);
    this.cache.set(cacheKey, gameInfo);
    return gameInfo;
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
}

export function setupDvp(bot) {
  const dvp = new DVP(bot);
  process.on('exit', () => dvp.cleanup());
  return {
    dvp: (context) => dvp.handleDvpCommand(context),
    dvpupdate: (context) => dvp.handleDvpUpdateCommand(context),
    sheet: (context) => dvp.handleSheetCommand(context),
  };
}

