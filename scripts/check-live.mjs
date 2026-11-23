import assert from "node:assert/strict";
import worker from "../dist/server/index.js";
import { fetchBrightSky } from "../shared/bright-sky.js";
import { fetchOpenMeteo } from "../shared/open-meteo.js";
import { SOURCES } from "../shared/weather.js";

const origin = "https://skylens.test";
const fetchApp = (path, init) => worker.fetch(new Request(origin + path, init));
const sf = { lat: 37.7749, lon: -122.4194 };
const london = { lat: 51.5074, lon: -0.1278 };
// Regional models are checked in a city inside their domain.
const homes = {
  hrrr: ["Chicago", { lat: 41.88, lon: -87.63 }], nbm: ["Chicago", { lat: 41.88, lon: -87.63 }],
  rdps: ["Toronto", { lat: 43.65, lon: -79.38 }], hrdps: ["Toronto", { lat: 43.65, lon: -79.38 }],
  hrdpsw: ["Vancouver", { lat: 49.28, lon: -123.12 }], icond2: ["Berlin", { lat: 52.52, lon: 13.4 }],
  iconeu: ["Paris", { lat: 48.85, lon: 2.35 }], arome: ["Paris", { lat: 48.85, lon: 2.35 }],
  aromehd: ["Paris", { lat: 48.85, lon: 2.35 }], arpege: ["Paris", { lat: 48.85, lon: 2.35 }],
  ukv: ["London", london], knmi: ["Amsterdam", { lat: 52.37, lon: 4.9 }],
  dmi: ["Copenhagen", { lat: 55.68, lon: 12.57 }], nordic: ["Oslo", { lat: 59.91, lon: 10.75 }],
  "icon-ch": ["Zurich", { lat: 47.37, lon: 8.54 }], icon2i: ["Rome", { lat: 41.9, lon: 12.5 }],
  msm: ["Tokyo", { lat: 35.68, lon: 139.69 }],
};

async function check(label, path, verify) {
  const start = performance.now();
  const result = await fetchApp(path);
  const data = await result.json();
  assert.equal(result.status, 200, `${label} returned ${result.status} (${data.error ?? data.status})`);
  verify(data);
  console.log(`${label} passed in ${Math.round(performance.now() - start)} ms`);
  return data;
}

async function forecast(location, source, point, status = "ok") {
  function verify(data) {
    assert.equal(data.source, source);
    assert.equal(data.status, status);
    if (status === "ok") {
      assert.ok(data.rows.length > 15, "Expected usable hours in the forecast");
      assert.ok(data.rows.some(({ temp }) => Number.isFinite(temp)));
      assert.ok(data.rows.every((row, index) => !index || row.t > data.rows[index - 1].t));
    } else {
      assert.deepEqual(data.rows, []);
    }
  }
  const label = `${location} · ${source}`;
  const feed = SOURCES.find(({ id }) => id === source);
  if (source === "open-meteo" || feed?.model || feed?.provider) {
    const start = performance.now();
    const fetchFeed = feed?.provider === "brightsky" ? fetchBrightSky : fetchOpenMeteo;
    const data = await fetchFeed({ latitude: point.lat, longitude: point.lon }, undefined, feed);
    verify(data);
    console.log(`${label} passed in ${Math.round(performance.now() - start)} ms`);
    return data;
  }
  return check(label, `/api/weather?${new URLSearchParams({ source, ...point })}`, verify);
}

const results = await Promise.allSettled([
  forecast("San Francisco", "open-meteo", sf),
  forecast("San Francisco", "met-norway", sf),
  forecast("San Francisco", "nws", sf),
  forecast("London", "open-meteo", london),
  forecast("London", "met-norway", london),
  forecast("London", "nws", london, "unsupported"),
  check("City search", "/api/locations?q=S%C3%A3o+Paulo", ({ locations }) => {
    assert.ok(locations.some(({ name, countryCode, timezone }) =>
      name === "São Paulo" && countryCode === "BR" && timezone === "America/Sao_Paulo"));
  }),
]);

// Check individual models in sequence to avoid bursting the public API.
for (const { id } of SOURCES.filter(({ model, provider }) => model || provider)) {
  const [city, point] = homes[id] ?? ["San Francisco", sf];
  results.push(...await Promise.allSettled([forecast(city, id, point)]));
}
// A regional model outside its domain reports no coverage instead of failing.
results.push(...await Promise.allSettled([forecast("Tokyo", "hrrr", { lat: 35.68, lon: 139.69 }, "unsupported")]));

for (const result of results) {
  if (result.status === "rejected") {
    console.error(result.reason.message);
    process.exitCode = 1;
  }
}
if (!process.exitCode) {
  const repeated = await forecast("San Francisco (cache)", "met-norway", sf);
  assert.equal(repeated.retrievedAt, results[1].value.retrievedAt);
  assert.equal(repeated.stale, false);
}

const main = await fetchApp("/");
assert.equal(main.status, 200);
assert.match(main.headers.get("content-security-policy"), /connect-src 'self'/);
const markup = await main.text();
assert.match(markup, /Weather dashboard/);
for (const pathname of ["/app.js", "/styles.css", "/assets/clouds.webp", "/assets/dm-sans.woff2", "/assets/icon.svg"]) {
  const head = await fetchApp(pathname, { method: "HEAD" });
  assert.equal(head.status, 200, pathname);
  const etag = head.headers.get("etag");
  assert.ok(etag, pathname);
  if (pathname === "/app.js" || pathname === "/styles.css") assert.ok(markup.includes(`${pathname}?v=${etag.slice(1, -1)}`));
}
