import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';

export class RollCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'roll',
            description: 'Roll one or more dice',
            usage: '!roll [XdY] or !roll [number]',
            category: 'Fun',
            aliases: ['dice', 'random'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { user, args } = context;
        
        // Parse dice notation (e.g., 2d6, d20)
        let amount = 1;
        let sides = 6;

        if (args.length > 0) {
            const diceRegex = /^(\d+)?d(\d+)$/i;
            const match = args[0].match(diceRegex);

            if (match) {
                amount = match[1] ? parseInt(match[1]) : 1;
                sides = parseInt(match[2]);
            } else if (!isNaN(parseInt(args[0]))) {
                sides = parseInt(args[0]);
            }
        }

        // Validate input
        amount = Math.min(Math.max(amount, 1), 10); // Limit to 1-10 dice
        sides = Math.min(Math.max(sides, 2), 100); // Limit to 2-100 sides

        // Roll the dice
        const rolls = Array.from({ length: amount }, () => 
            Math.floor(Math.random() * sides) + 1
        );

        // Format response
        const total = rolls.reduce((sum, roll) => sum + roll, 0);
        const rollsStr = rolls.join(', ');
        const response = amount > 1 ?
            `rolled ${amount}d${sides}: [${rollsStr}] = ${total}` :
            `rolled a d${sides}: ${total}`;

        await context.reply(response);
    }
}
