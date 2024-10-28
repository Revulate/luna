import { Logger } from 'winston';

export interface ServiceConfig {
    name: string;
    enabled: boolean;
    [key: string]: any;
}

export interface ServiceContainer {
    logger: Logger;
    database: any; // Replace with proper database interface
    [key: string]: any;
}

export interface AIContext {
    user: { id: string };
    channel: string;
    prompt?: string;
    provider?: string;
    context?: AIMessage[];
    systemPrompt?: string;
    maxTokens?: number;
    emotes?: {
        twitch: Array<{ name: string }>;
        sevenTv: Array<{ name: string }>;
    };
    isLive?: boolean;
}

export interface AIMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface AIResponse {
    content: string;
    metadata?: Record<string, any>;
}

export interface AIProvider {
    generateResponse(context: AIContext): Promise<string>;
    generateStreamingResponse(context: AIContext): AsyncGenerator<string>;
}

export const enum ErrorCode {
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
    AI_REQUEST_FAILED = 'AI_REQUEST_FAILED',
    AI_PROVIDER_ERROR = 'AI_PROVIDER_ERROR',
    AI_CONTEXT_INVALID = 'AI_CONTEXT_INVALID',
    SERVICE_CLEANUP_FAILED = 'SERVICE_CLEANUP_FAILED',
    CONFIG_MISSING = 'CONFIG_MISSING',
    CONFIG_INVALID = 'CONFIG_INVALID'
}

export class ServiceError extends Error {
    constructor(
        public readonly code: ErrorCode,
        message: string,
        public readonly context?: string,
        public readonly details?: any
    ) {
        super(`[${code}]${context ? ` [${context}]` : ''} ${message}`);
        this.name = 'ServiceError';
    }
}

export const createServiceError = (code: ErrorCode, message: string, context?: string, details?: any): ServiceError => {
    return new ServiceError(code, message, context, details);
};

// Add to existing types.ts
export interface ExtendedAIContext extends AIContext {
    prompt: string;
    provider?: string;
    context?: AIMessage[];
    systemPrompt?: string;
    maxTokens?: number;
    emotes?: {
        twitch: Array<{ name: string }>;
        sevenTv: Array<{ name: string }>;
    };
    isLive?: boolean;
}

export interface AISettings {
    maxTokens?: number;
    temperature?: number;
    conversationExpiry?: number;
    mentionTriggers?: string[];
    debug?: boolean;
}

export interface TwitchUser {
    id: string;
    username: string;
    displayName?: string;
}
