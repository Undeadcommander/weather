import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { HOUR, SOURCES } from "../shared/weather.js";

const START = Date.parse("2026-11-22T17:00:00Z");
const ORIGIN = "http://127.0.0.1:4191";
const FILES = new Set([
  "index.html",
  "theme-init.js",
  "app.js",
  "styles.css",
  "assets/icon.svg",
  "assets/clouds.webp",
  "assets/dm-sans.woff2",
  "assets/dm-sans-OFL.txt",
]);
const LONDON = {
  name: "London", admin1: "England", country: "United Kingdom", country_code: "GB",
  latitude: 51.5074, longitude: -0.1278, timezone: "Europe/London",
};

async function openPages(page, { failMet = false, badNws = false } = {}) {
  await page.clock.setFixedTime(START + 15_000);
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(url);
    if (url.origin === ORIGIN) {
      expect(url.pathname).toMatch(/^\/weather\//);
      const relative = url.pathname.slice("/weather/".length) || "index.html";
      expect(FILES.has(relative)).toBe(true);
      return route.fulfill({ path: fileURLToPath(new URL(`../dist/pages/${relative}`, import.meta.url)) });
    }
    expect(request.headers().authorization).toBeUndefined();
    expect(request.headers().cookie).toBeUndefined();
    const headers = { "Access-Control-Allow-Origin": "*", Expires: new Date(START + HOUR).toUTCString() };
    const reply = (json) => route.fulfill({ json, headers });
    if (url.origin === "https://api.open-meteo.com") {
      expect(request.headers().referer).toBeUndefined();
      const model = url.searchParams.get("models");
      const hours = model && model !== "ecmwf_ifs025" ? 49 : 73;
      return reply({ hourly: {
        time: Array.from({ length: hours }, (_, index) => START / 1000 + index * 3600),
        temperature_2m: Array(hours).fill(12),
        precipitation_probability: Array(hours).fill(["jma_seamless", "meteofrance_seamless"].includes(model) ? null : 20),
        wind_speed_10m: Array(hours).fill(10), relative_humidity_2m: Array(hours).fill(80),
        weather_code: Array(hours).fill(3), is_day: Array(hours).fill(1),
      } });
    }
    if (url.origin === "https://api.met.no") {
      expect(request.headers().referer).toBe(`${ORIGIN}/`);
      expect(url.searchParams.get("lat")).toMatch(/^-?\d+\.\d{4}$/);
      if (failMet) return route.fulfill({ status: 503, headers });
      return reply({ properties: { timeseries: Array.from({ length: 72 }, (_, index) => ({
        time: new Date(START + index * HOUR).toISOString(),
        data: {
          instant: { details: { air_temperature: 14, wind_speed: 3, relative_humidity: 85 } },
          next_1_hours: { summary: { symbol_code: "cloudy" } },
        },
      })) } });
    }
    if (url.origin === "https://api.weather.gov") {
      if (url.pathname.startsWith("/points/")) {
        return reply({ properties: { forecastHourly: badNws
          ? "https://untrusted.example/forecast/hourly"
          : "https://api.weather.gov/gridpoints/MTR/85,105/forecast/hourly" } });
      }
      expect(url.pathname).toBe("/gridpoints/MTR/85,105/forecast/hourly");
      return reply({ properties: { periods: Array.from({ length: 72 }, (_, index) => ({
        startTime: new Date(START + index * HOUR).toISOString(),
        endTime: new Date(START + (index + 1) * HOUR).toISOString(),
        temperature: 16, temperatureUnit: "C", windSpeed: "5 mph", shortForecast: "Sunny",
        probabilityOfPrecipitation: { value: 10 }, relativeHumidity: { value: 70 }, isDaytime: true,
      })) } });
    }
    expect(url.origin).toBe("https://geocoding-api.open-meteo.com");
    expect(url.searchParams.get("name")).toBe("London");
    return reply({ results: [LONDON] });
  });
  await page.goto("/weather/");
  return { requests, errors };
}

test("Pages can compare all individual models through their reported forecast ranges", async ({ page }) => {
  const { requests, errors } = await openPages(page);
  const models = SOURCES.filter(({ model }) => model);
  await page.getByRole("button", { name: "Show all 10 sources" }).click();
  for (const { name } of models) await page.getByRole("switch", { name: `Compare ${name}` }).check();
  await expect(page.locator("#source-count")).toHaveText("10 reporting");
  await expect(page.locator("#legend li")).toHaveCount(10);
  await expect(page.locator("#details tbody tr")).toHaveCount(10);
  expect(requests.map(url => url.searchParams.get("models"))).toEqual(expect.arrayContaining(models.map(({ model }) => model)));
  await page.getByRole("button", { name: "Rain", exact: true }).click();
  for (const id of ["jma", "meteofrance"]) {
    await expect(page.locator(`#legend li[data-source="${id}"]`)).toHaveAttribute("data-missing");
    await expect(page.locator(`#details tbody tr[data-source="${id}"]`)).toContainText("—");
  }
  await page.getByRole("button", { name: "Temperature", exact: true }).click();
  await page.getByRole("button", { name: "Choose forecast date" }).click();
  await page.getByRole("button", { name: "Wednesday, November 25, 2026" }).click();
  await expect(page.locator("#hours option").last()).toHaveAttribute("value", String(START + 72 * HOUR));
  await page.getByRole("combobox", { name: "Forecast hour" }).selectOption(String(START + 72 * HOUR));
  await expect(page.locator('#details tbody tr[data-source="ecmwf"]')).toContainText("54°F");
  await expect(page.locator('#details tbody tr[data-source="gem"]')).toContainText("—");
  await page.getByRole("button", { name: "Favorite ECMWF IFS", exact: true }).click();
  await page.getByRole("button", { name: "Compare favorites only" }).click();
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await page.reload();
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await page.getByRole("button", { name: "Show all 10 sources" }).click();
  await expect(page.getByRole("switch", { name: "Compare ECMWF IFS", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Favorite ECMWF IFS", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("Pages serves all assets below the repository path and compares three direct providers", async ({ page }) => {
  const { requests, errors } = await openPages(page);
  await expect(page.locator("#source-count")).toHaveText("3 reporting");
  await expect(page.locator("#legend li")).toHaveCount(3);
  await expect(page.locator("#hero-temperature")).not.toHaveText("—");
  await expect(page.locator("#plot")).toBeVisible();
  await expect(page.locator("#details tbody tr")).toHaveCount(3);
  expect(requests.some((url) => url.pathname === "/weather/assets/clouds.webp")).toBe(true);
  expect(requests.some((url) => url.pathname === "/weather/assets/dm-sans.woff2")).toBe(true);
  expect(errors).toEqual([]);
});

test("Pages searches cities directly and preserves non-US coverage", async ({ page }) => {
  const { requests, errors } = await openPages(page);
  await expect(page.locator("#source-count")).toHaveText("3 reporting");
  await page.getByRole("combobox", { name: "Search for a city" }).fill("London");
  await page.getByRole("listbox", { name: "Matching cities" }).getByRole("option").click();
  await expect(page.getByRole("heading", { name: "London, England" })).toBeVisible();
  await expect(page.locator("#source-count")).toHaveText("2 reporting");
  await expect(page.locator('[data-source="nws"] .source-status')).toHaveText("Outside coverage");
  expect(requests.filter((url) => url.pathname.startsWith("/points/"))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("Pages keeps comparing when a provider is unavailable", async ({ page }) => {
  const { errors } = await openPages(page, { failMet: true });
  await expect(page.locator("#source-count")).toHaveText("2 reporting");
  await expect(page.locator('[data-source="met-norway"] .source-status')).toHaveText("Temporarily unavailable");
  expect(errors).toEqual([]);
});

test("Pages rejects an unexpected NWS endpoint before making a request", async ({ page }) => {
  const { requests, errors } = await openPages(page, { badNws: true });
  await expect(page.locator("#source-count")).toHaveText("2 reporting");
  await expect(page.locator('[data-source="nws"] .source-status')).toHaveText("Temporarily unavailable");
  expect(requests.some((url) => url.hostname === "untrusted.example")).toBe(false);
  expect(errors).toEqual([]);
});

test("Pages honors provider expiry when refreshing", async ({ page }) => {
  const { requests, errors } = await openPages(page);
  await expect(page.locator("#source-count")).toHaveText("3 reporting");
  await page.getByRole("button", { name: "Refresh forecasts" }).click();
  await expect(page.locator("#refresh")).toHaveAttribute("aria-busy", "false");
  expect(requests.filter((url) => url.hostname === "api.met.no")).toHaveLength(1);
  expect(requests.filter((url) => url.hostname === "api.weather.gov")).toHaveLength(2);
  expect(requests.filter((url) => url.hostname === "api.open-meteo.com")).toHaveLength(2);
  expect(errors).toEqual([]);
});
