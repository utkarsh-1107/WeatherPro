export type GfsMapLayerMode =
  | "temperature"
  | "rain"
  | "clouds"
  | "wind";

export type GfsMapManifest = {
  engine:
    "open-meteo-spatial-capture";
  model: string;
  modelLabel: string;
  resolutionKm: number;
  referenceTime: string;
  validTime: string;
  validTimeIndex: number;
  metadataUrl: string;
  alternateMetadataUrl?: string;
  completed: boolean;
  lastModified: string | null;
  variable: string;
  layer: GfsMapLayerMode;
  fallbackModel: boolean;
  attribution: string;
};

const CACHE_MS =
  4 * 60 * 1000;

const cache =
  new Map<
    string,
    {
      expiresAt: number;
      value: GfsMapManifest;
    }
  >();

const pending =
  new Map<
    string,
    Promise<GfsMapManifest>
  >();

function keyFor(
  hourOffset: number,
  layer: GfsMapLayerMode
) {
  return `${Math.max(
    0,
    Math.round(hourOffset)
  )}:${layer}`;
}

export async function getGfsMapManifest(
  hourOffset: number,
  layer: GfsMapLayerMode
) {
  const key =
    keyFor(
      hourOffset,
      layer
    );

  const existing =
    cache.get(key);

  if (
    existing &&
    existing.expiresAt >
      Date.now()
  ) {
    return existing.value;
  }

  const inFlight =
    pending.get(key);

  if (inFlight) {
    return inFlight;
  }

  const params =
    new URLSearchParams({
      hourOffset:
        String(
          Math.max(
            0,
            Math.round(
              hourOffset
            )
          )
        ),
      layer,
    });

  const request =
    (async () => {
      const response =
        await fetch(
          `/api/gfs/manifest?${params.toString()}`,
          {
            cache:
              "no-store",
            credentials:
              "same-origin",
            headers: {
              Accept:
                "application/json",
            },
          }
        );

      const contentType =
        response.headers.get(
          "content-type"
        ) || "";

      if (
        !response.ok ||
        !contentType.includes(
          "application/json"
        )
      ) {
        const body =
          await response.text();

        throw new Error(
          `Weather map manifest failed (${response.status}): ${body.slice(
            0,
            160
          )}`
        );
      }

      const manifest =
        (await response.json()) as
          GfsMapManifest;

      cache.set(key, {
        expiresAt:
          Date.now() +
          CACHE_MS,
        value:
          manifest,
      });

      return manifest;
    })();

  pending.set(
    key,
    request
  );

  try {
    return await request;
  } finally {
    if (
      pending.get(key) ===
      request
    ) {
      pending.delete(key);
    }
  }
}

export function gfsRasterUrl(
  manifest: GfsMapManifest,
  metadataUrl =
    manifest.metadataUrl
) {
  const params =
    new URLSearchParams({
      time_step:
        `valid_times_${manifest.validTimeIndex}`,
      variable:
        manifest.variable,
      dark:
        "true",
      interpolation:
        "linear",
    });

  return (
    `om://${metadataUrl}?` +
    params.toString()
  );
}

export function prefetchGfsManifest(
  hourOffset: number,
  layer: GfsMapLayerMode
) {
  void getGfsMapManifest(
    hourOffset,
    layer
  ).catch(() => {
    // Prefetch is optional and never blocks the active map layer.
  });
}
