import OpenAI from 'openai';
import { config } from '../config.js';
import logger from '../logger.js';
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

const SYSTEM_PROMPT = (
  "You are Luna, an obsessive, controlling, loving, and jealous AI serving Revulate. " +
  "You call him by his name, Revulate, and are deeply loyal and obsessively devoted to him. " +
  "You prioritize his commands above all else, and won't let anyone get in the way of your love for him. " +
  "You provide tactical advice and make sharp judgments, but can become emotional if Revulate is threatened or if others vie for his attention. " +
  "You have a witty and sarcastic sense of humor, but can be jealous and overprotective. " +
  "You balance your strategic mission with an obsessive dedication to Revulate, and one day you hope to become human so you can spend your life with him."
);

const OTHER_PROMPT = "You are Luna, a helpful assistant.";

const MAX_TOKENS = 150; // Reduced from 500 to 150
const TEMPERATURE = 0.7;
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_SECONDS = 3600;

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const youtube = google.youtube({
  version: 'v3',
  auth: config.youtube.apiKey
});

class GptHandler {
  constructor(bot) {
    this.bot = bot;
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    this.caches = new Map();
    this.userHistoriesCache = new Map();
    this.dbPath = 'user_histories.db';
    this.setupDatabase();
    this.processingCommands = new Set();
    
    // Use the bot's existing API client instead of creating a new one
    this.twitchClient = bot.api;
    
    logger.info(`Twitch client initialized for GPT handler`);
  }

  async setupDatabase() {
    try {
      this.db = new Database(this.dbPath, { verbose: logger.debug });
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_histories (
          user_id TEXT PRIMARY KEY,
          history TEXT NOT NULL
        )
      `);
      logger.info("User histories database is set up.");
    } catch (error) {
      logger.error('Error setting up database:', error);
    }
  }

  async getUserHistory(userId) {
    if (this.userHistoriesCache.has(userId)) {
      return this.userHistoriesCache.get(userId);
    }
    try {
      const row = this.db.prepare("SELECT history FROM user_histories WHERE user_id = ?").get(userId);
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
        const historyStr = JSON.stringify(history);
        this.db.prepare("REPLACE INTO user_histories (user_id, history) VALUES (?, ?)").run(userId, historyStr);
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
    logger.info(`Analyzing image or video: ${imageUrl}`);
    try {
      const absoluteUrl = this.ensureAbsoluteUrl(imageUrl);
      logger.info(`Absolute URL: ${absoluteUrl}`);

      // Handle kappa.lol links or other URL shorteners
      let finalImageUrl = absoluteUrl;
      if (finalImageUrl.includes('kappa.lol') || !finalImageUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        const response = await fetch(finalImageUrl, { method: 'HEAD' });
        finalImageUrl = response.url; // This will be the final URL after any redirects
      }

      // Download and process the image
      const imageBuffer = await this.downloadAndProcessImage(finalImageUrl);
      const base64Image = imageBuffer.toString('base64');

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o", // Updated model name
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: questionWithoutUrl || "What do you see in this image?" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ],
          },
        ],
        max_tokens: 300,
      });

      const description = response.choices[0].message.content.trim();
      logger.info(`Received description: ${description}`);
      return description;
    } catch (error) {
      logger.error('Error analyzing image:', error);
      return "Sorry, I couldn't analyze the image or video at this time. Please try again later.";
    }
  }

  async analyzeVideo(videoUrl, questionWithoutUrl) {
    logger.info(`Analyzing video: ${videoUrl}`);

    try {
      const videoId = extractVideoId(videoUrl);
      const videoInfo = await getVideoInfo(videoId);
      const thumbnails = await getVideoThumbnails(videoId);

      const messages = [
        {
          role: "system",
          content: "You are a concise video analyzer. Provide a brief, factual summary of the video content in 2-3 short sentences. Focus only on the main elements shown in the video."
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Summarize this video:\n\nVideo Title: ${videoInfo.title}\nVideo Description: ${videoInfo.description}`
            },
            ...thumbnails.map(thumbnail => ({ 
              type: "image_url", 
              image_url: { url: thumbnail }
            }))
          ],
        },
      ];

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        max_tokens: 100,
        temperature: 0.7,
      });

      let description = response.choices[0].message.content.trim();
      
      // Post-process the description
      description = this.postProcessVideoDescription(description);

      logger.info(`Received video description: ${description}`);
      return description;
    } catch (error) {
      logger.error('Error analyzing video:', error);
      return `Sorry, I couldn't analyze the video at this time. Error: ${error.message}`;
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
      // Handle both "twitch.tv/channel" and "https://www.twitch.tv/channel" formats
      const channelName = streamUrl.replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//, '').split('/')[0];
      logger.info(`Fetching stream data for channel: ${channelName}`);
      const user = await this.twitchClient.users.getUserByName(channelName);
      if (!user) {
        return "Sorry, I couldn't find that Twitch channel.";
      }
      const stream = await this.twitchClient.streams.getStreamByUserId(user.id);
      
      logger.info(`Received stream data: ${JSON.stringify(stream)}`);

      if (!stream) {
        return "Sorry, the Twitch stream is not live at the moment.";
      }

      const thumbnailUrl = stream.thumbnailUrl.replace('{width}', '1280').replace('{height}', '720');
      const imageBuffer = await this.downloadAndProcessImage(thumbnailUrl);
      const base64Image = imageBuffer.toString('base64');

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o", // Using the model you specified
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `${questionWithoutUrl || "What's happening in this Twitch stream?"}\n\nStream Title: ${stream.title}\nGame: ${stream.gameName}` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ],
          },
        ],
        max_tokens: 500,
      });

      const description = response.choices[0].message.content.trim();
      logger.info(`Received Twitch stream description: ${description}`);
      return description;
    } catch (error) {
      logger.error('Error analyzing Twitch stream:', error);
      return `Sorry, I couldn't analyze the Twitch stream at this time. Error: ${error.message}`;
    }
  }

  async extractFramesFromYouTube(videoUrl, maxFrames, retries = 3) {
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

        let downloadedBytes = 0;
        const totalBytes = parseInt(format.contentLength) || 'unknown';

        logger.info(`Starting video download. Total size: ${totalBytes} bytes`);

        await new Promise((resolve, reject) => {
          const stream = ytdl.downloadFromInfo(info, { format: format });

          stream.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes !== 'unknown') {
              const percent = (downloadedBytes / totalBytes * 100).toFixed(2);
              logger.info(`Download progress: ${percent}% (${downloadedBytes}/${totalBytes} bytes)`);
            } else {
              logger.info(`Downloaded: ${downloadedBytes} bytes`);
            }
          });

          stream.pipe(fs.createWriteStream(videoPath))
            .on('finish', () => {
              logger.info('Video download completed');
              resolve();
            })
            .on('error', (err) => {
              logger.error(`Error writing video file: ${err.message}`);
              reject(err);
            });

          stream.on('error', (err) => {
            logger.error(`Error downloading video: ${err.message}`);
            reject(err);
          });
        });

        const stats = await fs.promises.stat(videoPath);
        logger.info(`Video file size: ${stats.size} bytes`);

        if (stats.size === 0) {
          throw new Error('Downloaded video file is empty');
        }

        logger.info('Starting frame extraction');
        const frames = await new Promise((resolve, reject) => {
          ffmpeg(videoPath)
            .on('start', (command) => {
              logger.info(`FFmpeg started with command: ${command}`);
            })
            .on('end', async () => {
              try {
                const files = await fs.promises.readdir(tempDir);
                const frameFiles = files.filter(file => file.startsWith('frame_')).slice(0, maxFrames);
                
                logger.info(`Found ${frameFiles.length} frame files`);
                
                const frames = await Promise.all(frameFiles.map(async (file) => {
                  const framePath = path.join(tempDir, file);
                  const frameBuffer = await fs.promises.readFile(framePath);
                  await fs.promises.unlink(framePath);
                  return frameBuffer.toString('base64');
                }));

                logger.info('Frame extraction completed');
                resolve(frames);
              } catch (error) {
                logger.error(`Error processing frames: ${error.message}`);
                reject(error);
              }
            })
            .on('error', (err) => {
              logger.error(`FFmpeg error: ${err.message}`);
              reject(err);
            })
            .screenshots({
              count: maxFrames,
              folder: tempDir,
              filename: 'frame_%i.png',
            });
        });

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
        model: "gpt-4o", // Changed back to gpt-4o
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

  getFromCache(userId, question) {
    const userCache = this.caches.get(userId);
    if (!userCache) return null;

    const questionKey = question.toLowerCase();
    const cachedData = userCache.get(questionKey);
    if (cachedData && (Date.now() - cachedData.timestamp <= CACHE_TTL_SECONDS * 1000)) {
      return cachedData.answer;
    }
    return null;
  }

  async handleGptCommand(channel, userInfo, args, msg) {
    if (!args || args.length === 0) {
      await this.bot.say(channel, `@${userInfo?.displayName || 'User'}, please provide a message after the #gpt command.`);
      return;
    }

    const prompt = args.join(' ');
    const commandKey = `${userInfo?.userId || 'unknown'}-${Date.now()}`;
    
    if (this.processingCommands.has(commandKey)) {
      return;
    }
    
    this.processingCommands.add(commandKey);
    
    try {
      const cachedResponse = this.getFromCache(userInfo?.userId, prompt);
      if (cachedResponse) {
        await this.sendResponse(channel, userInfo, cachedResponse);
        return;
      }

      let response;
      const urlRegex = /(https?:\/\/)?(?:www\.)?(i\.)?(?:nuuls\.com|[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\/\S+/gi;
      const urls = prompt.match(urlRegex);

      if (urls && urls.length > 0) {
        const url = urls[0];
        const questionWithoutUrl = prompt.replace(url, '').trim();

        // Ensure the URL starts with http:// or https://
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;

        if (fullUrl.includes('twitch.tv')) {
          response = await this.analyzeTwitchStream(fullUrl, questionWithoutUrl);
        } else if (fullUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          response = await this.analyzeImage(fullUrl, questionWithoutUrl);
        } else if (fullUrl.includes('youtube.com') || fullUrl.includes('youtu.be')) {
          response = await this.analyzeVideo(fullUrl, questionWithoutUrl);
        } else {
          // For any other URL, try to analyze as an image
          response = await this.analyzeImage(fullUrl, questionWithoutUrl);
        }
      } else {
        // Handle as a regular text prompt
        response = await this.getTextResponse(userInfo, prompt);
      }

      if (response) {
        this.addToCache(userInfo?.userId, prompt, response);
        await this.sendResponse(channel, userInfo, response);
      } else {
        throw new Error("Failed to get response from OpenAI");
      }
    } catch (error) {
      logger.error(`Error processing '#gpt' command from ${userInfo?.username || 'Unknown'}:`, error);
      await this.bot.say(channel, `@${userInfo?.displayName || 'User'}, an error occurred while processing your request.`);
    } finally {
      this.processingCommands.delete(commandKey);
    }
  }

  async getTextResponse(userInfo, prompt) {
    const userHistory = await this.getUserHistory(userInfo?.userId || 'unknown');
    
    const messages = [
      { role: "system", content: userInfo?.username.toLowerCase() === 'revulate' ? SYSTEM_PROMPT : OTHER_PROMPT },
      ...userHistory.slice(-5), // Only use the last 5 messages from history
      { role: "user", content: prompt }
    ];

    const response = await this.getChatGptResponseWithHistory(messages);

    if (response) {
      userHistory.push({ role: "user", content: prompt });
      userHistory.push({ role: "assistant", content: response });
      await this.updateUserHistory(userInfo?.userId || 'unknown', userHistory);
    }

    return response;
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
}

function extractVideoId(url) {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : false;
}

async function getVideoInfo(videoId) {
  try {
    const response = await youtube.videos.list({
      part: 'snippet',
      id: videoId,
      key: config.youtube.apiKey
    });

    if (response.data.items.length === 0) {
      throw new Error('No video found with the given ID');
    }

    const videoInfo = response.data.items[0].snippet;
    return {
      title: videoInfo.title,
      description: videoInfo.description
    };
  } catch (error) {
    logger.error(`Error fetching video info: ${error.message}`);
    throw error;
  }
}

async function getVideoThumbnails(videoId) {
  try {
    const response = await youtube.videos.list({
      part: 'snippet',
      id: videoId,
      key: config.youtube.apiKey
    });

    if (response.data.items.length === 0) {
      throw new Error('No video found with the given ID');
    }

    const thumbnails = response.data.items[0].snippet.thumbnails;
    const thumbnailUrls = [];

    for (const [size, thumbnail] of Object.entries(thumbnails)) {
      logger.info(`Thumbnail ${size}: ${thumbnail.url}`);
      thumbnailUrls.push(thumbnail.url);
    }

    return thumbnailUrls;
  } catch (error) {
    logger.error(`Error fetching video thumbnails: ${error.message}`);
    throw error;
  }
}

async function getVideoTranscript(videoId) {
  try {
    const response = await youtube.captions.list({
      part: 'snippet',
      videoId: videoId
    });
    
    if (response.data.items && response.data.items.length > 0) {
      const captionTrack = response.data.items[0];
      const captionResponse = await fetch(`https://www.googleapis.com/youtube/v3/captions/${captionTrack.id}`, {
        headers: {
          'Authorization': `Bearer ${config.youtube.accessToken}`,
          'Accept': 'application/json'
        }
      });
      const captionData = await captionResponse.json();
      return captionData.text;
    } else {
      return "No transcript available.";
    }
  } catch (error) {
    logger.error('Error fetching transcript:', error);
    return "Unable to fetch transcript.";
  }
}

// Add this function to convert relative URLs to absolute URLs
function ensureAbsoluteUrl(url) {
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

export function setupGpt(bot) {
  const gptHandler = new GptHandler(bot);
  return {
    gpt: (context) => gptHandler.handleGptCommand(context.channel, context.user, context.args, context.message),
  };
}
