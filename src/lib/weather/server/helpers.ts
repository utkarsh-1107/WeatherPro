type NextFetchInit = RequestInit & {
  next?: {
    revalidate?: number;
  };
};

export function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(max, Math.max(min, value));
}

export function asNumber(
  value: unknown,
  fallback = 0
) {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : fallback;
}

export function roundCoordinate(value: number) {
  // MET Norway asks clients not to use more than four decimal places.
  // Three decimals also improves cache reuse for normal phone GPS jitter.
  return Number(value.toFixed(3));
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  {
    timeoutMs,
    revalidateSeconds,
    headers,
  }: {
    timeoutMs: number;
    revalidateSeconds: number;
    headers?: HeadersInit;
  }
): Promise<{
  payload: T;
  headers: Headers;
}> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const init: NextFetchInit = {
      headers: {
        Accept: "application/json",
        ...headers,
      },
      signal: controller.signal,
      next: {
        revalidate: revalidateSeconds,
      },
    };

    const response = await fetch(url, init);
    const contentType =
      response.headers.get("content-type") || "";

    if (!response.ok) {
      const body = await response.text();

      throw new Error(
        `HTTP ${response.status}: ${body.slice(0, 180)}`
      );
    }

    if (
      !contentType
        .toLowerCase()
        .includes("application/json")
    ) {
      const body = await response.text();

      throw new Error(
        `Expected JSON but received ${
          contentType || "unknown content type"
        }: ${body.slice(0, 180)}`
      );
    }

    return {
      payload: (await response.json()) as T,
      headers: response.headers,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function validTimeZone(value?: string) {
  if (!value) return undefined;

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).format(new Date());

    return value;
  } catch {
    return undefined;
  }
}

export function localDateKey(
  isoTime: string,
  timezone?: string
) {
  const date = new Date(isoTime);

  if (
    Number.isNaN(date.getTime()) ||
    !timezone
  ) {
    return isoTime.slice(0, 10);
  }

  try {
    const parts = new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    ).formatToParts(date);

    const lookup = Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ])
    );

    return `${lookup.year}-${lookup.month}-${lookup.day}`;
  } catch {
    return isoTime.slice(0, 10);
  }
}

export function apparentTemperatureC(
  temperatureC: number,
  relativeHumidity: number,
  windSpeedKmh: number
) {
  // Wind chill for cool conditions.
  if (
    temperatureC <= 10 &&
    windSpeedKmh > 4.8
  ) {
    const windPower = Math.pow(
      windSpeedKmh,
      0.16
    );

    return (
      13.12 +
      0.6215 * temperatureC -
      11.37 * windPower +
      0.3965 *
        temperatureC *
        windPower
    );
  }

  // NOAA/Rothfusz heat-index approximation for hot/humid conditions.
  if (
    temperatureC >= 27 &&
    relativeHumidity >= 40
  ) {
    const fahrenheit =
      temperatureC * (9 / 5) + 32;

    const heatIndexF =
      -42.379 +
      2.04901523 * fahrenheit +
      10.14333127 * relativeHumidity -
      0.22475541 *
        fahrenheit *
        relativeHumidity -
      0.00683783 *
        fahrenheit *
        fahrenheit -
      0.05481717 *
        relativeHumidity *
        relativeHumidity +
      0.00122874 *
        fahrenheit *
        fahrenheit *
        relativeHumidity +
      0.00085282 *
        fahrenheit *
        relativeHumidity *
        relativeHumidity -
      0.00000199 *
        fahrenheit *
        fahrenheit *
        relativeHumidity *
        relativeHumidity;

    return (heatIndexF - 32) * (5 / 9);
  }

  return temperatureC;
}

// NOAA sunrise/sunset algorithm. This keeps sunrise/sunset available when
// MET Norway is the primary forecast source without introducing another
// blocking API request.
function calculateSunEventUtc(
  dateKey: string,
  latitude: number,
  longitude: number,
  sunrise: boolean
) {
  const date = new Date(
    `${dateKey}T12:00:00Z`
  );

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const startOfYear = Date.UTC(
    date.getUTCFullYear(),
    0,
    0
  );

  const dayOfYear = Math.floor(
    (date.getTime() - startOfYear) /
      86400000
  );

  const lngHour = longitude / 15;
  const approximateTime =
    dayOfYear +
    ((sunrise ? 6 : 18) - lngHour) /
      24;

  const meanAnomaly =
    0.9856 * approximateTime -
    3.289;

  let trueLongitude =
    meanAnomaly +
    1.916 *
      Math.sin(
        (Math.PI / 180) * meanAnomaly
      ) +
    0.02 *
      Math.sin(
        (Math.PI / 180) *
          2 *
          meanAnomaly
      ) +
    282.634;

  trueLongitude =
    ((trueLongitude % 360) + 360) %
    360;

  let rightAscension =
    (180 / Math.PI) *
    Math.atan(
      0.91764 *
        Math.tan(
          (Math.PI / 180) *
            trueLongitude
        )
    );

  rightAscension =
    ((rightAscension % 360) + 360) %
    360;

  const longitudeQuadrant =
    Math.floor(trueLongitude / 90) * 90;

  const rightAscensionQuadrant =
    Math.floor(rightAscension / 90) *
    90;

  rightAscension +=
    longitudeQuadrant -
    rightAscensionQuadrant;

  rightAscension /= 15;

  const sinDeclination =
    0.39782 *
    Math.sin(
      (Math.PI / 180) *
        trueLongitude
    );

  const cosDeclination = Math.cos(
    Math.asin(sinDeclination)
  );

  const cosHourAngle =
    (Math.cos(
      (Math.PI / 180) * 90.833
    ) -
      sinDeclination *
        Math.sin(
          (Math.PI / 180) * latitude
        )) /
    (cosDeclination *
      Math.cos(
        (Math.PI / 180) * latitude
      ));

  if (
    cosHourAngle > 1 ||
    cosHourAngle < -1
  ) {
    // Polar night / midnight sun.
    return "";
  }

  let hourAngle = sunrise
    ? 360 -
      (180 / Math.PI) *
        Math.acos(cosHourAngle)
    : (180 / Math.PI) *
      Math.acos(cosHourAngle);

  hourAngle /= 15;

  const localMeanTime =
    hourAngle +
    rightAscension -
    0.06571 * approximateTime -
    6.622;

  let utcHour =
    localMeanTime - lngHour;

  utcHour =
    ((utcHour % 24) + 24) % 24;

  const event = new Date(
    `${dateKey}T00:00:00Z`
  );

  event.setUTCSeconds(
    Math.round(utcHour * 3600)
  );

  return event.toISOString();
}

export function sunriseSunsetForDate(
  dateKey: string,
  latitude: number,
  longitude: number
) {
  return {
    sunrise: calculateSunEventUtc(
      dateKey,
      latitude,
      longitude,
      true
    ),
    sunset: calculateSunEventUtc(
      dateKey,
      latitude,
      longitude,
      false
    ),
  };
}
