import { BaseAIProvider } from './BaseAIProvider';
import { AIContext, ServiceConfig } from '../../../types';
import { ServiceContainer } from '../../../types';

export class GPTProvider extends BaseAIProvider {
    constructor(services: ServiceContainer, config: ServiceConfig) {
        super(services, config);
    }

    public async initialize(): Promise<boolean> {
        // Implementation
        throw new Error('Not implemented');
    }

    public async generateResponse(context: AIContext): Promise<string> {
        // Implementation
        throw new Error('Not implemented');
    }

    public async cleanup(): Promise<void> {
        // Implementation
        throw new Error('Not implemented');
    }

    public async generateStreamingResponse(context: AIContext): Promise<AsyncGenerator<string>> {
        // Implementation
        throw new Error('Not implemented');
    }
}
