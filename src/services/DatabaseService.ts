import { Service, ServiceConfig, ServiceContainer, DatabaseConfig } from '../types/services.js';
import { ServiceError, ErrorCode } from '../types/errors.js';
import BetterSqlite3 from 'better-sqlite3';
import NodeCache from 'node-cache';
import path from 'path';
import { promises as fs } from 'fs';

// Define default config
const DEFAULT_DATABASE_CONFIG: DatabaseConfig = {
    name: 'database',
    enabled: true,
    filename: './bot.db',
    options: {
        verbose: false
    },
    cache: {
        defaultTTL: 300,
        checkPeriod: 60,
        maxKeys: 1000,
        useClones: true
    },
    maintenance: {
        enabled: true,
        interval: 3600000,
        messageRetention: 30
    }
};

export class DatabaseService implements Service {
    public readonly config: DatabaseConfig;
    public readonly services: ServiceContainer;
    private db: BetterSqlite3.Database | null = null;
    private cache: NodeCache;
    private statements: Map<string, BetterSqlite3.Statement> = new Map();
    private maintenanceInterval: NodeJS.Timeout | null = null;

    constructor(config: Partial<DatabaseConfig>, services: ServiceContainer) {
        this.config = {
            ...DEFAULT_DATABASE_CONFIG,
            ...config
        };
        this.services = services;

        // Initialize cache
        this.cache = new NodeCache({
            stdTTL: this.config.cache.defaultTTL,
            checkperiod: this.config.cache.checkPeriod,
            maxKeys: this.config.cache.maxKeys,
            useClones: this.config.cache.useClones
        });
    }

    async initialize(): Promise<void> {
        try {
            // Ensure database directory exists
            const dbDir = path.dirname(this.config.filename);
            await fs.mkdir(dbDir, { recursive: true });

            // Initialize database connection with proper error handling
            try {
                this.db = new BetterSqlite3(this.config.filename, {
                    verbose: this.config.options.verbose ? 
                        msg => this.services.logger.debug('SQLite:', { message: msg }) : 
                        undefined
                });

                // Enable WAL mode and other pragmas
                this.db.pragma('journal_mode = WAL');
                this.db.pragma('synchronous = NORMAL');
                this.db.pragma('foreign_keys = ON');

                // Initialize schema
                await this.initializeSchema();
                
                // Start maintenance if enabled
                if (this.config.maintenance.enabled) {
                    this.startMaintenance();
                }

                this.services.logger.info('Database service initialized successfully', {
                    context: 'database',
                    filename: this.config.filename
                });
            } catch (dbError) {
                throw new ServiceError(
                    ErrorCode.SERVICE_UNAVAILABLE,
                    'Failed to initialize database connection',
                    'database',
                    { error: dbError instanceof Error ? dbError.message : 'Unknown error' }
                );
            }
        } catch (error) {
            this.services.logger.error('Failed to initialize database service:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }

    private async initializeSchema(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        const queries = [
            // Users table
            `CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                display_name TEXT,
                afk_status TEXT,
                afk_timestamp INTEGER,
                steam_id TEXT,
                last_updated INTEGER,
                metadata TEXT,
                UNIQUE(username)
            )`,

            // Messages table
            `CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel TEXT NOT NULL,
                user_id TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                metadata TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )`,

            // Indexes
            'CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel)',
            'CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
            'CREATE INDEX IF NOT EXISTS idx_users_last_updated ON users(last_updated)'
        ];

        for (const query of queries) {
            try {
                this.db.exec(query);
            } catch (error) {
                throw new ServiceError(
                    ErrorCode.DATABASE_ERROR,
                    'Failed to initialize database schema',
                    'database',
                    { error: error instanceof Error ? error.message : 'Unknown error', query }
                );
            }
        }
    }

    public async query<T>(sql: string, params: any[] = []): Promise<T> {
        if (!this.db) {
            throw new ServiceError(
                ErrorCode.SERVICE_UNAVAILABLE,
                'Database not initialized',
                'database'
            );
        }

        try {
            const stmt = this.db.prepare(sql);
            return stmt.get(...params) as T;
        } catch (error) {
            throw new ServiceError(
                ErrorCode.DATABASE_ERROR,
                'Database query failed',
                'database',
                { error: error instanceof Error ? error.message : 'Unknown error', sql, params }
            );
        }
    }

    async isHealthy(): Promise<boolean> {
        try {
            if (!this.db) return false;
            const result = await this.query('SELECT 1');
            return !!result;
        } catch {
            return false;
        }
    }

    async cleanup(): Promise<void> {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = null;
        }

        this.cache.flushAll();
        
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    private startMaintenance(): void {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
        }

        this.maintenanceInterval = setInterval(() => {
            this.performMaintenance().catch(error => {
                this.services.logger.error('Database maintenance error:', {
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            });
        }, this.config.maintenance.interval);
    }

    private async performMaintenance(): Promise<void> {
        if (!this.db) return;

        const now = Date.now();
        const retentionCutoff = now - (this.config.maintenance.messageRetention * 24 * 60 * 60 * 1000);

        try {
            // Clean old messages
            this.db.prepare('DELETE FROM messages WHERE timestamp < ?').run(retentionCutoff);

            // Vacuum database periodically
            if (Math.random() < 0.1) { // 10% chance each maintenance run
                this.db.pragma('vacuum');
            }

            this.services.logger.debug('Database maintenance completed');
        } catch (error) {
            this.services.logger.error('Database maintenance failed:', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
