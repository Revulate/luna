import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ServiceError, ErrorCode } from '../types/errors';

export class UnbanCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'unban',
            description: 'Unban a user from the channel',
            usage: '!unban <user> [reason]',
            category: 'Moderation',
            aliases: ['pardon'],
            cooldown: 1000,
            permissions: ['moderator'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please specify a user to unban.');
        }

        try {
            const targetUser = args[0].replace('@', '');
            const reason = args.slice(1).join(' ') || 'No reason provided';

            // Get target user info
            const userInfo = await services.chat.apiClient.users.getUserByName(targetUser);
            if (!userInfo) {
                throw new Error(`User "${targetUser}" not found.`);
            }

            // Execute unban
            await services.chat.client.unban(channel, targetUser);

            // Log the action
            services.logger.info('User unbanned:', {
                moderator: user.userName,
                target: targetUser,
                reason,
                channel
            });

            // Send confirmation
            await context.reply(
                `unbanned ${userInfo.displayName} (${reason})`
            );

        } catch (error) {
            services.logger.error('Error in unban command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                user: user.userName,
                channel
            });
            throw error;
        }
    }
}
