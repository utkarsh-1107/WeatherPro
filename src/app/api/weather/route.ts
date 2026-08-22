import {
  NextRequest,
  NextResponse,
} from "next/server";
import type {
  NormalizedWeatherData,
  WeatherProviderId,
} from "@/lib/weather/schema";
import { getWeatherWithFailover } from "@/lib/weather/server/provider-router";
import { fetchWeatherSupplements } from "@/lib/weather/server/supplements";
import { validTimeZone } from "@/lib/weather/server/helpers";

export const revalidate = 300;

const RESPONSE_CACHE_TTL_MS =
  5 * 60 * 1000;

const MAX_MEMORY_CACHE_ENTRIES = 160;

type CacheEntry = {
  expiresAt: number;
  data: NormalizedWeatherData;
  provider: WeatherProviderId;
  fallbackUsed: boolean;
  responseTimeMs: number;
};

const responseCache = new Map<
  string,
  CacheEntry
>();

function validCoordinate(
  value: number,
  min: number,
  max: number
) {
  return (
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function cacheKey(
  latitude: number,
  longitude: number,
  timezone?: string
) {
  // 3-decimal bucketing absorbs normal phone GPS jitter while still
  // representing a location to roughly neighbourhood scale.
  return [
    latitude.toFixed(3),
    longitude.toFixed(3),
    timezone || "",
  ].join("|");
}

function pruneMemoryCache() {
  if (
    responseCache.size <=
    MAX_MEMORY_CACHE_ENTRIES
  ) {
    return;
  }

  const now = Date.now();

  for (const [key, value] of responseCache) {
    if (value.expiresAt <= now) {
      responseCache.delete(key);
    }
  }

  while (
    responseCache.size >
    MAX_MEMORY_CACHE_ENTRIES
  ) {
    const oldestKey =
      responseCache.keys().next().value;

    if (!oldestKey) break;

    responseCache.delete(oldestKey);
  }
}

function responseHeaders({
  provider,
  fallbackUsed,
  cacheStatus,
  responseTimeMs,
}: {
  provider: WeatherProviderId;
  fallbackUsed: boolean;
  cacheStatus: "HIT" | "MISS";
  responseTimeMs: number;
}) {
  return {
    "Cache-Control":
      "public, max-age=60, s-maxage=300, stale-while-revalidate=1800, stale-if-error=21600",
    "X-Weather-Provider": provider,
    "X-Weather-Fallback":
      fallbackUsed ? "1" : "0",
    "X-Weather-Cache": cacheStatus,
    "Server-Timing": `weather;dur=${responseTimeMs}`,
  };
}

export async function GET(
  request: NextRequest
) {
  const latitude = Number(
    request.nextUrl.searchParams.get("lat")
  );

  const longitude = Number(
    request.nextUrl.searchParams.get("lon")
  );

  const timezoneHint = validTimeZone(
    request.nextUrl.searchParams.get("timezone") ||
      undefined
  );

  if (
    !validCoordinate(latitude, -90, 90) ||
    !validCoordinate(
      longitude,
      -180,
      180
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid coordinates.",
      },
      {
        status: 400,
      }
    );
  }

  const key = cacheKey(
    latitude,
    longitude,
    timezoneHint
  );

  const cached =
    responseCache.get(key);

  if (
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return NextResponse.json(
      cached.data,
      {
        headers: responseHeaders({
          provider:
            cached.provider,
          fallbackUsed:
            cached.fallbackUsed,
          cacheStatus: "HIT",
          responseTimeMs: 0,
        }),
      }
    );
  }

  const requestStartedAt =
    performance.now();

  // Optional AQI/history enrichment starts at the same time as the primary
  // forecast so it does not add sequential latency to the normal path.
  type WeatherSupplements =
    Awaited<
      ReturnType<
        typeof fetchWeatherSupplements
      >
    >;

  const supplementsPromise: Promise<WeatherSupplements> =
    fetchWeatherSupplements(
      latitude,
      longitude
    ).catch(
      (
        error
      ): WeatherSupplements => {
        console.warn(
          "[weather] Optional enrichment unavailable.",
          error
        );

        // Every supplement is optional, so an empty object is a valid
        // degraded result. Explicit typing prevents TypeScript from
        // widening this promise to `WeatherSupplements | {}`.
        return {};
      }
    );

  try {
    const forecast =
      await getWeatherWithFailover({
        latitude,
        longitude,
        timezoneHint,
      });

    const supplements =
      await supplementsPromise;

    const data: NormalizedWeatherData = {
      ...forecast.data,

      // MET timestamps are UTC. When the client did not provide a target
      // timezone, the cached AQI response gives us Open-Meteo's coordinate
      // timezone without coupling React components to Open-Meteo JSON.
      timezone:
        forecast.data.timezone === "UTC" &&
        supplements.timezone
          ? supplements.timezone
          : forecast.data.timezone,

      airQuality:
        supplements.airQuality ||
        forecast.data.airQuality,

      historical:
        supplements.historical ||
        forecast.data.historical,
    };

    const totalResponseTimeMs =
      Math.round(
        performance.now() -
          requestStartedAt
      );

    responseCache.set(key, {
      expiresAt:
        Date.now() +
        RESPONSE_CACHE_TTL_MS,
      data,
      provider: forecast.provider,
      fallbackUsed:
        forecast.fallbackUsed,
      responseTimeMs:
        totalResponseTimeMs,
    });

    pruneMemoryCache();

    return NextResponse.json(data, {
      headers: responseHeaders({
        provider: forecast.provider,
        fallbackUsed:
          forecast.fallbackUsed,
        cacheStatus: "MISS",
        responseTimeMs:
          totalResponseTimeMs,
      }),
    });
  } catch (error) {
    console.error(
      "[weather] All forecast providers unavailable.",
      error
    );

    return NextResponse.json(
      {
        error:
          "Weather service temporarily unavailable.",
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
