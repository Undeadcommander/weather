import { CONDITIONS, DEFAULT_LOCATION, HOUR, SOURCES, validTimeZone } from "../shared/weather.js";

export const METRICS = {
  temp: { label: "temperature", gapLabel: "temperatures", F: "°F", C: "°C" },
  rain: { label: "rain chance", gapLabel: "rain chances", F: "%", C: "%" },
  wind: { label: "wind", gapLabel: "wind speeds", F: "mph", C: "km/h" },
  humidity: { label: "humidity", F: "%", C: "%" },
  conditions: { label: "condition" },
  snow: { label: "snow" },
};

const formatters = new Map();
function format(time, timezone, options) {
  const key = JSON.stringify([timezone, options]);
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }));
    if (formatters.size > 80) formatters.delete(formatters.keys().next().value);
  }
  return formatters.get(key).format(time);
}

export function dateKey(time, timezone) {
  const key = format(time, timezone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const [month, day, year] = key.split("/");
  return `${year}-${month}-${day}`;
}

export function dateChoices(now, timezone, end) {
  const base = Date.parse(`${dateKey(now, timezone)}T00:00:00Z`);
  const last = Date.parse(`${dateKey(end, timezone)}T00:00:00Z`);
  return Array.from({ length: 1 + (last - base) / (24 * HOUR) }, (_, offset) => {
    const time = base + offset * 24 * HOUR;
    return {
      key: new Date(time).toISOString().slice(0, 10),
      label: ["Today", "Tomorrow"][offset] ?? format(time, "UTC", { weekday: "short", month: "short", day: "numeric" }),
    };
  });
}

export function hourLabel(time, timezone, withZone = false) {
  const zone = withZone ? { timeZoneName: "short" } : {};
  return format(time, timezone, { hour: "numeric", minute: "2-digit", ...zone }).replace(":00 ", " ");
}

export function detailLabel(time, timezone) {
  return `${format(time, timezone, { weekday: "short", month: "short", day: "numeric" })} · ${hourLabel(time, timezone, true)}`;
}

export function locationLabel({ name, region, country }) {
  const context = [region, country].find((value) => value && value !== name);
  return context ? `${name}, ${context}` : name;
}

export function normalizePreferences(value) {
  const ids = SOURCES.map(({ id }) => id);
  const saved = value?.location;
  const validLabel = (text) => typeof text === "string" && text.length <= 100;
  const locationIsValid = saved && ["name", "region", "country", "countryCode"].every((key) => validLabel(saved[key])) &&
    saved.name.trim() && /^([A-Z]{2})?$/.test(saved.countryCode) &&
    Number.isFinite(saved.latitude) && Math.abs(saved.latitude) <= 90 &&
    Number.isFinite(saved.longitude) && Math.abs(saved.longitude) <= 180 && validTimeZone(saved.timezone);
  return {
    unit: value?.unit === "C" ? "C" : "F",
    enabled: SOURCES.filter(({ id, model }) => Array.isArray(value?.enabled) ? value.enabled.includes(id) : !model).map(({ id }) => id),
    favorites: ids.filter((id) => Array.isArray(value?.favorites) && value.favorites.includes(id)),
    favoritesOnly: value?.favoritesOnly === true,
    location: locationIsValid ? saved : DEFAULT_LOCATION,
  };
}

export function compareSources({ enabled, favorites, favoritesOnly }) {
  return SOURCES.filter(({ id }) => enabled.includes(id) && (!favoritesOnly || favorites.includes(id)));
}

export function atHour(now) {
  return Math.floor(now / HOUR) * HOUR;
}

export function timesForDay(now, day, timezone, end = Infinity) {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const start = midnight - 15 * HOUR;
  const last = Math.min(day === dateKey(now, timezone) ? Infinity : end, midnight + 39 * HOUR);
  const times = [];
  for (let t = start; t <= last; t += HOUR) {
    if (dateKey(t, timezone) === day) times.push(t);
    else if (times.length) break;
  }
  return times;
}

export function displayNumber(value, metric, unit) {
  if (!Number.isFinite(value)) return null;
  if (metric === "temp" && unit === "F") return Math.round(value * 1.8 + 32);
  if (metric === "wind" && unit === "F") return Math.round(value / 1.609344);
  return Math.round(value);
}

export function formatValue(value, metric, unit) {
  if (!Number.isFinite(value)) return "—";
  const suffix = METRICS[metric][unit];
  const space = metric === "wind" ? " " : "";
  return `${value}${space}${suffix}`;
}

export function formatGap(value, metric, unit) {
  return metric === "rain" ? `${value} pp` : formatValue(value, metric, unit);
}

export function gapAtHour(times, series, time) {
  const index = times.indexOf(time);
  const values = series.map(({ values }) => values[index]).filter(Number.isFinite);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, spread: max - min };
}

function median(values) {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return null;
  const center = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[center] : (usable[center - 1] + usable[center]) / 2;
}

export function conditionInfo(row) {
  if (!row || !Object.hasOwn(CONDITIONS, row.condition)) return null;
  const info = CONDITIONS[row.condition];
  if (row.condition !== "clear") return info;
  return row.night ? { ...info, icon: "moon" } : { ...info, label: "Sunny" };
}

export function hasSnow(row) {
  return row?.snowfall > 0 || row?.snowMentioned === true || row?.condition === "snow";
}

export function snowForecast(row, unit) {
  if (Number.isFinite(row?.snowfall) && (row.snowfall > 0 || !hasSnow(row))) {
    const amount = unit === "F" ? row.snowfall / 2.54 : row.snowfall;
    const rounded = Number(amount.toFixed(2));
    return `${amount > 0 && !rounded ? "<0.01" : rounded} ${unit === "F" ? "in" : "cm"}`;
  }
  if (hasSnow(row)) return "Snow possible";
  return conditionInfo(row) ? "No snow indicated" : null;
}

export function currentSummary(rows) {
  const readings = rows.filter(Boolean);
  if (!readings.length) return null;
  const counts = new Map();
  for (const row of readings) {
    if (conditionInfo(row)) counts.set(row.condition, (counts.get(row.condition) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const condition = ranked[0]?.[0];
  const isTied = ranked.length > 1 && ranked[0][1] === ranked[1][1];
  return {
    temp: median(readings.map(({ temp }) => temp)),
    rain: median(readings.map(({ rain }) => rain)),
    wind: median(readings.map(({ wind }) => wind)),
    humidity: median(readings.map(({ humidity }) => humidity)),
    condition: isTied ? null : conditionInfo(readings.find((row) => row.condition === condition)),
    isTied,
  };
}
