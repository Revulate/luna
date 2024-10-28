import { Service, ServiceConfig, ServiceContainer } from '../types/services';
import { ServiceError, ErrorCode } from '../types/errors';
import { EventEmitter } from 'events';

interface ServiceMetrics {
    timestamp: number;
    cpu: number;
    memory: number;
    uptime: number;
    errors: number;
    latency: number;
}

interface ServiceAlert {
    service: string;
    type: 'error' | 'warning' | 'info' | 'performance' | 'dependency' | 'resource';
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    timestamp: Date;
    metrics?: Record<string, any>;
    correlationId?: string;
}

interface DependencyStatus {
    name: string;
    healthy: boolean;
    lastCheck: Date;
    error?: Error;
}

interface HealthStatus {
    service: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    emoji: string;
    details?: string;
    lastCheck: Date;
}

interface HealthReport {
    healthy: boolean;
    services: Record<string, boolean>;
}

export class ServiceMonitor implements Service {
    public readonly config: ServiceConfig;
    public readonly services: ServiceContainer;
    private readonly emitter: EventEmitter;
    private readonly metricsHistory: Map<string, ServiceMetrics[]>;
    private readonly alerts: ServiceAlert[];
    private readonly dependencies: Map<string, DependencyStatus>;
    private healthStatuses: Map<string, HealthStatus> = new Map();
    private checkInterval?: NodeJS.Timeout;

    constructor(config: ServiceConfig, services: ServiceContainer) {
        this.config = config;
        this.services = services;
        this.emitter = new EventEmitter();
        this.metricsHistory = new Map();
        this.alerts = [];
        this.dependencies = new Map();
    }

    async initialize(): Promise<void> {
        try {
            this.startServiceMonitoring();
            this.subscribeToServiceEvents();
            this.initializeDependencyMonitoring();

            this.services.logger.info('Service monitor initialized successfully', {
                context: 'monitor',
                features: ['metrics', 'alerts', 'dependencies']
            });
        } catch (error) {
            throw this.handleError(error as Error, 'SERVICE_UNAVAILABLE');
        }
    }

    async cleanup(): Promise<void> {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        this.emitter.removeAllListeners();
    }

    handleError(error: Error, code: ErrorCode = 'INTERNAL_ERROR'): ServiceError {
        return {
            name: error.name,
            message: error.message,
            code,
            stack: error.stack,
            timestamp: new Date(),
            toJSON() {
                return {
                    name: this.name,
                    message: this.message,
                    code: this.code,
                    timestamp: this.timestamp
                };
            }
        };
    }

    private startServiceMonitoring(): void {
        this.checkInterval = setInterval(() => {
            for (const [name, service] of Object.entries(this.services)) {
                if (typeof service.getMetrics === 'function') {
                    const metrics = service.getMetrics();
                    this.updateMetrics(name, metrics);
                }
            }
        }, 60000); // Check every minute
    }

    private subscribeToServiceEvents(): void {
        for (const [name, service] of Object.entries(this.services)) {
            if (service instanceof EventEmitter) {
                service.on('error', (error: Error) => {
                    void this.handleServiceError(name, error);
                });
            }
        }
    }

    private initializeDependencyMonitoring(): void {
        for (const [name, service] of Object.entries(this.services)) {
            this.dependencies.set(name, {
                name,
                healthy: true,
                lastCheck: new Date()
            });
        }
    }

    private async handleServiceError(serviceName: string, error: Error): Promise<void> {
        const alert: ServiceAlert = {
            service: serviceName,
            type: 'error',
            severity: 'critical',
            message: error.message,
            timestamp: new Date(),
            metrics: this.getServiceMetrics(serviceName)
        };
        await this.addServiceAlert(alert);
    }

    private updateMetrics(serviceName: string, metrics: ServiceMetrics): void {
        let history = this.metricsHistory.get(serviceName) || [];
        history.push(metrics);

        // Keep last 100 metrics
        if (history.length > 100) {
            history = history.slice(-100);
        }

        this.metricsHistory.set(serviceName, history);
    }

    public getServiceMetrics(serviceName: string): ServiceMetrics | undefined {
        const history = this.metricsHistory.get(serviceName);
        return history?.[history.length - 1];
    }

    private async addServiceAlert(alert: ServiceAlert): Promise<void> {
        this.alerts.push(alert);
        this.emitter.emit('alert', alert);
        
        // Log alert
        this.services.logger.warn(`Service alert: ${alert.message}`, {
            service: alert.service,
            type: alert.type,
            severity: alert.severity
        });
    }

    public isHealthy(): boolean {
        return Array.from(this.dependencies.values()).every(dep => dep.healthy);
    }

    private getStatusEmoji(status: string): string {
        switch (status) {
            case 'healthy': return '✅';
            case 'degraded': return '⚠️';
            case 'unhealthy': return '❌';
            default: return '❓';
        }
    }

    public async checkHealth(): Promise<HealthReport> {
        const services = this.services.getAllServices();
        const healthChecks = await Promise.all(
            Array.from(services.entries()).map(async ([name, service]: [string, Service]) => {
                try {
                    const isHealthy = await service.isHealthy();
                    return { name, healthy: isHealthy };
                } catch {
                    return { name, healthy: false };
                }
            })
        );

        const report: HealthReport = {
            healthy: healthChecks.every((check): check is { name: string; healthy: boolean } => check.healthy),
            services: Object.fromEntries(
                healthChecks.map((check): [string, boolean] => [check.name, check.healthy])
            )
        };

        return report;
    }
}
