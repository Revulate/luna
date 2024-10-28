import { Service, ServiceContainer, LoggingConfig } from '../types/services.js';
import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { promises as fs } from 'fs';

export class LoggingService implements Service {
    public readonly config: LoggingConfig;
    public readonly services: ServiceContainer;
    private logger: winston.Logger;

    constructor(config: LoggingConfig = {
        name: 'logging',
        enabled: true,
        level: 'info',
        filePath: './logs',
        format: 'json'
    }, services: ServiceContainer) {
        this.config = config;
        this.services = services;
        this.logger = this.initializeLogger();
    }

    private initializeLogger(): winston.Logger {
        // Create logs directory if it doesn't exist
        const logsDir = this.config.filePath;
        fs.mkdir(logsDir, { recursive: true }).catch(err => {
            console.error('Error creating logs directory:', err);
        });

        // Create Winston logger
        return winston.createLogger({
            level: this.config.level,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                // Console transport
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                }),
                // File transport with rotation
                new winston.transports.DailyRotateFile({
                    filename: path.join(logsDir, '%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: '20m',
                    maxFiles: '14d'
                })
            ]
        });
    }

    async initialize(): Promise<void> {
        this.info('Logging service initialized');
    }

    async cleanup(): Promise<void> {
        this.info('Logging service cleanup');
    }

    // Logging methods
    debug(message: string, meta?: any): void {
        this.logger.debug(this.formatMessage('debug', message, meta));
    }

    info(message: string, meta?: any): void {
        this.logger.info(this.formatMessage('info', message, meta));
    }

    warn(message: string, meta?: any): void {
        this.logger.warn(this.formatMessage('warn', message, meta));
    }

    error(message: string, meta?: any): void {
        this.logger.error(this.formatMessage('error', message, meta));
    }

    async isHealthy(): Promise<boolean> {
        try {
            this.debug('Health check');
            return true;
        } catch (error) {
            return false;
        }
    }

    private formatMessage(level: string, message: string, meta?: any): string {
        const timestamp = new Date().toISOString();
        const emoji = this.getLevelEmoji(level);
        const metaStr = meta ? this.formatMeta(meta) : '';
        
        return `${timestamp} ${emoji} ${level.toUpperCase()}: ${message}${metaStr}`;
    }

    private getLevelEmoji(level: string): string {
        switch (level.toLowerCase()) {
            case 'debug': return '🔍';
            case 'info': return 'ℹ️';
            case 'warn': return '⚠️';
            case 'error': return '❌';
            default: return '📝';
        }
    }

    private formatMeta(meta: any): string {
        if (!meta) return '';
        
        // Handle special cases
        if (meta.error) {
            return ` ⚠️ ${meta.error.message || meta.error}`;
        }

        // Format objects nicely
        const formatted = Object.entries(meta)
            .filter(([_, value]) => value !== undefined)
            .map(([key, value]) => {
                if (typeof value === 'object') {
                    return `${key}: ${JSON.stringify(value, null, 2).replace(/\n/g, '\n  ')}`;
                }
                return `${key}: ${value}`;
            })
            .join(' | ');

        return formatted ? ` (${formatted})` : '';
    }
}
