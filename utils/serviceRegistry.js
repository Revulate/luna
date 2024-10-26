import logger from './logger.js';

class ServiceRegistry {
  constructor() {
    this.services = new Map();
    this.aliases = new Map();
  }

  register(name, service) {
    const normalizedName = name.toLowerCase();
    this.services.set(normalizedName, service);
    
    // Add common aliases
    if (normalizedName === 'eventmanager') {
      this.services.set('twitcheventmanager', service);
    }
    if (normalizedName === 'twitcheventmanager') {
      this.services.set('eventmanager', service);
    }
    
    logger.debug(`Registered service: ${name}`);
  }

  getService(name) {
    const normalizedName = name.toLowerCase();
    return this.services.get(normalizedName) || 
           this.services.get(this.aliases.get(normalizedName));
  }

  hasService(name) {
    const normalizedName = name.toLowerCase();
    return this.services.has(normalizedName) || 
           this.services.has(this.aliases.get(normalizedName));
  }

  getAllServices() {
    return Array.from(this.services.entries());
  }
}

export const serviceRegistry = new ServiceRegistry();
