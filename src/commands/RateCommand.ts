import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';

interface RateConfig {
    min: number;
    max: number;
    format: (value: any) => string;
    emotes?: {
        high: string;
        low: string;
    };
    threshold?: number;
    getEmote?: (value: number) => string;
    generateValue?: () => any;
}

interface MydValue {
    length: number;
    girth: number;
}

interface RateTypes {
    [key: string]: RateConfig;
}

export class RateCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;
    private readonly rateTypes: RateTypes;

    constructor() {
        this.metadata = {
            name: 'rate',
            description: 'Rate various things',
            usage: '!rate <target> or !<type> <target>',
            category: 'Fun',
            aliases: [
                'rate', 'cute', 'gay', 'straight', 
                'myd', 'pp', 'kok', 'cock', 'dick',
                'horny', 'iq', 'sus', 'all', 'allrates'
            ],
            cooldown: 30000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };

        this.rateTypes = {
            cute: {
                min: 0,
                max: 100,
                format: (value) => `${value}% cute`,
                emotes: { high: 'MenheraCute', low: 'SadgeCry' },
                threshold: 50
            },
            gay: {
                min: 0,
                max: 100,
                format: (value) => `${value}% gay`,
                emotes: { high: 'Gayge', low: '📏' },
                threshold: 50
            },
            straight: {
                min: 0,
                max: 100,
                format: (value) => `${value}% straight`,
                emotes: { high: '📏', low: 'Hmm' },
                threshold: 50
            },
            myd: {
                min: 0,
                max: 0, // Not used for myd
                generateValue: () => ({
                    length: Math.floor(Math.random() * (20 - 7.5 + 1)) + 7.5,
                    girth: Math.floor(Math.random() * (15 - 7 + 1)) + 7
                }),
                format: (value: MydValue) => 
                    `pp is ${value.length} cm long and has a ${value.girth} cm girth`,
                emotes: { high: 'BillyApprove', low: 'BillyApprove' }
            },
            horny: {
                min: 0,
                max: 100,
                format: (value) => `${value}% horny`,
                emotes: { high: 'HORNY', low: 'Hmm' },
                threshold: 50
            },
            iq: {
                min: 0,
                max: 200,
                format: (value) => `${value} IQ`,
                getEmote: (value) => {
                    if (value > 199) return 'BrainGalaxy';
                    if (value > 115) return 'catNerd';
                    if (value > 80) return 'NPC';
                    if (value > 50) return 'slowpoke';
                    return 'thoughtless';
                }
            },
            sus: {
                min: 0,
                max: 100,
                format: (value) => `${value}% sus`,
                emotes: { high: 'SUSSY', low: 'Hmm' },
                threshold: 50
            }
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { services, user, args } = context;
        const command = args[0]?.toLowerCase();
        
        try {
            if (!args.length) {
                throw new Error('Please provide a target to rate.');
            }

            const target = args.join(' ').replace(/^@/, '');

            if (['all', 'allrates'].includes(command)) {
                await this.handleAllCommand(context, target);
            } else {
                await this.handleSingleRate(context, command, target);
            }

        } catch (error) {
            services.logger.error('Error in rate command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                user: user.userName,
                command
            });
            throw error;
        }
    }

    private async handleSingleRate(context: CommandContext, command: string, target: string): Promise<void> {
        const { services, user } = context;
        const rateType = this.getRateType(command);
        
        if (!rateType) {
            throw new Error(`Invalid rate type: ${command}`);
        }

        const cacheKey = `rate:${command}:${target.toLowerCase()}`;
        let value = await services.database.getCache(cacheKey);

        if (!value) {
            value = this.generateValue(rateType);
            await services.database.setCache(cacheKey, value, 3600); // Cache for 1 hour
        }

        const response = this.formatResponse(user.displayName, target, rateType, value);
        await context.reply(response);

        // Log the interaction
        await services.database.logCommand({
            command,
            user: user.userName,
            target,
            value,
            response
        });
    }

    private async handleAllCommand(context: CommandContext, target: string): Promise<void> {
        const { services, user } = context;
        const responses: string[] = [];

        for (const [type, config] of Object.entries(this.rateTypes)) {
            if (type === 'rate') continue; // Skip generic rate command

            const cacheKey = `rate:${type}:${target.toLowerCase()}`;
            let value = await services.database.getCache(cacheKey);

            if (!value) {
                value = this.generateValue(config);
                await services.database.setCache(cacheKey, value, 3600);
            }

            responses.push(config.format(value));
        }

        const response = `${target} is ${responses.join(' • ')}`;
        await context.reply(response);

        // Log the interaction
        await services.database.logCommand({
            command: 'all',
            user: user.userName,
            target,
            response
        });
    }

    private getRateType(command: string): RateConfig | undefined {
        // Handle aliases
        if (['pp', 'kok', 'cock', 'dick'].includes(command)) {
            return this.rateTypes.myd;
        }
        return this.rateTypes[command];
    }

    private generateValue(rateType: RateConfig): number | MydValue {
        if (rateType.generateValue) {
            return rateType.generateValue();
        }
        return Math.floor(Math.random() * (rateType.max - rateType.min + 1)) + rateType.min;
    }

    private formatResponse(username: string, target: string, rateType: RateConfig, value: any): string {
        const formattedValue = rateType.format(value);
        let emote: string;

        if (rateType.getEmote) {
            emote = rateType.getEmote(value);
        } else if (rateType.emotes) {
            emote = value > (rateType.threshold ?? 50) ? rateType.emotes.high : rateType.emotes.low;
        } else {
            emote = '';
        }

        return `${target} ${formattedValue} ${emote}`;
    }
}
