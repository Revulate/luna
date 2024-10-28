import { ServiceConfig } from './base';

export interface SteamGameInfo {
    appId: number;
    name: string;
    description: string;
    releaseDate: Date;
    developers: string[];
    publishers: string[];
    genres: string[];
    tags: string[];
    price?: {
        initial: number;
        final: number;
        discount?: number;
        currency: string;
    };
    metacritic?: {
        score: number;
        url: string;
    };
    media: {
        header: string;
        capsule: string;
        screenshots: string[];
        movies?: string[];
    };
}

export interface UserStats {
    steamId: string;
    appId: number;
    stats: Record<string, number>;
    achievements: Array<{
        name: string;
        achieved: boolean;
        unlockTime?: Date;
        description?: string;
        icon?: string;
    }>;
    totalPlaytime: number;
    lastPlayed?: Date;
}

export interface GameNews {
    appId: number;
    items: Array<{
        id: number;
        title: string;
        url: string;
        author: string;
        content: string;
        feedLabel: string;
        date: Date;
        feedName: string;
        tags?: string[];
    }>;
    count: number;
    lastUpdate: Date;
}
