import { HOUR } from "./weather.js";

const MAX_RESPONSE_BYTES = 900_000;

export async function readJson(response) {
  if (Number(response.headers.get("Content-Length")) > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new RangeError("Invalid provider response size");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let json = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RangeError("Provider response too large");
      }
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function bounded(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

export function reading(t, values) {
  return {
    t,
    temp: bounded(values.temp, -100, 65),
    rain: bounded(values.rain, 0, 100),
    snowfall: bounded(values.snowfall, 0, 500),
    snowMentioned: values.snowMentioned === true || values.condition === "snow",
    wind: bounded(values.wind, 0, 500),
    humidity: bounded(values.humidity, 0, 100),
    condition: values.condition,
    night: values.night,
  };
}

export function validRows(rows, now) {
  const start = Math.floor(now / HOUR) * HOUR - HOUR;
  const end = start + 17 * 24 * HOUR;
  const distinct = new Map();
  for (const row of rows) {
    if (!Number.isFinite(row.t) || row.t % HOUR || row.t < start || row.t > end) continue;
    if ([row.temp, row.rain, row.wind, row.humidity, row.snowfall].every(value => value == null) &&
        !row.condition && !row.snowMentioned) continue;
    distinct.set(row.t, row);
  }
  return [...distinct.values()].sort((a, b) => a.t - b.t);
}
