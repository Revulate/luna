import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { SevenTvEmote } from '../types/seventv';

export class EmoteCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'emote',
            description: 'Look up information about an emote',
            usage: '!emote <emote_name>',
            category: 'Emotes',
            aliases: ['emotes', 'emotelist'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please provide an emote name to look up.');
        }

        const emoteName = args[0].toLowerCase();
        try {
            // Get channel emotes from 7TV
            const channelName = channel.replace(/^#/, '');
            const twitchUser = await services.chat.apiClient.users.getUserByName(channelName);
            if (!twitchUser) {
                throw new Error('Could not find channel on Twitch.');
            }

            const emotes = await services.sevenTv?.getChannelEmotes(twitchUser.id);
            if (!emotes) {
                throw new Error('Failed to fetch channel emotes.');
            }

            // Find emote
            const foundEmote = emotes.find(emote => 
                emote.name.toLowerCase() === emoteName ||
                emote.aliases.some(alias => alias.toLowerCase() === emoteName)
            );

            if (!foundEmote) {
                throw new Error(`No emote found matching "${emoteName}"`);
            }

            // Get actor details
            let actorName = 'Unknown';
            if (foundEmote.actorId) {
                const actorDetails = await services.sevenTv?.getUserDetailsById(foundEmote.actorId);
                actorName = actorDetails?.displayName || actorDetails?.username || 'Unknown';
            }

            const aliasText = foundEmote.aliases.length > 0 ? 
                foundEmote.aliases.join(', ') : 
                foundEmote.name;

            await context.reply(
                `${foundEmote.name} [${aliasText}] • Added by: ${actorName} • ${foundEmote.urls[0]}`
            );

        } catch (error) {
            services.logger.error('Error in emote command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                emote: emoteName,
                user: user.userName,
                channel
            });
            throw error;
        }
    }
}
