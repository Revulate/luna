import type { ChatUser, ChatMessage } from '@twurple/chat';
import type { ApiClient } from '@twurple/api';
import type { BaseConfig } from './base';
import { ErrorCode } from './errors';
import { ChatClient } from '@twurple/chat';
import { ExtendedChatClient } from './chat';

// Re-export base types
export * from './base';

// Core service interfaces
export interface Service {
    initialize(): Promise<boolean>;
    cleanup(): Promise<void>;
    isHealthy(): boolean;
    getMetrics(): ServiceMetrics;
}

// Service configuration
export interface ServiceConfig {
    name: string;
    enabled: boolean;
}

// Service metrics
export interface ServiceMetrics {
    uptime: number;
    memory: {
        used: number;
        total: number;
    };
    errors: ServiceError[];
    isHealthy: boolean;
}

// Service error
export interface ServiceError {
    name: string;
    message: string;
    stack?: string;
    code: ErrorCode;
    timestamp: Date;
}

// Service health
export interface HealthMetrics {
    isHealthy: boolean;
    lastCheck: Date;
    errors: Error[];
    metrics: ServiceMetrics;
}

// Service methods
export interface ServiceMethods {
    logger: LoggerMethods;
    database: DatabaseMethods;
    chat: ChatMethods;
    config: ConfigMethods;
    ai?: AIMethods;
    sevenTv?: SevenTvMethods;
}

// Logger methods
export interface LoggerMethods {
    error(message: string, metadata?: Record<string, any>): void;
    warn(message: string, metadata?: Record<string, any>): void;
    info(message: string, metadata?: Record<string, any>): void;
    debug(message: string, metadata?: Record<string, any>): void;
    isHealthy(): boolean;
}

// Database methods
export interface DatabaseMethods {
    query<T>(sql: string, params?: any[]): Promise<T>;
    getCache(key: string): Promise<any>;
    setCache(key: string, value: any, ttl?: number): Promise<void>;
    isHealthy(): boolean;
}

// Chat methods
export interface ChatMethods {
    client: ExtendedChatClient;
    apiClient: ApiClient;
    sendMessage(channel: string, message: string): Promise<void>;
    isConnected(): boolean;
}

// Config methods
export interface ConfigMethods {
    get<T>(path: string): T;
    isHealthy(): boolean;
}

// AI methods
export interface AIMethods {
    generateResponse(prompt: string, context: any): Promise<string>;
}

// SevenTV methods
export interface SevenTvMethods {
    getChannelEmotes(channelId: string): Promise<any[]>;
    getUserDetailsById(userId: string): Promise<any>;
    getEmotesByQuery(query: string, sort?: string): Promise<any[]>;
}

// Service container
export interface ServiceContainer extends ServiceMethods {
    get<T extends Service>(name: string): T;
    getAll(): Service[];
    isHealthy(): boolean;
}

// Command context
export interface CommandContext {
    services: ServiceContainer;
    channel: string;
    user: ChatUser;
    message: string;
    args: string[];
    command: string;
    msg: ChatMessage;
    say(message: string): Promise<void>;
    reply(message: string): Promise<void>;
}

// Twitch user info
export interface TwitchUserInfo {
    id: string;
    userName: string;
    displayName: string;
    color?: string;
    badges: Map<string, string>;
    isBroadcaster: boolean;
    isMod: boolean;
    isVip: boolean;
    isSubscriber: boolean;
}

// Health check interfaces
export interface HealthCheck {
    isHealthy: boolean;
    lastCheck: Date;
    details?: Record<string, any>;
}

// Service lifecycle interfaces
export interface Initializable {
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
}

export interface ServiceState {
    initialized: boolean;
    running: boolean;
    healthy: boolean;
    lastError?: Error;
}

// Service dependency interfaces
export interface ServiceDependency {
    name: string;
    required: boolean;
    version?: string;
}

// Service error interfaces
export interface ServiceErrorMetadata {
    service?: string;
    code: ErrorCode;
    details?: Record<string, any>;
    timestamp: Date;
}

export interface ServiceErrorHandler {
    handleError(error: Error, metadata?: ServiceErrorMetadata): void;
}

// Service configuration interfaces
export interface ConfigWatcher {
    watch(path: string, callback: (newValue: any) => void): void;
    unwatch(path: string): void;
}

export interface ConfigValidator {
    validate(config: Record<string, any>): boolean;
    getErrors(): string[];
}

export interface BaseService {
    config: ServiceConfig;
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    handleError(error: Error, code?: ErrorCode): ServiceError;
}

export interface CommandMetadata {
    name: string;
    description: string;
    usage: string;
    enabled: boolean;
    hidden: boolean;
    cooldown: number;
    permissions: string[];
    category: string;
    aliases: string[];
}
