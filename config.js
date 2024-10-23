import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

// Helper function to ensure required env vars are present
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

// Helper to parse comma-separated strings into arrays
function parseCSV(str, defaultValue = []) {
    return str ? str.split(',').map(s => s.trim()).filter(Boolean) : defaultValue;
}

export const config = {
    twitch: {
        clientId: requireEnv('TWITCH_CLIENT_ID'),
        clientSecret: requireEnv('TWITCH_CLIENT_SECRET'),
        botUsername: process.env.BOT_NICK || 'TatsLuna',
        channels: parseCSV(process.env.TWITCH_CHANNELS),
        broadcasterUserId: requireEnv('BROADCASTER_USER_ID'),
        redirectUri: requireEnv('TWITCH_REDIRECT_URI'),
        adminUsers: parseCSV(process.env.ADMIN_USERS, ['revulate']),
        commandPrefix: process.env.COMMAND_PREFIX || '#',
        eventSub: {
            retryAttempts: 3,
            retryDelay: 1000,
            connectTimeout: 10000
        }
    },
    database: {
        filename: process.env.DB_PATH || 'bot.db',
        options: {
            timeout: parseInt(process.env.DB_TIMEOUT) || 5000,
        }
    },
    logging: {
        level: process.env.LOG_LEVEL || 'debug',
        twurpleLevel: process.env.LOGGING || 'twurple=info;twurple:api:rate-limiter=warning'
    },
    youtube: {
        apiKey: requireEnv('YOUTUBE_API_KEY'),
        accessToken: process.env.YOUTUBE_ACCESS_TOKEN
    },
    openai: {
        apiKey: requireEnv('OPENAI_API_KEY')
    },
    steam: {
        apiKey: requireEnv('API_STEAM_KEY')
    },
    weather: {
        apiKey: requireEnv('WEATHER_API_KEY')
    },
    nuuls: {
        apiKey: requireEnv('NUULS_API_KEY')
    },
    google: {
        sheetId: requireEnv('GOOGLE_SHEET_ID'),
        credentialsFile: requireEnv('GOOGLE_CREDENTIALS_FILE'),
        sheetUrl: process.env.GOOGLE_SHEET_URL
    },
    cache: {
        defaultTTL: parseInt(process.env.CACHE_TTL) || 300, // 5 minutes
        checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD) || 60 // 1 minute
    },
    rateLimit: {
        defaultDelay: parseInt(process.env.RATE_LIMIT_DELAY) || 1200, // 1.2 seconds
        modDelay: parseInt(process.env.MOD_RATE_LIMIT_DELAY) || 100 // 0.1 seconds
    },
    webPanel: {
        port: process.env.WEB_PANEL_PORT || 3069,
        password: process.env.WEB_PANEL_PASSWORD || 'changeme' // Make sure to set this in .env
    }
};

// Validate configuration
function validateConfig() {
    if (!config.twitch.channels.length) {
        throw new Error('No Twitch channels configured');
    }
    
    // Add more validation as needed
}

try {
    validateConfig();
    
    logger.debug('Configuration loaded successfully', {
        botUsername: config.twitch.botUsername,
        channels: config.twitch.channels,
        adminUsers: config.twitch.adminUsers,
        apis: {
            youtube: config.youtube.apiKey ? '(set)' : '(not set)',
            openai: config.openai.apiKey ? '(set)' : '(not set)',
            steam: config.steam.apiKey ? '(set)' : '(not set)',
            weather: config.weather.apiKey ? '(set)' : '(not set)',
            nuuls: config.nuuls.apiKey ? '(set)' : '(not set)'
        }
    });
} catch (error) {
    logger.error('Configuration error:', error);
    process.exit(1);
}
