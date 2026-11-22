import { HOUR, validTimeZone } from "../shared/weather.js";

const MAX_RESPONSE_BYTES = 900_000;
const NWS_ORIGIN = "https://api.weather.gov";
const NWS_HOURLY_PATH = /^\/gridpoints\/[A-Z]{3}\/\d{1,3},\d{1,3}\/forecast\/hourly$/;
const DEFAULT_CONTACT = "https://skylens-forecast-compare.minormural2.chatgpt.site/";

export class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function readJson(response) {
  if (Number(response.headers.get("Content-Length")) > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new ProviderError("Invalid forecast response");
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
        throw new ProviderError("Forecast response too large");
      }
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function upstream(fetcher, signal, contact) {
  const identity = typeof contact === "string" && /^[\x21-\x7E]{1,180}$/.test(contact)
    ? contact
    : DEFAULT_CONTACT;
  return async (url, allowNotFound = false) => {
    const response = await fetcher(url, {
      // Workers support manual redirects, which fail the response check below.
      redirect: "manual",
      signal,
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": `SkylensWeather/1.0 (${identity})`,
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (allowNotFound && response.status === 404) return null;
      throw new ProviderError("Forecast provider unavailable", response.status);
    }
    return { data: await readJson(response), expiresAt: Date.parse(response.headers.get("Expires")) };
  };
}

function bounded(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function wmoCondition(code) {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partlyCloudy";
  if (code === 3) return "cloudy";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunder";
  return null;
}

function metCondition(symbol) {
  if (typeof symbol !== "string") return null;
  if (symbol.includes("thunder")) return "thunder";
  if (symbol.includes("sleet")) return "sleet";
  if (symbol.includes("snow")) return "snow";
  if (symbol.includes("rain")) return "rain";
  if (symbol.includes("fog")) return "fog";
  if (symbol.startsWith("cloudy")) return "cloudy";
  if (symbol.startsWith("partlycloudy") || symbol.startsWith("fair")) return "partlyCloudy";
  if (symbol.startsWith("clearsky")) return "clear";
  return null;
}

function nwsCondition(value) {
  if (typeof value !== "string") return null;
  const condition = value.toLowerCase();
  if (/thunder/.test(condition)) return "thunder";
  if (/sleet|wintry mix|freezing rain/.test(condition)) return "sleet";
  if (/snow/.test(condition)) return "snow";
  if (/rain|shower/.test(condition)) return "rain";
  if (/drizzle/.test(condition)) return "drizzle";
  if (/fog/.test(condition)) return "fog";
  if (/partly|mostly (sunny|clear)/.test(condition)) return "partlyCloudy";
  if (/cloud|overcast/.test(condition)) return "cloudy";
  if (/clear|sunny/.test(condition)) return "clear";
  return null;
}

function nwsWind(value) {
  if (typeof value !== "string") return null;
  if (value.toLowerCase() === "calm") return 0;
  const match = /^(\d{1,3})(?:\s+to\s+(\d{1,3}))?\s+(mph|km\/h|kmh|kt)$/i.exec(value);
  if (!match) return null;
  const speed = (Number(match[1]) + Number(match[2] ?? match[1])) / 2;
  const factor = { mph: 1.609344, "km/h": 1, kmh: 1, kt: 1.852 }[match[3].toLowerCase()];
  return speed * factor;
}

function reading(t, values) {
  return {
    t,
    temp: bounded(values.temp, -100, 65),
    rain: bounded(values.rain, 0, 100),
    wind: bounded(values.wind, 0, 500),
    humidity: bounded(values.humidity, 0, 100),
    condition: values.condition,
    night: values.night,
  };
}

export function normalizeOpenMeteo(data) {
  const hourly = data?.hourly;
  if (!Array.isArray(hourly?.time)) return [];
  // Open-Meteo reports rain probability for the hour ending at each timestamp.
  return hourly.time.slice(0, 192).map((time, i) => reading(Number.isInteger(time) ? time * 1000 : NaN, {
    temp: hourly.temperature_2m?.[i],
    rain: hourly.time[i + 1] === time + HOUR / 1000 ? hourly.precipitation_probability?.[i + 1] : null,
    wind: hourly.wind_speed_10m?.[i],
    humidity: hourly.relative_humidity_2m?.[i],
    condition: wmoCondition(hourly.weather_code?.[i]),
    night: hourly.is_day?.[i] === 0,
  }));
}

export function normalizeMetNorway(data) {
  const timeseries = data?.properties?.timeseries;
  if (!Array.isArray(timeseries)) return [];
  return timeseries.slice(0, 192).map((item) => {
    const values = item?.data?.instant?.details;
    const symbol = item?.data?.next_1_hours?.summary?.symbol_code;
    return reading(Date.parse(item?.time), {
      temp: values?.air_temperature,
      rain: null,
      wind: typeof values?.wind_speed === "number" ? values.wind_speed * 3.6 : null,
      humidity: values?.relative_humidity,
      condition: metCondition(symbol),
      night: typeof symbol === "string" && symbol.endsWith("_night"),
    });
  });
}

export function normalizeNws(data) {
  const periods = data?.properties?.periods;
  if (!Array.isArray(periods)) return [];
  return periods.slice(0, 192).map((period) => {
    const t = Date.parse(period?.startTime);
    const temp = bounded(period?.temperature, -148, 149);
    return reading(t, {
      temp: temp === null ? null : { F: (temp - 32) / 1.8, C: temp }[period.temperatureUnit],
      rain: Date.parse(period?.endTime) === t + HOUR ? period?.probabilityOfPrecipitation?.value : null,
      wind: nwsWind(period?.windSpeed),
      humidity: period?.relativeHumidity?.value,
      condition: nwsCondition(period?.shortForecast),
      night: period?.isDaytime === false,
    });
  });
}

function validRows(rows, now) {
  const start = Math.floor(now / HOUR) * HOUR - HOUR;
  const end = start + 98 * HOUR;
  const distinct = new Map();
  for (const row of rows) {
    if (!Number.isFinite(row.t) || row.t % HOUR || row.t < start || row.t > end) continue;
    if (row.temp === null && row.rain === null && row.wind === null && row.humidity === null) continue;
    distinct.set(row.t, row);
  }
  return [...distinct.values()].sort((a, b) => a.t - b.t);
}

export async function getForecast(source, { latitude, longitude }, { fetcher, now, contact }) {
  const request = upstream(fetcher, AbortSignal.timeout(source === "nws" ? 6500 : 4500), contact);
  let result;
  let rawRows;
  if (source === "open-meteo") {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude, longitude, timezone: "GMT", timeformat: "unixtime", forecast_days: "5",
      temperature_unit: "celsius", wind_speed_unit: "kmh",
      hourly: "temperature_2m,precipitation_probability,wind_speed_10m,relative_humidity_2m,weather_code,is_day",
    });
    result = await request(url);
    rawRows = normalizeOpenMeteo(result.data);
  } else if (source === "met-norway") {
    const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
    url.search = new URLSearchParams({ lat: latitude, lon: longitude });
    result = await request(url);
    rawRows = normalizeMetNorway(result.data);
  } else {
    const point = await request(new URL(`/points/${latitude},${longitude}`, NWS_ORIGIN), true);
    if (!point) {
      return { status: "unsupported", rows: [], expiresAt: now + 24 * HOUR };
    }
    const hourly = new URL(point.data?.properties?.forecastHourly);
    if (hourly.origin !== NWS_ORIGIN || hourly.username || hourly.password || hourly.search ||
        hourly.hash || !NWS_HOURLY_PATH.test(hourly.pathname)) {
      throw new ProviderError("Unknown hourly forecast endpoint");
    }
    result = await request(hourly);
    rawRows = normalizeNws(result.data);
  }
  const rows = validRows(rawRows, now);
  if (rows.length === 0) throw new ProviderError("Forecast contains no usable hours");
  const ttl = source === "met-norway" ? 10 * 60_000 : 5 * 60_000;
  return { status: "ok", rows, expiresAt: Math.max(now + ttl, result.expiresAt || 0) };
}

function cleanLabel(value) {
  return typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 100) : "";
}

export async function findLocations(query, { fetcher, contact }) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: query, count: "8", language: "en", format: "json" });
  const request = upstream(fetcher, AbortSignal.timeout(3500), contact);
  const { data } = await request(url);
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      (data.results !== undefined && !Array.isArray(data.results))) {
    throw new ProviderError("Invalid geocoding response");
  }
  const locations = [];
  for (const item of (data.results ?? []).slice(0, 8)) {
    const name = cleanLabel(item?.name);
    const latitude = bounded(item?.latitude, -90, 90);
    const longitude = bounded(item?.longitude, -180, 180);
    if (!name || latitude === null || longitude === null || !validTimeZone(item.timezone)) continue;
    locations.push({
      name,
      latitude: Number(latitude.toFixed(4)),
      longitude: Number(longitude.toFixed(4)),
      region: cleanLabel(item.admin1),
      country: cleanLabel(item.country),
      countryCode: /^[A-Z]{2}$/.test(item.country_code) ? item.country_code : "",
      timezone: item.timezone,
    });
  }
  return locations;
}
