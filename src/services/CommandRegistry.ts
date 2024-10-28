import { Service, ServiceConfig, ServiceContainer } from '../types/services';
import { ServiceError, ErrorCode } from '../types/errors';
import { CommandContext, BaseCommand } from '../types/commands';
import { TwitchUser } from '../types/twitch';
import { ChatMessage, ChatUser } from '@twurple/chat';

interface CommandRegistryConfig extends ServiceConfig {
    prefix: string;
    defaultCooldown: number;
    caseSensitive: boolean;
}

export class CommandRegistry implements Service {
    public readonly config: CommandRegistryConfig;
    public readonly services: ServiceContainer;
    private readonly commands: Map<string, BaseCommand>;
    private readonly aliases: Map<string, string>;
    private readonly cooldowns: Map<string, Map<string, number>>;

    constructor(config: CommandRegistryConfig, services: ServiceContainer) {
        this.config = config;
        this.services = services;
        this.commands = new Map();
        this.aliases = new Map();
        this.cooldowns = new Map();
    }

    async initialize(): Promise<void> {
        try {
            // Load commands from directory
            await this.loadCommands();
            this.services.logger.info('Command registry initialized', {
                commands: this.commands.size,
                aliases: this.aliases.size
            });
        } catch (error) {
            throw this.handleError(error as Error);
        }
    }

    async cleanup(): Promise<void> {
        this.commands.clear();
        this.aliases.clear();
        this.cooldowns.clear();
    }

    handleError(error: Error, code: ErrorCode = 'INTERNAL_ERROR'): ServiceError {
        const serviceError: ServiceError = {
            name: error.name,
            message: error.message,
            code,
            stack: error.stack,
            timestamp: new Date(),
            toJSON() {
                return {
                    name: this.name,
                    message: this.message,
                    code: this.code,
                    timestamp: this.timestamp
                };
            }
        };
        return serviceError;
    }

    public async registerCommand(command: BaseCommand): Promise<void> {
        const name = this.config.caseSensitive ? 
            command.metadata.name : 
            command.metadata.name.toLowerCase();

        // Check for duplicate commands
        if (this.commands.has(name)) {
            throw this.handleError(
                new Error(`Command ${name} is already registered`),
                'VALIDATION_ERROR'
            );
        }

        // Register command
        this.commands.set(name, command);

        // Register aliases
        if (command.metadata.aliases) {
            for (const alias of command.metadata.aliases) {
                const formattedAlias = this.config.caseSensitive ? 
                    alias : alias.toLowerCase();
                this.aliases.set(formattedAlias, name);
            }
        }

        this.services.logger.debug(`Registered command: ${name}`, {
            aliases: command.metadata.aliases
        });
    }

    public async handleCommand(context: CommandContext): Promise<void> {
        const { channel, user, message, args } = context;
        const commandName = this.config.caseSensitive ? 
            args[0] : 
            args[0].toLowerCase();

        const command = this.getCommand(commandName);
        if (!command) return;

        try {
            // Check if command is enabled
            if (!command.metadata.enabled) {
                throw new Error('This command is currently disabled');
            }

            // Check cooldown
            if (this.isOnCooldown(command, user.id)) {
                const remaining = this.getRemainingCooldown(command, user.id);
                throw new Error(`Command on cooldown. Try again in ${remaining}s`);
            }

            // Execute command
            await command.execute(context);

            // Update cooldown
            this.updateCooldown(command, user.id);

        } catch (error) {
            this.handleCommandError(channel, user.displayName, commandName, error as Error);
        }
    }

    public getCommand(name: string): BaseCommand | null {
        const commandName = this.config.caseSensitive ? name : name.toLowerCase();
        return this.commands.get(commandName) || 
               this.commands.get(this.aliases.get(commandName) || '') || 
               null;
    }

    public getCommands(): BaseCommand[] {
        return Array.from(this.commands.values());
    }

    public hasCommand(name: string): boolean {
        return this.getCommand(name) !== null;
    }

    private isOnCooldown(command: BaseCommand, userId: string): boolean {
        const cooldowns = this.cooldowns.get(command.metadata.name);
        if (!cooldowns) return false;

        const lastUsed = cooldowns.get(userId);
        if (!lastUsed) return false;

        return Date.now() - lastUsed < command.metadata.cooldown;
    }

    private getRemainingCooldown(command: BaseCommand, userId: string): number {
        const cooldowns = this.cooldowns.get(command.metadata.name);
        if (!cooldowns) return 0;

        const lastUsed = cooldowns.get(userId);
        if (!lastUsed) return 0;

        const remaining = (lastUsed + command.metadata.cooldown - Date.now()) / 1000;
        return Math.max(0, Math.ceil(remaining));
    }

    private updateCooldown(command: BaseCommand, userId: string): void {
        if (!this.cooldowns.has(command.metadata.name)) {
            this.cooldowns.set(command.metadata.name, new Map());
        }
        this.cooldowns.get(command.metadata.name)!.set(userId, Date.now());
    }

    private handleCommandError(
        channel: string,
        username: string,
        command: string,
        error: Error
    ): void {
        this.services.logger.error('Command error:', {
            command,
            user: username,
            error: error.message
        });

        const response = `@${username} Error: ${error.message}`;
        void this.services.chat.client.say(channel, response);
    }

    private async loadCommands(): Promise<void> {
        // Implementation for loading commands from directory
        // This would be implemented based on your command loading strategy
    }

    public isHealthy(): boolean {
        return this.commands.size > 0;
    }
}
