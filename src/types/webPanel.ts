import { ServiceConfig } from './base';

export interface WebPanelConfig extends ServiceConfig {
    port: number;
    password: string;
    sessionSecret: string;
    cors: {
        enabled: boolean;
        origin: string;
    };
}

export interface WebPanelService {
    isHealthy(): boolean;
    getMetrics(): WebPanelMetrics;
}

export interface WebPanelMetrics {
    uptime: number;
    connectedClients: number;
    requestsPerMinute: number;
    lastError?: {
        message: string;
        timestamp: Date;
    };
}

export interface WebSocketEvent {
    type: string;
    data: any;
    timestamp: Date;
}

export interface WebSocketClient {
    id: string;
    channel?: string;
    authenticated: boolean;
    lastActivity: Date;
}
