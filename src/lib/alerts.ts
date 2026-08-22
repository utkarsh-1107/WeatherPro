import type { ComprehensiveWeatherData, HourlyWeatherPoint } from "./weather";

export type AlertSeverity = "info" | "warning" | "danger";

export interface WeatherAlert {
  id: string;
  icon: string;
  title: string;
  description: string;
  severity: AlertSeverity;
}

export interface WeatherInsight {
  id: string;
  icon: string;
  title: string;
  description: string;
}

export interface ActivityScore {
  id: string;
  label: string;
  icon: string;
  score: number;
  rating: "Excellent" | "Good" | "Fair" | "Poor";
  reason: string;
  bestWindow?: string;
}

export function getAqiLabel(aqi: number) {
  if (aqi <= 50) return { label: "Good", color: "text-emerald-400" };
  if (aqi <= 100) return { label: "Moderate", color: "text-yellow-400" };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", color: "text-orange-400" };
  if (aqi <= 200) return { label: "Unhealthy", color: "text-red-400" };
  if (aqi <= 300) return { label: "Very unhealthy", color: "text-purple-400" };
  return { label: "Hazardous", color: "text-rose-500" };
}

export function generateAlerts(weather: ComprehensiveWeatherData): WeatherAlert[] {
  const result: WeatherAlert[] = [];
  const next12 = weather.hourly.slice(0, 12);
  const maxRain = Math.max(0, ...next12.map((h) => h.precipitationProbability));
  const maxUv = Math.max(weather.extra.uvIndex, ...next12.map((h) => h.uvIndex));
  const maxWind = Math.max(weather.current.windspeed, ...next12.map((h) => h.windspeed));
  const maxFeelsLike = Math.max(
    weather.extra.apparentTemperature,
    ...next12.map((h) => h.apparentTemperature)
  );
  const aqi = weather.airQuality?.usAqi;

  if (maxRain >= 80) {
    result.push({
      id: "heavy-rain",
      icon: "☔",
      title: "High chance of rain",
      description: `Rain probability reaches ${Math.round(maxRain)}% in the next 12 hours. Carry an umbrella.`,
      severity: "warning",
    });
  }

  if (maxFeelsLike >= 40) {
    result.push({
      id: "extreme-heat",
      icon: "🥵",
      title: "Extreme heat risk",
      description: `It may feel as hot as ${Math.round(maxFeelsLike)}°. Reduce prolonged outdoor exposure.`,
      severity: "danger",
    });
  } else if (maxFeelsLike >= 35) {
    result.push({
      id: "heat",
      icon: "🌡️",
      title: "Hot conditions",
      description: `Feels-like temperature may reach ${Math.round(maxFeelsLike)}°. Stay hydrated.`,
      severity: "warning",
    });
  }

  if (maxUv >= 8) {
    result.push({
      id: "uv",
      icon: "☀️",
      title: "Very high UV",
      description: `UV index may reach ${Math.round(maxUv)}. Use sun protection if outdoors.`,
      severity: "warning",
    });
  }

  if (maxWind >= 45) {
    result.push({
      id: "wind",
      icon: "💨",
      title: "Strong winds",
      description: `Wind speeds may reach ${Math.round(maxWind)} km/h. Take care around exposed areas.`,
      severity: "warning",
    });
  }

  if (aqi != null && aqi >= 151) {
    result.push({
      id: "aqi",
      icon: "😷",
      title: "Poor air quality",
      description: `US AQI is ${Math.round(aqi)}. Limit prolonged outdoor activity, especially if sensitive.`,
      severity: aqi >= 201 ? "danger" : "warning",
    });
  }

  return result.slice(0, 3);
}

export function generateInsights(weather: ComprehensiveWeatherData): WeatherInsight[] {
  const result: WeatherInsight[] = [];
  const maxRain = Math.max(0, ...weather.hourly.slice(0, 12).map((h) => h.precipitationProbability));
  const humidity = weather.extra.humidity;
  const aqi = weather.airQuality?.usAqi;

  if (maxRain >= 50) {
    result.push({
      id: "umbrella",
      icon: "☂️",
      title: "Carry an umbrella",
      description: `Rain probability peaks near ${Math.round(maxRain)}% today.`,
    });
  }

  if (humidity >= 80) {
    result.push({
      id: "humidity",
      icon: "💧",
      title: "Very humid",
      description: `${Math.round(humidity)}% humidity may make it feel warmer than the actual temperature.`,
    });
  }

  if (aqi != null) {
    const aqiInfo = getAqiLabel(aqi);
    result.push({
      id: "air",
      icon: "🌬️",
      title: `${aqiInfo.label} air quality`,
      description:
        aqi <= 100
          ? `US AQI ${Math.round(aqi)} is acceptable for most people.`
          : `US AQI ${Math.round(aqi)} may affect sensitive groups.`,
    });
  }

  if (weather.extra.uvIndex >= 6) {
    result.push({
      id: "sun",
      icon: "🧴",
      title: "Sun protection advised",
      description: `Current UV index is ${weather.extra.uvIndex.toFixed(1)}.`,
    });
  }

  return result.slice(0, 4);
}

export function getOutdoorScore(weather: ComprehensiveWeatherData) {
  let score = 100;
  const reasons: string[] = [];

  const feels = weather.extra.apparentTemperature;
  const humidity = weather.extra.humidity;
  const rain = Math.max(0, ...weather.hourly.slice(0, 6).map((h) => h.precipitationProbability));
  const aqi = weather.airQuality?.usAqi ?? 0;
  const uv = weather.extra.uvIndex;

  if (feels >= 38) {
    score -= 30;
    reasons.push("high heat");
  } else if (feels >= 33) {
    score -= 18;
    reasons.push("warm feels-like temperature");
  }

  if (humidity >= 85) {
    score -= 18;
    reasons.push("very high humidity");
  } else if (humidity >= 75) {
    score -= 10;
    reasons.push("high humidity");
  }

  if (rain >= 80) {
    score -= 25;
    reasons.push("high rain risk");
  } else if (rain >= 50) {
    score -= 12;
    reasons.push("possible rain");
  }

  if (aqi >= 151) {
    score -= 25;
    reasons.push("poor air quality");
  } else if (aqi >= 101) {
    score -= 12;
    reasons.push("elevated AQI");
  }

  if (uv >= 8) {
    score -= 10;
    reasons.push("very high UV");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    label: getScoreRating(score),
    reason: reasons.length ? `Limited by ${reasons.join(", ")}.` : "Comfortable conditions overall.",
  };
}

export function getActivityScores(weather: ComprehensiveWeatherData): ActivityScore[] {
  const next12 = weather.hourly.slice(0, 12);

  return [
    activity("walk", "Walking", "🚶", weather, next12, {
      heat: 0.7,
      humidity: 0.6,
      rain: 0.8,
      aqi: 0.7,
      uv: 0.4,
    }),
    activity("run", "Running", "🏃", weather, next12, {
      heat: 1,
      humidity: 1,
      rain: 0.9,
      aqi: 1,
      uv: 0.7,
    }),
    activity("cycle", "Cycling", "🚴", weather, next12, {
      heat: 0.8,
      humidity: 0.7,
      rain: 1,
      aqi: 0.9,
      uv: 0.6,
    }),
    laundryScore(weather, next12),
  ];
}

function activity(
  id: string,
  label: string,
  icon: string,
  weather: ComprehensiveWeatherData,
  points: HourlyWeatherPoint[],
  weights: { heat: number; humidity: number; rain: number; aqi: number; uv: number }
): ActivityScore {
  let score = 100;
  const reasons: string[] = [];
  const feels = weather.extra.apparentTemperature;
  const humidity = weather.extra.humidity;
  const rain = Math.max(0, ...points.map((p) => p.precipitationProbability));
  const aqi = weather.airQuality?.usAqi ?? 0;
  const uv = weather.extra.uvIndex;

  if (feels >= 38) {
    score -= 35 * weights.heat;
    reasons.push("heat");
  } else if (feels >= 33) {
    score -= 20 * weights.heat;
    reasons.push("warm conditions");
  }

  if (humidity >= 85) {
    score -= 20 * weights.humidity;
    reasons.push("humidity");
  }

  if (rain >= 80) {
    score -= 35 * weights.rain;
    reasons.push("rain");
  } else if (rain >= 50) {
    score -= 18 * weights.rain;
    reasons.push("rain risk");
  }

  if (aqi >= 151) {
    score -= 30 * weights.aqi;
    reasons.push("air quality");
  } else if (aqi >= 101) {
    score -= 15 * weights.aqi;
    reasons.push("AQI");
  }

  if (uv >= 8) {
    score -= 15 * weights.uv;
    reasons.push("UV");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const bestWindow = getBestWindow(points, weather.airQuality?.usAqi ?? 0);

  return {
    id,
    label,
    icon,
    score,
    rating: getScoreRating(score),
    reason: reasons.length ? `Limited by ${reasons.join(", ")}.` : "Good conditions overall.",
    bestWindow,
  };
}

function laundryScore(weather: ComprehensiveWeatherData, points: HourlyWeatherPoint[]): ActivityScore {
  const rain = Math.max(0, ...points.map((p) => p.precipitationProbability));
  const humidity = weather.extra.humidity;
  let score = 100;
  const reasons: string[] = [];

  if (rain >= 80) {
    score -= 70;
    reasons.push("high rain risk");
  } else if (rain >= 50) {
    score -= 40;
    reasons.push("possible rain");
  }

  if (humidity >= 85) {
    score -= 25;
    reasons.push("very high humidity");
  } else if (humidity >= 75) {
    score -= 15;
    reasons.push("high humidity");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    id: "laundry",
    label: "Laundry",
    icon: "🧺",
    score,
    rating: getScoreRating(score),
    reason: reasons.length ? `Not ideal due to ${reasons.join(" and ")}.` : "Good drying conditions.",
    bestWindow: score >= 60 ? getBestWindow(points, 0) : undefined,
  };
}

function getBestWindow(points: HourlyWeatherPoint[], aqi: number) {
  if (!points.length) return undefined;

  const scored = points.map((p) => {
    let score = 100;
    if (p.apparentTemperature >= 35) score -= 25;
    if (p.humidity >= 85) score -= 15;
    if (p.precipitationProbability >= 70) score -= 35;
    if (p.uvIndex >= 8) score -= 15;
    if (aqi >= 151) score -= 25;
    return { point: p, score };
  });

  const best = scored.sort((a, b) => b.score - a.score)[0]?.point;
  if (!best) return undefined;

  const date = new Date(best.time);
  const end = new Date(date.getTime() + 2 * 60 * 60 * 1000);
  return `${formatHour(date)}–${formatHour(end)}`;
}

function formatHour(date: Date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getScoreRating(score: number): "Excellent" | "Good" | "Fair" | "Poor" {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  return "Poor";
}
