import { Logger } from 'winston';
import { ChatClient } from '@twurple/chat';
import { ApiClient } from '@twurple/api';
import { 
    AISettings, 
    AIContext,
    TwitchUser,
    ServiceContainer,
    AIMessage
} from '../types';  // Update path

export const MEMORY_TYPES = {
    SHORT_TERM: 300000,    // 5 minutes
    MEDIUM_TERM: 1800000,  // 30 minutes
    LONG_TERM: 7200000    // 2 hours
} as const;

interface ConversationState {
    messages: AIMessage[];
    lastUpdate: number;
}

interface AnalysisResult {
    timestamp: number;
    result: any;
}

export class AIBaseHandler {
    protected chatClient: ChatClient;
    protected apiClient: ApiClient;
    protected services: ServiceContainer;
    protected logger: Logger;
    protected settings: Required<AISettings>;
    protected conversationHistory: Map<string, ConversationState>;
    protected lastAnalysis: Map<string, AnalysisResult>;
    protected lastAutonomousMessage: Map<string, number>;

    constructor(
        services: ServiceContainer,
        options: AISettings = {}
    ) {
        this.services = services;
        this.logger = services.logger;

        this.settings = {
            maxTokens: options.maxTokens ?? 100,
            temperature: options.temperature ?? 0.8,
            conversationExpiry: options.conversationExpiry ?? 5 * 60 * 1000,
            mentionTriggers: options.mentionTriggers ?? [],
            debug: options.debug ?? false
        };

        this.conversationHistory = new Map();
        this.lastAnalysis = new Map();
        this.lastAutonomousMessage = new Map();
    }

    protected getConversationKey(channel: string, userId: string): string {
        return `${channel}:${userId}`;
    }

    protected cleanupExpiredConversations(): void {
        const now = Date.now();
        for (const [key, state] of this.conversationHistory.entries()) {
            if (now - state.lastUpdate > this.settings.conversationExpiry) {
                this.conversationHistory.delete(key);
            }
        }
    }
}
