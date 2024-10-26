import { createLogger } from './loggerConfig.js';

// Create default logger instance with debug level
const logger = createLogger('debug');

// Add startup logging
logger.config('Logger initialized');
logger.debug(`Logger level set to: ${logger.level}`);

// Add convenience methods for common logging patterns
logger.startOperation = (operation) => {
  logger.debug(`Starting operation: ${operation}`);
};

logger.endOperation = (operation, success = true) => {
  if (success) {
    logger.debug(`Successfully completed operation: ${operation}`);
  } else {
    logger.warn(`Operation failed: ${operation}`);
  }
};

logger.logApiCall = (endpoint, method, status) => {
  logger.debug(`API ${method} ${endpoint} - Status: ${status}`);
};

logger.logPerformance = (operation, duration) => {
  logger.debug(`Performance - ${operation}: ${duration}ms`);
};

export default logger;
