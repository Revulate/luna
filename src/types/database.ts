import { ServiceConfig } from './base';
import { ConversationThread, ThreadMessage } from './ai';

export interface DatabaseConfig extends ServiceConfig {
    filename: string;
    name: string;
    options: {
        verbose: boolean;
        timeout?: number;
        fileMustExist?: boolean;
    };
    cache: {
        defaultTTL: number;
        checkPeriod: number;
        maxKeys: number;
    };
    maintenance: {
        enabled: boolean;
        interval: number;
        messageRetention: number;
    };
}

export interface DatabaseQuery {
    sql: string;
    params?: any[];
}

export interface DatabaseResult<T = any> {
    rows: T[];
    rowCount: number;
    lastInsertId?: number;
}

export interface MessageData {
    id?: number;
    channel: string;
    userId: string;
    username: string;
    message: string;
    timestamp: number;
    metadata?: Record<string, any>;
}

export interface AfkStatus {
    status: string;
    timestamp: number;
    channel: string;
}

export interface ChannelStats {
    messageCount: number;
    uniqueUsers: number;
    emoteStats?: Map<string, number>;
    commandStats?: Map<string, number>;
}

export interface CacheStats {
    keys: number;
    hits: number;
    misses: number;
    size: number;
}

export interface GameData {
    name: string;
    time_played: number;
    last_played: string;
    metadata?: {
        source: string;
        scraped_at: number;
        last_update_type: string;
        channel: string;
    };
}

export interface CommandLog {
    command: string;
    user: string;
    target?: string;
    value?: any;
    response?: string;
    timestamp?: number;
}

export interface ChannelPreview {
    userId: string;
    title: string;
    game: string;
    isLive: boolean;
    viewers: number;
    timestamp: string;
}
