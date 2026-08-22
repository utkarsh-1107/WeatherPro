import type {
  ComprehensiveWeatherData,
  HourlyWeatherPoint,
  HistoricalComparison,
  NormalizedWeatherData,
} from "./weather/schema";
import {
  readForecastCache,
  weatherCacheKey,
  writeForecastCache,
  type WeatherCacheFreshness,
} from "./weather/client-cache";

export type {
  ComprehensiveWeatherData,
  HourlyWeatherPoint,
  HistoricalComparison,
  NormalizedWeatherData,
  WeatherProviderId,
  WeatherSourceMetadata,
} from "./weather/schema";

async function readJsonResponse<T>(
  response: Response,
  label: string
): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed (${response.status}): ${body.slice(0, 200)}`);
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    const body = await response.text();
    throw new Error(
      `${label} returned ${contentType || "an unknown content type"} instead of JSON: ${body.slice(0, 200)}`
    );
  }

  return (await response.json()) as T;
}

type NominatimAddress = {
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city_district?: string;
  borough?: string;
  residential?: string;
  hamlet?: string;
  village?: string;
  town?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state_district?: string;
  state?: string;
  country?: string;
};

type NominatimSearchResult = {
  lat: string;
  lon: string;
  display_name?: string;
  address?: NominatimAddress;
};

type NominatimReverseResult = {
  display_name?: string;
  address?: NominatimAddress;
};

export async function getCoordinates(city: string) {
  const url =
    "https://nominatim.openstreetmap.org/search" +
    `?format=json&q=${encodeURIComponent(city)}&limit=1&addressdetails=1`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  const data = await readJsonResponse<NominatimSearchResult[]>(res, "Location search");

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("City not found.");
  }

  const lat = Number.parseFloat(data[0].lat);
  const lon = Number.parseFloat(data[0].lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("The location service returned invalid coordinates.");
  }

  return {
    lat,
    lon,
    name: data[0].display_name?.split(",")[0]?.trim() || city,
    country: data[0].address?.country || "",
  };
}

export async function reverseGeocode(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid coordinates supplied for reverse geocoding.");
  }

  const url =
    "https://nominatim.openstreetmap.org/reverse" +
    `?format=json&lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}` +
    `&zoom=18&addressdetails=1`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  const data = await readJsonResponse<NominatimReverseResult>(res, "Reverse geocoding");
  const address = data.address ?? {};

  // Keep zoom=18 for detailed address data, but choose a user-friendly
  // locality for the main label rather than blindly showing the closest object.
  const neighbourhood =
    address.neighbourhood ||
    address.residential ||
    address.quarter ||
    address.hamlet ||
    "";

  const locality =
    address.suburb ||
    address.city_district ||
    address.borough ||
    address.village ||
    address.town ||
    address.neighbourhood ||
    address.residential ||
    "";

  const city =
    address.city ||
    address.town ||
    address.municipality ||
    address.county ||
    address.state_district ||
    "";

  const displayParts = [locality, city]
    .filter((value): value is string => Boolean(value))
    .filter(
      (value, index, array) =>
        array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index
    );

  const coordinates = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

  const name =
    displayParts.join(", ") ||
    data.display_name?.split(",").slice(0, 2).join(",").trim() ||
    `Your Location · ${coordinates}`;

  return {
    lat,
    lon,
    name,
    neighbourhood,
    locality,
    localArea: locality,
    city,
    state: address.state || "",
    country: address.country || "",
    coordinates,
    fullName: data.display_name || name,
  };
}

function isNetworkFetchError(error: unknown) {
  return (
    (error instanceof TypeError &&
      /failed to fetch|networkerror|load failed|fetch failed/i.test(
        error.message
      )) ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchResponseWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  attempts = 2,
  timeoutMs = 10000
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;

      const retryable =
        isNetworkFetchError(error) ||
        (error instanceof DOMException &&
          error.name === "AbortError");

      if (!retryable || attempt >= attempts - 1) {
        throw error;
      }

      await delay(350 * (attempt + 1));
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Network request failed.");
}

const inFlightWeatherRequests = new Map<
  string,
  Promise<
    Omit<
      ComprehensiveWeatherData,
      "cityName"
    >
  >
>();

export type WeatherSWRRequest = {
  cached:
    | Omit<
        ComprehensiveWeatherData,
        "cityName"
      >
    | null;
  cacheState: WeatherCacheFreshness;
  ageMs: number | null;
  fresh: Promise<
    Omit<
      ComprehensiveWeatherData,
      "cityName"
    >
  >;
};

export async function getFullWeatherData(
  lat: number,
  lon: number,
  timezoneHint?: string
): Promise<
  Omit<
    ComprehensiveWeatherData,
    "cityName"
  >
> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    throw new Error(
      "Invalid coordinates supplied to weather API."
    );
  }

  const key = weatherCacheKey(
    lat,
    lon,
    timezoneHint
  );

  const pending =
    inFlightWeatherRequests.get(key);

  if (pending) {
    return pending;
  }

  const request = (async () => {
    const params =
      new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
      });

    if (timezoneHint) {
      params.set(
        "timezone",
        timezoneHint
      );
    }

    const response =
      await fetchResponseWithRetry(
        `/api/weather?${params.toString()}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        },
        2,
        9000
      );

    const data =
      await readJsonResponse<
        Omit<
          ComprehensiveWeatherData,
          "cityName"
        >
      >(
        response,
        "Weather API"
      );

    writeForecastCache(
      lat,
      lon,
      timezoneHint,
      data
    );

    return data;
  })();

  inFlightWeatherRequests.set(
    key,
    request
  );

  try {
    return await request;
  } finally {
    if (
      inFlightWeatherRequests.get(key) ===
      request
    ) {
      inFlightWeatherRequests.delete(key);
    }
  }
}

export function startWeatherSWR(
  lat: number,
  lon: number,
  timezoneHint?: string
): WeatherSWRRequest {
  const cached = readForecastCache(
    lat,
    lon,
    timezoneHint
  );

  return {
    cached: cached.data,
    cacheState: cached.freshness,
    ageMs: cached.ageMs,
    fresh: getFullWeatherData(
      lat,
      lon,
      timezoneHint
    ),
  };
}

export async function prefetchWeatherData(
  lat: number,
  lon: number,
  timezoneHint?: string
) {
  const cached = readForecastCache(
    lat,
    lon,
    timezoneHint
  );

  if (
    cached.freshness === "fresh" &&
    cached.data
  ) {
    return cached.data;
  }

  return getFullWeatherData(
    lat,
    lon,
    timezoneHint
  );
}

export function cToF(value: number) {
  return value * (9 / 5) + 32;
}

export function kmhToMph(value: number) {
  return value * 0.621371;
}

export function hpaToMmhg(value: number) {
  return value * 0.750062;
}

export function getWindDirectionLabel(degrees: number) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return directions[index];
}
