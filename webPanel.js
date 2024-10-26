import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';
import cors from 'cors';

export class WebPanel {
  constructor(initialPort = 3069) {
    this.initialPort = initialPort;
    this.currentPort = initialPort;
    this.server = null;
    this.io = null;
    
    // Add initialization logging
    logger.debug('WebPanel constructor initialized', {
      initialPort,
      currentPort: this.currentPort
    });
  }

  async initialize({ chatClient, messageLogger, eventManager }) {
    logger.startOperation('WebPanel initialization');
    
    this.chatClient = chatClient;
    this.messageLogger = messageLogger;
    this.eventManager = eventManager;

    const ports = [this.initialPort, 3070, 3071, 3072];
    
    for (const port of ports) {
      try {
        this.currentPort = port;
        await this.startServer();
        logger.info(`Web panel started on port ${port}`);
        logger.endOperation('WebPanel initialization', true);
        return true;
      } catch (error) {
        if (error.code === 'EADDRINUSE') {
          logger.warn(`Port ${port} in use, trying next port...`);
          continue;
        }
        logger.error('Failed to start web panel:', { error, port });
        throw error;
      }
    }
    
    const error = new Error('All web panel ports are in use');
    logger.error('Web panel initialization failed:', { error });
    throw error;
  }

  async startServer() {
    logger.startOperation('Starting web server');
    try {
      const port = this.currentPort;
      if (!port) {
        throw new Error('No valid port specified');
      }

      // Import dependencies
      const express = await import('express');
      const { Server } = await import('socket.io');
      const http = await import('http');
      const cors = await import('cors');
      
      this.app = express.default();
      this.server = http.createServer(this.app);
      
      // Initialize Socket.IO with CORS options
      this.io = new Server(this.server, {
        cors: {
          origin: "*",
          methods: ["GET", "POST"]
        }
      });

      // Setup middleware
      this.app.use(cors.default());
      this.app.use(express.static('public'));
      this.app.use(express.json());

      // Setup socket handlers
      this.io.on('connection', async (socket) => {
        logger.info('Client connected', { 
          socketId: socket.id,
          address: socket.handshake.address 
        });

        socket.on('sendMessage', async (data) => {
          const startTime = Date.now();
          try {
            const { channel, message } = data;
            logger.debug('Processing chat message', { channel, socketId: socket.id });
            
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
            
            await this.messageLogger.logMessage(channel, botMessageData);
            this.io.emit('chatMessage', botMessageData);
            
            logger.logPerformance('Message processing', Date.now() - startTime);
          } catch (error) {
            logger.error('Error sending message:', { error, data });
            socket.emit('error', 'Failed to send message');
          }
        });

        socket.on('disconnect', () => {
          logger.info('Client disconnected', { socketId: socket.id });
        });

        socket.on('error', (error) => {
          logger.error('Socket error:', { error, socketId: socket.id });
          socket.emit('error', 'An error occurred');
        });

        // Send initial data
        try {
          const channels = this.eventManager.getChannels();
          socket.emit('channels', channels);
          
          // Send recent messages for each channel
          for (const channel of channels) {
            const messages = await this.messageLogger.getRecentMessages(channel);
            socket.emit('recentMessages', { channel, messages });
          }
          
          logger.debug('Initial data sent to client', { 
            socketId: socket.id,
            channelCount: channels.length 
          });
        } catch (error) {
          logger.error('Error sending initial data:', { error, socketId: socket.id });
        }
      });

      // Simplified port listening
      await new Promise((resolve, reject) => {
        this.server.listen(port, () => {
          this.port = port;
          this.isListening = true;
          logger.info(`Web panel listening on port ${port}`);
          logger.endOperation('Starting web server', true);
          resolve();
        }).on('error', (err) => {
          logger.error('Server listen error:', { error: err, port });
          reject(err);
        });
      });

      return true;
    } catch (error) {
      logger.endOperation('Starting web server', false);
      throw error;
    }
  }

  async close() {
    logger.startOperation('Closing web server');
    if (this.isListening) {
      await new Promise((resolve) => {
        this.server.close(() => {
          this.isListening = false;
          logger.info('Web server closed successfully');
          logger.endOperation('Closing web server', true);
          resolve();
        });
      });
    }
  }

  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }
}
