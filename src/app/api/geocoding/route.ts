import { NextRequest, NextResponse } from "next/server";

type SearchResult = {
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

function safeLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(10, Math.round(parsed)));
}

function dedupe(results: SearchResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = `${result.name.toLowerCase()}|${result.lat.toFixed(
      3
    )}|${result.lon.toFixed(3)}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  const limit = safeLimit(request.nextUrl.searchParams.get("limit"));

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results: SearchResult[] = [];

  try {
    const openMeteoUrl =
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(query)}` +
      `&count=${limit}` +
      "&language=en&format=json";

    const openMeteoResponse = await fetch(openMeteoUrl, {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 86400,
      },
    });

    if (openMeteoResponse.ok) {
      const payload = await openMeteoResponse.json();

      if (Array.isArray(payload?.results)) {
        for (const item of payload.results) {
          if (
            typeof item?.latitude !== "number" ||
            typeof item?.longitude !== "number"
          ) {
            continue;
          }

          const parts = [
            item.name,
            item.admin2,
            item.admin1,
            item.country,
          ].filter(
            (value: unknown, index: number, values: unknown[]) =>
              typeof value === "string" &&
              value.trim().length > 0 &&
              values.findIndex(
                (candidate) =>
                  typeof candidate === "string" &&
                  candidate.toLowerCase() === value.toLowerCase()
              ) === index
          );

          results.push({
            id: `open-meteo-${item.id ?? `${item.latitude}-${item.longitude}`}`,
            name: item.name || query,
            displayName: parts.join(", "),
            lat: item.latitude,
            lon: item.longitude,
            country: item.country,
            admin1: item.admin1,
            admin2: item.admin2,
            timezone: item.timezone,
            source: "open-meteo",
          });
        }
      }
    }
  } catch (error) {
    console.warn("Open-Meteo geocoding failed:", error);
  }

  // GeoNames/Open-Meteo is excellent for cities. Nominatim is used only as a
  // fallback so neighbourhoods, districts, postcodes and landmarks can still
  // resolve globally when the city index has no useful result.
  if (results.length < Math.min(4, limit)) {
    try {
      const nominatimUrl =
        "https://nominatim.openstreetmap.org/search" +
        `?q=${encodeURIComponent(query)}` +
        `&format=jsonv2&addressdetails=1&limit=${limit}`;

      const nominatimResponse = await fetch(nominatimUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "WeatherPro/1.0 (https://weatherpro1130.vercel.app/)",
          "Accept-Language": "en",
        },
        next: {
          revalidate: 86400,
        },
      });

      if (nominatimResponse.ok) {
        const payload = await nominatimResponse.json();

        if (Array.isArray(payload)) {
          for (const item of payload) {
            const lat = Number(item?.lat);
            const lon = Number(item?.lon);

            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

            const address = item?.address || {};

            const localName =
              item?.name ||
              address.neighbourhood ||
              address.suburb ||
              address.city_district ||
              address.city ||
              address.town ||
              address.village ||
              String(item?.display_name || query).split(",")[0];

            results.push({
              id: `nominatim-${item?.place_id ?? `${lat}-${lon}`}`,
              name: localName,
              displayName: item?.display_name || localName,
              lat,
              lon,
              country: address.country,
              admin1: address.state,
              admin2:
                address.state_district ||
                address.county ||
                address.city_district,
              source: "nominatim",
            });
          }
        }
      }
    } catch (error) {
      console.warn("Nominatim fallback failed:", error);
    }
  }

  return NextResponse.json(
    {
      results: dedupe(results).slice(0, limit),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    }
  );
}
