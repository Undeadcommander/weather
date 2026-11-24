import { readJson, reading, validRows } from "./forecast.js";
import { HOUR } from "./weather.js";

export const BRIGHT_SKY_ORIGIN = "https://api.brightsky.dev";

function skyCondition(icon) {
  if (typeof icon !== "string") return null;
  if (icon === "thunderstorm") return "thunder";
  if (icon === "sleet") return "sleet";
  if (icon === "hail") return "hail";
  if (icon === "snow") return "snow";
  if (icon === "rain") return "rain";
  if (icon === "fog") return "fog";
  if (icon === "cloudy") return "cloudy";
  if (icon.startsWith("partly-cloudy")) return "partlyCloudy";
  if (icon.startsWith("clear")) return "clear";
  return null;
}

// Bright Sky leaves humidity blank for many stations, but it reliably reports dew point.
function humidityFrom(humidity, temperature, dewPoint) {
  if (typeof humidity === "number") return humidity;
  if (typeof temperature !== "number" || typeof dewPoint !== "number" || dewPoint > temperature) return null;
  const vapor = (celsius) => Math.exp(17.625 * celsius / (243.04 + celsius));
  return Math.round(100 * vapor(dewPoint) / vapor(temperature));
}

export function normalizeBrightSky(data) {
  const weather = data?.weather;
  if (!Array.isArray(weather)) return [];
  const times = weather.map((item) => Date.parse(item?.timestamp));
  // Precipitation probability covers the hour ending at each timestamp.
  return weather.map((item, i) => reading(times[i], {
    temp: item?.temperature,
    rain: times[i + 1] === times[i] + HOUR ? weather[i + 1]?.precipitation_probability : null,
    wind: item?.wind_speed,
    humidity: humidityFrom(item?.relative_humidity, item?.temperature, item?.dew_point),
    condition: skyCondition(item?.icon),
    // Sleet counts as possible snow, as it does for the other sources; hail does not.
    snowMentioned: item?.icon === "sleet",
    night: typeof item?.icon === "string" && item.icon.endsWith("-night"),
  }));
}

export async function fetchBrightSky({ latitude, longitude }, signal, source = { id: "mosmix" }) {
  const day = Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR;
  const url = new URL("/weather", BRIGHT_SKY_ORIGIN);
  url.search = new URLSearchParams({
    lat: latitude, lon: longitude,
    date: new Date(day - 24 * HOUR).toISOString().slice(0, 10),
    last_date: new Date(day + 16 * 24 * HOUR).toISOString().slice(0, 10),
    units: "dwd",
  });
  const timeout = AbortSignal.timeout(4500);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "manual",
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return { source: source.id, status: "unsupported", rows: [], retrievedAt: Date.now(), stale: false };
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Bright Sky forecast unavailable");
  }
  const data = await readJson(response);
  const retrievedAt = Date.now();
  const rows = validRows(normalizeBrightSky(data), retrievedAt);
  if (!rows.length) throw new Error("Bright Sky forecast contains no usable hours");
  return { source: source.id, status: "ok", rows, retrievedAt, stale: false };
}
