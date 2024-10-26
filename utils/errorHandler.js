import logger from './logger.js';

class ErrorHandler {
  constructor() {
    logger.startOperation('Initializing ErrorHandler');
    this.errorCounts = new Map();
    this.errorThresholds = {
      RATE_LIMIT: 5,
      API_ERROR: 3,
      DATABASE_ERROR: 3,
      NETWORK_ERROR: 5,
      TIMEOUT: 3
    };
    
    this.recoveryStrategies = new Map();
    this.lastErrors = new Map();
    this.errorPatterns = new Map();
    logger.debug('Error handler initialized with thresholds:', this.errorThresholds);
  }

  async handleError(error, context = {}) {
    try {
      logger.startOperation('Error handling');
      const errorKey = this.categorizeError(error);
      this.trackError(errorKey, error);

      // Log error with context
      logger.error('Error occurred:', {
        type: errorKey,
        message: error.message,
        context,
        stack: error.stack
      });

      // Check if we need to trigger recovery
      if (this.shouldTriggerRecovery(errorKey)) {
        await this.executeRecoveryStrategy(errorKey, context);
      }

      const response = this.getErrorResponse(errorKey, context);
      logger.endOperation('Error handling', true);
      return response;
    } catch (handlingError) {
      logger.error('Error in error handler:', handlingError);
      logger.endOperation('Error handling', false);
      return {
        success: false,
        message: 'Internal error occurred',
        severity: 'CRITICAL'
      };
    }
  }

  categorizeError(error) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
      return 'TIMEOUT';
    }
    if (error.response?.status === 429) {
      return 'RATE_LIMIT';
    }
    if (error.code === 'SQLITE_ERROR') {
      return 'DATABASE_ERROR';
    }
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return 'NETWORK_ERROR';
    }
    return 'UNKNOWN_ERROR';
  }

  trackError(errorKey, error) {
    const count = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, count + 1);
    
    this.lastErrors.set(errorKey, {
      timestamp: Date.now(),
      error: error.message,
      count: count + 1
    });

    // Track error patterns
    const pattern = this.getErrorPattern(error);
    const patterns = this.errorPatterns.get(errorKey) || new Map();
    patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
    this.errorPatterns.set(errorKey, patterns);
  }

  getErrorPattern(error) {
    return `${error.code || 'NO_CODE'}:${error.message.split(' ').slice(0, 3).join('_')}`;
  }

  shouldTriggerRecovery(errorKey) {
    const threshold = this.errorThresholds[errorKey];
    const count = this.errorCounts.get(errorKey) || 0;
    return count >= threshold;
  }

  async executeRecoveryStrategy(errorKey, context) {
    const strategy = this.recoveryStrategies.get(errorKey);
    if (strategy) {
      try {
        await strategy(context);
        this.errorCounts.set(errorKey, 0); // Reset count after successful recovery
      } catch (recoveryError) {
        logger.error('Recovery strategy failed:', recoveryError);
      }
    }
  }

  getErrorResponse(errorKey, context) {
    const responses = {
      RATE_LIMIT: {
        success: false,
        message: 'Rate limit exceeded. Please try again later.',
        severity: 'WARNING'
      },
      API_ERROR: {
        success: false,
        message: 'API error occurred. Service may be unavailable.',
        severity: 'ERROR'
      },
      DATABASE_ERROR: {
        success: false,
        message: 'Database error occurred.',
        severity: 'CRITICAL'
      },
      NETWORK_ERROR: {
        success: false,
        message: 'Network connectivity issues detected.',
        severity: 'ERROR'
      },
      TIMEOUT: {
        success: false,
        message: 'Request timed out. Please try again.',
        severity: 'WARNING'
      },
      UNKNOWN_ERROR: {
        success: false,
        message: 'An unexpected error occurred.',
        severity: 'ERROR'
      }
    };

    return responses[errorKey] || responses.UNKNOWN_ERROR;
  }

  registerRecoveryStrategy(errorKey, strategy) {
    this.recoveryStrategies.set(errorKey, strategy);
  }

  getErrorStats() {
    return {
      counts: Object.fromEntries(this.errorCounts),
      patterns: Object.fromEntries(this.errorPatterns),
      lastErrors: Object.fromEntries(this.lastErrors)
    };
  }

  clearErrorStats() {
    this.errorCounts.clear();
    this.lastErrors.clear();
    this.errorPatterns.clear();
  }
}

export function setupErrorHandler() {
  return new ErrorHandler();
}
