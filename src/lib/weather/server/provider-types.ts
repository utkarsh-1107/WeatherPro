import type {
  NormalizedWeatherData,
  WeatherProviderId,
} from "../schema";

export type WeatherProviderInput = {
  latitude: number;
  longitude: number;
  timezoneHint?: string;
};

export interface WeatherProvider {
  id: WeatherProviderId;
  getForecast(
    input: WeatherProviderInput
  ): Promise<NormalizedWeatherData>;
}

export type WeatherProviderAttempt = {
  provider: WeatherProviderId;
  message: string;
};
