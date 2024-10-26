import logger from './logger.js';

class ServiceRegistry {
  constructor() {
    logger.startOperation('Initializing ServiceRegistry');
    this.services = new Map();
    this.initializationStatus = new Map();
    logger.debug('ServiceRegistry initialized');
  }

  hasService(name) {
    return this.services.has(name);
  }

  register(name, service) {
    if (this.services.has(name)) {
      logger.warn(`Service ${name} is already registered. Skipping registration.`);
      return;
    }
    this.services.set(name, service);
    this.initializationStatus.set(name, false);
    logger.debug(`Registered service: ${name}`);
  }

  async initialize(name) {
    logger.startOperation(`Initializing service: ${name}`);
    if (!this.services.has(name)) {
      logger.error(`Service not found: ${name}`);
      throw new Error(`Service ${name} not found`);
    }

    // Check if already initialized
    if (this.initializationStatus.get(name)) {
      logger.debug(`Service ${name} is already initialized`);
      return true;
    }

    const service = this.services.get(name);
    if (typeof service.initialize === 'function') {
      try {
        await service.initialize();
        this.initializationStatus.set(name, true);
        logger.info(`Initialized service: ${name}`);
        logger.endOperation(`Initializing service: ${name}`, true);
        return true;
      } catch (error) {
        // For non-critical services, log error but don't throw
        if (['webPanel', 'dvp', 'afk'].includes(name)) {
          logger.error(`Failed to initialize non-critical service ${name}:`, error);
          logger.endOperation(`Initializing service: ${name}`, false);
          return false;
        }
        logger.error(`Failed to initialize service ${name}:`, error);
        logger.endOperation(`Initializing service: ${name}`, false);
        throw error;
      }
    }
    return false;
  }

  getService(name) {
    return this.services.get(name);
  }

  isInitialized(name) {
    return this.initializationStatus.get(name) || false;
  }

  async cleanup() {
    logger.startOperation('Service cleanup');
    const services = [...this.services.entries()].reverse(); // Cleanup in reverse order
    
    for (const [name, service] of services) {
      try {
        if (typeof service.cleanup === 'function') {
          await service.cleanup();
          logger.info(`Cleaned up service: ${name}`);
        }
      } catch (error) {
        logger.error(`Error cleaning up service ${name}:`, error);
      }
    }
    logger.endOperation('Service cleanup', true);
  }
}

export const serviceRegistry = new ServiceRegistry();
