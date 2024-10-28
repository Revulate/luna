import { BaseService } from './BaseService.js';
import { 
    ChatService as IChatService,
    ChatConfig,
    ServiceContainer,
    ServiceMetrics 
} from '../types/services.js';
import { ServiceError, ErrorCode } from '../types/errors.js';
import { ChatClient, ChatUser, ChatMessage } from '@twurple/chat';
import { ApiClient } from '@twurple/api';
import { TwitchService } from './TwitchService.js';
import { CommandService } from './CommandService.js';

export class ChatService extends BaseService implements IChatService {
    private _client: ChatClient | null = null;
    private _apiClient: ApiClient | null = null;
    private connected = false;

    constructor(config: ChatConfig, services: ServiceContainer) {
        super(config, services);
    }

    get client(): ChatClient {
        if (!this._client) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Chat client not initialized'
            );
        }
        return this._client;
    }

    get apiClient(): ApiClient {
        if (!this._apiClient) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'API client not initialized'
            );
        }
        return this._apiClient;
    }

    async initialize(): Promise<void> {
        try {
            const twitchService = this.services.getService('twitch') as TwitchService;
            if (!twitchService) {
                throw new ServiceError(
                    ErrorCode.SERVICE_UNAVAILABLE,
                    'Twitch service not available'
                );
            }
            
            this._apiClient = twitchService.getApiClient();
            this._client = twitchService.getChatClient();

            // Set up event handlers
            this.setupEventHandlers();

            this.services.logger.info('Chat service initialized', {
                channels: (this.config as ChatConfig).channels
            });

        } catch (error) {
            this.services.logger.error('Failed to initialize chat service', { error });
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    private setupEventHandlers(): void {
        if (!this._client) return;

        // Connection events
        this._client.onConnect(() => {
            this.connected = true;
            this.services.logger.info('Connected to Twitch chat');
        });

        this._client.onDisconnect((manually: boolean) => {
            this.connected = false;
            this.services.logger.warn('Disconnected from Twitch chat', { manually });
        });

        // Updated Message handler with better error handling
        this._client.onMessage(async (channel: string, user: string, message: string, msg: ChatMessage) => {
            try {
                // Log all messages first
                this.services.logger.debug('Chat message received:', {
                    channel,
                    user,
                    message,
                    badges: msg.userInfo.badges,
                    id: msg.id,
                    timestamp: new Date().toISOString()
                });

                // Store message in database if message logging is enabled
                if (process.env.ENABLE_MESSAGE_LOGGING === 'true') {
                    try {
                        // First, ensure user exists in database with proper error handling
                        await this.services.database.query(
                            `INSERT OR IGNORE INTO users (id, username, display_name, last_updated) 
                             VALUES (?, ?, ?, ?)`,
                            [
                                msg.userInfo.userId,
                                msg.userInfo.userName,
                                msg.userInfo.displayName || msg.userInfo.userName,
                                Date.now()
                            ]
                        );

                        // Then insert message with proper error handling
                        await this.services.database.query(
                            `INSERT INTO messages (channel, user_id, message, timestamp, metadata) 
                             VALUES (?, ?, ?, ?, ?)`,
                            [
                                channel,
                                msg.userInfo.userId,
                                message,
                                Date.now(),
                                JSON.stringify({
                                    messageId: msg.id,
                                    badges: Object.fromEntries(msg.userInfo.badges || new Map()),
                                    timestamp: new Date().toISOString()
                                })
                            ]
                        );
                    } catch (dbError) {
                        this.services.logger.error('Database error while logging message:', {
                            error: dbError instanceof Error ? dbError.message : 'Unknown error',
                            channel,
                            user,
                            messageId: msg.id,
                            sql: dbError instanceof Error ? (dbError as any).sql : undefined
                        });
                    }
                }

                // Handle commands if message starts with prefix
                const commandService = this.services.getService('command') as CommandService;
                if (commandService && typeof commandService.handleMessage === 'function') {
                    try {
                        await commandService.handleMessage(channel, msg.userInfo, message, msg);
                    } catch (cmdError) {
                        this.services.logger.error('Error executing command:', {
                            error: cmdError instanceof Error ? cmdError.message : 'Unknown error',
                            channel,
                            user,
                            message
                        });
                    }
                }
            } catch (error) {
                this.services.logger.error('Error handling message:', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    channel,
                    user,
                    message
                });
            }
        });

        // Subscription events
        this._client.onSub((channel: string, user: string) => {
            this.services.logger.info('New subscription:', { channel, user });
        });

        this._client.onResub((channel: string, user: string, subInfo: any) => {
            this.services.logger.info('Resubscription:', { channel, user, months: subInfo.months });
        });

        // Channel events
        this._client.onRaid((channel: string, user: string, raidInfo: { viewerCount: number }) => {
            this.services.logger.info('Channel raided:', { 
                channel, 
                raider: user,
                viewers: raidInfo.viewerCount 
            });
        });

        // Moderation events
        this._client.onBan((channel: string, user: string) => {
            this.services.logger.info('User banned:', { channel, user });
        });

        this._client.onTimeout((channel: string, user: string, duration: number) => {
            this.services.logger.info('User timed out:', { channel, user, duration });
        });

        // Chat mode events
        this._client.onFollowersOnly((channel: string, enabled: boolean, delay?: number) => {
            this.services.logger.info('Followers-only mode:', { channel, enabled, delay });
        });

        this._client.onEmoteOnly((channel: string, enabled: boolean) => {
            this.services.logger.info('Emote-only mode:', { channel, enabled });
        });

        this._client.onUniqueChat((channel: string, enabled: boolean) => {
            this.services.logger.info('Unique chat mode:', { channel, enabled });
        });

        this._client.onSubsOnly((channel: string, enabled: boolean) => {
            this.services.logger.info('Subscribers-only mode:', { channel, enabled });
        });
    }

    async cleanup(): Promise<void> {
        if (this._client) {
            await this._client.quit();
            this._client = null;
        }
        this._apiClient = null;
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    async isHealthy(): Promise<boolean> {
        return this.connected && !!this._client && !!this._apiClient;
    }

    // Add helper method for message logging
    private async ensureUserExists(userInfo: any): Promise<void> {
        try {
            await this.services.database.query(
                `INSERT OR IGNORE INTO users (id, username, display_name, last_updated) 
                 VALUES (?, ?, ?, ?)`,
                [userInfo.userId, userInfo.userName, userInfo.displayName, Date.now()]
            );
        } catch (error) {
            this.services.logger.error('Failed to ensure user exists:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                userId: userInfo.userId,
                userName: userInfo.userName
            });
            throw error;
        }
    }

    // Add method to validate message before logging
    private validateMessage(msg: ChatMessage): boolean {
        return !!(
            msg &&
            msg.userInfo &&
            msg.userInfo.userId &&
            msg.userInfo.userName &&
            typeof msg.userInfo.userId === 'string' &&
            typeof msg.userInfo.userName === 'string'
        );
    }
}
