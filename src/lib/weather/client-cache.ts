import type {
  NormalizedWeatherData,
} from "./schema";

const CACHE_KEY =
  "weatherpro_forecast_cache_v2";

export const FORECAST_FRESH_MS =
  5 * 60 * 1000;

export const FORECAST_STALE_MS =
  6 * 60 * 60 * 1000;

const MAX_ENTRIES = 24;

type CacheEntry = {
  key: string;
  savedAt: number;
  data: NormalizedWeatherData;
};

type CacheStore = {
  version: 2;
  entries: CacheEntry[];
};

export type WeatherCacheFreshness =
  | "fresh"
  | "stale"
  | "miss";

export type CachedForecast = {
  data: NormalizedWeatherData | null;
  freshness: WeatherCacheFreshness;
  ageMs: number | null;
};

function storage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStore(): CacheStore {
  const target = storage();

  if (!target) {
    return {
      version: 2,
      entries: [],
    };
  }

  try {
    const raw = target.getItem(CACHE_KEY);

    if (!raw) {
      return {
        version: 2,
        entries: [],
      };
    }

    const parsed = JSON.parse(
      raw
    ) as Partial<CacheStore>;

    return {
      version: 2,
      entries:
        parsed.version === 2 &&
        Array.isArray(parsed.entries)
          ? parsed.entries.filter(
              (
                entry
              ): entry is CacheEntry =>
                Boolean(
                  entry &&
                    typeof entry.key ===
                      "string" &&
                    typeof entry.savedAt ===
                      "number" &&
                    entry.data
                )
            )
          : [],
    };
  } catch {
    return {
      version: 2,
      entries: [],
    };
  }
}

function writeStore(store: CacheStore) {
  const target = storage();

  if (!target) return;

  try {
    target.setItem(
      CACHE_KEY,
      JSON.stringify(store)
    );
  } catch {
    // Cache is an optimization, never a requirement.
  }
}

export function weatherCacheKey(
  latitude: number,
  longitude: number,
  timezoneHint?: string
) {
  return [
    latitude.toFixed(3),
    longitude.toFixed(3),
    timezoneHint || "",
  ].join("|");
}

export function readForecastCache(
  latitude: number,
  longitude: number,
  timezoneHint?: string
): CachedForecast {
  const key = weatherCacheKey(
    latitude,
    longitude,
    timezoneHint
  );

  const store = readStore();

  const entry = store.entries.find(
    (candidate) => candidate.key === key
  );

  if (!entry) {
    return {
      data: null,
      freshness: "miss",
      ageMs: null,
    };
  }

  const ageMs = Math.max(
    0,
    Date.now() - entry.savedAt
  );

  if (ageMs > FORECAST_STALE_MS) {
    writeStore({
      version: 2,
      entries: store.entries.filter(
        (candidate) =>
          candidate.key !== key
      ),
    });

    return {
      data: null,
      freshness: "miss",
      ageMs,
    };
  }

  return {
    data: entry.data,
    freshness:
      ageMs <= FORECAST_FRESH_MS
        ? "fresh"
        : "stale",
    ageMs,
  };
}

export function writeForecastCache(
  latitude: number,
  longitude: number,
  timezoneHint: string | undefined,
  data: NormalizedWeatherData
) {
  const key = weatherCacheKey(
    latitude,
    longitude,
    timezoneHint
  );

  const store = readStore();

  writeStore({
    version: 2,
    entries: [
      {
        key,
        savedAt: Date.now(),
        data,
      },
      ...store.entries.filter(
        (entry) => entry.key !== key
      ),
    ].slice(0, MAX_ENTRIES),
  });
}
