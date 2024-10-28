import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { HelixUser } from '@twurple/api';

interface MessageData {
    username: string;
    message: string;
    timestamp: number;
}

export class MessageLookupCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'lookup',
            description: 'Look up recent messages from a user',
            usage: '!lookup <username> [count]',
            category: 'Moderation',
            aliases: [
                'message', 'lastmsg',  // Lookup aliases
                'history', 'messages', 'logs' // History aliases
            ],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { user, args } = context;
        const command = args[0]?.toLowerCase();
        
        try {
            // Handle different lookup types
            if (['history', 'messages', 'logs'].includes(command)) {
                await this.handleHistoryCommand(context);
            } else {
                await this.handleLookupCommand(context);
            }
        } catch (error) {
            context.services.logger.error('Error in message lookup:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                command,
                user: user.userName
            });
            throw error;
        }
    }

    private async handleLookupCommand(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please provide a username to look up messages for.');
        }

        const targetUser = args[0].replace('@', '').toLowerCase();
        const limit = args[1] ? Math.min(parseInt(args[1]), 10) : 5; // Cap at 10 messages

        try {
            // Try to get Twitch user info first
            const twitchUser = await services.chat.apiClient.users.getUserByName(targetUser);
            if (!twitchUser) {
                throw new Error(`User "${targetUser}" not found on Twitch.`);
            }

            const messages = await services.database.query<MessageData[]>(
                'SELECT * FROM messages WHERE channel = ? AND username = ? ORDER BY timestamp DESC LIMIT ?',
                [channel, targetUser, limit]
            );

            if (!messages.length) {
                throw new Error(`No recent messages found from ${twitchUser.displayName}.`);
            }

            const latestMessage = messages[0];
            await context.reply(
                `Last message from ${twitchUser.displayName}: "${latestMessage.message}"`
            );

        } catch (error) {
            throw error;
        }
    }

    private async handleHistoryCommand(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please provide a username to look up history for.');
        }

        const targetUser = args[0].replace('@', '').toLowerCase();
        const limit = args[1] ? Math.min(parseInt(args[1]), 20) : 10; // Cap at 20 messages

        try {
            // Get Twitch user info
            const twitchUser = await services.chat.apiClient.users.getUserByName(targetUser);
            if (!twitchUser) {
                throw new Error(`User "${targetUser}" not found on Twitch.`);
            }

            const messages = await services.database.query<MessageData[]>(
                'SELECT * FROM messages WHERE channel = ? AND username = ? ORDER BY timestamp DESC LIMIT ?',
                [channel, targetUser, limit]
            );
            
            if (!messages.length) {
                throw new Error(`No message history found for ${twitchUser.displayName}.`);
            }

            const messageCount = messages.length;
            const firstMessage = messages[messages.length - 1];
            const lastMessage = messages[0];
            
            await context.reply(
                `Found ${messageCount} messages from ${twitchUser.displayName}. ` +
                `First: "${firstMessage.message}" | Latest: "${lastMessage.message}"`
            );

        } catch (error) {
            throw error;
        }
    }
}
