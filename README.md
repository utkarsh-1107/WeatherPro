# Weather Intelligence upgrade

This bundle is designed for the existing Next.js App Router + React + TypeScript + Tailwind project.

## Replace / add these files

- `src/app/page.tsx`
- `src/app/layout.tsx`
- `src/app/api/weather/route.ts`
- `src/app/components/WeatherBackground.tsx`
- `src/lib/weather.ts`
- `src/lib/alerts.ts`
- `src/lib/wmo.ts`
- `public/manifest.webmanifest`
- `public/sw.js`

## Existing dependency used

```bash
npm install lucide-react
```

Tailwind CSS is assumed to already be configured because the existing app uses Tailwind utility classes.

## Major additions

- Location detection and reverse-geocoding loading state
- Server-side API proxy with Next.js fetch revalidation
- 24-hour data source and 12-hour UI forecast
- Rain timeline and temperature SVG trend
- Rule-based outdoor and activity scoring
- Severe weather, heat, UV, AQI, wind and rain alerts
- AQI details
- Sunrise, sunset, pressure and wind direction
- Same-date last-year weather comparison
- Recent searches and favourites saved in localStorage
- Metric / Imperial units
- URL city state via `?city=Mumbai`
- Refresh and Web Share support
- Offline last-weather fallback
- PWA manifest, service worker and install prompt
- Keyboard `/` search focus and Escape dismissal

## Start

```bash
npm run dev
```

If Next.js reports stale build errors after replacing files, stop the dev server, delete `.next`, and start again.
