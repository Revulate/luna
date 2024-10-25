import winston from 'winston';  // Add this import
import { createLogger, format, transports } from 'winston';
import path from 'path';
import chalk from 'chalk';  // Add this import

// Custom time formatter
const timeFormat = {
  format: 'h:mm:ss A'
};

// Custom date formatter
const dateFormat = {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric'
};

let currentDate = new Date().toLocaleDateString('en-US', dateFormat);

// Helper function to wrap long messages
function wrapMessage(message, maxLength = 100) {
  if (message.length <= maxLength) return message;
  
  const words = message.split(' ');
  let lines = [];
  let currentLine = '';
  
  words.forEach(word => {
    if ((currentLine + ' ' + word).length <= maxLength) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  });
  
  if (currentLine) lines.push(currentLine);
  // Adjust padding to better align with message start
  const padding = '                    '; // 20 spaces to align with message start
  return lines.join('\n' + padding);
}

// Update the color configuration and format
const colors = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    chat: 4
  }
};

// Add this after the colors configuration
const levelColors = {
  error: 'redBright',
  warn: 'yellowBright',
  info: 'cyanBright',
  debug: 'blueBright',
  chat: 'magentaBright'
};

// Custom format for general logging
const customFormat = format.printf(({ timestamp, level, message }) => {
  const now = new Date(timestamp);
  const time = now.toLocaleTimeString('en-US', timeFormat);
  const grayTime = chalk.gray(time);
  
  // Keep level indicator white
  const levelIndicator = chalk.white(`[${level.toUpperCase()}]`);
  
  // Color the message based on level
  let coloredMessage;
  switch(level) {
    case 'error':
      coloredMessage = chalk.redBright(message);
      break;
    case 'warn':
      coloredMessage = chalk.yellowBright(message);
      break;
    case 'info':
      coloredMessage = chalk.cyanBright(message);
      break;
    case 'debug':
      coloredMessage = chalk.blueBright(message);
      break;
    case 'chat':
      coloredMessage = chalk.magentaBright(message);
      break;
    default:
      coloredMessage = message;
  }
  
  // Check if we've crossed to a new day
  const newDate = now.toLocaleDateString('en-US', dateFormat);
  if (newDate !== currentDate) {
    currentDate = newDate;
    return `\n${currentDate}\n${grayTime} ${levelIndicator} ${wrapMessage(coloredMessage)}`;
  }
  
  return `${grayTime} ${levelIndicator} ${wrapMessage(coloredMessage)}`;
});

// Create the logger with explicit levels but without Winston's colorize
const logger = createLogger({
  levels: colors.levels,
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    customFormat
  ),
  transports: [
    new transports.Console(),
    new transports.File({ 
      filename: path.join('logs', 'app.log'),
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    })
  ]
});

// Log the initial date when the bot starts
logger.info(`Bot starting on ${currentDate}`);

export default logger;
