export interface AIContext {
    user: {
        id: string;
        [key: string]: any;
    };
    channel: string;
    provider?: string;
    prompt?: string;
    systemPrompt?: string;
    context?: AIMessage[];
    maxTokens?: number;
    emotes?: {
        twitch: Array<{ name: string; [key: string]: any }>;
        sevenTv: Array<{ name: string; [key: string]: any }>;
    };
    isLive?: boolean;
    metadata?: Record<string, any>;
}

export interface AIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface AIResponse {
    content: string;
    metadata?: Record<string, any>;
}
