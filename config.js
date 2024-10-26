import dotenv from 'dotenv';
import logger from './utils/logger.js';
import path from 'path';
import fs from 'fs';

// Load environment variables first
dotenv.config();

// Create a simple console logger for config initialization
const configLogger = {
  debug: (...args) => console.debug('[Config]', ...args),
  info: (...args) => console.info('[Config]', ...args),
  warn: (...args) => console.warn('[Config]', ...args),
  error: (...args) => console.error('[Config]', ...args)
};

// Helper function to ensure required env vars are present
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        logger.error(`Missing required environment variable: ${name}`);
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

// Helper to parse comma-separated strings into arrays
function parseCSV(str, defaultValue = []) {
    return str ? str.split(',').map(s => s.trim()).filter(Boolean) : defaultValue;
}

export function parseChannels(channelString) {
  if (!channelString) {
    logger.warn('No channels provided in environment variables');
    return [];
  }

  const channels = channelString.split(',')
    .map(channel => channel.trim())
    .filter(channel => channel.length > 0);

  return channels;
}

// Config should directly reflect .env values
export const config = {
    twitch: {
        clientId: requireEnv('TWITCH_CLIENT_ID'),
        clientSecret: requireEnv('TWITCH_CLIENT_SECRET'),
        accessToken: requireEnv('ACCESS_TOKEN'),
        refreshToken: requireEnv('REFRESH_TOKEN'),
        expiresIn: process.env.EXPIRES_IN,
        obtainmentTimestamp: process.env.OBTAINMENT_TIMESTAMP,
        botUsername: requireEnv('BOT_NICK'),
        channels: parseChannels(process.env.TWITCH_CHANNELS),
        commandPrefix: process.env.COMMAND_PREFIX || '#',
        botUserId: requireEnv('BOT_USER_ID'),
        broadcasterUserId: requireEnv('BROADCASTER_USER_ID'),
        adminUsers: parseCSV(process.env.ADMIN_USERS, ['revulate']),
        redirectUri: process.env.TWITCH_REDIRECT_URI,
        scopes: [
            'chat:read',
            'chat:edit',
            'channel:moderate',
            'channel:read:subscriptions',
            'moderator:read:followers',
            'moderator:manage:announcements',
            'channel:manage:broadcast',
            'user:read:chat',
            'user:write:chat'
        ],
        intents: ['chat']
    },
    webPanel: {
        port: parseInt(process.env.WEB_PANEL_PORT) || 3069,
        password: requireEnv('WEB_PANEL_PASSWORD')
    },
    anthropic: {
        apiKey: requireEnv('ANTHROPIC_API_KEY')
    },
    openai: {
        apiKey: requireEnv('OPENAI_API_KEY')
    },
    steam: {
        apiKey: requireEnv('API_STEAM_KEY')
    },
    google: {
        sheetId: process.env.GOOGLE_SHEET_ID,
        sheetUrl: process.env.GOOGLE_SHEET_URL,
        scriptId: process.env.GOOGLE_SCRIPT_ID,
        credentialsFile: process.env.GOOGLE_CREDENTIALS_FILE || 'credentials.json',
        credentials: null
    },
    youtube: {
        apiKey: requireEnv('YOUTUBE_API_KEY'),
        accessToken: process.env.YOUTUBE_ACCESS_TOKEN
    },
    weather: {
        apiKey: requireEnv('WEATHER_API_KEY')
    },
    nuuls: {
        apiKey: requireEnv('NUULS_API_KEY')
    },
    logging: {
        level: (process.env.LOG_LEVEL || 'debug').toLowerCase(),
        twurpleLevel: process.env.LOGGING
    }
};

// Load Google credentials if available
try {
    const credentialsPath = path.join(process.cwd(), config.google.credentialsFile);
    if (fs.existsSync(credentialsPath)) {
        const credentialsContent = fs.readFileSync(credentialsPath, 'utf8');
        config.google.credentials = JSON.parse(credentialsContent);
        configLogger.debug('Google credentials loaded successfully');
    } else {
        configLogger.warn(`Google credentials file not found at ${credentialsPath}`);
        // Create a template credentials file
        const templateCredentials = {
            type: "service_account",
            project_id: "YOUR_PROJECT_ID",
            private_key_id: "YOUR_PRIVATE_KEY_ID",
            private_key: "YOUR_PRIVATE_KEY",
            client_email: "YOUR_CLIENT_EMAIL",
            client_id: "YOUR_CLIENT_ID",
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
            client_x509_cert_url: "YOUR_CLIENT_X509_CERT_URL"
        };
        fs.writeFileSync(credentialsPath, JSON.stringify(templateCredentials, null, 2));
        configLogger.info(`Created template credentials file at ${credentialsPath}`);
    }
} catch (error) {
    configLogger.warn('Failed to load Google credentials:', error);
}

// Add this after config initialization
if (config.logging.level === 'debug') {
    configLogger.debug('Debug logging enabled');
}
