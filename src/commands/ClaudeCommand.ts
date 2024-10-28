import { AIBaseHandler } from './AIBaseHandler';
import { CommandContext, CommandMetadata } from '../types/commands';
import { AIContext } from '../types/ai';
import { ServiceContainer } from '../types/services';

export class ClaudeCommand extends AIBaseHandler {
    constructor(services: ServiceContainer) {
        super(services);
        this.metadata = {
            name: 'claude',
            description: 'Interact with Claude AI',
            usage: '!claude <message>',
            enabled: true,
            hidden: false,
            cooldown: 5,
            permissions: [],
            category: 'AI',
            aliases: ['c']
        };
    }

    async execute(context: CommandContext): Promise<void> {
        const { channel, user, args } = context;
        
        if (!args.length) {
            await context.say('Please provide a message for Claude');
            return;
        }

        const message = args.join(' ');
        const aiContext = this.createAIContext(user, channel, message);

        try {
            const response = await this.services.ai?.generateResponse(aiContext);
            if (response) {
                await context.say(response);
            }
        } catch (error) {
            await this.logError(error as Error, 'ClaudeCommand.execute');
            await context.say('Sorry, I encountered an error processing your request.');
        }
    }
}
