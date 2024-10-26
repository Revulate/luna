import logger from './logger.js';

class PersonalityHandler {
  constructor() {
    logger.startOperation('Initializing PersonalityHandler');
    this.baseTraits = {
      playfulness: 0.7,
      empathy: 0.8,
      wit: 0.75,
      formality: 0.3
    };
    
    this.channelAdaptations = new Map();
    this.userRelationships = new Map();
    this.moodHistory = new Map();
    
    // Add Twitch-specific traits
    this.twitchTraits = {
      emoteUsage: 0.7,
      chatEngagement: 0.8,
      moderation: 0.5,
      streamAwareness: 0.6
    };

    logger.debug('Personality traits initialized', {
      baseTraits: this.baseTraits,
      twitchTraits: this.twitchTraits
    });
  }

  updatePersonalityForContext(channel, user, context) {
    try {
      logger.debug(`Updating personality for ${channel}`, {
        username: user.username,
        contextType: context?.type
      });

      const traits = { ...this.baseTraits };
      
      // Adjust for channel mood
      if (context?.channel?.mood) {
        this.adjustForMood(traits, context.channel.mood);
      }

      // Adjust for user relationship
      const relationship = this.getUserRelationship(user.username);
      this.adjustForRelationship(traits, relationship);

      // Adjust for channel adaptation
      const channelAdaptation = this.channelAdaptations.get(channel);
      if (channelAdaptation) {
        this.adjustForChannel(traits, channelAdaptation);
      }

      logger.debug('Personality updated', { channel, traits });
      return traits;
    } catch (error) {
      logger.error('Error updating personality:', error);
      return this.baseTraits;
    }
  }

  adjustForMood(traits, mood) {
    switch(mood) {
      case 'hype':
        traits.playfulness += 0.2;
        traits.formality -= 0.1;
        break;
      case 'serious':
        traits.formality += 0.2;
        traits.playfulness -= 0.1;
        break;
      case 'funny':
        traits.wit += 0.2;
        traits.formality -= 0.2;
        break;
    }
  }

  adjustForRelationship(traits, relationship) {
    if (!relationship) return;

    traits.formality = Math.max(0, traits.formality - (relationship.familiarity * 0.1));
    traits.playfulness = Math.min(1, traits.playfulness + (relationship.rapport * 0.1));
  }

  adjustForChannel(traits, adaptation) {
    Object.entries(adaptation).forEach(([trait, value]) => {
      if (traits.hasOwnProperty(trait)) {
        traits[trait] = Math.max(0, Math.min(1, traits[trait] + value));
      }
    });
  }

  getUserRelationship(username) {
    return this.userRelationships.get(username) || {
      familiarity: 0,
      rapport: 0,
      lastInteraction: 0
    };
  }

  updateUserRelationship(username, interaction) {
    const current = this.getUserRelationship(username);
    
    current.familiarity = Math.min(1, current.familiarity + 0.1);
    current.rapport = Math.min(1, current.rapport + 0.05);
    current.lastInteraction = Date.now();

    this.userRelationships.set(username, current);
  }

  updateChannelAdaptation(channel, mood, activity) {
    let adaptation = this.channelAdaptations.get(channel) || {};
    
    // Update based on channel activity and mood
    if (activity > 0.7) {
      adaptation.playfulness = (adaptation.playfulness || 0) + 0.1;
      adaptation.formality = (adaptation.formality || 0) - 0.1;
    }

    this.channelAdaptations.set(channel, adaptation);
  }

  adjustForStreamContext(traits, streamData) {
    if (!streamData) return traits;

    // Adjust based on stream category
    if (streamData.gameName) {
      switch (streamData.gameName.toLowerCase()) {
        case 'just chatting':
          traits.chatEngagement += 0.2;
          break;
        case 'minecraft':
        case 'fortnite':
          traits.emoteUsage += 0.1;
          break;
      }
    }

    return traits;
  }
}

export function setupPersonality() {
  return new PersonalityHandler();
}
