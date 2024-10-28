import { ChatClient } from '@twurple/chat';
import { ApiClient } from '@twurple/api';
import { WebSocket } from 'ws';
import { AIMessage } from './ai.js';

// Base service interfaces
export interface ServiceConfig {
    name: string;
    enabled: boolean;
}

export interface Service {
    config: ServiceConfig;
    services: ServiceContainer;
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    isHealthy(): Promise<boolean>;
}

// Service-specific config interfaces
export interface LoggingConfig extends ServiceConfig {
    level: string;
    filePath: string;
    format: 'json' | 'text';
}

export interface ConfigServiceConfig extends ServiceConfig {
    configPath: string;
    autoReload?: boolean;
    reloadInterval?: number;
}

export interface ChatConfig extends ServiceConfig {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    channels: string[];
    connection: {
        secure: boolean;
        reconnect: boolean;
        maxReconnectAttempts: number;
        maxReconnectInterval: number;
    };
}

// Service-specific interfaces
export interface ChatService extends Service {
    config: ChatConfig;
    client: ChatClient;
    apiClient: ApiClient;
    isConnected(): boolean;
}

export interface ServiceContainer {
    logger: LoggerService;
    database: DatabaseService;
    chat: ChatService;
    config: ConfigService;
    twitch: TwitchService;
    getService<T extends Service>(name: string): T | undefined;
    addService(name: string, service: Service): void;
    initialize(): Promise<void>;
    has(name: string): boolean;
    getAllServices(): Map<string, Service>;
}

export interface LoggerService extends Service {
    error(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    info(message: string, meta?: any): void;
    debug(message: string, meta?: any): void;
}

export interface DatabaseConfig extends ServiceConfig {
    filename: string;
    options: {
        verbose?: boolean;
    };
    cache: {
        defaultTTL: number;
        checkPeriod: number;
        maxKeys: number;
        useClones?: boolean;
    };
    maintenance: {
        enabled: boolean;
        interval: number;
        messageRetention: number;
    };
}

export interface AIConfig extends ServiceConfig {
    provider: string;
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
}

export interface WebPanelConfig extends ServiceConfig {
    port: number;
    host: string;
    cors: {
        origin: string | string[];
        credentials: boolean;
    };
    rateLimit: {
        windowMs: number;
        max: number;
    };
}

export interface ConfigServiceConfig extends ServiceConfig {
    configPath: string;
    autoReload?: boolean;
    reloadInterval?: number;
}

export interface ConfigService extends Service {
    get<T>(key: string, defaultValue?: T): T;
    set(key: string, value: any): void;
}

export interface DatabaseService extends Service {
    query<T>(sql: string, params?: any[]): Promise<T>;
    getCache(key: string): Promise<any>;
    setCache(key: string, value: any, ttl?: number): Promise<void>;
}

export interface AIService extends Service {
    generateResponse(context: AIContext): Promise<string>;
}

export interface WebPanelService extends Service {
    broadcast(event: string, data: any): void;
    getConnectedClients(): number;
}

export interface SevenTvService extends Service {
    getEmotes(channel: string): Promise<string[]>;
}

export interface MessageLoggerService extends Service {
    logMessage(channel: string, user: string, message: string): Promise<void>;
}

export interface AIContext {
    user: any;
    channel: string;
    message: string;
    maxTokens: number;
    context: AIMessage[];
    provider: string;
    systemPrompt: string;
}

export interface ServiceMetrics {
    uptime: number;
    memory: {
        used: number;
        total: number;
    };
    errors: Error[];
    isHealthy: boolean;
}

export interface TwitchService extends Service {
    getApiClient(): ApiClient;
    getChatClient(): ChatClient;
}
