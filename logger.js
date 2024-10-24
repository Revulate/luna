import { createLogger, format, transports } from 'winston';
import path from 'path';

const logger = createLogger({
  level: 'debug', // Ensure this is set to 'debug' to capture all logs
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
    new transports.File({ filename: path.join('logs', 'app.log'), level: 'debug' }) // Ensure file path is correct
  ]
});

export default logger;
