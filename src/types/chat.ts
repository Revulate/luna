import type { ChatClient, ChatUser as TwurpleChatUser } from '@twurple/chat';
import { ServiceConfig } from './base';

// Re-export the ChatUser type with our extensions
export type ChatUser = TwurpleChatUser & {
    id: string;
    userName: string;
    displayName: string;
    color: string;
    badges: Map<string, string>;
    isBroadcaster: boolean;
    isMod: boolean;
    isVip: boolean;
    isSubscriber: boolean;
};

export interface ExtendedChatClient extends ChatClient {
    timeout(channel: string, username: string, duration: number, reason?: string): Promise<void>;
    ban(channel: string, username: string, reason?: string): Promise<void>;
    unban(channel: string, username: string): Promise<void>;
    clear(channel: string): Promise<void>;
    announce(channel: string, message: string): Promise<void>;
    isModerator(channel: string, username: string): boolean;
    latency: number;
}

export interface ChatConfig extends ServiceConfig {
    connection: {
        secure: boolean;
        reconnect: boolean;
        maxReconnectAttempts: number;
        maxReconnectInterval: number;
    };
    channels: string[];
    prefix: string;
    ignoreBots: boolean;
    ignoreSelf: boolean;
}

export interface ChatMessage {
    id: string;
    channel: string;
    user: ChatUser;
    message: string;
    emotes: Map<string, string[]>;
    badges: Map<string, string>;
    userInfo: {
        id: string;
        userName: string;
        displayName: string;
        color?: string;
        badges: Map<string, string>;
        isMod: boolean;
        isSubscriber: boolean;
        isVip: boolean;
        isBroadcaster: boolean;
    };
    timestamp: Date;
    isAction: boolean;
    messageText: string;
    emoteOffsets: Map<string, string[]>;
    replyParentMessage?: ChatMessage;
}

export interface ChatMetrics {
    messagesReceived: number;
    messagesSent: number;
    commandsProcessed: number;
    errors: number;
    reconnects: number;
    latency: number;
}

// Helper type for chat events
export interface ChatEventMap {
    message: (channel: string, user: ChatUser, message: string, msg: ChatMessage) => void;
    action: (channel: string, user: ChatUser, message: string, msg: ChatMessage) => void;
    join: (channel: string, user: string) => void;
    part: (channel: string, user: string) => void;
    ban: (channel: string, user: string) => void;
    timeout: (channel: string, user: string, duration: number) => void;
    subscription: (channel: string, user: string, subInfo: any) => void;
    raided: (channel: string, user: string, raidInfo: any) => void;
    cheer: (channel: string, user: string, message: string, bits: number) => void;
}
