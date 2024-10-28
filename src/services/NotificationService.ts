import { Service, ServiceConfig, ServiceContainer } from '../types/services';
import { ServiceError, ErrorCode } from '../types/errors';
import WebSocket from 'ws';
import { Server as HttpServer } from 'http';
import express from 'express';
import fetch from 'node-fetch';

interface NotificationConfig extends ServiceConfig {
    overlay: {
        enabled: boolean;
        port: number;
        password: string;
    };
    webhooks: {
        enabled: boolean;
        endpoints: {
            url: string;
            events: string[];
            secret?: string;
        }[];
        retryAttempts: number;
        retryDelay: number;
    };
    discord: {
        enabled: boolean;
        webhookUrl?: string;
        mentionRoles?: string[];
    };
    rateLimit: {
        maxNotifications: number;
        window: number;
    };
    queue: {
        enabled: boolean;
        maxSize: number;
        processInterval: number;
    };
}

interface Notification {
    id: string;
    type: string;
    target: string;
    data: Record<string, any>;
    timestamp: Date;
    priority?: 'high' | 'normal' | 'low';
    expiry?: Date;
}

export class NotificationService implements Service {
    public readonly config: NotificationConfig;
    public readonly services: ServiceContainer;
    private overlayServer: WebSocket.Server | null = null;
    private overlayClients: Set<WebSocket> = new Set();
    private notificationQueue: Notification[] = [];
    private processingQueue: boolean = false;
    private queueInterval: NodeJS.Timeout | null = null;
    private rateLimitMap: Map<string, number> = new Map();
    private app: express.Application;
    private httpServer: HttpServer | null = null;

    constructor(config: NotificationConfig, services: ServiceContainer) {
        this.config = config;
        this.services = services;
        this.app = express();
    }

    async initialize(): Promise<void> {
        try {
            if (this.config.overlay.enabled) {
                await this.initializeOverlay();
            }

            if (this.config.queue.enabled) {
                this.initializeQueue();
            }

            this.services.logger.info('Notification service initialized successfully', {
                context: 'notifications',
                overlay: this.config.overlay.enabled,
                webhooks: this.config.webhooks.enabled,
                discord: this.config.discord.enabled
            });
        } catch (error) {
            throw this.handleError(error as Error, 'SERVICE_UNAVAILABLE');
        }
    }

    async cleanup(): Promise<void> {
        try {
            // Stop queue processing
            if (this.queueInterval) {
                clearInterval(this.queueInterval);
                this.queueInterval = null;
            }

            // Close overlay server
            if (this.overlayServer) {
                for (const client of this.overlayClients) {
                    client.close();
                }
                await new Promise<void>((resolve) => {
                    this.overlayServer?.close(() => resolve());
                });
            }

            // Close HTTP server
            if (this.httpServer) {
                await new Promise<void>((resolve) => {
                    this.httpServer?.close(() => resolve());
                });
            }

            this.services.logger.info('Notification service cleanup completed');
        } catch (error) {
            throw this.handleError(error as Error, 'INTERNAL_ERROR');
        }
    }

    handleError(error: Error, code: ErrorCode = 'INTERNAL_ERROR'): ServiceError {
        return {
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
    }

    private async initializeOverlay(): Promise<void> {
        this.httpServer = this.app.listen(this.config.overlay.port);
        this.overlayServer = new WebSocket.Server({ server: this.httpServer });

        this.overlayServer.on('connection', (client: WebSocket) => {
            this.overlayClients.add(client);

            client.on('close', () => {
                this.overlayClients.delete(client);
            });

            client.on('error', (error) => {
                this.services.logger.error('Overlay client error:', error);
                client.close();
            });
        });

        this.overlayServer.on('error', (error) => {
            this.services.logger.error('Overlay server error:', error);
        });
    }

    private initializeQueue(): void {
        this.queueInterval = setInterval(() => {
            void this.processQueue();
        }, this.config.queue.processInterval);
    }

    private checkRateLimit(target: string): boolean {
        const now = Date.now();
        const lastNotification = this.rateLimitMap.get(target) || 0;
        return (now - lastNotification) < this.config.rateLimit.window;
    }

    private async processQueue(): Promise<void> {
        if (this.processingQueue || this.notificationQueue.length === 0) return;

        this.processingQueue = true;
        try {
            const notification = this.notificationQueue.shift();
            if (notification) {
                await this.processNotification(notification);
            }
        } finally {
            this.processingQueue = false;
        }
    }

    public async sendNotification(notification: Notification): Promise<void> {
        if (this.checkRateLimit(notification.target)) {
            this.services.logger.warn('Rate limit exceeded for notifications', {
                target: notification.target
            });
            return;
        }

        try {
            if (this.config.queue.enabled) {
                this.notificationQueue.push(notification);
            } else {
                await this.processNotification(notification);
            }
        } catch (error) {
            throw this.handleError(error as Error, 'SERVICE_UNAVAILABLE');
        }
    }

    private async processNotification(notification: Notification): Promise<void> {
        switch (notification.target) {
            case 'overlay':
                await this.handleOverlayNotification(notification);
                break;
            case 'chat':
                await this.handleChatNotification(notification);
                break;
            case 'discord':
                await this.handleDiscordNotification(notification);
                break;
            case 'webhook':
                await this.handleWebhookNotification(notification);
                break;
            default:
                this.services.logger.warn('Unknown notification target', {
                    target: notification.target
                });
        }
    }

    private async handleOverlayNotification(notification: Notification): Promise<void> {
        for (const client of this.overlayClients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(notification));
            }
        }
    }

    private async handleChatNotification(notification: Notification): Promise<void> {
        await this.services.chat.client.say(notification.data.channel, notification.data.message);
    }

    private async handleDiscordNotification(notification: Notification): Promise<void> {
        if (!this.config.discord.webhookUrl) return;

        const response = await fetch(this.config.discord.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(notification.data)
        });

        if (!response.ok) {
            throw new Error(`Discord webhook failed: ${response.statusText}`);
        }
    }

    private async handleWebhookNotification(notification: Notification): Promise<void> {
        const endpoints = this.config.webhooks.endpoints.filter(
            endpoint => endpoint.events.includes(notification.type)
        );

        await Promise.all(endpoints.map(async endpoint => {
            const response = await fetch(endpoint.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(endpoint.secret && { 'X-Webhook-Secret': endpoint.secret })
                },
                body: JSON.stringify(notification)
            });

            if (!response.ok) {
                throw new Error(`Webhook failed: ${response.statusText}`);
            }
        }));
    }

    public isHealthy(): boolean {
        return (
            (!this.config.overlay.enabled || (this.httpServer?.listening ?? false)) &&
            (!this.config.queue.enabled || this.queueInterval !== null)
        );
    }
}
