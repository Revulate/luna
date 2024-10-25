import fetch from 'node-fetch';
import { config } from '../config.js';
import logger from '../logger.js';

class SteamHandler {
  constructor() {
    this.apiKey = config.steam.apiKey;
    this.cache = new Map();
    this.CACHE_DURATION = 300000; // 5 minutes
  }

  async handleSteamCommand({ user, args, say }) {
    const username = user.username;

    if (!args.length) {
      await say(`@${username}, Usage: #steam <sale/profile/recent/avatar> <Steam ID/Profile URL>`);
      return;
    }

    const subCommand = args[0].toLowerCase();
    const query = args.slice(1).join(' ');

    try {
      switch (subCommand) {
        case 'sale':
        case 'sales':
          await this.handleSalesCommand(username, say);
          break;
        case 'profile':
          await this.handleProfileCommand(username, query, say);
          break;
        case 'recent':
          await this.handleRecentGamesCommand(username, query, say);
          break;
        case 'avatar':
        case 'pfp':
          await this.handleAvatarCommand(username, query, say);
          break;
        default:
          await say(`@${username}, Invalid subcommand. Available commands: sale, profile, recent, avatar`);
      }
    } catch (error) {
      logger.error(`Steam command error: ${error}`);
      await say(`@${username}, An error occurred while processing your request.`);
    }
  }

  async handleSalesCommand(username, say) {
    try {
      const storeUrl = 'https://store.steampowered.com/api/featuredcategories';
      const storeResponse = await fetch(storeUrl);
      const storeData = await storeResponse.json();

      if (storeData.specials?.items?.length > 0) {
        const sales = storeData.specials.items
          .slice(0, 3)
          .map(item => {
            const finalPrice = (item.final_price / 100).toFixed(2);
            return `${item.name} (-${item.discount_percent}% • $${finalPrice})`;
          })
          .join(' • ');

        await say(`@${username}, Current top sales: ${sales}`);
      } else {
        await say(`@${username}, No featured sales found at the moment.`);
      }
    } catch (error) {
      logger.error('Error fetching Steam sales:', error);
      throw new Error(`Sales fetch failed: ${error.message}`);
    }
  }

  async handleProfileCommand(username, query, say) {
    if (!query) {
      await say(`@${username}, Please provide a Steam ID or profile URL.`);
      return;
    }

    try {
      const steamId = await this.resolveSteamId(query);
      if (!steamId) {
        await say(`@${username}, Could not find Steam profile: ${query}`);
        return;
      }

      // Fetch profile, level, and games data concurrently
      const [profileData, levelData, gamesData] = await Promise.all([
        fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${this.apiKey}&steamids=${steamId}`)
          .then(res => res.json()),
        fetch(`https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${this.apiKey}&steamid=${steamId}`)
          .then(res => res.json()),
        fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${this.apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`)
          .then(res => res.json())
      ]);

      if (!profileData.response.players.length) {
        await say(`@${username}, No profile found.`);
        return;
      }

      const profile = profileData.response.players[0];
      const status = this.getPlayerStatus(profile.personastate);
      const gameInfo = profile.gameextrainfo ? ` • Playing: ${profile.gameextrainfo}` : '';
      const createdDate = profile.timecreated ? ` • Member since: ${new Date(profile.timecreated * 1000).getFullYear()}` : '';
      
      const levelInfo = levelData.response?.player_level ? 
        ` • Level: ${levelData.response.player_level}` : '';

      let gamesInfo = '';
      if (gamesData.response?.game_count) {
        const gameCount = gamesData.response.game_count;
        const totalPlaytime = gamesData.response.games.reduce((total, game) => total + game.playtime_forever, 0);
        const hoursPlayed = Math.round(totalPlaytime / 60).toLocaleString();
        gamesInfo = ` • Games: ${gameCount} • Playtime: ${hoursPlayed}h`;
      }
      
      await say(`@${username}, Profile: ${profile.personaname} • Status: ${status}${gameInfo}${levelInfo}${gamesInfo}${createdDate} • ${profile.profileurl}`);
    } catch (error) {
      throw new Error(`Profile fetch failed: ${error.message}`);
    }
  }

  async handleRecentGamesCommand(username, query, say) {
    if (!query) {
      await say(`@${username}, Please provide a Steam ID or profile URL.`);
      return;
    }

    try {
      const steamId = await this.resolveSteamId(query);
      if (!steamId) {
        await say(`@${username}, Could not find Steam profile: ${query}`);
        return;
      }

      const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${this.apiKey}&steamid=${steamId}&count=3`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.response || !data.response.total_count) {
        await say(`@${username}, No recent games found or profile is private.`);
        return;
      }

      const recentGames = data.response.games
        .map(game => `${game.name} (${Math.round(game.playtime_2weeks / 60)}h past 2 weeks)`)
        .join(' • ');

      await say(`@${username}, Recent games: ${recentGames}`);
    } catch (error) {
      throw new Error(`Recent games fetch failed: ${error.message}`);
    }
  }

  async handleAvatarCommand(username, query, say) {
    if (!query) {
      await say(`@${username}, Please provide a Steam ID or profile URL.`);
      return;
    }

    try {
      const steamId = await this.resolveSteamId(query);
      if (!steamId) {
        await say(`@${username}, Could not find Steam profile: ${query}`);
        return;
      }

      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${this.apiKey}&steamids=${steamId}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.response.players.length) {
        await say(`@${username}, No profile found.`);
        return;
      }

      const profile = data.response.players[0];
      const avatarUrl = profile.avatarfull || profile.avatarmedium || profile.avatar;
      
      await say(`@${username}, ${profile.personaname}'s avatar: ${avatarUrl}`);
    } catch (error) {
      throw new Error(`Avatar fetch failed: ${error.message}`);
    }
  }

  async resolveSteamId(query) {
    if (/^\d{17}$/.test(query)) {
      return query; // Already a Steam64 ID
    }

    const urlMatch = query.match(/(?:https?:\/\/)?steamcommunity\.com\/(?:id|profiles)\/([^\/]+)/);
    if (urlMatch) {
      query = urlMatch[1];
    }

    try {
      if (!/^\d+$/.test(query)) {
        const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${this.apiKey}&vanityurl=${query}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.response && data.response.success === 1) {
          return data.response.steamid;
        }
      }
    } catch (error) {
      logger.error(`Error resolving Steam ID: ${error}`);
    }
    return null;
  }

  getPlayerStatus(state) {
    const states = {
      0: 'Offline',
      1: 'Online',
      2: 'Busy',
      3: 'Away',
      4: 'Snooze',
      5: 'Looking to Trade',
      6: 'Looking to Play'
    };
    return states[state] || 'Unknown';
  }
}

export function setupSteam() {
  const steamHandler = new SteamHandler();
  return {
    steam: async (context) => await steamHandler.handleSteamCommand(context)
  };
}
