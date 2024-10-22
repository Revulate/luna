import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

const logLevel = process.env.LOG_LEVEL || 'debug';

// Ensure the winston log directory exists
const winstonLogDir = path.join(process.cwd(), 'logs', 'winston');
if (!fs.existsSync(winstonLogDir)) {
  fs.mkdirSync(winstonLogDir, { recursive: true });
}

const logger = winston.createLogger({
  level: logLevel,
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    botMessage: 3,
    debug: 4
  },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      if (typeof message === 'string' && (message.startsWith('[MESSAGE]') || message.startsWith('[BOT MESSAGE]'))) {
        return `${timestamp} ${message}`;
      }
      return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.DailyRotateFile({
      filename: path.join(winstonLogDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d'
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(winstonLogDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    })
  ]
});

export default logger;
