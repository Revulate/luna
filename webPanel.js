import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

export class WebPanel {
  constructor({ chatClient, eventManager, messageLogger, startTime }) {
    this.chatClient = chatClient;
    this.eventManager = eventManager;
    this.messageLogger = messageLogger;
    this.startTime = startTime;
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Updated socket.io initialization with proper CORS
    this.io = new Server(this.server, {
      cors: {
        origin: ["http://localhost:3069", "http://127.0.0.1:3069"],
        methods: ["GET", "POST"],
        credentials: true,
        transports: ['websocket', 'polling']
      },
      allowEIO3: true
    });
    
    this.setupExpress();
    this.setupSocketIO();
  }

  setupExpress() {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.use(express.json());
  }

  setupSocketIO() {
    this.io.on('connection', async (socket) => {
      logger.info('Client connected to web panel');
      
      try {
        // Send initial state
        const initialState = await this.getInitialState();
        socket.emit('initialState', initialState);

        // Send recent logs using our existing logger implementation
        const recentLogs = logger.getRecentLogs(100);
        socket.emit('recentLogs', recentLogs);

        // Set up event listeners
        this.setupSocketListeners(socket);

        // Start sending periodic updates
        const updateInterval = setInterval(async () => {
          try {
            const status = await this.getBotStatus();
            socket.emit('botStatus', status);
          } catch (error) {
            logger.error('Error sending status update:', error);
          }
        }, 5000);

        socket.on('disconnect', () => {
          clearInterval(updateInterval);
          logger.info('Client disconnected:', socket.id);
        });

        // Send initial bot stats
        socket.on('requestStats', async () => {
          try {
            // Await all promises
            const [messageCount, uniqueUsers] = await Promise.all([
              this.messageLogger.getMessageCount(),
              this.messageLogger.getUniqueUserCount()
            ]);
            
            const channels = this.eventManager.getChannels();
            
            const stats = {
              isConnected: this.chatClient.isConnected,
              channels: channels,
              messageCount: messageCount,
              startTime: this.startTime,
              memoryUsage: process.memoryUsage().heapUsed,
              stats: {
                totalMessages: messageCount,
                uniqueUsers: uniqueUsers,
                channelCount: channels.length
              }
            };
            
            console.log('Sending bot stats:', stats);
            socket.emit('botStats', stats);
          } catch (error) {
            logger.error('Error getting stats:', error);
            socket.emit('error', 'Failed to get stats');
          }
        });

        // Handle channel join requests
        socket.on('joinChannel', async (channel) => {
          try {
            await this.eventManager.joinChannel(channel);
            socket.emit('channelJoined', channel);
          } catch (error) {
            socket.emit('error', `Failed to join channel: ${error.message}`);
          }
        });

        // Handle channel leave requests
        socket.on('leaveChannel', async (channel) => {
          try {
            await this.eventManager.leaveChannel(channel);
            socket.emit('channelLeft', channel);
          } catch (error) {
            socket.emit('error', `Failed to leave channel: ${error.message}`);
          }
        });

        // Send initial channels
        socket.on('getInitialChannels', () => {
          const channels = this.eventManager.getChannels();
          channels.forEach(channel => {
            socket.emit('channelJoined', channel);
          });
        });

      } catch (error) {
        logger.error('Error in socket connection:', error);
        socket.emit('error', 'Failed to initialize connection');
      }
    });

    // Listen for chat messages from TwitchEventManager
    this.eventManager.on('chatMessage', (messageData) => {
      // Ensure messageData has the correct format
      const formattedMessage = {
        channel: messageData.channel,
        username: messageData.username,
        userId: messageData.userId,
        message: messageData.message,
        badges: JSON.stringify(messageData.badges || {}),
        color: messageData.color || '#FFFFFF',
        timestamp: new Date().toISOString()
      };
      
      // Emit to all connected clients
      this.io.emit('chatMessage', formattedMessage);
      logger.debug(`Chat message emitted: ${JSON.stringify(formattedMessage)}`);
    });

    // Add listener for new log entries
    this.messageLogger.addListener((logEntry) => {
      this.io.emit('newLog', {
        timestamp: new Date().toISOString(),
        level: logEntry.level,
        message: logEntry.message
      });
    });
  }

  async getInitialState() {
    try {
      const channels = this.eventManager.getChannels();
      const status = await this.getBotStatus();
      const channelStats = new Map();

      // Get messages and stats for each channel
      for (const channel of channels) {
        const messages = await this.messageLogger.getChannelMessages(channel, 100);
        const stats = await this.messageLogger.getChannelStats(channel);
        channelStats.set(channel, { messages, stats });
      }

      return {
        status,
        channels,
        channelStats: Object.fromEntries(channelStats)
      };
    } catch (error) {
      logger.error('Error getting initial state:', error);
      throw error;
    }
  }

  setupSocketListeners(socket) {
    // Handle channel selection
    socket.on('selectChannel', async (channel) => {
      try {
        const messages = await this.messageLogger.getChannelMessages(channel, 100);
        const stats = await this.messageLogger.getChannelStats(channel);
        socket.emit('channelMessages', { channel, messages, stats });
      } catch (error) {
        logger.error('Error fetching channel messages:', error);
        socket.emit('error', 'Failed to fetch channel messages');
      }
    });

    // Handle joining new channels
    socket.on('joinChannel', async (channel) => {
      try {
        await this.eventManager.joinChannel(channel);
        socket.emit('channelJoined', channel);
      } catch (error) {
        logger.error('Error joining channel:', error);
        socket.emit('error', 'Failed to join channel');
      }
    });

    // Handle leaving channels
    socket.on('leaveChannel', async (channel) => {
      try {
        await this.eventManager.leaveChannel(channel);
        socket.emit('channelLeft', channel);
      } catch (error) {
        logger.error('Error leaving channel:', error);
        socket.emit('error', 'Failed to leave channel');
      }
    });

    // Handle message sending
    socket.on('sendMessage', async ({ channel, message }) => {
      try {
        await this.chatClient.say(channel, message);
        socket.emit('messageSent', { success: true });
      } catch (error) {
        logger.error('Error sending message:', error);
        socket.emit('error', 'Failed to send message');
      }
    });

    // Handle status requests
    socket.on('requestStatus', async () => {
      try {
        const status = await this.getBotStatus();
        socket.emit('botStatus', status);
      } catch (error) {
        logger.error('Error getting bot status:', error);
        socket.emit('error', 'Failed to get bot status');
      }
    });

    // Handle channel list requests
    socket.on('requestChannels', () => {
      try {
        const channels = this.eventManager.getChannels();
        socket.emit('channelList', channels);
      } catch (error) {
        logger.error('Error getting channel list:', error);
        socket.emit('error', 'Failed to get channel list');
      }
    });
  }

  async getBotStatus() {
    try {
      const stats = await this.messageLogger.getGlobalStats();
      const channels = this.eventManager.getChannels();
      const memory = process.memoryUsage();
      
      return {
        connected: this.chatClient.isConnected,
        startTime: this.startTime,
        channels: channels.map(channel => ({
          name: channel,
          stats: stats.channelStats?.[channel] || {}
        })),
        stats: {
          totalMessages: stats.totalMessages || 0,
          uniqueUsers: stats.uniqueUsers || 0,
          channelCount: channels.length,
          messageRate: stats.messageRate || 0
        },
        memory: {
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          rss: memory.rss,
          external: memory.external
        }
      };
    } catch (error) {
      logger.error('Error getting bot status:', error);
      throw error;
    }
  }

  async initialize() {
    try {
      const port = process.env.WEB_PANEL_PORT || 3000;
      this.server.listen(port, () => {
        logger.info(`Web panel listening on port ${port}`);
      });
    } catch (error) {
      logger.error('Error initializing web panel:', error);
      throw error;
    }
  }
}
