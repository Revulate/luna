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
        // Get initial channels and send them to the client
        const channels = this.eventManager.getChannels();
        logger.debug(`Initial channels on socket connection: ${channels}`);
        
        // Send initial channels to client
        channels.forEach(channel => {
          socket.emit('channelJoined', channel);
        });

        // Get initial state
        const status = await this.getBotStatus();
        socket.emit('botStats', status);

        // Set up periodic status updates
        const updateInterval = setInterval(async () => {
          try {
            const status = await this.getBotStatus();
            socket.emit('botStats', status);
          } catch (error) {
            logger.error('Error sending status update:', error);
          }
        }, 5000);

        // Handle channel join/leave requests
        socket.on('joinChannel', async (channel) => {
          try {
            await this.eventManager.joinChannel(channel);
            socket.emit('channelJoined', channel);
          } catch (error) {
            logger.error('Error joining channel:', error);
            socket.emit('error', 'Failed to join channel');
          }
        });

        socket.on('leaveChannel', async (channel) => {
          try {
            await this.eventManager.leaveChannel(channel);
            socket.emit('channelLeft', channel);
          } catch (error) {
            logger.error('Error leaving channel:', error);
            socket.emit('error', 'Failed to leave channel');
          }
        });

        // Update chat message event handler
        this.eventManager.on('chatMessage', (messageData) => {
          // Format timestamp in ISO format
          const formattedMessage = {
            ...messageData,
            timestamp: new Date(messageData.timestamp || Date.now()).toISOString()
          };
          
          // Emit chat message once
          this.io.emit('chatMessage', formattedMessage);
          
          // Log message once
          const logEntry = {
            timestamp: formattedMessage.timestamp,
            level: 'INFO',
            message: `${messageData.channel}: <${messageData.username}> ${messageData.message}`
          };
          this.io.emit('newLog', logEntry);
        });

        // Handle bot messages
        socket.on('sendMessage', async (data) => {
          try {
            const { channel, message } = data;
            logger.debug(`Attempting to send message to ${channel}: ${message}`);
            
            await this.chatClient.say(channel, message);
            
            const botMessageData = {
              channel: channel,
              userId: '0',
              username: 'TatsLuna',
              message: message,
              timestamp: new Date().toISOString(),
              badges: {},
              color: '#6441A5'
            };
            
            // Log to database and emit once
            await this.messageLogger.logMessage(channel, botMessageData);
            this.io.emit('chatMessage', botMessageData);
            
            logger.debug(`Message sent successfully to ${channel}`);
          } catch (error) {
            logger.error('Error sending message:', error);
            socket.emit('error', 'Failed to send message');
          }
        });

        socket.on('disconnect', () => {
          clearInterval(updateInterval);
          logger.info('Client disconnected');
        });

        // Add enhanced logging
        this.messageLogger.addListener((logEntry) => {
          const formattedLog = {
            timestamp: new Date().toISOString(),
            level: logEntry.level || 'INFO',
            message: typeof logEntry === 'string' ? logEntry : logEntry.message,
            metadata: logEntry.metadata || {}
          };

          socket.emit('newLog', formattedLog);
          logger.debug('Emitted log:', formattedLog);
        });

      } catch (error) {
        logger.error('Error in socket connection:', error);
        socket.emit('error', 'Failed to initialize connection');
      }
    });

    // Listen for TwitchEventManager channel events
    this.eventManager.on('channelJoined', (channel) => {
      logger.debug(`Broadcasting channelJoined event for: ${channel}`);
      this.io.emit('channelJoined', channel);
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

  async getBotStatus() {
    try {
      const globalStats = await this.messageLogger.getGlobalStats();
      const channels = this.eventManager.getChannels();
      const memory = process.memoryUsage();
      const dbSize = await this.messageLogger.getDatabaseSize();
      
      // Calculate message rate for last minute
      const minuteAgo = new Date(Date.now() - 60000);
      const recentMessages = await this.messageLogger.getMessageCount(minuteAgo.toISOString());
      const messageRate = Math.round((recentMessages || 0) / 60 * 100) / 100;

      const status = {
        isConnected: this.chatClient.isConnected, // Changed from 'connected' to 'isConnected'
        startTime: this.startTime,
        channels: channels,
        messageCount: globalStats.totalMessages,
        memoryUsage: memory.heapUsed,
        stats: {
          totalMessages: globalStats.totalMessages || 0,
          uniqueUsers: globalStats.uniqueUsers || 0,
          channelCount: channels.length,
          messageRate: messageRate * 60,
          dbSize: dbSize
        }
      };

      logger.debug('Status update:', {
        memory: {
          heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
          rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
        },
        dbSize: `${Math.round(dbSize / 1024 / 1024)}MB`,
        messageRate: `${messageRate * 60}/min`
      });

      return status;
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

  // Move formatBytes to be a class method
  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }
}
