import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands.js';
import { GameInfo, GameStats, DVPService } from '../types/dvp.js';
import { ServiceError } from '../types/errors.js';

export class DvpCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'dvp',
            description: 'Check what games Vulpes has played',
            usage: '!dvp <game>',
            category: 'Games',
            aliases: ['played', 'game'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { user, args, services } = context;
        
        if (!args.length) {
            await context.reply(`@${user.userName}, please provide a game name to search for.`);
            return;
        }

        const dvpService = services.get('dvp') as DVPService;
        const gameName = args.join(' ');

        try {
            const gameInfo = await dvpService.getGameInfo(gameName);
            
            if (gameInfo) {
                const formattedTime = dvpService.formatDuration(gameInfo.timePlayed);
                const lastPlayed = gameInfo.lastPlayed.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });

                await context.reply(
                    `@${user.userName}, Vulpes last played ${gameInfo.name} on ${lastPlayed} ` +
                    `• Total playtime: ${formattedTime}`
                );
            } else {
                await context.reply(
                    `@${user.userName}, I couldn't find any record of Vulpes playing "${gameName}". ` +
                    `Try checking the spelling or use !sheet to see all games.`
                );
            }
        } catch (error) {
            services.logger.error('Error in DVP command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                user: user.userName,
                game: gameName
            });
            
            await context.reply(
                `@${user.userName}, sorry, there was an error processing your request. ` +
                `Please try again later.`
            );
        }
    }
}
