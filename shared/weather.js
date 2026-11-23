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
  { id: "gfs", name: "NOAA GFS", coverage: "Global model via Open-Meteo", model: "gfs_seamless", icon: "wind" },
  { id: "icon", name: "DWD ICON", coverage: "German Weather Service model via Open-Meteo", model: "icon_seamless", icon: "sun" },
  { id: "ecmwf", name: "ECMWF IFS", coverage: "Global · European Centre model via Open-Meteo", model: "ecmwf_ifs025", icon: "cloud" },
  { id: "gem", name: "Canada GEM", coverage: "Global · Environment and Climate Change Canada model via Open-Meteo", model: "gem_seamless", icon: "wind" },
  { id: "jma", name: "Japan JMA", coverage: "Global · Japan Meteorological Agency model via Open-Meteo", model: "jma_seamless", icon: "sun" },
  { id: "meteofrance", name: "Météo-France", coverage: "Global · French weather service model via Open-Meteo", model: "meteofrance_seamless", icon: "cloud" },
  { id: "ukmo", name: "UK Met Office", coverage: "Global · UK Met Office model via Open-Meteo", model: "ukmo_seamless", icon: "rain" },
  { id: "cma", name: "China CMA GRAPES", coverage: "Global · China Meteorological Administration model via Open-Meteo", model: "cma_grapes_global", icon: "cloud" },
  { id: "aifs", name: "ECMWF AIFS", coverage: "Global · European Centre AI model via Open-Meteo", model: "ecmwf_aifs025_single", icon: "wind" },
  { id: "aicon", name: "DWD AICON", coverage: "Global · German Weather Service AI model via Open-Meteo", model: "dwd_aicon_global_native", icon: "sun" },
  { id: "aigfs", name: "NOAA AIGFS", coverage: "Global · NOAA AI model via Open-Meteo", model: "ncep_aigfs025", icon: "cloud" },
  { id: "hgefs", name: "NOAA HGEFS Ensemble Mean", coverage: "Global · NOAA hybrid ensemble average via Open-Meteo", model: "ncep_hgefs025_ensemble_mean", icon: "wind" },
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
