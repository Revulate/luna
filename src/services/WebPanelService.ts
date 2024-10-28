import express, { Application, Request, Response, NextFunction } from 'express';
import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { Service, ServiceConfig, ServiceContainer } from '../types/services';
import { ServiceError, ErrorCode } from '../types/errors';

// Define WebPanel specific error codes
export const WebPanelErrorCode = {
    INTERNAL_ERROR: 'INTERNAL_ERROR' as ErrorCode,
    CONNECTION_ERROR: 'CONNECTION_ERROR' as ErrorCode,
    WEBSOCKET_ERROR: 'WEBSOCKET_ERROR' as ErrorCode,
    RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR' as ErrorCode
} as const;

// Create WebPanel specific error class
export class WebPanelServiceError extends Error {
    constructor(public code: ErrorCode, message: string) {
        super(message);
        this.name = 'WebPanelServiceError';
    }
}

interface WebSocketClient extends WebSocket {
    id: string;
    isAlive: boolean;
    subscriptions: Set<string>;
}

interface WebPanelConfig extends ServiceConfig {
    port: number;
    host: string;
    cors: {
        origin: string | string[];
        credentials: boolean;
    };
    rateLimit: {
        windowMs: number;
        max: number;
    };
}

export class WebPanelService implements Service {
    public readonly config: WebPanelConfig;
    public readonly services: ServiceContainer;
    private app: Application;
    private server?: HttpServer;
    private wss?: WebSocketServer;
    private clients: Map<string, WebSocketClient>;
    private performanceMetrics: {
        requestCount: number;
        errorCount: number;
        lastError?: Error;
        startTime: number;
    };

    constructor(
        config: WebPanelConfig,
        services: ServiceContainer
    ) {
        this.config = config;
        this.services = services;
        this.app = express();
        this.clients = new Map();
        this.performanceMetrics = {
            requestCount: 0,
            errorCount: 0,
            startTime: Date.now()
        };
        this.setupMiddleware();
        this.setupRoutes();
    }

    async initialize(): Promise<void> {
        try {
            this.server = this.app.listen(this.config.port, this.config.host);
            this.wss = new WebSocketServer({ server: this.server });
            this.setupWebSocket();
            this.services.logger.info(`WebPanel listening on ${this.config.host}:${this.config.port}`);
        } catch (error) {
            this.services.logger.error('Failed to initialize WebPanel', { error });
            throw error;
        }
    }

    async cleanup(): Promise<void> {
        try {
            await new Promise<void>((resolve, reject) => {
                this.wss?.close((err) => err ? reject(err) : resolve());
            });
            await new Promise<void>((resolve, reject) => {
                this.server?.close((err) => err ? reject(err) : resolve());
            });
        } catch (error) {
            this.services.logger.error('Error during WebPanel cleanup', { error });
            throw error;
        }
    }

    handleError(error: Error, code: ErrorCode = WebPanelErrorCode.INTERNAL_ERROR): ServiceError {
        this.performanceMetrics.errorCount++;
        this.performanceMetrics.lastError = error;
        const serviceError: ServiceError = {
            name: error.name,
            message: error.message,
            code,
            stack: error.stack,
            timestamp: new Date(),
            toJSON() {
                return {
                    name: this.name,
                    message: this.message,
                    code: this.code,
                    timestamp: this.timestamp
                };
            }
        };
        return serviceError;
    }

    private setupMiddleware(): void {
        this.app.use(helmet());
        this.app.use(cors(this.config.cors));
        this.app.use(express.json());
        this.app.use(cookieParser());
        this.app.use(rateLimit(this.config.rateLimit));
    }

    private setupRoutes(): void {
        // Add your routes here
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok' });
        });
    }

    private setupWebSocket(): void {
        this.wss?.on('connection', (ws: WebSocket) => {
            const client = ws as WebSocketClient;
            client.id = Math.random().toString(36).substring(7);
            client.isAlive = true;
            client.subscriptions = new Set();
            this.clients.set(client.id, client);

            client.on('pong', () => {
                client.isAlive = true;
            });

            client.on('message', this.handleWebSocketMessage.bind(this, client));

            client.on('close', () => {
                this.clients.delete(client.id);
            });
        });

        setInterval(() => {
            this.wss?.clients.forEach((ws) => {
                const client = ws as WebSocketClient;
                if (!client.isAlive) {
                    this.clients.delete(client.id);
                    return client.terminate();
                }
                client.isAlive = false;
                client.ping();
            });
        }, 30000);
    }

    private handleWebSocketMessage(ws: WebSocketClient, message: Buffer | ArrayBuffer | Buffer[]): void {
        try {
            const data = JSON.parse(message.toString());
            // Handle different message types
            switch (data.type) {
                case 'subscribe':
                    ws.subscriptions.add(data.channel);
                    break;
                case 'unsubscribe':
                    ws.subscriptions.delete(data.channel);
                    break;
                default:
                    this.services.logger.warn('Unknown WebSocket message type', { type: data.type });
            }
        } catch (error) {
            this.services.logger.error('Error handling WebSocket message', { error });
        }
    }

    broadcast(event: string, data: any): void {
        const message = JSON.stringify({ event, data });
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    getConnectedClients(): number {
        return this.clients.size;
    }

    public async isHealthy(): Promise<boolean> {
        try {
            return this.server?.listening ?? false;
        } catch (error) {
            return false;
        }
    }
}
