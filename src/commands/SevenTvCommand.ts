import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ServiceError } from '../errors/ServiceError';
import { ErrorCode } from '../errors/ErrorCode';

interface EmoteInfo {
    name: string;
    creator: string;
    tags: Array<'ANIMATED' | 'ZERO_WIDTH'>;
    appUrl: string;
    cdnUrl: string;
}

export class SevenTvCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: '7tv',
            description: 'Search and manage 7TV emotes',
            usage: '!7tv search/animated/zero/trending <query> or !emote <emote_name>',
            category: 'Emotes',
            aliases: ['seventv', 'emote'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { user, args, services } = context;
        const command = args[0]?.toLowerCase();
        
        if (!args.length) {
            throw new Error('Usage: !7tv search/animated/zero/trending <query> or !emote <emote_name>');
        }

        // Handle emote lookup vs 7TV search
        if (command === 'emote') {
            await this.handleEmoteCommand(context);
        } else {
            const [subCommand, ...searchTerms] = args;
            const query = searchTerms.join(' ');

            switch (subCommand.toLowerCase()) {
                case 'search':
                    await this.handleSearch(context, query);
                    break;
                case 'animated':
                    await this.handleAnimated(context, query);
                    break;
                case 'zero':
                    await this.handleZeroWidth(context, query);
                    break;
                case 'trending':
                    await this.handleTrending(context, query);
                    break;
                default:
                    throw new Error('Invalid subcommand. Use: search, animated, zero, or trending');
            }
        }
    }

    private async handleEmoteCommand(context: CommandContext): Promise<void> {
        const { user, args, channel, services } = context;

        if (!args.length) {
            throw new Error('Usage: !emote <emote_name>');
        }

        if (!services.sevenTv) {
            throw new Error('7TV service is not available');
        }

        const emoteName = args.join(' ');
        services.logger.info(`User ${user.userName} requested emote: ${emoteName} in channel: ${channel}`);

        const channelName = channel.replace(/^#/, '');
        const twitchUser = await services.chat.apiClient.users.getUserByName(channelName);
        if (!twitchUser) {
            throw new Error('Channel not found on Twitch');
        }

        const emotes = await services.sevenTv.getChannelEmotes(twitchUser.id);
        const foundEmote = emotes.find(emote => 
            emote.name.toLowerCase() === emoteName.toLowerCase() ||
            emote.aliases.some(alias => alias.toLowerCase() === emoteName.toLowerCase())
        );

        if (!foundEmote) {
            services.logger.warn(`Emote not found: ${emoteName} for user: ${user.userName}`);
            throw new Error(`No emote found matching "${emoteName}"`);
        }

        services.logger.debug(`Found emote: ${foundEmote.name} by ${foundEmote.owner?.displayName}`);

        // Get actor details if available
        let actorName = 'Unknown';
        if (foundEmote.actorId) {
            const actorDetails = await services.sevenTv.getUserDetailsById(foundEmote.actorId);
            actorName = actorDetails.displayName || actorDetails.username || 'Unknown';
        }

        const aliasText = foundEmote.aliases.length > 0 ? foundEmote.aliases.join(', ') : foundEmote.name;
        await context.reply(
            `${foundEmote.name} [${aliasText}] • Added by: ${actorName} • ${foundEmote.urls[0]}`
        );
    }

    private async handleSearch(context: CommandContext, query: string): Promise<void> {
        const { services } = context;
        if (!query) {
            throw new Error('Usage: !7tv search <query>');
        }

        if (!services.sevenTv) {
            throw new Error('7TV service is not available');
        }

        const emotes = await services.sevenTv.getEmotesByQuery(query);
        if (!emotes.length) {
            throw new Error(`No emotes found for "${query}"`);
        }

        const formattedEmotes = emotes
            .slice(0, 5)
            .map(emote => {
                const info = this.formatEmoteInfo(emote);
                return `${info.name} - ${info.appUrl}`;
            })
            .join(' | ');

        await context.reply(`Found: ${formattedEmotes}`);
    }

    private async handleAnimated(context: CommandContext, query: string): Promise<void> {
        const { services } = context;
        if (!query) {
            throw new Error('Usage: !7tv animated <query>');
        }

        if (!services.sevenTv) {
            throw new Error('7TV service is not available');
        }

        const emotes = await services.sevenTv.getEmotesByQuery(query);
        const animatedEmotes = emotes.filter(e => e.animated);

        if (!animatedEmotes.length) {
            throw new Error(`No animated emotes found for "${query}"`);
        }

        const formattedEmotes = animatedEmotes
            .slice(0, 5)
            .map(emote => emote.name)
            .join(', ');

        await context.reply(`Animated emotes: ${formattedEmotes}`);
    }

    private async handleZeroWidth(context: CommandContext, query: string): Promise<void> {
        const { services } = context;
        if (!query) {
            throw new Error('Usage: !7tv zero <query>');
        }

        if (!services.sevenTv) {
            throw new Error('7TV service is not available');
        }

        const emotes = await services.sevenTv.getEmotesByQuery(query);
        const zeroWidthEmotes = emotes.filter(e => e.flags & 1);

        if (!zeroWidthEmotes.length) {
            throw new Error(`No zero-width emotes found for "${query}"`);
        }

        const formattedEmotes = zeroWidthEmotes
            .slice(0, 5)
            .map(emote => emote.name)
            .join(', ');

        await context.reply(`Zero-width emotes: ${formattedEmotes}`);
    }

    private async handleTrending(context: CommandContext, query: string): Promise<void> {
        const { services } = context;
        if (!query) {
            throw new Error('Usage: !7tv trending <query>');
        }

        if (!services.sevenTv) {
            throw new Error('7TV service is not available');
        }

        const emotes = await services.sevenTv.getEmotesByQuery(query, 'TRENDING_DESC');
        if (!emotes.length) {
            throw new Error(`No trending emotes found for "${query}"`);
        }

        const formattedEmotes = emotes
            .slice(0, 5)
            .map(emote => emote.name)
            .join(', ');

        await context.reply(`Trending emotes: ${formattedEmotes}`);
    }

    private formatEmoteInfo(emote: any): EmoteInfo {
        const tags: Array<'ANIMATED' | 'ZERO_WIDTH'> = [];
        if (emote.animated) tags.push('ANIMATED');
        if (emote.flags & 1) tags.push('ZERO_WIDTH');

        return {
            name: emote.name,
            creator: emote.owner?.displayName || 'Unknown',
            tags,
            appUrl: `https://7tv.app/emotes/${emote.id}`,
            cdnUrl: `https://cdn.7tv.app/emote/${emote.id}/4x`
        };
    }
}
