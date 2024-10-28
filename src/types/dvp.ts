import { ServiceConfig } from './base.js';
import { TwitchEventManager } from '../services/twitch/TwitchEventManager.js';
import { ApiClient } from '@twurple/api';
import { Logger } from 'winston';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Browser } from 'playwright';

export interface GameInfo {
    id: string;
    name: string;
    timePlayed: number;
    lastPlayed: Date;
    imageUrl?: string;
    metadata?: GameMetadata;
}

export interface GameMetadata {
    source?: string;
    scraped?: boolean;
    lastUpdate?: Date;
    platform?: string;
    abbreviations?: string[];
    [key: string]: any;
}

export interface GameStats {
    total: number;
    completed: number;
    inProgress: number;
    planned: number;
    dropped: number;
    totalPlayTime: number;
    averageRating: number;
    platformBreakdown: Record<string, number>;
    monthlyProgress: Array<{
        month: string;
        completed: number;
        added: number;
    }>;
}

export interface DVPConfig extends ServiceConfig {
    channelName: string;
    sheetId: string;
    credsFile: string;
    dbPath: string;
    updateInterval: number;
    cacheTimeout: number;
    scopes: string[];
}

export interface PreparedStatements {
    insertGame: any;
    selectGame: any;
    updateGameImageUrl: any;
    selectAllGames: any;
    getMetadata: any;
    setMetadata: any;
    selectActiveGames: any;
    updateLastPlayed: any;
}

export interface DVPDependencies {
    twitchEventManager: TwitchEventManager;
    apiClient: ApiClient;
    logger: Logger;
    auth: JWT;
    sheets: typeof google.sheets;
    browser?: Browser;
}

export interface AbbreviationMapping {
    [key: string]: string;
}

export interface ImageCache {
    url: string;
    lastUpdated: Date;
}

export interface StreamStatus {
    isLive: boolean;
    lastLive?: Date;
    game?: string;
}

export interface SheetFormatting {
    backgroundColor: {
        red: number;
        green: number;
        blue: number;
        alpha: number;
    };
    textFormat: {
        foregroundColor: {
            red: number;
            green: number;
            blue: number;
        };
        fontSize: number;
        bold?: boolean;
        italic?: boolean;
    };
    horizontalAlignment: string;
    verticalAlignment: string;
}

export interface GameSearchResult {
    game: GameInfo;
    scores: {
        exactMatch: number;
        mainTitleExact: number;
        partialRatio: number;
        tokenSortRatio: number;
        tokenSetRatio: number;
        lengthPenalty: number;
        wordMatchBonus: number;
        commonWordPenalty: number;
    };
    totalScore: number;
}

// Add this export
export { DVPService } from '../services/DVPService.js';
