import { createLogger, format, transports } from 'winston';
import path from 'path';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'debug', // Use the log level from .env
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}] ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
      }`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join('logs', 'app.log'), level: process.env.LOG_LEVEL || 'info' }) // Ensure file path is correct
  ]
});

export default logger;
