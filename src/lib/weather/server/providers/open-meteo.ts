import type {
  HourlyWeatherPoint,
  NormalizedWeatherData,
} from "../../schema";
import type {
  WeatherProvider,
  WeatherProviderInput,
} from "../provider-types";
import {
  asNumber,
  fetchJsonWithTimeout,
  roundCoordinate,
} from "../helpers";

type OpenMeteoPayload = {
  timezone?: string;
  current?: Record<string, unknown>;
  hourly?: Record<string, unknown>;
  daily?: Record<string, unknown>;
};

const PROVIDER_TIMEOUT_MS = 5000;
const PROVIDER_REVALIDATE_SECONDS = 300;

function arrayValue(
  value: unknown,
  index: number,
  fallback = 0
) {
  return Array.isArray(value)
    ? asNumber(value[index], fallback)
    : fallback;
}

function stringArray(
  value: unknown
) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string"
      )
    : [];
}

export function normalizeOpenMeteoPayload(
  payload: OpenMeteoPayload,
  input: WeatherProviderInput
): NormalizedWeatherData {
  if (
    !payload.current ||
    !payload.hourly ||
    !payload.daily
  ) {
    throw new Error(
      "Open-Meteo returned incomplete forecast data."
    );
  }

  const current = payload.current;
  const hourlyData = payload.hourly;
  const dailyData = payload.daily;

  const currentTime =
    typeof current.time === "string"
      ? current.time
      : "";

  const hourlyTimes = stringArray(
    hourlyData.time
  );

  let startIndex =
    hourlyTimes.findIndex(
      (time) => time >= currentTime
    );

  if (startIndex < 0) {
    startIndex = 0;
  }

  const hourly: HourlyWeatherPoint[] =
    hourlyTimes
      .slice(
        startIndex,
        startIndex + 24
      )
      .map((time, offset) => {
        const index =
          startIndex + offset;

        return {
          time,
          temperature: arrayValue(
            hourlyData.temperature_2m,
            index
          ),
          apparentTemperature:
            arrayValue(
              hourlyData.apparent_temperature,
              index
            ),
          humidity: arrayValue(
            hourlyData.relative_humidity_2m,
            index
          ),
          precipitationProbability:
            arrayValue(
              hourlyData
                .precipitation_probability,
              index
            ),
          precipitation: arrayValue(
            hourlyData.precipitation,
            index
          ),
          weathercode: arrayValue(
            hourlyData.weather_code,
            index
          ),
          windspeed: arrayValue(
            hourlyData.wind_speed_10m,
            index
          ),
          uvIndex: arrayValue(
            hourlyData.uv_index,
            index
          ),
        };
      });

  return {
    latitude: input.latitude,
    longitude: input.longitude,
    timezone:
      payload.timezone ||
      input.timezoneHint ||
      "UTC",
    updatedAt:
      new Date().toISOString(),

    current: {
      time: currentTime,
      temperature: asNumber(
        current.temperature_2m
      ),
      windspeed: asNumber(
        current.wind_speed_10m
      ),
      winddirection: asNumber(
        current.wind_direction_10m
      ),
      weathercode: asNumber(
        current.weather_code
      ),
      isDay: asNumber(
        current.is_day,
        1
      ),
    },

    extra: {
      humidity: asNumber(
        current.relative_humidity_2m
      ),
      apparentTemperature:
        asNumber(
          current.apparent_temperature
        ),
      uvIndex:
        hourly[0]?.uvIndex || 0,
      surfacePressure: asNumber(
        current.surface_pressure
      ),
    },

    hourly,

    daily: {
      time: stringArray(
        dailyData.time
      ),
      weathercode:
        Array.isArray(
          dailyData.weather_code
        )
          ? dailyData.weather_code.map(
              (value) =>
                asNumber(value)
            )
          : [],
      temperatureMax:
        Array.isArray(
          dailyData.temperature_2m_max
        )
          ? dailyData.temperature_2m_max.map(
              (value) =>
                asNumber(value)
            )
          : [],
      temperatureMin:
        Array.isArray(
          dailyData.temperature_2m_min
        )
          ? dailyData.temperature_2m_min.map(
              (value) =>
                asNumber(value)
            )
          : [],
      precipitationProbabilityMax:
        Array.isArray(
          dailyData
            .precipitation_probability_max
        )
          ? dailyData
              .precipitation_probability_max
              .map((value) =>
                asNumber(value)
              )
          : [],
      precipitationSum:
        Array.isArray(
          dailyData.precipitation_sum
        )
          ? dailyData.precipitation_sum.map(
              (value) =>
                asNumber(value)
            )
          : [],
      uvIndexMax:
        Array.isArray(
          dailyData.uv_index_max
        )
          ? dailyData.uv_index_max.map(
              (value) =>
                asNumber(value)
            )
          : [],
      sunrise: stringArray(
        dailyData.sunrise
      ),
      sunset: stringArray(
        dailyData.sunset
      ),
    },
  };
}

export const openMeteoProvider: WeatherProvider =
  {
    id: "open-meteo",

    async getForecast(input) {
      const latitude =
        roundCoordinate(input.latitude);

      const longitude =
        roundCoordinate(input.longitude);

      const url =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${encodeURIComponent(latitude)}` +
        `&longitude=${encodeURIComponent(longitude)}` +
        "&current=" +
        [
          "temperature_2m",
          "relative_humidity_2m",
          "apparent_temperature",
          "is_day",
          "weather_code",
          "surface_pressure",
          "wind_speed_10m",
          "wind_direction_10m",
        ].join(",") +
        "&hourly=" +
        [
          "temperature_2m",
          "apparent_temperature",
          "relative_humidity_2m",
          "precipitation_probability",
          "precipitation",
          "weather_code",
          "wind_speed_10m",
          "uv_index",
        ].join(",") +
        "&daily=" +
        [
          "weather_code",
          "temperature_2m_max",
          "temperature_2m_min",
          "precipitation_probability_max",
          "precipitation_sum",
          "sunrise",
          "sunset",
          "uv_index_max",
        ].join(",") +
        "&forecast_days=7" +
        "&timezone=auto";

      const { payload } =
        await fetchJsonWithTimeout<OpenMeteoPayload>(
          url,
          {
            timeoutMs:
              PROVIDER_TIMEOUT_MS,
            revalidateSeconds:
              PROVIDER_REVALIDATE_SECONDS,
          }
        );

      return normalizeOpenMeteoPayload(
        payload,
        {
          ...input,
          latitude,
          longitude,
        }
      );
    },
  };
