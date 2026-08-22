import { NextRequest, NextResponse } from "next/server";

type BoundsRequest = {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom?: number;
  hourOffset?: number;
};

type GridPoint = {
  lat: number;
  lon: number;
};

type IndexedResult = {
  originalIndex: number;
  item: any;
};

const BATCH_SIZE = 30;
const MAX_CONCURRENT_BATCHES = 3;
const UPSTREAM_TIMEOUT_MS = 8000;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// A world-scale viewport spans vastly more atmosphere than a city viewport.
// Use MORE samples when zoomed out and progressively fewer samples as the
// visible geographic area becomes smaller.
//
// This mirrors the core idea behind tiled weather products: resolution adapts
// to map scale instead of stretching a handful of samples across the globe.
function getGridSize(zoom: number) {
  if (zoom < 3) return { columns: 18, rows: 10 }; // 180 samples: near-global
  if (zoom < 5) return { columns: 16, rows: 9 };  // 144 samples: continental
  if (zoom < 7) return { columns: 14, rows: 8 };  // 112 samples: large region
  if (zoom < 10) return { columns: 12, rows: 7 }; // 84 samples: regional
  return { columns: 10, rows: 6 };                // 60 samples: city/local
}

function mercatorY(latitude: number) {
  const clamped = clamp(latitude, -85, 85);
  const radians = (clamped * Math.PI) / 180;

  return Math.log(
    Math.tan(Math.PI / 4 + radians / 2)
  );
}

function latitudeFromMercatorY(value: number) {
  return (
    (2 * Math.atan(Math.exp(value)) - Math.PI / 2) *
    (180 / Math.PI)
  );
}

function buildCoordinates(
  west: number,
  south: number,
  east: number,
  north: number,
  zoom: number
) {
  const { columns, rows } = getGridSize(zoom);

  const minLat = Math.min(south, north);
  const maxLat = Math.max(south, north);

  // Sample rows uniformly in Web Mercator rather than linearly in latitude.
  // That keeps sample density visually even on a MapLibre world map.
  const southY = mercatorY(minLat);
  const northY = mercatorY(maxLat);
  const ySpan = Math.max(0.000001, northY - southY);

  let lonSpan = east - west;
  if (lonSpan <= 0) lonSpan += 360;

  const coordinates: GridPoint[] = [];

  for (let row = 0; row < rows; row += 1) {
    const mercator =
      southY + (ySpan * row) / Math.max(1, rows - 1);
    const lat = latitudeFromMercatorY(mercator);

    for (let column = 0; column < columns; column += 1) {
      let lon =
        west + (lonSpan * column) / Math.max(1, columns - 1);

      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;

      coordinates.push({ lat, lon });
    }
  }

  return coordinates;
}

function chunkCoordinates(
  coordinates: GridPoint[]
) {
  const batches: Array<
    Array<GridPoint & { originalIndex: number }>
  > = [];

  for (
    let index = 0;
    index < coordinates.length;
    index += BATCH_SIZE
  ) {
    batches.push(
      coordinates
        .slice(index, index + BATCH_SIZE)
        .map((point, offset) => ({
          ...point,
          originalIndex: index + offset,
        }))
    );
  }

  return batches;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(
  url: string,
  attempts = 2
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      UPSTREAM_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });

      const contentType =
        response.headers.get("content-type") || "";

      if (!response.ok) {
        const detail = await response.text();

        throw new Error(
          `Open-Meteo ${response.status}: ${detail.slice(0, 160)}`
        );
      }

      if (
        !contentType.toLowerCase().includes("application/json")
      ) {
        const detail = await response.text();

        throw new Error(
          `Open-Meteo returned ${
            contentType || "unknown content type"
          }: ${detail.slice(0, 160)}`
        );
      }

      return await response.json();
    } catch (error) {
      lastError = error;

      if (attempt < attempts - 1) {
        await delay(250 * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Open-Meteo request failed.");
}

function findHourlyIndex(
  item: any,
  hourOffset: number
) {
  const times = Array.isArray(item?.hourly?.time)
    ? item.hourly.time
    : [];

  if (!times.length) return -1;

  const currentTime = String(item?.current?.time || "");
  const currentHour = currentTime.slice(0, 13);

  let index = times.findIndex((time: string) =>
    String(time).startsWith(currentHour)
  );

  if (index < 0) index = 0;

  return Math.min(
    times.length - 1,
    index + hourOffset
  );
}

async function loadBatches(
  coordinates: GridPoint[]
) {
  const batches = chunkCoordinates(coordinates);

  const fetchBatch = async (
    batch: Array<GridPoint & { originalIndex: number }>
  ) => {
    const latitude = batch
      .map((point) => point.lat.toFixed(4))
      .join(",");

    const longitude = batch
      .map((point) => point.lon.toFixed(4))
      .join(",");

    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(latitude)}` +
      `&longitude=${encodeURIComponent(longitude)}` +
      "&current=temperature_2m" +
      "&hourly=" +
      [
        "temperature_2m",
        "precipitation",
        "precipitation_probability",
        "cloud_cover",
        "wind_speed_10m",
        "wind_direction_10m",
      ].join(",") +
      "&forecast_hours=13" +
      "&cell_selection=nearest" +
      "&timezone=auto";

    const payload = await fetchJsonWithRetry(url);
    const providerResults = Array.isArray(payload)
      ? payload
      : [payload];

    return batch
      .map(
        (
          point,
          index
        ): IndexedResult | null => {
          const item = providerResults[index];

          if (!item) return null;

          return {
            originalIndex: point.originalIndex,
            item,
          };
        }
      )
      .filter(
        (entry): entry is IndexedResult =>
          Boolean(entry)
      );
  };

  const settled: PromiseSettledResult<IndexedResult[]>[] = [];

  // Limit concurrency so a world view remains fast without hammering the
  // upstream provider with six simultaneous requests.
  for (
    let index = 0;
    index < batches.length;
    index += MAX_CONCURRENT_BATCHES
  ) {
    const group = batches.slice(
      index,
      index + MAX_CONCURRENT_BATCHES
    );

    const groupResults = await Promise.allSettled(
      group.map((batch) => fetchBatch(batch))
    );

    settled.push(...groupResults);
  }

  const batchFailures = settled.filter(
    (result) => result.status === "rejected"
  ).length;

  const entries = settled
    .flatMap((result) =>
      result.status === "fulfilled"
        ? result.value
        : []
    )
    .filter(
      (entry) =>
        Number.isInteger(entry.originalIndex) &&
        entry.originalIndex >= 0 &&
        entry.originalIndex < coordinates.length
    )
    .sort(
      (a, b) =>
        a.originalIndex - b.originalIndex
    );

  return {
    batches,
    entries,
    batchFailures,
  };
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request.json()) as Partial<BoundsRequest>;

    if (
      !finite(body.west) ||
      !finite(body.south) ||
      !finite(body.east) ||
      !finite(body.north)
    ) {
      return NextResponse.json(
        { error: "Invalid map bounds." },
        { status: 400 }
      );
    }

    const west = clamp(body.west, -180, 180);
    const east = clamp(body.east, -180, 180);
    const south = clamp(body.south, -85, 85);
    const north = clamp(body.north, -85, 85);
    const zoom = clamp(
      finite(body.zoom) ? body.zoom : 6,
      2,
      18
    );
    const hourOffset = clamp(
      Math.round(
        finite(body.hourOffset)
          ? body.hourOffset
          : 0
      ),
      0,
      12
    );

    const coordinates = buildCoordinates(
      west,
      south,
      east,
      north,
      zoom
    );

    const {
      batches,
      entries,
      batchFailures,
    } = await loadBatches(coordinates);

    if (!entries.length) {
      return NextResponse.json(
        {
          error:
            "All upstream weather-layer batches failed.",
          requestedSampleCount: coordinates.length,
          returnedSampleCount: 0,
          batchCount: batches.length,
          successfulBatches: 0,
          batchFailures,
          partial: true,
        },
        { status: 502 }
      );
    }

    let targetTime: string | undefined;

    const points = entries
      .map(({ item, originalIndex }) => {
        const coordinate =
          coordinates[originalIndex];

        if (!coordinate) return null;

        const hourlyIndex = findHourlyIndex(
          item,
          hourOffset
        );

        if (hourlyIndex < 0) return null;

        const hourly = item?.hourly ?? {};
        const times = Array.isArray(hourly.time)
          ? hourly.time
          : [];

        const temperature =
          hourly.temperature_2m?.[hourlyIndex];
        const precipitation =
          hourly.precipitation?.[hourlyIndex];
        const probability =
          hourly.precipitation_probability?.[
            hourlyIndex
          ];
        const cloudCover =
          hourly.cloud_cover?.[hourlyIndex];
        const windSpeed =
          hourly.wind_speed_10m?.[hourlyIndex];
        const windDirection =
          hourly.wind_direction_10m?.[
            hourlyIndex
          ];

        if (
          !targetTime &&
          times[hourlyIndex]
        ) {
          targetTime = String(
            times[hourlyIndex]
          );
        }

        if (
          !finite(temperature) ||
          !finite(cloudCover) ||
          !finite(windSpeed) ||
          !finite(windDirection)
        ) {
          return null;
        }

        return {
          lat: coordinate.lat,
          lon: coordinate.lon,
          temperature,
          precipitation:
            finite(precipitation)
              ? precipitation
              : 0,
          probability:
            finite(probability)
              ? probability
              : 0,
          cloudCover,
          windSpeed,
          windDirection,
        };
      })
      .filter(
        (
          point
        ): point is {
          lat: number;
          lon: number;
          temperature: number;
          precipitation: number;
          probability: number;
          cloudCover: number;
          windSpeed: number;
          windDirection: number;
        } => Boolean(point)
      );

    if (!points.length) {
      return NextResponse.json(
        {
          error:
            "Weather-layer provider returned no usable samples.",
          requestedSampleCount: coordinates.length,
          returnedSampleCount: 0,
          batchCount: batches.length,
          successfulBatches:
            batches.length - batchFailures,
          batchFailures,
          partial: true,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        points,
        targetTime,
        hourOffset,
        sampleCount: coordinates.length,
        requestedSampleCount:
          coordinates.length,
        returnedSampleCount: points.length,
        grid: getGridSize(zoom),
        zoom,
        batchCount: batches.length,
        successfulBatches:
          batches.length - batchFailures,
        batchFailures,
        partial:
          batchFailures > 0 ||
          points.length < coordinates.length,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=120, s-maxage=300, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.warn(
      "Combined weather-layer API failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Unable to generate weather layers.",
      },
      { status: 502 }
    );
  }
}
