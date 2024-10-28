import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ChatUser } from '@twurple/chat';

export class BanCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'ban',
            description: 'Ban a user from the channel',
            usage: '!ban <username> [reason]',
            category: 'Moderation',
            aliases: ['b'],
            cooldown: 3000,
            permissions: ['moderator'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please specify a user to ban.');
        }

        try {
            const targetUser = args[0].replace('@', '');
            const reason = args.slice(1).join(' ') || 'No reason provided';

            // Get target user info
            const userInfo = await services.chat.apiClient.users.getUserByName(targetUser);
            if (!userInfo) {
                throw new Error(`User "${targetUser}" not found.`);
            }

            // Execute ban
            await services.chat.client.ban(channel, targetUser, reason);

            // Log the action
            services.logger.info('User banned:', {
                moderator: user.userName,
                target: targetUser,
                reason,
                channel
            });

            // Send confirmation
            await context.reply(
                `@${user.displayName} banned ${userInfo.displayName} (${reason})`
            );

        } catch (error) {
            services.logger.error('Error in ban command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                user: user.userName,
                channel
            });
            throw error;
        }
    }
}
