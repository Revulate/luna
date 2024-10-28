import { BaseService } from './BaseService.js';
import { Service, ServiceConfig, ServiceContainer } from '../types/services.js';
import { ServiceError, ErrorCode } from '../types/errors.js';
import { ChatMessage, ChatUser } from '@twurple/chat';
import { BaseCommand } from '../commands/BaseCommand.js';
import path from 'path';
import fs from 'fs/promises';

interface CommandConfig extends ServiceConfig {
    name: string;
    enabled: boolean;
    prefix: string;
    aliases: Record<string, string>;
    cooldowns: Record<string, number>;
    rateLimit: {
        maxCommands: number;
        window: number;
    };
    cooldown: {
        default: number;
        commands: Record<string, number>;
    };
}

export class CommandService extends BaseService {
    private commands: Map<string, BaseCommand> = new Map();
    private aliases: Map<string, string> = new Map();
    private cooldowns: Map<string, Map<string, number>> = new Map();
    private usageTracking: Map<string, { count: number; lastUsed: number }> = new Map();

    constructor(config: CommandConfig, services: ServiceContainer) {
        super(config, services);
    }

    async initialize(): Promise<void> {
        try {
            await this.loadCommands();
            
            this.services.logger.info('Command service initialized successfully', {
                context: 'commands',
                commandCount: this.commands.size,
                aliasCount: this.aliases.size
            });
        } catch (error) {
            this.services.logger.error('Failed to initialize command service', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    private async loadCommands(): Promise<void> {
        try {
            const commandsPath = path.join(process.cwd(), 'src', 'commands');
            const files = await fs.readdir(commandsPath);
            
            for (const file of files) {
                // Skip non-command files
                if (!file.endsWith('.ts') || 
                    file === 'BaseCommand.ts' || 
                    file === 'AIBaseHandler.ts' ||
                    file === 'CommandHandler.ts') continue;

                try {
                    const filePath = path.join(commandsPath, file);
                    const fileUrl = `file://${filePath}`;
                    
                    // Import the command module
                    const module = await import(fileUrl);
                    
                    // Check if it's a valid command class
                    if (!module.default || typeof module.default !== 'function') {
                        this.services.logger.warn(`Invalid command export in ${file}`);
                        continue;
                    }

                    // Create instance and validate
                    try {
                        const command = new module.default();
                        
                        if (!(command instanceof BaseCommand)) {
                            this.services.logger.warn(`Command in ${file} does not extend BaseCommand`);
                            continue;
                        }

                        // Validate command metadata
                        this.validateCommandMetadata(command);
                        
                        // Register command
                        this.registerCommand(command);
                        
                        this.services.logger.debug(`Loaded command: ${command.metadata.name}`, {
                            file,
                            aliases: command.metadata.aliases
                        });

                    } catch (error) {
                        this.services.logger.error(`Error instantiating command from ${file}:`, error);
                    }

                } catch (error) {
                    if ((error as any).code === 'ERR_MODULE_NOT_FOUND') {
                        this.services.logger.warn(`Could not load command ${file}: Module not found`);
                    } else {
                        this.services.logger.error(`Error loading command from ${file}:`, error);
                    }
                }
            }

            this.services.logger.info('Commands loaded:', {
                count: this.commands.size,
                commands: Array.from(this.commands.keys())
            });

        } catch (error) {
            this.services.logger.error('Error loading command modules:', error);
        }
    }

    private validateCommandMetadata(command: BaseCommand): void {
        const required = ['name', 'description', 'usage', 'category', 'permissions'];
        const missing = required.filter(field => !command.metadata[field]);
        
        if (missing.length > 0) {
            throw new Error(`Command ${command.metadata.name} is missing required metadata: ${missing.join(', ')}`);
        }
    }

    public async handleMessage(channel: string, user: ChatUser, message: string, msg: ChatMessage): Promise<void> {
        const config = this.config as CommandConfig;
        
        if (!message.startsWith(config.prefix)) return;

        const args = message.slice(config.prefix.length).trim().split(/\s+/);
        const commandName = args.shift()?.toLowerCase();

        if (!commandName) return;

        const command = this.getCommand(commandName);
        if (!command) {
            this.services.logger.debug('Command not found:', {
                commandName,
                availableCommands: Array.from(this.commands.keys())
            });
            return;
        }

        try {
            // Check permissions
            if (!await this.checkPermissions(command, user)) {
                await this.services.chat.client.say(channel, `@${user.userName} You don't have permission to use this command.`);
                return;
            }

            // Check cooldown
            if (!await this.checkCooldown(command, user.userId)) {
                // Silently ignore cooldown violations
                return;
            }

            // Check rate limit
            if (!await this.checkRateLimit(user.userId)) {
                await this.services.chat.client.say(channel, `@${user.userName} You're using commands too quickly. Please wait a moment.`);
                return;
            }

            const context = {
                channel,
                user,
                args,
                services: this.services,
                reply: async (response: string) => {
                    try {
                        await this.services.chat.client.say(channel, response);
                    } catch (error) {
                        this.services.logger.error('Failed to send command response:', {
                            error: error instanceof Error ? error.message : 'Unknown error',
                            channel,
                            response
                        });
                    }
                }
            };

            await command.execute(context);
            
        } catch (error) {
            this.services.logger.error('Error executing command:', {
                command: commandName,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });

            try {
                await this.services.chat.client.say(channel, `@${user.userName} An error occurred while executing the command. Please try again later.`);
            } catch (chatError) {
                this.services.logger.error('Failed to send error message:', chatError);
            }
        }
    }

    private registerCommand(command: BaseCommand): void {
        if (!command.metadata?.name) {
            throw new Error('Command must have a name');
        }

        this.commands.set(command.metadata.name, command);

        if (command.metadata.aliases) {
            for (const alias of command.metadata.aliases) {
                this.aliases.set(alias, command.metadata.name);
            }
        }
    }

    private getCommand(name: string): BaseCommand | undefined {
        return this.commands.get(name) || this.commands.get(this.aliases.get(name) || '');
    }

    async cleanup(): Promise<void> {
        this.commands.clear();
        this.aliases.clear();
        this.cooldowns.clear();
        this.usageTracking.clear();
    }

    async isHealthy(): Promise<boolean> {
        return this.commands.size > 0;
    }

    private async checkCooldown(command: BaseCommand, userId: string): Promise<boolean> {
        const cooldownKey = `${command.metadata.name}:${userId}`;
        const cooldownTime = command.metadata.cooldown || this.config.cooldown.default;
        
        const lastUsed = this.cooldowns.get(cooldownKey);
        if (lastUsed) {
            const timePassed = Date.now() - lastUsed;
            if (timePassed < cooldownTime) {
                return false;
            }
        }
        
        this.cooldowns.set(cooldownKey, Date.now());
        return true;
    }

    private async checkRateLimit(userId: string): Promise<boolean> {
        const config = this.config as CommandConfig;
        const now = Date.now();
        const window = config.rateLimit.window;
        const maxCommands = config.rateLimit.maxCommands;
        
        const usage = this.usageTracking.get(userId) || { count: 0, lastUsed: 0 };
        
        if (now - usage.lastUsed > window) {
            usage.count = 1;
        } else if (usage.count >= maxCommands) {
            return false;
        } else {
            usage.count++;
        }
        
        usage.lastUsed = now;
        this.usageTracking.set(userId, usage);
        return true;
    }

    private async checkPermissions(command: BaseCommand, user: ChatUser): Promise<boolean> {
        const userRoles = new Set<string>(['viewer']);
        
        if (user.isBroadcaster) userRoles.add('broadcaster');
        if (user.isMod) userRoles.add('moderator');
        if (user.isVip) userRoles.add('vip');
        if (user.isSubscriber) userRoles.add('subscriber');
        
        return command.metadata.permissions.some(role => userRoles.has(role));
    }
}
