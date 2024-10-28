import { 
    AIProvider,
    AIContext,
    AIResponse,
    ServiceContainer
} from '../../../types';
import { Logger } from 'winston';
import { ServiceError } from '../../../errors/ServiceError';
import { ErrorCode } from '../../../errors/ErrorCode';

export abstract class BaseAIProvider implements AIProvider {
    protected services: ServiceContainer;
    protected config: Record<string, any>;
    protected logger: Logger;
    protected initialized: boolean = false;

    constructor(services: ServiceContainer, config: Record<string, any>) {
        this.services = services;
        this.config = config;
        this.logger = services.logger as unknown as Logger;
    }

    public abstract initialize(): Promise<boolean>;
    public abstract generateResponse(context: AIContext): Promise<string>;
    public abstract cleanup(): Promise<void>;

    protected validateConfig(): void {
        if (!this.config) {
            throw new ServiceError(
                ErrorCode.CONFIG_MISSING,
                `${this.constructor.name} requires configuration`
            );
        }

        if (!this.config.apiKey) {
            throw new ServiceError(
                ErrorCode.CONFIG_INVALID,
                `${this.constructor.name} requires an API key`
            );
        }
    }

    protected formatPrompt(prompt: string, context: AIContext): string {
        let formattedPrompt = prompt;

        // Add emote context if available
        if (context.emotes && 'twitch' in context.emotes && 'sevenTv' in context.emotes) {
            const { twitch = [], sevenTv = [] } = context.emotes;
            formattedPrompt = `Available emotes:
Twitch: ${twitch.map(e => e.name).join(' ')}
7TV: ${sevenTv.map(e => e.name).join(' ')}

Use these emotes naturally in your response.

${prompt}`;
        }

        // Add stream context if live
        if ('isLive' in context && context.isLive) {
            formattedPrompt = `Channel is currently live streaming.
Respond in a way that's appropriate for a live chat environment.

${formattedPrompt}`;
        }

        return formattedPrompt;
    }

    protected validateResponse(response: AIResponse): void {
        if (!response.content) {
            throw new ServiceError(
                ErrorCode.AI_PROVIDER_ERROR,
                'AI provider returned empty response'
            );
        }
    }

    protected formatError(error: Error, context: string): ServiceError {
        return new ServiceError(
            ErrorCode.AI_PROVIDER_ERROR,
            error.message,
            context,
            {
                provider: this.constructor.name,
                stack: error.stack
            }
        );
    }

    protected async logInteraction(
        prompt: string,
        response: AIResponse,
        context: AIContext
    ): Promise<void> {
        try {
            const eventData = {
                provider: this.constructor.name,
                userId: context.user.id,
                prompt,
                response: response.content,
                metadata: response.metadata,
                timestamp: Date.now()
            };

            await this.services.database.logEvent('ai_interaction', eventData);
        } catch (error) {
            this.logger.error('Failed to log AI interaction:', error);
        }
    }

    public isInitialized(): boolean {
        return this.initialized;
    }
}
