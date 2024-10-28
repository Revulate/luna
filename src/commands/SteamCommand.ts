import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ServiceContainer } from '../types/services';

interface SteamGameInfo {
    name: string;
    price_overview?: {
        final: number;
        discount_percent: number;
    };
    metacritic?: {
        score: number;
    };
    genres?: Array<{
        description: string;
    }>;
}

interface SteamUserInfo {
    personaname: string;
    game_count?: number;
}

interface RecentGame {
    name: string;
    playtime_2weeks: number;
}

export class SteamCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor() {
        this.metadata = {
            name: 'steam',
            description: 'Search Steam games or users',
            usage: '!steam <game/user>',
            category: 'Gaming',
            aliases: ['game', 'steamgame'],
            cooldown: 3000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { channel, user, args, services } = context;
        
        if (!args.length) {
            throw new Error('Please provide a Steam username or game name to search.');
        }

        const query = args.join(' ');
        const cacheKey = `steam:${query.toLowerCase()}`;

        try {
            // Check cache first
            const cachedResult = await services.database.getCache(cacheKey);
            if (cachedResult) {
                await context.reply(cachedResult);
                return;
            }

            // Try to get Steam user first
            const steamUser = await this.getSteamUser(query, services);
            if (steamUser) {
                const response = await this.handleUserLookup(steamUser, services);
                await services.database.setCache(cacheKey, response, 300); // Cache for 5 minutes
                await context.reply(response);
                return;
            }

            // If not a user, try to find game
            const gameInfo = await this.searchSteamGame(query, services);
            if (gameInfo) {
                const response = this.formatGameInfo(gameInfo);
                await services.database.setCache(cacheKey, response, 300);
                await context.reply(response);
                return;
            }

            throw new Error(`No Steam user or game found matching "${query}"`);

        } catch (error) {
            services.logger.error('Error in Steam command:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                query,
                user: user.userName
            });
            throw error;
        }
    }

    private async getSteamUser(query: string, services: ServiceContainer): Promise<string | null> {
        try {
            const apiKey = (services.config as ConfigService).get('api.steam.apiKey');
            const response = await fetch(
                `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/` +
                `?key=${apiKey}&vanityurl=${encodeURIComponent(query)}`
            );
            const data = await response.json();
            return data.response.success === 1 ? data.response.steamid : null;
        } catch (error) {
            services.logger.error('Error getting Steam user:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                query
            });
            return null;
        }
    }

    private async getSteamUserInfo(steamId: string, services: ServiceContainer): Promise<SteamUserInfo | null> {
        try {
            const apiKey = (services.config as ConfigService).get('api.steam.apiKey');
            const response = await fetch(
                `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/` +
                `?key=${apiKey}&steamid=${steamId}` +
                `&include_appinfo=1&include_played_free_games=1`
            );
            const data = await response.json();
            return data.response;
        } catch (error) {
            services.logger.error('Error getting Steam user info:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                steamId
            });
            return null;
        }
    }

    private async getRecentGames(steamId: string, services: ServiceContainer): Promise<RecentGame[]> {
        try {
            const apiKey = (services.config as ConfigService).get('api.steam.apiKey');
            const response = await fetch(
                `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/` +
                `?key=${apiKey}&steamid=${steamId}&count=1`
            );
            const data = await response.json();
            return data.response.games || [];
        } catch (error) {
            services.logger.error('Error getting recent games:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                steamId
            });
            return [];
        }
    }

    private async handleUserLookup(steamId: string, services: ServiceContainer): Promise<string> {
        const [userInfo, recentGames] = await Promise.all([
            this.getSteamUserInfo(steamId, services),
            this.getRecentGames(steamId, services)
        ]);

        let response = `Steam user ${userInfo?.personaname || 'Unknown'}`;
        
        if (recentGames?.length > 0) {
            const mostPlayed = recentGames[0];
            response += ` • Recently played: ${mostPlayed.name} (${Math.round(mostPlayed.playtime_2weeks / 60)}h past 2 weeks)`;
        }

        if (userInfo?.game_count) {
            response += ` • ${userInfo.game_count} games owned`;
        }

        return response;
    }

    private async searchSteamGame(query: string, services: ServiceContainer): Promise<SteamGameInfo | null> {
        try {
            // Search Steam store
            const searchResponse = await fetch(
                `https://store.steampowered.com/api/storesearch/` +
                `?term=${encodeURIComponent(query)}&l=english&cc=US`
            );
            const searchData = await searchResponse.json();
            
            if (!searchData.items?.length) return null;

            // Get detailed game info
            const appId = searchData.items[0].id;
            const detailsResponse = await fetch(
                `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US`
            );
            const detailsData = await detailsResponse.json();

            return detailsData[appId].success ? detailsData[appId].data : null;
        } catch (error) {
            services.logger.error('Error searching Steam game:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                query
            });
            return null;
        }
    }

    private formatGameInfo(game: SteamGameInfo): string {
        const price = game.price_overview ? 
            `${(game.price_overview.final / 100).toFixed(2)} USD` +
            (game.price_overview.discount_percent > 0 ? 
                ` (-${game.price_overview.discount_percent}%)` : '') :
            'Free to Play';

        const rating = game.metacritic ? 
            `${game.metacritic.score}/100 on Metacritic` :
            'No rating available';

        const genres = game.genres?.map(g => g.description).join(', ') || 'Unknown genre';

        return `${game.name} • ${price} • ${rating} • ${genres}`;
    }
}
