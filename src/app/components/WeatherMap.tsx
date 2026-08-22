"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudRain,
  Link2,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Mountain,
  Pause,
  Play,
  Satellite,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import {
  getFullWeatherData,
  reverseGeocode,
} from "@/lib/weather";
import {
  getGfsMapManifest,
  gfsRasterUrl,
  prefetchGfsManifest,
  type GfsMapLayerMode,
} from "@/lib/gfs-map";
import { getWmoStatus } from "@/lib/wmo";
import "maplibre-gl/dist/maplibre-gl.css";

let omProtocolRegistered = false;
let omProtocolPromise: Promise<void> | null = null;

async function ensureOmProtocol() {
  if (omProtocolRegistered) {
    return;
  }

  if (omProtocolPromise) {
    return omProtocolPromise;
  }

  omProtocolPromise = (async () => {
    const [
      maplibregl,
      weatherMapLayer,
    ] = await Promise.all([
      import("maplibre-gl"),
      import(
        "@openmeteo/weather-map-layer"
      ),
    ]);

    if (!omProtocolRegistered) {
      maplibregl.addProtocol(
        "om",
        weatherMapLayer.omProtocol
      );
      omProtocolRegistered = true;
    }
  })();

  try {
    await omProtocolPromise;
  } finally {
    omProtocolPromise = null;
  }
}

type UnitSystem =
  | "metric"
  | "imperial";

type Props = {
  latitude: number;
  longitude: number;
  locationName: string;
  temperature: number;
  weatherCode: number;
  units: UnitSystem;
  onSelectLocation: (
    lat: number,
    lon: number
  ) => void;
  onUseMyLocation: () => void;
  flyToTarget?: {
    lat: number;
    lon: number;
    zoom?: number;
  } | null;
  initialZoom?: number;
  showCurrentConditions?: boolean;
};

type WeatherLayerMode =
  | "base"
  | GfsMapLayerMode;

type BaseMapMode =
  | "dark"
  | "satellite";

type TerrainMode =
  | "off"
  | "hillshade"
  | "3d";

type Preview = {
  lat: number;
  lon: number;
  name: string;
  temperature: number;
  weatherCode: number;
};

type OverlayPhase =
  | "idle"
  | "loading"
  | "streaming"
  | "ready"
  | "retrying"
  | "error";

type OverlayStatus = {
  phase: OverlayPhase;
  modelLabel?: string;
  validTime?: string;
  error?: string;
};

const CARTO_SOURCE =
  "weatherpro-carto";
const CARTO_LAYER =
  "weatherpro-carto-layer";

const NASA_SOURCE =
  "weatherpro-nasa";
const NASA_LAYER =
  "weatherpro-nasa-layer";

const TERRAIN_SOURCE =
  "weatherpro-terrain";
const HILLSHADE_SOURCE =
  "weatherpro-hillshade-source";
const HILLSHADE_LAYER =
  "weatherpro-hillshade";

const WEATHER_SOURCE_PREFIX =
  "weatherpro-weather-source-";
const WEATHER_LAYER_PREFIX =
  "weatherpro-weather-layer-";

const MAPTERHORN_TILEJSON =
  "https://tiles.mapterhorn.com/tilejson.json";

const WEATHER_LAYERS:
  Array<{
    id: WeatherLayerMode;
    label: string;
  }> = [
    {
      id: "base",
      label: "Map",
    },
    {
      id: "temperature",
      label: "Temperature",
    },
    {
      id: "rain",
      label: "Rain",
    },
    {
      id: "clouds",
      label: "Clouds",
    },
    {
      id: "wind",
      label: "Wind",
    },
  ];

function satelliteDate() {
  const date = new Date();
  date.setUTCDate(
    date.getUTCDate() - 1
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function nasaTiles(
  date: string
) {
  return [
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
      "VIIRS_SNPP_CorrectedReflectance_TrueColor/" +
      `default/${date}/GoogleMapsCompatible_Level9/` +
      "{z}/{y}/{x}.jpg",
  ];
}

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

function distanceDegrees(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
) {
  return Math.hypot(
    aLat - bLat,
    aLon - bLon
  );
}

function formatValidTime(
  value?: string
) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleTimeString(
    [],
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function isOmReadError(
  message: string
) {
  const value =
    message.toLowerCase();

  return (
    value.includes(
      "omhttpbackenderror"
    ) ||
    value.includes(
      "received"
    ) &&
      value.includes(
        "expected"
      ) ||
    value.includes(
      "primary variable"
    ) ||
    value.includes(
      "om://"
    )
  );
}

function buildStyle(
  baseMapMode: BaseMapMode,
  terrainMode: TerrainMode,
  nasaDate: string
): import("maplibre-gl").StyleSpecification {
  const satellite =
    baseMapMode ===
    "satellite";

  const terrainEnabled =
    terrainMode !== "off";

  const sources:
    import("maplibre-gl").StyleSpecification["sources"] =
    {
      [CARTO_SOURCE]: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        maxzoom: 20,
        attribution:
          "© OpenStreetMap contributors © CARTO",
      },
      [NASA_SOURCE]: {
        type: "raster",
        tiles:
          nasaTiles(
            nasaDate
          ),
        tileSize: 256,
        minzoom: 1,
        maxzoom: 9,
        attribution:
          "NASA GIBS",
      },
    };

  if (terrainEnabled) {
    sources[TERRAIN_SOURCE] = {
      type: "raster-dem",
      url:
        MAPTERHORN_TILEJSON,
    };

    sources[HILLSHADE_SOURCE] = {
      type: "raster-dem",
      url:
        MAPTERHORN_TILEJSON,
    };
  }

  const layers:
    import("maplibre-gl").LayerSpecification[] =
    [
      {
        id: CARTO_LAYER,
        type: "raster",
        source: CARTO_SOURCE,
        layout: {
          visibility:
            satellite
              ? "none"
              : "visible",
        },
        paint: {
          "raster-opacity":
            satellite
              ? 0
              : 1,
          "raster-brightness-min":
            0.04,
          "raster-brightness-max":
            0.84,
          "raster-saturation":
            -0.1,
          "raster-contrast":
            0.08,
        },
      },
      {
        id: NASA_LAYER,
        type: "raster",
        source: NASA_SOURCE,
        layout: {
          visibility:
            satellite
              ? "visible"
              : "none",
        },
        paint: {
          "raster-opacity":
            satellite
              ? 1
              : 0,
          "raster-fade-duration":
            100,
          "raster-resampling":
            "linear",
          "raster-contrast":
            0.05,
        },
      },
    ];

  if (terrainEnabled) {
    layers.push({
      id: HILLSHADE_LAYER,
      type: "hillshade",
      source: HILLSHADE_SOURCE,
      paint: {
        "hillshade-exaggeration":
          terrainMode ===
          "hillshade"
            ? 0.55
            : 0.34,
        "hillshade-shadow-color":
          "#020617",
        "hillshade-highlight-color":
          "#e2e8f0",
        "hillshade-accent-color":
          "#64748b",
        "hillshade-illumination-anchor":
          "map",
      },
    });
  }

  const style:
    import("maplibre-gl").StyleSpecification =
    {
      version: 8,
      sources,
      layers,
    };

  if (
    terrainMode === "3d"
  ) {
    style.terrain = {
      source:
        TERRAIN_SOURCE,
      exaggeration: 1.2,
    };
  }

  return style;
}

export default function WeatherMap({
  latitude,
  longitude,
  locationName,
  temperature,
  weatherCode,
  units,
  onSelectLocation,
  onUseMyLocation,
  flyToTarget,
  initialZoom = 10.5,
  showCurrentConditions = true,
}: Props) {
  const containerRef =
    useRef<HTMLDivElement>(null);

  const mapRef =
    useRef<
      import("maplibre-gl").Map | null
    >(null);

  const markerRef =
    useRef<
      import("maplibre-gl").Marker | null
    >(null);

  const styleApplySequenceRef =
    useRef(0);

  const weatherLoadSequenceRef =
    useRef(0);

  const activeWeatherRef =
    useRef<{
      sourceId: string;
      layerId: string;
    } | null>(null);

  const weatherCleanupRef =
    useRef<(() => void) | null>(
      null
    );

  const previewSequenceRef =
    useRef(0);

  const shareCenterRef =
    useRef<{
      lat: number;
      lon: number;
    } | null>(null);

  const opacityTimerRef =
    useRef<number | null>(
      null
    );

  const [mapReady, setMapReady] =
    useState(false);

  const [
    styleRevision,
    setStyleRevision,
  ] = useState(0);

  const [
    weatherLayer,
    setWeatherLayer,
  ] =
    useState<WeatherLayerMode>(
      "base"
    );

  const [
    baseMapMode,
    setBaseMapMode,
  ] =
    useState<BaseMapMode>(
      "dark"
    );

  const [
    terrainMode,
    setTerrainMode,
  ] =
    useState<TerrainMode>(
      "off"
    );

  const [
    forecastOffset,
    setForecastOffset,
  ] = useState(0);

  const [
    overlayOpacity,
    setOverlayOpacity,
  ] = useState(72);

  const [
    opacityDraft,
    setOpacityDraft,
  ] = useState(72);

  const [
    overlayStatus,
    setOverlayStatus,
  ] =
    useState<OverlayStatus>({
      phase: "idle",
    });

  const [
    preview,
    setPreview,
  ] =
    useState<Preview | null>(
      null
    );

  const [
    previewLoading,
    setPreviewLoading,
  ] = useState(false);

  const [
    mapMessage,
    setMapMessage,
  ] =
    useState<string | null>(
      null
    );

  const [
    isPlaying,
    setIsPlaying,
  ] = useState(false);

  const [
    playbackSpeed,
    setPlaybackSpeed,
  ] =
    useState<0.5 | 1 | 2>(
      1
    );

  const [
    shareStatus,
    setShareStatus,
  ] =
    useState<
      "idle" | "copied" | "error"
    >("idle");

  const [nasaDate] =
    useState(satelliteDate);

  const displayTemperature = (
    celsius: number
  ) =>
    units === "metric"
      ? `${Math.round(
          celsius
        )}°`
      : `${Math.round(
          (celsius * 9) / 5 +
            32
        )}°`;

  const activeLayerLabel =
    WEATHER_LAYERS.find(
      (item) =>
        item.id ===
        weatherLayer
    )?.label || "Map";

  const removeWeatherArtifacts =
    () => {
      weatherCleanupRef.current?.();
      weatherCleanupRef.current =
        null;

      const map =
        mapRef.current;

      if (!map) {
        activeWeatherRef.current =
          null;
        return;
      }

      try {
        const style =
          map.getStyle();

        const layerIds =
          style.layers
            ?.map(
              (layer) =>
                layer.id
            )
            .filter((id) =>
              id.startsWith(
                WEATHER_LAYER_PREFIX
              )
            ) || [];

        for (
          const layerId of
          layerIds
        ) {
          if (
            map.getLayer(
              layerId
            )
          ) {
            map.removeLayer(
              layerId
            );
          }
        }

        const sourceIds =
          Object.keys(
            style.sources || {}
          ).filter((id) =>
            id.startsWith(
              WEATHER_SOURCE_PREFIX
            )
          );

        for (
          const sourceId of
          sourceIds
        ) {
          if (
            map.getSource(
              sourceId
            )
          ) {
            map.removeSource(
              sourceId
            );
          }
        }
      } catch {
        // Style may be changing or map may be shutting down.
      }

      activeWeatherRef.current =
        null;
    };

  const moveCameraForTerrain =
    (
      mode: TerrainMode
    ) => {
      const map =
        mapRef.current;

      if (!map) {
        return;
      }

      if (mode === "3d") {
        map.easeTo({
          zoom: Math.max(
            map.getZoom(),
            9.5
          ),
          pitch: 62,
          bearing: -18,
          duration: 650,
          essential: true,
        });
      } else {
        map.easeTo({
          pitch: 0,
          bearing: 0,
          duration: 420,
          essential: true,
        });
      }
    };

  const recenterToWeatherLocation =
    (
      zoom = 13.5
    ) => {
      const map =
        mapRef.current;

      if (!map) {
        return;
      }

      map.flyTo({
        center: [
          longitude,
          latitude,
        ],
        zoom: Math.max(
          map.getZoom(),
          zoom
        ),
        duration: 850,
        essential: true,
      });
    };

  const handleUseMyLocation =
    () => {
      recenterToWeatherLocation();
      onUseMyLocation();
    };

  const copyShareLink =
    async () => {
      const map =
        mapRef.current;

      if (!map) {
        return;
      }

      try {
        const center =
          map.getCenter();

        const url =
          new URL(
            window.location.href
          );

        url.searchParams.set(
          "share",
          "1"
        );
        url.searchParams.set(
          "lat",
          center.lat.toFixed(5)
        );
        url.searchParams.set(
          "lon",
          center.lng.toFixed(5)
        );
        url.searchParams.set(
          "zoom",
          map
            .getZoom()
            .toFixed(2)
        );
        url.searchParams.set(
          "layer",
          weatherLayer
        );
        url.searchParams.set(
          "hour",
          String(
            forecastOffset
          )
        );
        url.searchParams.set(
          "opacity",
          String(
            overlayOpacity
          )
        );
        url.searchParams.set(
          "basemap",
          baseMapMode
        );
        url.searchParams.set(
          "terrain",
          terrainMode
        );
        url.searchParams.set(
          "speed",
          String(
            playbackSpeed
          )
        );

        await navigator.clipboard.writeText(
          url.toString()
        );

        setShareStatus(
          "copied"
        );

        window.setTimeout(
          () =>
            setShareStatus(
              "idle"
            ),
          1500
        );
      } catch {
        setShareStatus(
          "error"
        );

        window.setTimeout(
          () =>
            setShareStatus(
              "idle"
            ),
          1800
        );
      }
    };

  // Create one MapLibre map instance. Presentation changes use setStyle()
  // instead of trying to mutate terrain/basemap sources in place.
  useEffect(() => {
    let cancelled = false;
    let resizeObserver:
      ResizeObserver | null =
      null;

    async function initialise() {
      if (
        !containerRef.current ||
        mapRef.current
      ) {
        return;
      }

      const maplibregl =
        await import(
          "maplibre-gl"
        );

      if (
        cancelled ||
        !containerRef.current
      ) {
        return;
      }

      const params =
        new URLSearchParams(
          window.location.search
        );

      const isShare =
        params.get("share") ===
        "1";

      const sharedLat =
        Number(
          params.get("lat")
        );

      const sharedLon =
        Number(
          params.get("lon")
        );

      const sharedZoom =
        Number(
          params.get("zoom")
        );

      const hasShareCenter =
        isShare &&
        validCoordinate(
          sharedLat,
          -90,
          90
        ) &&
        validCoordinate(
          sharedLon,
          -180,
          180
        );

      const centerLat =
        hasShareCenter
          ? sharedLat
          : latitude;

      const centerLon =
        hasShareCenter
          ? sharedLon
          : longitude;

      if (hasShareCenter) {
        shareCenterRef.current =
          {
            lat: sharedLat,
            lon: sharedLon,
          };
      }

      const initialMapZoom =
        isShare &&
        Number.isFinite(
          sharedZoom
        ) &&
        sharedZoom >= 2 &&
        sharedZoom <= 18
          ? sharedZoom
          : initialZoom;

      let initialBase:
        BaseMapMode =
        "dark";

      let initialTerrain:
        TerrainMode =
        "off";

      let initialLayer:
        WeatherLayerMode =
        "base";

      let initialHour = 0;
      let initialOpacity = 72;

      if (isShare) {
        const sharedBase =
          params.get(
            "basemap"
          );

        if (
          sharedBase ===
            "dark" ||
          sharedBase ===
            "satellite"
        ) {
          initialBase =
            sharedBase;
          setBaseMapMode(
            sharedBase
          );
        }

        const sharedTerrain =
          params.get(
            "terrain"
          );

        if (
          sharedTerrain ===
            "off" ||
          sharedTerrain ===
            "hillshade" ||
          sharedTerrain ===
            "3d"
        ) {
          initialTerrain =
            sharedTerrain;
          setTerrainMode(
            sharedTerrain
          );
        }

        const sharedLayer =
          params.get("layer");

        if (
          sharedLayer ===
            "base" ||
          sharedLayer ===
            "temperature" ||
          sharedLayer ===
            "rain" ||
          sharedLayer ===
            "clouds" ||
          sharedLayer ===
            "wind"
        ) {
          initialLayer =
            sharedLayer;
          setWeatherLayer(
            sharedLayer
          );
        }

        const hour =
          Number(
            params.get("hour")
          );

        if (
          Number.isFinite(
            hour
          )
        ) {
          initialHour =
            Math.max(
              0,
              Math.min(
                12,
                Math.round(hour)
              )
            );

          setForecastOffset(
            initialHour
          );
        }

        const opacity =
          Number(
            params.get(
              "opacity"
            )
          );

        if (
          Number.isFinite(
            opacity
          )
        ) {
          initialOpacity =
            Math.max(
              20,
              Math.min(
                100,
                Math.round(
                  opacity
                )
              )
            );

          setOverlayOpacity(
            initialOpacity
          );
          setOpacityDraft(
            initialOpacity
          );
        }

        const speed =
          Number(
            params.get(
              "speed"
            )
          );

        if (
          speed === 0.5 ||
          speed === 1 ||
          speed === 2
        ) {
          setPlaybackSpeed(
            speed
          );
        }
      }

      const map =
        new maplibregl.Map({
          container:
            containerRef.current,
          center: [
            centerLon,
            centerLat,
          ],
          zoom:
            initialMapZoom,
          minZoom: 2,
          maxZoom: 18,
          maxPitch: 85,
          attributionControl:
            false,
          dragRotate: false,
          pitchWithRotate:
            false,
          fadeDuration: 100,
          style:
            buildStyle(
              initialBase,
              initialTerrain,
              nasaDate
            ),
        });

      mapRef.current =
        map;

      const markerElement =
        document.createElement(
          "div"
        );

      markerElement.style.width =
        "18px";
      markerElement.style.height =
        "18px";
      markerElement.style.borderRadius =
        "999px";
      markerElement.style.background =
        "#38bdf8";
      markerElement.style.border =
        "3px solid white";
      markerElement.style.boxShadow =
        "0 0 0 5px rgba(56,189,248,0.22),0 6px 18px rgba(0,0,0,0.45)";

      markerRef.current =
        new maplibregl.Marker({
          element:
            markerElement,
          anchor: "center",
        })
          .setLngLat([
            centerLon,
            centerLat,
          ])
          .addTo(map);

      map.on(
        "load",
        () => {
          if (cancelled) {
            return;
          }

          setMapReady(true);
          setStyleRevision(
            (current) =>
              current + 1
          );

          moveCameraForTerrain(
            initialTerrain
          );

          map.resize();
        }
      );

      map.on(
        "click",
        async (event) => {
          const requestId =
            ++previewSequenceRef.current;

          const {
            lat,
            lng,
          } = event.lngLat;

          setPreviewLoading(
            true
          );
          setPreview(null);
          setMapMessage(null);

          try {
            const [
              weather,
              place,
            ] =
              await Promise.all([
                getFullWeatherData(
                  lat,
                  lng
                ),
                reverseGeocode(
                  lat,
                  lng
                ).catch(
                  () => null
                ),
              ]);

            if (
              requestId !==
              previewSequenceRef.current
            ) {
              return;
            }

            setPreview({
              lat,
              lon: lng,
              name:
                place?.name ||
                `${lat.toFixed(
                  3
                )}, ${lng.toFixed(
                  3
                )}`,
              temperature:
                weather.current
                  .temperature,
              weatherCode:
                weather.current
                  .weathercode,
            });
          } catch {
            if (
              requestId ===
              previewSequenceRef.current
            ) {
              setMapMessage(
                "Weather could not be loaded for that point."
              );
            }
          } finally {
            if (
              requestId ===
              previewSequenceRef.current
            ) {
              setPreviewLoading(
                false
              );
            }
          }
        }
      );

      resizeObserver =
        new ResizeObserver(
          () => {
            map.resize();
          }
        );

      resizeObserver.observe(
        containerRef.current
      );
    }

    void initialise();

    return () => {
      cancelled = true;

      styleApplySequenceRef.current +=
        1;
      weatherLoadSequenceRef.current +=
        1;

      weatherCleanupRef.current?.();
      weatherCleanupRef.current =
        null;

      if (
        opacityTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          opacityTimerRef.current
        );
      }

      resizeObserver?.disconnect();

      mapRef.current?.remove();
      mapRef.current =
        null;
      markerRef.current =
        null;
      activeWeatherRef.current =
        null;
    };
    // Map instance is intentionally created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser/weather coordinates remain authoritative for the location marker.
  useEffect(() => {
    const map =
      mapRef.current;

    if (
      !mapReady ||
      !map
    ) {
      return;
    }

    markerRef.current?.setLngLat(
      [
        longitude,
        latitude,
      ]
    );

    const shareCenter =
      shareCenterRef.current;

    if (shareCenter) {
      if (
        distanceDegrees(
          latitude,
          longitude,
          shareCenter.lat,
          shareCenter.lon
        ) >= 0.04
      ) {
        return;
      }

      shareCenterRef.current =
        null;
    }

    const center =
      map.getCenter();

    if (
      distanceDegrees(
        center.lat,
        center.lng,
        latitude,
        longitude
      ) > 0.01
    ) {
      map.flyTo({
        center: [
          longitude,
          latitude,
        ],
        zoom: Math.max(
          map.getZoom(),
          11
        ),
        duration: 850,
        essential: true,
      });
    }
  }, [
    latitude,
    longitude,
    mapReady,
  ]);

  useEffect(() => {
    const map =
      mapRef.current;

    if (
      !mapReady ||
      !map ||
      !flyToTarget
    ) {
      return;
    }

    map.flyTo({
      center: [
        flyToTarget.lon,
        flyToTarget.lat,
      ],
      zoom:
        flyToTarget.zoom ??
        Math.max(
          map.getZoom(),
          12.5
        ),
      duration: 900,
      essential: true,
    });
  }, [
    flyToTarget,
    mapReady,
  ]);

  // Rebuild only the MapLibre STYLE when basemap/terrain changes.
  // This is the same-map equivalent of the refresh that was previously
  // required, and uses MapLibre's official terrain-in-style pattern.
  useEffect(() => {
    const map =
      mapRef.current;

    if (
      !mapReady ||
      !map
    ) {
      return;
    }

    const sequence =
      ++styleApplySequenceRef.current;

    weatherLoadSequenceRef.current +=
      1;
    removeWeatherArtifacts();

    setOverlayStatus(
      weatherLayer ===
      "base"
        ? {
            phase: "idle",
          }
        : {
            phase:
              "loading",
          }
    );

    setMapMessage(null);

    const onStyleLoad =
      () => {
        if (
          sequence !==
          styleApplySequenceRef.current
        ) {
          return;
        }

        map.off(
          "style.load",
          onStyleLoad
        );

        moveCameraForTerrain(
          terrainMode
        );

        setStyleRevision(
          (current) =>
            current + 1
        );

        map.resize();
      };

    map.on(
      "style.load",
      onStyleLoad
    );

    try {
      map.setStyle(
        buildStyle(
          baseMapMode,
          terrainMode,
          nasaDate
        ),
        {
          diff: false,
        }
      );
    } catch (error) {
      map.off(
        "style.load",
        onStyleLoad
      );

      console.warn(
        "Map style switch failed:",
        error
      );

      setMapMessage(
        "Map presentation could not be changed."
      );
    }

    return () => {
      map.off(
        "style.load",
        onStyleLoad
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    baseMapMode,
    terrainMode,
    mapReady,
  ]);

  // Exactly one weather source and one weather raster are allowed.
  useEffect(() => {
    const map =
      mapRef.current;

    if (
      !mapReady ||
      !map ||
      !map.isStyleLoaded()
    ) {
      return;
    }

    const requestId =
      ++weatherLoadSequenceRef.current;

    removeWeatherArtifacts();
    setMapMessage(null);

    if (
      weatherLayer ===
      "base"
    ) {
      setOverlayStatus({
        phase: "idle",
      });
      setIsPlaying(false);
      return;
    }

    setOverlayStatus({
      phase: "loading",
    });

    let disposed = false;

    const cleanupCurrent =
      () => {
        weatherCleanupRef.current?.();
        weatherCleanupRef.current =
          null;

        const active =
          activeWeatherRef.current;

        if (active) {
          try {
            if (
              map.getLayer(
                active.layerId
              )
            ) {
              map.removeLayer(
                active.layerId
              );
            }
          } catch {}

          try {
            if (
              map.getSource(
                active.sourceId
              )
            ) {
              map.removeSource(
                active.sourceId
              );
            }
          } catch {}
        }

        activeWeatherRef.current =
          null;
      };

    void (async () => {
      try {
        await ensureOmProtocol();

        if (
          disposed ||
          requestId !==
            weatherLoadSequenceRef.current
        ) {
          return;
        }

        const manifest =
          await getGfsMapManifest(
            forecastOffset,
            weatherLayer
          );

        if (
          disposed ||
          requestId !==
            weatherLoadSequenceRef.current
        ) {
          return;
        }

        const metadataCandidates =
          [
            manifest.metadataUrl,
            manifest.alternateMetadataUrl,
          ].filter(
            (
              value,
              index,
              array
            ): value is string =>
              Boolean(value) &&
              array.indexOf(
                value
              ) === index
          );

        let attempt = 0;

        const attach =
          (
            metadataUrl: string
          ) => {
            cleanupCurrent();

            if (
              disposed ||
              requestId !==
                weatherLoadSequenceRef.current
            ) {
              return;
            }

            const sourceId =
              `${WEATHER_SOURCE_PREFIX}${requestId}-${attempt}`;

            const layerId =
              `${WEATHER_LAYER_PREFIX}${requestId}-${attempt}`;

            map.addSource(
              sourceId,
              {
                type: "raster",
                url:
                  gfsRasterUrl(
                    manifest,
                    metadataUrl
                  ),
                maxzoom: 12,
                attribution:
                  manifest.attribution,
              }
            );

            map.addLayer({
              id: layerId,
              type: "raster",
              source:
                sourceId,
              paint: {
                "raster-opacity":
                  overlayOpacity /
                  100,
                "raster-fade-duration":
                  100,
                "raster-resampling":
                  "linear",
              },
            });

            activeWeatherRef.current =
              {
                sourceId,
                layerId,
              };

            setOverlayStatus({
              phase:
                attempt === 0
                  ? "streaming"
                  : "retrying",
              modelLabel:
                manifest.modelLabel,
              validTime:
                manifest.validTime,
            });

            let failed =
              false;

            let settleTimer:
              number | null =
              null;

            const markReady =
              () => {
                if (
                  failed ||
                  disposed ||
                  requestId !==
                    weatherLoadSequenceRef.current
                ) {
                  return;
                }

                setOverlayStatus({
                  phase:
                    "ready",
                  modelLabel:
                    manifest.modelLabel,
                  validTime:
                    manifest.validTime,
                });
              };

            const onSourceData =
              (event: any) => {
                if (
                  event.sourceId !==
                    sourceId
                ) {
                  return;
                }

                try {
                  if (
                    map.isSourceLoaded(
                      sourceId
                    )
                  ) {
                    markReady();
                  }
                } catch {}
              };

            const onError =
              (event: any) => {
                if (
                  disposed ||
                  requestId !==
                    weatherLoadSequenceRef.current
                ) {
                  return;
                }

                const message =
                  String(
                    event?.error
                      ?.message ||
                      ""
                  );

                const relevant =
                  event?.sourceId ===
                    sourceId ||
                  isOmReadError(
                    message
                  );

                if (
                  !relevant
                ) {
                  return;
                }

                failed =
                  true;

                if (
                  settleTimer !==
                  null
                ) {
                  window.clearTimeout(
                    settleTimer
                  );
                }

                map.off(
                  "sourcedata",
                  onSourceData
                );
                map.off(
                  "error",
                  onError
                );

                const next =
                  metadataCandidates[
                    attempt + 1
                  ];

                if (next) {
                  attempt += 1;

                  setOverlayStatus({
                    phase:
                      "retrying",
                    modelLabel:
                      manifest.modelLabel,
                    validTime:
                      manifest.validTime,
                  });

                  window.setTimeout(
                    () =>
                      attach(
                        next
                      ),
                    120
                  );

                  return;
                }

                console.warn(
                  `${weatherLayer} OM weather source failed:`,
                  event?.error ||
                    event
                );

                setOverlayStatus({
                  phase:
                    "error",
                  modelLabel:
                    manifest.modelLabel,
                  validTime:
                    manifest.validTime,
                  error:
                    "Weather tiles could not be read reliably from the upstream OM service.",
                });
              };

            map.on(
              "sourcedata",
              onSourceData
            );
            map.on(
              "error",
              onError
            );

            settleTimer =
              window.setTimeout(
                markReady,
                3500
              );

            weatherCleanupRef.current =
              () => {
                if (
                  settleTimer !==
                  null
                ) {
                  window.clearTimeout(
                    settleTimer
                  );
                }

                map.off(
                  "sourcedata",
                  onSourceData
                );
                map.off(
                  "error",
                  onError
                );
              };
          };

        const first =
          metadataCandidates[0];

        if (!first) {
          throw new Error(
            "No spatial weather source is available."
          );
        }

        attach(first);

        prefetchGfsManifest(
          Math.min(
            12,
            forecastOffset + 1
          ),
          weatherLayer
        );
      } catch (error) {
        if (
          disposed ||
          requestId !==
            weatherLoadSequenceRef.current
        ) {
          return;
        }

        console.warn(
          "Weather map layer failed:",
          error
        );

        setOverlayStatus({
          phase: "error",
          error:
            error instanceof Error
              ? error.message
              : "The weather layer could not be loaded.",
        });
      }
    })();

    return () => {
      disposed = true;

      if (
        requestId ===
        weatherLoadSequenceRef.current
      ) {
        weatherLoadSequenceRef.current +=
          1;
      }

      cleanupCurrent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapReady,
    styleRevision,
    weatherLayer,
    forecastOffset,
  ]);

  // Opacity changes are paint-only. They NEVER recreate the OM source.
  // Debouncing reduces unnecessary map repaints while the user drags.
  useEffect(() => {
    if (
      opacityTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        opacityTimerRef.current
      );
    }

    opacityTimerRef.current =
      window.setTimeout(
        () => {
          setOverlayOpacity(
            opacityDraft
          );
        },
        120
      );

    return () => {
      if (
        opacityTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          opacityTimerRef.current
        );
      }
    };
  }, [opacityDraft]);

  useEffect(() => {
    const map =
      mapRef.current;

    const active =
      activeWeatherRef.current;

    if (
      !mapReady ||
      !map ||
      !active
    ) {
      return;
    }

    try {
      if (
        map.getLayer(
          active.layerId
        )
      ) {
        map.setPaintProperty(
          active.layerId,
          "raster-opacity",
          overlayOpacity /
            100
        );
      }
    } catch {
      // Source may be changing at the same moment.
    }
  }, [
    overlayOpacity,
    mapReady,
  ]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    if (
      weatherLayer ===
      "base"
    ) {
      setIsPlaying(false);
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          setForecastOffset(
            (current) =>
              current >= 12
                ? 0
                : current + 1
          );
        },
        Math.round(
          1700 /
            playbackSpeed
        )
      );

    return () =>
      window.clearTimeout(
        timer
      );
  }, [
    isPlaying,
    forecastOffset,
    playbackSpeed,
    weatherLayer,
  ]);

  const handleViewForecast =
    () => {
      if (!preview) {
        return;
      }

      onSelectLocation(
        preview.lat,
        preview.lon
      );

      setPreview(null);
    };

  const WeatherIcon =
    weatherLayer ===
    "temperature"
      ? Thermometer
      : weatherLayer ===
          "rain"
        ? CloudRain
        : weatherLayer ===
            "clouds"
          ? Cloud
          : weatherLayer ===
              "wind"
            ? Wind
            : MapIcon;

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/65 shadow-xl sm:rounded-3xl">
      <div className="flex min-w-0 flex-col gap-3 border-b border-slate-800 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg sm:text-sm font-semibold">
            <MapPin
              size={16}
              className="text-sky-400"
            />
            Explore Weather
          </div>

          <p className="mt-1 text-base sm:text-sm sm:text-xs text-slate-400">
            Weather, basemap and terrain are isolated controls.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={
              handleUseMyLocation
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/65 min-h-11 px-3.5 py-2.5 text-[13px] sm:min-h-0 sm:px-3 sm:py-2 sm:text-[10px] font-semibold text-slate-300 transition hover:text-white"
          >
            <LocateFixed
              size={13}
            />
            My Location
          </button>

          <button
            type="button"
            onClick={
              copyShareLink
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/65 min-h-11 px-3.5 py-2.5 text-[13px] sm:min-h-0 sm:px-3 sm:py-2 sm:text-[10px] font-semibold text-slate-300 transition hover:text-white"
          >
            {shareStatus ===
            "copied" ? (
              <Check
                size={13}
                className="text-emerald-400"
              />
            ) : (
              <Link2
                size={13}
              />
            )}

            {shareStatus ===
            "copied"
              ? "Copied"
              : shareStatus ===
                  "error"
                ? "Copy failed"
                : "Share Map"}
          </button>
        </div>
      </div>

      <div className="border-b border-slate-800 bg-slate-950/35 px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {WEATHER_LAYERS.map(
            ({
              id,
              label,
            }) => {
              const active =
                weatherLayer ===
                id;

              const Icon =
                id ===
                "temperature"
                  ? Thermometer
                  : id ===
                      "rain"
                    ? CloudRain
                    : id ===
                        "clouds"
                      ? Cloud
                      : id ===
                          "wind"
                        ? Wind
                        : MapIcon;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setIsPlaying(
                      false
                    );

                    setWeatherLayer(
                      id
                    );
                  }}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-base sm:text-sm sm:text-[11px] font-semibold transition ${
                    active
                      ? "bg-blue-600 text-white"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
                  }`}
                >
                  {active &&
                  overlayStatus.phase ===
                    "loading" ? (
                    <Loader2
                      size={13}
                      className="animate-spin"
                    />
                  ) : (
                    <Icon
                      size={13}
                    />
                  )}

                  {label}
                </button>
              );
            }
          )}
        </div>
      </div>

      <div className="border-b border-slate-800 bg-slate-950/30 px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-base sm:text-sm sm:text-xs sm:text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">
            Base
          </span>

          <div className="inline-flex shrink-0 rounded-xl border border-slate-700 bg-slate-950/70 p-0.5">
            <button
              type="button"
              onClick={() =>
                setBaseMapMode(
                  "dark"
                )
              }
              className={`inline-flex items-center gap-1.5 rounded-lg min-h-10 px-3 py-2 text-[13px] sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-[10px] font-bold ${
                baseMapMode ===
                "dark"
                  ? "bg-slate-700 text-white"
                  : "text-slate-400"
              }`}
            >
              <MapIcon
                size={12}
              />
              Dark
            </button>

            <button
              type="button"
              onClick={() =>
                setBaseMapMode(
                  "satellite"
                )
              }
              className={`inline-flex items-center gap-1.5 rounded-lg min-h-10 px-3 py-2 text-[13px] sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-[10px] font-bold ${
                baseMapMode ===
                "satellite"
                  ? "bg-sky-600 text-white"
                  : "text-slate-400"
              }`}
            >
              <Satellite
                size={12}
              />
              Satellite
            </button>
          </div>

          <span className="ml-1 shrink-0 text-base sm:text-sm sm:text-xs sm:text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">
            Terrain
          </span>

          <div className="inline-flex shrink-0 rounded-xl border border-slate-700 bg-slate-950/70 p-0.5">
            <button
              type="button"
              onClick={() =>
                setTerrainMode(
                  "off"
                )
              }
              className={`rounded-lg min-h-10 px-3 py-2 text-[13px] sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-[10px] font-bold ${
                terrainMode ===
                "off"
                  ? "bg-slate-700 text-white"
                  : "text-slate-400"
              }`}
            >
              Flat
            </button>

            <button
              type="button"
              onClick={() =>
                setTerrainMode(
                  "hillshade"
                )
              }
              className={`inline-flex items-center gap-1.5 rounded-lg min-h-10 px-3 py-2 text-[13px] sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-[10px] font-bold ${
                terrainMode ===
                "hillshade"
                  ? "bg-amber-600 text-white"
                  : "text-slate-400"
              }`}
            >
              <Mountain
                size={12}
              />
              Relief
            </button>

            <button
              type="button"
              onClick={() =>
                setTerrainMode(
                  "3d"
                )
              }
              className={`inline-flex items-center gap-1.5 rounded-lg min-h-10 px-3 py-2 text-[13px] sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-[10px] font-bold ${
                terrainMode ===
                "3d"
                  ? "bg-violet-600 text-white"
                  : "text-slate-400"
              }`}
            >
              <Mountain
                size={12}
              />
              3D
            </button>
          </div>
        </div>
      </div>

      {weatherLayer !==
        "base" && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/45 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 text-[13px] sm:text-[10px]">
            <WeatherIcon
              size={13}
              className="shrink-0 text-sky-300"
            />

            <span className="font-semibold text-slate-200">
              {activeLayerLabel}
            </span>

            {overlayStatus.phase ===
              "loading" && (
              <span className="text-slate-500">
                Preparing source…
              </span>
            )}

            {overlayStatus.phase ===
              "streaming" && (
              <span className="text-slate-500">
                Streaming tiles…
              </span>
            )}

            {overlayStatus.phase ===
              "retrying" && (
              <span className="text-amber-300">
                Retrying tile host…
              </span>
            )}

            {overlayStatus.phase ===
              "ready" && (
              <span className="text-emerald-400">
                Active
              </span>
            )}

            {overlayStatus.modelLabel && (
              <span className="hidden text-slate-600 sm:inline">
                ·{" "}
                {
                  overlayStatus.modelLabel
                }
              </span>
            )}

            {overlayStatus.validTime && (
              <span className="text-slate-600">
                ·{" "}
                {formatValidTime(
                  overlayStatus.validTime
                )}
              </span>
            )}
          </div>

          {overlayStatus.phase ===
            "error" && (
            <span className="max-w-full text-[13px] sm:text-[10px] text-amber-300">
              {overlayStatus.error ||
                "Layer unavailable"}
            </span>
          )}
        </div>
      )}

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[340px] w-full bg-slate-950 sm:h-[430px] lg:h-[480px]"
        />

        {showCurrentConditions && (
          <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[70%] rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 backdrop-blur-md sm:left-4 sm:top-4">
            <div className="truncate text-[13px] sm:text-[10px] font-semibold text-slate-300">
              {locationName}
            </div>

            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-xl font-bold text-white">
                {displayTemperature(
                  temperature
                )}
              </span>

              <span className="text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-500">
                {
                  getWmoStatus(
                    weatherCode
                  ).label
                }
              </span>
            </div>
          </div>
        )}

        {baseMapMode ===
          "satellite" && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full border border-sky-400/15 bg-slate-950/80 px-2 py-1 text-base sm:text-sm sm:text-[11px] sm:text-[8px] font-semibold text-sky-200 backdrop-blur sm:left-4">
            NASA VIIRS ·{" "}
            {nasaDate}
          </div>
        )}

        {terrainMode !==
          "off" && (
          <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full border border-violet-400/15 bg-slate-950/80 px-2 py-1 text-base sm:text-sm sm:text-[11px] sm:text-[8px] font-semibold text-violet-200 backdrop-blur sm:right-4">
            {terrainMode ===
            "3d"
              ? "3D terrain"
              : "Terrain relief"}
          </div>
        )}

        {previewLoading && (
          <div className="absolute inset-x-0 bottom-3 z-20 mx-auto flex w-fit items-center gap-2 rounded-full border border-slate-700 bg-slate-950/90 min-h-11 px-3.5 py-2.5 text-[13px] sm:min-h-0 sm:px-3 sm:py-2 sm:text-[10px] text-slate-300 backdrop-blur">
            <Loader2
              size={12}
              className="animate-spin"
            />
            Loading selected point…
          </div>
        )}

        {preview && (
          <div className="absolute bottom-3 left-3 right-3 z-20 rounded-2xl border border-slate-700 bg-slate-950/95 p-3 shadow-2xl backdrop-blur sm:left-auto sm:right-4 sm:w-[300px]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-base sm:text-sm sm:text-xs font-semibold text-white">
                  {preview.name}
                </div>

                <div className="mt-1 text-[13px] sm:text-[10px] text-slate-500">
                  {preview.lat.toFixed(
                    4
                  )}
                  ,{" "}
                  {preview.lon.toFixed(
                    4
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setPreview(
                    null
                  )
                }
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
              >
                <X
                  size={14}
                />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-2xl font-bold text-white">
                  {displayTemperature(
                    preview.temperature
                  )}
                </div>

                <div className="text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-500">
                  {
                    getWmoStatus(
                      preview.weatherCode
                    ).label
                  }
                </div>
              </div>

              <button
                type="button"
                onClick={
                  handleViewForecast
                }
                className="rounded-xl bg-blue-600 min-h-11 px-3.5 py-2.5 text-[13px] sm:min-h-0 sm:px-3 sm:py-2 sm:text-[10px] font-bold text-white transition hover:bg-blue-500"
              >
                View Forecast
              </button>
            </div>
          </div>
        )}
      </div>

      {mapMessage && (
        <div className="flex items-center justify-between gap-3 border-t border-amber-500/15 bg-amber-950/20 min-h-11 px-3.5 py-2.5 text-[13px] sm:min-h-0 sm:px-3 sm:py-2 sm:text-[10px] text-amber-200 sm:px-5">
          <span>
            {mapMessage}
          </span>

          <button
            type="button"
            onClick={() =>
              setMapMessage(
                null
              )
            }
          >
            <X
              size={13}
            />
          </button>
        </div>
      )}

      {weatherLayer !==
        "base" && (
        <div className="border-t border-slate-800 bg-slate-950/55 px-3 py-3 sm:px-5">
          <div className="flex flex-col gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setForecastOffset(
                    (current) =>
                      Math.max(
                        0,
                        current - 1
                      )
                  )
                }
                className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white"
              >
                <ChevronLeft
                  size={14}
                />
              </button>

              <button
                type="button"
                onClick={() =>
                  setIsPlaying(
                    (current) =>
                      !current
                  )
                }
                className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:text-white"
              >
                {isPlaying ? (
                  <Pause
                    size={14}
                  />
                ) : (
                  <Play
                    size={14}
                  />
                )}
              </button>

              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={
                  forecastOffset
                }
                onChange={(
                  event
                ) => {
                  setIsPlaying(
                    false
                  );

                  setForecastOffset(
                    Number(
                      event.target
                        .value
                    )
                  );
                }}
                className="min-w-0 flex-1 accent-blue-500"
                aria-label="Forecast hour"
              />

              <button
                type="button"
                onClick={() =>
                  setForecastOffset(
                    (current) =>
                      Math.min(
                        12,
                        current + 1
                      )
                  )
                }
                className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white"
              >
                <ChevronRight
                  size={14}
                />
              </button>

              <span className="w-12 shrink-0 text-right text-[13px] sm:text-[10px] font-bold text-slate-300">
                {forecastOffset ===
                0
                  ? "Now"
                  : `+${forecastOffset}h`}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-w-[180px] flex-1 items-center gap-2 text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                Opacity

                <input
                  type="range"
                  min={20}
                  max={100}
                  value={
                    opacityDraft
                  }
                  onChange={(
                    event
                  ) =>
                    setOpacityDraft(
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                  className="min-w-0 flex-1 accent-sky-500"
                />

                <span className="w-8 text-right text-slate-400">
                  {
                    opacityDraft
                  }
                  %
                </span>
              </label>

              <div className="flex items-center gap-1 text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-500">
                <span>
                  Speed
                </span>

                {(
                  [
                    0.5,
                    1,
                    2,
                  ] as const
                ).map(
                  (speed) => (
                    <button
                      key={
                        speed
                      }
                      type="button"
                      onClick={() =>
                        setPlaybackSpeed(
                          speed
                        )
                      }
                      className={`rounded-md px-2 py-1 ${
                        playbackSpeed ===
                        speed
                          ? "bg-slate-700 text-white"
                          : "text-slate-500"
                      }`}
                    >
                      {
                        speed
                      }
                      ×
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-800 bg-slate-950/50 px-3 py-1.5 text-base sm:text-sm sm:text-[11px] sm:text-[8px] text-slate-600 sm:px-5">
        <span>
          Map: OSM · CARTO
          {baseMapMode ===
            "satellite"
            ? " · NASA GIBS"
            : ""}
          {terrainMode !==
            "off"
            ? " · Mapterhorn"
            : ""}
        </span>

        <span>
          Weather:{" "}
          {weatherLayer ===
          "base"
            ? "—"
            : overlayStatus
                  .modelLabel ||
              "Open-Meteo spatial"}
        </span>
      </div>

      {weatherLayer ===
        "wind" && (
        <div className="border-t border-slate-800 bg-slate-950/30 px-3 py-2 text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-600 sm:px-5">
          Wind is a forecast field, not a particle animation. The upstream open-source map layer supports a wind raster and directional arrows, but does not provide a documented moving-particle renderer.
        </div>
      )}

      <div className="border-t border-slate-800 bg-slate-950/30 px-3 py-2 text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-600 sm:px-5">
        AQI remains intentionally hidden from the map and stays available in the main forecast dashboard.
      </div>
    </section>
  );
}
