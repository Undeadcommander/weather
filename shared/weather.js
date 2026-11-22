export const HOUR = 60 * 60 * 1000;

export const SOURCES = [
  {
    id: "open-meteo",
    name: "Open-Meteo",
    coverage: "Global · Multi-model",
    icon: "sun",
  },
  {
    id: "met-norway",
    name: "MET Norway",
    coverage: "Global · Norwegian Meteorological Institute",
    icon: "wind",
  },
  {
    id: "nws",
    name: "National Weather Service",
    coverage: "U.S. and territories · NOAA",
    icon: "cloud",
  },
];

export const DEFAULT_LOCATION = {
  name: "San Francisco",
  region: "California",
  country: "United States",
  countryCode: "US",
  latitude: 37.7749,
  longitude: -122.4194,
  timezone: "America/Los_Angeles",
};

export const CONDITIONS = {
  clear: { label: "Clear", icon: "sun" },
  partlyCloudy: { label: "Partly cloudy", icon: "partlyCloudy" },
  cloudy: { label: "Cloudy", icon: "cloud" },
  fog: { label: "Fog", icon: "fog" },
  drizzle: { label: "Drizzle", icon: "rain" },
  rain: { label: "Rain", icon: "rain" },
  sleet: { label: "Sleet", icon: "snow" },
  snow: { label: "Snow", icon: "snow" },
  thunder: { label: "Thunderstorms", icon: "thunder" },
};

export function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 64 ||
      !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
