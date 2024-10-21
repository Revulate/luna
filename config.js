import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

export const config = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    botUsername: process.env.BOT_NICK || 'TatsLuna',
    channels: (process.env.TWITCH_CHANNELS || '').split(','),
    broadcasterUserId: process.env.BROADCASTER_USER_ID,
    redirectUri: process.env.TWITCH_REDIRECT_URI,
  },
  database: {
    path: process.env.DB_PATH || './bot.db'
  },
  logging: {
    level: process.env.LOG_LEVEL || 'debug'
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY,
    accessToken: process.env.YOUTUBE_ACCESS_TOKEN
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY
  },
  steam: {
    apiKey: process.env.API_STEAM_KEY
  },
  google: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    credentialsFile: process.env.GOOGLE_CREDENTIALS_FILE,
    sheetUrl: process.env.GOOGLE_SHEET_URL
  },
  weather: {
    apiKey: process.env.WEATHER_API_KEY
  },
  nuuls: {
    apiKey: process.env.NUULS_API_KEY
  }
};

logger.debug('Loaded configuration', {
  botUsername: config.twitch.botUsername,
  channels: config.twitch.channels,
  broadcasterUserId: config.twitch.broadcasterUserId,
  youtubeApiKey: config.youtube.apiKey ? '(set)' : '(not set)',
  openaiApiKey: config.openai.apiKey ? '(set)' : '(not set)',
  steamApiKey: config.steam.apiKey ? '(set)' : '(not set)',
  googleSheetId: config.google.sheetId ? '(set)' : '(not set)',
  weatherApiKey: config.weather.apiKey ? '(set)' : '(not set)',
  nuulsApiKey: config.nuuls.apiKey ? '(set)' : '(not set)'
});
