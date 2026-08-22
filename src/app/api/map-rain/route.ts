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

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getGridSize(zoom: number) {
  if (zoom < 4) return { columns: 6, rows: 4 };
  if (zoom < 7) return { columns: 8, rows: 5 };
  return { columns: 10, rows: 7 };
}

function buildCoordinates(
  west: number,
  south: number,
  east: number,
  north: number,
  zoom: number
): GridPoint[] {
  const { columns, rows } = getGridSize(zoom);

  const minLat = Math.min(south, north);
  const maxLat = Math.max(south, north);
  const latSpan = Math.max(0.0001, maxLat - minLat);

  let lonSpan = east - west;
  if (lonSpan <= 0) lonSpan += 360;

  const coordinates: GridPoint[] = [];

  for (let row = 0; row < rows; row += 1) {
    const lat = minLat + (latSpan * row) / Math.max(1, rows - 1);

    for (let column = 0; column < columns; column += 1) {
      let lon = west + (lonSpan * column) / Math.max(1, columns - 1);

      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;

      coordinates.push({ lat, lon });
    }
  }

  return coordinates;
}

function findHourlyIndex(item: any, hourOffset: number) {
  const times = Array.isArray(item?.hourly?.time) ? item.hourly.time : [];

  if (!times.length) return -1;

  const currentTime = String(item?.current?.time || "");
  const currentHour = currentTime.slice(0, 13);

  let currentIndex = times.findIndex((time: string) =>
    String(time).startsWith(currentHour)
  );

  // If the provider omitted current time for some reason, use the first
  // forecast hour rather than failing the entire sample.
  if (currentIndex < 0) currentIndex = 0;

  return Math.min(times.length - 1, currentIndex + hourOffset);
}

const OPEN_METEO_BATCH_SIZE = 20;
const UPSTREAM_TIMEOUT_MS = 9000;

function chunkCoordinates(
  coordinates: GridPoint[],
  size = OPEN_METEO_BATCH_SIZE
) {
  const batches: Array<
    Array<GridPoint & { originalIndex: number }>
  > = [];

  for (let index = 0; index < coordinates.length; index += size) {
    batches.push(
      coordinates
        .slice(index, index + size)
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
): Promise<any> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      UPSTREAM_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";

      if (!response.ok) {
        const detail = await response.text();

        throw new Error(
          `Open-Meteo ${response.status}: ${detail.slice(0, 160)}`
        );
      }

      if (!contentType.toLowerCase().includes("application/json")) {
        const detail = await response.text();

        throw new Error(
          `Open-Meteo returned ${contentType || "unknown content type"}: ${detail.slice(
            0,
            160
          )}`
        );
      }

      return await response.json();
    } catch (error) {
      lastError = error;

      if (attempt < attempts - 1) {
        await delay(300 * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Open-Meteo request failed.");
}

function buildBatchUrl(
  endpoint: string,
  batch: Array<GridPoint & { originalIndex: number }>,
  currentVariables: string,
  hourlyVariables: string
) {
  const latitude = batch
    .map((point) => point.lat.toFixed(4))
    .join(",");

  const longitude = batch
    .map((point) => point.lon.toFixed(4))
    .join(",");

  return (
    endpoint +
    `?latitude=${encodeURIComponent(latitude)}` +
    `&longitude=${encodeURIComponent(longitude)}` +
    `&current=${encodeURIComponent(currentVariables)}` +
    `&hourly=${encodeURIComponent(hourlyVariables)}` +
    "&forecast_days=2" +
    "&timezone=auto"
  );
}

async function loadBatches(
  coordinates: GridPoint[],
  endpoint: string,
  currentVariables: string,
  hourlyVariables: string
) {
  const batches = chunkCoordinates(coordinates);

  const settled = await Promise.allSettled(
    batches.map(async (batch) => {
      const url = buildBatchUrl(
        endpoint,
        batch,
        currentVariables,
        hourlyVariables
      );

      const payload = await fetchJsonWithRetry(url);
      const providerResults = Array.isArray(payload)
        ? payload
        : [payload];

      return batch
        .map(
          (point, index): IndexedResult | null => {
            const item = providerResults[index];

            if (!item) return null;

            return {
              originalIndex: point.originalIndex,
              item,
            };
          }
        )
        .filter(
          (entry): entry is IndexedResult => Boolean(entry)
        );
    })
  );

  const batchFailures = settled.filter(
    (result) => result.status === "rejected"
  ).length;

  const entries = settled
    .flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    )
    .filter(
      (entry) =>
        Number.isInteger(entry.originalIndex) &&
        entry.originalIndex >= 0 &&
        entry.originalIndex < coordinates.length
    )
    .sort((a, b) => a.originalIndex - b.originalIndex);

  return {
    batches,
    entries,
    batchFailures,
  };
}

function responseMetadata(
  coordinates: GridPoint[],
  batches: unknown[],
  batchFailures: number,
  returnedSampleCount: number,
  zoom: number
) {
  return {
    sampleCount: coordinates.length,
    requestedSampleCount: coordinates.length,
    returnedSampleCount,
    grid: getGridSize(zoom),
    zoom,
    batchCount: batches.length,
    successfulBatches: batches.length - batchFailures,
    batchFailures,
    partial:
      batchFailures > 0 ||
      returnedSampleCount < coordinates.length,
    generatedAt: new Date().toISOString(),
  };
}

function validateRequest(body: Partial<BoundsRequest>) {
  if (
    !finite(body.west) ||
    !finite(body.south) ||
    !finite(body.east) ||
    !finite(body.north)
  ) {
    return null;
  }

  return {
    west: clamp(body.west, -180, 180),
    east: clamp(body.east, -180, 180),
    south: clamp(body.south, -85, 85),
    north: clamp(body.north, -85, 85),
    zoom: clamp(finite(body.zoom) ? body.zoom : 6, 2, 18),
    hourOffset: clamp(
      Math.round(finite(body.hourOffset) ? body.hourOffset : 0),
      0,
      12
    ),
  };
}

const RESPONSE_HEADERS = {
  "Cache-Control":
    "public, max-age=120, s-maxage=300, stale-while-revalidate=300",
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<BoundsRequest>;
    const parsed = validateRequest(body);

    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid map bounds." },
        { status: 400 }
      );
    }

    const { west, east, south, north, zoom, hourOffset } = parsed;
    const coordinates = buildCoordinates(
      west,
      south,
      east,
      north,
      zoom
    );

    const { batches, entries, batchFailures } = await loadBatches(
      coordinates,
      "https://api.open-meteo.com/v1/forecast",
      // precipitation_probability is hourly-only, so do not request it
      // as a current variable.
      "precipitation",
      "precipitation,precipitation_probability"
    );

    let targetTime: string | undefined;

    const points = entries
      .map(({ item, originalIndex }) => {
        const coordinate = coordinates[originalIndex];

        if (!coordinate) return null;

        const hourlyIndex = findHourlyIndex(item, hourOffset);
        const precipitationValues = Array.isArray(
          item?.hourly?.precipitation
        )
          ? item.hourly.precipitation
          : [];

        const probabilityValues = Array.isArray(
          item?.hourly?.precipitation_probability
        )
          ? item.hourly.precipitation_probability
          : [];

        const times = Array.isArray(item?.hourly?.time)
          ? item.hourly.time
          : [];

        const precipitation =
          typeof precipitationValues[hourlyIndex] === "number"
            ? precipitationValues[hourlyIndex]
            : 0;

        const probability =
          typeof probabilityValues[hourlyIndex] === "number"
            ? probabilityValues[hourlyIndex]
            : 0;

        if (
          !targetTime &&
          hourlyIndex >= 0 &&
          times[hourlyIndex]
        ) {
          targetTime = String(times[hourlyIndex]);
        }

        return {
          lat: coordinate.lat,
          lon: coordinate.lon,
          precipitation,
          probability,
        };
      })
      .filter(
        (
          point
        ): point is {
          lat: number;
          lon: number;
          precipitation: number;
          probability: number;
        } => Boolean(point)
      );

    if (!points.length) {
      return NextResponse.json(
        {
          error: "Rain overlay has no usable samples.",
          ...responseMetadata(
            coordinates,
            batches,
            batchFailures,
            0,
            zoom
          ),
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        points,
        targetTime,
        hourOffset,
        ...responseMetadata(
          coordinates,
          batches,
          batchFailures,
          points.length,
          zoom
        ),
      },
      { headers: RESPONSE_HEADERS }
    );
  } catch (error) {
    console.warn("Map rain API failed:", error);

    return NextResponse.json(
      { error: "Unable to generate rain map." },
      { status: 502 }
    );
  }
}
