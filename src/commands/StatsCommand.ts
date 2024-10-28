import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ServiceContainer } from '../types/services';
import os from 'os';

interface ServiceHealth {
    database: boolean;
    messageLogger: boolean;
    chat: boolean;
    api: boolean;
    webPanel: boolean;
    commands: boolean;
}

interface QueryResult {
    size?: number;
    count?: number;
}

interface ChannelStats {
    messageCount: number;
    uniqueUsers: number;
}

export class StatsCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'stats',
            description: 'Show bot and channel statistics',
            usage: '!stats or !channelstats',
            category: 'System',
            aliases: ['botstats', 'ping', 'channelstats', 'chatstats'],
            cooldown: 10000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { services, args, user, channel } = context;
        const command = args[0]?.toLowerCase();
        
        try {
            // Handle different stat types based on command alias
            if (['channelstats', 'chatstats'].includes(command)) {
                await this.handleChannelStats(context);
            } else {
                await this.handleBotStats(context);
            }
        } catch (error) {
            services.logger.error('Error in stats command:', {
                error: error.message,
                stack: error instanceof Error ? error.stack : undefined,
                user: user.userName,
                channel
            });
            throw new Error('Failed to fetch stats.');
        }
    }

    private async handleBotStats(context: CommandContext): Promise<void> {
        const { services } = context;
        const cacheKey = 'bot:stats';

        try {
            // Check cache first
            const cachedStats = await services.database.getCache(cacheKey);
            if (cachedStats) {
                await context.reply(cachedStats);
                return;
            }

            // Get system stats
            const uptime = process.uptime() * 1000;
            const memoryUsage = process.memoryUsage();
            const systemMemory = os.totalmem();
            
            // Get database stats using typed queries
            const dbSizeResult = await services.database.query<QueryResult>('SELECT page_count * page_size as size FROM pragma_page_count, pragma_page_size');
            const dbSize = dbSizeResult[0]?.size || 0;
            
            const messageCountResult = await services.database.query<QueryResult>('SELECT COUNT(*) as count FROM messages');
            const messageCount = messageCountResult[0]?.count || 0;
            
            const uniqueUsersResult = await services.database.query<QueryResult>('SELECT COUNT(DISTINCT user_id) as count FROM messages');
            const uniqueUsers = uniqueUsersResult[0]?.count || 0;
            
            const cacheStatsResult = await services.database.query<QueryResult>('SELECT COUNT(*) as count FROM memory WHERE type = ?', ['cache']);
            const cacheStats = { keys: cacheStatsResult[0]?.count || 0 };

            // Get health status
            const healthStatus = await this.getHealthStatus(services);

            services.logger.info('Generated health status', {
                context: 'stats',
                health: healthStatus,
                uptime: this.formatDuration(uptime),
                memory: this.formatBytes(memoryUsage.heapUsed),
                messages: messageCount,
                users: uniqueUsers
            });

            // Format response
            const response = `Bot Stats: ` +
                `⌚ Uptime: ${this.formatDuration(uptime)} • ` +
                `💾 DB Size: ${this.formatBytes(dbSize)} • ` +
                `📝 Messages: ${messageCount.toLocaleString()} • ` +
                `👥 Users: ${uniqueUsers.toLocaleString()} • ` +
                `🧠 Memory: ${this.formatBytes(memoryUsage.heapUsed)}/${this.formatBytes(systemMemory)} • ` +
                `📊 Cache: ${cacheStats.keys} items • ` +
                `🚦 Health: ${healthStatus}`;

            // Cache for 1 minute
            await services.database.setCache(cacheKey, response, 60);
            
            await context.reply(response);

        } catch (error) {
            throw error;
        }
    }

    private async handleChannelStats(context: CommandContext): Promise<void> {
        const { services, channel, user } = context;
        const cacheKey = `channelstats:${channel}`;

        try {
            // Check cache first
            const cachedStats = await services.database.getCache(cacheKey);
            if (cachedStats) {
                await context.reply(cachedStats);
                return;
            }

            services.logger.debug('Fetching channel stats', {
                context: 'stats',
                channel,
                user: user.userName
            });

            // Get channel info
            const channelUser = await services.chat.apiClient.users.getUserByName(channel.replace(/^#/, ''));
            if (!channelUser) {
                services.logger.warn('Channel not found', {
                    context: 'stats',
                    channel
                });
                throw new Error('Channel not found');
            }

            // Get stream info
            const stream = await services.chat.apiClient.streams.getStreamByUserId(channelUser.id);
            
            // Get channel stats from database
            const stats = await services.database.getChatStats(channel);
            if (!stats) {
                services.logger.warn('No stats available', {
                    context: 'stats',
                    channel
                });
                throw new Error('No stats available for this channel');
            }

            // Format response
            let response = `Channel Stats: `;

            if (stream) {
                const uptime = Date.now() - new Date(stream.startDate).getTime();
                response += `🟢 LIVE for ${this.formatDuration(uptime)} • ${stream.viewers.toLocaleString()} viewers • `;
            }

            response += `${stats.messageCount.toLocaleString()} messages • ${stats.uniqueUsers.toLocaleString()} chatters`;

            services.logger.debug('Channel stats generated', {
                context: 'stats',
                channel,
                stats: {
                    messages: stats.messageCount,
                    users: stats.uniqueUsers,
                    isLive: !!stream
                }
            });

            // Cache for 5 minutes
            await services.database.setCache(cacheKey, response, 300);
            
            await context.reply(response);

        } catch (error) {
            throw error;
        }
    }

    private async getHealthStatus(services: ServiceContainer): Promise<string> {
        // First get all health statuses
        const healthChecks = await Promise.all([
            services.database.isHealthy(),
            services.messageLogger?.isHealthy() ?? false,
            services.chat.isConnected(),
            Promise.resolve(!!services.chat.apiClient),
            services.webPanel?.isHealthy() ?? false,
            Promise.resolve(true) // commands
        ]);

        const status: ServiceHealth = {
            database: healthChecks[0],
            messageLogger: healthChecks[1],
            chat: healthChecks[2],
            api: healthChecks[3],
            webPanel: healthChecks[4],
            commands: healthChecks[5]
        };

        return Object.entries(status)
            .map(([service, isHealthy]) => `${service}: ${isHealthy ? '✅' : '❌'}`)
            .join(' • ');
    }

    private formatBytes(bytes: number): string {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
}
