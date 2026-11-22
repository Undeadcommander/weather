import assert from "node:assert/strict";
import test from "node:test";
import { HOUR } from "../shared/weather.js";
import { createApp } from "../server/app.js";
import { normalizeMetNorway, normalizeNws, normalizeOpenMeteo } from "../server/providers.js";

const NOW = Date.parse("2026-11-22T16:13:00Z");
const START = Math.floor(NOW / HOUR) * HOUR;
const ORIGIN = "http://skylens.test";
const weather = (source, lat = 37.7749, lon = -122.4194) => `/api/weather?source=${source}&lat=${lat}&lon=${lon}`;

function openMeteo(t = START) {
  return { hourly: {
    time: [t / 1000, (t + HOUR) / 1000, (t + 3 * HOUR) / 1000],
    temperature_2m: [12.1, 13, 15], precipitation_probability: [70, 25, 0],
    wind_speed_10m: [10, 11, 12], relative_humidity_2m: [84, 83, 82],
    weather_code: [2, 0, 61], is_day: [1, 1, 1],
  } };
}

function metNorway(t = START) {
  return { properties: { timeseries: [
    { time: new Date(t).toISOString(), data: {
      instant: { details: { air_temperature: 10, wind_speed: 3, relative_humidity: 92 } },
      next_1_hours: { summary: { symbol_code: "clearsky_night" } },
    } },
    { time: new Date(t + 6 * HOUR).toISOString(), data: {
      instant: { details: { air_temperature: 9, wind_speed: 5 } },
      next_6_hours: { summary: { symbol_code: "lightrain" } },
    } },
  ] } };
}

function nws(t = START) {
  return { properties: { periods: [
    {
      startTime: new Date(t).toISOString(), endTime: new Date(t + HOUR).toISOString(),
      shortForecast: "Mostly Sunny", temperature: 50, temperatureUnit: "F",
      windSpeed: "5 to 15 mph", probabilityOfPrecipitation: { value: 0 }, relativeHumidity: { value: 75 },
    },
    {
      startTime: new Date(t + HOUR).toISOString(), endTime: new Date(t + 3 * HOUR).toISOString(),
      shortForecast: "Rain and Thunderstorms", temperature: 10, temperatureUnit: "C",
      windSpeed: "Calm", probabilityOfPrecipitation: { value: 40 }, isDaytime: false,
    },
  ] } };
}

function request(app, path, options, context) {
  return app(new Request(ORIGIN + path, options), context);
}

test("Open-Meteo aligns precipitation probability to the beginning of the hour", () => {
  const rows = normalizeOpenMeteo(openMeteo());
  assert.deepEqual(rows[0], { t: START, temp: 12.1, rain: 25, wind: 10, humidity: 84, condition: "partlyCloudy", night: false });
  assert.equal(rows[1].rain, null);
  assert.equal(rows[2].condition, "rain");
  assert.deepEqual(normalizeOpenMeteo({ hourly: {} }), []);
});

test("MET Norway converts m/s and preserves unavailable hourly fields", () => {
  const rows = normalizeMetNorway(metNorway());
  assert.deepEqual(rows[0], { t: START, temp: 10, rain: null, wind: 10.8, humidity: 92, condition: "clear", night: true });
  assert.equal(rows[1].t - rows[0].t, 6 * HOUR);
  assert.equal(rows[1].condition, null);
  assert.equal(rows[1].humidity, null);
});

test("NWS converts temperature and wind ranges and keeps zero distinct from missing", () => {
  const rows = normalizeNws(nws());
  assert.equal(rows[0].temp, 10);
  assert.equal(rows[0].wind, 16.09344);
  assert.equal(rows[0].rain, 0);
  assert.equal(rows[0].condition, "partlyCloudy");
  assert.equal(rows[1].temp, 10);
  assert.equal(rows[1].wind, 0);
  assert.equal(rows[1].rain, null);
  assert.equal(rows[1].condition, "thunder");
  assert.equal(rows[1].night, true);
});

test("bad provider fields stay missing instead of becoming zero", () => {
  const data = openMeteo();
  data.hourly.temperature_2m[0] = "12";
  data.hourly.precipitation_probability[1] = 101;
  data.hourly.wind_speed_10m[0] = -3;
  data.hourly.relative_humidity_2m[0] = Infinity;
  const [{ temp, rain, wind, humidity }] = normalizeOpenMeteo(data);
  assert.deepEqual([temp, rain, wind, humidity], [null, null, null, null]);
});

test("weather endpoint fixes origins and identification and drops out-of-range hours", async () => {
  const calls = [];
  const app = createApp({ clock: () => NOW, fetcher: async (url, options) => {
    calls.push([url, options]);
    return Response.json(openMeteo(START - 2 * HOUR));
  } });
  const response = await request(app, weather("open-meteo", "37.774912", "-122.419444"), {}, { contact: "weather.example.com" });
  assert.equal(response.status, 200);
  const [url, options] = calls[0];
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("longitude"), "-122.4194");
  assert.equal(url.searchParams.get("latitude"), "37.7749");
  assert.equal(options.redirect, "manual");
  assert.ok(options.signal instanceof AbortSignal);
  assert.match(options.headers["User-Agent"], /weather\.example\.com/);
  const payload = await response.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.stale, false);
  assert.deepEqual(payload.rows.map(({ t }) => t), [START - HOUR, START + HOUR]);
});

test("NWS uses the hourly endpoint supplied by its points API and reports coverage", async () => {
  const visited = [];
  const app = createApp({ clock: () => NOW, fetcher: async (url) => {
    visited.push(url.href);
    if (url.pathname === "/points/51.5,-0.1") return new Response(null, { status: 404 });
    if (url.pathname.startsWith("/points/")) {
      return Response.json({ properties: { forecastHourly: "https://api.weather.gov/gridpoints/MTR/85,105/forecast/hourly" } });
    }
    return Response.json(nws());
  } });
  const sf = await (await request(app, weather("nws"))).json();
  assert.equal(sf.status, "ok");
  assert.equal(sf.rows.length, 2);
  assert.deepEqual(visited, [
    "https://api.weather.gov/points/37.7749,-122.4194",
    "https://api.weather.gov/gridpoints/MTR/85,105/forecast/hourly",
  ]);
  const london = await (await request(app, weather("nws", 51.5, -0.1))).json();
  assert.equal(london.status, "unsupported");
  assert.deepEqual(london.rows, []);
});

test("an unrecognized upstream path is rejected before making another request", async () => {
  let calls = 0;
  const app = createApp({ clock: () => NOW, fetcher: async () => {
    calls++;
    return Response.json({ properties: { forecastHourly: "https://api.weather.gov/alerts/active" } });
  } });
  const response = await request(app, weather("nws"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "unavailable");
  assert.equal(calls, 1);
});

test("provider redirects return an unavailable forecast", async () => {
  let calls = 0;
  const app = createApp({ clock: () => NOW, fetcher: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://api.weather.gov/alerts/" } });
  } });
  const response = await request(app, weather("nws"));
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});

test("forecast cache coalesces concurrent requests and honors expiration and stale limits", async () => {
  let calls = 0;
  let now = NOW;
  let fail = false;
  const app = createApp({ clock: () => now, fetcher: async () => {
    calls++;
    return fail ? new Response(null, { status: 503 }) : Response.json(openMeteo());
  } });
  const path = weather("open-meteo");
  const [first, second, third] = await Promise.all(Array.from({ length: 3 }, () => request(app, path).then((r) => r.json())));
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.equal(first.retrievedAt, NOW);
  now += 4 * 60_000;
  assert.equal((await (await request(app, path)).json()).stale, false);
  assert.equal(calls, 1);
  now += 2 * 60_000;
  fail = true;
  const cached = await (await request(app, path)).json();
  assert.equal(cached.status, "ok");
  assert.equal(cached.stale, true);
  assert.equal(cached.retrievedAt, NOW);
  assert.equal(calls, 2);
  assert.equal((await (await request(app, path)).json()).stale, true);
  assert.equal(calls, 2);
  now += HOUR;
  assert.equal((await request(app, path)).status, 503);
  assert.equal(calls, 3);
});

test("MET Norway cache honors a later upstream expiration", async () => {
  let calls = 0;
  let now = NOW;
  const app = createApp({ clock: () => now, fetcher: async () => {
    calls++;
    return Response.json(metNorway(), { headers: { Expires: new Date(NOW + 30 * 60_000).toUTCString() } });
  } });
  await request(app, weather("met-norway"));
  now += 15 * 60_000;
  assert.deepEqual((await (await request(app, weather("met-norway"))).json()).stale, false);
  assert.equal(calls, 1);
});

test("capacity limits new upstream lookups while existing lookups finish", async () => {
  let calls = 0;
  const gate = Promise.withResolvers();
  const app = createApp({ clock: () => NOW, fetcher: async () => {
    calls++;
    await gate.promise;
    return Response.json({});
  } });
  const pending = Array.from({ length: 32 }, (_, i) => request(app, `/api/locations?q=City${i}`));
  const duplicate = request(app, "/api/locations?q=City0");
  try {
    assert.equal((await request(app, "/api/locations?q=Another")).status, 503);
    assert.equal(calls, 32);
  } finally {
    gate.resolve();
  }
  assert.ok((await Promise.all([...pending, duplicate])).every(({ status }) => status === 200));
  assert.equal((await request(app, "/api/locations?q=Another")).status, 200);
  assert.equal(calls, 33);
});

test("city search encodes Unicode, validates location metadata, and caches repeated lookups", async () => {
  const visited = [];
  const app = createApp({ clock: () => NOW, fetcher: async (url) => {
    visited.push(url);
    return Response.json({ results: [
      { name: " São Paulo ", admin1: "São Paulo", country: "Brazil", country_code: "BR", latitude: -23.55052, longitude: -46.63331, timezone: "America/Sao_Paulo" },
      { name: "No zone", latitude: 10, longitude: 20, timezone: "Unknown/Zone" },
      { name: "No coordinates", latitude: "10", longitude: 20, timezone: "America/Sao_Paulo" },
    ] });
  } });
  const first = await (await request(app, "/api/locations?q=S%C3%A3o%20%20Paulo")).json();
  const repeated = await (await request(app, "/api/locations?q=s%C3%A3o+paulo")).json();
  assert.deepEqual(first, repeated);
  assert.deepEqual(first.locations, [{ name: "São Paulo", region: "São Paulo", country: "Brazil", countryCode: "BR",
    latitude: -23.5505, longitude: -46.6333, timezone: "America/Sao_Paulo" }]);
  assert.equal(visited[0].origin, "https://geocoding-api.open-meteo.com");
  assert.equal(visited[0].searchParams.get("name"), "São Paulo");
  assert.equal(visited.length, 1);
});

test("invalid inputs and unsupported HTTP methods never reach a provider", async () => {
  let upstreamCalls = 0;
  const app = createApp({ clock: () => NOW, fetcher: async () => { upstreamCalls++; } });
  for (const path of [
    weather("unknown"), weather("nws", 90.0001), weather("nws", 0, 181), weather("nws", "NaN"), weather("nws", "1e2"),
    "/api/weather?source=nws&lat=10", "/api/weather?source=nws&lat=10&lat=11", "/api/locations?q=a",
    "/api/locations?q=Tokyo&q=Osaka", `/api/locations?q=${"a".repeat(81)}`,
  ]) {
    const response = await request(app, path);
    assert.equal(response.status, 400, path);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal((await request(app, `/api/locations?q=${"a".repeat(1900)}`)).status, 414);
  const post = await request(app, "/api/locations?q=Tokyo", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("Allow"), "GET");
  assert.equal((await request(app, "/api/elsewhere")).status, 404);
  assert.equal(upstreamCalls, 0);
});

test("invalid and oversized upstream responses return a provider-specific failure", async () => {
  let mode = "empty";
  const app = createApp({ clock: () => NOW, fetcher: async () => {
    if (mode === "oversized") return new Response(" ".repeat(900_001));
    if (mode === "invalid") return new Response("unexpected data");
    return Response.json({});
  } });
  for (mode of ["empty", "invalid", "oversized"]) {
    const response = await request(app, weather("open-meteo"));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      source: "open-meteo", status: "unavailable", error: "Forecast is temporarily unavailable",
    });
  }
});

test("the API throttles bursts independently by client and refills over time", async () => {
  let now = NOW;
  const app = createApp({ clock: () => now, rateLimit: 2, fetcher: async () => Response.json({}) });
  const path = "/api/locations?q=Seattle";
  for (let i = 0; i < 2; i++) assert.equal((await request(app, path, {}, { ip: "client-1" })).status, 200);
  const throttled = await request(app, path, {}, { ip: "client-1" });
  assert.equal(throttled.status, 429);
  assert.ok(throttled.headers.get("Retry-After"));
  assert.equal((await request(app, path, {}, { ip: "client-2" })).status, 200);
  now += 30_000;
  assert.equal((await request(app, path, {}, { ip: "client-1" })).status, 200);
});

test("static responses are allowlisted, revalidatable, and carry security headers", async () => {
  const app = createApp({
    assets: new Map([["/", { type: "text/html; charset=utf-8", etag: '"checked"', body: () => "<h1>Skylens</h1>" }]]),
  });
  const response = await request(app, "/");
  assert.equal(await response.text(), "<h1>Skylens</h1>");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  const head = await request(app, "/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const conditional = await request(app, "/", { headers: { "If-None-Match": 'W/"checked"' } });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
  assert.equal((await request(app, "/package.json")).status, 404);
});
