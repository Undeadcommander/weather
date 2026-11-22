import assert from "node:assert/strict";
import worker from "../dist/server/index.js";
import { fetchOpenMeteo } from "../shared/open-meteo.js";

const origin = "https://skylens.test";
const fetchApp = (path, init) => worker.fetch(new Request(origin + path, init));
const sf = { lat: 37.7749, lon: -122.4194 };
const london = { lat: 51.5074, lon: -0.1278 };

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
  if (source === "open-meteo") {
    const start = performance.now();
    const data = await fetchOpenMeteo({ latitude: point.lat, longitude: point.lon });
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
assert.match(await main.text(), /Weather dashboard/);
for (const pathname of ["/app.js", "/styles.css", "/assets/clouds.webp", "/assets/dm-sans.woff2", "/assets/icon.svg"]) {
  const head = await fetchApp(pathname, { method: "HEAD" });
  assert.equal(head.status, 200, pathname);
  assert.ok(head.headers.get("etag"), pathname);
}
