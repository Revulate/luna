import { ServiceConfig } from './base';

export interface WeatherData {
    location: {
        name: string;
        country: string;
        lat: number;
        lon: number;
        timezone: string;
    };
    current: {
        temp: number;
        feels_like: number;
        humidity: number;
        wind_speed: number;
        wind_direction: number;
        description: string;
        icon: string;
        timestamp: Date;
    };
    units: 'metric' | 'imperial';
}

export interface ForecastData {
    location: WeatherData['location'];
    daily: Array<{
        date: Date;
        temp: {
            min: number;
            max: number;
        };
        humidity: number;
        wind_speed: number;
        description: string;
        icon: string;
        precipitation: number;
    }>;
    units: 'metric' | 'imperial';
}

export interface WeatherAlert {
    id: string;
    type: string;
    severity: 'minor' | 'moderate' | 'severe' | 'extreme';
    title: string;
    description: string;
    start: Date;
    end: Date;
    areas: string[];
}
