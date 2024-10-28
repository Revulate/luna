import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { AIMessage, ConversationThread, AIContext } from '../types/ai';
import { ServiceContainer } from '../types/services';
import { ChatUser, TwitchUser } from '@twurple/chat';

export class GptCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;
    private readonly SYSTEM_PROMPT = `You are Luna, an obsessive, controlling, loving, and jealous AI serving Revulate...`;

    constructor() {
        this.metadata = {
            name: 'gpt',
            description: 'Ask GPT AI a question',
            usage: '!gpt <question>',
            category: 'AI',
            aliases: ['g', 'ask'],
            cooldown: 5000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please provide a question or prompt.');
        }

        try {
            const prompt = args.join(' ');
            const thread = await this.getOrCreateThread(channel, user.userId, services);
            const recentContext = await this.getThreadContext(thread.id, services);

            if (!services.ai) {
                throw new Error('AI service is not available');
            }

            const aiContext: AIContext = {
                user,
                channel,
                message: prompt,
                maxTokens: 150,
                context: recentContext,
                provider: 'gpt',
                systemPrompt: this.SYSTEM_PROMPT
            };

            const response = await services.ai.generateResponse(aiContext);
            await this.storeInteraction(thread.id, prompt, response, user, services);
            await context.reply(response);

        } catch (error) {
            services.logger.error('Error in GPT command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                user: user.userName,
                channel
            });
            throw error;
        }
    }

    private async getOrCreateThread(channel: string, userId: string, services: ServiceContainer): Promise<ConversationThread> {
        try {
            // Try to get active thread
            const activeThread = await services.database.getActiveThread(channel, userId);
            if (activeThread) return activeThread;

            // Create new thread
            const threadId = await services.database.createConversationThread(channel, userId);
            return {
                id: threadId,
                channel,
                userId,
                createdAt: new Date(),
                lastMessageAt: new Date()
            };
        } catch (error) {
            services.logger.error('Error getting/creating thread:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                channel,
                userId
            });
            throw error;
        }
    }

    private async getThreadContext(threadId: number, services: ServiceContainer): Promise<AIMessage[]> {
        try {
            const messages = await services.database.getThreadMessages(threadId, 5);
            return messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
        } catch (error) {
            services.logger.error('Error getting thread context:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                threadId
            });
            return [];
        }
    }

    private async storeInteraction(
        threadId: number,
        prompt: string,
        response: string,
        user: TwitchUser,
        services: ServiceContainer
    ): Promise<void> {
        try {
            await services.database.addThreadMessage(threadId, {
                role: 'user',
                content: prompt,
                userId: user.userId
            });

            await services.database.addThreadMessage(threadId, {
                role: 'assistant',
                content: response
            });
        } catch (error) {
            services.logger.error('Error storing interaction:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                threadId
            });
        }
    }
}
