import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Sun,
} from "lucide-react";

export function getWmoStatus(code: number) {
  if (code === 0) {
    return { label: "Clear sky", Icon: Sun, color: "text-amber-300" };
  }
  if ([1, 2].includes(code)) {
    return { label: "Partly cloudy", Icon: Cloud, color: "text-sky-200" };
  }
  if (code === 3) {
    return { label: "Overcast", Icon: Cloud, color: "text-slate-300" };
  }
  if ([45, 48].includes(code)) {
    return { label: "Fog", Icon: CloudFog, color: "text-slate-300" };
  }
  if ([51, 53, 55, 56, 57].includes(code)) {
    return { label: "Drizzle", Icon: CloudDrizzle, color: "text-cyan-300" };
  }
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return { label: "Rain", Icon: CloudRain, color: "text-blue-300" };
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return { label: "Snow", Icon: CloudSnow, color: "text-sky-100" };
  }
  if ([95, 96, 99].includes(code)) {
    return { label: "Thunderstorm", Icon: CloudLightning, color: "text-violet-300" };
  }
  return { label: "Cloudy", Icon: Cloud, color: "text-slate-300" };
}
