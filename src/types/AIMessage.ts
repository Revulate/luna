export interface AIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, any>;
}
