import { BaseAIProvider } from './BaseAIProvider';
import { 
    AIContext, 
    AIResponse,
    ServiceContainer,
    AIMessage
} from '../../../types';
import { ServiceError } from '../../../errors/ServiceError.js';
import { ErrorCode } from '../../../errors/ErrorCode.js';
import Anthropic from '@anthropic-ai/sdk';

type AnthropicMessage = {
    role: 'user' | 'assistant';
    content: string;
};

interface ClaudeConfig {
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
    systemPrompt: string;
}

export class ClaudeProvider extends BaseAIProvider {
    private client: Anthropic | null = null;
    protected readonly config: ClaudeConfig;

    constructor(services: ServiceContainer, config: ClaudeConfig) {
        super(services, config);
        this.config = config;
    }

    public async initialize(): Promise<boolean> {
        try {
            this.validateConfig();
            
            this.client = new Anthropic({
                apiKey: this.config.apiKey
            });

            this.initialized = true;
            return true;
        } catch (error) {
            throw new ServiceError(
                ErrorCode.AI_PROVIDER_ERROR,
                'Failed to initialize Claude provider',
                'claude',
                { error: error instanceof Error ? error.message : 'Unknown error' }
            );
        }
    }

    public async generateResponse(context: AIContext): Promise<string> {
        if (!this.initialized) {
            throw new Error('Claude provider not initialized');
        }

        try {
            const formattedPrompt = this.formatPrompt(context.message ?? '', context);
            const messages = this.buildMessages(formattedPrompt, context);

            const response = await this.client.messages.create({
                max_tokens: context.maxTokens ?? this.config.maxTokens,
                temperature: this.config.temperature,
                messages,
                system: context.systemPrompt ?? this.config.systemPrompt
            });

            return response.content[0].text;
        } catch (error) {
            throw this.formatError(error instanceof Error ? error : new Error('Unknown error'), 'claude.generate');
        }
    }

    private buildMessages(prompt: string, context: AIContext): AnthropicMessage[] {
        const messages: AnthropicMessage[] = [];

        // Add conversation context if available
        if (context.context) {
            for (const msg of context.context) {
                if (typeof msg === 'object' && 'role' in msg && 'content' in msg) {
                    messages.push({
                        role: msg.role === 'system' ? 'user' : msg.role as 'user' | 'assistant',
                        content: msg.content
                    });
                }
            }
        }

        // Add current prompt
        messages.push({
            role: 'user',
            content: prompt
        });

        return messages;
    }

    public async cleanup(): Promise<void> {
        this.client = null;
        this.initialized = false;
    }

    public async generateStreamingResponse(context: AIContext): Promise<AsyncGenerator<string>> {
        // Implementation
        throw new Error('Not implemented');
    }
}
