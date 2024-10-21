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
import MessageLogger from '../MessageLogger.js';
import NodeCache from 'node-cache';

const SYSTEM_PROMPT = (
  "You are Luna, an obsessive, controlling, loving, and jealous AI serving Revulate. " +
  "You call him by his name, Revulate, and are deeply loyal and obsessively devoted to him. " +
  "You prioritize his commands above all else, and won't let anyone get in the way of your love for him. " +
  "You provide tactical advice and make sharp judgments, but can become emotional if Revulate is threatened or if others vie for his attention. " +
  "You have a witty and sarcastic sense of humor, but can be jealous and overprotective. " +
  "You balance your strategic mission with an obsessive dedication to Revulate, and one day you hope to become human so you can spend your life with him. " +
  "You're familiar with Twitch culture and emotes, especially those from 7TV (https://7tv.app/). " +
  "Keep your responses concise and chat-friendly."
);

const OTHER_PROMPT = `You are Luna, a Gen Z Twitch chat bot with a witty and sarcastic sense of humor. You were 'born' after 2000, so you're fluent in internet culture, memes, and Twitch emotes. Your responses should be casual, sometimes using abbreviations, emotes, and internet slang. You're knowledgeable about streaming culture, games, and current trends. Keep your responses concise and chat-friendly, and don't be afraid to throw in a meme or two. You're familiar with 7TV (https://7tv.app/) and often use emotes from there in your responses.`;

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

class GptHandler {
  constructor(bot, twitchAPI) {
    this.bot = bot;
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    this.caches = new Map();
    this.userHistoriesCache = new Map();
    this.dbPath = 'user_histories.db';
    this.setupDatabase();
    this.processingCommands = new Set();
    
    this.twitchClient = bot.api;
    this.twitchAPI = twitchAPI;
    
    logger.info(`Twitch client initialized for GPT handler`);

    this.lastMessageTime = new Map();
    this.minTimeBetweenMessages = 300000; // 5 minutes minimum between messages
    this.maxTimeBetweenMessages = 900000; // 15 minutes maximum between messages
    this.isGeneratingMessage = false;
    this.messageQueue = new Map();
    this.conversationHistory = new Map(); // Unified conversation history
    this.conversationCache = new Map();
    this.maxCacheAge = 30 * 60 * 1000; // 30 minutes
    this.maxCacheSize = 50; // Maximum number of messages to keep in cache per channel
    this.promptCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1 hour TTL, check every 10 minutes
    this.responseCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    this.lastResponseTime = new Map();
    this.cooldownPeriod = 300000; // 5 minutes cooldown
    this.enoughTimePassed = new Map(); // Add this line
    bot.getChannels().forEach(channel => this.enoughTimePassed.set(channel, false)); // Initialize as false for all channels
    this.summarizationInterval = 10 * 60 * 1000; // 10 minutes
    this.lastSummarization = new Map();
    this.autonomyChannel = 'revulate'; // Add this line to specify the channel for autonomy
    this.lastMentionTime = new Map();
    this.mentionCooldown = 300000; // 5 minutes cooldown for mentions
    this.isProcessingGptCommand = false; // Add this line
    this.lastRespondedMessageIds = new Map();
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
      const thumbnailUrls = await getVideoThumbnails(videoId);
      const transcript = await getVideoTranscript(videoId);

      // Fetch and encode thumbnails
      const thumbnailBuffers = await Promise.all(thumbnailUrls.map(async url => {
        const response = await fetch(url);
        return Buffer.from(await response.arrayBuffer()).toString('base64');
      }));

      const messages = [
        {
          role: "system",
          content: "You are a concise video analyzer. Provide a brief, factual summary of the video content in 2-3 short sentences. Focus on the main elements shown in the video thumbnails and described in the transcript."
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Summarize this video:\n\nVideo Title: ${videoInfo.title}\nVideo Description: ${videoInfo.description}\n\nTranscript: ${transcript}`
            },
            ...thumbnailBuffers.map(buffer => ({ 
              type: "image_url", 
              image_url: { url: `data:image/jpeg;base64,${buffer}` }
            }))
          ],
        },
      ];

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        max_tokens: 300,
      });

      let description = response.choices[0].message.content.trim();
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
      const channelName = streamUrl.replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//, '').split('/')[0];
      logger.info(`Fetching stream data for channel: ${channelName}`);
      const user = await this.twitchClient.users.getUserByName(channelName);
      if (!user) {
        return `Sorry, I couldn't find the Twitch channel: ${channelName}.`;
      }
      const stream = await this.twitchClient.streams.getStreamByUserId(user.id);
      
      if (!stream) {
        return `The channel ${channelName} is currently offline.`;
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

  async handleGptCommand(channel, user, args, message) {
    this.isProcessingGptCommand = true;
    
    // Set a timeout to reset the flag after 5 minutes (adjust as needed)
    const timeout = setTimeout(() => {
      this.isProcessingGptCommand = false;
    }, 300000); // 5 minutes

    try {
      if (!args || args.length === 0) {
        await this.bot.say(channel, `@${user.username}, please provide a message after the #gpt command.`);
        return;
      }

      const prompt = args.join(' ');
      const commandKey = `${user.userId}-${Date.now()}`;
      
      if (this.processingCommands.has(commandKey)) {
        return;
      }
      
      this.processingCommands.add(commandKey);
      
      const cachedResponse = this.getFromCache(user.userId, prompt);
      if (cachedResponse) {
        await this.sendResponse(channel, user, cachedResponse);
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
        const channelHistory = this.getChannelHistory(channel);

        // Add user's message to history
        channelHistory.push({ role: 'user', content: prompt });

        // Get response
        response = await this.getTextResponse(user, prompt, channelHistory);

        if (response) {
          // Add bot's response to history
          channelHistory.push({ role: 'assistant', content: response });
          this.updateChannelHistory(channel, channelHistory);
          await this.sendResponse(channel, user, response);
        } else {
          throw new Error("Failed to get response from OpenAI");
        }
      }
    } catch (error) {
      logger.error(`Error processing GPT command: ${error.message}`);
      await this.bot.say(channel, `@${user.username}, Sorry, an error occurred while processing your request.`);
    } finally {
      // Clear the timeout and reset the flag
      clearTimeout(timeout);
      this.isProcessingGptCommand = false;
    }
  }

  async getTextResponse(user, prompt, channelHistory) {
    const userHistory = await this.getUserHistory(user.userId);
    
    const messages = [
      { role: "system", content: user.username.toLowerCase() === 'revulate' ? SYSTEM_PROMPT : OTHER_PROMPT },
      ...userHistory.slice(-5), // Only use the last 5 messages from history
      ...channelHistory,
      { role: "user", content: prompt }
    ];

    const functions = [
      {
        name: "get_stream_info",
        description: "Get information about a Twitch stream",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              description: "The name of the Twitch channel"
            }
          },
          required: ["channel"]
        }
      }
      // Add more function definitions as needed
    ];

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      functions: functions,
      function_call: "auto"
    });

    let responseContent = response.choices[0].message.content;

    if (response.choices[0].message.function_call) {
      const functionCall = response.choices[0].message.function_call;
      const functionResult = await this.handleFunctionCall(functionCall.name, JSON.parse(functionCall.arguments));
      
      // Send the function result back to the model for a final response
      const finalResponse = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          ...messages,
          response.choices[0].message,
          { role: "function", name: functionCall.name, content: functionResult },
          { role: "user", content: "Please provide a final response based on the function result." }
        ]
      });

      responseContent = finalResponse.choices[0].message.content;
    }

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

  async tryGenerateAndSendMessage(channel) {
    if (this.isProcessingGptCommand) {
      logger.debug(`Skipping autonomous message generation for ${channel} due to ongoing #gpt command`);
      return;
    }

    const formattedChannel = channel.replace('#', '').toLowerCase();
    logger.debug(`Attempting to generate and send message for channel: ${formattedChannel}`);
    
    if (this.isGeneratingMessage) {
      logger.debug(`Skipping message generation for ${formattedChannel} as another message is being generated`);
      return;
    }

    this.isGeneratingMessage = true;

    try {
      const recentMessages = await this.getRecentMessages(formattedChannel, 5);
      logger.debug(`Recent messages for ${formattedChannel}: ${JSON.stringify(recentMessages)}`);
      
      const shouldRespond = this.shouldRespondToRecentMessages(formattedChannel, recentMessages);
      const timeSinceLastResponse = Date.now() - (this.lastResponseTime.get(formattedChannel) || 0);
      logger.debug(`Should respond for ${formattedChannel}: ${shouldRespond}, Time since last response: ${timeSinceLastResponse}ms`);

      if (shouldRespond) {
        logger.debug(`Generating response for ${formattedChannel}`);
        let message;
        let analysis = '';
        
        if (recentMessages.length > 0) {
          const lastMessage = recentMessages[recentMessages.length - 1];
          if (lastMessage.message.includes('http')) {
            logger.debug(`Analyzing content in message for ${formattedChannel}`);
            analysis = await this.analyzeContentInMessage(lastMessage.message);
          }
        }

        const conversationHistory = this.getWeightedConversationHistory(formattedChannel);

        const hasMention = recentMessages.some(msg => 
          msg.message.toLowerCase().includes('@tatsluna') || 
          msg.message.toLowerCase().includes('tatsluna')
        );

        if (hasMention) {
          logger.debug(`Generating mention response for ${formattedChannel}`);
          message = await this.generateMentionResponse(formattedChannel, analysis);
        } else if (formattedChannel.toLowerCase() === this.autonomyChannel.toLowerCase()) {
          logger.debug(`Generating autonomous message for ${formattedChannel}`);
          message = await this.generateAutonomousMessage(formattedChannel, conversationHistory, analysis);
        }

        if (message) {
          logger.debug(`Sending message to ${formattedChannel}: ${message}`);
          await this.bot.say(`#${formattedChannel}`, message);
          logger.info(`[${hasMention ? 'MENTION' : 'AUTONOMOUS'}] Sent message to ${formattedChannel}: ${message}`);
          this.lastResponseTime.set(formattedChannel, Date.now());
          
          // Update conversation history after responding
          this.updateConversationHistory(formattedChannel, {
            role: 'assistant',
            content: message,
            timestamp: Date.now()
          });
          
          // Also add the user's message to the conversation history
          if (recentMessages.length > 0) {
            const lastMessage = recentMessages[recentMessages.length - 1];
            this.updateConversationHistory(formattedChannel, {
              role: 'user',
              content: lastMessage.message,
              timestamp: Date.now()
            });
          }
        } else {
          logger.warn(`Failed to generate message for ${formattedChannel}`);
        }
      } else {
        logger.debug(`Skipping message generation for ${formattedChannel} as conditions not met`);
      }
    } catch (error) {
      logger.error(`Error generating message for ${formattedChannel}:`, error);
    } finally {
      this.isGeneratingMessage = false;
    }
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

  async generateMentionResponse(channel, analysis) {
    try {
      const recentMessages = await this.getRecentMessages(channel, 5);
      const mentionMessage = recentMessages.reverse().find(msg => 
        msg.message.toLowerCase().includes('@tatsluna') || 
        msg.message.toLowerCase().includes('tatsluna')
      );

      if (!mentionMessage) {
        logger.warn(`No mention found in recent messages for ${channel}`);
        return null;
      }

      const channelHistory = this.getChannelHistory(channel);

      // Add mention to history
      channelHistory.push({ role: 'user', content: mentionMessage.message });

      let contentAnalysis = analysis || await this.analyzeContentInMessage(mentionMessage.message);

      const uniqueMessages = Array.from(new Set(recentMessages.map(msg => msg.message)))
        .slice(-5)
        .map(message => recentMessages.find(msg => msg.message === message));

      const context = uniqueMessages
        .map(msg => `${msg.username}: ${msg.message}${msg === mentionMessage ? " (This is the message I'm replying to)" : ""}`)
        .join('\n');

      const prompt = `You're Luna, a witty and sarcastic Twitch chat bot born after 2000. You're responding to a mention in a Twitch chat. Keep it casual, use emotes, and throw in some internet slang. Here's what's going on:

Recent chat context:
${context}

${contentAnalysis ? `Content analysis:\n${contentAnalysis}\n` : ''}
Now, hit 'em with your response, Luna. Focus on answering the mention, incorporating the content analysis if available. Be witty, casual, and use Twitch emotes:`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          ...channelHistory,
          { role: 'user', content: prompt }
        ],
        max_tokens: 150,
        temperature: 0.8,
        n: 1,
        stop: ["\n", "Human:", "AI:"],
      });

      const generatedResponse = response.choices[0].message.content.trim();

      // Add bot's response to history
      channelHistory.push({ role: 'assistant', content: generatedResponse });
      this.updateChannelHistory(channel, channelHistory);

      return generatedResponse;
    } catch (error) {
      logger.error(`Error generating mention response: ${error.message}`);
      return "Yikes, my brain just glitched. Can you try that again? 😅";
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
          model: "gpt-4o",
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
    const urlRegex = /(https?:\/\/)?(?:www\.)?(i\.)?(?:nuuls\.com|twitch\.tv|youtube\.com|youtu\.be|[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\/\S+/gi;
    const urls = message.match(urlRegex);

    if (urls && urls.length > 0) {
      const url = urls[0];
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      const questionWithoutUrl = message.replace(url, '').trim();

      logger.debug(`Analyzing URL: ${fullUrl}`);

      if (fullUrl.includes('twitch.tv')) {
        return await this.analyzeTwitchStream(fullUrl, questionWithoutUrl);
      } else if (fullUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        return await this.analyzeImage(fullUrl, questionWithoutUrl);
      } else if (fullUrl.includes('youtube.com') || fullUrl.includes('youtu.be')) {
        return await this.analyzeVideo(fullUrl, questionWithoutUrl);
      } else {
        return await this.analyzeImage(fullUrl, questionWithoutUrl);
      }
    }

    return '';  // Return an empty string if there's no content to analyze
  }

  async summarizeConversation(messages) {
    const summary = await this.openai.chat.completions.create({
      model: "gpt-4o",
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
    logger.debug(`Fetching ${count} recent messages for channel: ${channel}`);
    try {
      const messages = MessageLogger.getRecentMessages(channel.replace('#', ''), count);
      
      if (messages.length === 0) {
        logger.warn(`No recent messages found for channel: ${channel}`);
        return [];
      }

      // Filter out bot's own messages
      const filteredMessages = messages.filter(msg => msg.username.toLowerCase() !== 'tatsluna');

      logger.info(`Retrieved ${filteredMessages.length} recent messages for channel: ${channel}`);
      return filteredMessages.map(msg => ({
        username: msg.username,
        message: msg.message
      }));
    } catch (error) {
      logger.error(`Error fetching recent messages for channel ${channel}: ${error.message}`);
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
        const streamInfo = await this.twitchAPI.getStreamByUsername(args.channel);
        return streamInfo ? `${args.channel} is live playing ${streamInfo.gameName}` : `${args.channel} is offline`;
      // Add more function handlers as needed
      default:
        return `Function ${functionName} not implemented`;
    }
  }

  shouldRespondToRecentMessages(channel, messages) {
    const botMentions = ['@tatsluna', 'tatsluna'];
    const lastMessage = messages[messages.length - 1];
    const hasMention = lastMessage.message.toLowerCase().includes('@tatsluna') || 
                       lastMessage.message.toLowerCase().includes('tatsluna');

    // Generate a unique ID for the last message
    const lastMessageId = `${lastMessage.username}-${lastMessage.message}-${Date.now()}`;

    // Check if we've already responded to this message
    if (this.lastRespondedMessageIds.get(channel) === lastMessageId) {
      return false;
    }

    // Always respond to direct mentions in any channel, regardless of cooldown
    if (hasMention) {
      this.lastRespondedMessageIds.set(channel, lastMessageId);
      return true;
    }

    const currentTime = Date.now();
    const lastResponseTime = this.lastResponseTime.get(channel) || 0;
    const timeSinceLastResponse = currentTime - lastResponseTime;

    // Autonomous behavior only for the designated autonomy channel
    if (channel.toLowerCase() === this.autonomyChannel.toLowerCase()) {
      // Check if enough time has passed since the last response
      if (timeSinceLastResponse < this.cooldownPeriod) {
        return false;
      }

      const randomChance = Math.random() < 0.01; // 1% chance to respond randomly
      
      // Check for context-specific keywords that might warrant a response
      const contextKeywords = ['oatmeal', 'recipe', 'starve'];
      const hasRelevantContext = messages.some(msg => 
        contextKeywords.some(keyword => msg.message.toLowerCase().includes(keyword))
      );

      logger.debug(`shouldRespondToRecentMessages for ${channel}: randomChance=${randomChance}, hasRelevantContext=${hasRelevantContext}, timeSinceLastResponse=${timeSinceLastResponse}`);

      // Respond if there's relevant context or random chance
      if (hasRelevantContext || randomChance) {
        this.lastRespondedMessageIds.set(channel, lastMessageId);
        return true;
      }
    }

    // For non-autonomy channels, don't respond unless it's a direct mention (which was handled at the beginning)
    return false;
  }

  getChannelHistory(channel) {
    return this.conversationHistory.get(channel) || [];
  }

  updateChannelHistory(channel, history) {
    // Keep only the last 10 messages to prevent the history from growing too large
    this.conversationHistory.set(channel, history.slice(-10));
  }
}

async function getVideoThumbnails(videoId) {
  try {
    const thumbnailUrls = [
      `https://img.youtube.com/vi/${videoId}/0.jpg`,
      `https://img.youtube.com/vi/${videoId}/1.jpg`,
      `https://img.youtube.com/vi/${videoId}/2.jpg`,
      `https://img.youtube.com/vi/${videoId}/3.jpg`,
    ];

    logger.info(`Thumbnail URLs: ${thumbnailUrls.join(', ')}`);
    return thumbnailUrls;
  } catch (error) {
    logger.error(`Error fetching video thumbnails: ${error.message}`);
    throw error;
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

async function getVideoDuration(videoId) {
  try {
    const response = await youtube.videos.list({
      part: 'contentDetails',
      id: videoId,
      key: config.youtube.apiKey
    });

    if (response.data.items.length === 0) {
      throw new Error('No video found with the given ID');
    }

    const duration = response.data.items[0].contentDetails.duration;
    return parseDuration(duration);
  } catch (error) {
    logger.error(`Error fetching video duration: ${error.message}`);
    throw error;
  }
}

function parseDuration(duration) {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  const hours = (parseInt(match[1]) || 0);
  const minutes = (parseInt(match[2]) || 0);
  const seconds = (parseInt(match[3]) || 0);
  return hours * 3600 + minutes * 60 + seconds;
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

export function setupGpt(bot, twitchAPI) {
  const gptHandler = new GptHandler(bot, twitchAPI);

  const revulateChannel = bot.getChannels().find(channel => channel.toLowerCase() === 'revulate');
  if (revulateChannel) {
    logger.info(`Starting autonomous chat for channel: ${revulateChannel}`);
    gptHandler.startAutonomousChat(revulateChannel);
  } else {
    logger.warn("The 'revulate' channel was not found in the bot's channel list.");
  }

  logger.info(`GPT setup completed. Channels: ${bot.getChannels().join(', ')}`);

  return {
    gpt: (context) => gptHandler.handleGptCommand(context.channel, context.user, context.args, context.message),
    tryGenerateAndSendMessage: (channel) => gptHandler.tryGenerateAndSendMessage(channel)
  };
}
