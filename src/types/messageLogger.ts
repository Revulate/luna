import { ServiceConfig } from './base';
import { ChatMessage } from './chat';

export interface MessageLoggerConfig extends ServiceConfig {
    batchSize: number;
    flushInterval: number;
    maxQueueSize: number;
    retention: {
        enabled: boolean;
        days: number;
    };
}

export interface MessageMetrics {
    totalMessages: number;
    messagesPerSecond: number;
    uniqueUsers: number;
    channels: Set<string>;
    queueSize: number;
    lastFlush: Date;
}
