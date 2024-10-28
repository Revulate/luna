 import { ServiceContainer } from './services/ServiceContainer.js';
import { LoggingService } from './services/LoggingService.js';
import { ConfigService } from './services/ConfigService.js';
import { DatabaseService } from './services/DatabaseService.js';
import { TwitchService } from './services/TwitchService.js';
// Import other services...

async function main() {
    const container = new ServiceContainer();
    
    console.log('Adding services to container');
    container.addService('logging', new LoggingService(/* params */));
    container.addService('config', new ConfigService(/* params */));
    container.addService('database', new DatabaseService(/* params */));
    container.addService('twitch', new TwitchService(/* params */));
    // Add other services...

    console.log('Services added, starting initialization');
    await container.initialize();
}

main().catch(error => {
    console.error('Fatal error during startup:', error);
    process.exit(1);
});
