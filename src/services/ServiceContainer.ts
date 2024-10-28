import { 
    ServiceContainer as IServiceContainer,
    Service,
    LoggerService,
    DatabaseService,
    ChatService,
    ConfigService,
    TwitchService
} from '../types/services.js';
import { ServiceError, ErrorCode } from '../types/errors.js';

// Create error helper
function createServiceError(code: ErrorCode, message: string): ServiceError {
    return new ServiceError(code, message);
}

export class ServiceContainer implements IServiceContainer {
    private services: Map<string, Service> = new Map();
    private _logger?: LoggerService;
    
    public addService(name: string, service: Service): void {
        this.services.set(name, service);
        
        // Special handling for logger service
        if (name === 'logging') {
            this._logger = service as LoggerService;
        }
    }

    public getService<T extends Service>(name: string): T | undefined {
        return this.services.get(name) as T | undefined;
    }

    public get<T extends Service>(name: string): T | undefined {
        return this.getService<T>(name);
    }

    // Use private field for logger
    public get logger(): LoggerService {
        if (!this._logger) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Logger service not initialized'
            );
        }
        return this._logger;
    }

    public get database(): DatabaseService {
        const service = this.getService<DatabaseService>('database');
        if (!service) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Database service not initialized'
            );
        }
        return service;
    }

    public get chat(): ChatService {
        const service = this.getService<ChatService>('chat');
        if (!service) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Chat service not initialized'
            );
        }
        return service;
    }

    public get twitch(): TwitchService {
        const service = this.getService<TwitchService>('twitch');
        if (!service) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Twitch service not initialized'
            );
        }
        return service;
    }

    public get config(): ConfigService {
        const service = this.getService<ConfigService>('config');
        if (!service) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Config service not initialized'
            );
        }
        return service;
    }

    public async initialize(): Promise<void> {
        // Initialize in correct order
        const initOrder = [
            'logging',    // First, always
            'config',     // Then config
            'database',   // Then database
            'twitch',     // Then Twitch API
            'chat',       // Then chat
            'command',    // Then commands
            'monitor'     // Finally, monitoring
        ];

        for (const serviceName of initOrder) {
            const service = this.services.get(serviceName);
            if (service) {
                try {
                    await service.initialize();
                    this.logger?.info(`Service ${serviceName} initialized successfully`);
                } catch (error) {
                    this.logger?.error(`Failed to initialize ${serviceName} service:`, {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                    throw error;
                }
            }
        }
    }

    public has(name: string): boolean {
        return this.services.has(name);
    }

    public getAllServices(): Map<string, Service> {
        return this.services;
    }
}
