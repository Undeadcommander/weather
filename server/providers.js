import { HOUR, validTimeZone } from "../shared/weather.js";
import { bounded, readJson, reading, validRows } from "../shared/forecast.js";

const NWS_ORIGIN = "https://api.weather.gov";
const NWS_HOURLY_PATH = /^\/gridpoints\/[A-Z]{3}\/\d{1,3},\d{1,3}\/forecast\/hourly$/;
const DEFAULT_CONTACT = "https://skylens-forecast-compare.minormural2.chatgpt.site/";

export class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
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
  if (/hail/.test(condition)) return "hail";
  if (/thunder/.test(condition)) return "thunder";
  if (/freezing (?:rain|drizzle)/.test(condition)) return "freezingRain";
  if (/sleet|wintry mix/.test(condition)) return "sleet";
  if (/snow|flurr(?:y|ies)/.test(condition)) return "snow";
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

export function normalizeMetNorway(data) {
  const timeseries = data?.properties?.timeseries;
  if (!Array.isArray(timeseries)) return [];
  return timeseries.map((item) => {
    const values = item?.data?.instant?.details;
    // Longer-range steps are six hours apart and only summarize the next six hours.
    const symbol = item?.data?.next_1_hours?.summary?.symbol_code ?? item?.data?.next_6_hours?.summary?.symbol_code;
    return reading(Date.parse(item?.time), {
      temp: values?.air_temperature,
      rain: null,
      wind: typeof values?.wind_speed === "number" ? values.wind_speed * 3.6 : null,
      humidity: values?.relative_humidity,
      condition: metCondition(symbol),
      snowMentioned: /snow|sleet/.test(symbol ?? ""),
      night: typeof symbol === "string" && symbol.endsWith("_night"),
    });
  });
}

export function normalizeNws(data) {
  const periods = data?.properties?.periods;
  if (!Array.isArray(periods)) return [];
  return periods.map((period) => {
    const t = Date.parse(period?.startTime);
    const temp = bounded(period?.temperature, -148, 149);
    return reading(t, {
      temp: temp === null ? null : { F: (temp - 32) / 1.8, C: temp }[period.temperatureUnit],
      rain: Date.parse(period?.endTime) === t + HOUR ? period?.probabilityOfPrecipitation?.value : null,
      wind: nwsWind(period?.windSpeed),
      humidity: period?.relativeHumidity?.value,
      condition: nwsCondition(period?.shortForecast),
      snowMentioned: /snow|flurr(?:y|ies)|wintry mix|sleet/i.test(period?.shortForecast ?? ""),
      night: period?.isDaytime === false,
    });
  });
}

export async function getForecast(source, { latitude, longitude }, { fetcher, now, contact }) {
  const request = upstream(fetcher, AbortSignal.timeout(source === "nws" ? 6500 : 4500), contact);
  let result;
  let rawRows;
  if (source === "met-norway") {
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
  return { status: "ok", rows, expiresAt: Math.min(now + HOUR, Math.max(now + ttl, result.expiresAt || 0)) };
}

function cleanLabel(value) {
  return typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 100) : "";
}

const states = new Map(Object.entries({
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
}));

// Representative cities searched when the whole query is a state: [largest or best-known city, capital].
const stateCities = {
  Alabama: ["Birmingham", "Montgomery"], Alaska: ["Anchorage", "Juneau"], Arizona: ["Phoenix"],
  Arkansas: ["Little Rock"], California: ["Los Angeles", "Sacramento"], Colorado: ["Denver"],
  Connecticut: ["Bridgeport", "Hartford"], Delaware: ["Wilmington", "Dover"], "District of Columbia": ["Washington"],
  Florida: ["Miami", "Tallahassee"], Georgia: ["Atlanta"], Hawaii: ["Honolulu"], Idaho: ["Boise"],
  Illinois: ["Chicago", "Springfield"], Indiana: ["Indianapolis"], Iowa: ["Des Moines"], Kansas: ["Wichita", "Topeka"],
  Kentucky: ["Louisville", "Frankfort"], Louisiana: ["New Orleans", "Baton Rouge"], Maine: ["Portland", "Augusta"],
  Maryland: ["Baltimore", "Annapolis"], Massachusetts: ["Boston"], Michigan: ["Detroit", "Lansing"],
  Minnesota: ["Minneapolis", "Saint Paul"], Mississippi: ["Jackson"], Missouri: ["Kansas City", "Jefferson City"],
  Montana: ["Billings", "Helena"], Nebraska: ["Omaha", "Lincoln"], Nevada: ["Las Vegas", "Carson City"],
  "New Hampshire": ["Manchester", "Concord"], "New Jersey": ["Newark", "Trenton"], "New Mexico": ["Albuquerque", "Santa Fe"],
  "New York": ["New York", "Albany"], "North Carolina": ["Charlotte", "Raleigh"], "North Dakota": ["Fargo", "Bismarck"],
  Ohio: ["Columbus", "Cleveland"], Oklahoma: ["Oklahoma City", "Tulsa"], Oregon: ["Portland", "Salem"],
  Pennsylvania: ["Philadelphia", "Harrisburg"], "Rhode Island": ["Providence"], "South Carolina": ["Charleston", "Columbia"],
  "South Dakota": ["Sioux Falls", "Pierre"], Tennessee: ["Nashville", "Memphis"], Texas: ["Houston", "Austin"],
  Utah: ["Salt Lake City"], Vermont: ["Burlington", "Montpelier"], Virginia: ["Virginia Beach", "Richmond"],
  Washington: ["Seattle", "Olympia"], "West Virginia": ["Charleston"], Wisconsin: ["Milwaukee", "Madison"],
  Wyoming: ["Cheyenne"],
};

// State names that are also countries, so a region like "Tbilisi, Georgia" still finds the country.
const countryNames = new Set(["georgia"]);

function stateNamed(label) {
  const lower = label.toLowerCase();
  return states.get(label.toUpperCase()) ?? [...states.values()].find(name => name.toLowerCase() === lower);
}

function isState(item, state) {
  return item?.country_code === "US" && cleanLabel(item?.admin1).toLowerCase() === state.toLowerCase();
}

function matchesRegion(item, region, state) {
  if (!region) return true;
  if (state && isState(item, state)) return true;
  if (state && !countryNames.has(region.toLowerCase())) return false;
  const target = region.toLowerCase();
  const admin1 = cleanLabel(item?.admin1).toLowerCase();
  const country = cleanLabel(item?.country).toLowerCase();
  const code = (item?.country_code ?? "").toLowerCase();
  if (admin1 === target || country === target || code === target) return true;
  if (target === "uk" && code === "gb") return true;
  if (target === "usa" && code === "us") return true;
  return false;
}

// Populated places only, so qualified searches don't surface parks, trails or memorials.
function isPopulatedPlace(item) {
  return typeof item?.feature_code !== "string" || item.feature_code.startsWith("PPL");
}

function toLocation(item) {
  const name = cleanLabel(item?.name);
  const latitude = bounded(item?.latitude, -90, 90);
  const longitude = bounded(item?.longitude, -180, 180);
  if (!name || latitude === null || longitude === null || !validTimeZone(item.timezone)) return null;
  return {
    name,
    latitude: Number(latitude.toFixed(4)),
    longitude: Number(longitude.toFixed(4)),
    region: cleanLabel(item.admin1),
    country: cleanLabel(item.country),
    countryCode: /^[A-Z]{2}$/.test(item.country_code) ? item.country_code : "",
    timezone: item.timezone,
  };
}

async function geocode(request, city, region, state) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  const usOnly = state && !countryNames.has(region.toLowerCase());
  url.search = new URLSearchParams({ name: city, count: region ? "100" : "8", language: "en", format: "json",
    ...(usOnly && { countryCode: "US" }) });
  const { data } = await request(url);
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      (data.results !== undefined && !Array.isArray(data.results))) {
    throw new ProviderError("Invalid geocoding response");
  }
  const locations = [];
  for (const item of data.results ?? []) {
    if (!matchesRegion(item, region, state) || !isPopulatedPlace(item)) continue;
    const location = toLocation(item);
    if (location) locations.push(location);
    if (locations.length === 8) break;
  }
  return locations;
}

function addUnique(target, locations) {
  for (const location of locations) {
    if (target.length === 8) break;
    if (!target.some(({ latitude, longitude }) => latitude === location.latitude && longitude === location.longitude)) {
      target.push(location);
    }
  }
}

export async function findLocations(query, { fetcher, contact }) {
  const trimmed = query.trim();
  const request = upstream(fetcher, AbortSignal.timeout(3500), contact);
  const parts = trimmed.split(/\s*,\s*/);
  const wholeState = parts.length === 1 ? stateNamed(trimmed) : undefined;

  if (wholeState) {
    // A bare state ("Oregon", "OR"): offer its main cities first. Full names also keep ordinary
    // place-name matches (e.g. "Washington" still finds Washington, DC) after them.
    const isCode = trimmed.length === 2;
    const [cities, named] = await Promise.all([
      Promise.all(stateCities[wholeState].map(city => geocode(request, city, wholeState, wholeState)
        .then(found => found.slice(0, 1)))),
      isCode ? [] : geocode(request, trimmed, "", undefined),
    ]);
    const locations = [];
    addUnique(locations, cities.flat());
    addUnique(locations, named);
    return locations;
  }

  let split = false;
  if (parts.length === 1) {
    const lower = parts[0].toLowerCase();
    const suffix = [...states.keys(), ...states.values()].sort((left, right) => right.length - left.length)
      .find(label => lower.endsWith(" " + label.toLowerCase()));
    if (suffix) {
      parts.splice(0, 1, parts[0].slice(0, -suffix.length).trim(), suffix);
      split = true;
    }
  }
  const [city, region = ""] = parts;
  const state = stateNamed(region);
  const locations = await geocode(request, city, region, state);
  // A trailing word that looked like a state may be part of the name ("Tam Ky", "West Virginia").
  if (split && !locations.length) return geocode(request, trimmed, "", undefined);
  return locations;
}
