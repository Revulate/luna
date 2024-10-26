import logger from './logger.js';
import { CLAUDE_MODEL, MAX_TOKENS, TEMPERATURE, OTHER_PROMPT } from '../constants/claude.js';
import { google } from 'googleapis';
import { config } from '../config.js';
import { ApiClient } from '@twurple/api';

class URLAnalysisHandler {
  constructor(apiClient, anthropic) {
    logger.debug('Initializing URLAnalysisHandler');
    this.apiClient = apiClient;
    this.anthropic = anthropic;
  }

  async analyzeTwitchStream(channelName) {
    logger.startOperation(`Analyzing Twitch stream: ${channelName}`);
    try {
      const user = await this.apiClient.users.getUserByName(channelName);
      if (!user) {
        logger.warn(`Channel not found: ${channelName}`);
        return `Channel ${channelName} not found`;
      }

      // Use Twurple's new methods for comprehensive stream data
      const [stream, channel, follows, videos] = await Promise.all([
        this.apiClient.streams.getStreamByUserId(user.id),
        this.apiClient.channels.getChannelInfoById(user.id),
        this.apiClient.channels.getChannelFollowers(user.id),
        this.apiClient.videos.getVideosByUser(user.id, { limit: 1 })
      ]);

      if (!stream) {
        const lastVideo = videos.data[0];
        logger.debug(`Channel ${channelName} is offline`);
        return `${channelName} is offline. Last live: ${
          lastVideo ? new Date(lastVideo.creationDate).toLocaleDateString() : 'Unknown'
        }`;
      }

      // Log stream data
      logger.debug('Stream data retrieved', {
        title: stream.title,
        game: stream.gameName,
        viewers: stream.viewers
      });

      // Enhanced stream data using Twurple's new fields
      const streamData = {
        title: stream.title,
        game: stream.gameName,
        viewerCount: stream.viewers,
        startTime: stream.startDate,
        tags: channel.tags,
        language: stream.language,
        thumbnailUrl: stream.getThumbnailUrl(1280, 720),
        followersCount: follows.total,
        contentClassification: stream.contentClassificationLabels
      };

      const prompt = `Analyze this live Twitch stream that I'm actively checking right now:
        Channel: ${channelName}
        Title: "${streamData.title}"
        Game: ${streamData.game}
        Viewers: ${streamData.viewerCount}
        Stream Category: ${streamData.category}
        Stream Tags: ${streamData.tags.join(', ')}
        Current Uptime: ${streamData.uptime}
        
        Generate a brief, natural response about what's happening in the stream right now.
        Focus on the current activity and game state.
        Keep it concise and use 1-2 appropriate Twitch emotes.`;

      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: OTHER_PROMPT,
        messages: [{ role: "user", content: prompt }]
      });

      return response.content[0].text.trim();
    } catch (error) {
      logger.error('Error analyzing Twitch stream:', { error, channelName });
      throw error;
    }
  }

  async analyzeYouTubeVideo(url, question = '') {
    try {
      const videoId = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([^"&?\/\s]{11})/)?.[1];
      if (!videoId) return "Invalid YouTube URL";

      const youtube = google.youtube({
        version: 'v3',
        auth: config.youtube.apiKey
      });

      const response = await youtube.videos.list({
        part: ['snippet', 'statistics'],
        id: [videoId]
      });

      const video = response.data.items[0];
      const prompt = `Analyze this YouTube video:
        Title: ${video.snippet.title}
        Channel: ${video.snippet.channelTitle}
        Views: ${video.statistics.viewCount}
        Description: ${video.snippet.description}
        
        ${question ? `User asked: ${question}` : 'Provide a brief description of the video.'}`;

      const claudeResponse = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: OTHER_PROMPT,
        messages: [{ role: "user", content: prompt }]
      });

      return claudeResponse.content[0].text;
    } catch (error) {
      logger.error('Error analyzing YouTube video:', error);
      return "Sorry, I couldn't analyze that YouTube video at the moment.";
    }
  }

  getStreamUptime(startDate) {
    const duration = Date.now() - new Date(startDate).getTime();
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }
}

export function setupURLAnalysis(apiClient, anthropic) {
  return new URLAnalysisHandler(apiClient, anthropic);
}
