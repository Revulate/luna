import { Service, ServiceConfig, ServiceContainer } from '../types/services';
import { ChatMessage } from '../types/chat';
import { ServiceError, ErrorCode } from '../types/errors';

interface MessageLoggerConfig extends ServiceConfig {
    retention: {
        enabled: boolean;
        days: number;
    };
    database: {
        table: string;
        maxBatchSize: number;
    };
    cache: {
        enabled: boolean;
        size: number;
        ttl: number;
    };
}

interface MessageLogEntry {
    id?: number;
    channel: string;
    userId: string;
    userName: string;
    message: string;
    timestamp: Date;
    type: 'message' | 'action' | 'reply';
    replyTo?: {
        userId: string;
        userName: string;
        message: string;
    };
    deleted?: boolean;
    metadata?: Record<string, any>;
}

export class MessageLoggerService implements Service {
    public readonly config: MessageLoggerConfig;
    public readonly services: ServiceContainer;
    private messageQueue: MessageLogEntry[] = [];
    private flushInterval?: NodeJS.Timeout;

    constructor(config: MessageLoggerConfig, services: ServiceContainer) {
        this.config = config;
        this.services = services;
    }

    async initialize(): Promise<void> {
        try {
            await this.setupDatabase();
            this.startFlushInterval();
            this.services.logger.info('MessageLogger initialized');
        } catch (error) {
            this.services.logger.error('Failed to initialize MessageLogger', { error });
            throw error;
        }
    }

    async cleanup(): Promise<void> {
        try {
            if (this.flushInterval) {
                clearInterval(this.flushInterval);
            }
            await this.flushMessages();
            this.services.logger.info('MessageLogger cleaned up');
        } catch (error) {
            this.services.logger.error('Error during MessageLogger cleanup', { error });
            throw error;
        }
    }

    handleError(error: Error, code: ErrorCode = 'INTERNAL_ERROR'): ServiceError {
        const serviceError: ServiceError = {
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
        return serviceError;
    }

    async logMessage(message: ChatMessage): Promise<void> {
        try {
            const entry = this.createMessageEntry(message);
            this.messageQueue.push(entry);
            
            if (this.messageQueue.length >= this.config.database.maxBatchSize) {
                await this.flushMessages();
            }
        } catch (error) {
            this.services.logger.error('Error logging message', { error });
            throw this.handleError(error as Error);
        }
    }

    private createMessageEntry(message: ChatMessage): MessageLogEntry {
        return {
            channel: message.channel,
            userId: message.userInfo.id,
            userName: message.userInfo.userName,
            message: message.messageText,
            timestamp: new Date(),
            type: message.isAction ? 'action' : 'message',
            replyTo: message.replyParentMessage ? {
                userId: message.replyParentMessage.userInfo.id,
                userName: message.replyParentMessage.userInfo.userName,
                message: message.replyParentMessage.messageText
            } : undefined,
            metadata: {
                badges: Array.from(message.userInfo.badges.entries()),
                emotes: message.emoteOffsets,
                id: message.id,
                color: message.userInfo.color
            }
        };
    }

    private async setupDatabase(): Promise<void> {
        // Implementation details...
    }

    private startFlushInterval(): void {
        this.flushInterval = setInterval(() => {
            this.flushMessages().catch(error => {
                this.services.logger.error('Error flushing messages', { error });
            });
        }, 5000);
    }

    private async flushMessages(): Promise<void> {
        if (!this.messageQueue.length) return;

        try {
            const messages = [...this.messageQueue];
            this.messageQueue = [];

            await this.services.database.query(
                'INSERT INTO message_logs (channel, user_id, user_name, message, timestamp, type, metadata) VALUES ?',
                [messages.map(m => [m.channel, m.userId, m.userName, m.message, m.timestamp, m.type, JSON.stringify(m.metadata)])]
            );
        } catch (error) {
            this.services.logger.error('Error flushing messages to database', { error });
            // Put messages back in queue
            this.messageQueue.unshift(...this.messageQueue);
            throw this.handleError(error as Error);
        }
    }
}
