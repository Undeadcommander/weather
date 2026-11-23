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
  { id: "ecmwf9", name: "ECMWF HRES 9 km", coverage: "Global · European Centre high-resolution model via Open-Meteo", model: "ecmwf_ifs", icon: "cloud" },
  // Station-based statistical forecasts from the German Weather Service, delivered through Bright Sky.
  { id: "mosmix", name: "DWD MOSMIX", coverage: "Global · German Weather Service station forecasts via Bright Sky", provider: "brightsky", icon: "sun" },
  // Regional models. Open-Meteo reports locations outside a model's domain, which shows as "Outside coverage".
  { id: "hrrr", name: "NOAA HRRR", coverage: "Continental U.S. · NOAA 3 km rapid-refresh model via Open-Meteo", model: "gfs_hrrr", icon: "wind" },
  { id: "nbm", name: "NOAA National Blend", coverage: "Continental U.S. · NOAA National Blend of Models via Open-Meteo", model: "ncep_nbm_conus", icon: "cloud" },
  { id: "rdps", name: "Canada RDPS", coverage: "North America · Canadian regional model via Open-Meteo", model: "gem_regional", icon: "sun" },
  { id: "hrdps", name: "Canada HRDPS", coverage: "Canada and the northern U.S. · Canadian 2.5 km model via Open-Meteo", model: "gem_hrdps_continental", icon: "wind" },
  { id: "hrdpsw", name: "Canada HRDPS West", coverage: "Pacific Northwest · Canadian high-resolution model via Open-Meteo", model: "gem_hrdps_west", icon: "rain" },
  { id: "icond2", name: "DWD ICON-D2", coverage: "Germany and central Europe · German 2 km model via Open-Meteo", model: "icon_d2", icon: "sun" },
  { id: "iconeu", name: "DWD ICON-EU", coverage: "Europe · German 7 km model via Open-Meteo", model: "icon_eu", icon: "cloud" },
  { id: "arome", name: "Météo-France AROME", coverage: "France and neighbors · French 1.3 km model via Open-Meteo", model: "meteofrance_arome_france", icon: "rain" },
  { id: "aromehd", name: "Météo-France AROME HD", coverage: "France and neighbors · French 1.3 km hourly model via Open-Meteo", model: "meteofrance_arome_france_hd", icon: "wind" },
  { id: "arpege", name: "Météo-France ARPEGE Europe", coverage: "Europe · French 11 km model via Open-Meteo", model: "meteofrance_arpege_europe", icon: "sun" },
  { id: "ukv", name: "UK Met Office UKV", coverage: "United Kingdom · UK Met Office 2 km model via Open-Meteo", model: "ukmo_uk_deterministic_2km", icon: "cloud" },
  { id: "knmi", name: "KNMI HARMONIE-AROME", coverage: "Northwest Europe · Dutch 2 km model via Open-Meteo", model: "knmi_harmonie_arome_europe", icon: "wind" },
  { id: "dmi", name: "DMI HARMONIE-AROME", coverage: "Northern Europe · Danish 2 km model via Open-Meteo", model: "dmi_harmonie_arome_europe", icon: "rain" },
  { id: "nordic", name: "MetCoOp Nordic", coverage: "Nordic countries · MET Norway, SMHI and FMI 2.5 km model via Open-Meteo", model: "metno_nordic", icon: "sun" },
  { id: "icon-ch", name: "MeteoSwiss ICON-CH", coverage: "Switzerland and the Alps · Swiss 1 km and 2 km models via Open-Meteo", model: "meteoswiss_icon_seamless", icon: "cloud" },
  { id: "icon2i", name: "Italia Meteo ICON-2I", coverage: "Italy · Italian 2 km model via Open-Meteo", model: "italia_meteo_arpae_icon_2i", icon: "wind" },
  { id: "msm", name: "Japan JMA MSM", coverage: "Japan · Japan Meteorological Agency 5 km model via Open-Meteo", model: "jma_msm", icon: "rain" },
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
