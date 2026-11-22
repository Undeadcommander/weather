import AxeBuilder from "@axe-core/playwright";
import { expect, test as base } from "@playwright/test";
import { DEFAULT_LOCATION, HOUR } from "../shared/weather.js";
import { OPEN_METEO_ORIGIN } from "../shared/open-meteo.js";

const START = Date.parse("2026-11-22T17:00:00Z");
const LONDON = {
  name: "London", region: "England", country: "United Kingdom", countryCode: "GB",
  latitude: 51.5074, longitude: -0.1278, timezone: "Europe/London",
};
const LONDON_CA = {
  name: "London", region: "Ontario", country: "Canada", countryCode: "CA",
  latitude: 42.9834, longitude: -81.233, timezone: "America/Toronto",
};

const test = base.extend({
  browserErrors: [async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use();
    expect(errors).toEqual([]);
  }, { auto: true }],
});

const cityOptions = (page) => page.getByRole("listbox", { name: "Matching cities" }).getByRole("option");

function fixture(source, latitude = DEFAULT_LOCATION.latitude, stale = false) {
  const rows = Array.from({ length: 78 }, (_, i) => ({
    t: START + i * HOUR,
    temp: (latitude === LONDON.latitude ? -4 : 0) +
      ({ "open-meteo": 12 + (i > 20 ? 2 : 0), "met-norway": 13, nws: i === 5 ? 20 : 11 }[source]),
    rain: { "open-meteo": i === 3 ? 75 : 10, "met-norway": null, nws: i === 3 ? 15 : 0 }[source],
    wind: { "open-meteo": 16, "met-norway": 8, nws: i === 8 ? 35 : 21 }[source],
    humidity: 80,
    condition: source === "nws" ? "partlyCloudy" : "cloudy",
    night: false,
  }));
  return { source, rows, retrievedAt: START, status: "ok", stale };
}

function openMeteoFixture({ rows }) {
  return { hourly: {
    time: [...rows.map(({ t }) => t / 1000), (rows.at(-1).t + HOUR) / 1000],
    temperature_2m: rows.map(({ temp }) => temp),
    precipitation_probability: [0, ...rows.map(({ rain }) => rain)],
    wind_speed_10m: rows.map(({ wind }) => wind),
    relative_humidity_2m: rows.map(({ humidity }) => humidity),
    weather_code: rows.map(() => 3),
    is_day: rows.map(() => 1),
  } };
}

async function mockDashboard(page, { forecast, cities } = {}) {
  await page.clock.setFixedTime(START + 15_000);
  const requests = [];
  async function routeForecast(route) {
    const url = new URL(route.request().url());
    const isDirect = url.origin === OPEN_METEO_ORIGIN;
    const source = isDirect ? "open-meteo" : url.searchParams.get("source");
    const latitude = Number(url.searchParams.get(isDirect ? "latitude" : "lat"));
    requests.push({ source, latitude });
    if (forecast && await forecast(route, source)) return;
    const data = fixture(source, latitude);
    if (isDirect) {
      const headers = route.request().headers();
      expect(headers.authorization).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
      expect(headers.referer).toBeUndefined();
      await route.fulfill({ json: openMeteoFixture(data), headers: { "Access-Control-Allow-Origin": "*" } });
    } else {
      await route.fulfill({ json: data });
    }
  }
  await page.route("**/api/weather?*", routeForecast);
  await page.route(`${OPEN_METEO_ORIGIN}/v1/forecast?*`, routeForecast);
  await page.route("**/api/locations?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (cities && await cities(route, query)) return;
    await route.fulfill({ json: { locations: query.toLowerCase() === "london" ? [LONDON, LONDON_CA] : [] } });
  });
  await page.goto("/");
  return requests;
}

async function initialForecast(page) {
  await expect(page.locator("#source-count")).toHaveText("3 reporting");
}

test("renders the current forecast, three sources, the largest gap and exact-hour details", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await mockDashboard(page);
  await initialForecast(page);

  await expect(page.getByRole("heading", { name: "San Francisco, California" })).toBeVisible();
  await expect(page.locator("#hero-temperature")).toHaveText("54°F");
  await expect(page.locator("#hero-humidity")).toHaveText("80%");
  await expect(page.locator("#hero-condition")).toHaveText("Cloudy");
  await expect(page.locator("#plot")).toBeVisible();
  await expect(page.locator("#legend li")).toHaveCount(3);
  await expect(page.locator("#gap-value")).toHaveText("14°F");
  await expect(page.locator("#gap-note")).toContainText("54°F to 68°F");

  await page.getByRole("button", { name: "Inspect 2 PM" }).click();
  await expect(page.getByRole("combobox", { name: "Forecast hour" })).toBeFocused();
  await expect(page.locator("#detail-time")).toContainText("2 PM PST");
  await expect(page.getByRole("row", { name: /National Weather Service/ })).toContainText("68°FHighest");
  await expect(page.getByRole("row", { name: /Open-Meteo/ })).toContainText("54°FLowest");
  expect(errors).toEqual([]);
});

test("switches rain, wind, and temperature and handles missing rain probability", async ({ page }) => {
  await mockDashboard(page);
  await initialForecast(page);
  await page.getByRole("button", { name: "Rain", exact: true }).click();
  await expect(page.locator("#gap-value")).toHaveText("60 pp");
  await expect(page.locator("#legend")).toContainText("MET Norway · No data");
  await page.getByRole("button", { name: "Inspect 12 PM" }).click();
  const met = page.getByRole("row", { name: /MET Norway/ });
  await expect(met.locator("td").nth(2)).toHaveText("—");
  await expect(page.getByRole("row", { name: /Open-Meteo/ })).toContainText("75%Highest");

  await page.getByRole("button", { name: "Wind", exact: true }).click();
  await expect(page.locator("#gap-value")).toHaveText("17 mph");
  await page.getByRole("button", { name: /Celsius and kilometers/ }).click();
  await expect(page.locator("#hero-temperature")).toHaveText("12°C");
  await expect(page.locator("#gap-value")).toHaveText("27 km/h");
  await page.getByRole("button", { name: "Temperature", exact: true }).click();
  await expect(page.locator("#gap-value")).toHaveText("8°C");
  await page.reload();
  await initialForecast(page);
  await expect(page.getByRole("button", { name: /Celsius and kilometers/ })).toHaveAttribute("aria-pressed", "true");
});

test("changes dates and selects hours with the chart, keyboard, and dropdown", async ({ page }) => {
  await mockDashboard(page);
  await initialForecast(page);
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#detail-time")).toHaveText("Mon, Nov 23 · 12 AM PST");
  const plot = page.locator("#plot");
  await plot.focus();
  await plot.press("ArrowRight");
  await expect(page.locator("#detail-time")).toHaveText("Mon, Nov 23 · 1 AM PST");
  await expect(page.locator("#chart-tooltip")).toBeVisible();
  await plot.press("End");
  await expect(page.locator("#detail-time")).toContainText("11 PM PST");
  await plot.press("Escape");
  await expect(page.locator("#chart-tooltip")).toBeHidden();
  await plot.locator("canvas").hover({ position: { x: 48, y: 90 } });
  await expect(page.locator("#chart-tooltip")).toContainText("Open-Meteo");
  await plot.locator("canvas").click({ position: { x: 42, y: 90 } });
  await expect(page.locator("#detail-time")).toContainText("12 AM PST");

  await page.locator("[data-day='2']").click();
  await expect(page.locator("#detail-time")).toContainText("Tue, Nov 24");
  await page.getByRole("combobox", { name: "Forecast hour" }).selectOption({ label: "5 AM PST" });
  await expect(page.locator("#detail-time")).toContainText("5 AM PST");
});

test("stores source switches and favorites and guides users through empty states", async ({ page }) => {
  await mockDashboard(page);
  await initialForecast(page);
  const filter = page.getByRole("button", { name: "Compare favorites only" });
  const favorite = page.getByRole("button", { name: "Favorite Open-Meteo" });
  const toggle = page.getByRole("switch", { name: "Compare Open-Meteo" });

  await filter.click();
  await expect(page.getByText("No favorites in this comparison")).toBeVisible();
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await expect(page.locator("#gap-note")).toContainText("at least two sources");
  await page.getByRole("button", { name: "Favorite MET Norway" }).click();
  await expect(page.locator("#source-count")).toHaveText("2 reporting");

  await toggle.uncheck();
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await page.reload();
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).not.toBeChecked();
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await filter.click();
  await page.getByRole("switch", { name: "Compare MET Norway" }).uncheck();
  await page.getByRole("switch", { name: "Compare National Weather Service" }).uncheck();
  await expect(page.getByText("No sources selected")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Forecast hour" })).toBeDisabled();
  await toggle.check();
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
});

test("switches cities with keyboard and pointer, uses local time, and saves the location", async ({ page }) => {
  const requests = await mockDashboard(page);
  await initialForecast(page);
  const search = page.getByRole("combobox", { name: "Search for a city" });
  await search.fill("London");
  await expect(cityOptions(page)).toHaveCount(2);
  await search.press("ArrowDown");
  await search.press("ArrowDown");
  await search.press("ArrowUp");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "London, England" })).toBeVisible();
  await expect(page.locator("#source-count")).toHaveText("2 reporting");
  await expect(page.locator("[data-source=nws] .source-status")).toHaveText("Outside coverage");
  await expect(page.locator("#detail-time")).toContainText("5 PM GMT");
  expect(requests.filter(({ latitude }) => latitude === LONDON.latitude).map(({ source }) => source).sort())
    .toEqual(["met-norway", "open-meteo"]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "London, England" })).toBeVisible();
  await search.fill("London");
  await page.getByRole("option", { name: /London Ontario/ }).click();
  await expect(page.getByRole("heading", { name: "London, Ontario" })).toBeVisible();
});

test("late direct provider results cannot overwrite forecasts for a newly selected city", async ({ page }) => {
  let unblock;
  let delivered;
  const held = new Promise((resolve) => { unblock = resolve; });
  const finished = new Promise((resolve) => { delivered = resolve; });
  await mockDashboard(page, { forecast: async (route, source) => {
    const url = new URL(route.request().url());
    if (source !== "open-meteo" || Number(url.searchParams.get("latitude")) !== DEFAULT_LOCATION.latitude) return false;
    await held;
    await route.fulfill({
      json: openMeteoFixture(fixture(source)),
      headers: { "Access-Control-Allow-Origin": "*" },
    }).catch(() => {});
    delivered();
    return true;
  } });
  try {
    await expect(page.locator("#source-count")).toHaveText("2 reporting");
    await page.getByRole("combobox", { name: "Search for a city" }).fill("London");
    await cityOptions(page).first().click();
    await expect(page.getByRole("heading", { name: "London, England" })).toBeVisible();
    await expect(page.locator("#hero-temperature")).toHaveText("47°F");
    unblock();
    await finished;
    await expect(page.locator("#hero-temperature")).toHaveText("47°F");
    await expect(page.locator("#source-count")).toHaveText("2 reporting");
  } finally {
    unblock();
  }
});

test("handles search no-results, errors, dismissal and stale responses", async ({ page }) => {
  let unblock;
  const held = new Promise((resolve) => { unblock = resolve; });
  await mockDashboard(page, { cities: async (route, query) => {
    if (query === "error") {
      await route.fulfill({ status: 503, json: {} });
      return true;
    }
    if (query === "slow") {
      await held;
      await route.fulfill({ json: { locations: [LONDON_CA] } }).catch(() => {});
      return true;
    }
    return false;
  } });
  const search = page.getByRole("combobox", { name: "Search for a city" });
  try {
    await search.fill("x");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.fill("missing");
    await expect(page.getByText("No matching cities found.")).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.fill("error");
    await expect(page.getByText("City search is unavailable. Try again.")).toBeVisible();
    await search.fill("slow");
    await expect(page.getByText("Searching cities…")).toBeVisible();
    await search.fill("London");
    await expect(cityOptions(page)).toHaveCount(2);
    unblock();
    await expect(cityOptions(page)).toHaveCount(2);
    await page.getByRole("heading", { name: "Weather dashboard" }).click();
    await expect(search).toHaveAttribute("aria-expanded", "false");
  } finally {
    unblock();
  }
});

test("shows partial data promptly, retries failed sources and labels cached data", async ({ page }) => {
  let unblock;
  const held = new Promise((resolve) => { unblock = resolve; });
  let phase = "outage";
  await mockDashboard(page, { forecast: async (route, source) => {
    if (phase === "outage" && source !== "open-meteo") {
      await held;
      await route.fulfill({ status: 503, json: {} });
      return true;
    }
    if (phase === "stale" && source === "open-meteo") {
      await route.fulfill({ status: 503, json: {} });
      return true;
    }
    if (phase === "stale" && source === "met-norway") {
      await route.fulfill({ json: fixture(source, undefined, true) });
      return true;
    }
    return false;
  } });
  try {
    await expect(page.locator("#source-count")).toHaveText("1 reporting");
    await expect(page.locator("#plot")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh forecasts" })).toHaveAttribute("aria-busy", "true");
    unblock();
    await expect(page.getByText("Temporarily unavailable", { exact: true })).toHaveCount(2);
    phase = "healthy";
    const refresh = page.getByRole("button", { name: "Refresh forecasts" });
    await refresh.click();
    await initialForecast(page);
    phase = "stale";
    await refresh.click();
    await expect(page.getByText("Cached forecast", { exact: true })).toHaveCount(2);
    await initialForecast(page);
  } finally {
    unblock();
  }
});

test("recovers from a total provider outage and unavailable browser storage", async ({ page }) => {
  let healthy = false;
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", {
    get() { throw new DOMException("Storage disabled", "SecurityError"); },
  }));
  await mockDashboard(page, { forecast: async (route) => {
    if (healthy) return false;
    await route.fulfill({ status: 503, json: {} });
    return true;
  } });
  await expect(page.getByText("Forecasts unavailable", { exact: true })).toBeVisible();
  await expect(page.locator("#hero-temperature")).toHaveText("—");
  healthy = true;
  await page.getByRole("button", { name: "Refresh forecasts" }).click();
  await initialForecast(page);
  await page.getByRole("button", { name: "Favorite MET Norway" }).click();
  await expect(page.getByRole("button", { name: "Favorite MET Norway" })).toHaveAttribute("aria-pressed", "true");
});

test("navigation and source links work, with no automated accessibility violations", async ({ page }) => {
  await mockDashboard(page);
  await initialForecast(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.getByRole("link", { name: "Compare", exact: true }).click();
  await expect(page).toHaveURL(/#comparison$/);
  await expect(page.getByRole("link", { name: "Compare", exact: true })).toHaveAttribute("aria-current", "location");
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(page).toHaveURL(/#sources$/);
  await page.getByRole("link", { name: "Skylens" }).click();
  await expect(page).toHaveURL(/#overview$/);
  await expect(page.getByRole("link", { name: "MET Norway" })).toHaveAttribute("href", "https://www.met.no/en");
  await page.getByRole("combobox", { name: "Search for a city" }).fill("London");
  await expect(cityOptions(page)).toHaveCount(2);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
});

test("fits narrow screens and keeps source controls and horizontal table scrolling usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 775 });
  await mockDashboard(page);
  await initialForecast(page);
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
  const table = page.getByRole("region", { name: "Scrollable forecast table" });
  expect(await table.evaluate((element) => element.clientWidth < element.scrollWidth)).toBe(true);
  await table.focus();
  await table.press("ArrowRight");
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("switch", { name: "Compare Open-Meteo" }).uncheck();
  await expect(page.locator("#source-count")).toHaveText("2 reporting");
  await page.getByRole("button", { name: "Favorite MET Norway" }).click();
  await page.getByRole("button", { name: "Compare favorites only" }).click();
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
});
