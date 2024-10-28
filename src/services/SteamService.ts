import { Service, ServiceConfig, ServiceContainer } from '../types/services';
import { ServiceError, ErrorCode } from '../types/errors';
import { SteamGameInfo, UserStats, GameNews } from '../types/steam';
import { BaseService } from './BaseService';
import fetch, { Response } from 'node-fetch';

interface SteamConfig extends ServiceConfig {
    apiKey: string;
    cache: {
        enabled: boolean;
        ttl: number;
        maxSize: number;
    };
    rateLimit: {
        requests: number;
        window: number;
    };
    retryConfig: {
        maxRetries: number;
        delay: number;
    };
}

export class SteamService extends BaseService {
    private readonly API_BASE_URL = 'https://api.steampowered.com';
    private readonly STORE_BASE_URL = 'https://store.steampowered.com/api';
    private readonly gameCache: Map<number, { info: SteamGameInfo; timestamp: number }>;
    private readonly userCache: Map<string, { stats: UserStats; timestamp: number }>;
    private readonly newsCache: Map<number, { news: GameNews; timestamp: number }>;
    private readonly rateLimits: Map<string, number>;
    public readonly services: ServiceContainer;

    constructor(config: SteamConfig, services: ServiceContainer) {
        super(config);
        this.services = services;
        this.gameCache = new Map();
        this.userCache = new Map();
        this.newsCache = new Map();
        this.rateLimits = new Map();
    }

    async initialize(): Promise<void> {
        try {
            // Validate API key
            await this.validateApiKey();

            // Start cache cleanup
            this.startCacheCleanup();

            this.services.logger.info('Steam service initialized successfully', {
                context: 'steam',
                cacheEnabled: this.config.cache.enabled
            });
        } catch (error) {
            throw this.handleError(error as Error, 'SERVICE_UNAVAILABLE');
        }
    }

    async cleanup(): Promise<void> {
        this.gameCache.clear();
        this.userCache.clear();
        this.newsCache.clear();
        this.rateLimits.clear();
    }

    private async validateApiKey(): Promise<void> {
        try {
            const response = await fetch(
                `${this.API_BASE_URL}/ISteamUser/GetPlayerSummaries/v2/?key=${this.config.apiKey}&steamids=76561197960435530`
            );
            
            if (!response.ok) {
                throw new Error(`API validation failed: ${response.statusText}`);
            }
        } catch (error) {
            throw this.handleError(error as Error, 'SERVICE_UNAVAILABLE');
        }
    }

    public async getGameInfo(appId: number): Promise<SteamGameInfo> {
        this.checkRateLimit('game');

        // Check cache first
        const cached = this.gameCache.get(appId);
        if (cached && Date.now() - cached.timestamp < this.config.cache.ttl) {
            return cached.info;
        }

        try {
            const response = await this.fetchWithRetry(
                `${this.STORE_BASE_URL}/appdetails?appids=${appId}`
            );

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }

            const data = await response.json() as Record<string, { data: SteamGameInfo }>;
            const gameInfo = data[appId].data;

            // Cache results
            if (this.config.cache.enabled) {
                this.gameCache.set(appId, {
                    info: gameInfo,
                    timestamp: Date.now()
                });
            }

            return gameInfo;
        } catch (error) {
            throw this.handleError(error as Error, 'SERVICE_UNAVAILABLE');
        }
    }

    public async getUserStats(steamId: string, appId: number): Promise<UserStats> {
        this.checkRateLimit('stats');

        const cacheKey = `${steamId}:${appId}`;
        const cached = this.userCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.config.cache.ttl) {
            return cached.stats;
        }

        try {
            const response = await this.fetchWithRetry(
                `${this.API_BASE_URL}/ISteamUserStats/GetUserStatsForGame/v2/?appid=${appId}&key=${this.config.apiKey}&steamid=${steamId}`
            );

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }

            const data = await response.json() as { playerstats: UserStats };
            const stats = data.playerstats;

            if (this.config.cache.enabled) {
                this.userCache.set(cacheKey, {
                    stats,
                    timestamp: Date.now()
                });
            }

            return stats;
        } catch (error) {
            throw this.handleError(error as Error, 'SERVICE_UNAVAILABLE');
        }
    }

    public async getGameNews(appId: number): Promise<GameNews> {
        this.checkRateLimit('news');

        const cached = this.newsCache.get(appId);
        if (cached && Date.now() - cached.timestamp < this.config.cache.ttl) {
            return cached.news;
        }

        try {
            const response = await this.fetchWithRetry(
                `${this.API_BASE_URL}/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=10&maxlength=300&format=json`
            );

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }

            const data = await response.json() as { appnews: GameNews };
            const news = data.appnews;

            if (this.config.cache.enabled) {
                this.newsCache.set(appId, {
                    news,
                    timestamp: Date.now()
                });
            }

            return news;
        } catch (error) {
            throw this.handleError(error as Error, 'SERVICE_UNAVAILABLE');
        }
    }

    private async fetchWithRetry(url: string): Promise<Response> {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < this.config.retryConfig.maxRetries; attempt++) {
            try {
                const response = await fetch(url);
                return response;
            } catch (error) {
                lastError = error as Error;
                await new Promise(resolve => 
                    setTimeout(resolve, this.config.retryConfig.delay * Math.pow(2, attempt))
                );
                this.services.logger.debug(`Retrying Steam operation, attempt ${attempt + 1}/${this.config.retryConfig.maxRetries}`);
            }
        }
        throw lastError || new Error('Failed to fetch after retries');
    }

    private checkRateLimit(type: string): void {
        const now = Date.now();
        const window = this.config.rateLimit.window;
        const requests = this.rateLimits.get(type) || 0;

        if (requests >= this.config.rateLimit.requests) {
            throw this.handleError(new Error('Rate limit exceeded'), 'RATE_LIMITED');
        }

        this.rateLimits.set(type, requests + 1);
        setTimeout(() => {
            this.rateLimits.set(type, requests);
        }, window);
    }

    private startCacheCleanup(): void {
        setInterval(() => {
            const now = Date.now();
            
            for (const [key, value] of this.gameCache.entries()) {
                if (now - value.timestamp > this.config.cache.ttl) {
                    this.gameCache.delete(key);
                }
            }

            for (const [key, value] of this.userCache.entries()) {
                if (now - value.timestamp > this.config.cache.ttl) {
                    this.userCache.delete(key);
                }
            }

            for (const [key, value] of this.newsCache.entries()) {
                if (now - value.timestamp > this.config.cache.ttl) {
                    this.newsCache.delete(key);
                }
            }
        }, this.config.cache.ttl);
    }
}
