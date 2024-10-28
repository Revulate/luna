import type { ChatUser } from '@twurple/chat';
import type { ServiceConfig } from './interfaces';

// Shared interfaces used across multiple files
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

export interface ConversationThread {
    id: number;
    channel: string;
    userId: string;
    createdAt: Date;
    lastMessageAt: Date | null;
    metadata?: Record<string, any>;
}

export interface ChannelEmotes {
    twitch: string[];
    sevenTv: string[];
}

// Convert ChatUser to our TwitchUserInfo type
export function convertChatUser(user: ChatUser): TwitchUserInfo {
    return {
        id: user.userId,
        userName: user.userName,
        displayName: user.displayName,
        color: user.color,
        badges: user.badges,
        isBroadcaster: user.isBroadcaster,
        isMod: user.isMod,
        isVip: user.isVip,
        isSubscriber: user.isSubscriber
    };
}

// Service configuration types
export interface ServiceOptions {
    config: ServiceConfig;
    debug?: boolean;
    enabled?: boolean;
}

export interface CacheOptions {
    ttl?: number;
    checkPeriod?: number;
    maxKeys?: number;
}

export interface ServiceMetrics {
    uptime: number;
    memory: {
        used: number;
        total: number;
    };
    errors: ServiceError[];
    isHealthy: boolean;
}

export interface ServiceError {
    name: string;
    message: string;
    stack?: string;
    code: string;
    timestamp: Date;
}

// Base service types
export interface BaseConfig {
    enabled: boolean;
    debug?: boolean;
    [key: string]: any;
}

export interface HealthMetrics {
    isHealthy: boolean;
    lastCheck: Date;
    errors: Error[];
    metrics: Record<string, any>;
}

export interface Service {
    initialize(): Promise<boolean>;
    cleanup(): Promise<void>;
    isHealthy(): boolean;
    getMetrics(): ServiceMetrics;
}
