import { 
    Service,
    ServiceConfig,
    ServiceContainer,
    LoggerService,
    DatabaseService as IDBService,
    ChatService as IChatService
} from '../types/services';

import { ServiceError, ErrorCode } from '../types/errors';

// Import actual service implementations
import { DatabaseService } from './DatabaseService';
import { ChatService } from './ChatService';
import { AIService } from './AIService';
import { SevenTvService } from './SevenTvService';
import { WebPanelService } from './WebPanelService';
import { CommandRegistry } from './CommandRegistry';
import { LoggingService } from './LoggingService';
import { ConfigService } from './ConfigService';
import { EventService } from './EventService';
import { ServiceMonitor } from './ServiceMonitor';
import { MessageLoggerService } from './MessageLoggerService';
import { WeatherService } from './WeatherService';
import { SteamService } from './SteamService';
import { DVPService } from './DVPService';

// Extend ErrorCode type instead of redefining
declare module '../types/errors' {
    interface ErrorCodeMap {
        SERVICE_ALREADY_EXISTS: 'SERVICE_ALREADY_EXISTS';
        SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND';
        SERVICE_INIT_FAILED: 'SERVICE_INIT_FAILED';
    }
}

interface ServiceDefinition<T extends Service = Service> {
    name: string;
    serviceClass: new (config: ServiceConfig, services: ServiceContainer) => T;
    dependencies: string[];
    config: ServiceConfig;
}

export class ServiceFactory {
    private definitions: Map<string, ServiceDefinition> = new Map();
    private services: Map<string, Service> = new Map();
    private created: Set<string> = new Set();

    constructor() {
        this.registerCoreServices();
    }

    private registerCoreServices(): void {
        // Register core services with their implementations
        this.register<IDBService>({
            name: 'database',
            serviceClass: DatabaseService as unknown as new (config: ServiceConfig, services: ServiceContainer) => IDBService,
            dependencies: ['logger', 'config'],
            config: {
                name: 'database',
                enabled: true,
                // ... other config
            }
        });

        this.register<IChatService>({
            name: 'chat',
            serviceClass: ChatService as unknown as new (config: ServiceConfig, services: ServiceContainer) => IChatService,
            dependencies: ['logger', 'config', 'database', 'events'],
            config: {
                name: 'chat',
                enabled: true,
                // ... other config
            }
        });

        // Register other services similarly...
    }

    public register<T extends Service>(definition: ServiceDefinition<T>): void {
        if (this.definitions.has(definition.name)) {
            throw this.handleError(
                new Error(`Service already registered: ${definition.name}`),
                'INTERNAL_ERROR'
            );
        }

        this.definitions.set(definition.name, definition);

        for (const dep of definition.dependencies) {
            if (!this.definitions.has(dep) && dep !== 'logger') {
                throw this.handleError(
                    new Error(`Missing dependency: ${dep} required by ${definition.name}`),
                    'NOT_FOUND'
                );
            }
        }
    }

    public async createServices(): Promise<ServiceContainer> {
        const services = new Map<string, Service>();
        const creating = new Set<string>();
        const created = new Set<string>();

        const createService = async (name: string): Promise<Service> => {
            if (services.has(name)) {
                return services.get(name)!;
            }

            // Check for circular dependencies
            if (creating.has(name)) {
                throw this.handleError(
                    new Error(`Circular dependency detected: ${Array.from(creating).join(' -> ')} -> ${name}`),
                    'INTERNAL_ERROR'
                );
            }

            const definition = this.definitions.get(name);
            if (!definition) {
                throw this.handleError(
                    new Error(`Service not found: ${name}`),
                    'NOT_FOUND'
                );
            }

            creating.add(name);

            try {
                // Create dependencies first
                const deps = definition.dependencies;
                for (const dep of deps) {
                    if (!created.has(dep)) {
                        await createService(dep);
                    }
                }

                // Create service instance
                const ServiceClass = definition.serviceClass;
                const serviceContainer = this.createServiceContainer(services);

                const service = new ServiceClass(definition.config, serviceContainer);

                // Initialize service
                await service.initialize();

                services.set(name, service);
                created.add(name);
                creating.delete(name);

                return service;
            } catch (error) {
                creating.delete(name);
                throw this.handleError(
                    error as Error,
                    'INTERNAL_ERROR'
                );
            }
        };

        // Create all services
        for (const name of this.definitions.keys()) {
            await createService(name);
        }

        return this.createServiceContainer(services);
    }

    private createServiceContainer(services: Map<string, Service>): ServiceContainer {
        return {
            logger: services.get('logger') as LoggerService,
            database: services.get('database') as IDBService,
            chat: services.get('chat') as IChatService,
            config: services.get('config') as Service,
            ...Object.fromEntries(services.entries())
        };
    }

    private handleError(error: Error, code: ErrorCode): ServiceError {
        return {
            name: error.name,
            message: error.message,
            code,
            stack: error.stack,
            timestamp: new Date(),
            toJSON() {
                return {
                    name: this.name,
                    message: this.message,
                    code: this.code,
                    timestamp: this.timestamp
                };
            }
        };
    }
}
