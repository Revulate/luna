import { BaseCommand } from './BaseCommand.js';
import { CommandContext } from '../types/commands.js';

export default class PingCommand extends BaseCommand {
    constructor() {
        super({
            name: 'ping',
            description: 'Check bot latency',
            usage: '!ping',
            category: 'System',
            aliases: ['pong', 'latency'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        });
    }

    async execute(context: CommandContext): Promise<void> {
        await context.reply('Pong! 🏓');
    }
}
