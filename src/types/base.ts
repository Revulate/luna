import { ErrorCode } from './errors';

// Base configuration interface
export interface BaseConfig {
    enabled: boolean;
    debug?: boolean;
    [key: string]: any;
}

// Service configuration interface
export interface ServiceConfig extends BaseConfig {
    name: string;
    version?: string;
    dependencies?: string[];
}

// Service metrics interface
export interface ServiceMetrics {
    timestamp: number;
    cpu: number;
    memory: number;
    uptime: number;
    errors: number;
    latency: number;
}

// Cache options interface
export interface CacheOptions {
    ttl?: number;
    checkPeriod?: number;
    maxKeys?: number;
}

// Service options interface
export interface ServiceOptions {
    config: ServiceConfig;
    debug?: boolean;
    enabled?: boolean;
}
