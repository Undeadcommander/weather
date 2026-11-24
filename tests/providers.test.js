import assert from "node:assert/strict";
import test from "node:test";
import { HOUR } from "../shared/weather.js";
import { fetchBrightSky, normalizeBrightSky } from "../shared/bright-sky.js";
import { fetchOpenMeteo, normalizeOpenMeteo } from "../shared/open-meteo.js";
import { createApp } from "../server/app.js";
import { findLocations, normalizeMetNorway, normalizeNws } from "../server/providers.js";

test("qualified city searches filter by state before limiting results", async () => {
  const base = { name: "Portland", latitude: 45, longitude: -123, country_code: "US", timezone: "America/Los_Angeles" };
  for (const query of ["Portland, OR", "Portland or", "Portland, Oregon", "Portland Oregon"]) {
    const matches = await findLocations(query, { fetcher: async (url) => {
      assert.equal(url.searchParams.get("name"), "Portland");
      assert.equal(url.searchParams.get("countryCode"), "US");
      return Response.json({ results: [...Array(8).fill({ ...base, admin1: "Maine" }), { ...base, admin1: "Oregon" }] });
    } });
    assert.deepEqual(matches.map(({ region }) => region), ["Oregon"]);
  }
});

test("qualified city searches match country names, country codes, and international regions", async () => {
  const parisFr = { name: "Paris", latitude: 48.85, longitude: 2.35, admin1: "Île-de-France", country: "France", country_code: "FR", timezone: "Europe/Paris" };
  const parisTx = { name: "Paris", latitude: 33.66, longitude: -95.55, admin1: "Texas", country: "United States", country_code: "US", timezone: "America/Chicago" };
  const londonUk = { name: "London", latitude: 51.5, longitude: -0.12, admin1: "England", country: "United Kingdom", country_code: "GB", timezone: "Europe/London" };
  const londonCa = { name: "London", latitude: 42.98, longitude: -81.23, admin1: "Ontario", country: "Canada", country_code: "CA", timezone: "America/Toronto" };

  const matchesFr = await findLocations("Paris, France", { fetcher: async () => Response.json({ results: [parisTx, parisFr] }) });
  assert.deepEqual(matchesFr.map(m => m.country), ["France"]);

  const matchesUk = await findLocations("London, UK", { fetcher: async () => Response.json({ results: [londonCa, londonUk] }) });
  assert.deepEqual(matchesUk.map(m => m.country), ["United Kingdom"]);

  const matchesUs = await findLocations("San Francisco, US", { fetcher: async () => Response.json({ results: [
    { name: "San Francisco", latitude: 37.77, longitude: -122.42, admin1: "California", country: "United States", country_code: "US", timezone: "America/Los_Angeles" },
  ] }) });
  assert.equal(matchesUs[0].name, "San Francisco");
});

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

test("Open-Meteo aligns precipitation probability and weather to the beginning of the hour", () => {
  const rows = normalizeOpenMeteo(openMeteo());
  assert.deepEqual(rows[0], { t: START, temp: 12.1, rain: 25, snowfall: null, snowMentioned: false, wind: 10, humidity: 84, condition: "clear", night: false });
  // The hour after 1 h is missing, so its rain chance and weather are unknown.
  assert.deepEqual([rows[1].rain, rows[1].condition], [null, null]);
  assert.equal(rows[2].condition, null);
  assert.deepEqual(normalizeOpenMeteo({ hourly: {} }), []);
});

test("Bright Sky maps icons, estimates missing humidity from dew point and aligns rain chance", () => {
  const stamp = (offset) => new Date(START + offset * HOUR).toISOString();
  const rows = normalizeBrightSky({ weather: [
    { timestamp: stamp(0), temperature: 20, dew_point: 20, relative_humidity: null, wind_speed: 12.5, icon: "partly-cloudy-night", precipitation_probability: null },
    { timestamp: stamp(1), temperature: 10, dew_point: 2, relative_humidity: 70, wind_speed: 0, icon: "thunderstorm", precipitation_probability: 35 },
    { timestamp: stamp(5), temperature: "warm", dew_point: 30, icon: "wind" },
  ] });
  assert.equal(rows[0].humidity, 100);
  assert.equal(rows[0].rain, 35);
  assert.equal(rows[0].night, true);
  assert.equal(rows[0].condition, "partlyCloudy");
  assert.equal(rows[0].wind, 12.5);
  assert.deepEqual([rows[1].humidity, rows[1].rain, rows[1].condition, rows[1].wind], [70, null, "thunder", 0]);
  assert.deepEqual([rows[2].temp, rows[2].humidity, rows[2].condition], [null, null, null]);
  assert.deepEqual(normalizeBrightSky({}), []);
});

test("Open-Meteo and Bright Sky report unsupported places instead of failing", async (context) => {
  const original = globalThis.fetch;
  context.after(() => { globalThis.fetch = original; });
  const place = { latitude: 35.68, longitude: 139.69 };
  const reply = (body, status) => () => Promise.resolve(Response.json(body, { status }));

  globalThis.fetch = reply({ error: true, reason: "No data is available for this location" }, 400);
  const outside = await fetchOpenMeteo(place, undefined, { id: "hrrr", model: "gfs_hrrr" });
  assert.deepEqual([outside.source, outside.status, outside.rows], ["hrrr", "unsupported", []]);

  globalThis.fetch = reply({ error: true, reason: "Invalid value: Cannot initialize MultiDomains" }, 400);
  await assert.rejects(fetchOpenMeteo(place, undefined, { id: "hrrr", model: "gfs_hrrr" }), /unavailable/);
  globalThis.fetch = reply({ error: true, reason: "No data is available for this location" }, 400);
  await assert.rejects(fetchOpenMeteo(place), /unavailable/);

  globalThis.fetch = reply({ detail: "No weather data" }, 404);
  assert.equal((await fetchBrightSky(place)).status, "unsupported");
  globalThis.fetch = reply({}, 500);
  await assert.rejects(fetchBrightSky(place), /unavailable/);
});

test("MET Norway converts m/s and preserves unavailable hourly fields", () => {
  const rows = normalizeMetNorway(metNorway());
  assert.deepEqual(rows[0], { t: START, temp: 10, rain: null, snowfall: null, snowMentioned: false, wind: 10.8, humidity: 92, condition: "clear", night: true });
  assert.equal(rows[1].t - rows[0].t, 6 * HOUR);
  assert.equal(rows[1].condition, "rain");
  assert.equal(rows[1].humidity, null);
});

test("snow amounts and snow weather cover the same hour and snow mentions survive mixed conditions", () => {
  const data = openMeteo();
  data.hourly.snowfall = [0, 1.5, 2];
  data.hourly.weather_code = [0, 73, 0];
  assert.deepEqual(normalizeOpenMeteo(data).map(row => [row.snowfall, row.snowMentioned]),
    [[1.5, true], [null, false], [null, false]]);
  // Snow ending at the first time stamp belongs to the hour before it, not to the first row.
  data.hourly.snowfall = [2, 0, 0];
  data.hourly.weather_code = [71, 0, 0];
  assert.deepEqual(normalizeOpenMeteo(data).map(row => [row.snowfall, row.snowMentioned])[0], [0, false]);
  const met = metNorway();
  met.properties.timeseries[0].data.next_1_hours.summary.symbol_code = "snowandthunder";
  met.properties.timeseries[1].data.next_6_hours.summary.symbol_code = "lightsnow";
  assert.deepEqual(normalizeMetNorway(met).map(row => row.snowMentioned), [true, true]);
  const weather = nws();
  weather.properties.periods[0].shortForecast = "Chance of flurries";
  assert.equal(normalizeNws(weather)[0].snowMentioned, true);
  weather.properties.periods[0].shortForecast = "Freezing rain";
  assert.equal(normalizeNws(weather)[0].snowMentioned, false);
});

test("sleet counts as possible snow for every source, but hail and freezing rain do not", () => {
  const met = metNorway();
  met.properties.timeseries[0].data.next_1_hours.summary.symbol_code = "lightsleet";
  assert.equal(normalizeMetNorway(met)[0].snowMentioned, true);
  const weather = nws();
  weather.properties.periods[0].shortForecast = "Chance Rain And Sleet";
  assert.equal(normalizeNws(weather)[0].snowMentioned, true);
  const stamp = new Date(START).toISOString();
  const sky = icon => normalizeBrightSky({ weather: [{ timestamp: stamp, temperature: 0, icon }] })[0];
  assert.deepEqual([sky("sleet").condition, sky("sleet").snowMentioned], ["sleet", true]);
  assert.deepEqual([sky("hail").condition, sky("hail").snowMentioned], ["hail", false]);
  assert.equal(sky("snow").snowMentioned, true);
});

test("hail and freezing rain have their own conditions for every source that reports them", () => {
  const data = openMeteo();
  data.hourly.time = data.hourly.time.map((_, i) => (START + i * HOUR) / 1000);
  const codes = [56, 57, 66, 67, 51, 61, 95, 96, 99];
  const conditions = codes.map(code => {
    data.hourly.weather_code = [0, code, 0];
    return normalizeOpenMeteo(data)[0].condition;
  });
  assert.deepEqual(conditions, ["freezingRain", "freezingRain", "freezingRain", "freezingRain", "drizzle", "rain", "thunder", "hail", "hail"]);

  const weather = nws();
  const nwsRow = text => {
    weather.properties.periods[0].shortForecast = text;
    return normalizeNws(weather)[0];
  };
  assert.deepEqual(["Freezing Rain", "Chance Freezing Drizzle", "Thunderstorms With Hail", "Sleet", "Wintry Mix"].map(text => nwsRow(text).condition),
    ["freezingRain", "freezingRain", "hail", "sleet", "sleet"]);
  assert.equal(nwsRow("Freezing Rain And Sleet").snowMentioned, true);
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

test("weather endpoint fixes origins and identification and retains earlier hours", async () => {
  const calls = [];
  const app = createApp({ clock: () => NOW, fetcher: async (url, options) => {
    calls.push([url, options]);
    return Response.json(metNorway(START - 2 * HOUR));
  } });
  const response = await request(app, weather("met-norway", "37.774912", "-122.419444"), {}, { contact: "weather.example.com" });
  assert.equal(response.status, 200);
  const [url, options] = calls[0];
  assert.equal(url.origin, "https://api.met.no");
  assert.equal(url.searchParams.get("lon"), "-122.4194");
  assert.equal(url.searchParams.get("lat"), "37.7749");
  assert.equal(options.redirect, "manual");
  assert.ok(options.signal instanceof AbortSignal);
  assert.match(options.headers["User-Agent"], /weather\.example\.com/);
  const payload = await response.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.stale, false);
  assert.deepEqual(payload.rows.map(({ t }) => t), [START - 2 * HOUR, START + 4 * HOUR]);
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
    return fail ? new Response(null, { status: 503 }) : Response.json(metNorway());
  } });
  const path = weather("met-norway");
  const [first, second, third] = await Promise.all(Array.from({ length: 3 }, () => request(app, path).then((r) => r.json())));
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.equal(first.retrievedAt, NOW);
  now += 9 * 60_000;
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
    const response = await request(app, weather("met-norway"));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      source: "met-norway", status: "unavailable", error: "Forecast is temporarily unavailable",
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
  assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'self' https:\/\/api\.open-meteo\.com https:\/\/api\.brightsky\.dev;/);
  assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  const head = await request(app, "/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const conditional = await request(app, "/", { headers: { "If-None-Match": 'W/"checked"' } });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
  assert.equal((await request(app, "/package.json")).status, 404);
});

test("private hosting can require a signed-in visitor for pages and API calls", async () => {
  const app = createApp({
    assets: new Map([["/", { type: "text/html", etag: '"auth"', body: () => "<h1>Skylens</h1>" }]]),
    fetcher: async () => Response.json({}),
  });
  const settings = { requireSignIn: true };
  for (const path of ["/", "/api/locations?q=Paris"]) {
    const denied = await request(app, path, {}, settings);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("Cache-Control"), "no-store");
    const allowed = await request(app, path, { headers: { "OAI-Authenticated-User-Email": "owner@example.com" } }, settings);
    assert.equal(allowed.status, 200);
  }
});

function geocoder(byName) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push({ name: url.searchParams.get("name"), countryCode: url.searchParams.get("countryCode") });
    return Response.json({ results: byName[url.searchParams.get("name")] ?? [] });
  };
  return { calls, fetcher };
}
const place = (name, admin1, extra = {}) => ({ name, admin1, latitude: 45 + name.length / 100, longitude: -100 - admin1.length / 100,
  country: "United States", country_code: "US", timezone: "America/Chicago", feature_code: "PPL", ...extra });

test("state-only searches offer the state's main cities first", async () => {
  const results = {
    Portland: [place("Portland", "Maine"), place("Portland", "Oregon")],
    Salem: [place("Salem", "Massachusetts"), place("Salem", "Oregon")],
    Oregon: [place("Oregon", "Illinois"), place("Oregon", "Ohio")],
  };
  const named = geocoder(results);
  const matches = await findLocations("Oregon", { fetcher: named.fetcher });
  assert.deepEqual(matches.map(({ name, region }) => `${name}, ${region}`),
    ["Portland, Oregon", "Salem, Oregon", "Oregon, Illinois", "Oregon, Ohio"]);
  assert.ok(named.calls.filter(({ name }) => name !== "Oregon").every(({ countryCode }) => countryCode === "US"));

  const coded = geocoder(results);
  const codeMatches = await findLocations("or", { fetcher: coded.fetcher });
  assert.deepEqual(codeMatches.map(({ name }) => name), ["Portland", "Salem"]);
  assert.ok(!coded.calls.some(({ name }) => name === "or"), "a bare code is not searched as a place name");

  const westVirginia = await findLocations("West Virginia", { fetcher: geocoder({
    Charleston: [place("Charleston", "South Carolina"), place("Charleston", "West Virginia")],
  }).fetcher });
  assert.deepEqual(westVirginia.map(({ region }) => region), ["West Virginia"]);
});

test("Georgia as a region matches both the country and the US state", async () => {
  const { calls, fetcher } = geocoder({ Tbilisi: [
    { name: "Tbilisi", latitude: 41.69, longitude: 44.83, admin1: "Tbilisi", country: "Georgia", country_code: "GE", timezone: "Asia/Tbilisi", feature_code: "PPLC" },
  ] });
  const matches = await findLocations("Tbilisi, Georgia", { fetcher });
  assert.deepEqual(matches.map(({ country }) => country), ["Georgia"]);
  assert.equal(calls[0].countryCode, null);
});

test("a trailing state-like word falls back to the full place name", async () => {
  const { calls, fetcher } = geocoder({ "Tam Ky": [
    { name: "Tam Ky", latitude: 15.57, longitude: 108.47, admin1: "Quang Nam", country: "Vietnam", country_code: "VN", timezone: "Asia/Ho_Chi_Minh", feature_code: "PPLA" },
  ] });
  const matches = await findLocations("Tam Ky", { fetcher });
  assert.deepEqual(matches.map(({ name }) => name), ["Tam Ky"]);
  assert.deepEqual(calls.map(({ name }) => name), ["Tam", "Tam Ky"]);
});

test("location searches skip parks, trails and other non-populated features", async () => {
  const { fetcher } = geocoder({ Portland: [
    place("Portland Traction Trail", "Oregon", { feature_code: "TRL" }),
    place("Portland Police Memorial", "Oregon", { feature_code: "MNMT" }),
    place("Portland", "Oregon", { feature_code: "PPLA2" }),
  ] });
  const matches = await findLocations("Portland, OR", { fetcher });
  assert.deepEqual(matches.map(({ name }) => name), ["Portland"]);
});
