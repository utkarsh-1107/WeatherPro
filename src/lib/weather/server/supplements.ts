import type {
  HistoricalComparison,
} from "../schema";
import {
  asNumber,
  fetchJsonWithTimeout,
  roundCoordinate,
} from "./helpers";

type AirQualityPayload = {
  timezone?: string;
  current?: {
    us_aqi?: number;
    pm10?: number;
    pm2_5?: number;
  };
};

type ArchivePayload = {
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
  };
};

export async function fetchWeatherSupplements(
  latitude: number,
  longitude: number
): Promise<{
  timezone?: string;
  airQuality?: {
    usAqi: number;
    pm25: number;
    pm10: number;
  };
  historical?: HistoricalComparison;
}> {
  const lat = roundCoordinate(latitude);
  const lon = roundCoordinate(longitude);

  const now = new Date();
  const lastYear = new Date(now);

  lastYear.setFullYear(
    now.getFullYear() - 1
  );

  const historicDate =
    lastYear
      .toISOString()
      .slice(0, 10);

  const airQualityUrl =
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    "&current=us_aqi,pm10,pm2_5" +
    "&timezone=auto";

  const archiveUrl =
    "https://archive-api.open-meteo.com/v1/archive" +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&start_date=${historicDate}` +
    `&end_date=${historicDate}` +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum" +
    "&timezone=auto";

  const [aqiResult, archiveResult] =
    await Promise.allSettled([
      fetchJsonWithTimeout<AirQualityPayload>(
        airQualityUrl,
        {
          timeoutMs: 1800,
          revalidateSeconds: 600,
        }
      ),
      fetchJsonWithTimeout<ArchivePayload>(
        archiveUrl,
        {
          timeoutMs: 1800,
          revalidateSeconds: 21600,
        }
      ),
    ]);

  const aqi =
    aqiResult.status === "fulfilled"
      ? aqiResult.value.payload
      : undefined;

  const archive =
    archiveResult.status === "fulfilled"
      ? archiveResult.value.payload
      : undefined;

  const historical =
    archive?.daily?.time?.length
      ? {
          date:
            archive.daily.time[0],
          temperatureMax: asNumber(
            archive.daily
              .temperature_2m_max?.[0]
          ),
          temperatureMin: asNumber(
            archive.daily
              .temperature_2m_min?.[0]
          ),
          precipitationSum: asNumber(
            archive.daily
              .precipitation_sum?.[0]
          ),
        }
      : undefined;

  return {
    timezone: aqi?.timezone,

    airQuality: aqi?.current
      ? {
          usAqi: asNumber(
            aqi.current.us_aqi
          ),
          pm25: asNumber(
            aqi.current.pm2_5
          ),
          pm10: asNumber(
            aqi.current.pm10
          ),
        }
      : undefined,

    historical,
  };
}
