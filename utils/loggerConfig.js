import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');

// Custom format for console output with colored text and uncolored labels
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'HH:mm:ss A'
  }),
  winston.format.printf(({ level, message, timestamp, type }) => {
    // Custom color scheme with updated colors
    const colors = {
      error: '\x1b[38;2;232;49;87m',     // Red #E83157
      warn: '\x1b[38;2;229;181;102m',    // Yellow #E5B566
      info: '\x1b[38;2;57;193;202m',     // Cyan #39C1CA
      debug: '\x1b[38;2;86;184;112m',    // Green #56B870
      bot: '\x1b[38;2;167;107;219m',     // Purple #A76BDB
      config: '\x1b[38;2;196;137;75m',   // Orange #C4894B
      timestamp: '\x1b[38;2;166;166;166m', // Gray #A6A6A6
      reset: '\x1b[0m'                    // Reset color
    };

    // Get color based on message type or level
    let color = colors[level];
    let label = level;

    // Special handling for different message types
    if (message.startsWith('[Config]')) {
      color = colors.config;
      label = 'config';
      message = message.replace('[Config] ', '');
    } else if (type === 'bot') {
      color = colors.bot;
      label = 'bot';
    }

    // Format: timestamp [level] message
    return `${colors.timestamp}${timestamp}${colors.reset} [${label}] ${color}${message}${colors.reset}`;
  })
);

export const createLogger = (level = 'debug') => {
  const logger = winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        level: 'debug',
        format: consoleFormat
      }),
      new winston.transports.DailyRotateFile({
        filename: path.join(logsDir, 'debug-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'debug',
        maxFiles: '14d'
      }),
      new winston.transports.DailyRotateFile({
        filename: path.join(logsDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxFiles: '14d'
      })
    ]
  });

  // Add custom logging methods
  logger.bot = (message) => {
    logger.info(message, { type: 'bot' });
  };

  logger.config = (message) => {
    logger.info(message, { type: 'config' });
  };

  return logger;
};
