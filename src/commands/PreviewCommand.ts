import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ServiceContainer } from '../types/services';
import { HelixStream, HelixUser } from '@twurple/api';

interface ChannelInfo {
    user: HelixUser;
    channel: any;  // TODO: Add proper type from Twurple
    stream: HelixStream | null;
    lastVideo?: {
        creationDate: Date;
    };
}

export class PreviewCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;
    private readonly retryCount = 3;

    constructor() {
        this.metadata = {
            name: 'preview',
            description: 'Get information about a Twitch channel',
            usage: '!preview <channel>',
            category: 'Twitch',
            aliases: ['channel', 'status'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please provide a channel name to preview.');
        }

        const targetChannel = args[0];

        for (let attempt = 0; attempt < this.retryCount; attempt++) {
            try {
                services.logger.debug(`Getting info for channel '${targetChannel}' (Attempt ${attempt + 1})`);
                const info = await this.getChannelInfo(targetChannel, services);
                
                if (!info || !info.user) {
                    throw new Error(`Channel not found: ${targetChannel}`);
                }

                const response = await this.formatChannelInfo(info);
                await context.reply(response);
                break; // Success, exit retry loop

            } catch (error) {
                services.logger.error(`Attempt ${attempt + 1} failed with error:`, {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    attempt: attempt + 1,
                    channel: targetChannel
                });
                
                if (attempt === this.retryCount - 1) {
                    throw new Error('Failed to fetch channel information.');
                }
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
            }
        }
    }

    private cleanChannelName(channelName: string): string {
        return channelName
            .replace(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\//, '')
            .replace(/[^a-zA-Z0-9_]/g, '')
            .toLowerCase();
    }

    private async getChannelInfo(channelName: string, services: ServiceContainer): Promise<ChannelInfo | null> {
        const cacheKey = `preview:${channelName}`;
        try {
            // Check cache first
            const cachedInfo = await services.database.getCache(cacheKey);
            if (cachedInfo) {
                return cachedInfo;
            }

            const cleanName = this.cleanChannelName(channelName);
            services.logger.debug(`Looking up channel: ${cleanName}`);

            // Use Twurple API methods
            const user = await services.chat.apiClient.users.getUserByName(cleanName);
            if (!user) {
                services.logger.debug(`No user found for channel: ${cleanName}`);
                return null;
            }

            // Get channel info, stream data, and videos concurrently
            const [channel, stream, videos] = await Promise.all([
                services.chat.apiClient.channels.getChannelInfoById(user.id),
                services.chat.apiClient.streams.getStreamByUserId(user.id),
                services.chat.apiClient.videos.getVideosByUser(user.id)
            ]);

            const lastVideo = videos.data.length > 0 ? videos.data[0] : undefined;
            const info: ChannelInfo = { user, channel, stream, lastVideo };

            // Cache the result for 5 minutes
            await services.database.setCache(cacheKey, info, 300);

            // Store in database for historical tracking
            await services.database.logChannelPreview(cleanName, {
                userId: user.id,
                title: channel.title,
                game: channel.gameName,
                isLive: !!stream,
                viewers: stream?.viewers || 0,
                timestamp: new Date().toISOString()
            });

            return info;
        } catch (error) {
            services.logger.error(`Error fetching channel info for ${channelName}:`, error);
            return null;
        }
    }

    private async formatChannelInfo(info: ChannelInfo): Promise<string> {
        const { user, channel, stream, lastVideo } = info;
        const now = new Date();

        if (stream) {
            const duration = stream.startDate ? now.getTime() - stream.startDate.getTime() : null;
            const status = duration ? `LIVE (${this.formatDuration(duration)})` : "LIVE";
            const viewers = stream.viewers ? `${stream.viewers.toLocaleString()} viewers` : "Unknown viewers";
            const thumbnailUrl = stream.thumbnailUrl ? 
                stream.thumbnailUrl.replace("{width}", "1280").replace("{height}", "720") : 
                "No thumbnail available";

            return `twitch.tv/${user.name} | ` +
                   `Status: ${status} | ` +
                   `Viewers: ${viewers} | ` +
                   `Category: ${channel.gameName || "Unknown"} | ` +
                   `Title: ${channel.title || "No title"} | ` +
                   `Preview: ${thumbnailUrl}`;
        } else {
            const status = "OFFLINE";
            let lastLive = "Unknown";
            if (lastVideo) {
                const timeSinceLive = now.getTime() - lastVideo.creationDate.getTime();
                lastLive = this.formatDuration(timeSinceLive);
            }

            return `twitch.tv/${user.name} | ` +
                   `Status: ${status} | ` +
                   `Last Live: ${lastLive} ago | ` +
                   `Category: ${channel.gameName || "Unknown"} | ` +
                   `Title: ${channel.title || "No title"}`;
        }
    }

    private formatDuration(ms: number): string {
        const parts: string[] = [];
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms / (60 * 60 * 1000)) % 24);
        const minutes = Math.floor((ms / (60 * 1000)) % 60);
        const seconds = Math.floor((ms / 1000) % 60);

        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

        return parts.join(" ");
    }
}
