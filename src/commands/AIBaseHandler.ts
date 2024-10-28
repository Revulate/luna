import { BaseCommand, CommandContext } from '../types/commands';
import { AIContext, AIMessage } from '../types/ai';
import { ServiceContainer } from '../types/services';
import { TwitchUser } from '../types/twitch';
import { ConfigService } from '../services/ConfigService';

export abstract class AIBaseHandler implements BaseCommand {
    metadata = {
        name: 'ai',
        description: 'Base AI command handler',
        usage: '!ai <message>',
        enabled: true,
        hidden: false,
        cooldown: 0,
        permissions: [],
        category: 'AI',
        aliases: []
    };

    protected services: ServiceContainer;

    constructor(services: ServiceContainer) {
        this.services = services;
    }

    abstract execute(context: CommandContext): Promise<void>;

    protected createAIContext(user: TwitchUser, channel: string, message: string): AIContext {
        const config = (this.services.config as ConfigService);
        return {
            user,
            channel,
            message,
            maxTokens: config.get('ai.maxTokens'),
            context: []
        };
    }

    protected async logError(error: Error, context: string): Promise<void> {
        this.services.logger.error(`AI Error: ${error.message}`, {
            context,
            stack: error.stack
        });
    }

    protected getConfig(): any {
        return (this.services.config as ConfigService).get('ai');
    }
}
