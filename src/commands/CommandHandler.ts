import { BaseCommand, CommandContext, CommandRegistry } from '../types/commands';
import { ServiceContainer } from '../types/services';
import { ServiceError } from '../errors/ServiceError';
import { ErrorCode } from '../types/errors';

interface ExtendedCommandContext extends CommandContext {
    command?: string;
}

export class CommandHandler {
    private readonly services: ServiceContainer;
    private registry: CommandRegistry | null = null;
    private readonly RATE_LIMIT_DELAY = 1200;

    constructor(services: ServiceContainer) {
        this.services = services;
    }

    public async initialize(registry: CommandRegistry): Promise<boolean> {
        this.registry = registry;
        return true;
    }

    public async handle(context: ExtendedCommandContext): Promise<void> {
        if (!this.registry) {
            throw new ServiceError(
                'INTERNAL_ERROR',
                'Command registry not initialized'
            );
        }

        try {
            // Validate context
            this.validateContext(context);

            // Parse command and args
            const { command, args } = this.parseCommand(context.message); // This assumes message exists
            context.command = command;
            context.args = args;

            // Execute command
            await this.registry.handleCommand(context);
        } catch (error) {
            await this.handleError(context, error);
        }
    }

    private validateContext(context: CommandContext): void {
        if (!context.user.userId || !context.user.userName) {
            throw new ServiceError(
                'VALIDATION_ERROR',
                'Invalid user object in context'
            );
        }
    }

    private parseCommand(message: string): { command: string; args: string[] } {
        const parts = message.trim().split(/\s+/);
        const command = parts[0].slice(1).toLowerCase(); // This assumes prefix is already removed
        const args = parts.slice(1);
        return { command, args };
    }

    private async handleError(context: CommandContext, error: Error): Promise<void> {
        const { user } = context;
        this.services.logger.error('Command execution error:', {
            message: error.message,
            user: user.userName,
            command: context.command
        });

        try {
            await this.rateLimitedReply(
                context,
                `@${user.displayName}, Error: ${error.message}`
            );
        } catch (replyError) {
            this.services.logger.error('Error sending error message:', {
                message: replyError instanceof Error ? replyError.message : 'Unknown error'
            });
        }
    }

    public checkUserPermissions(context: CommandContext, requiredLevel = 'user'): boolean {
        const levels: Record<string, number> = {
            broadcaster: 4,
            mod: 3,
            vip: 2,
            subscriber: 1,
            user: 0
        };

        const userLevel = context.user.isBroadcaster ? 'broadcaster' :
                         context.user.isMod ? 'mod' :
                         context.user.isVip ? 'vip' :
                         context.user.isSubscriber ? 'subscriber' : 'user';

        return levels[userLevel] >= levels[requiredLevel];
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    private sanitizeInput(input: string): string {
        return input.replace(/[<>]/g, '').trim();
    }

    private async rateLimitedReply(context: CommandContext, message: string, delay = this.RATE_LIMIT_DELAY): Promise<void> {
        try {
            await new Promise(resolve => setTimeout(resolve, delay));
            await context.say(message);
        } catch (error) {
            this.services.logger.error('Error sending rate-limited reply:', {
                message: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
}
