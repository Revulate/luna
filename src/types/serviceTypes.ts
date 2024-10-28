import type { ChatClient } from '@twurple/chat';
import type { ApiClient } from '@twurple/api';
import type { 
    Service,
    ServiceConfig, 
    ServiceMetrics
} from './services';

// Core service methods that don't depend on other services
export interface ServiceMethods {
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    isHealthy(): boolean;
    getMetrics(): ServiceMetrics;
}

// Database service methods
export interface DatabaseMethods {
    query<T>(sql: string, params?: any[]): Promise<T>;
    getCache(key: string): Promise<any>;
    setCache(key: string, value: any, ttl?: number): Promise<void>;
    isHealthy(): boolean;
}

// Logger methods
export interface LoggerMethods {
    error(message: string, metadata?: Record<string, any>): void;
    warn(message: string, metadata?: Record<string, any>): void;
    info(message: string, metadata?: Record<string, any>): void;
    debug(message: string, metadata?: Record<string, any>): void;
}

// Chat methods
export interface ChatMethods {
    client: ChatClient & {
        timeout(channel: string, username: string, duration: number, reason?: string): Promise<void>;
        ban(channel: string, username: string, reason?: string): Promise<void>;
        unban(channel: string, username: string): Promise<void>;
        clear(channel: string): Promise<void>;
        announce(channel: string, message: string): Promise<void>;
        isModerator(channel: string, username: string): boolean;
        latency: number;
    };
    apiClient: ApiClient;
    sendMessage(channel: string, message: string): Promise<void>;
    isConnected(): boolean;
}

// Config methods
export interface ConfigMethods {
    get<T>(path: string): T;
    isHealthy(): boolean;
}

// Service registry
export interface ServiceRegistry {
    register(name: string, service: Service): void;
    get<T extends Service>(name: string): T;
    has(name: string): boolean;
    getAll(): Service[];
}
