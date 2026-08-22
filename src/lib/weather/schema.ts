export type WeatherProviderId =
  | "met-norway"
  | "open-meteo";

export interface WeatherSourceMetadata {
  provider: WeatherProviderId;
  fallbackUsed: boolean;
  responseTimeMs: number;
  generatedAt: string;
}

export interface HourlyWeatherPoint {
  time: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  precipitationProbability: number;
  precipitation: number;
  weathercode: number;
  windspeed: number;
  uvIndex: number;
}

export interface HistoricalComparison {
  date: string;
  temperatureMax: number;
  temperatureMin: number;
  precipitationSum: number;
}

export interface NormalizedWeatherData {
  latitude: number;
  longitude: number;
  timezone: string;
  updatedAt: string;

  current: {
    time: string;
    temperature: number;
    windspeed: number;
    winddirection: number;
    weathercode: number;
    isDay: number;
  };

  extra: {
    humidity: number;
    apparentTemperature: number;
    uvIndex: number;
    surfacePressure: number;
  };

  hourly: HourlyWeatherPoint[];

  daily: {
    time: string[];
    weathercode: number[];
    temperatureMax: number[];
    temperatureMin: number[];
    precipitationProbabilityMax: number[];
    precipitationSum: number[];
    uvIndexMax: number[];
    sunrise: string[];
    sunset: string[];
  };

  airQuality?: {
    usAqi: number;
    pm25: number;
    pm10: number;
  };

  historical?: HistoricalComparison;

  // Provider metadata is intentionally optional so cached weather created by
  // older app versions remains compatible with the new schema.
  source?: WeatherSourceMetadata;
}

export interface ComprehensiveWeatherData
  extends NormalizedWeatherData {
  cityName: string;
}
