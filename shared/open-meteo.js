import { readJson, reading, validRows } from "./forecast.js";
import { HOUR } from "./weather.js";

export const OPEN_METEO_ORIGIN = "https://api.open-meteo.com";

function rateLimitDelay(retryAfter) {
  if (!retryAfter) return 750 + Math.random() * 500;
  const seconds = Number(retryAfter);
  return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now());
}

async function outsideDomain(response) {
  try {
    return (await readJson(response))?.reason === "No data is available for this location";
  } catch {
    return false;
  }
}

function wmoCondition(code) {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partlyCloudy";
  if (code === 3) return "cloudy";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55].includes(code)) return "drizzle";
  if ([56, 57, 66, 67].includes(code)) return "freezingRain";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if (code === 95) return "thunder";
  // Thunderstorms with hail; models outside Central Europe report them as plain thunderstorms.
  if (code === 96 || code === 99) return "hail";
  return null;
}

export function normalizeOpenMeteo(data) {
  const hourly = data?.hourly;
  if (!Array.isArray(hourly?.time)) return [];
  // Precipitation probability, snowfall and the weather code cover the hour ending at each
  // timestamp, so each row takes them from the next timestamp: the hour that begins at its time.
  return hourly.time.map((time, i) => {
    const next = hourly.time[i + 1] === time + HOUR / 1000 ? i + 1 : null;
    return reading(Number.isInteger(time) ? time * 1000 : NaN, {
      temp: hourly.temperature_2m?.[i],
      rain: next === null ? null : hourly.precipitation_probability?.[next],
      snowfall: next === null ? null : hourly.snowfall?.[next],
      wind: hourly.wind_speed_10m?.[i],
      humidity: hourly.relative_humidity_2m?.[i],
      condition: next === null ? null : wmoCondition(hourly.weather_code?.[next]),
      night: hourly.is_day?.[i] === 0,
    });
  });
}

export async function fetchOpenMeteo({ latitude, longitude }, signal, source = { id: "open-meteo" }) {
  const url = new URL("/v1/forecast", OPEN_METEO_ORIGIN);
  url.search = new URLSearchParams({
    latitude, longitude, timezone: "GMT", timeformat: "unixtime", forecast_days: "16", past_days: "1",
    ...(source.model && { models: source.model }),
    temperature_unit: "celsius", wind_speed_unit: "kmh",
    hourly: "temperature_2m,precipitation_probability,snowfall,wind_speed_10m,relative_humidity_2m,weather_code,is_day",
  });
  function request() {
    const timeout = AbortSignal.timeout(4500);
    return fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "manual",
    });
  }
  let response = await request();
  if (response.status === 429) {
    const delay = rateLimitDelay(response.headers.get("Retry-After"));
    if (delay <= 2000) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, delay));
      signal?.throwIfAborted();
      response = await request();
    }
  }
  if (response.status === 400 && source.model && await outsideDomain(response)) {
    // Regional models answer with an error for places beyond their domain.
    return { source: source.id, status: "unsupported", rows: [], retrievedAt: Date.now(), stale: false };
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Open-Meteo forecast unavailable");
  }
  const data = await readJson(response);
  const retrievedAt = Date.now();
  const rows = validRows(normalizeOpenMeteo(data), retrievedAt);
  if (!rows.length) throw new Error("Open-Meteo forecast contains no usable hours");
  return { source: source.id, status: "ok", rows, retrievedAt, stale: false };
}
