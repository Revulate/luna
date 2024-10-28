import { BaseService } from './BaseService.js';
import { 
    Service,
    ServiceContainer,
    ServiceConfig
} from '../types/index.js';
import { ServiceError, ErrorCode } from '../types/errors.js';
import { 
    GameInfo, 
    GameStats, 
    DVPConfig, 
    GameSearchResult,
    StreamStatus,
    PreparedStatements
} from '../types/dvp.js';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { chromium, Browser, Page } from 'playwright';
import { parse, format } from 'date-fns';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import * as fuzzball from 'fuzzball';
import path from 'path';

export class DVPService extends BaseService implements Service {
    private readonly db: DatabaseType;
    private readonly statements!: PreparedStatements; // Use definite assignment assertion
    private readonly imageUrlCache: Map<string, string>;
    private readonly abbreviationMapping: Record<string, string>;
    private auth: JWT | null = null;
    private sheets: any = null;
    private browser: Browser | null = null;
    private lastScrapeTime: Date | null = null;
    private lastGameImageUpdate: number | null = null;

    constructor(config: DVPConfig, services: ServiceContainer) {
        super(config, services);
        this.db = new Database(config.dbPath);
        this.imageUrlCache = new Map();
        this.abbreviationMapping = {
            'ff7': 'FINAL FANTASY VII REMAKE',
            'ff16': 'FINAL FANTASY XVI',
            // ... other abbreviations
        };
        
        this.setupDatabase();
        this.prepareStatements();
    }

    private setupDatabase(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                time_played INTEGER NOT NULL,
                last_played TEXT NOT NULL,
                image_url TEXT
            );

            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }

    private prepareStatements(): void {
        this.statements = {
            insertGame: this.db.prepare(`
                INSERT OR REPLACE INTO games (name, time_played, last_played, image_url)
                VALUES (?, ?, ?, ?)
            `),
            selectGame: this.db.prepare('SELECT * FROM games WHERE name = ?'),
            updateGameImageUrl: this.db.prepare('UPDATE games SET image_url = ? WHERE name = ?'),
            selectAllGames: this.db.prepare(`
                SELECT * FROM games 
                ORDER BY date(last_played) DESC, time_played DESC
            `),
            getMetadata: this.db.prepare('SELECT value FROM metadata WHERE key = ?'),
            setMetadata: this.db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)'),
            selectActiveGames: this.db.prepare('SELECT * FROM games ORDER BY last_played DESC'),
            updateLastPlayed: this.db.prepare('UPDATE games SET last_played = ? WHERE name = ?')
        };
    }

    private async initializeGoogleAuth(): Promise<void> {
        // Implementation
    }

    private async initializeBrowser(): Promise<void> {
        // Implementation
    }

    private async loadImageUrlCache(): Promise<void> {
        // Implementation
    }

    private async scrapeInitialData(): Promise<void> {
        // Implementation
    }

    private startPeriodicUpdates(): void {
        // Implementation
    }

    public async getGameInfo(gameName: string): Promise<GameInfo | null> {
        // Implementation
    }

    public async initialize(): Promise<void> {
        try {
            await this.initializeGoogleAuth();
            await this.initializeBrowser();
            await this.loadImageUrlCache();
            await this.scrapeInitialData();
            
            this.startPeriodicUpdates();
            
            this.initialized = true;
        } catch (error) {
            throw new ServiceError(
                ErrorCode.INITIALIZATION_FAILED,
                'Failed to initialize DVP service',
                { error: error instanceof Error ? error.message : 'Unknown error' }
            );
        }
    }

    public async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
        }
        this.db.close();
    }

    // Helper method to format durations consistently
    public formatDuration(minutes: number): string {
        const days = Math.floor(minutes / (24 * 60));
        const hours = Math.floor((minutes % (24 * 60)) / 60);
        const remainingMinutes = minutes % 60;

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (remainingMinutes > 0) parts.push(`${remainingMinutes}m`);

        return parts.join(' ') || '0m';
    }

    public async isHealthy(): Promise<boolean> {
        return this.db != null && 
               this.statements != null && 
               this.initialized === true;
    }
}
