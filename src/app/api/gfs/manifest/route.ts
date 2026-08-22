import {
  NextRequest,
  NextResponse,
} from "next/server";

export const revalidate = 300;

type LayerMode =
  | "temperature"
  | "rain"
  | "clouds"
  | "wind";

type SpatialMetadata = {
  completed?: boolean;
  last_modified_time?: string;
  reference_time?: string;
  valid_times?: string[];
  variables?: string[];
};

type ResolvedSpatialMetadata =
  SpatialMetadata & {
    reference_time: string;
    valid_times: string[];
  };

const SPATIAL_BASES = [
  // Current weather-map-layer documentation uses this endpoint.
  // Prefer it for OM range requests; keep the CDN only as a metadata fallback.
  "https://map-tiles.open-meteo.com/data_spatial",
  "https://openmeteo-data-spatial.b-cdn.net",
] as const;

const GFS = {
  id: "ncep_gfs013",
  label: "NOAA GFS",
  resolutionKm: 13,
} as const;

const ICON = {
  id: "dwd_icon",
  label: "DWD ICON Global",
  resolutionKm: 13,
} as const;

const VARIABLE_BY_LAYER:
  Record<
    LayerMode,
    string
  > = {
    temperature:
      "temperature_2m",
    rain:
      "precipitation",
    clouds:
      "cloud_cover",

    // Official weather-map-layer wind examples use the native U component.
    // wind_speed_10m is API-derived and is not a primary spatial OM variable.
    wind:
      "wind_u_component_10m",
  };

function parseUtc(
  value: string
) {
  const normalized =
    value.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(
      value
    )
      ? value
      : `${value}Z`;

  return new Date(
    normalized
  );
}

function nearestValidTime(
  values: string[],
  targetMs: number
) {
  const candidates =
    values
      .map(
        (
          value,
          index
        ) => ({
          value,
          index,
          timestamp:
            parseUtc(
              value
            ).getTime(),
        })
      )
      .filter(
        (entry) =>
          Number.isFinite(
            entry.timestamp
          )
      );

  if (
    !candidates.length
  ) {
    throw new Error(
      "No valid forecast times are available."
    );
  }

  return candidates.reduce(
    (best, current) =>
      Math.abs(
        current.timestamp -
          targetMs
      ) <
      Math.abs(
        best.timestamp -
          targetMs
      )
        ? current
        : best
  );
}

async function fetchMetadata(
  model: string
) {
  const failures:
    string[] = [];

  for (
    const base of
    SPATIAL_BASES
  ) {
    const metadataUrl =
      `${base}/${model}/latest.json`;

    try {
      const response =
        await fetch(
          metadataUrl,
          {
            headers: {
              Accept:
                "application/json",
            },
            next: {
              revalidate: 300,
            },
          }
        );

      if (
        !response.ok
      ) {
        failures.push(
          `${metadataUrl}: HTTP ${response.status}`
        );
        continue;
      }

      const metadata =
        (await response.json()) as
          SpatialMetadata;

      const referenceTime =
        metadata.reference_time;

      const validTimes =
        metadata.valid_times;

      if (
        !referenceTime ||
        !Array.isArray(
          validTimes
        ) ||
        validTimes.length ===
          0
      ) {
        failures.push(
          `${metadataUrl}: incomplete metadata`
        );
        continue;
      }

      const resolved:
        ResolvedSpatialMetadata =
        {
          ...metadata,
          reference_time:
            referenceTime,
          valid_times:
            validTimes,
        };

      return {
        metadata:
          resolved,
        metadataUrl,
      };
    } catch (error) {
      failures.push(
        `${metadataUrl}: ${
          error instanceof
          Error
            ? error.message
            : "request failed"
        }`
      );
    }
  }

  throw new Error(
    failures.join(" | ")
  );
}

export async function GET(
  request: NextRequest
) {
  const requested =
    request.nextUrl
      .searchParams
      .get("layer");

  const layer:
    LayerMode =
    requested === "rain" ||
    requested ===
      "clouds" ||
    requested === "wind"
      ? requested
      : "temperature";

  const rawOffset =
    Number(
      request.nextUrl
        .searchParams
        .get(
          "hourOffset"
        ) || "0"
    );

  const hourOffset =
    Math.max(
      0,
      Math.min(
        120,
        Number.isFinite(
          rawOffset
        )
          ? Math.round(
              rawOffset
            )
          : 0
      )
    );

  const variable =
    VARIABLE_BY_LAYER[
      layer
    ];

  const targetMs =
    Date.now() +
    hourOffset *
      60 *
      60 *
      1000;

  // The Wind package's own documented raster example uses DWD ICON.
  // Other layers stay on NOAA GFS first.
  const candidates =
    layer === "wind"
      ? [ICON, GFS]
      : [GFS, ICON];

  const failures:
    string[] = [];

  for (
    const model of
    candidates
  ) {
    try {
      const {
        metadata,
        metadataUrl,
      } =
        await fetchMetadata(
          model.id
        );

      if (
        Array.isArray(
          metadata.variables
        ) &&
        metadata.variables
          .length &&
        !metadata.variables.includes(
          variable
        )
      ) {
        failures.push(
          `${model.id}: ${variable} unavailable`
        );
        continue;
      }

      let selected =
        nearestValidTime(
          metadata.valid_times,
          targetMs
        );

      // Accumulation fields are not available on the first timestep.
      if (
        layer === "rain" &&
        selected.index === 0 &&
        metadata
          .valid_times
          .length > 1
      ) {
        selected = {
          value:
            metadata
              .valid_times[1],
          index: 1,
          timestamp:
            parseUtc(
              metadata
                .valid_times[1]
            ).getTime(),
        };
      }

      return NextResponse.json(
        {
          engine:
            "open-meteo-spatial-capture",
          model:
            model.id,
          modelLabel:
            model.label,
          resolutionKm:
            model.resolutionKm,
          referenceTime:
            metadata.reference_time,
          validTime:
            selected.value,
          validTimeIndex:
            selected.index,
          metadataUrl,
          alternateMetadataUrl:
            metadataUrl.includes(
              "map-tiles.open-meteo.com/data_spatial"
            )
              ? metadataUrl.replace(
                  "https://map-tiles.open-meteo.com/data_spatial",
                  "https://openmeteo-data-spatial.b-cdn.net"
                )
              : metadataUrl.replace(
                  "https://openmeteo-data-spatial.b-cdn.net",
                  "https://map-tiles.open-meteo.com/data_spatial"
                ),
          completed:
            metadata.completed ??
            true,
          lastModified:
            metadata.last_modified_time ??
            null,
          variable,
          layer,
          fallbackModel:
            model.id !==
            candidates[0].id,
          attribution:
            `${model.label} · Open-Meteo Open Data`,
        },
        {
          headers: {
            "Cache-Control":
              "public, max-age=60, s-maxage=300, stale-while-revalidate=1800",
            "X-Weather-Map-Engine":
              "open-meteo-spatial-capture",
            "X-Weather-Map-Model":
              model.id,
          },
        }
      );
    } catch (error) {
      failures.push(
        `${model.id}: ${
          error instanceof
          Error
            ? error.message
            : "unknown failure"
        }`
      );
    }
  }

  console.error(
    "[weather-map-manifest]",
    failures.join(" | ")
  );

  return NextResponse.json(
    {
      error:
        "Weather map data is temporarily unavailable.",
      layer,
      failures,
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
