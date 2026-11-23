import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LOCATION, HOUR } from "../shared/weather.js";
import {
  averageAtHour, compareSources, conditionInfo, currentSummary, dateChoices, dateKey, detailLabel,
  displayNumber, formatGap, formatValue, gapAtHour, hourLabel, locationLabel,
  normalizePreferences, timesForDay,
} from "../web/model.js";

test("preferences recover from corrupt storage and keep only available source IDs", () => {
  assert.deepEqual(normalizePreferences(null).enabled, ["open-meteo", "met-norway", "nws"]);
  const saved = normalizePreferences({
    unit: "K", enabled: ["nws", "nws", "unknown"], favorites: ["met-norway", "nws", "invalid"],
    favoritesOnly: true, location: { ...DEFAULT_LOCATION, timezone: "Unknown/City" },
  });
  assert.equal(saved.unit, "F");
  assert.deepEqual(saved.location, DEFAULT_LOCATION);
  assert.deepEqual(saved.favorites, ["met-norway", "nws"]);
  assert.deepEqual(compareSources(saved).map(({ id }) => id), ["nws"]);
  assert.deepEqual(compareSources(normalizePreferences({ enabled: [] })), []);
});

test("calendar choices use the city date across UTC boundaries and the new year", () => {
  const now = Date.parse("2027-01-01T04:20:00Z");
  assert.deepEqual(dateChoices(now, "America/Los_Angeles", now + 48 * HOUR).map(({ key }) => key),
    ["2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.equal(dateKey(now, "Asia/Tokyo"), "2027-01-01");
  assert.equal(locationLabel({ name: "Singapore", country: "Singapore", region: "" }), "Singapore");
});

test("Today includes the full 23-hour and 25-hour local calendar days", () => {
  const timezone = "America/Los_Angeles";
  const fall = timesForDay(Date.parse("2026-11-02T06:30:00Z"), "2026-11-01", timezone);
  const spring = timesForDay(Date.parse("2026-03-09T06:30:00Z"), "2026-03-08", timezone);
  assert.equal(fall.length, 25);
  assert.equal(spring.length, 23);
  assert.equal(hourLabel(fall[1], timezone, true), "1 AM PDT");
  assert.equal(hourLabel(fall[2], timezone, true), "1 AM PST");
  assert.equal(spring[2] - spring[1], HOUR);
  assert.equal(detailLabel(spring[2], timezone), "Sun, Mar 8 · 3 AM PDT");
  assert.equal(hourLabel(spring[2], "Asia/Kolkata"), "3:30 PM");
});

test("Today spans the local day across UTC boundaries even with a partial forecast", () => {
  const now = Date.parse("2026-11-22T17:30:00Z");
  for (const timezone of ["America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    const day = dateKey(now, timezone);
    const times = timesForDay(now, day, timezone, now);
    assert.equal(times.length, 24);
    assert.equal(hourLabel(times[0], timezone), "12 AM");
    assert.equal(hourLabel(times.at(-1), timezone), "11 PM");
    assert.ok(times.every(time => dateKey(time, timezone) === day));
  }
  const end = Date.parse("2026-11-24T10:00:00Z");
  const future = timesForDay(now, "2026-11-24", "America/Los_Angeles", end);
  assert.equal(future.at(-1), end);
});

test("unit conversions and comparison labels match displayed precision", () => {
  assert.equal(displayNumber(10, "temp", "F"), 50);
  assert.equal(displayNumber(10.49, "temp", "C"), 10);
  assert.equal(displayNumber(10, "wind", "F"), 6);
  assert.equal(displayNumber(0, "rain", "C"), 0);
  assert.equal(displayNumber(null, "rain", "C"), null);
  assert.equal(formatValue(0, "rain", "F"), "0%");
  assert.equal(formatGap(12, "rain", "F"), "12 pp");
  assert.equal(formatGap(10, "wind", "C"), "10 km/h");
});

test("forecast differences use only the requested hour and require two values", () => {
  const times = [0, HOUR, HOUR * 2, HOUR * 3];
  const series = [{ values: [10, null, 20, 10] }, { values: [8, 99, 14, 10] }, { values: [null, null, 16, 10] }];
  assert.deepEqual(gapAtHour(times, series, 0), { min: 8, max: 10, spread: 2 });
  assert.equal(gapAtHour(times, series, HOUR), null);
  assert.equal(gapAtHour(times, series, 2 * HOUR).spread, 6);
  assert.equal(gapAtHour(times, series, 3 * HOUR).spread, 0);
  assert.equal(gapAtHour(times, series, 4 * HOUR), null);
});

test("hourly averages include all finite readings and allow a single reporting source", () => {
  const times = [0, HOUR, 2 * HOUR];
  const series = [{ values: [10, null, null] }, { values: [10, 0, NaN] }, { values: [40, Infinity, null] }];
  assert.equal(averageAtHour(times, series, 0), 20);
  assert.equal(averageAtHour(times, series, HOUR), 0);
  assert.equal(averageAtHour(times, series, 2 * HOUR), null);
  assert.equal(averageAtHour(times, series, 3 * HOUR), null);
  assert.equal(averageAtHour(times, [], 0), null);
});

test("current summary uses medians and identifies mixed conditions and night icons", () => {
  const rows = [
    { temp: 7, rain: 0, wind: 8, humidity: 80, condition: "clear", night: true },
    { temp: 11, rain: null, wind: 16, humidity: 90, condition: "cloudy" },
  ];
  const tied = currentSummary(rows);
  assert.deepEqual(tied, { temp: 9, rain: 0, wind: 12, humidity: 85, condition: null, isTied: true });
  assert.equal(conditionInfo(rows[0]).icon, "moon");
  assert.equal(currentSummary([...rows, { ...rows[0], temp: 100 }]).temp, 11);
  assert.equal(currentSummary([null, undefined]), null);
});
