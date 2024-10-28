import { Service, ServiceConfig, ServiceContainer } from '../types/services';
import { ServiceError, ErrorCode } from '../types/errors';
import { EventEmitter } from 'events';
import { ChatClient } from '@twurple/chat';
import { ApiClient } from '@twurple/api';

interface StreamState {
    channel: string;
    isLive: boolean;
    viewers?: number;
    game?: string;
    title?: string;
    startTime?: Date;
    tags?: string[];
}

interface StreamMonitor {
    channel: string;
    state: StreamState;
    interval: NodeJS.Timeout;
    lastCheck: Date;
}

export class EventService implements Service {
    public readonly config: ServiceConfig;
    public readonly services: ServiceContainer;
    private emitter: EventEmitter;
    private queue: any[];
    private processing: boolean;
    private channels: Set<string>;
    private handlers: Map<string, Function[]>;
    private monitors: Map<string, StreamMonitor>;
    private chatClient: ChatClient;
    private apiClient: ApiClient;

    constructor(config: ServiceConfig, services: ServiceContainer) {
        this.config = config;
        this.services = services;
        this.emitter = new EventEmitter();
        this.queue = [];
        this.processing = false;
        this.channels = new Set();
        this.handlers = new Map();
        this.monitors = new Map();
    }

    private async initializeChannels(): Promise<void> {
        try {
            // Get channels from config
            const configChannels = this.config.channels || [];
            
            // Add channels to set
            for (const channel of configChannels) {
                this.channels.add(channel.toLowerCase());
            }

            // Join channels in chat client
            for (const channel of this.channels) {
                await this.services.chat.client.join(channel);
                this.services.logger.info(`Joined channel: ${channel}`);
            }
        } catch (error) {
            this.services.logger.error('Error initializing channels', { error });
            throw this.handleError(error as Error);
        }
    }

    private async initializeStreamMonitors(): Promise<void> {
        try {
            // Only initialize if monitoring is enabled
            if (!this.config.monitoring?.enabled) {
                return;
            }

            // Create monitors for each channel
            for (const channel of this.channels) {
                const monitor = {
                    channel,
                    state: {
                        channel,
                        isLive: false
                    },
                    interval: setInterval(
                        () => this.checkStreamState(channel),
                        this.config.monitoring.interval || 60000
                    ),
                    lastCheck: new Date()
                };
                this.monitors.set(channel, monitor);
            }

            // Do initial state check
            for (const channel of this.channels) {
                await this.checkStreamState(channel);
            }
        } catch (error) {
            this.services.logger.error('Error initializing stream monitors', { error });
            throw this.handleError(error as Error);
        }
    }

    private async checkStreamState(channel: string): Promise<void> {
        try {
            const monitor = this.monitors.get(channel);
            if (!monitor) return;

            // Get current stream info
            const stream = await this.services.chat.apiClient.streams.getStreamByUserName(channel);
            
            // Update state
            const newState: StreamState = {
                channel,
                isLive: !!stream,
                viewers: stream?.viewers,
                game: stream?.gameName,
                title: stream?.title,
                startTime: stream?.startDate,
                tags: stream?.tags
            };

            // Check for state changes
            const wasLive = monitor.state.isLive;
            if (wasLive !== newState.isLive) {
                this.emitter.emit('streamStateChange', {
                    channel,
                    isLive: newState.isLive,
                    previous: monitor.state,
                    current: newState
                });
            }

            // Update monitor
            monitor.state = newState;
            monitor.lastCheck = new Date();
        } catch (error) {
            this.services.logger.error('Error checking stream state', {
                error,
                channel
            });
        }
    }

    async initialize(): Promise<void> {
        try {
            this.services.logger.debug('Starting EventService initialization');
            
            await this.initializeChannels();
            await this.initializeStreamMonitors();

            this.services.logger.info('Event service initialized successfully', {
                context: 'events',
                channels: Array.from(this.channels),
                handlers: Array.from(this.handlers.keys())
            });
        } catch (error) {
            const serviceError: ServiceError = {
                name: error.name,
                message: error.message,
                code: 'INTERNAL_ERROR',
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
            throw serviceError;
        }
    }

    async cleanup(): Promise<void> {
        try {
            // Cleanup implementation
            this.services.logger.info('Event service cleaned up');
        } catch (error) {
            this.services.logger.error('Error during cleanup', { error });
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

    // Rest of the implementation...
    // Update event handlers to use proper types from @twurple/chat
}
