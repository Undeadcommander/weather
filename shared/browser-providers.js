import { findLocations, getForecast } from "../server/providers.js";

const forecasts = new Map();

function browserFetcher(signal) {
  return (url, options) => fetch(url, {
    signal: signal ? AbortSignal.any([signal, options.signal]) : options.signal,
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "strict-origin",
  });
}

export async function fetchBrowserForecast(source, { latitude, longitude }, signal) {
  if (!["met-norway", "nws"].includes(source)) throw new RangeError("Unknown forecast source");
  const point = { latitude: latitude.toFixed(4), longitude: longitude.toFixed(4) };
  const key = `${source}:${point.latitude}:${point.longitude}`;
  const now = Date.now();
  const cached = forecasts.get(key);
  if (cached?.expiresAt > now) return cached.payload;
  const result = await getForecast(source, point, { fetcher: browserFetcher(signal), now });
  const payload = { source, status: result.status, rows: result.rows, retrievedAt: now, stale: false };
  if (forecasts.size >= 64) forecasts.delete(forecasts.keys().next().value);
  forecasts.set(key, { payload, expiresAt: result.expiresAt });
  return payload;
}

export function findBrowserLocations(query, signal) {
  return findLocations(query, { fetcher: browserFetcher(signal) });
}
