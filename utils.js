export function isMod(user) {
  return user.isMod || user.isBroadcaster;
}

export function isVip(user) {
  return user.isVip;
}

import logger from './logger.js';

export async function gracefulShutdown() {
  logger.info('Initiating graceful shutdown...');
  // Disconnect from Twitch chat
  if (global.chatClient) {
    await global.chatClient.quit();
  }
  // Close database connections
  if (global.db) {
    await global.db.close();
  }
  // Perform any other necessary cleanup
  process.exit(1);
}
