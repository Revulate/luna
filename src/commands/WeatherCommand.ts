import { BaseCommand, CommandContext, CommandMetadata } from '../types/commands';
import { ServiceError } from '../errors/ServiceError';
import { ErrorCode } from '../types/errors';
import { ConfigService } from '../services/config';

interface WeatherData {
    location: {
        name: string;
        region: string;
        country: string;
    };
    current: {
        temp_c: number;
        temp_f: number;
        condition: {
            text: string;
            icon: string;
            code: number;
        };
        wind_kph: number;
        wind_mph: number;
        humidity: number;
        feelslike_c: number;
        feelslike_f: number;
    };
}

export class WeatherCommand implements BaseCommand {
    public readonly metadata: CommandMetadata;
    private readonly API_URL = 'http://api.weatherapi.com/v1';
    
    constructor() {
        this.metadata = {
            name: 'weather',
            description: 'Get current weather for a location',
            usage: '!weather <location>',
            category: 'Utility',
            aliases: ['w', 'temp'],
            cooldown: 10000,
            permissions: ['viewer'],
            enabled: true,
            hidden: false
        };
    }

    public async execute(context: CommandContext): Promise<void> {
        const { args, services } = context;

        if (!args.length) {
            throw new Error('Please specify a location');
        }

        const location = args.join(' ');
        
        try {
            const config = services.config as ConfigService;
            const apiKey = config.get('weather.apiKey');
            if (!apiKey) {
                throw new Error('Weather API key not configured');
            }

            const weather = await this.getWeather(location, apiKey);
            const response = this.formatWeatherResponse(weather);
            await context.reply(response);
            
        } catch (error) {
            services.logger.error('Weather API error:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                location
            });
            
            if (error instanceof Error && error.message.includes('No matching location')) {
                throw new Error(`Location "${location}" not found`);
            }
            throw error;
        }
    }

    private async getWeather(location: string, apiKey: string): Promise<WeatherData> {
        const params = new URLSearchParams({
            key: apiKey,
            q: location,
            aqi: 'no'
        });

        const response = await fetch(`${this.API_URL}/current.json?${params}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Weather API error');
        }

        return await response.json();
    }

    private formatWeatherResponse(data: WeatherData): string {
        const { location, current } = data;
        const locationStr = [location.name, location.region, location.country]
            .filter(Boolean)
            .join(', ');

        return `Weather for ${locationStr}: ` +
               `${current.temp_c}°C (${current.temp_f}°F) - ${current.condition.text} | ` +
               `Feels like: ${current.feelslike_c}°C (${current.feelslike_f}°F) | ` +
               `Wind: ${current.wind_kph} km/h | ` +
               `Humidity: ${current.humidity}%`;
    }
}
