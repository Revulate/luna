import { ServiceConfig } from './base';
import { DatabaseConfig } from './database';
import { WebPanelConfig } from './webPanel';
import { SevenTvConfig } from './seventv';
import { AIConfig } from './ai';

export interface ConfigService {
    get<T>(path: string): T;
    isHealthy(): boolean;
}

export interface AppConfig {
    twitch: TwitchConfig;
    database: DatabaseConfig;
    ai: AIConfig;
    webPanel: WebPanelConfig;
    events: EventConfig;
    sevenTv: SevenTvConfig;
    weather: WeatherConfig;
    steam: SteamConfig;
}

export interface TwitchConfig extends ServiceConfig {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    channels: string[];
    features: {
        claudeIntegration: boolean;
        gptIntegration: boolean;
        sevenTvIntegration: boolean;
        weatherIntegration: boolean;
        steamIntegration: boolean;
    };
}

export interface EventConfig extends ServiceConfig {
    rateLimit: number;
    checkInterval: number;
    streamAnalysisInterval: number;
    maxQueueSize: number;
    retryAttempts: number;
    retryDelay: number;
}

export interface WeatherConfig extends ServiceConfig {
    apiKey: string;
    cacheTimeout: number;
    units: 'metric' | 'imperial';
}

export interface SteamConfig extends ServiceConfig {
    apiKey: string;
    cacheTimeout: number;
}
