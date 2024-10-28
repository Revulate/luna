import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ServiceError, ErrorCode } from '../types/errors';

export class VipCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'vip',
            description: 'Add or remove VIP status from a user',
            usage: '!vip <add/remove> <user>',
            category: 'Moderation',
            aliases: ['addvip', 'removevip'],
            cooldown: 1000,
            permissions: ['moderator'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        const command = args[0]?.toLowerCase();
        
        if (!args.length) {
            throw new Error('Please specify an action (add/remove) and a user.');
        }

        try {
            let action: 'add' | 'remove';
            let targetUser: string;

            if (command === 'vip') {
                if (args.length < 2) {
                    throw new Error('Usage: !vip <add/remove> <user>');
                }
                action = this.parseAction(args[0]);
                targetUser = args[1];
            } else {
                action = command === 'addvip' ? 'add' : 'remove';
                targetUser = args[0];
            }

            targetUser = targetUser.replace('@', '');

            // Get target user info
            const userInfo = await services.chat.apiClient.users.getUserByName(targetUser);
            if (!userInfo) {
                throw new Error(`User "${targetUser}" not found.`);
            }

            // Execute VIP action
            if (action === 'add') {
                await services.chat.client.say(channel, `/vip ${targetUser}`);
                await context.reply(
                    `added VIP status to ${userInfo.displayName}`
                );
            } else {
                await services.chat.client.say(channel, `/unvip ${targetUser}`);
                await context.reply(
                    `removed VIP status from ${userInfo.displayName}`
                );
            }

            // Log the action
            services.logger.info('VIP status changed:', {
                moderator: user.userName,
                target: targetUser,
                action,
                channel
            });

        } catch (error) {
            services.logger.error('Error in VIP command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                user: user.userName,
                channel
            });
            throw error;
        }
    }

    private parseAction(action: string): 'add' | 'remove' {
        const normalizedAction = action.toLowerCase();
        if (normalizedAction === 'add' || normalizedAction === '+') return 'add';
        if (normalizedAction === 'remove' || normalizedAction === '-') return 'remove';
        throw new Error('Invalid action. Use "add" or "remove".');
    }
}
