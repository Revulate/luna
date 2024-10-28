import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';

interface CoinResult {
    name: string;
    emoji: string;
    message: string;
}

interface CoinResults {
    heads: CoinResult;
    tails: CoinResult;
}

export class CoinCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;
    private readonly results: CoinResults;

    constructor() {
        this.metadata = {
            name: 'coin',
            description: 'Flip a coin',
            usage: '!coin',
            category: 'Fun',
            aliases: ['flip', 'coinflip'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };

        this.results = {
            heads: {
                name: 'heads',
                emoji: '👑',
                message: 'The coin shows heads!'
            },
            tails: {
                name: 'tails',
                emoji: '🦅',
                message: 'The coin shows tails!'
            }
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { user } = context;
        
        // Get random result
        const result = Math.random() < 0.5 ? this.results.heads : this.results.tails;
        
        // Add some randomness to responses
        const responses = [
            `@${user.displayName} flips a coin... ${result.message} ${result.emoji}`,
            `The coin lands on ${result.name}! ${result.emoji}`,
            `${result.emoji} ${user.displayName} got ${result.name}!`,
            `*flip* *flip* *flip* ... ${result.name}! ${result.emoji}`
        ];

        const response = responses[Math.floor(Math.random() * responses.length)];
        await context.reply(response);
    }
}
