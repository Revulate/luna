import type { ChatMessage, ChatUser } from '@twurple/chat';
import type { ServiceContainer } from './services';
import type { ErrorCode } from './errors';
import type { TwitchUser } from './twitch';

export interface CommandConfig {
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

// Update default prefix
export const DEFAULT_COMMAND_CONFIG: CommandConfig = {
    prefix: '#',
    aliases: {},
    cooldowns: {},
    rateLimit: {
        maxCommands: 5,
        window: 60000 // 1 minute
    },
    cooldown: {
        default: 3000,
        commands: {}
    }
};

export interface CommandContext {
    user: TwitchUser;  // Changed from string to TwitchUser
    args: string[];
    services: ServiceContainer;
    channel: string;
    reply: (message: string) => Promise<void>;
}

export interface CommandMetadata {
    name: string;
    description: string;
    usage: string;
    enabled: boolean;
    hidden: boolean;
    cooldown: number;
    permissions: string[];
    category: string;
    aliases: string[];
}

export interface BaseCommand {
    metadata: CommandMetadata;
    execute(context: CommandContext): Promise<void>;
}

export interface CommandHandler {
    handleCommand(context: CommandContext): Promise<void>;
}

export interface CommandRegistry {
    handleCommand(context: CommandContext): Promise<void>;
    registerCommand(command: BaseCommand): void;
    hasCommand(name: string): boolean;
    getCommand(name: string): BaseCommand | null;
    getCommands(): BaseCommand[];
}
