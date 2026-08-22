import type {
  HourlyWeatherPoint,
  NormalizedWeatherData,
} from "../../schema";
import type {
  WeatherProvider,
  WeatherProviderInput,
} from "../provider-types";
import {
  apparentTemperatureC,
  asNumber,
  localDateKey,
  roundCoordinate,
  sunriseSunsetForDate,
  validTimeZone,
} from "../helpers";

type MetPeriod = {
  summary?: {
    symbol_code?: string;
  };
  details?: {
    precipitation_amount?: number;
    probability_of_precipitation?: number;
    air_temperature_max?: number;
    air_temperature_min?: number;
  };
};

type MetTimeseriesPoint = {
  time: string;
  data: {
    instant?: {
      details?: Record<string, number>;
    };
    next_1_hours?: MetPeriod;
    next_6_hours?: MetPeriod;
    next_12_hours?: MetPeriod;
  };
};

type MetPayload = {
  properties?: {
    meta?: {
      updated_at?: string;
    };
    timeseries?: MetTimeseriesPoint[];
  };
};

const PROVIDER_TIMEOUT_MS = 3500;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PROVIDER_CACHE_ENTRIES = 180;

type MetProviderCacheEntry = {
  payload: MetPayload;
  expiresAt: number;
  lastModified?: string;
};

const metProviderCache = new Map<
  string,
  MetProviderCacheEntry
>();

function userAgent() {
  return (
    process.env.MET_NORWAY_USER_AGENT?.trim() ||
    "WeatherPro/1.0 https://weatherpro1130.vercel.app/"
  );
}

function providerExpiry(
  headers: Headers
) {
  const expiresHeader =
    headers.get("expires");

  const expiresAt = expiresHeader
    ? Date.parse(expiresHeader)
    : Number.NaN;

  if (
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now()
  ) {
    return expiresAt;
  }

  return (
    Date.now() +
    DEFAULT_CACHE_TTL_MS
  );
}

function pruneProviderCache() {
  if (
    metProviderCache.size <=
    MAX_PROVIDER_CACHE_ENTRIES
  ) {
    return;
  }

  const now = Date.now();

  for (
    const [key, entry] of
    metProviderCache
  ) {
    if (entry.expiresAt <= now) {
      metProviderCache.delete(key);
    }
  }

  while (
    metProviderCache.size >
    MAX_PROVIDER_CACHE_ENTRIES
  ) {
    const oldestKey =
      metProviderCache.keys().next().value;

    if (!oldestKey) break;

    metProviderCache.delete(oldestKey);
  }
}

async function fetchMetPayload(
  url: string
) {
  const cached =
    metProviderCache.get(url);

  if (
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return cached.payload;
  }

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    PROVIDER_TIMEOUT_MS
  );

  try {
    const headers: Record<
      string,
      string
    > = {
      Accept: "application/json",
      "User-Agent": userAgent(),
    };

    if (cached?.lastModified) {
      headers["If-Modified-Since"] =
        cached.lastModified;
    }

    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });

    if (
      response.status === 304 &&
      cached
    ) {
      cached.expiresAt =
        providerExpiry(
          response.headers
        );

      metProviderCache.set(
        url,
        cached
      );

      return cached.payload;
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (!response.ok) {
      const body =
        await response.text();

      throw new Error(
        `HTTP ${response.status}: ${body.slice(0, 180)}`
      );
    }

    if (
      !contentType
        .toLowerCase()
        .includes("application/json")
    ) {
      const body =
        await response.text();

      throw new Error(
        `Expected JSON but received ${
          contentType ||
          "unknown content type"
        }: ${body.slice(0, 180)}`
      );
    }

    const payload =
      (await response.json()) as
        MetPayload;

    metProviderCache.set(url, {
      payload,
      expiresAt:
        providerExpiry(
          response.headers
        ),
      lastModified:
        response.headers.get(
          "last-modified"
        ) || undefined,
    });

    pruneProviderCache();

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function periodForPoint(
  point: MetTimeseriesPoint,
  nextPoint?: MetTimeseriesPoint
) {
  const currentTime = new Date(
    point.time
  ).getTime();

  const nextTime = nextPoint
    ? new Date(nextPoint.time).getTime()
    : Number.NaN;

  const stepHours = Number.isFinite(
    nextTime
  )
    ? Math.max(
        1,
        Math.round(
          (nextTime - currentTime) /
            3600000
        )
      )
    : 1;

  if (
    stepHours <= 2 &&
    point.data.next_1_hours
  ) {
    return point.data.next_1_hours;
  }

  if (point.data.next_6_hours) {
    return point.data.next_6_hours;
  }

  return (
    point.data.next_1_hours ||
    point.data.next_12_hours
  );
}

function symbolForPoint(
  point: MetTimeseriesPoint
) {
  return (
    point.data.next_1_hours?.summary
      ?.symbol_code ||
    point.data.next_6_hours?.summary
      ?.symbol_code ||
    point.data.next_12_hours?.summary
      ?.symbol_code ||
    ""
  );
}

// Normalize MET/Yr symbol names into the WMO-style numeric code already used
// throughout the WeatherPro UI. This prevents provider-specific JSON or icon
// names from leaking into React components.
export function metSymbolToWmoCode(
  symbolCode = ""
) {
  const symbol = symbolCode
    .toLowerCase()
    .replace(
      /_(day|night|polartwilight)$/,
      ""
    );

  if (!symbol) return 3;

  if (symbol.includes("thunder")) {
    if (
      symbol.includes("heavy") ||
      symbol.includes("snow") ||
      symbol.includes("sleet")
    ) {
      return 96;
    }

    return 95;
  }

  if (symbol.includes("fog")) return 45;

  if (symbol.includes("heavyrainshowers")) {
    return 82;
  }

  if (symbol.includes("rainshowers")) {
    return symbol.includes("light")
      ? 80
      : 81;
  }

  if (
    symbol.includes("snowshowers") ||
    symbol.includes("sleetshowers")
  ) {
    return symbol.includes("heavy")
      ? 86
      : 85;
  }

  if (symbol.includes("heavyrain")) {
    return 65;
  }

  if (symbol.includes("lightrain")) {
    return 61;
  }

  if (symbol.includes("rain")) {
    return 63;
  }

  if (symbol.includes("heavysnow")) {
    return 75;
  }

  if (symbol.includes("lightsnow")) {
    return 71;
  }

  if (symbol.includes("snow")) {
    return 73;
  }

  if (symbol.includes("sleet")) {
    return 67;
  }

  if (symbol.includes("clearsky")) {
    return 0;
  }

  if (symbol.includes("fair")) {
    return 1;
  }

  if (symbol.includes("partlycloudy")) {
    return 2;
  }

  if (symbol.includes("cloudy")) {
    return 3;
  }

  return 3;
}

function isDayFromSymbol(
  symbolCode: string
) {
  if (symbolCode.endsWith("_night")) {
    return 0;
  }

  return 1;
}

function weatherSeverity(code: number) {
  if (code >= 95) return 100;
  if (code >= 85) return 90;
  if (code >= 80) return 80;
  if (code >= 70) return 75;
  if (code >= 60) return 70;
  if (code >= 45) return 60;
  if (code >= 3) return 30;
  if (code === 2) return 20;
  if (code === 1) return 10;
  return 0;
}

function representativeWeatherCode(
  codes: number[]
) {
  if (!codes.length) return 3;

  return [...codes].sort(
    (a, b) =>
      weatherSeverity(b) -
      weatherSeverity(a)
  )[0];
}

export function normalizeMetNorwayPayload(
  payload: MetPayload,
  input: WeatherProviderInput
): NormalizedWeatherData {
  const series =
    payload.properties?.timeseries;

  if (
    !Array.isArray(series) ||
    series.length === 0
  ) {
    throw new Error(
      "MET Norway returned no forecast timeseries."
    );
  }

  const now = Date.now();

  let currentIndex = series.findIndex(
    (point) =>
      new Date(point.time).getTime() >=
      now - 30 * 60 * 1000
  );

  if (currentIndex < 0) {
    currentIndex = 0;
  }

  const currentPoint =
    series[currentIndex];

  const currentDetails =
    currentPoint.data.instant?.details ||
    {};

  const currentTemperature = asNumber(
    currentDetails.air_temperature
  );

  const currentHumidity = asNumber(
    currentDetails.relative_humidity
  );

  const currentWindMs = asNumber(
    currentDetails.wind_speed
  );

  const currentWindKmh =
    currentWindMs * 3.6;

  const currentSymbol =
    symbolForPoint(currentPoint);

  const timezone =
    validTimeZone(input.timezoneHint) ||
    "UTC";

  const hourly: HourlyWeatherPoint[] =
    series
      .slice(
        currentIndex,
        currentIndex + 24
      )
      .map((point, offset) => {
        const details =
          point.data.instant?.details ||
          {};

        const period = periodForPoint(
          point,
          series[
            currentIndex + offset + 1
          ]
        );

        const temperature = asNumber(
          details.air_temperature
        );

        const humidity = asNumber(
          details.relative_humidity
        );

        const windspeed =
          asNumber(details.wind_speed) *
          3.6;

        return {
          time: point.time,
          temperature,
          apparentTemperature:
            apparentTemperatureC(
              temperature,
              humidity,
              windspeed
            ),
          humidity,
          precipitationProbability:
            asNumber(
              period?.details
                ?.probability_of_precipitation
            ),
          precipitation: asNumber(
            period?.details
              ?.precipitation_amount
          ),
          weathercode:
            metSymbolToWmoCode(
              symbolForPoint(point)
            ),
          windspeed,
          uvIndex: asNumber(
            details.ultraviolet_index_clear_sky
          ),
        };
      });

  type DailyAccumulator = {
    date: string;
    temperatures: number[];
    precipitation: number;
    precipitationProbabilities: number[];
    uv: number[];
    weatherCodes: number[];
  };

  const dayMap = new Map<
    string,
    DailyAccumulator
  >();

  for (
    let index = currentIndex;
    index < series.length;
    index += 1
  ) {
    const point = series[index];
    const date = localDateKey(
      point.time,
      timezone
    );

    if (
      !dayMap.has(date) &&
      dayMap.size >= 7
    ) {
      break;
    }

    const details =
      point.data.instant?.details ||
      {};

    const period = periodForPoint(
      point,
      series[index + 1]
    );

    const day =
      dayMap.get(date) || {
        date,
        temperatures: [],
        precipitation: 0,
        precipitationProbabilities: [],
        uv: [],
        weatherCodes: [],
      };

    const temperature =
      details.air_temperature;

    if (
      typeof temperature === "number" &&
      Number.isFinite(temperature)
    ) {
      day.temperatures.push(
        temperature
      );
    }

    const precipitation =
      period?.details
        ?.precipitation_amount;

    if (
      typeof precipitation === "number" &&
      Number.isFinite(precipitation)
    ) {
      day.precipitation +=
        precipitation;
    }

    const probability =
      period?.details
        ?.probability_of_precipitation;

    if (
      typeof probability === "number" &&
      Number.isFinite(probability)
    ) {
      day.precipitationProbabilities.push(
        probability
      );
    }

    const uv =
      details.ultraviolet_index_clear_sky;

    if (
      typeof uv === "number" &&
      Number.isFinite(uv)
    ) {
      day.uv.push(uv);
    }

    day.weatherCodes.push(
      metSymbolToWmoCode(
        symbolForPoint(point)
      )
    );

    dayMap.set(date, day);
  }

  const days = Array.from(
    dayMap.values()
  ).slice(0, 7);

  const sunEvents = days.map((day) =>
    sunriseSunsetForDate(
      day.date,
      input.latitude,
      input.longitude
    )
  );

  return {
    latitude: input.latitude,
    longitude: input.longitude,
    timezone,
    updatedAt:
      payload.properties?.meta
        ?.updated_at ||
      new Date().toISOString(),

    current: {
      time: currentPoint.time,
      temperature:
        currentTemperature,
      windspeed: currentWindKmh,
      winddirection: asNumber(
        currentDetails.wind_from_direction
      ),
      weathercode:
        metSymbolToWmoCode(
          currentSymbol
        ),
      isDay:
        isDayFromSymbol(currentSymbol),
    },

    extra: {
      humidity: currentHumidity,
      apparentTemperature:
        apparentTemperatureC(
          currentTemperature,
          currentHumidity,
          currentWindKmh
        ),
      uvIndex: asNumber(
        currentDetails
          .ultraviolet_index_clear_sky
      ),
      // MET provides sea-level pressure. The existing UI calls this field
      // surfacePressure, so the neutral schema keeps that compatibility name.
      surfacePressure: asNumber(
        currentDetails
          .air_pressure_at_sea_level
      ),
    },

    hourly,

    daily: {
      time: days.map(
        (day) => day.date
      ),
      weathercode: days.map((day) =>
        representativeWeatherCode(
          day.weatherCodes
        )
      ),
      temperatureMax: days.map(
        (day) =>
          day.temperatures.length
            ? Math.max(
                ...day.temperatures
              )
            : 0
      ),
      temperatureMin: days.map(
        (day) =>
          day.temperatures.length
            ? Math.min(
                ...day.temperatures
              )
            : 0
      ),
      precipitationProbabilityMax:
        days.map((day) =>
          day
            .precipitationProbabilities
            .length
            ? Math.max(
                ...day
                  .precipitationProbabilities
              )
            : 0
        ),
      precipitationSum: days.map(
        (day) =>
          Number(
            day.precipitation.toFixed(2)
          )
      ),
      uvIndexMax: days.map((day) =>
        day.uv.length
          ? Math.max(...day.uv)
          : 0
      ),
      sunrise: sunEvents.map(
        (event) => event.sunrise
      ),
      sunset: sunEvents.map(
        (event) => event.sunset
      ),
    },
  };
}

export const metNorwayProvider: WeatherProvider =
  {
    id: "met-norway",

    async getForecast(input) {
      const latitude =
        roundCoordinate(input.latitude);

      const longitude =
        roundCoordinate(input.longitude);

      const url =
        "https://api.met.no/weatherapi/locationforecast/2.0/complete" +
        `?lat=${encodeURIComponent(latitude)}` +
        `&lon=${encodeURIComponent(longitude)}`;

      const payload =
        await fetchMetPayload(url);

      return normalizeMetNorwayPayload(
        payload,
        {
          ...input,
          latitude,
          longitude,
        }
      );
    },
  };
