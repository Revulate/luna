import { ServiceContainer } from './services/ServiceContainer.js';
import { LoggingService } from './services/LoggingService.js';
import { ConfigService } from './services/ConfigService.js';
import { DatabaseService } from './services/DatabaseService.js';
import { TwitchService } from './services/TwitchService.js';
import { ChatService } from './services/ChatService.js';
import { CommandService } from './services/CommandService.js';
import { ServiceMonitor } from './services/ServiceMonitor.js';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    const container = new ServiceContainer();
    
    console.log('Adding services to container');
    
    // First, add logging service
    const loggingService = new LoggingService({
        name: 'logging',
        enabled: true,
        level: process.env.LOG_LEVEL || 'info',
        filePath: path.join(process.cwd(), 'logs'),
        format: 'json'
    }, container);
    container.addService('logging', loggingService);
    await loggingService.initialize();

    // Then config service
    const configService = new ConfigService({
        name: 'config',
        enabled: true,
        configPath: path.join(process.cwd(), '.env')
    }, container);
    container.addService('config', configService);
    await configService.initialize();

    // Add database service
    container.addService('database', new DatabaseService({
        name: 'database',
        enabled: true,
        filename: './bot.db',
        options: { verbose: true }
    }, container));

    // Add twitch service with proper auth config
    container.addService('twitch', new TwitchService({
        name: 'twitch',
        enabled: true,
        clientId: process.env.TWITCH_CLIENT_ID!,
        clientSecret: process.env.TWITCH_CLIENT_SECRET!,
        accessToken: process.env.TWITCH_ACCESS_TOKEN!,
        refreshToken: process.env.TWITCH_REFRESH_TOKEN!,
        channels: process.env.TWITCH_CHANNELS?.split(',').filter(Boolean) || [],
        botNick: process.env.BOT_NICK,
        isAlwaysMod: process.env.IS_ALWAYS_MOD === 'true',
        requestMembership: process.env.REQUEST_MEMBERSHIP !== 'false'
    }, container));

    // Add chat service
    container.addService('chat', new ChatService({
        name: 'chat',
        enabled: true,
        clientId: process.env.TWITCH_CLIENT_ID!,
        clientSecret: process.env.TWITCH_CLIENT_SECRET!,
        accessToken: process.env.TWITCH_ACCESS_TOKEN!,
        refreshToken: process.env.TWITCH_REFRESH_TOKEN!,
        channels: (process.env.TWITCH_CHANNELS || '').split(','),
        connection: {
            secure: true,
            reconnect: true,
            maxReconnectAttempts: 3,
            maxReconnectInterval: 30000
        }
    }, container));

    // Add command service
    container.addService('command', new CommandService({
        name: 'command',
        enabled: true,
        prefix: process.env.COMMAND_PREFIX || '#',
        aliases: {},
        cooldowns: {},
        rateLimit: {
            maxCommands: 5,
            window: 60000
        },
        cooldown: {
            default: 3000,
            commands: {}
        }
    }, container));

    // Add monitor service
    container.addService('monitor', new ServiceMonitor({
        name: 'monitor',
        enabled: true,
        checkInterval: 60000,
        eventQueueSize: 1000,
        retryAttempts: 3,
        retryDelay: 5000
    }, container));

    // Initialize all services in order
    console.log('Services added, starting initialization');
    await container.initialize();

    // Run initial health check
    try {
        const monitor = container.getService('monitor');
        if (!monitor) {
            loggingService.warn('Monitor service not available, skipping health check');
            return;
        }

        const healthReport = await monitor.checkHealth();
        loggingService.info('Initial health check:', { report: healthReport });
    } catch (error) {
        loggingService.error('Health check failed:', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Don't exit on health check failure
    }
}

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

main().catch(error => {
    console.error('Fatal error during startup:', error);
    process.exit(1);
});
