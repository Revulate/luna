import { BaseCommand } from './BaseCommand.js';
import { CommandContext } from '../types/commands.js';

export default class AfkCommand extends BaseCommand {
    constructor() {
        super({
            name: 'afk',
            description: 'Set your AFK status',
            usage: '!afk [message]',
            category: 'User',
            aliases: ['away'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        });
    }

    async execute(context: CommandContext): Promise<void> {
        try {
            const { user, args, services } = context;
            const message = args.join(' ') || 'Away from keyboard';
            
            // First ensure user exists
            await services.database.query(
                `INSERT OR IGNORE INTO users (id, username, display_name, last_updated) 
                 VALUES (?, ?, ?, ?)`,
                [user.userId, user.userName, user.displayName || user.userName, Date.now()]
            );

            // Then update AFK status
            await services.database.query(
                `UPDATE users 
                 SET afk_status = ?, afk_timestamp = ? 
                 WHERE id = ?`,
                [message, Date.now(), user.userId]
            );

            await context.reply(`${user.displayName} is now AFK: ${message}`);
        } catch (error) {
            services.logger.error('Error executing AFK command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                userId: user.userId,
                userName: user.userName
            });
            await context.reply('Failed to set AFK status. Please try again later.');
        }
    }
}
