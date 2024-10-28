import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseConfig } from '../types/database';
import type { Database as DatabaseType } from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TableSchema {
    name: string;
    sql: string;
}

interface Migration {
    version: number;
    up: (db: DatabaseType) => void;
}

const TABLES: TableSchema[] = [
    {
        name: 'messages',
        sql: `
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel TEXT NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                metadata TEXT,
                UNIQUE(channel, user_id, timestamp)
            )
        `
    },
    {
        name: 'conversation_threads',
        sql: `
            CREATE TABLE IF NOT EXISTS conversation_threads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_message_at INTEGER,
                metadata TEXT
            )
        `
    },
    {
        name: 'thread_messages',
        sql: `
            CREATE TABLE IF NOT EXISTS thread_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                metadata TEXT,
                FOREIGN KEY(thread_id) REFERENCES conversation_threads(id)
            )
        `
    },
    {
        name: 'users',
        sql: `
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                display_name TEXT,
                created_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                metadata TEXT
            )
        `
    },
    {
        name: 'memory',
        sql: `
            CREATE TABLE IF NOT EXISTS memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                context TEXT,
                timestamp INTEGER NOT NULL,
                expires_at INTEGER,
                UNIQUE(type, key)
            )
        `
    }
];

const INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel)',
    'CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_threads_user ON conversation_threads(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_threads_channel ON conversation_threads(channel)',
    'CREATE INDEX IF NOT EXISTS idx_thread_messages_thread ON thread_messages(thread_id)',
    'CREATE INDEX IF NOT EXISTS idx_memory_type_key ON memory(type, key)',
    'CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory(expires_at)'
];

async function initializeDatabase(config: DatabaseConfig): Promise<void> {
    const db = new Database(config.filename, config.options);

    try {
        // Enable WAL mode for better concurrency
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');

        // Create tables
        for (const table of TABLES) {
            console.log(`Creating table: ${table.name}`);
            db.exec(table.sql);
        }

        // Create indexes
        for (const index of INDEXES) {
            console.log('Creating index:', index);
            db.exec(index);
        }

        // Verify tables were created
        const tables = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).all();

        console.log('Created tables:', tables.map(t => t.name));

        // Add any necessary migrations here
        await runMigrations(db);

    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    } finally {
        db.close();
    }
}

async function runMigrations(db: DatabaseType): Promise<void> {
    const migrations: Migration[] = [
        // Add migrations here as needed
    ];

    // Get current schema version
    const version = db.pragma('user_version', { simple: true });

    // Apply needed migrations
    for (const migration of migrations) {
        if (migration.version > version) {
            console.log(`Applying migration ${migration.version}`);
            migration.up(db);
            db.pragma(`user_version = ${migration.version}`);
        }
    }
}

// Export for use in other files
export { initializeDatabase };

// Allow running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const config: DatabaseConfig = {
        name: 'database',  // Add missing name property
        filename: process.env.DB_PATH || 'bot.db',
        enabled: true,
        options: {
            verbose: true
        },
        cache: {
            defaultTTL: 3600,
            checkPeriod: 600,
            maxKeys: 10000
        },
        maintenance: {
            enabled: true,
            interval: 3600000,
            messageRetention: 7
        }
    };

    initializeDatabase(config)
        .then(() => console.log('Database initialization complete'))
        .catch(error => {
            console.error('Database initialization failed:', error);
            process.exit(1);
        });
}
