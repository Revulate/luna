import { Service, ServiceConfig, ServiceContainer } from '../types/services';
import { ServiceError, ErrorCode } from '../types/errors';
import fetch from 'node-fetch';
import WebSocket from 'ws';

interface SevenTvConfig extends ServiceConfig {
    apiUrl: string;
    cacheTimeout: number;
    maxRetries: number;
    retryDelay: number;
    rateLimit: {
        requests: number;
        window: number;
    };
    websocket: {
        enabled: boolean;
        reconnect: boolean;
        maxReconnectAttempts: number;
    };
}

interface EmoteCache {
    emotes: any[];
    timestamp: number;
}

interface RateLimit {
    requests: number;
    resetTime: number;
}

interface EmoteSet {
    id: string;
    name: string;
    flags: number;
    tags: string[];
    emotes: Emote[];
    owner: User;
    capacity: number;
}

interface Emote {
    id: string;
    name: string;
    flags: number;
    timestamp: number;
    actor?: User;
    owner?: User;
    host: {
        url: string;
        files: EmoteFile[];
    };
}

interface EmoteFile {
    name: string;
    static_name: string;
    width: number;
    height: number;
    frame_count: number;
    size: number;
    format: string;
}

interface User {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string;
    roles: string[];
}

export class SevenTvService implements Service {
    public readonly config: SevenTvConfig;
    public readonly services: ServiceContainer;
    private readonly emoteCache: Map<string, EmoteCache> = new Map();
    private readonly rateLimits: Map<string, RateLimit> = new Map();
    private readonly API_BASE_URL: string;
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private reconnectTimeout?: NodeJS.Timeout;
    private eventSubscriptions = new Map<string, Set<(data: any) => void>>();

    constructor(config: SevenTvConfig, services: ServiceContainer) {
        this.config = config;
        this.services = services;
        this.API_BASE_URL = config.apiUrl || 'https://7tv.io/v3';
    }

    async initialize(): Promise<void> {
        try {
            await this.testConnection();
            
            if (this.config.websocket.enabled) {
                await this.initializeWebSocket();
            }

            this.services.logger.info('7TV service initialized successfully', {
                context: '7tv',
                apiUrl: this.API_BASE_URL
            });
        } catch (error) {
            const serviceError: ServiceError = {
                name: error.name,
                message: 'Failed to initialize 7TV service',
                code: 'SERVICE_UNAVAILABLE',
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
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.emoteCache.clear();
        this.rateLimits.clear();
        this.eventSubscriptions.clear();
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

    // Rest of implementation...
    // Update API response handling to properly type cast responses
    private async fetchEmotes(url: string): Promise<Emote[]> {
        const response = await fetch(url);
        if (!response.ok) {
            throw this.handleError(new Error(`HTTP error! status: ${response.status}`));
        }
        const data = await response.json() as Emote[];
        return data;
    }

    private async fetchEmoteSet(url: string): Promise<EmoteSet> {
        const response = await fetch(url);
        if (!response.ok) {
            throw this.handleError(new Error(`HTTP error! status: ${response.status}`));
        }
        const data = await response.json() as EmoteSet;
        return data;
    }

    private async testConnection(): Promise<void> {
        try {
            const response = await fetch(`${this.API_BASE_URL}/health`);
            if (!response.ok) {
                throw new Error(`7TV API health check failed with status: ${response.status}`);
            }
        } catch (error) {
            throw this.handleError(error, 'SERVICE_UNAVAILABLE');
        }
    }

    private async initializeWebSocket(): Promise<void> {
        try {
            // Close existing connection if any
            if (this.ws) {
                this.ws.close();
            }

            this.ws = new WebSocket('wss://events.7tv.io/v3');

            this.ws.on('open', () => {
                this.reconnectAttempts = 0;
                this.services.logger.info('7TV WebSocket connected', { context: '7tv' });
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString());
                    // Dispatch message to subscribers
                    const subscribers = this.eventSubscriptions.get(message.type);
                    if (subscribers) {
                        subscribers.forEach(callback => callback(message.data));
                    }
                } catch (error) {
                    this.services.logger.error('Failed to parse 7TV WebSocket message', {
                        context: '7tv',
                        error
                    });
                }
            });

            this.ws.on('close', () => {
                this.services.logger.warn('7TV WebSocket connection closed', { context: '7tv' });
                if (this.config.websocket.reconnect) {
                    this.handleReconnect();
                }
            });

            this.ws.on('error', (error) => {
                this.services.logger.error('7TV WebSocket error', {
                    context: '7tv',
                    error
                });
            });
        } catch (error) {
            throw this.handleError(error, 'SERVICE_UNAVAILABLE');
        }
    }

    private handleReconnect(): void {
        if (this.reconnectAttempts >= this.config.websocket.maxReconnectAttempts) {
            this.services.logger.error('Max reconnection attempts reached for 7TV WebSocket', {
                context: '7tv'
            });
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

        this.services.logger.info('Attempting to reconnect to 7TV WebSocket', {
            context: '7tv',
            attempt: this.reconnectAttempts,
            delay
        });

        this.reconnectTimeout = setTimeout(() => {
            this.initializeWebSocket().catch(error => {
                this.services.logger.error('Failed to reconnect to 7TV WebSocket', {
                    context: '7tv',
                    error
                });
            });
        }, delay);
    }
}
