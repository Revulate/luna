import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';
import { serviceRegistry } from './utils/serviceRegistry.js';
import { config } from './config.js';  // Add config import

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WebPanel {
  constructor() {
    logger.startOperation('Initializing WebPanel');
    this.initialized = false;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server);
    this.port = process.env.WEB_PORT || config.webPanel?.port || 3069; // Use config or fallback
    logger.debug('WebPanel constructor initialized');
  }

  async initialize() {
    if (this.initialized) {
      return this;
    }

    try {
      // Get required services
      this.messageLogger = serviceRegistry.getService('messageLogger');
      this.twitchEventManager = serviceRegistry.getService('twitchEventManager');
      this.database = serviceRegistry.getService('database');

      // Setup express middleware
      this.app.use(express.static(path.join(__dirname, 'public')));
      this.app.use(express.json());

      // Setup routes
      this.setupRoutes();

      // Setup Socket.IO events
      this.setupSocketEvents();

      // Start server with configured port
      await new Promise((resolve, reject) => {
        this.server.listen(this.port, () => {
          logger.info(`Web panel listening on port ${this.port}`);
          resolve();
        }).on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            logger.error(`Port ${this.port} is already in use. Please check if another instance is running.`);
          }
          reject(error);
        });
      });

      this.initialized = true;
      logger.info('WebPanel initialized successfully');
      return this;
    } catch (error) {
      logger.error('Error initializing WebPanel:', error);
      throw error;
    }
  }

  setupRoutes() {
    // Main dashboard route
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // API routes
    this.app.get('/api/channels', async (req, res) => {
      try {
        const channels = this.twitchEventManager.getChannels();
        res.json({ channels });
      } catch (error) {
        logger.error('Error fetching channels:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.get('/api/stats', async (req, res) => {
      try {
        const stats = await this.getSystemStats();
        res.json(stats);
      } catch (error) {
        logger.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  setupSocketEvents() {
    this.io.on('connection', (socket) => {
      logger.info('Client connected to web panel');

      socket.on('join_channel', async (channel) => {
        try {
          await this.twitchEventManager.joinChannel(channel);
          socket.emit('channel_joined', { channel, success: true });
        } catch (error) {
          logger.error('Error joining channel:', error);
          socket.emit('channel_joined', { channel, success: false, error: error.message });
        }
      });

      socket.on('leave_channel', async (channel) => {
        try {
          await this.twitchEventManager.leaveChannel(channel);
          socket.emit('channel_left', { channel, success: true });
        } catch (error) {
          logger.error('Error leaving channel:', error);
          socket.emit('channel_left', { channel, success: false, error: error.message });
        }
      });

      socket.on('disconnect', () => {
        logger.info('Client disconnected from web panel');
      });
    });

    // Forward chat messages to connected clients
    if (this.messageLogger) {
      this.messageLogger.on('message', (messageData) => {
        this.io.emit('chat_message', messageData);
      });
    }
  }

  async getSystemStats() {
    try {
      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage();
      const channels = this.twitchEventManager.getChannels();
      
      return {
        uptime,
        memoryUsage: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          rss: memoryUsage.rss
        },
        channels: channels.length,
        connectedClients: this.io.engine.clientsCount
      };
    } catch (error) {
      logger.error('Error getting system stats:', error);
      throw error;
    }
  }

  // Method to broadcast updates to all connected clients
  broadcastUpdate(event, data) {
    this.io.emit(event, data);
  }

  // Method to send update to specific client
  sendUpdate(socketId, event, data) {
    this.io.to(socketId).emit(event, data);
  }
}

// Create singleton instance
const webPanel = new WebPanel();

// Register with service registry immediately
serviceRegistry.register('webPanel', webPanel);

// Export both the class and singleton instance
export { WebPanel, webPanel };
