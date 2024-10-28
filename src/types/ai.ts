import { ServiceConfig } from './base';
import { TwitchUser } from './twitch';

export interface AIConfig extends ServiceConfig {
    maxTokens: number;
    temperature: number;
    conversationExpiry: number;
    mentionTriggers: string[];
    debug?: boolean;
    providers: {
        claude?: {
            enabled: boolean;
            apiKey: string;
            model: string;
        };
        gpt?: {
            enabled: boolean;
            apiKey: string;
            model: string;
        };
        vision?: {
            enabled: boolean;
            provider: 'claude' | 'gpt';
        };
    };
}

export interface AIContext {
    user: TwitchUser;
    message: string;
    channel: string;
    maxTokens?: number;
    context?: string[];
}

export interface AIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, any>;
}

export interface AIResponse {
    content: string;
    metadata?: Record<string, any>;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface ChannelEmotes {
    twitch: string[];
    sevenTv: string[];
}

export interface ConversationThread {
    id: number;
    channel: string;
    userId: string;
    createdAt: Date;
    lastMessageAt: Date;
}

export interface ThreadMessage {
    id?: number;
    threadId: number;
    role: string;
    content: string;
    metadata?: Record<string, any>;
    timestamp: Date;
}

export interface AIProvider {
    generateResponse(context: AIContext): Promise<string>;
    generateStreamingResponse?(context: AIContext): AsyncGenerator<string>;
}
