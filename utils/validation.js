import logger from './logger.js';

class ValidationHandler {
  constructor() {
    logger.startOperation('Initializing ValidationHandler');
    this.validators = new Map();
    this.schemas = new Map();
    this.customRules = new Map();
    
    // Register default validators
    this.registerDefaultValidators();
    logger.debug('Default validators registered');
  }

  registerDefaultValidators() {
    // Common validators
    this.registerValidator('string', value => typeof value === 'string');
    this.registerValidator('number', value => typeof value === 'number' && !isNaN(value));
    this.registerValidator('boolean', value => typeof value === 'boolean');
    this.registerValidator('array', value => Array.isArray(value));
    this.registerValidator('object', value => typeof value === 'object' && value !== null && !Array.isArray(value));
    
    // Common formats
    this.registerValidator('email', value => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return typeof value === 'string' && emailRegex.test(value);
    });
    
    this.registerValidator('url', value => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    });

    // Twitch-specific validators
    this.registerValidator('twitchUsername', value => {
      return typeof value === 'string' && /^[a-zA-Z0-9_]{4,25}$/.test(value);
    });

    this.registerValidator('channelName', value => {
      return typeof value === 'string' && /^#?[a-zA-Z0-9_]{4,25}$/.test(value);
    });

    // Add Twitch-specific validators
    this.registerValidator('twitchUserId', value => {
      return typeof value === 'string' && /^\d+$/.test(value);
    });

    this.registerValidator('twitchOAuth', value => {
      return typeof value === 'string' && value.startsWith('oauth:');
    });

    this.registerValidator('twitchEmote', value => {
      return typeof value === 'string' && /^[a-zA-Z0-9_]{1,25}$/.test(value);
    });

    this.registerValidator('twitchMessage', value => {
      return typeof value === 'string' && value.length <= 500;
    });
  }

  registerValidator(name, validator) {
    this.validators.set(name, validator);
  }

  registerSchema(name, schema) {
    this.schemas.set(name, schema);
  }

  registerCustomRule(name, rule) {
    this.customRules.set(name, rule);
  }

  validate(value, schema) {
    try {
      logger.debug('Starting validation', { 
        schemaType: typeof schema,
        valueType: typeof value 
      });

      if (typeof schema === 'string') {
        const validator = this.validators.get(schema);
        if (!validator) {
          logger.warn(`Unknown validator: ${schema}`);
          throw new Error(`Unknown validator: ${schema}`);
        }
        const result = validator(value);
        logger.debug('Validation result', { schema, result });
        return result;
      }

      if (Array.isArray(schema)) {
        // Array schema - validate each element
        if (!Array.isArray(value)) return false;
        return value.every(item => this.validate(item, schema[0]));
      }

      if (typeof schema === 'object') {
        if (!value || typeof value !== 'object') return false;

        // Check required fields
        if (schema.required) {
          const missingRequired = schema.required.filter(field => !(field in value));
          if (missingRequired.length > 0) {
            return false;
          }
        }

        // Validate each field
        for (const [field, fieldSchema] of Object.entries(schema.properties || {})) {
          if (field in value) {
            const isValid = this.validate(value[field], fieldSchema);
            if (!isValid) return false;
          }
        }

        return true;
      }

      return true;
    } catch (error) {
      logger.error('Validation error:', { error, schema });
      return false;
    }
  }

  validateObject(obj, schemaName) {
    const schema = this.schemas.get(schemaName);
    if (!schema) {
      throw new Error(`Unknown schema: ${schemaName}`);
    }
    return this.validate(obj, schema);
  }

  validateField(value, rules) {
    const errors = [];

    for (const rule of rules) {
      if (typeof rule === 'string') {
        const validator = this.validators.get(rule);
        if (validator && !validator(value)) {
          errors.push(`Failed ${rule} validation`);
        }
        continue;
      }

      if (typeof rule === 'object') {
        if (rule.type && !this.validate(value, rule.type)) {
          errors.push(`Invalid type: expected ${rule.type}`);
        }
        if (rule.min !== undefined && value < rule.min) {
          errors.push(`Value must be at least ${rule.min}`);
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push(`Value must be at most ${rule.max}`);
        }
        if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
          errors.push(`Value must match pattern: ${rule.pattern}`);
        }
        if (rule.custom) {
          const customRule = this.customRules.get(rule.custom);
          if (customRule && !customRule(value)) {
            errors.push(`Failed custom validation: ${rule.custom}`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  sanitize(value, type) {
    switch (type) {
      case 'string':
        return String(value).trim();
      case 'number':
        return Number(value);
      case 'boolean':
        return Boolean(value);
      case 'array':
        return Array.isArray(value) ? value : [value];
      case 'channelName':
        return String(value).toLowerCase().replace(/^#/, '');
      default:
        return value;
    }
  }
}

export function setupValidation() {
  return new ValidationHandler();
}
