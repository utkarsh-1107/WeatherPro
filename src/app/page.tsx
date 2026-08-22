"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  getCoordinates,
  startWeatherSWR,
  reverseGeocode,
  cToF,
  kmhToMph,
  hpaToMmhg,
  getWindDirectionLabel,
  type ComprehensiveWeatherData,
  type HourlyWeatherPoint,
} from "@/lib/weather";
import {
  generateAlerts,
  generateInsights,
  getActivityScores,
  getAqiLabel,
  getOutdoorScore,
} from "@/lib/alerts";
import { getWmoStatus } from "@/lib/wmo";
import WeatherBackground from "./components/WeatherBackground";
import WeatherMap from "./components/WeatherMap";
import {
  Search,
  Loader2,
  MapPin,
  Wind,
  Droplets,
  Sun,
  ShieldAlert,
  LocateFixed,
  Navigation,
  RefreshCcw,
  Share2,
  Star,
  Clock3,
  Sunrise,
  Sunset,
  Gauge,
  CloudRain,
  Thermometer,
  Settings2,
  X,
  Download,
  History,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const LOCATION_CACHE_KEY = "weather_app_location";
const WEATHER_CACHE_KEY = "weather_app_last_weather";
const RECENT_KEY = "weather_app_recent";
const FAVOURITES_KEY = "weather_app_favourites";
const UNIT_KEY = "weather_app_units";
const LOCATION_CACHE_TTL = 6 * 60 * 60 * 1000;
const WEATHER_CACHE_FRESH_TTL =
  5 * 60 * 1000;
const WEATHER_CACHE_STALE_TTL =
  6 * 60 * 60 * 1000;

const GLOBAL_MAP_FALLBACK = {
  // Neutral world view. Browser GPS itself is never country-limited.
  lat: 20,
  lon: 0,
  zoom: 1.8,
} as const;

type WeatherState = ComprehensiveWeatherData | null;
type UnitSystem = "metric" | "imperial";

// Search and GPS are both worldwide. No country filter is applied.
type GlobalPlace = {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  country?: string;
  admin1?: string;
  admin2?: string;
  timezone?: string;
  source: "open-meteo" | "nominatim";
};

type CachedLocation = {
  lat: number;
  lon: number;
  name: string;
  timestamp: number;
};

type StoredWeather = {
  weather: ComprehensiveWeatherData;
  timestamp: number;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

function getCachedLocation(): CachedLocation | null {
  const value = readJson<CachedLocation | null>(LOCATION_CACHE_KEY, null);
  if (!value) return null;

  const fresh = Date.now() - value.timestamp < LOCATION_CACHE_TTL;
  const valid = Number.isFinite(value.lat) && Number.isFinite(value.lon) && Boolean(value.name);
  if (fresh && valid) return value;

  localStorage.removeItem(LOCATION_CACHE_KEY);
  return null;
}

function setCachedLocation(lat: number, lon: number, name: string) {
  writeJson(LOCATION_CACHE_KEY, { lat, lon, name, timestamp: Date.now() });
}

function getCachedWeatherRecord():
  | (StoredWeather & {
      freshness: "fresh" | "stale";
      ageMs: number;
    })
  | null {
  const stored =
    readJson<StoredWeather | null>(
      WEATHER_CACHE_KEY,
      null
    );

  if (!stored) return null;

  const ageMs = Math.max(
    0,
    Date.now() - stored.timestamp
  );

  if (
    ageMs >
    WEATHER_CACHE_STALE_TTL
  ) {
    localStorage.removeItem(
      WEATHER_CACHE_KEY
    );
    return null;
  }

  return {
    ...stored,
    ageMs,
    freshness:
      ageMs <= WEATHER_CACHE_FRESH_TTL
        ? "fresh"
        : "stale",
  };
}

function getCachedWeather():
  | ComprehensiveWeatherData
  | null {
  return (
    getCachedWeatherRecord()?.weather ||
    null
  );
}

function saveCachedWeather(weather: ComprehensiveWeatherData) {
  writeJson(WEATHER_CACHE_KEY, { weather, timestamp: Date.now() });
}

function updateUrl(cityName: string) {
  const url = new URL(
    window.location.href
  );

  url.searchParams.set(
    "city",
    cityName
  );

  // Map panning must never become the next page-load location.
  // These params are reserved for explicit shared links only.
  [
    "share",
    "lat",
    "lon",
    "zoom",
    "layer",
    "hour",
    "opacity",
    "speed",
    "loop",
    "basemap",
    "terrain",
  ].forEach((key) =>
    url.searchParams.delete(
      key
    )
  );

  window.history.replaceState(
    {},
    "",
    url.toString()
  );
}

export default function Home() {
  const [city, setCity] = useState("");
  const [weather, setWeather] = useState<WeatherState>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dataTransitioning, setDataTransitioning] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineData, setIsOfflineData] = useState(false);
  const [recentCities, setRecentCities] = useState<string[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aqiOpen, setAqiOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<GlobalPlace[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mapFlyToTarget, setMapFlyToTarget] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [showGlobalFallbackMap, setShowGlobalFallbackMap] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const hourlyScrollRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const didInitialize = useRef(false);
  const weatherRef = useRef<WeatherState>(null);
  const weatherRequestSequenceRef = useRef(0);
  const transitionTimerRef = useRef<number | null>(null);

  const weatherAlerts = weather ? generateAlerts(weather) : [];
  const insights = weather ? generateInsights(weather) : [];
  const outdoor = weather ? getOutdoorScore(weather) : null;
  const activities = weather ? getActivityScores(weather) : [];
  const aqiInfo = weather?.airQuality?.usAqi != null ? getAqiLabel(weather.airQuality.usAqi) : null;

  const todayHigh = weather?.daily?.temperatureMax?.[0];
  const todayLow = weather?.daily?.temperatureMin?.[0];

  const addRecent = useCallback((name: string) => {
    setRecentCities((previous) => {
      const next = [name, ...previous.filter((item) => item.toLowerCase() !== name.toLowerCase())].slice(0, 5);
      writeJson(RECENT_KEY, next);
      return next;
    });
  }, []);

  const beginWeatherRequest =
    useCallback(() => {
      if (weatherRef.current) {
        setRefreshing(true);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }, []);

  const finishWeatherRequest =
    useCallback(() => {
      setLoading(false);
      setRefreshing(false);
    }, []);

  const applyWeather = useCallback(
    (
      data: Omit<
        ComprehensiveWeatherData,
        "cityName"
      >,
      name: string,
      {
        offline = false,
        persist = true,
        animate = true,
        navigate = true,
      }: {
        offline?: boolean;
        persist?: boolean;
        animate?: boolean;
        navigate?: boolean;
      } = {}
    ) => {
      const full: ComprehensiveWeatherData = {
        ...data,
        cityName: name,
      };

      const hadWeather =
        Boolean(weatherRef.current);

      if (animate && hadWeather) {
        setDataTransitioning(true);

        if (
          transitionTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            transitionTimerRef.current
          );
        }

        transitionTimerRef.current =
          window.setTimeout(() => {
            setDataTransitioning(false);
            transitionTimerRef.current =
              null;
          }, 190);
      }

      weatherRef.current = full;
      setWeather(full);
      setIsOfflineData(offline);
      setError(null);

      if (persist) {
        saveCachedWeather(full);
      }

      addRecent(name);

      if (navigate) {
        updateUrl(name);
      }
    },
    [addRecent]
  );

  const fallbackToCache = useCallback(
    (message: string) => {
      const cached = getCachedWeather();

      if (cached) {
        weatherRef.current = cached;
        setWeather(cached);
        setIsOfflineData(true);
        setError(
          `${message} Showing the most recent saved forecast.`
        );
        return true;
      }

      setError(message);
      return false;
    },
    []
  );

  const fetchPlaceWeather = useCallback(
    async (place: GlobalPlace) => {
      const requestId =
        ++weatherRequestSequenceRef.current;

      beginWeatherRequest();
      setDetectingLocation(false);
      setError(null);
      setSearchOpen(false);
      setSearchSuggestions([]);
      setCity("");
      setLocationAccuracy(null);
      setShowGlobalFallbackMap(false);

      setMapFlyToTarget({
        lat: place.lat,
        lon: place.lon,
        zoom: 12.5,
      });

      const displayName =
        place.displayName || place.name;

      const swr = startWeatherSWR(
        place.lat,
        place.lon,
        place.timezone
      );

      if (
        swr.cached &&
        requestId ===
          weatherRequestSequenceRef.current
      ) {
        applyWeather(
          swr.cached,
          displayName,
          {
            persist: false,
            animate: false,
          }
        );
        setRefreshing(true);
      }

      try {
        const data = await swr.fresh;

        if (
          requestId !==
          weatherRequestSequenceRef.current
        ) {
          return;
        }

        applyWeather(
          data,
          displayName,
          {
            animate: Boolean(swr.cached),
          }
        );

        setCachedLocation(
          place.lat,
          place.lon,
          displayName
        );
      } catch (err) {
        if (
          requestId !==
          weatherRequestSequenceRef.current
        ) {
          return;
        }

        console.warn(
          "Weather request failed:",
          err
        );

        if (swr.cached) {
          setIsOfflineData(true);
          setError(
            "Fresh weather is temporarily unavailable. Showing cached weather."
          );
        } else {
          fallbackToCache(
            "Unable to load weather for that place right now."
          );
        }
      } finally {
        if (
          requestId ===
          weatherRequestSequenceRef.current
        ) {
          finishWeatherRequest();
        }
      }
    },
    [
      applyWeather,
      beginWeatherRequest,
      fallbackToCache,
      finishWeatherRequest,
    ]
  );

  const searchGlobalPlaces = useCallback(
    async (query: string, signal?: AbortSignal): Promise<GlobalPlace[]> => {
      const trimmed = query.trim();

      if (trimmed.length < 2) return [];

      const response = await fetch(
        `/api/geocoding?q=${encodeURIComponent(trimmed)}&limit=8`,
        {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
          signal,
        }
      );

      const contentType = response.headers.get("content-type") || "";

      if (!response.ok || !contentType.includes("application/json")) {
        const message = await response.text();
        throw new Error(
          `Place search failed (${response.status}): ${message.slice(0, 120)}`
        );
      }

      const payload = (await response.json()) as {
        results?: GlobalPlace[];
      };

      return Array.isArray(payload.results) ? payload.results : [];
    },
    []
  );

  const fetchWeather = useCallback(
    async (placeName: string) => {
      const searchName =
        placeName.trim();

      if (!searchName) return;

      beginWeatherRequest();
      setError(null);

      try {
        const results =
          await searchGlobalPlaces(
            searchName
          );

        const place = results[0];

        if (!place) {
          setError(
            `No global place match found for "${searchName}".`
          );
          setSearchOpen(true);
          finishWeatherRequest();
          return;
        }

        await fetchPlaceWeather(place);
      } catch (err) {
        console.warn(
          "Weather request failed:",
          err
        );
        setError(
          "Global place search is temporarily unavailable."
        );
        finishWeatherRequest();
      }
    },
    [
      beginWeatherRequest,
      fetchPlaceWeather,
      finishWeatherRequest,
      searchGlobalPlaces,
    ]
  );

  const fetchWeatherByCoords = useCallback(
    async (
      lat: number,
      lon: number,
      knownName?: string,
      options: {
        preserveUrl?: boolean;
      } = {}
    ) => {
      const validGlobalCoordinates =
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180;

      if (!validGlobalCoordinates) {
        setLoading(false);
        setRefreshing(false);
        setDetectingLocation(false);
        setError(
          "The selected coordinates are outside the valid global GPS range."
        );
        return;
      }

      const requestId =
        ++weatherRequestSequenceRef.current;

      beginWeatherRequest();
      setError(null);
      setShowGlobalFallbackMap(false);

      // Always create a new target. Re-selecting the same GPS coordinates
      // must still recenter the map after the user has panned elsewhere.
      setMapFlyToTarget({
        lat,
        lon,
        zoom: 13.5,
      });

      const lastLocation =
        getCachedLocation();

      const closeToLastLocation =
        Boolean(
          lastLocation &&
            Math.abs(
              lastLocation.lat - lat
            ) < 0.03 &&
            Math.abs(
              lastLocation.lon - lon
            ) < 0.03
        );

      const provisionalName =
        knownName ||
        (closeToLastLocation &&
        lastLocation
          ? lastLocation.name
          : "Your Location");

      const swr = startWeatherSWR(
        lat,
        lon
      );

      if (
        swr.cached &&
        requestId ===
          weatherRequestSequenceRef.current
      ) {
        applyWeather(
          swr.cached,
          provisionalName,
          {
            persist: false,
            animate: false,
            navigate:
              options.preserveUrl
                ? false
                : Boolean(
                    knownName
                  ) ||
                  closeToLastLocation,
          }
        );
        setRefreshing(true);
      }

      const locationNamePromise =
        knownName
          ? Promise.resolve(knownName)
          : (async () => {
              setDetectingLocation(true);

              try {
                const location =
                  await reverseGeocode(
                    lat,
                    lon
                  );

                return location.name;
              } catch (
                geocodeError
              ) {
                console.warn(
                  "Reverse geocoding failed:",
                  geocodeError
                );

                return provisionalName;
              }
            })();

      try {
        const [data, locationName] =
          await Promise.all([
            swr.fresh,
            locationNamePromise,
          ]);

        if (
          requestId !==
          weatherRequestSequenceRef.current
        ) {
          return;
        }

        const finalName =
          locationName ||
          provisionalName;

        applyWeather(
          data,
          finalName,
          {
            animate: Boolean(
              weatherRef.current
            ),
            navigate:
              !options.preserveUrl,
          }
        );

        setCachedLocation(
          lat,
          lon,
          finalName
        );
      } catch (err) {
        if (
          requestId !==
          weatherRequestSequenceRef.current
        ) {
          return;
        }

        console.warn(
          "Weather request failed:",
          err
        );

        if (swr.cached) {
          setIsOfflineData(true);
          setError(
            "Fresh weather is temporarily unavailable. Showing cached weather."
          );
        } else {
          fallbackToCache(
            "Unable to load weather for your current location."
          );
        }
      } finally {
        if (
          requestId ===
          weatherRequestSequenceRef.current
        ) {
          setDetectingLocation(false);
          finishWeatherRequest();
        }
      }
    },
    [
      applyWeather,
      beginWeatherRequest,
      fallbackToCache,
      finishWeatherRequest,
    ]
  );

  const detectLocation = useCallback(
    () => {
      if (!navigator.geolocation) {
        setLoading(false);
        setDetectingLocation(false);
        setShowGlobalFallbackMap(true);
        setMapFlyToTarget(null);
        setError(
          "GPS is unavailable in this browser. The map has opened to a global view — search any place worldwide or tap anywhere to choose a location."
        );
        return;
      }

      if (!weatherRef.current) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setDetectingLocation(true);
      setLocationAccuracy(null);
      setShowGlobalFallbackMap(false);
      setError(null);

      let bestPosition: GeolocationPosition | null = null;
      let watchId: number | null = null;
      let finished = false;

      const acceptCandidate = (
        position: GeolocationPosition
      ) => {
        const { latitude, longitude, accuracy } =
          position.coords;

        const valid =
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180;

        if (!valid) {
          return;
        }

        if (
          !bestPosition ||
          accuracy < bestPosition.coords.accuracy
        ) {
          bestPosition = position;
          setLocationAccuracy(
            Math.round(accuracy)
          );
        }
      };

      const finish = () => {
        if (finished) return;
        finished = true;

        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
        }

        if (!bestPosition) {
          setDetectingLocation(false);
          setLoading(false);
          setShowGlobalFallbackMap(true);
          setMapFlyToTarget(null);
          setError(
            "GPS could not provide a usable position. The map has opened to a global view — search any place worldwide or tap anywhere to continue."
          );
          return;
        }

        setLocationAccuracy(Math.round(bestPosition.coords.accuracy));

        void fetchWeatherByCoords(
          bestPosition.coords.latitude,
          bestPosition.coords.longitude
        );
      };

      // Start with any recent browser location so international users on
      // desktop/Wi-Fi do not have to wait for a fresh high-accuracy GPS lock.
      navigator.geolocation.getCurrentPosition(
        (position) => {
          acceptCandidate(position);

          // A sub-500 m fix is already good enough to load local weather.
          // watchPosition can still win first if it returns a better fix.
          if (
            !finished &&
            position.coords.accuracy <= 500
          ) {
            finish();
          }
        },
        () => {
          // The high-accuracy watcher below remains authoritative.
        },
        {
          enableHighAccuracy: false,
          timeout: 3500,
          maximumAge: 5 * 60 * 1000,
        }
      );

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          acceptCandidate(position);

          // Stop early once the browser gives us a genuinely useful fix.
          if (position.coords.accuracy <= 50) {
            finish();
          }
        },
        (geoError) => {
          console.warn("Geolocation issue:", geoError);

          if (geoError.code === geoError.PERMISSION_DENIED) {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            finished = true;
            setDetectingLocation(false);
            setLoading(false);
            setShowGlobalFallbackMap(true);
            setMapFlyToTarget(null);
            setError(
              "Location access is turned off. The map has opened to a global view — allow GPS, search worldwide, or tap a point on the map."
            );
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        }
      );

      // Browser/Wi-Fi positioning often improves over the first few seconds.
      window.setTimeout(finish, 6000);
    },
    [fetchWeatherByCoords]
  );

  useEffect(() => {
    setRecentCities(readJson<string[]>(RECENT_KEY, []));
    setFavourites(readJson<string[]>(FAVOURITES_KEY, []));
    setUnits(readJson<UnitSystem>(UNIT_KEY, "metric"));

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setCity("");
        searchRef.current?.blur();
        setSettingsOpen(false);
        setAqiOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        onInstallPrompt
      );
      window.removeEventListener(
        "keydown",
        onKeyDown
      );

      if (
        transitionTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          transitionTimerRef.current
        );
      }
    };
  }, []);

  useEffect(() => {
    const query = city.trim();

    searchAbortRef.current?.abort();

    if (query.length < 2) {
      setSearchSuggestions([]);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;

    const timer = window.setTimeout(() => {
      setSearchLoading(true);

      void searchGlobalPlaces(query, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setSearchSuggestions(results);
          setSearchOpen(true);
        })
        .catch((searchError) => {
          if (controller.signal.aborted) return;
          console.warn("Autocomplete search failed:", searchError);
          setSearchSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearchLoading(false);
          }
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [city, searchGlobalPlaces]);

  useEffect(() => {
    if (didInitialize.current) return;
    didInitialize.current = true;

    const startupCache =
      getCachedWeatherRecord();

    if (startupCache) {
      weatherRef.current =
        startupCache.weather;
      setWeather(
        startupCache.weather
      );
      setIsOfflineData(false);
      setLoading(false);
      setRefreshing(true);
    }

    const params =
      new URLSearchParams(
        window.location.search
      );

    const isSharedLink =
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

    const hasSharedCoordinates =
      isSharedLink &&
      Number.isFinite(
        sharedLat
      ) &&
      Number.isFinite(
        sharedLon
      ) &&
      sharedLat >= -90 &&
      sharedLat <= 90 &&
      sharedLon >= -180 &&
      sharedLon <= 180;

    if (hasSharedCoordinates) {
      void fetchWeatherByCoords(
        sharedLat,
        sharedLon,
        params.get("city") ||
          "Shared Location",
        {
          preserveUrl: true,
        }
      );
      return;
    }

    // Normal refreshes always return to browser GPS instead of a stale map
    // pan or a previous city left in the URL.
    detectLocation();
  }, [detectLocation, fetchWeather, fetchWeatherByCoords]);

  const scrollHourly = (direction: "left" | "right") => {
    const container = hourlyScrollRef.current;
    if (!container) return;

    const amount = Math.max(260, Math.min(container.clientWidth * 0.72, 720));
    container.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  const handleHourlyWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const container = hourlyScrollRef.current;
    if (!container) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    const atStart = container.scrollLeft <= 0;
    const atEnd =
      Math.ceil(container.scrollLeft + container.clientWidth) >= container.scrollWidth;

    if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) return;

    event.preventDefault();
    container.scrollLeft += event.deltaY;
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const searchCity = city.trim();
    if (!searchCity) return;

    const currentSuggestion = searchSuggestions[0];

    if (currentSuggestion) {
      await fetchPlaceWeather(currentSuggestion);
      return;
    }

    setSearchLoading(true);

    try {
      const results = await searchGlobalPlaces(searchCity);
      const place = results[0];

      if (!place) {
        setError(
          `No place match found for "${searchCity}". Try a city, suburb, district, postcode or landmark.`
        );
        setSearchOpen(true);
        return;
      }

      await fetchPlaceWeather(place);
    } catch (searchError) {
      console.warn("Search request failed:", searchError);
      setError("Global place search is temporarily unavailable.");
    } finally {
      setSearchLoading(false);
    }
  };

  const toggleFavourite = () => {
    if (!weather) return;
    setFavourites((previous) => {
      const exists = previous.some((item) => item.toLowerCase() === weather.cityName.toLowerCase());
      const next = exists
        ? previous.filter((item) => item.toLowerCase() !== weather.cityName.toLowerCase())
        : [weather.cityName, ...previous].slice(0, 8);
      writeJson(FAVOURITES_KEY, next);
      return next;
    });
  };

  const changeUnits = (next: UnitSystem) => {
    setUnits(next);
    writeJson(UNIT_KEY, next);
  };

  const refreshWeather = () => {
    if (!weather) return;
    void fetchWeatherByCoords(weather.latitude, weather.longitude, weather.cityName);
  };

  const shareWeather = async () => {
    if (!weather) return;

    const temp =
      formatTemperature(
        weather.current.temperature,
        units
      );

    const text =
      `${weather.cityName}: ${temp}, ${getWmoStatus(
        weather.current.weathercode
      ).label}. Feels like ${formatTemperature(
        weather.extra.apparentTemperature,
        units
      )}${
        weather.airQuality
          ? `, AQI ${Math.round(
              weather.airQuality.usAqi
            )}`
          : ""
      }.`;

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
      weather.latitude.toFixed(
        5
      )
    );
    url.searchParams.set(
      "lon",
      weather.longitude.toFixed(
        5
      )
    );
    url.searchParams.set(
      "city",
      weather.cityName
    );

    try {
      if (navigator.share) {
        await navigator.share({
          title:
            `${weather.cityName} weather`,
          text,
          url:
            url.toString(),
        });
      } else if (
        navigator.clipboard
      ) {
        await navigator.clipboard.writeText(
          `${text} ${url.toString()}`
        );
        setError(
          "Weather summary copied to clipboard."
        );
      }
    } catch {
      // User cancelled sharing.
    }
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const status = weather ? getWmoStatus(weather.current.weathercode) : null;
  const WeatherIcon = status?.Icon;
  const isFavourite = weather
    ? favourites.some((item) => item.toLowerCase() === weather.cityName.toLowerCase())
    : false;

  const next12 = weather?.hourly.slice(0, 12) ?? [];
  const rainSummary = useMemo(() => getRainSummary(next12), [next12]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form onSubmit={handleSearch} className="relative flex w-full max-w-2xl gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                ref={searchRef}
                type="text"
                autoComplete="off"
                placeholder="Search any city or place worldwide…  /"
                value={city}
                onFocus={() => {
                  setSearchFocused(true);
                  if (city.trim().length >= 2) setSearchOpen(true);
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setSearchFocused(false);
                    setSearchOpen(false);
                  }, 150);
                }}
                onChange={(event) => {
                  setCity(event.target.value);
                  setSearchOpen(event.target.value.trim().length >= 2);
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {searchFocused && searchOpen && city.trim().length >= 2 && (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl">
                  {searchLoading ? (
                    <div className="flex items-center gap-3 px-4 py-4 text-base sm:text-sm text-slate-300">
                      <Loader2 size={16} className="animate-spin text-blue-400" />
                      Searching worldwide…
                    </div>
                  ) : searchSuggestions.length > 0 ? (
                    <div className="max-h-80 overflow-y-auto py-2">
                      {searchSuggestions.map((place) => (
                        <button
                          key={place.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void fetchPlaceWeather(place)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-800/80"
                        >
                          <MapPin size={16} className="mt-0.5 shrink-0 text-blue-400" />

                          <span className="min-w-0">
                            <span className="block truncate text-base sm:text-sm font-semibold text-white">
                              {place.name}
                            </span>

                            <span className="mt-0.5 block truncate text-base sm:text-sm sm:text-xs text-slate-400">
                              {place.displayName}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4">
                      <p className="text-base sm:text-sm font-medium text-slate-200">
                        No global place match
                      </p>
                      <p className="mt-1 text-base sm:text-sm sm:text-xs text-slate-500">
                        Try a city, suburb, district, postcode or well-known place.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => detectLocation()}
              aria-label="Use current location"
              title="Use my location"
              className="flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-4 transition hover:border-blue-500 hover:bg-slate-800 disabled:opacity-50"
            >
              {detectingLocation ? <Loader2 size={18} className="animate-spin text-blue-400" /> : <LocateFixed size={18} />}
            </button>

            <button
              type="submit"
              aria-label="Search"
              className="flex items-center justify-center rounded-xl bg-blue-600 px-5 transition hover:bg-blue-500 disabled:opacity-50"
            >
              {searchLoading ? (
                <Loader2
                  size={18}
                  className="animate-spin"
                />
              ) : (
                <Search size={18} />
              )}
            </button>
          </form>

          <div className="flex items-center gap-2">
            {installPrompt && (
              <button
                type="button"
                onClick={installApp}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-base sm:text-sm sm:text-xs text-slate-300 hover:bg-slate-800"
              >
                <Download size={15} /> Install
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen((value) => !value)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-base sm:text-sm sm:text-xs text-slate-300 hover:bg-slate-800"
            >
              <Settings2 size={15} /> Units
            </button>
          </div>
        </header>

        {settingsOpen && (
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div>
              <p className="text-base sm:text-sm font-semibold">Units</p>
              <p className="text-base sm:text-sm sm:text-xs text-slate-400">Temperature, wind and pressure update instantly.</p>
            </div>
            <div className="flex rounded-xl bg-slate-950 p-1">
              {(["metric", "imperial"] as UnitSystem[]).map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => changeUnits(option)}
                  className={`rounded-lg px-4 py-2 text-base sm:text-sm sm:text-xs font-semibold ${units === option ? "bg-blue-600 text-white" : "text-slate-400"}`}
                >
                  {option === "metric" ? "°C · km/h" : "°F · mph"}
                </button>
              ))}
            </div>
          </div>
        )}

        {detectingLocation && (
          <div className="mx-auto mb-4 flex w-fit items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-base sm:text-sm sm:text-xs font-medium text-blue-200">
            <Navigation size={14} className="text-blue-400" />
            {locationAccuracy !== null
              ? `Refining location · GPS ±${locationAccuracy} m`
              : "Detecting your location…"}
            <Loader2 size={13} className="animate-spin text-blue-400" />
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-base sm:text-sm sm:text-xs text-amber-100">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss message">
              <X size={16} />
            </button>
          </div>
        )}

        {!weather && showGlobalFallbackMap && !loading && (
          <div className="mb-6">
            <WeatherMap
              latitude={GLOBAL_MAP_FALLBACK.lat}
              longitude={GLOBAL_MAP_FALLBACK.lon}
              locationName="World"
              temperature={0}
              weatherCode={0}
              units={units}
              initialZoom={GLOBAL_MAP_FALLBACK.zoom}
              showCurrentConditions={false}
              onSelectLocation={(lat, lon) => {
                setLocationAccuracy(null);
                setShowGlobalFallbackMap(false);
                setMapFlyToTarget({ lat, lon, zoom: 10.5 });
                void fetchWeatherByCoords(lat, lon);
              }}
              onUseMyLocation={detectLocation}
              flyToTarget={null}
            />
          </div>
        )}

        {loading && !weather && <InitialSkeleton detectingLocation={detectingLocation} />}

        {weather && refreshing && (
          <div className="pointer-events-none fixed bottom-4 right-4 z-[70] inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-slate-950/90 px-3 py-2 text-[13px] sm:text-[10px] font-semibold text-blue-200 shadow-xl shadow-black/30 backdrop-blur-xl">
            <RefreshCcw
              size={12}
              className="animate-spin text-blue-400"
            />
            Updating weather…
          </div>
        )}

        {weather && status && WeatherIcon && (
          <div
            className={`space-y-5 transition-[opacity,transform] duration-200 ${
              dataTransitioning
                ? "translate-y-[1px] opacity-80"
                : "translate-y-0 opacity-100"
            }`}
          >
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
              <div className="space-y-4 lg:col-span-7">
                <section className="relative min-h-[245px] overflow-hidden rounded-3xl border border-slate-700/50 p-6 shadow-2xl sm:p-8">
                  <WeatherBackground weatherCode={weather.current.weathercode} isDay={weather.current.isDay} />
                  <div className="relative z-10 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="mb-2 flex items-start gap-2">
                        <MapPin size={16} className="mt-0.5 shrink-0 text-blue-300" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-base sm:text-sm font-semibold text-slate-100">
                              {weather.cityName || "Your Location"}
                            </span>
                            {isOfflineData && (
                              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[13px] sm:text-[10px] text-amber-300">
                                Saved data
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] sm:text-[10px] text-slate-400">
                            <span>Current location</span>
                            {locationAccuracy !== null && (
                              <>
                                <span>·</span>
                                <span className="text-cyan-300">GPS ±{locationAccuracy} m</span>
                              </>
                            )}
                            <span>·</span>
                            <span>
                              {weather.latitude.toFixed(4)}, {weather.longitude.toFixed(4)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <h1 className="my-1 text-5xl font-black tracking-tight sm:text-6xl">
                        {formatTemperature(weather.current.temperature, units)}
                      </h1>
                      <p className="text-base font-semibold text-blue-200 sm:text-lg">{status.label}</p>
                      <p className="mt-1 text-base sm:text-sm sm:text-xs text-slate-300 sm:text-sm">
                        Feels like {formatTemperature(weather.extra.apparentTemperature, units)}
                        {todayHigh !== undefined && todayLow !== undefined && (
                          <> · H: {formatTemperature(todayHigh, units)} · L: {formatTemperature(todayLow, units)}</>
                        )}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-2 text-base sm:text-sm sm:text-[11px] text-slate-300">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/35 px-2.5 py-1.5">
                          <Clock3 size={12} /> Updated {formatRelativeTime(weather.updatedAt)}
                        </span>
                        <button type="button" onClick={refreshWeather} className="inline-flex items-center gap-1 rounded-full bg-slate-950/35 px-2.5 py-1.5 hover:bg-slate-950/55">
                          <RefreshCcw size={12} /> Refresh
                        </button>
                        <button type="button" onClick={shareWeather} className="inline-flex items-center gap-1 rounded-full bg-slate-950/35 px-2.5 py-1.5 hover:bg-slate-950/55">
                          <Share2 size={12} /> Share
                        </button>
                        <button type="button" onClick={toggleFavourite} className="inline-flex items-center gap-1 rounded-full bg-slate-950/35 px-2.5 py-1.5 hover:bg-slate-950/55">
                          <Star size={12} className={isFavourite ? "fill-yellow-300 text-yellow-300" : ""} /> {isFavourite ? "Saved" : "Save"}
                        </button>
                      </div>
                    </div>
                    <div className="shrink-0 rounded-2xl border border-white/10 bg-slate-900/50 p-3 backdrop-blur-md sm:p-4">
                      <WeatherIcon size={68} className={`sm:h-[78px] sm:w-[78px] ${status.color}`} />
                    </div>
                  </div>
                </section>

                {weatherAlerts.length > 0 && (
                  <div className="space-y-2">
                    {weatherAlerts.map((weatherAlert) => (
                      <div
                        key={weatherAlert.id}
                        className={`flex items-start gap-3 rounded-2xl border p-4 ${
                          weatherAlert.severity === "danger"
                            ? "border-red-500/40 bg-red-950/60"
                            : weatherAlert.severity === "warning"
                              ? "border-amber-500/30 bg-amber-950/50"
                              : "border-slate-700 bg-slate-900/60"
                        }`}
                      >
                        <span className="text-2xl">{weatherAlert.icon}</span>
                        <div>
                          <div className="text-base sm:text-sm font-semibold">{weatherAlert.title}</div>
                          <div className="mt-0.5 text-base sm:text-sm sm:text-xs leading-relaxed text-slate-300">{weatherAlert.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {outdoor && (
                    <Panel>
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <SectionLabel>Outdoor Comfort</SectionLabel>
                        <span className="whitespace-nowrap text-base sm:text-sm font-bold">{outdoor.score}/100 · {outdoor.label}</span>
                      </div>
                      <p className="text-base sm:text-sm sm:text-xs leading-relaxed text-slate-400">{outdoor.reason}</p>
                      <ScoreBar score={outdoor.score} />
                    </Panel>
                  )}

                  {insights.length > 0 && (
                    <Panel>
                      <SectionLabel>Today&apos;s Insights</SectionLabel>
                      <div className="mt-3 space-y-3">
                        {insights.map((insight) => (
                          <div key={insight.id} className="flex items-start gap-3">
                            <span className="text-xl">{insight.icon}</span>
                            <div>
                              <div className="text-base sm:text-sm font-medium">{insight.title}</div>
                              <div className="text-base sm:text-sm sm:text-xs leading-relaxed text-slate-400">{insight.description}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  )}
                </div>
              </div>

              <div className="space-y-4 lg:col-span-5">
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard title="Wind" icon={<Wind size={16} className="text-blue-400" />}>
                    {formatWind(weather.current.windspeed, units)}
                    <p className="mt-1 text-base sm:text-sm sm:text-xs font-normal text-slate-400">{getWindDirectionLabel(weather.current.winddirection)} · {Math.round(weather.current.winddirection)}°</p>
                  </MetricCard>
                  <MetricCard title="Humidity" icon={<Droplets size={16} className="text-cyan-400" />}>
                    {Math.round(weather.extra.humidity)}%
                  </MetricCard>
                  <MetricCard title="UV Index" icon={<Sun size={16} className="text-amber-400" />}>
                    {weather.extra.uvIndex.toFixed(1)}
                  </MetricCard>
                  <button type="button" onClick={() => setAqiOpen((value) => !value)} className="text-left">
                    <MetricCard title="Air Quality" icon={<ShieldAlert size={16} className="text-emerald-400" />}>
                      {weather.airQuality?.usAqi ?? "N/A"}
                      {aqiInfo && <p className={`mt-1 text-base sm:text-sm sm:text-xs font-normal ${aqiInfo.color}`}>{aqiInfo.label} · US AQI</p>}
                    </MetricCard>
                  </button>
                </div>

                <Panel>
                  <SectionLabel>Today</SectionLabel>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <MiniMetric icon={<Sunrise size={17} />} label="Sunrise" value={formatClock(weather.daily.sunrise[0])} />
                    <MiniMetric icon={<Sunset size={17} />} label="Sunset" value={formatClock(weather.daily.sunset[0])} />
                    <MiniMetric icon={<Gauge size={17} />} label="Pressure" value={formatPressure(weather.extra.surfacePressure, units)} />
                    <MiniMetric icon={<CloudRain size={17} />} label="Rain today" value={`${weather.daily.precipitationProbabilityMax[0] ?? 0}%`} />
                  </div>
                </Panel>

                {aqiOpen && weather.airQuality && (
                  <Panel>
                    <div className="flex items-center justify-between">
                      <SectionLabel>Air Quality Details</SectionLabel>
                      <button type="button" onClick={() => setAqiOpen(false)}><X size={15} /></button>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <AirMetric title="US AQI" value={weather.airQuality.usAqi} />
                      <AirMetric title="PM2.5" value={weather.airQuality.pm25.toFixed(1)} />
                      <AirMetric title="PM10" value={weather.airQuality.pm10.toFixed(1)} />
                    </div>
                    <p className="mt-4 text-base sm:text-sm sm:text-xs leading-relaxed text-slate-400">
                      AQI uses the US scale. PM2.5 and PM10 values are particulate matter concentrations from the air-quality provider.
                    </p>
                  </Panel>
                )}
              </div>
            </div>

            <WeatherMap
              latitude={weather.latitude}
              longitude={weather.longitude}
              locationName={weather.cityName}
              temperature={weather.current.temperature}
              weatherCode={weather.current.weathercode}
              units={units}
              onSelectLocation={(lat, lon) => {
                setLocationAccuracy(null);
                setMapFlyToTarget({ lat, lon, zoom: 13.5 });
                void fetchWeatherByCoords(lat, lon);
              }}
              onUseMyLocation={detectLocation}
              flyToTarget={mapFlyToTarget}
              initialZoom={10.5}
              showCurrentConditions
            />

            <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <SectionLabel>Next 12 Hours</SectionLabel>
                  <h2 className="mt-1 text-xl font-semibold">Hourly forecast</h2>
                </div>
                <p className="text-base sm:text-sm sm:text-xs text-slate-400">{rainSummary}</p>
              </div>
              <div className="hourly-scroll-shell">
                <div className="hourly-scroll-fade hourly-scroll-fade-left" aria-hidden="true" />
                <div className="hourly-scroll-fade hourly-scroll-fade-right" aria-hidden="true" />

                <button
                  type="button"
                  onClick={() => scrollHourly("left")}
                  className="hourly-scroll-button hourly-scroll-button-left"
                  aria-label="Scroll hourly forecast left"
                  title="Earlier hours"
                >
                  <ChevronLeft size={18} />
                </button>

                <div
                  ref={hourlyScrollRef}
                  onWheel={handleHourlyWheel}
                  className="hourly-scroll"
                  tabIndex={0}
                  aria-label="Hourly weather forecast"
                >
                  <div className="flex min-w-max gap-2 px-1">
                    {next12.map((point, index) => (
                      <HourlyCard key={point.time} point={point} index={index} units={units} />
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => scrollHourly("right")}
                  className="hourly-scroll-button hourly-scroll-button-right"
                  aria-label="Scroll hourly forecast right"
                  title="Later hours"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Panel>
                <div className="relative">
                  <div className="pr-14 sm:pr-16">
                    <SectionLabel>Temperature</SectionLabel>
                    <h2 className="mt-1 text-lg font-semibold text-slate-100">
                      Next 12 hours
                    </h2>
                    <p className="mt-1 text-base sm:text-sm sm:text-xs leading-5 sm:leading-4 text-slate-500">
                      Hour-by-hour temperature movement at your selected location
                    </p>
                  </div>

                  <div className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-xl border border-blue-500/15 bg-blue-500/10">
                    <Thermometer size={18} className="text-blue-300" />
                  </div>
                </div>

                <TemperatureChart points={next12} units={units} />
              </Panel>

              <Panel>
                <div className="relative">
                  <div className="pr-14 sm:pr-16">
                    <SectionLabel>Rain Timeline</SectionLabel>
                    <h2 className="mt-1 text-lg font-semibold text-slate-100">
                      Precipitation probability
                    </h2>
                    <p className="mt-1 text-base sm:text-sm sm:text-xs leading-5 sm:leading-4 text-slate-500">
                      Rain chance and expected precipitation over the next 12 hours
                    </p>
                  </div>

                  <div className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/15 bg-sky-500/10">
                    <CloudRain size={18} className="text-sky-300" />
                  </div>
                </div>

                <RainChart points={next12} />
              </Panel>
            </div>

            <section>
              <div className="mb-3 sm:mb-4">
                <SectionLabel>Weather Intelligence</SectionLabel>
                <h2 className="mt-1 text-lg font-semibold sm:text-xl">
                  Best time to get things done
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                {activities.map((activity) => (
                  <div
                    key={activity.id}
                    className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className="text-xl leading-none sm:text-2xl"
                        aria-hidden="true"
                      >
                        {activity.icon}
                      </span>

                      <span className="shrink-0 rounded-full border border-slate-700 bg-slate-950/60 px-2 py-1 text-[13px] sm:text-[10px] font-bold tabular-nums text-slate-200 sm:text-xs">
                        {activity.score}
                        <span className="text-slate-500">/100</span>
                      </span>
                    </div>

                    <h3 className="mt-2.5 truncate text-base sm:text-sm font-semibold text-slate-100 sm:mt-3 sm:text-base">
                      {activity.label}
                    </h3>

                    <p className="mt-0.5 truncate text-[13px] sm:text-[10px] font-semibold text-blue-300 sm:text-xs">
                      {activity.rating}
                    </p>

                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-800 sm:mt-4 sm:h-2">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-500"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(100, activity.score)
                          )}%`,
                        }}
                      />
                    </div>

                    <p className="mt-2.5 line-clamp-3 text-[13px] sm:text-[10px] leading-5 sm:leading-4 text-slate-400 sm:mt-3 sm:text-xs sm:leading-relaxed">
                      {activity.reason}
                    </p>

                    {activity.bestWindow && (
                      <div className="mt-2 border-t border-slate-800/80 pt-2">
                        <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                          Best window
                        </p>
                        <p className="mt-0.5 truncate text-[13px] sm:text-[10px] font-semibold text-slate-200 sm:text-xs">
                          {activity.bestWindow}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <section className="lg:col-span-7">
                <Panel>
                  <SectionLabel>7-Day Forecast</SectionLabel>
                  <div className="mt-4 space-y-3">
                    {weather.daily.time.slice(0, 7).map((date, index) => (
                      <DailyRow key={date} weather={weather} date={date} index={index} units={units} />
                    ))}
                  </div>
                </Panel>
              </section>

              <section className="space-y-5 lg:col-span-5">
                {weather.historical && (
                  <Panel>
                    <div className="flex items-center gap-2">
                      <History size={16} className="text-slate-500" />
                      <SectionLabel>One Year Ago</SectionLabel>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <MiniMetric label="High" value={formatTemperature(weather.historical.temperatureMax, units)} />
                      <MiniMetric label="Low" value={formatTemperature(weather.historical.temperatureMin, units)} />
                      <MiniMetric label="Rain" value={`${weather.historical.precipitationSum.toFixed(1)} mm`} />
                      <MiniMetric label="Date" value={formatDate(weather.historical.date)} />
                    </div>
                    <p className="mt-4 text-base sm:text-sm sm:text-xs text-slate-400">This is a same-date comparison with last year, not a climate normal.</p>
                  </Panel>
                )}

                {(favourites.length > 0 || recentCities.length > 0) && (
                  <Panel>
                    <SectionLabel>Quick Access</SectionLabel>
                    {favourites.length > 0 && (
                      <CityChipGroup label="Saved" cities={favourites} onSelect={fetchWeather} />
                    )}
                    {recentCities.length > 0 && (
                      <CityChipGroup label="Recent" cities={recentCities} onSelect={fetchWeather} />
                    )}
                  </Panel>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">{children}</div>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-base sm:text-sm sm:text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{children}</p>;
}

function MetricCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-2 flex items-center justify-between text-slate-400">
        <span className="text-base sm:text-sm sm:text-xs font-semibold uppercase">{title}</span>
        {icon}
      </div>
      <div className="text-xl font-bold">{children}</div>
    </div>
  );
}

function MiniMetric({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-base sm:text-sm sm:text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-1 text-base sm:text-sm font-semibold">{value}</div>
    </div>
  );
}

function AirMetric({ title, value }: { title: string; value: string | number }) {
  return (
    <div>
      <div className="text-base sm:text-sm sm:text-xs text-slate-500">{title}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
      <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </div>
  );
}

function HourlyCard({ point, index, units }: { point: HourlyWeatherPoint; index: number; units: UnitSystem }) {
  const hourlyStatus = getWmoStatus(point.weathercode);
  const Icon = hourlyStatus.Icon;
  return (
    <div className={`hourly-card w-[104px] shrink-0 rounded-2xl border px-3 py-4 text-center ${index === 0 ? "hourly-card-current" : "border-slate-800 bg-slate-950/50"}`}>
      <p className="text-base sm:text-sm sm:text-xs text-slate-400">{index === 0 ? "Now" : formatHour(point.time)}</p>
      <Icon size={22} className={`mx-auto my-3 ${hourlyStatus.color}`} />
      <p className="text-base sm:text-sm font-bold">{formatTemperature(point.temperature, units)}</p>
      <p className="mt-1 text-base sm:text-sm sm:text-[11px] text-blue-300">{Math.round(point.precipitationProbability)}% rain</p>
    </div>
  );
}

function DailyRow({ weather, date, index, units }: { weather: ComprehensiveWeatherData; date: string; index: number; units: UnitSystem }) {
  const dayStatus = getWmoStatus(weather.daily.weathercode?.[index] ?? 0);
  const DayIcon = dayStatus.Icon;
  const max = weather.daily.temperatureMax[index] ?? 0;
  const min = weather.daily.temperatureMin[index] ?? 0;
  const weekMax = Math.max(...weather.daily.temperatureMax.slice(0, 7));
  const weekMin = Math.min(...weather.daily.temperatureMin.slice(0, 7));
  const range = weekMax - weekMin || 1;
  const left = ((min - weekMin) / range) * 100;
  const width = ((max - min) / range) * 100;
  const dayLabel = index === 0 ? "Today" : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });

  return (
    <div className="flex items-center gap-2 text-base sm:text-sm sm:gap-3">
      <div className="w-12 shrink-0 font-medium text-slate-300">{dayLabel}</div>
      <div className="flex w-8 shrink-0 justify-center"><DayIcon size={18} className={dayStatus.color} /></div>
      <div className="w-9 shrink-0 text-right text-base sm:text-sm sm:text-xs text-blue-300">{weather.daily.precipitationProbabilityMax[index] ?? 0}%</div>
      <div className="w-9 shrink-0 text-right tabular-nums text-slate-400">{formatTemperature(min, units, false)}</div>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className="absolute top-0 h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-400" style={{ left: `${Math.max(0, Math.min(left, 100))}%`, width: `${Math.max(8, Math.min(width, 100))}%` }} />
      </div>
      <div className="w-9 shrink-0 tabular-nums">{formatTemperature(max, units, false)}</div>
    </div>
  );
}

function TemperatureChart({
  points,
  units,
}: {
  points: HourlyWeatherPoint[];
  units: UnitSystem;
}) {
  if (points.length < 2) return null;

  const values = points.map((point) =>
    units === "metric"
      ? point.temperature
      : cToF(point.temperature)
  );

  const current = values[0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const last = values[values.length - 1];
  const delta = last - current;
  const rawRange = max - min;

  // Keep small temperature changes visually readable without exaggerating
  // the chart too aggressively.
  const visualPadding = Math.max(0.8, rawRange * 0.22);
  const displayMin = min - visualPadding;
  const displayMax = max + visualPadding;
  const displayRange = displayMax - displayMin || 1;

  const width = 680;
  const height = 220;
  const paddingLeft = 34;
  const paddingRight = 34;
  const paddingTop = 34;
  const paddingBottom = 46;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const baseline = height - paddingBottom;

  const coords = values.map((value, index) => ({
    x:
      paddingLeft +
      (index / Math.max(1, values.length - 1)) * chartWidth,
    y:
      paddingTop +
      ((displayMax - value) / displayRange) * chartHeight,
  }));

  // A smooth quadratic path reads better than a sharp polyline but remains
  // deterministic and inexpensive to render.
  const linePath = coords.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    }

    const previous = coords[index - 1];
    const midX = (previous.x + point.x) / 2;
    const midY = (previous.y + point.y) / 2;

    return `${path} Q ${previous.x.toFixed(1)} ${previous.y.toFixed(
      1
    )} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }, "");

  const finalPoint = coords[coords.length - 1];
  const completedLinePath = `${linePath} T ${finalPoint.x.toFixed(
    1
  )} ${finalPoint.y.toFixed(1)}`;

  const areaPath = `${completedLinePath} L ${finalPoint.x.toFixed(
    1
  )} ${baseline} L ${coords[0].x.toFixed(1)} ${baseline} Z`;

  const minIndex = values.indexOf(min);
  const maxIndex = values.indexOf(max);

  const importantIndexes = new Set([
    0,
    minIndex,
    maxIndex,
    values.length - 1,
  ]);

  const tickIndexes = Array.from(
    new Set([
      0,
      Math.min(3, values.length - 1),
      Math.min(6, values.length - 1),
      Math.min(9, values.length - 1),
      values.length - 1,
    ])
  ).sort((a, b) => a - b);

  const trendLabel =
    Math.abs(delta) < 0.5
      ? "Mostly steady"
      : delta < 0
        ? `Cooling ${Math.abs(Math.round(delta))}°`
        : `Warming ${Math.abs(Math.round(delta))}°`;

  const trendTone =
    Math.abs(delta) < 0.5
      ? "text-slate-300"
      : delta < 0
        ? "text-sky-300"
        : "text-amber-300";

  return (
    <div className="mt-5">
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5">
          <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Now
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-slate-100">
            {Math.round(current)}°
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5">
          <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            High
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-orange-300">
            {Math.round(max)}°
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5">
          <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Low
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-blue-300">
            {Math.round(min)}°
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5">
          <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Trend
          </p>
          <p className={`mt-1 text-base sm:text-sm font-bold ${trendTone}`}>
            {trendLabel}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/25 px-1 pb-1 pt-2 sm:px-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[210px] w-full"
          role="img"
          aria-label={`Temperature over the next 12 hours. Current ${Math.round(
            current
          )} degrees, high ${Math.round(max)} degrees, low ${Math.round(
            min
          )} degrees.`}
        >
          <defs>
            <linearGradient
              id="temperature-line-gradient"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="55%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>

            <linearGradient
              id="temperature-area-gradient"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor="#3b82f6"
                stopOpacity="0.22"
              />
              <stop
                offset="100%"
                stopColor="#3b82f6"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((ratio) => {
            const y =
              paddingTop + ratio * chartHeight;

            return (
              <line
                key={ratio}
                x1={paddingLeft}
                x2={width - paddingRight}
                y1={y}
                y2={y}
                stroke="rgba(100,116,139,0.12)"
                strokeWidth="1"
                strokeDasharray="4 7"
              />
            );
          })}

          <path
            d={areaPath}
            fill="url(#temperature-area-gradient)"
          />

          <path
            d={completedLinePath}
            fill="none"
            stroke="url(#temperature-line-gradient)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {coords.map((point, index) => {
            const isImportant = importantIndexes.has(index);

            return (
              <g key={points[index].time}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isImportant ? 5 : 3.5}
                  fill={isImportant ? "#93c5fd" : "#60a5fa"}
                  stroke="#0f172a"
                  strokeWidth={isImportant ? 2 : 1.5}
                />

                {isImportant && (
                  <g>
                    <rect
                      x={point.x - 18}
                      y={Math.max(4, point.y - 31)}
                      width="36"
                      height="20"
                      rx="8"
                      fill="rgba(15,23,42,0.94)"
                      stroke="rgba(96,165,250,0.18)"
                    />

                    <text
                      x={point.x}
                      y={Math.max(18, point.y - 17)}
                      textAnchor="middle"
                      className="fill-slate-200 text-base sm:text-sm sm:text-[11px] font-semibold"
                    >
                      {Math.round(values[index])}°
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {tickIndexes.map((index) => (
            <g key={`tick-${points[index].time}`}>
              <line
                x1={coords[index].x}
                x2={coords[index].x}
                y1={baseline + 4}
                y2={baseline + 9}
                stroke="rgba(100,116,139,0.32)"
                strokeWidth="1"
              />

              <text
                x={coords[index].x}
                y={height - 13}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === values.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-slate-500 text-[13px] sm:text-[10px]"
              >
                {formatHour(points[index].time)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] sm:text-[10px] text-slate-500">
        <span>
          Range: {Math.round(min)}°–{Math.round(max)}°
        </span>

        <span>
          Ends at {formatHour(points[points.length - 1].time)} ·{" "}
          {Math.round(last)}°
        </span>
      </div>
    </div>
  );
}
function RainChart({
  points,
}: {
  points: HourlyWeatherPoint[];
}) {
  if (!points.length) return null;

  const probabilities = points.map((point) =>
    Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(point.precipitationProbability)
          ? point.precipitationProbability
          : 0
      )
    )
  );

  const precipitation = points.map((point) =>
    Math.max(
      0,
      Number.isFinite(point.precipitation)
        ? point.precipitation
        : 0
    )
  );

  const peakProbability = Math.max(...probabilities);
  const peakIndex = probabilities.indexOf(peakProbability);
  const totalRain = precipitation.reduce(
    (sum, value) => sum + value,
    0
  );
  const wetHours = probabilities.filter(
    (value) => value >= 40
  ).length;

  const likelyRainIndexes = probabilities
    .map((value, index) => ({
      value,
      index,
    }))
    .filter(
      ({ value, index }) =>
        value >= 40 || precipitation[index] >= 0.1
    );

  const rainWindow =
    likelyRainIndexes.length === 0
      ? "No likely rain"
      : likelyRainIndexes.length === 1
        ? formatHour(
            points[likelyRainIndexes[0].index].time
          )
        : `${formatHour(
            points[likelyRainIndexes[0].index].time
          )} – ${formatHour(
            points[
              likelyRainIndexes[
                likelyRainIndexes.length - 1
              ].index
            ].time
          )}`;

  const riskLabel =
    peakProbability < 20
      ? "Very low"
      : peakProbability < 40
        ? "Low"
        : peakProbability < 60
          ? "Moderate"
          : peakProbability < 80
            ? "High"
            : "Very high";

  const riskTone =
    peakProbability < 20
      ? "text-slate-300"
      : peakProbability < 40
        ? "text-cyan-300"
        : peakProbability < 60
          ? "text-sky-300"
          : peakProbability < 80
            ? "text-blue-300"
            : "text-indigo-300";

  const chartHeight = 118;

  return (
    <div className="mt-5">
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5">
          <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Peak chance
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-sky-300">
            {Math.round(peakProbability)}%
          </p>
          <p className="mt-0.5 text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-500">
            {formatHour(points[peakIndex].time)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5">
          <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Risk
          </p>
          <p className={`mt-1 text-base sm:text-sm font-bold ${riskTone}`}>
            {riskLabel}
          </p>
          <p className="mt-0.5 text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-500">
            Next 12 hours
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5">
          <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Expected
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-blue-300">
            {totalRain < 0.05
              ? "0 mm"
              : `${totalRain.toFixed(
                  totalRain >= 10 ? 0 : 1
                )} mm`}
          </p>
          <p className="mt-0.5 text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-500">
            Accumulated
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5">
          <p className="text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Rain window
          </p>
          <p className="mt-1 truncate text-base sm:text-sm font-bold text-slate-200">
            {rainWindow}
          </p>
          <p className="mt-0.5 text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-500">
            {wetHours > 0
              ? `${wetHours} wetter ${
                  wetHours === 1 ? "hour" : "hours"
                }`
              : "Dry period"}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/25 px-3 pb-3 pt-4">
        <div
          className="relative"
          style={{
            height: chartHeight + 34,
          }}
        >
          {[25, 50, 75, 100].map((value) => {
            const bottom =
              30 + (value / 100) * chartHeight;

            return (
              <div
                key={value}
                className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-800/65"
                style={{ bottom }}
              >
                <span className="absolute -top-3 right-0 bg-slate-950/70 pl-1 text-base sm:text-sm sm:text-[11px] sm:text-[8px] tabular-nums text-slate-700">
                  {value}%
                </span>
              </div>
            );
          })}

          <div className="absolute inset-x-0 bottom-[30px] top-0 flex items-end gap-1.5 sm:gap-2">
            {points.map((point, index) => {
              const probability = probabilities[index];
              const rain = precipitation[index];
              const isPeak = index === peakIndex;
              const heightPercent =
                probability <= 0
                  ? 2
                  : Math.max(5, probability);

              return (
                <div
                  key={point.time}
                  className="flex min-w-0 flex-1 flex-col items-center justify-end self-stretch"
                >
                  <div className="relative flex h-full w-full items-end justify-center">
                    {(isPeak || probability >= 50) && (
                      <span className="absolute z-10 rounded-md border border-sky-500/15 bg-slate-950/90 px-1.5 py-0.5 text-base sm:text-sm sm:text-xs sm:text-[9px] font-semibold tabular-nums text-sky-200"
                        style={{
                          bottom: `calc(${heightPercent}% + 6px)`,
                        }}
                      >
                        {Math.round(probability)}%
                      </span>
                    )}

                    <div className="relative h-full w-full max-w-[34px] overflow-hidden rounded-t-lg bg-slate-900/70">
                      <div
                        className={`absolute inset-x-0 bottom-0 rounded-t-lg transition-[height] duration-300 ${
                          isPeak
                            ? "bg-gradient-to-t from-blue-600 to-sky-300"
                            : probability >= 50
                              ? "bg-gradient-to-t from-blue-700/90 to-sky-400/85"
                              : "bg-gradient-to-t from-blue-800/65 to-sky-500/55"
                        }`}
                        style={{
                          height: `${heightPercent}%`,
                        }}
                      />

                      {rain >= 0.1 && (
                        <div
                          className="absolute inset-x-[30%] bottom-1 rounded-full bg-white/70"
                          style={{
                            height: `${Math.min(
                              30,
                              5 + rain * 3
                            )}%`,
                          }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="absolute inset-x-0 bottom-0 grid grid-cols-4 text-base sm:text-sm sm:text-xs sm:text-[9px] text-slate-500">
            {[0, 3, 6, 9].map((index) => {
              const safeIndex = Math.min(
                index,
                points.length - 1
              );

              return (
                <span
                  key={safeIndex}
                  className={
                    index === 0
                      ? "text-left"
                      : index === 9
                        ? "text-right"
                        : "text-center"
                  }
                >
                  {formatHour(points[safeIndex].time)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] sm:text-[10px] text-slate-500">
        <span>
          {peakProbability < 20
            ? "Rain is unlikely across the next 12 hours."
            : peakProbability < 50
              ? "A few periods may see light rain."
              : "Keep an eye on the higher-probability periods."}
        </span>

        <span>
          {totalRain < 0.05
            ? "No measurable rain expected"
            : `${totalRain.toFixed(
                totalRain >= 10 ? 0 : 1
              )} mm total expected`}
        </span>
      </div>
    </div>
  );
}
function CityChipGroup({ label, cities, onSelect }: { label: string; cities: string[]; onSelect: (city: string) => Promise<void> }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-base sm:text-sm sm:text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        {cities.map((item) => (
          <button key={item} type="button" onClick={() => void onSelect(item)} className="rounded-full border border-slate-700 bg-slate-950/50 px-3 py-1.5 text-base sm:text-sm sm:text-xs text-slate-300 hover:border-blue-500 hover:text-white">
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function InitialSkeleton({ detectingLocation }: { detectingLocation: boolean }) {
  return (
    <div className="grid min-h-[440px] grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="animate-pulse rounded-3xl border border-slate-800 bg-slate-900/60 lg:col-span-7" />
      <div className="grid grid-cols-2 gap-3 lg:col-span-5">
        {[0, 1, 2, 3].map((item) => <div key={item} className="animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />)}
      </div>
      <p className="lg:col-span-12 text-center text-base sm:text-sm text-slate-500">{detectingLocation ? "Detecting your location…" : "Loading weather…"}</p>
    </div>
  );
}

function formatTemperature(value: number, units: UnitSystem, includeUnit = true) {
  const converted = units === "metric" ? value : cToF(value);
  return `${Math.round(converted)}°${includeUnit ? (units === "metric" ? "C" : "F") : ""}`;
}

function formatWind(value: number, units: UnitSystem) {
  if (units === "metric") return `${value.toFixed(1)} km/h`;
  return `${kmhToMph(value).toFixed(1)} mph`;
}

function formatPressure(value: number, units: UnitSystem) {
  return units === "metric" ? `${Math.round(value)} hPa` : `${hpaToMmhg(value).toFixed(0)} mmHg`;
}

function formatClock(value?: string) {
  if (!value) return "N/A";
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatHour(value: string) {
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric" });
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function formatRelativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function getRainSummary(points: HourlyWeatherPoint[]) {
  const rainy = points.filter((point) => point.precipitationProbability >= 50);
  if (!rainy.length) return "Low rain risk over the next 12 hours.";
  const first = rainy[0];
  const last = rainy[rainy.length - 1];
  if (first.time === last.time) return `Rain is most likely around ${formatHour(first.time)}.`;
  return `Rain is likely between ${formatHour(first.time)} and ${formatHour(last.time)}.`;
}