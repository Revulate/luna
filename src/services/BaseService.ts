import { Service, ServiceConfig, ServiceContainer } from '../types/services.js';
import { ServiceError, ErrorCode } from '../types/errors.js';

export abstract class BaseService implements Service {
    protected _config: ServiceConfig;
    protected _services: ServiceContainer;
    protected _initialized: boolean = false;

    constructor(config: ServiceConfig, services: ServiceContainer) {
        this._config = config;
        this._services = services;
    }

    get config(): ServiceConfig {
        return this._config;
    }

    get services(): ServiceContainer {
        return this._services;
    }

    get initialized(): boolean {
        return this._initialized;
    }

    protected set initialized(value: boolean) {
        this._initialized = value;
    }

    abstract initialize(): Promise<void>;
    abstract cleanup(): Promise<void>;
    abstract isHealthy(): Promise<boolean>;
}
