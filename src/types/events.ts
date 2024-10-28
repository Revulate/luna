import { ServiceConfig } from './base';
import { TwitchUser } from './twitch';

export interface EventConfig extends ServiceConfig {
    checkInterval: number;
    rateLimit: number;
    streamAnalysisInterval: number;
    maxQueueSize: number;
    retryAttempts: number;
    retryDelay: number;
}

export interface TwitchEvent {
    type: TwitchEventType;
    channel: string;
    user: TwitchUser;
    data: any;
    timestamp: number;
}

export type TwitchEventType = 
    | 'message'
    | 'subscription'
    | 'follow'
    | 'raid'
    | 'cheer'
    | 'command'
    | 'stream.start'
    | 'stream.end'
    | 'stream.update'
    | 'channel.update'
    | 'service.error';

export interface StreamState {
    channel: string;
    isLive: boolean;
    viewers?: number;
    game?: string;
    title?: string;
    startTime?: Date;
    tags?: string[];
}

export interface StreamMonitor {
    channel: string;
    state: StreamState;
    interval: NodeJS.Timeout;
    lastCheck: Date;
}

export interface EventHandler {
    handleEvent(event: TwitchEvent): Promise<void>;
}

export type EventListener = (data: any) => void | Promise<void>;
