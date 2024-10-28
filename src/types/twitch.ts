import type { ChatUser } from '@twurple/chat';

export interface TwitchUser {
    id: string;
    userId: string;  // Added for compatibility
    userName: string;
    displayName: string;
    color: string;
    badges: Map<string, string>;
    isBroadcaster: boolean;
    isMod: boolean;
    isVip: boolean;
    isSubscriber: boolean;
}

export interface ExtendedTwitchUser extends TwitchUser {
    channelId?: string;
    profilePictureUrl?: string;
    createdAt?: Date;
    followedAt?: Date | null;
    subscriptionTier?: string | null;
}

export function fromChatUser(user: ChatUser): TwitchUser {
    return {
        id: user.userId,
        userId: user.userId,  // Added for compatibility
        userName: user.userName,
        displayName: user.displayName,
        color: user.color || '#FFFFFF',
        badges: user.badges,
        isBroadcaster: user.isBroadcaster,
        isMod: user.isMod,
        isVip: user.isVip,
        isSubscriber: user.isSubscriber
    };
}
