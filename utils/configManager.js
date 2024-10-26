import logger from './logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

class ConfigManager {
  constructor() {
    logger.startOperation('Initializing ConfigManager');
    this.config = new Map();
    this.defaults = new Map();
    this.validators = new Map();
    this.configPath = null;
    this.isDirty = false;
    this.initialized = false;
    
    // Auto-save interval
    setInterval(() => this.autoSave(), 300000); // Every 5 minutes
    
    logger.debug('ConfigManager initialized');
  }

  async initialize(configPath = 'config.json') {
    // Prevent multiple initialization
    if (this.initialized) {
      logger.warn('ConfigManager already initialized');
      return true;
    }

    try {
      this.configPath = path.resolve(process.cwd(), configPath);
      
      // Load configuration
      await this.loadConfig();
      
      // Register default validators
      this.registerDefaultValidators();
      
      logger.info('Configuration manager initialized');
      this.initialized = true;
      return true;
    } catch (error) {
      logger.error('Error initializing config manager:', error);
      return false;
    }
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(configData);
      
      // Validate and set config values
      for (const [key, value] of Object.entries(parsed)) {
        await this.set(key, value, false); // Don't save during initial load
      }
      
      logger.info('Configuration loaded successfully');
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn('No config file found, creating with defaults');
        await this.saveConfig();
      } else {
        logger.error('Error loading config:', error);
        throw error;
      }
    }
  }

  async saveConfig() {
    try {
      const configObject = {};
      for (const [key, value] of this.config.entries()) {
        configObject[key] = value;
      }
      
      await fs.writeFile(
        this.configPath,
        JSON.stringify(configObject, null, 2),
        'utf8'
      );
      
      this.isDirty = false;
      logger.info('Configuration saved successfully');
    } catch (error) {
      logger.error('Error saving config:', error);
      throw error;
    }
  }

  async autoSave() {
    if (this.isDirty) {
      try {
        await this.saveConfig();
      } catch (error) {
        logger.error('Error during auto-save:', error);
      }
    }
  }

  registerDefaultValidators() {
    // Register common validators
    this.registerValidator('twitch.clientId', value => {
      return typeof value === 'string' && value.length > 0;
    });
    
    this.registerValidator('twitch.clientSecret', value => {
      return typeof value === 'string' && value.length > 0;
    });
    
    this.registerValidator('claude.apiKey', value => {
      return typeof value === 'string' && value.startsWith('sk-');
    });
    
    this.registerValidator('database.path', value => {
      return typeof value === 'string' && value.endsWith('.db');
    });
  }

  registerValidator(key, validator) {
    this.validators.set(key, validator);
  }

  setDefault(key, value) {
    this.defaults.set(key, value);
    if (!this.config.has(key)) {
      this.config.set(key, value);
      this.isDirty = true;
    }
  }

  async set(key, value, save = true) {
    // Validate value if validator exists
    const validator = this.validators.get(key);
    if (validator && !validator(value)) {
      throw new Error(`Invalid value for config key: ${key}`);
    }
    
    this.config.set(key, value);
    this.isDirty = true;
    
    if (save) {
      await this.saveConfig();
    }
  }

  get(key, defaultValue = null) {
    return this.config.get(key) ?? this.defaults.get(key) ?? defaultValue;
  }

  has(key) {
    return this.config.has(key) || this.defaults.has(key);
  }

  delete(key) {
    const deleted = this.config.delete(key);
    if (deleted) {
      this.isDirty = true;
    }
    return deleted;
  }

  getAll() {
    return Object.fromEntries(this.config);
  }

  async validate() {
    const errors = [];
    
    for (const [key, value] of this.config.entries()) {
      const validator = this.validators.get(key);
      if (validator && !validator(value)) {
        errors.push(`Invalid value for key: ${key}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export function setupConfigManager() {
  return new ConfigManager();
}
