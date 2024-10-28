import { BaseService } from './BaseService';
import { 
    ServiceContainer,
    ServiceConfig,
    WeatherService as IWeatherService,
    LoggerMethods
} from '../types/services';
import { ErrorCode } from '../types/errors';
import { 
    WeatherData as IWeatherData,
    ForecastData,
    WeatherAlert as IWeatherAlert
} from '../types/weather';

// Create WeatherError class and codes
export const WeatherErrorCode = {
    SERVICE_INIT_FAILED: 'SERVICE_INIT_FAILED' as ErrorCode,
    SERVICE_REQUEST_FAILED: 'SERVICE_REQUEST_FAILED' as ErrorCode,
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED' as ErrorCode
} as const;

export class WeatherServiceError extends Error {
    constructor(public code: ErrorCode, message: string, public context?: any) {
        super(message);
        this.name = 'WeatherServiceError';
    }
}

interface WeatherConfig extends ServiceConfig {
    apiKey: string;
    units: 'metric' | 'imperial';
    cache: {
        enabled: boolean;
        ttl: number;
        maxSize: number;
    };
    rateLimit: {
        requests: number;
        window: number;
    };
    retryConfig: {
        maxRetries: number;
        delay: number;
    };
    geocoding: {
        enabled: boolean;
        cacheResults: boolean;
    };
}

// Update interface to match imported type exactly
interface WeatherData extends IWeatherData {
    location: {
        name: string;
        country: string;
        lat: number;
        lon: number;
        timezone: string;
    };
    current: {
        temp: number;
        feels_like: number;  // Changed from feelsLike
        humidity: number;
        wind_speed: number;  // Changed from windSpeed
        wind_direction: number; // Added missing property
        description: string;
        icon: string;
        timestamp: Date;     // Added with proper type
    };
    forecast?: {
        daily: DailyForecast[];
        hourly: HourlyForecast[];
    };
    alerts?: WeatherAlert[];
    timestamp: number;
    units: 'metric' | 'imperial';
}

interface DailyForecast {
    date: number;
    temp: {
        min: number;
        max: number;
    };
    humidity: number;      // Add missing property
    wind_speed: number;    // Add missing property
    description: string;
    icon: string;
    precipitation: number;
}

interface HourlyForecast {
    time: number;
    temp: number;
    description: string;
    icon: string;
    precipitation: number;
}

// Update severity type to match interface
type AlertSeverity = 'minor' | 'moderate' | 'severe' | 'extreme';

interface WeatherAlert extends IWeatherAlert {
    id: string;
    type: string;
    title: string;
    event: string;
    start: Date;  // Changed from number to Date
    end: Date;    // Changed from number to Date
    description: string;
    areas: string[];
    severity: AlertSeverity;
}

interface GeocodingResult {
    lat: number;
    lon: number;
    name: string;
    country: string;
    state?: string;
}

export class WeatherService extends BaseService implements IWeatherService {
    private readonly cache: Map<string, WeatherData>;
    private readonly geocodeCache: Map<string, GeocodingResult>;
    private readonly rateLimits: Map<string, number>;
    private readonly API_BASE_URL = 'https://api.openweathermap.org/data/3.0';
    public readonly logger: LoggerMethods;  // Changed to public
    public readonly services: ServiceContainer;

    constructor(services: ServiceContainer, config: WeatherConfig) {
        super(config);
        this.services = services;
        this.cache = new Map();
        this.geocodeCache = new Map();
        this.rateLimits = new Map();
        this.logger = services.logger;
    }

    public async initialize(): Promise<void> {
        try {
            // Validate API key
            await this.validateApiKey();

            // Start cache cleanup
            this.startCacheCleanup();

            this.logger.info('Weather service initialized successfully', {
                context: 'weather',
                units: this.config.units,
                geocoding: this.config.geocoding.enabled
            });
        } catch (error) {
            throw new WeatherServiceError(
                WeatherErrorCode.SERVICE_INIT_FAILED,
                'Failed to initialize weather service',
                { error: error.message }
            );
        }
    }

    public async cleanup(): Promise<void> {
        this.cache.clear();
        this.geocodeCache.clear();
        this.rateLimits.clear();
    }

    public async getWeather(location: string): Promise<WeatherData> {
        this.checkRateLimit();

        // Check cache first
        const cacheKey = this.getCacheKey(location);
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.config.cache.ttl) {
            return cached;
        }

        try {
            // Get coordinates
            const coords = await this.getCoordinates(location);
            
            // Fetch weather data
            const weatherData = await this.fetchWeatherData(coords);
            
            // Cache results
            if (this.config.cache.enabled) {
                this.cache.set(cacheKey, weatherData);
            }

            return weatherData;
        } catch (error) {
            throw new WeatherServiceError(
                WeatherErrorCode.SERVICE_REQUEST_FAILED,
                'Failed to fetch weather data',
                { error: error.message, location }
            );
        }
    }

    private async getCoordinates(location: string): Promise<GeocodingResult> {
        if (!this.config.geocoding.enabled) {
            throw new Error('Geocoding is not enabled');
        }

        const cacheKey = location.toLowerCase();
        if (this.config.geocoding.cacheResults) {
            const cached = this.geocodeCache.get(cacheKey);
            if (cached) return cached;
        }

        const response = await this.withRetry(() =>
            fetch(`${this.API_BASE_URL}/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${this.config.apiKey}`)
        );

        if (!response.ok) {
            throw new Error(`Geocoding failed: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.length) {
            throw new Error(`Location not found: ${location}`);
        }

        const result: GeocodingResult = {
            lat: data[0].lat,
            lon: data[0].lon,
            name: data[0].name,
            country: data[0].country,
            state: data[0].state
        };

        if (this.config.geocoding.cacheResults) {
            this.geocodeCache.set(cacheKey, result);
        }

        return result;
    }

    private async fetchWeatherData(coords: GeocodingResult): Promise<WeatherData> {
        const response = await this.withRetry(() =>
            fetch(
                `${this.API_BASE_URL}/onecall?` +
                `lat=${coords.lat}&lon=${coords.lon}&` +
                `units=${this.config.units}&` +
                `appid=${this.config.apiKey}`
            )
        );

        if (!response.ok) {
            throw new Error(`Weather API request failed: ${response.statusText}`);
        }

        const data = await response.json();
        return this.formatWeatherData(data, coords);
    }

    private formatWeatherData(data: any, location: GeocodingResult): WeatherData {
        return {
            location: {
                name: location.name,
                country: location.country,
                lat: location.lat,
                lon: location.lon,
                timezone: data.timezone || 'UTC'
            },
            current: {
                temp: Math.round(data.current.temp),
                feels_like: Math.round(data.current.feels_like),
                humidity: data.current.humidity,
                wind_speed: Math.round(data.current.wind_speed),
                wind_direction: data.current.wind_deg || 0,
                description: data.current.weather[0].description,
                icon: data.current.weather[0].icon,
                timestamp: new Date(data.current.dt * 1000)
            },
            forecast: {
                daily: data.daily.slice(0, 7).map((day: any) => ({
                    date: day.dt * 1000,
                    temp: {
                        min: Math.round(day.temp.min),
                        max: Math.round(day.temp.max)
                    },
                    description: day.weather[0].description,
                    icon: day.weather[0].icon,
                    precipitation: Math.round(day.pop * 100)
                })),
                hourly: data.hourly.slice(0, 24).map((hour: any) => ({
                    time: hour.dt * 1000,
                    temp: Math.round(hour.temp),
                    description: hour.weather[0].description,
                    icon: hour.weather[0].icon,
                    precipitation: Math.round(hour.pop * 100)
                }))
            },
            alerts: data.alerts?.map((alert: any) => ({
                event: alert.event,
                start: alert.start * 1000,
                end: alert.end * 1000,
                description: alert.description,
                severity: this.getAlertSeverity(alert.severity)
            })),
            timestamp: Date.now(),
            units: this.config.units
        };
    }

    private getAlertSeverity(severity: number): AlertSeverity {
        switch (severity) {
            case 1: return 'minor';
            case 2: return 'moderate';
            case 3: return 'severe';
            case 4: return 'extreme';
            default: return 'minor';
        }
    }

    private async withRetry<T>(
        operation: () => Promise<T>,
        retries: number = this.config.retryConfig.maxRetries
    ): Promise<T> {
        let lastError: Error;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (attempt === retries) break;
                
                await new Promise(resolve => 
                    setTimeout(resolve, this.config.retryConfig.delay * attempt)
                );
                this.logger.debug(`Retrying weather operation, attempt ${attempt + 1}/${retries}`);
            }
        }

        throw lastError!;
    }

    private checkRateLimit(): void {
        const now = Date.now();
        const window = this.config.rateLimit.window;
        const requests = this.rateLimits.get(window.toString()) || 0;

        if (requests >= this.config.rateLimit.requests) {
            throw new WeatherServiceError(
                WeatherErrorCode.RATE_LIMIT_EXCEEDED,
                'Weather API rate limit exceeded'
            );
        }

        this.rateLimits.set(window.toString(), requests + 1);
        setTimeout(() => {
            this.rateLimits.set(window.toString(), requests);
        }, window);
    }

    private getCacheKey(location: string): string {
        return `${location.toLowerCase()}:${this.config.units}`;
    }

    private startCacheCleanup(): void {
        setInterval(() => {
            const now = Date.now();
            
            // Clean weather cache
            for (const [key, data] of this.cache.entries()) {
                if (now - data.timestamp > this.config.cache.ttl) {
                    this.cache.delete(key);
                }
            }

            // Clean geocoding cache if needed
            if (this.config.geocoding.cacheResults) {
                if (this.geocodeCache.size > this.config.cache.maxSize) {
                    const oldestKeys = Array.from(this.geocodeCache.keys())
                        .slice(0, this.geocodeCache.size - this.config.cache.maxSize);
                    for (const key of oldestKeys) {
                        this.geocodeCache.delete(key);
                    }
                }
            }
        }, this.config.cache.ttl);
    }

    public async doCleanup(): Promise<void> {
        this.cache.clear();
        this.geocodeCache.clear();
        this.rateLimits.clear();
    }

    public isHealthy(): boolean {
        return true; // Add more sophisticated health checks if needed
    }

    // Helper methods
    public formatTemperature(temp: number): string {
        return `${temp}°${this.config.units === 'metric' ? 'C' : 'F'}`;
    }

    public formatWindSpeed(speed: number): string {
        return `${speed} ${this.config.units === 'metric' ? 'km/h' : 'mph'}`;
    }

    public getWeatherEmoji(icon: string): string {
        const emojiMap: Record<string, string> = {
            '01d': '☀️',  // clear sky day
            '01n': '🌙',  // clear sky night
            '02d': '⛅',  // few clouds day
            '02n': '☁️',  // few clouds night
            '03d': '☁️',  // scattered clouds
            '03n': '☁️',
            '04d': '☁️',  // broken clouds
            '04n': '☁️',
            '09d': '🌧',  // shower rain
            '09n': '🌧️',
            '10d': '🌦️',  // rain day
            '10n': '🌧️',  // rain night
            '11d': '⛈️',  // thunderstorm
            '11n': '⛈️',
            '13d': '🌨️',  // snow
            '13n': '🌨️',
            '50d': '🌫️',  // mist
            '50n': '🌫️'
        };
        return emojiMap[icon] || '🌡️';
    }

    private async validateApiKey(): Promise<void> {
        try {
            const response = await fetch(
                `${this.API_BASE_URL}/weather?q=London&appid=${this.config.apiKey}&units=${this.config.units}`
            );
            
            if (!response.ok) {
                throw new Error(`API validation failed: ${response.statusText}`);
            }
        } catch (error) {
            throw new WeatherServiceError(
                WeatherErrorCode.SERVICE_INIT_FAILED,
                'Invalid OpenWeather API key',
                { error: error.message }
            );
        }
    }

    public async getForecast(location: string): Promise<ForecastData> {
        this.checkRateLimit();

        try {
            const coords = await this.getCoordinates(location);
            const weatherData = await this.fetchWeatherData(coords);
            
            return {
                daily: weatherData.forecast?.daily.map(day => ({
                    date: new Date(day.date),
                    temp: day.temp,
                    humidity: day.humidity || 0,
                    wind_speed: day.wind_speed || 0,
                    description: day.description,
                    icon: day.icon,
                    precipitation: day.precipitation
                })) || [],
                location: weatherData.location,
                units: weatherData.units
            };
        } catch (error) {
            throw new WeatherServiceError(
                WeatherErrorCode.SERVICE_REQUEST_FAILED,
                'Failed to fetch forecast data',
                { error: error.message, location }
            );
        }
    }

    public async getAlerts(location: string): Promise<IWeatherAlert[]> {
        this.checkRateLimit();

        try {
            const coords = await this.getCoordinates(location);
            const weatherData = await this.fetchWeatherData(coords);
            
            return (weatherData.alerts || []).map(alert => {
                // Convert timestamps to numbers before multiplication
                const startTimestamp = Number(alert.start) * 1000;
                const endTimestamp = Number(alert.end) * 1000;
                
                return {
                    id: `${alert.event}_${alert.start}`,
                    type: 'weather',
                    title: alert.event,
                    event: alert.event,
                    start: new Date(startTimestamp),
                    end: new Date(endTimestamp),
                    description: alert.description,
                    areas: [weatherData.location.name],
                    severity: alert.severity
                };
            });
        } catch (error) {
            throw new WeatherServiceError(
                WeatherErrorCode.SERVICE_REQUEST_FAILED,
                'Failed to fetch weather alerts',
                { error: error.message, location }
            );
        }
    }
}
