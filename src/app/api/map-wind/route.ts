import {
  NextRequest,
  NextResponse,
} from "next/server";

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

type WindPoint = {
  lat: number;
  lon: number;
  speed: number;
  direction: number;
  time: string | null;
};

const BATCH_SIZE = 8;
const MAX_BATCH_CONCURRENCY = 2;
const MAX_POINT_CONCURRENCY = 4;
const UPSTREAM_TIMEOUT_MS = 6000;

function finite(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function getGridSize(zoom: number) {
  // Wind is smooth. Reliability is more important than a dense sample mesh.
  if (zoom < 4) {
    return {
      columns: 4,
      rows: 3,
    }; // 12
  }

  if (zoom < 7) {
    return {
      columns: 5,
      rows: 4,
    }; // 20
  }

  if (zoom < 10) {
    return {
      columns: 6,
      rows: 4,
    }; // 24
  }

  return {
    columns: 7,
    rows: 4,
  }; // 28
}

function mercatorY(
  latitude: number
) {
  const clamped =
    clamp(latitude, -85, 85);

  const radians =
    (clamped * Math.PI) / 180;

  return Math.log(
    Math.tan(
      Math.PI / 4 +
        radians / 2
    )
  );
}

function latitudeFromMercatorY(
  value: number
) {
  return (
    (
      2 *
        Math.atan(
          Math.exp(value)
        ) -
      Math.PI / 2
    ) *
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
  const {
    columns,
    rows,
  } = getGridSize(zoom);

  const minLat =
    Math.min(south, north);

  const maxLat =
    Math.max(south, north);

  const southY =
    mercatorY(minLat);

  const northY =
    mercatorY(maxLat);

  const ySpan = Math.max(
    0.000001,
    northY - southY
  );

  let lonSpan =
    east - west;

  if (lonSpan <= 0) {
    lonSpan += 360;
  }

  const coordinates:
    GridPoint[] = [];

  for (
    let row = 0;
    row < rows;
    row += 1
  ) {
    const mercator =
      southY +
      (ySpan * row) /
        Math.max(
          1,
          rows - 1
        );

    const lat =
      latitudeFromMercatorY(
        mercator
      );

    for (
      let column = 0;
      column < columns;
      column += 1
    ) {
      let lon =
        west +
        (lonSpan * column) /
          Math.max(
            1,
            columns - 1
          );

      while (lon > 180) {
        lon -= 360;
      }

      while (lon < -180) {
        lon += 360;
      }

      coordinates.push({
        lat,
        lon,
      });
    }
  }

  return coordinates;
}

async function sleep(
  ms: number
) {
  await new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

async function fetchJson(
  url: string,
  attempts = 2
) {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        UPSTREAM_TIMEOUT_MS
      );

    try {
      const response =
        await fetch(url, {
          headers: {
            Accept:
              "application/json",
          },
          cache: "no-store",
          signal:
            controller.signal,
        });

      const text =
        await response.text();

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${text.slice(
            0,
            180
          )}`
        );
      }

      const contentType =
        response.headers.get(
          "content-type"
        ) || "";

      if (
        !contentType
          .toLowerCase()
          .includes(
            "application/json"
          )
      ) {
        throw new Error(
          `Expected JSON, received ${
            contentType ||
            "unknown"
          }`
        );
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error;

      if (
        attempt <
        attempts - 1
      ) {
        await sleep(
          250 *
            (attempt + 1)
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof
    Error
    ? lastError
    : new Error(
        "Wind upstream request failed."
      );
}

function valueAtOffset(
  item: any,
  coordinate: GridPoint,
  hourOffset: number
): WindPoint | null {
  const times =
    Array.isArray(
      item?.hourly?.time
    )
      ? item.hourly.time
      : [];

  const speeds =
    Array.isArray(
      item?.hourly
        ?.wind_speed_10m
    )
      ? item.hourly
          .wind_speed_10m
      : [];

  const directions =
    Array.isArray(
      item?.hourly
        ?.wind_direction_10m
    )
      ? item.hourly
          .wind_direction_10m
      : [];

  const index =
    Math.min(
      Math.max(
        0,
        hourOffset
      ),
      Math.max(
        0,
        times.length - 1
      )
    );

  const speed =
    speeds[index];

  const direction =
    directions[index];

  if (
    !finite(speed) ||
    !finite(direction)
  ) {
    return null;
  }

  return {
    lat: coordinate.lat,
    lon: coordinate.lon,
    speed,
    direction,
    time:
      times[index] || null,
  };
}

function batchUrl(
  endpoint: string,
  coordinates: GridPoint[],
  useModelParameter: boolean
) {
  const latitudes =
    coordinates
      .map((point) =>
        point.lat.toFixed(4)
      )
      .join(",");

  const longitudes =
    coordinates
      .map((point) =>
        point.lon.toFixed(4)
      )
      .join(",");

  return (
    endpoint +
    `?latitude=${encodeURIComponent(
      latitudes
    )}` +
    `&longitude=${encodeURIComponent(
      longitudes
    )}` +
    "&hourly=wind_speed_10m,wind_direction_10m" +
    "&forecast_hours=13" +
    "&timezone=GMT" +
    "&wind_speed_unit=kmh" +
    "&cell_selection=nearest" +
    (
      useModelParameter
        ? "&models=gfs_seamless"
        : ""
    )
  );
}

async function fetchBatch(
  coordinates: GridPoint[],
  hourOffset: number
) {
  const errors: string[] = [];

  const endpoints = [
    {
      url: batchUrl(
        "https://api.open-meteo.com/v1/gfs",
        coordinates,
        false
      ),
      label: "gfs",
    },
    {
      url: batchUrl(
        "https://api.open-meteo.com/v1/forecast",
        coordinates,
        true
      ),
      label:
        "forecast:gfs_seamless",
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const payload =
        await fetchJson(
          endpoint.url
        );

      const items =
        Array.isArray(payload)
          ? payload
          : [payload];

      const points =
        coordinates
          .map(
            (
              coordinate,
              index
            ) =>
              valueAtOffset(
                items[index],
                coordinate,
                hourOffset
              )
          )
          .filter(
            (
              point
            ): point is WindPoint =>
              Boolean(point)
          );

      if (points.length) {
        return {
          points,
          provider:
            endpoint.label,
          errors,
        };
      }

      errors.push(
        `${endpoint.label}: no usable samples`
      );
    } catch (error) {
      errors.push(
        `${endpoint.label}: ${
          error instanceof Error
            ? error.message
            : "failed"
        }`
      );
    }
  }

  // Last-resort individual-point requests. This avoids one bad multi-location
  // response taking down the entire field.
  const individual:
    WindPoint[] = [];

  for (
    let start = 0;
    start < coordinates.length;
    start +=
      MAX_POINT_CONCURRENCY
  ) {
    const group =
      coordinates.slice(
        start,
        start +
          MAX_POINT_CONCURRENCY
      );

    const settled =
      await Promise.allSettled(
        group.map(
          async (
            coordinate
          ) => {
            const url =
              batchUrl(
                "https://api.open-meteo.com/v1/gfs",
                [coordinate],
                false
              );

            const payload =
              await fetchJson(
                url,
                1
              );

            return valueAtOffset(
              payload,
              coordinate,
              hourOffset
            );
          }
        )
      );

    for (const result of settled) {
      if (
        result.status ===
          "fulfilled" &&
        result.value
      ) {
        individual.push(
          result.value
        );
      }
    }
  }

  return {
    points:
      individual,
    provider:
      "gfs:individual-fallback",
    errors,
  };
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request.json()) as
        Partial<BoundsRequest>;

    if (
      !finite(body.west) ||
      !finite(body.south) ||
      !finite(body.east) ||
      !finite(body.north)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid map bounds.",
        },
        {
          status: 400,
        }
      );
    }

    const west =
      clamp(
        body.west,
        -180,
        180
      );

    const east =
      clamp(
        body.east,
        -180,
        180
      );

    const south =
      clamp(
        body.south,
        -85,
        85
      );

    const north =
      clamp(
        body.north,
        -85,
        85
      );

    const zoom =
      clamp(
        finite(body.zoom)
          ? body.zoom
          : 6,
        2,
        18
      );

    const hourOffset =
      clamp(
        Math.round(
          finite(
            body.hourOffset
          )
            ? body.hourOffset
            : 0
        ),
        0,
        12
      );

    const coordinates =
      buildCoordinates(
        west,
        south,
        east,
        north,
        zoom
      );

    const batches:
      GridPoint[][] = [];

    for (
      let index = 0;
      index <
        coordinates.length;
      index += BATCH_SIZE
    ) {
      batches.push(
        coordinates.slice(
          index,
          index + BATCH_SIZE
        )
      );
    }

    const allPoints:
      WindPoint[] = [];

    const errors:
      string[] = [];

    const providers =
      new Set<string>();

    for (
      let index = 0;
      index < batches.length;
      index +=
        MAX_BATCH_CONCURRENCY
    ) {
      const group =
        batches.slice(
          index,
          index +
            MAX_BATCH_CONCURRENCY
        );

      const settled =
        await Promise.all(
          group.map(
            (batch) =>
              fetchBatch(
                batch,
                hourOffset
              )
          )
        );

      for (const result of settled) {
        allPoints.push(
          ...result.points
        );

        providers.add(
          result.provider
        );

        errors.push(
          ...result.errors
        );
      }
    }

    if (!allPoints.length) {
      return NextResponse.json(
        {
          error:
            "Wind provider returned no usable samples.",
          requestedSampleCount:
            coordinates.length,
          returnedSampleCount:
            0,
          upstreamErrors:
            errors.slice(
              0,
              8
            ),
        },
        {
          status: 502,
          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    return NextResponse.json(
      {
        points:
          allPoints.map(
            ({
              time: _time,
              ...point
            }) => point
          ),
        targetTime:
          allPoints.find(
            (point) =>
              point.time
          )?.time ||
          null,
        hourOffset,
        requestedSampleCount:
          coordinates.length,
        returnedSampleCount:
          allPoints.length,
        grid:
          getGridSize(zoom),
        zoom,
        provider:
          Array.from(
            providers
          ).join("+"),
        partial:
          allPoints.length <
          coordinates.length,
        upstreamErrors:
          errors.slice(
            0,
            8
          ),
        generatedAt:
          new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=120, s-maxage=600, stale-while-revalidate=1800",
          "X-Wind-Engine":
            "open-meteo-gfs-hardened",
        },
      }
    );
  } catch (error) {
    console.warn(
      "Map wind API failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Unable to generate wind map.",
      },
      {
        status: 502,
      }
    );
  }
}
