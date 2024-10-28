import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ChatUser } from '@twurple/chat';

interface TimeoutDuration {
    value: number;
    unit: string;
    ms: number;
}

export class TimeoutCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;
    private readonly DEFAULT_DURATION = 600; // 10 minutes
    private readonly MAX_DURATION = 1209600; // 14 days
    private readonly TIME_UNITS: Record<string, number> = {
        s: 1,
        m: 60,
        h: 3600,
        d: 86400
    };

    constructor() {
        this.metadata = {
            name: 'timeout',
            description: 'Timeout a user',
            usage: '!timeout <user> [duration] [reason]',
            category: 'Moderation',
            aliases: ['to', 'mute'],
            cooldown: 1000,
            permissions: ['moderator'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please specify a user to timeout.');
        }

        try {
            const targetUser = args[0].replace('@', '');
            const { duration, remainingArgs } = this.parseDuration(args.slice(1));
            const reason = remainingArgs.join(' ') || 'No reason provided';

            // Get target user info
            const userInfo = await services.chat.apiClient.users.getUserByName(targetUser);
            if (!userInfo) {
                throw new Error(`User "${targetUser}" not found.`);
            }

            // Execute timeout
            await services.chat.client.timeout(
                channel,
                targetUser,
                duration.ms / 1000,
                reason
            );

            // Log the action
            services.logger.info('User timeout:', {
                moderator: user.userName,
                target: targetUser,
                duration: `${duration.value}${duration.unit}`,
                reason,
                channel
            });

            // Send confirmation
            await context.reply(
                `@${user.displayName} timed out ${userInfo.displayName} for ` +
                `${duration.value}${duration.unit} (${reason})`
            );

        } catch (error) {
            services.logger.error('Error in timeout command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                user: user.userName,
                channel
            });
            throw error;
        }
    }

    private parseDuration(args: string[]): { duration: TimeoutDuration; remainingArgs: string[] } {
        if (!args.length) {
            return {
                duration: {
                    value: this.DEFAULT_DURATION,
                    unit: 's',
                    ms: this.DEFAULT_DURATION * 1000
                },
                remainingArgs: []
            };
        }

        const durationRegex = /^(\d+)([smhd])?$/i;
        const match = args[0].match(durationRegex);

        if (!match) {
            return {
                duration: {
                    value: this.DEFAULT_DURATION,
                    unit: 's',
                    ms: this.DEFAULT_DURATION * 1000
                },
                remainingArgs: args
            };
        }

        const value = parseInt(match[1]);
        const unit = (match[2] || 's').toLowerCase();
        const seconds = value * (this.TIME_UNITS[unit] || 1);

        // Enforce limits
        const limitedSeconds = Math.min(Math.max(seconds, 1), this.MAX_DURATION);

        return {
            duration: {
                value: limitedSeconds / this.TIME_UNITS[unit],
                unit,
                ms: limitedSeconds * 1000
            },
            remainingArgs: args.slice(1)
        };
    }
}
