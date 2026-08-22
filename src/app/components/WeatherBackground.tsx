"use client";

function getBackground(weatherCode: number, isDay: number) {
  const night = isDay === 0;

  if ([95, 96, 99].includes(weatherCode)) {
    return night
      ? "from-slate-950 via-violet-950/70 to-slate-900"
      : "from-slate-900 via-violet-900/50 to-blue-950";
  }

  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) {
    return night
      ? "from-slate-950 via-blue-950 to-slate-900"
      : "from-slate-900 via-blue-950 to-cyan-950/80";
  }

  if ([45, 48].includes(weatherCode)) {
    return "from-slate-900 via-slate-800 to-slate-950";
  }

  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
    return night
      ? "from-slate-950 via-sky-950 to-slate-900"
      : "from-sky-900 via-slate-800 to-slate-950";
  }

  if (weatherCode === 0) {
    return night
      ? "from-indigo-950 via-slate-950 to-slate-900"
      : "from-blue-700 via-sky-800 to-slate-900";
  }

  return night
    ? "from-slate-950 via-blue-950/70 to-slate-900"
    : "from-slate-800 via-blue-900/60 to-slate-950";
}

export default function WeatherBackground({
  weatherCode,
  isDay,
}: {
  weatherCode: number;
  isDay: number;
}) {
  return (
    <div className={`absolute inset-0 bg-gradient-to-br ${getBackground(weatherCode, isDay)}`} aria-hidden="true">
      <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-blue-400/10 blur-3xl" />
    </div>
  );
}
