import { ServiceConfig } from './base';

export interface LoggingConfig extends ServiceConfig {
    level: LogLevel;
    file?: {
        enabled: boolean;
        path: string;
        maxSize: number;
        maxFiles: number;
    };
    console?: {
        enabled: boolean;
        colorize: boolean;
    };
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: Date;
    metadata?: Record<string, any>;
    service?: string;
    error?: Error;
}

export interface LogMetrics {
    totalLogs: number;
    errorCount: number;
    warningCount: number;
    lastError?: {
        message: string;
        timestamp: Date;
        service?: string;
    };
}

export interface LoggerOptions {
    service: string;
    level?: LogLevel;
    metadata?: Record<string, any>;
}

export interface LogFormatter {
    (info: LogEntry): string;
}

export interface LogTransport {
    level: LogLevel;
    format: LogFormatter;
    handleLog(entry: LogEntry): Promise<void>;
}

export interface ErrorMetadata {
    service?: string;
    command?: string;
    user?: string;
    channel?: string;
    [key: string]: any;
}

export function createErrorMetadata(error: Error, context?: ErrorMetadata): Record<string, any> {
    return {
        message: error.message,
        stack: error.stack,
        ...context
    };
}
