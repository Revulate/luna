import { Service, ServiceConfig, ServiceContainer } from '../types/services.js';
import { ServiceError, ErrorCode } from '../types/errors.js';
import dotenv from 'dotenv';
import path from 'path';
import { promises as fs } from 'fs';

interface ConfigServiceConfig extends ServiceConfig {
    configPath: string;
    autoReload?: boolean;
    reloadInterval?: number;
}

const REQUIRED_ENV_VARS = [
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'TWITCH_ACCESS_TOKEN',
    'TWITCH_REFRESH_TOKEN',
    'TWITCH_CHANNELS'
];

export class ConfigService implements Service {
    public readonly config: ConfigServiceConfig;
    public readonly services: ServiceContainer;
    private configData: Map<string, any> = new Map();
    private watchInterval: NodeJS.Timeout | null = null;

    constructor(config: ConfigServiceConfig, services: ServiceContainer) {
        this.config = config;
        this.services = services;
    }

    async initialize(): Promise<void> {
        await this.loadConfig();
        this.validateRequiredVars();

        if (this.config.autoReload && this.config.reloadInterval) {
            this.watchInterval = setInterval(() => {
                void this.loadConfig();
            }, this.config.reloadInterval);
        }

        const channels = this.get<string>('TWITCH_CHANNELS', '');
        this.services.logger.info('Config service initialized with values:', {
            twitch: {
                clientId: this.maskSecret(this.get('TWITCH_CLIENT_ID')),
                channels: channels ? channels.split(',') : [],
                hasAccessToken: !!this.get('TWITCH_ACCESS_TOKEN'),
                hasRefreshToken: !!this.get('TWITCH_REFRESH_TOKEN')
            }
        });
    }

    private async loadConfig(): Promise<void> {
        try {
            const configExists = await fs.access(this.config.configPath)
                .then(() => true)
                .catch(() => false);

            if (!configExists) {
                throw new ServiceError(
                    ErrorCode.CONFIG_MISSING,
                    `Config file not found at ${this.config.configPath}`
                );
            }

            const result = dotenv.config({ path: this.config.configPath });
            
            if (result.error) {
                throw new ServiceError(
                    ErrorCode.CONFIG_INVALID,
                    `Failed to parse config file: ${result.error.message}`
                );
            }

            // Store all environment variables in the map
            for (const [key, value] of Object.entries(process.env)) {
                if (value !== undefined) {
                    this.configData.set(key, value);
                }
            }
        } catch (error) {
            this.services.logger.error('Failed to load config:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                path: this.config.configPath
            });
            throw error;
        }
    }

    private validateRequiredVars(): void {
        const missing = REQUIRED_ENV_VARS.filter(varName => !this.get(varName));
        
        if (missing.length > 0) {
            throw new ServiceError(
                ErrorCode.CONFIG_MISSING,
                `Missing required environment variables: ${missing.join(', ')}`
            );
        }
    }

    private maskSecret(value: string | undefined): string {
        if (!value) return '';
        if (value.length <= 8) return '*'.repeat(value.length);
        return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
    }

    get<T>(key: string, defaultValue?: T): T {
        const value = this.configData.get(key);
        return (value !== undefined ? value : defaultValue) as T;
    }

    set(key: string, value: any): void {
        this.configData.set(key, value);
    }

    async cleanup(): Promise<void> {
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
            this.watchInterval = null;
        }
    }

    async isHealthy(): Promise<boolean> {
        return REQUIRED_ENV_VARS.every(varName => !!this.get(varName));
    }
}
