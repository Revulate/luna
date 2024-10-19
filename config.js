import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

export const config = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    accessToken: process.env.ACCESS_TOKEN,
    refreshToken: process.env.REFRESH_TOKEN,
    botUsername: process.env.BOT_NICK,
    channels: process.env.TWITCH_CHANNELS.split(','),
    broadcasterUserId: process.env.BROADCASTER_USER_ID,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY
  },
  steam: {
    apiKey: process.env.API_STEAM_KEY
  },
  database: {
    path: process.env.DB_PATH || './bot.db'
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  google: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    credentialsFile: process.env.GOOGLE_CREDENTIALS_FILE,
    sheetUrl: process.env.GOOGLE_SHEET_URL
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY,
    // ... other YouTube-related config
  }
};

// Log the loaded configuration (excluding sensitive information)
logger.debug('Loaded Twitch configuration:', {
  clientId: config.twitch.clientId ? '(set)' : '(not set)',
  clientSecret: config.twitch.clientSecret ? '(set)' : '(not set)',
  accessToken: config.twitch.accessToken ? '(set)' : '(not set)',
  refreshToken: config.twitch.refreshToken ? '(set)' : '(not set)',
  botUsername: config.twitch.botUsername,
  channels: config.twitch.channels,
  broadcasterUsername: config.twitch.broadcasterUsername
});
