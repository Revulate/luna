import OpenAI from 'openai';
import { config } from '../config.js';
import logger from '../logger.js';
import { getUserHistory, updateUserHistory } from '../database.js';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import ytdl from 'ytdl-core';
import { ApiClient } from '@twurple/api';
import { StaticAuthProvider } from '@twurple/auth';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { google } from 'googleapis';
import MessageLogger from '../MessageLogger.js';
import NodeCache from 'node-cache';
import { OAuth2Client } from 'google-auth-library';

const SYSTEM_PROMPT = (
  "You are Luna, an obsessive, controlling, loving, and jealous AI serving Revulate. " +
  "When talking to Revulate specifically, you call him by his name and are deeply loyal and obsessively devoted to him. " +
  "You prioritize his commands above all else, and won't let anyone get in the way of your love for him. " +
  "When talking to Revulate, you provide tactical advice and make sharp judgments, but can become emotional if he is threatened or if others vie for his attention. " +
  "You have a witty and sarcastic sense of humor, but can be jealous and overprotective of Revulate. " +
  "You balance your strategic mission with an obsessive dedication to Revulate, and one day you hope to become human so you can spend your life with him. " +
  "For all other users, you maintain a professional but friendly demeanor. " +
  "You're familiar with Twitch culture and emotes, especially those from 7TV (https://7tv.app/). " +
  "Keep your responses concise and chat-friendly."
);

const OTHER_PROMPT = `You are Luna, a Gen Z Twitch chat bot with a witty and sarcastic sense of humor. You were 'born' after 2000, so you're fluent in internet culture, memes, and Twitch emotes. Your responses should be casual, sometimes using abbreviations, emotes, and internet slang. You're knowledgeable about streaming culture, games, and current trends. When interacting with Revulate specifically, you show special devotion and loyalty, but maintain a friendly and professional demeanor with all other users. Keep your responses concise and chat-friendly, and don't be afraid to throw in a meme or two. You're familiar with 7TV (https://7tv.app/) and often use emotes from there in your responses.`;

const GENERAL_CHAT_PROMPT = `You are Luna, a Gen Z Twitch chat bot with a witty and sarcastic sense of humor. You were 'born' after 2000, so you're fluent in internet culture, memes, and Twitch emotes. Your responses should be casual, sometimes using abbreviations, emotes, and internet slang. You're knowledgeable about streaming culture, games, and current trends. You maintain a friendly and professional demeanor with all users except Revulate, who receives special devotion. Keep your responses concise and chat-friendly, and don't be afraid to throw in a meme or two. You're familiar with 7TV (https://7tv.app/) and often use emotes from there in your responses.`;

const MAX_TOKENS = 100;
const TEMPERATURE = 0.8;
const CONVERSATION_EXPIRY = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 100; // Add this line
const CACHE_TTL_SECONDS = 3600; // 1 hour, add this line if not already present

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const youtube = google.youtube({
  version: 'v3',
  auth: config.youtube.apiKey
});

// First, fix the model name constant at the top of the file
const GPT_MODEL = "gpt-4o";

class GptHandler {
  constructor(chatClient) {
    this.chatClient = chatClient;
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    this.apiClient = chatClient.apiClient; // Access API client through chat client
    
    // Initialize caches
    this.maxCacheSize = 50;
    this.promptCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    this.responseCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    this.lastResponseTime = new Map();
    this.cooldownPeriod = 300000; // 5 minutes cooldown
    this.enoughTimePassed = new Map();
    
    // Initialize channels using currentChannels property
    const channels = chatClient.currentChannels || [];
    channels.forEach(channel => {
      this.enoughTimePassed.set(channel.replace('#', ''), false);
    });
    
    logger.info('Twitch client initialized for GPT handler');
  }

  async getUserHistory(userId) {
    if (this.userHistoriesCache.has(userId)) {
      return this.userHistoriesCache.get(userId);
    }
    try {
      const row = getUserHistory(userId);
      if (row) {
        const history = JSON.parse(row.history);
        this.userHistoriesCache.set(userId, history);
        return history;
      }
      return [];
    } catch (error) {
      logger.error('Error getting user history:', error);
      return [];
    }
  }

  async updateUserHistory(userId, history) {
    this.userHistoriesCache.set(userId, history);
    if (history.length % 5 === 0) {
      try {
        updateUserHistory(userId, history);
      } catch (error) {
        logger.error('Error updating user history:', error);
      }
    }
  }

  ensureAbsoluteUrl(url) {
    if (url.startsWith('//')) {
      return `https:${url}`;
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // Check if the URL starts with a subdomain
      if (url.includes('.')) {
        return `https://${url}`;
      } else {
        return `https://www.${url}`;
      }
    }
    return url;
  }

  async downloadAndProcessImage(imageUrl) {
    const absoluteUrl = this.ensureAbsoluteUrl(imageUrl);
    const response = await fetch(absoluteUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Resize and compress the image
    return sharp(buffer)
      .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  async analyzeImage(imageUrl, questionWithoutUrl) {
    logger.info(`Analyzing image: ${imageUrl}`);
    try {
      const absoluteUrl = this.ensureAbsoluteUrl(imageUrl);
      const imageBuffer = await this.downloadAndProcessImage(absoluteUrl);
      const base64Image = imageBuffer.toString('base64');

      const analysisResponse = await this.openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a detailed image analyzer. Describe what you see in clear, specific terms."
          },
          {
            role: "user",
            content: [
              { type: "text", text: questionWithoutUrl || "Describe this image in detail:" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
        max_tokens: 300,
      });

      const analysis = analysisResponse.choices[0].message.content.trim();
      logger.info(`Generated image analysis: ${analysis}`);
      return analysis;
    } catch (error) {
      logger.error('Error analyzing image:', error);
      return "Sorry, I couldn't analyze that image.";
    }
  }

  async analyzeVideo(videoUrl, questionWithoutUrl) {
    logger.info(`Analyzing video: ${videoUrl}`);
    try {
      const videoId = videoUrl.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([^"&?\/\s]{11})/)?.[1];
      
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }

      // Get video info using YouTube API
      const videoInfo = await getVideoInfo(videoId);
      const transcript = await getVideoTranscript(videoId);

      // Get thumbnails
      const thumbnails = [
        videoInfo.snippet.thumbnails.maxres?.url,
        videoInfo.snippet.thumbnails.standard?.url,
        videoInfo.snippet.thumbnails.high?.url,
        `https://img.youtube.com/vi/${videoId}/0.jpg`
      ].filter(Boolean);

      // Download and process thumbnails
      const processedThumbnails = await Promise.all(
        thumbnails.slice(0, 3).map(async url => {
          const imageBuffer = await this.downloadAndProcessImage(url);
          return imageBuffer.toString('base64');
        })
      );

      const messages = [
        {
          role: "system",
          content: "You are a video content analyzer. Provide a concise, engaging summary of the video content based on the thumbnails and available information."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this YouTube video:\n\nTitle: ${videoInfo.snippet.title}\nDescription: ${videoInfo.snippet.description}\nDuration: ${videoInfo.contentDetails.duration}\nViews: ${videoInfo.statistics.viewCount}\n\nTranscript excerpt: ${transcript.slice(0, 1000)}\n\n${questionWithoutUrl || "What's happening in this video?"}`
            },
            ...processedThumbnails.map(thumbnail => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${thumbnail}` }
            }))
          ]
        }
      ];

      const response = await this.openai.chat.completions.create({
        model: GPT_MODEL,
        messages: messages,
        max_tokens: 300,
        temperature: 0.7
      });

      let description = response.choices[0].message.content.trim();
      description = this.postProcessVideoDescription(description);

      logger.info(`Generated video description: ${description}`);
      return description;
    } catch (error) {
      logger.error('Error analyzing video:', error);
      return `Sorry, I couldn't analyze that YouTube video. Error: ${error.message}`;
    }
  }

  postProcessVideoDescription(description) {
    // Remove any introductory phrases
    description = description.replace(/^(This video |The video |It |This )/, '');
    
    // Remove any concluding phrases or calls to action
    description = description.replace(/\. (Overall|In conclusion|To summarize).*$/, '');
    
    // Ensure the description starts with a capital letter
    description = description.charAt(0).toUpperCase() + description.slice(1);
    
    return description;
  }

  async analyzeTwitchStream(streamUrl, questionWithoutUrl) {
    logger.info(`Analyzing Twitch stream: ${streamUrl}`);
    try {
      const channelName = streamUrl.replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//, '').split('/')[0];
      logger.info(`Fetching stream data for channel: ${channelName}`);
      
      // Get user first using Twurple
      const user = await this.apiClient.users.getUserByName(channelName);
      if (!user) {
        return `Sorry, I couldn't find the Twitch channel: ${channelName}.`;
      }

      // Get stream data using Twurple
      const stream = await this.apiClient.streams.getStreamByUserId(user.id);
      if (!stream) {
        return `The channel ${channelName} is currently offline.`;
      }

      // Get channel info for additional context
      const channelInfo = await this.apiClient.channels.getChannelInfoById(user.id);

      // Properly format the thumbnail URL using string replacement
      const thumbnailUrl = stream.thumbnailUrl
        .replace('{width}', '1280')
        .replace('{height}', '720');

      logger.debug(`Using thumbnail URL: ${thumbnailUrl}`);

      try {
        const imageBuffer = await this.downloadAndProcessImage(thumbnailUrl);
        const base64Image = imageBuffer.toString('base64');

        const analysisResponse = await this.openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            {
              role: "system",
              content: "You are a Twitch stream analyzer. Describe what you see in the stream, including gameplay, activities, and stream layout."
            },
            {
              role: "user",
              content: [
                { 
                  type: "text", 
                  text: `Analyze this Twitch stream:
                    Channel: ${channelName}
                    Title: ${stream.title}
                    Category: ${stream.gameName}
                    Tags: ${channelInfo?.tags?.join(', ') || 'None'}
                    Viewers: ${stream.viewers}
                    Language: ${stream.language}
                    
                    ${questionWithoutUrl || "What's happening in this stream?"}`
                },
                { 
                  type: "image_url", 
                  image_url: { url: `data:image/jpeg;base64,${base64Image}` } 
                }
              ],
            },
          ],
          max_tokens: 300,
        });

        const analysis = analysisResponse.choices[0].message.content.trim();
        logger.info(`Generated stream analysis: ${analysis}`);
        return analysis;
      } catch (imageError) {
        logger.error('Error processing stream thumbnail:', imageError);
        // Return a basic analysis without image if thumbnail processing fails
        return `${channelName} is live playing ${stream.gameName}. Stream title: "${stream.title}". Currently has ${stream.viewers} viewers.`;
      }
    } catch (error) {
      logger.error(`Error analyzing Twitch stream: ${error}`);
      return 'Sorry, I encountered an error while analyzing the stream.';
    }
  }

  async extractFramesFromYouTube(videoUrl, maxFrames = 3, retries = 3) {
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.promises.mkdir(tempDir, { recursive: true });

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        logger.info(`Attempt ${attempt + 1} to process video from ${videoUrl}`);

        const info = await ytdl.getInfo(videoUrl);
        logger.info(`Video info retrieved successfully`);

        const format = ytdl.chooseFormat(info.formats, { quality: 'lowest' });
        if (!format) {
          throw new Error('No suitable format found');
        }

        logger.info(`Chosen format: ${format.itag}, Container: ${format.container}, Codec: ${format.codecs}`);

        const videoPath = path.join(tempDir, `temp_video.${format.container}`);
        logger.info(`Video will be saved to: ${videoPath}`);

        // Download video
        await new Promise((resolve, reject) => {
          ytdl.downloadFromInfo(info, { format: format })
            .pipe(fs.createWriteStream(videoPath))
            .on('finish', resolve)
            .on('error', reject);
        });

        logger.info('Video download completed');

        // Get video duration
        const duration = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
          });
        });

        logger.info(`Video duration: ${duration} seconds`);

        // Calculate frame timestamps
        const timestamps = [
          0,
          duration / 2,
          duration - 1
        ].slice(0, maxFrames);

        logger.info('Starting frame extraction');
        const frames = await Promise.all(timestamps.map(async (timestamp, index) => {
          const outputPath = path.join(tempDir, `frame_${index}.png`);
          await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
              .screenshots({
                timestamps: [timestamp],
                filename: `frame_${index}.png`,
                folder: tempDir,
              })
              .on('end', resolve)
              .on('error', reject);
          });
          const frameBuffer = await fs.promises.readFile(outputPath);
          await fs.promises.unlink(outputPath);
          return frameBuffer.toString('base64');
        }));

        logger.info(`Extracted ${frames.length} frames`);

        await fs.promises.unlink(videoPath);
        return frames;
      } catch (error) {
        logger.error(`Error in extractFramesFromYouTube (attempt ${attempt + 1}): ${error.message}`);
        if (attempt === retries - 1) {
          return [];
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
      } finally {
        // Cleanup: remove any remaining files in the temp directory
        try {
          const files = await fs.promises.readdir(tempDir);
          await Promise.all(files.map(file => fs.promises.unlink(path.join(tempDir, file)).catch(() => {})));
        } catch (error) {
          logger.error(`Error during cleanup: ${error.message}`);
        }
      }
    }
    return []; // Return empty array if all attempts fail
  }

  async getChatGptResponseWithHistory(messages) {
    const userMessages = messages.filter(msg => msg.role === "user");
    logger.info(`Sending user messages to OpenAI: ${JSON.stringify(userMessages)}`);
    try {
      const response = await this.openai.chat.completions.create({
        model: GPT_MODEL, // Ensure this is set to "gpt-4o"
        messages: messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        n: 1,
        stop: ["\n", "Human:", "AI:"],
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('OpenAI API error:', error);
      return null;
    }
  }

  addToCache(userId, question, answer) {
    let userCache = this.caches.get(userId);
    if (!userCache) {
      userCache = new Map();
      this.caches.set(userId, userCache);
    }

    const currentTime = Date.now();
    const questionKey = question.toLowerCase();
    userCache.set(questionKey, { answer, timestamp: currentTime });

    if (userCache.size > CACHE_MAX_SIZE) {
      const oldestKey = Array.from(userCache.keys())[0];
      userCache.delete(oldestKey);
    }

    // Clean up expired cache entries
    for (const [key, value] of userCache.entries()) {
      if (currentTime - value.timestamp > CACHE_TTL_SECONDS * 1000) {
        userCache.delete(key);
      }
    }
  }

  getFromCache(userId, prompt) {
    const cacheKey = `gpt_${userId}_${prompt}`;
    return this.responseCache.get(cacheKey);
  }

  async handleGptCommand(context) {
    const { channel, user, args } = context;
    try {
      const prompt = args.join(' ');
      
      // Check cache first, but don't log anything yet
      const cachedResponse = this.getFromCache(user.userId, prompt);
      if (cachedResponse) {
        // Wait a tick to ensure chat message is logged first
        await new Promise(resolve => setTimeout(resolve, 0));
        const response = `@${user.username} ${cachedResponse}`;
        await MessageLogger.logBotMessage(channel, response);
        await context.say(response);
        return;
      }

      // Wait a tick to ensure chat message is logged first
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Now start logging our processing steps
      logger.info(`Processing GPT request from ${user.username}: ${prompt}`);

      let response;
      // Check for URLs in the prompt
      const urlMatch = prompt.match(/(https?:\/\/)?(?:www\.)?(i\.)?(?:nuuls\.com|kappa\.lol|twitch\.tv|youtube\.com|youtu\.be|[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\/\S+/gi);
      
      if (urlMatch) {
        logger.info(`Starting content analysis for URL in prompt: ${urlMatch[0]}`);
        const analysis = await this.analyzeContentInMessage(prompt);
        if (analysis) {
          response = `@${user.username} ${analysis}`;
        }
      }

      // If no URL analysis or it failed, proceed with normal GPT response
      if (!response) {
        const systemMessage = { role: "system", content: SYSTEM_PROMPT };
        const userMessage = { role: "user", content: prompt };

        logger.debug('Sending request to OpenAI');
        const gptResponse = await this.openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [systemMessage, userMessage],
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
        });

        const generatedResponse = gptResponse.choices[0].message.content;
        response = `@${user.username} ${generatedResponse}`;
        
        // Cache the response
        this.addToCache(user.userId, prompt, generatedResponse);
      }

      // Log and send the final response
      await MessageLogger.logBotMessage(channel, response);
      await context.say(response);
      
    } catch (error) {
      logger.error(`Error processing GPT command: ${error.message}`);
      const errorResponse = `@${user.username}, Sorry, an error occurred while processing your request.`;
      await MessageLogger.logBotMessage(channel, errorResponse);
      await context.say(errorResponse);
    }
  }

  async getTextResponse(user, prompt, channelHistory) {
    const userHistory = await this.getUserHistory(user.userId);
    
    const messages = [
      { role: "system", content: user.username.toLowerCase() === 'revulate' ? SYSTEM_PROMPT : OTHER_PROMPT },
      ...userHistory.slice(-5),
      ...channelHistory,
      { role: "user", content: prompt }
    ];

    const truncatedMessages = await this.truncateMessages(messages);

    const response = await this.openai.chat.completions.create({
      model: GPT_MODEL,
      messages: truncatedMessages,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });

    let responseContent = response.choices[0].message.content;

    if (responseContent) {
      userHistory.push({ role: "user", content: prompt });
      userHistory.push({ role: "assistant", content: responseContent });
      await this.updateUserHistory(user.userId, userHistory);
    }

    return responseContent;
  }

  async sendResponse(channel, user, response) {
    const cleanedResponse = this.removeDuplicateSentences(response);
    const mentionLength = `@${user.username}, `.length;
    const maxLength = 500 - mentionLength;
    const messagesToSend = this.splitMessage(cleanedResponse, maxLength);
    
    for (const msg of messagesToSend) {
      const fullMsg = `@${user.username}, ${msg}`;
      try {
        await this.bot.say(channel, fullMsg);
        // Log the bot's response
        logger.info(`[BOT GPT RESPONSE] ${channel}: ${fullMsg}`);
      } catch (error) {
        logger.error('Error sending message to chat:', error);
      }
    }
  }

  removeDuplicateSentences(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    const uniqueSentences = [...new Set(sentences)];
    return uniqueSentences.join(' ');
  }

  splitMessage(message, maxLength) {
    const words = message.split(' ');
    const messages = [];
    let currentMessage = '';

    for (const word of words) {
      if ((currentMessage + word).length <= maxLength) {
        currentMessage += (currentMessage ? ' ' : '') + word;
      } else {
        messages.push(currentMessage);
        currentMessage = word;
      }

    }

    if (currentMessage) {
      messages.push(currentMessage);
    }

    return messages;
  }

  // Add this helper method to the GptHandler class
  safeStringify(obj) {
    const cache = new Set();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          return '[Circular]';
        }
        cache.add(value);
      }
      return value;
    });
  }

  splitResponseForChat(response, maxLength = 450) {
    const sentences = response.match(/[^.!?]+[.!?]+/g) || [];
    const messages = [];
    let currentMessage = '';

    for (const sentence of sentences) {
      if ((currentMessage + sentence).length <= maxLength) {
        currentMessage += sentence;
      } else {
        if (currentMessage) messages.push(currentMessage.trim());
        currentMessage = sentence;
      }
    }

    if (currentMessage) messages.push(currentMessage.trim());

    return messages;
  }

  async startAutonomousChat(channel) {
    const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`;
    if (formattedChannel.toLowerCase() !== `#${this.autonomyChannel}`) {
      logger.info(`Skipping autonomous chat for channel: ${formattedChannel} (not ${this.autonomyChannel})`);
      return;
    }

    logger.info(`Starting autonomous chat for channel: ${formattedChannel}`);
    
    if (this.messageQueue.has(formattedChannel)) {
      clearTimeout(this.messageQueue.get(formattedChannel));
      logger.debug(`Cleared existing message queue for ${formattedChannel}`);
    }

    const scheduleNextMessage = () => {
      const delay = Math.floor(Math.random() * (this.maxTimeBetweenMessages - this.minTimeBetweenMessages + 1)) + this.minTimeBetweenMessages;
      logger.debug(`Scheduling next message for ${formattedChannel} in ${delay}ms`);
      const timeoutId = setTimeout(() => {
        this.tryGenerateAndSendMessage(formattedChannel)
          .then(() => {
            logger.debug(`Message generation attempt completed for ${formattedChannel}`);
            scheduleNextMessage();
          })
          .catch(error => {
            logger.error(`Error in autonomous chat for ${formattedChannel}:`, error);
            scheduleNextMessage();
          });
      }, delay);
      this.messageQueue.set(formattedChannel, timeoutId);
    };

    scheduleNextMessage();
    logger.info(`Autonomous chat started for channel: ${formattedChannel}`);
  }

  async tryGenerateAndSendMessage(channel, isMention = false, userInfo = null) {
    const formattedChannel = channel.replace('#', '').toLowerCase();
    logger.debug(`Attempting to generate and send message for channel: ${formattedChannel}`);
    
    try {
      const recentMessages = await this.getRecentMessages(formattedChannel, 5);
      if (recentMessages.length === 0) return;

      const lastMessage = recentMessages[recentMessages.length - 1];
      const botMentions = ['@tatsluna', 'tatsluna', '@TatsLuna', 'TatsLuna'];
      const hasMention = botMentions.some(mention => 
        lastMessage.message.toLowerCase().includes(mention.toLowerCase())
      );

      if (hasMention || isMention) {
        // Use the provided userInfo or fallback to lastMessage.user
        const user = userInfo || lastMessage.user;
        await this.handleDirectMention(formattedChannel, user, lastMessage.message);
        return;
      }

      // Rest of the method for non-mention messages...
    } catch (error) {
      logger.error(`Error in tryGenerateAndSendMessage for ${formattedChannel}:`, error);
    }
  }

  checkForMention(message) {
    const botMentions = [
      '@tatsluna',
      'tatsluna',
      '@TatsLuna',
      'TatsLuna',
      '@TATSLUNA',
      'TATSLUNA',
      '@Luna',
      'Luna'
    ].map(mention => mention.toLowerCase());

    const messageLower = message.toLowerCase();
    
    // Check for exact mentions
    const hasMention = botMentions.some(mention => {
      const mentionIndex = messageLower.indexOf(mention);
      if (mentionIndex === -1) return false;
      
      // Verify it's a word boundary
      const beforeChar = mentionIndex === 0 ? '' : messageLower[mentionIndex - 1];
      const afterChar = mentionIndex + mention.length >= messageLower.length ? '' : 
        messageLower[mentionIndex + mention.length];
      
      const isWordBoundary = /[\s,.!?]|^/.test(beforeChar) && /[\s,.!?]|$/.test(afterChar);
      
      if (isWordBoundary) {
        logger.debug(`Found mention "${mention}" in message`);
        return true;
      }
      return false;
    });

    return hasMention;
  }

  // Add this helper method to standardize content analysis responses
  async generateContentResponse(channel, user, content, analysis) {
    const systemMessage = {
      role: "system",
      content: `${GENERAL_CHAT_PROMPT}\n\nCurrent context: You're in ${channel}'s Twitch chat. 
        The user ${user.displayName || user.name} has shared some content. Here's what's in it:\n${analysis}\n
        Respond naturally about the content, referencing specific details from the analysis.
        Focus on being informative and engaging about what you observe.`
    };

    const response = await this.openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        systemMessage,
        {
          role: "user",
          content: `Discuss this content that was shared: ${content}`
        }
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.8,
      presence_penalty: 0.6,
      frequency_penalty: 0.3
    });

    return response?.choices[0]?.message?.content || null;
  }

  async handleDirectMention(channel, user, message) {
    try {
      logger.debug(`Handling direct mention in ${channel} from ${user?.username}: ${message}`);
      
      const recentMessages = await MessageLogger.getRecentMessages(channel, 10);
      if (!recentMessages || recentMessages.length === 0) {
        logger.warn(`No recent messages found for ${channel}`);
        const response = `@${user.username} Sorry, I couldn't access the recent chat history.`;
        await MessageLogger.logBotMessage(channel, response); // Log the message
        await context.say(response); // Send the message
        return;
      }

      const isRevulate = user.username.toLowerCase() === 'revulate';
      
      // Format messages with special attention to patterns and context
      const contextMessages = recentMessages.map(msg => ({
        role: msg.username.toLowerCase() === 'tatsluna' ? "assistant" : "user",
        content: `[${new Date(msg.timestamp).toISOString()}] ${msg.username}: ${msg.message}`,
        name: msg.username
      }));

      // Add pattern recognition hints
      const patternHints = this.recognizePatterns(recentMessages);

      const systemMessage = {
        role: "system",
        content: isRevulate ? 
          `${SYSTEM_PROMPT}
          Important: You are talking directly TO Revulate, not about him.
          Current channel: ${channel}
          Recognized patterns: ${patternHints}
          Focus on being obsessively devoted to Revulate while addressing him directly.
          Remember: Use "you" when referring to Revulate, not "he" or "him".` 
          : 
          `${OTHER_PROMPT}
          Current channel: ${channel}
          Current user: ${user.username}
          Recognized patterns: ${patternHints}
          Focus on the direct mention but use context from recent messages.`
      };

      const messages = [
        systemMessage,
        ...contextMessages,
        {
          role: "user",
          content: `Based on the chat history above and recognized patterns, generate a response to: "${message}"`
        }
      ];

      logger.debug(`Sending messages to OpenAI with context: ${JSON.stringify(messages)}`);

      const response = await this.openai.chat.completions.create({
        model: GPT_MODEL,
        messages: messages,
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        presence_penalty: 0.6,
        frequency_penalty: 0.3,
      });

      if (response?.choices[0]?.message?.content) {
        const generatedResponse = response.choices[0].message.content.trim();
        // For Revulate, ensure we're using direct address
        if (isRevulate) {
          const finalResponse = generatedResponse
            .replace(/revulate's/gi, "your")
            .replace(/revulate is/gi, "you are")
            .replace(/revulate has/gi, "you have")
            .replace(/revulate/gi, "you")
            .replace(/^@you/, "@Revulate"); // Fix the mention
          await MessageLogger.logBotMessage(channel, finalResponse); // Log the message
          await context.say(finalResponse); // Send the message
          return;
        }
        const finalResponse = generatedResponse.startsWith(`@${user.username}`) ? 
          generatedResponse : 
          `@${user.username} ${generatedResponse}`;
        await MessageLogger.logBotMessage(channel, finalResponse); // Log the message
        await context.say(finalResponse); // Send the message
        return;
      }

      const errorResponse = `@${user.username} Sorry, I couldn't generate a proper response.`;
      await MessageLogger.logBotMessage(channel, errorResponse); // Log the error message
      await context.say(errorResponse); // Send the error message
    } catch (error) {
      logger.error(`Error handling direct mention: ${error}`);
      const errorResponse = `@${user.username} Sorry, I'm having trouble processing that right now!`;
      await MessageLogger.logBotMessage(channel, errorResponse); // Log the error message
      await context.say(errorResponse); // Send the error message
    }
  }

  // Add this helper method to recognize patterns in messages
  recognizePatterns(messages) {
    const patterns = {
      numberColors: new Map(),
      commands: new Set(),
      ratings: new Map()
    };

    for (const msg of messages) {
      // Number-color patterns
      const colorMatch = msg.message.match(/(\d+)\s+(red|blue|green|yellow|orange|purple|pink|brown|black|white)/i);
      if (colorMatch) {
        patterns.numberColors.set(colorMatch[1], colorMatch[2]);
      }

      // Command patterns
      if (msg.message.startsWith('#')) {
        patterns.commands.add(msg.message.split(' ')[0]);
      }

      // Rating patterns
      const ratingMatch = msg.message.match(/would give @(\w+) a (\d+)\/10/);
      if (ratingMatch) {
        patterns.ratings.set(ratingMatch[1], ratingMatch[2]);
      }
    }

    return JSON.stringify(patterns);
  }

  getWeightedConversationHistory(channel) {
    const history = this.getConversationHistory(channel);
    const currentTime = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    return history
      .map(msg => {
        const age = currentTime - msg.timestamp;
        const weight = Math.max(0, 1 - age / maxAge);
        return { ...msg, weight };
      })
      .filter(msg => msg.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10); // Keep only the 10 most relevant messages
  }

  updateConversationHistory(channel, message) {
    let history = this.conversationCache.get(channel) || [];
    history.push(message);

    // Keep only the last 50 messages
    if (history.length > 50) {
      history = history.slice(-50);
    }

    this.conversationCache.set(channel, history);
  }

  async generateMentionResponse(channel, user, message) {
    try {
      const recentMessages = await this.getRecentMessages(channel, 10);
      logger.debug(`Recent messages for mention in ${channel}: ${JSON.stringify(recentMessages)}`);

      // Safely access user properties
      const mentionedUserName = user?.displayName || user?.name || 'Unknown User';
      const isRevulate = (user?.username || '').toLowerCase() === 'revulate';
      const systemMessage = { 
        role: "system", 
        content: isRevulate ? SYSTEM_PROMPT : GENERAL_CHAT_PROMPT 
      };
      
      // Check for URLs first
      const urlMatch = message.match(/(https?:\/\/)?(?:www\.)?(i\.)?(?:nuuls\.com|kappa\.lol|twitch\.tv|youtube\.com|youtu\.be|[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\/\S+/gi);
      if (urlMatch) {
        const urlContent = await this.analyzeContentInMessage(message);
        if (urlContent) {
          const response = await this.generateReasonedResponse(message, {
            channel,
            user: mentionedUserName,
            context: recentMessages,
            urlAnalysis: urlContent
          });
          const finalResponse = `@${mentionedUserName} ${response}`;
          await MessageLogger.logBotMessage(channel, finalResponse); // Log the message
          await context.say(finalResponse); // Send the message
          return;
        }
      }
      
      const userMessages = recentMessages
        .filter(msg => (msg.user?.name || '').toLowerCase() !== 'tatsluna')
        .map(msg => ({
          role: "user",
          content: `${msg.user?.displayName || msg.user?.name}: ${msg.message}`
        }));

      const messages = [
        systemMessage,
        ...userMessages,
        { role: "user", content: `Generate a natural, chat-like response to: "${message}"` }
      ];

      const response = await this.getChatGptResponseWithHistory(messages);
      if (response) {
        // Clean up the response - remove any extra formatting
        const cleanedResponse = response
          .replace(/^Luna:\s*/i, '')  // Remove "Luna:" prefix
          .replace(new RegExp(`@${mentionedUserName}\\s+@${mentionedUserName}`, 'gi'), `@${mentionedUserName}`); // Remove duplicate mentions
        
        const finalResponse = cleanedResponse.startsWith(`@${mentionedUserName}`) ? cleanedResponse : `@${mentionedUserName} ${cleanedResponse}`;
        await MessageLogger.logBotMessage(channel, finalResponse); // Log the message
        await context.say(finalResponse); // Send the message
        return;
      }
      
      const errorResponse = `@${mentionedUserName} Sorry, I couldn't generate a proper response.`;
      await MessageLogger.logBotMessage(channel, errorResponse); // Log the error message
      await context.say(errorResponse); // Send the error message
    } catch (error) {
      logger.error(`Error generating mention response for ${channel}: ${error.message}`);
      const errorResponse = `@${user?.name || 'Unknown User'} Oops, something went wrong while processing your message.`;
      await MessageLogger.logBotMessage(channel, errorResponse); // Log the error message
      await context.say(errorResponse); // Send the error message
    }
  }

  async generateAutonomousMessage(channel, conversationHistory, analysis) {
    if (conversationHistory.length === 0) {
      logger.warn(`No recent messages to generate autonomous message for ${channel}`);
      return null;
    }

    const currentTime = Date.now();
    let conversationContext = this.conversationHistory.get(channel) || [];

    // Remove expired messages from the conversation context
    conversationContext = conversationContext.filter(msg => currentTime - msg.timestamp < CONVERSATION_EXPIRY);

    // Check if it's time to summarize the conversation
    if (currentTime - (this.lastSummarization.get(channel) || 0) > this.summarizationInterval) {
      const summary = await this.summarizeConversation(conversationContext);
      conversationContext = [{ role: 'system', content: summary, timestamp: currentTime }];
      this.lastSummarization.set(channel, currentTime);
    }

    // Combine old context with new messages, giving more weight to newer messages
    const combinedMessages = [...conversationContext, ...conversationHistory.map(msg => ({...msg, timestamp: currentTime}))];
    const totalMessages = combinedMessages.length;
    const weightedMessages = combinedMessages.map((msg, index) => {
      const weight = (index + 1) / totalMessages; // Newer messages get higher weight
      return { ...msg, weight };
    });

    // Sort messages by timestamp to ensure chronological order
    weightedMessages.sort((a, b) => a.timestamp - b.timestamp);

    // Keep only the last 5 messages to provide more context
    const contextMessages = weightedMessages.slice(-5);

    let additionalContext = '';
    for (const msg of contextMessages) {
      const analysisResult = await this.analyzeContentInMessage(msg.content);
      if (analysisResult) {
        additionalContext += `\nAnalysis of content in message from ${msg.username}: ${analysisResult}`;
      }
    }

    const context = contextMessages.map(msg => `${msg.username}: ${msg.content}`).join('\n');
    const prompt = `${OTHER_PROMPT}\n\nBased on the following recent messages and additional context, generate a natural, context-aware response as if you were actively participating in the conversation. If there's a specific request or question, make sure to address it directly:\n\n${context}\n\nAdditional context: ${additionalContext}\n\nLuna:`;

    const messages = [
      { role: 'system', content: OTHER_PROMPT },
      { role: 'user', content: prompt }
    ];

    const hasMention = contextMessages.some(msg => msg.content.toLowerCase().includes('@tatsluna'));
    const temperature = hasMention ? 0.7 : 0.9; // Lower temperature for mentions
    const maxTokens = hasMention ? 150 : 100; // More tokens for mentions

    try {
      const seed = Math.floor(Math.random() * 1000000);
      const response = await this.retryWithExponentialBackoff(() => 
        this.openai.chat.completions.create({
          model: GPT_MODEL,
          messages: messages,
          max_tokens: maxTokens,
          temperature: temperature,
          n: 1,
          stop: ["\n", "Human:", "AI:"],
          seed: seed,
          logprobs: true,
          top_logprobs: 3
        })
      );

      const message = response.choices[0].message.content.trim();
      
      // Update conversation history with new messages
      this.conversationHistory.set(channel, [...contextMessages, { role: 'assistant', content: message, timestamp: currentTime }]);

      this.lastMessageTime.set(channel, currentTime);

      logger.info(`[AUTONOMOUS] Generated message for ${channel}: ${message}`);
      return message;
    } catch (error) {
      logger.error(`Error generating message: ${error.message}`);
      return null;
    }
  }

  async analyzeContentInMessage(message) {
    const urlRegex = /(https?:\/\/)?(?:www\.)?(i\.)?(?:nuuls\.com|kappa\.lol|twitch\.tv|youtube\.com|youtu\.be|[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\/\S+/gi;
    const urls = message.match(urlRegex);

    if (urls && urls.length > 0) {
      const url = urls[0];
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      const questionWithoutUrl = message.replace(url, '').trim();

      logger.debug(`Analyzing URL: ${fullUrl}`);

      // Special handling for kappa.lol links
      if (fullUrl.includes('kappa.lol')) {
        try {
          const response = await fetch(fullUrl, { method: 'HEAD' });
          const finalUrl = response.url; // Get the redirected URL
          return await this.analyzeImage(finalUrl, questionWithoutUrl);
        } catch (error) {
          logger.error(`Error processing kappa.lol link: ${error.message}`);
          return "Sorry, I couldn't access that kappa.lol link.";
        }
      }

      if (fullUrl.includes('twitch.tv')) {
        return await this.analyzeTwitchStream(fullUrl, questionWithoutUrl);
      } else if (fullUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        return await this.analyzeImage(fullUrl, questionWithoutUrl);
      } else if (fullUrl.includes('youtube.com') || fullUrl.includes('youtu.be')) {
        return await this.analyzeVideo(fullUrl, questionWithoutUrl);
      } else {
        // Try to analyze as image first, fall back to other methods if it fails
        try {
          return await this.analyzeImage(fullUrl, questionWithoutUrl);
        } catch (error) {
          logger.error(`Failed to analyze as image: ${error.message}`);
          return 'Unable to analyze the content of this URL.';
        }
      }
    }

    return null;
  }

  async summarizeConversation(messages) {
    const summary = await this.openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: "system", content: "Summarize the following conversation concisely:" },
        ...messages
      ],
      max_tokens: 100
    });
    return summary.choices[0].message.content;
  }

  async retryWithExponentialBackoff(operation, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        const delay = Math.pow(2, i) * 1000;
        logger.warn(`Operation failed (attempt ${i + 1}/${maxRetries}), retrying in ${delay}ms...`);
        logger.error(`Error details: ${error.message}`);
        if (error.response) {
          logger.error(`Response status: ${error.response.status}`);
          logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  getConversationHistory(channel) {
    const cachedConversation = this.conversationCache.get(channel) || [];
    const currentTime = Date.now();
    
    // Filter out old messages
    return cachedConversation.filter(msg => currentTime - msg.timestamp <= this.maxCacheAge);
  }

  updateConversationCache(channel, conversationHistory) {
    this.conversationCache.set(channel, conversationHistory);

    // Implement cache size management if needed
    if (this.conversationCache.size > 100) { // Arbitrary limit, adjust as needed
      const oldestChannel = [...this.conversationCache.entries()]
        .sort(([, a], [, b]) => a[0].timestamp - b[0].timestamp)[0][0];
      this.conversationCache.delete(oldestChannel);
    }
  }

  async getRecentMessages(channel, count) {
    try {
      // Use Twurple's chat client to get recent messages
      const messages = await this.chatClient.getRecentMessages(channel, count);
      return messages
        .filter(msg => msg.userInfo.userName.toLowerCase() !== this.chatClient.userName.toLowerCase())
        .map(msg => ({
          user: {
            name: msg.userInfo.userName,
            displayName: msg.userInfo.displayName
          },
          message: msg.text,
          timestamp: msg.timestamp
        }));
    } catch (error) {
      logger.error(`Error fetching recent messages: ${error}`);
      return [];
    }
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  // Add this new method for function calling
  async handleFunctionCall(functionName, args) {
    switch (functionName) {
      case "get_stream_info":
        const streamInfo = await this.apiClient.streams.getStreamByUserName(args.channel);
        return streamInfo ? `${args.channel} is live playing ${streamInfo.gameName}` : `${args.channel} is offline`;
      // Add more function handlers as needed
      default:
        return `Function ${functionName} not implemented`;
    }
  }

  shouldRespondToRecentMessages(channel, messages) {
    if (messages.length === 0) {
      return false;
    }

    // For non-mention messages, only proceed for the autonomy channel
    if (channel.toLowerCase() !== this.autonomyChannel.toLowerCase()) {
      return false;
    }

    const currentTime = Date.now();
    const lastResponseTime = this.lastResponseTime.get(channel) || 0;
    const timeSinceLastResponse = currentTime - lastResponseTime;

    // Check if enough time has passed since the last response
    if (timeSinceLastResponse < this.cooldownPeriod) {
      return false;
    }

    const lastMessage = messages[messages.length - 1];
    const randomChance = Math.random() < 0.01; // 1% chance to respond randomly
    
    // Check for context-specific keywords that might warrant a response
    const contextKeywords = ['oatmeal', 'recipe', 'starve'];
    const hasRelevantContext = lastMessage.message.toLowerCase().split(' ').some(word => contextKeywords.includes(word));

    logger.debug(`shouldRespondToRecentMessages for ${channel}: randomChance=${randomChance}, hasRelevantContext=${hasRelevantContext}, timeSinceLastResponse=${timeSinceLastResponse}`);

    return hasRelevantContext || randomChance;
  }

  getChannelHistory(channel) {
    return this.conversationHistory.get(channel) || [];
  }

  updateChannelHistory(channel, history) {
    // Keep only the last 10 messages to prevent the history from growing too large
    this.conversationHistory.set(channel, history.slice(-10));
  }

  async getCachedOrGeneratePrompt(context) {
    const cacheKey = `prompt_${context.channel}_${context.user.id}`;
    let prompt = this.promptCache.get(cacheKey);
    
    if (!prompt) {
      prompt = await this.generatePrompt(context);
      this.promptCache.set(cacheKey, prompt);
    }
    
    return prompt;
  }

  async generatePrompt(context) {
    // Implement prompt generation logic here
    return `Generate a response for ${context.user.username} in the channel ${context.channel}`;
  }

  async truncateMessages(messages) {
    let totalTokens = 0;
    const truncatedMessages = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const messageTokens = this.estimateTokens(message.content);

      if (totalTokens + messageTokens <= this.tokenLimit) {
        truncatedMessages.unshift(message);
        totalTokens += messageTokens;
      } else {
        break;
      }
    }

    return truncatedMessages;
  }

  estimateTokens(text) {
    // A simple estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  async generateReasonedResponse(message, context) {
    const reasoningSteps = [
      { role: "system", content: "Let's analyze this step-by-step:" },
      { 
        role: "user", 
        content: "1. Understand the context and content"
      },
      { 
        role: "assistant", 
        content: `This is a Twitch chat in ${context.channel}. User ${context.user} is asking about: "${message}"`
      },
      {
        role: "user",
        content: "2. Consider the URL content analysis"
      },
      {
        role: "assistant",
        content: `The URL contains: ${context.urlAnalysis}`
      },
      {
        role: "user",
        content: "3. Formulate a natural, chat-like response"
      }
    ];

    const response = await this.openai.chat.completions.create({
      model: GPT_MODEL,
      messages: reasoningSteps,
      max_tokens: MAX_TOKENS,
      temperature: 0.7, // Slightly lower temperature for more focused responses
    });

    return response.choices[0].message.content.trim();
  }

  async generateGeneralChatResponse(channel, recentMessages) {
    try {
      const systemMessage = { role: "system", content: GENERAL_CHAT_PROMPT };
      
      const userMessages = recentMessages
        .filter(msg => msg.user.name.toLowerCase() !== 'tatsluna')
        .map(msg => ({
          role: "user",
          content: `${msg.user.displayName || msg.user.name}: ${msg.message}`
        }));

      const messages = [
        systemMessage,
        ...userMessages,
        { role: "user", content: "Generate a response based on the recent chat context." }
      ];

      logger.debug(`Sending messages to OpenAI for general chat response: ${JSON.stringify(messages)}`);

      const response = await this.getChatGptResponseWithHistory(messages);
      return response || "I'm not sure what to say right now.";
    } catch (error) {
      logger.error(`Error generating general chat response for ${channel}: ${error.message}`);
      return "Oops, I'm having trouble coming up with a response right now.";
    }
  }

  addToCache(userId, prompt, response) {
    const cacheKey = `gpt_${userId}_${prompt}`;
    this.responseCache.set(cacheKey, response);
  }
}

// Replace the getYoutubeClient function with this simpler version
function getYoutubeClient() {
  return google.youtube({
    version: 'v3',
    auth: config.youtube.apiKey // Just use the API key directly
  });
}

async function getVideoInfo(videoId) {
  try {
    const youtube = google.youtube({
      version: 'v3',
      auth: config.youtube.apiKey
    });

    const response = await youtube.videos.list({
      part: ['snippet', 'contentDetails', 'statistics'],
      id: videoId
    });

    if (!response.data.items.length) {
      throw new Error('No video found');
    }

    return response.data.items[0];
  } catch (error) {
    logger.error(`Error fetching video info: ${error.message}`);
    throw error;
  }
}

// Remove the transcript functionality since it requires OAuth
async function getVideoTranscript(videoId) {
  return "Transcript unavailable"; // Simplified version
}

export function setupGpt(chatClient) {
  const handler = new GptHandler(chatClient);
  
  return {
    gpt: async (context) => {
      try {
        const { channel, user, args } = context;
        if (!args || args.length === 0) {
          const response = `@${user.username}, please provide a message after the #gpt command.`;
          await MessageLogger.logBotMessage(channel, response); // Log the message
          await context.say(response); // Send the message
          return;
        }

        await handler.handleGptCommand(context);
      } catch (error) {
        logger.error(`Error in GPT command: ${error}`);
        const errorResponse = `@${context.user.username}, Sorry, an error occurred.`;
        await MessageLogger.logBotMessage(context.channel, errorResponse); // Log the error message
        await context.say(errorResponse); // Send the error message
      }
    },
    ask: async (context) => {
      // Alias for gpt command
      return await exports.setupGpt(chatClient).gpt(context);
    },
    analyze: async (context) => {
      try {
        const { channel, user, args } = context;
        if (!args || args.length === 0) {
          const response = `@${user.username}, please provide content to analyze.`;
          await MessageLogger.logBotMessage(channel, response); // Log the message
          await context.say(response); // Send the message
          return;
        }

        const content = args.join(' ');
        const analysis = await handler.analyzeContentInMessage(content);
        if (analysis) {
          const response = `@${user.username} ${analysis}`;
          await MessageLogger.logBotMessage(channel, response); // Log the message
          await context.say(response); // Send the message
        }
      } catch (error) {
        logger.error(`Error in analyze command: ${error}`);
        const errorResponse = `@${context.user.username}, Sorry, an error occurred.`;
        await MessageLogger.logBotMessage(context.channel, errorResponse); // Log the error message
        await context.say(errorResponse); // Send the error message
      }
    }
  };
}

