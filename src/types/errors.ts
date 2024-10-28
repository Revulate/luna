// Define all possible error codes
export enum ErrorCode {
    // Core errors
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    INVALID_INPUT = 'INVALID_INPUT',
    NOT_FOUND = 'NOT_FOUND',
    UNAUTHORIZED = 'UNAUTHORIZED',
    RATE_LIMITED = 'RATE_LIMITED',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',

    // Service specific errors
    CONFIG_MISSING = 'CONFIG_MISSING',
    CONFIG_INVALID = 'CONFIG_INVALID',
    AI_PROVIDER_ERROR = 'AI_PROVIDER_ERROR',
    AI_REQUEST_FAILED = 'AI_REQUEST_FAILED',
    AI_CONTEXT_INVALID = 'AI_CONTEXT_INVALID',
    SERVICE_CLEANUP_FAILED = 'SERVICE_CLEANUP_FAILED',
    INITIALIZATION_FAILED = 'INITIALIZATION_FAILED'
}

// Export the ServiceError class directly
export class ServiceError extends Error {
    public readonly code: ErrorCode;
    public readonly context?: string;
    public readonly metadata?: Record<string, any>;
    public readonly timestamp: Date;

    constructor(
        code: ErrorCode,
        message: string,
        context?: string,
        metadata?: Record<string, any>
    ) {
        super(message);
        this.code = code;
        this.context = context;
        this.metadata = metadata;
        this.timestamp = new Date();
        this.name = 'ServiceError';
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            timestamp: this.timestamp
        };
    }
}
