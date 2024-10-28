import { Service } from './services';
import { ServiceConfig } from './base';

export interface SevenTvConfig extends ServiceConfig {
    cacheTimeout: number;
    retryAttempts: number;
    retryDelay: number;
}

export interface SevenTvService extends Service {
    getChannelEmotes(channelId: string): Promise<SevenTvEmote[]>;
    getUserDetailsById(userId: string): Promise<SevenTvUser>;
    getEmotesByQuery(query: string, sort?: string): Promise<SevenTvEmote[]>;
    findExactEmote(name: string): Promise<SevenTvEmote | null>;
}

export interface SevenTvEmote {
    id: string;
    name: string;
    owner?: SevenTvUser;
    actorId?: string;
    animated: boolean;
    flags: number;
    aliases: string[];
    urls: string[];
    emotePageUrl?: string;
}

export interface SevenTvUser {
    id: string;
    username: string;
    displayName: string;
    roles?: string[];
    avatar?: string;
}

export interface EmoteSet {
    id: string;
    name: string;
    emotes: SevenTvEmote[];
    owner: SevenTvUser;
    capacity: number;
}

export interface EmoteSearchResult {
    items: SevenTvEmote[];
    totalCount: number;
}

export interface EmoteSearchOptions {
    query: string;
    page?: number;
    limit?: number;
    sort?: 'popularity' | 'age' | 'name' | 'trending';
    filter?: {
        category?: string;
        animated?: boolean;
        zeroWidth?: boolean;
    };
}
