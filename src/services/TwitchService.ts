import { BaseService } from './BaseService.js';
import { Service, ServiceConfig, ServiceContainer } from '../types/services.js';
import { ServiceError, ErrorCode } from '../types/errors.js';
import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider, AccessToken } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';

interface TwitchConfig extends ServiceConfig {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    channels: string[];
    botNick?: string;
    isAlwaysMod?: boolean;
    requestMembership?: boolean;
}

export class TwitchService extends BaseService {
    private apiClient: ApiClient | null = null;
    private authProvider: RefreshingAuthProvider | null = null;
    private chatClient: ChatClient | null = null;
    private userId: string | null = null;

    constructor(config: TwitchConfig, services: ServiceContainer) {
        super(config, services);
        this.validateConfig();
    }

    private validateConfig(): void {
        const config = this.config as TwitchConfig;
        
        this.services.logger.debug('Validating Twitch config:', {
            hasClientId: !!config.clientId,
            hasClientSecret: !!config.clientSecret,
            hasAccessToken: !!config.accessToken,
            hasRefreshToken: !!config.refreshToken,
            channels: config.channels
        });

        if (!config.clientId || !config.clientSecret || !config.accessToken || !config.refreshToken || !config.channels) {
            throw new ServiceError(
                ErrorCode.CONFIG_INVALID,
                'Missing required Twitch credentials or channels'
            );
        }
    }

    async initialize(): Promise<void> {
        try {
            const config = this.config as TwitchConfig;

            // Initialize auth provider
            this.services.logger.debug('Initializing auth provider...');
            this.authProvider = new RefreshingAuthProvider({
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                onRefresh: async (newTokenData: AccessToken) => {
                    this.services.logger.debug('Token refreshed:', {
                        hasNewToken: !!newTokenData.accessToken,
                        scopes: newTokenData.scope
                    });
                }
            });

            // Add user token
            const tokenData: AccessToken = {
                accessToken: config.accessToken,
                refreshToken: config.refreshToken,
                expiresIn: null,
                obtainmentTimestamp: Date.now(),
                scope: [
                    'chat:read',
                    'chat:edit',
                    'channel:moderate',
                    'whispers:read',
                    'whispers:edit',
                    'channel:read:subscriptions'
                ]
            };

            await this.authProvider.addUser('bot', tokenData, ['chat']);

            // Initialize API client
            this.services.logger.debug('Initializing API client...');
            this.apiClient = new ApiClient({ authProvider: this.authProvider });

            // Get authenticated user
            const user = await this.apiClient.users.getUserByName(config.botNick || 'TatsLuna');
            if (!user) {
                throw new Error('Failed to get authenticated user');
            }
            this.userId = user.id;

            // Initialize chat client
            this.services.logger.debug('Initializing chat client...');
            this.chatClient = new ChatClient({
                authProvider: this.authProvider,
                channels: config.channels,
                isAlwaysMod: config.isAlwaysMod ?? false,
                botLevel: 'known',
                authIntents: ['chat']
            });

            // Connect to chat
            await this.chatClient.connect();

            this.services.logger.info('Twitch service initialized successfully', {
                username: user.displayName,
                userId: user.id,
                channels: config.channels
            });

        } catch (error) {
            this.services.logger.error('Failed to initialize Twitch service', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }

    public getApiClient(): ApiClient {
        if (!this.apiClient) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Twitch API client not initialized'
            );
        }
        return this.apiClient;
    }

    public getChatClient(): ChatClient {
        if (!this.chatClient) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Twitch chat client not initialized'
            );
        }
        return this.chatClient;
    }

    async cleanup(): Promise<void> {
        if (this.chatClient) {
            await this.chatClient.quit();
        }
        this.apiClient = null;
        this.authProvider = null;
        this.chatClient = null;
        this.userId = null;
    }

    async isHealthy(): Promise<boolean> {
        try {
            if (!this.apiClient || !this.userId || !this.chatClient) {
                return false;
            }
            const user = await this.apiClient.users.getUserById(this.userId);
            return !!user && this.chatClient.isConnected;
        } catch {
            return false;
        }
    }
}
