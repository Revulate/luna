import { BaseService } from './BaseService';
import { 
    ServiceConfig,
    ServiceContainer,
    AIContext,
    AIResponse,
    AIMessage,
    AIProvider
} from '../types';
import { Logger } from 'winston';
import {
    BaseAIProvider,
    ClaudeProvider,
    GPTProvider,
    VisionProvider,
    YouTubeProvider
} from './ai/providers';
import { ServiceError } from '../errors/ServiceError.js';
import { ErrorCode } from '../errors/ErrorCode.js';

interface RateLimit {
    count: number;
    resetTime: number;
}

interface ConversationContext {
    messages: AIMessage[];
    lastUpdate: number;
    metadata: Record<string, any>;
}

export class AIService extends BaseService implements AIProvider {
    // Constants
    private readonly CONTEXT_EXPIRY = 30 * 60 * 1000; // 30 minutes
    private readonly RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
    private readonly MAX_REQUESTS_PER_WINDOW = 5;
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 1000; // 1 second

    // Private properties
    private conversationContexts: Map<string, ConversationContext> = new Map();
    private contentCache: Map<string, {result: any; timestamp: number}> = new Map();
    private rateLimits: Map<string, RateLimit> = new Map();
    private providers: Map<string, BaseAIProvider>;
    private vision: VisionProvider | null = null;
    private youtube: YouTubeProvider | null = null;

    // Protected properties
    protected readonly serviceConfig: ServiceConfig;
    protected readonly logger: Logger;
    protected readonly services: ServiceContainer;

    constructor(services: ServiceContainer, config: ServiceConfig) {
        super(config);
        this.services = services;
        this.serviceConfig = config;
        this.logger = services.logger as unknown as Logger;
        this.providers = new Map();
        this.startMaintenanceInterval();
    }

    private startMaintenanceInterval(): void {
        setInterval(() => {
            this.cleanupExpiredContexts();
            this.cleanupContentCache();
        }, 5 * 60 * 1000); // Run every 5 minutes
    }

    private cleanupExpiredContexts(): void {
        const now = Date.now();
        for (const [key, context] of this.conversationContexts.entries()) {
            if (now - context.lastUpdate > this.CONTEXT_EXPIRY) {
                this.conversationContexts.delete(key);
            }
        }
    }

    private cleanupContentCache(): void {
        const now = Date.now();
        for (const [key, cache] of this.contentCache.entries()) {
            if (now - cache.timestamp > 24 * 60 * 60 * 1000) { // 24 hours
                this.contentCache.delete(key);
            }
        }
    }

    private isRateLimited(userId: string): boolean {
        const now = Date.now();
        const limit = this.rateLimits.get(userId);

        if (!limit || now >= limit.resetTime) {
            this.rateLimits.set(userId, {
                count: 1,
                resetTime: now + this.RATE_LIMIT_WINDOW
            });
            return false;
        }

        if (limit.count >= this.MAX_REQUESTS_PER_WINDOW) {
            return true;
        }

        limit.count++;
        return false;
    }

    private async updateConversationContext(
        userId: string,
        channel: string,
        message: AIMessage
    ): Promise<void> {
        const key = `${channel}:${userId}`;
        const context = this.conversationContexts.get(key) ?? {
            messages: [],
            lastUpdate: Date.now(),
            metadata: {}
        };

        context.messages.push(message);
        context.lastUpdate = Date.now();

        // Keep only last N messages
        if (context.messages.length > 10) {
            context.messages = context.messages.slice(-10);
        }

        this.conversationContexts.set(key, context);
    }

    public async generateResponse(context: AIContext): Promise<string> {
        if (this.isRateLimited(context.user.id)) {
            throw new ServiceError(
                ErrorCode.RATE_LIMIT_EXCEEDED,
                'Rate limit exceeded'
            );
        }

        const provider = this.getProvider(context.provider ?? this.serviceConfig.defaultProvider);
        
        try {
            const conversationContext = this.getConversationContext(
                context.user.id,
                context.channel
            );
            
            if (conversationContext) {
                // Ensure we're assigning AIMessage[] to context.context
                context.context = conversationContext.messages;
            }

            return await this.withRetry(() => provider.generateResponse(context));
        } catch (error) {
            throw new ServiceError(
                ErrorCode.AI_REQUEST_FAILED,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    public async *generateStreamingResponse(context: AIContext): AsyncGenerator<string> {
        const provider = this.getProvider(context.provider ?? this.serviceConfig.defaultProvider);
        
        try {
            if (!('generateStreamingResponse' in provider)) {
                yield await this.generateResponse(context);
                return;
            }

            const streamingProvider = provider as BaseAIProvider & { generateStreamingResponse: (context: AIContext) => AsyncGenerator<string> };
            const generator = streamingProvider.generateStreamingResponse(context);
            
            for await (const chunk of generator) {
                yield chunk;
            }
        } catch (error) {
            throw new ServiceError(
                ErrorCode.AI_REQUEST_FAILED,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    private getConversationContext(userId: string, channel: string): ConversationContext | null {
        const key = `${channel}:${userId}`;
        return this.conversationContexts.get(key) ?? null;
    }

    public async analyzeContent(content: string): Promise<any> {
        // Check cache first
        const cacheKey = this.hashContent(content);
        const cached = this.contentCache.get(cacheKey);
        if (cached) {
            return cached.result;
        }

        if (!this.vision) {
            throw new ServiceError(
                ErrorCode.AI_PROVIDER_ERROR,
                'Vision provider not enabled'
            );
        }

        try {
            const result = await this.vision.analyzeContent(content);
            
            // Cache the result
            this.contentCache.set(cacheKey, {
                result,
                timestamp: Date.now()
            });

            return result;
        } catch (error) {
            throw new ServiceError(
                ErrorCode.AI_REQUEST_FAILED,
                'Failed to analyze content',
                'vision',
                { error: error.message }
            );
        }
    }

    private hashContent(content: string): string {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(content).digest('hex');
    }

    public async analyzeVideo(url: string): Promise<any> {
        const cacheKey = `video:${url}`;
        const cached = this.contentCache.get(cacheKey);
        if (cached) {
            return cached.result;
        }

        if (!this.youtube) {
            throw new ServiceError(
                ErrorCode.AI_PROVIDER_ERROR,
                'YouTube provider not enabled'
            );
        }

        try {
            const result = await this.youtube.analyzeVideo(url);
            
            this.contentCache.set(cacheKey, {
                result,
                timestamp: Date.now()
            });

            return result;
        } catch (error) {
            throw new ServiceError(
                ErrorCode.AI_REQUEST_FAILED,
                'Failed to analyze video',
                'youtube',
                { error: error.message }
            );
        }
    }

    private getProvider(name: string = this.serviceConfig.defaultProvider): BaseAIProvider {
        const provider = this.providers.get(name);
        if (!provider) {
            throw new ServiceError(
                ErrorCode.AI_PROVIDER_ERROR,
                `AI provider '${name}' not found or not initialized`
            );
        }
        return provider;
    }

    private async withRetry<T>(
        operation: () => Promise<T>,
        retries: number = this.MAX_RETRIES
    ): Promise<T> {
        let lastError: Error;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (attempt === retries) break;
                
                await new Promise(resolve => 
                    setTimeout(resolve, this.RETRY_DELAY * attempt)
                );
                this.logger.debug(`Retrying AI operation, attempt ${attempt + 1}/${retries}`);
            }
        }

        throw lastError!;
    }

    public async doCleanup(): Promise<void> {
        try {
            // Cleanup all providers
            for (const [name, provider] of this.providers.entries()) {
                try {
                    await provider.cleanup();
                    this.logger.debug(`Cleaned up AI provider: ${name}`);
                } catch (error) {
                    this.logger.error(`Error cleaning up AI provider ${name}:`, error);
                }
            }

            // Cleanup specialized providers
            if (this.vision) await this.vision.cleanup();
            if (this.youtube) await this.youtube.cleanup();

            this.providers.clear();
            this.logger.info('AI service cleanup completed');
        } catch (error) {
            throw new ServiceError(
                ErrorCode.SERVICE_CLEANUP_FAILED,
                'Failed to cleanup AI service',
                'ai',
                { error: error.message }
            );
        }
    }

    public isHealthy(): boolean {
        return this.providers.size > 0 && 
               Array.from(this.providers.values()).some(p => p.isInitialized());
    }

    // Helper methods
    private validateContext(context: AIContext): void {
        if (!context.user?.id || !context.channel) {
            throw new ServiceError(
                ErrorCode.AI_CONTEXT_INVALID,
                'Invalid AI context: missing required fields'
            );
        }
    }

    private sanitizePrompt(prompt: string): string {
        return prompt
            .replace(/[<>]/g, '')
            .trim();
    }

    private async logInteraction(
        prompt: string,
        response: AIResponse,
        context: AIContext
    ): Promise<void> {
        try {
            const eventData = {
                provider: context.provider || 'unknown',
                userId: context.user.id,
                prompt: this.sanitizePrompt(prompt),
                response: response.content,
                metadata: response.metadata,
                timestamp: Date.now()
            };

            await this.services.database.logEvent('ai_interaction', eventData);
        } catch (error) {
            this.logger.error('Failed to log AI interaction:', error);
        }
    }

    public async initialize(): Promise<void> {
        try {
            await this.initializeProviders();
        } catch (error) {
            this.logger.error('Failed to initialize AI service:', error);
            throw error;
        }
    }

    private async initializeProviders(): Promise<void> {
        if (this.serviceConfig.claude?.enabled) {
            this.providers.set('claude', new ClaudeProvider(this.services, this.serviceConfig.claude));
        }

        if (this.serviceConfig.openai?.enabled) {
            this.providers.set('gpt', new GPTProvider(this.services, this.serviceConfig.openai));
        }

        // Initialize vision provider
        if (this.serviceConfig.vision?.enabled) {
            this.vision = new VisionProvider(this.services, this.serviceConfig.vision);
            await this.vision.initialize();
        }

        // Initialize YouTube provider
        if (this.serviceConfig.youtube?.enabled) {
            this.youtube = new YouTubeProvider(this.services, this.serviceConfig.youtube);
            await this.youtube.initialize();
        }

        // Initialize all providers
        for (const provider of this.providers.values()) {
            await provider.initialize();
        }
    }

    public async cleanup(): Promise<void> {
        await this.doCleanup();
    }
}
