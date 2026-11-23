import AxeBuilder from "@axe-core/playwright";
import { expect, test as base } from "@playwright/test";
import { DEFAULT_LOCATION, HOUR, SOURCES } from "../shared/weather.js";
import { BRIGHT_SKY_ORIGIN } from "../shared/bright-sky.js";
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

const cityOptions = (page) => page.getByRole("listbox", { name: "Matching places" }).getByRole("option");

function fixture(source, latitude = DEFAULT_LOCATION.latitude, stale = false) {
  const rows = Array.from({ length: 78 }, (_, i) => ({
    t: START + i * HOUR,
    temp: (latitude === LONDON.latitude ? -4 : 0) +
      ({ "open-meteo": 12 + (i > 20 ? 2 : 0), "met-norway": 13, nws: i === 5 ? 20 : 11 }[source] ?? 14),
    rain: { "open-meteo": i === 3 ? 75 : 10, "met-norway": null, nws: i === 3 ? 15 : 0 }[source],
    wind: { "open-meteo": 16, "met-norway": 8, nws: i === 8 ? 35 : 21 }[source],
    humidity: i < 15 ? 80 : 65,
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

function brightSkyFixture({ rows }) {
  return { weather: rows.map(({ t, temp, wind, humidity, rain }) => ({
    timestamp: new Date(t).toISOString(), temperature: temp, wind_speed: wind, relative_humidity: humidity,
    precipitation_probability: rain, icon: "cloudy",
  })) };
}

async function mockDashboard(page, { forecast, cities } = {}) {
  await page.clock.setFixedTime(START + 15_000);
  const requests = [];
  async function routeForecast(route) {
    const url = new URL(route.request().url());
    const isBrightSky = url.origin === BRIGHT_SKY_ORIGIN;
    const isDirect = isBrightSky || url.origin === OPEN_METEO_ORIGIN;
    const source = isBrightSky ? "mosmix" : isDirect
      ? SOURCES.find(({ model }) => model && model === url.searchParams.get("models"))?.id ?? "open-meteo"
      : url.searchParams.get("source");
    const latitude = Number(url.searchParams.get(url.origin === OPEN_METEO_ORIGIN ? "latitude" : "lat"));
    requests.push({ source, latitude });
    if (forecast && await forecast(route, source)) return;
    const data = fixture(source, latitude);
    if (isDirect) {
      if (!isBrightSky) expect(url.searchParams.get("past_days")).toBe("1");
      const headers = route.request().headers();
      expect(headers.authorization).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
      expect(headers.referer).toBeUndefined();
      await route.fulfill({
        json: isBrightSky ? brightSkyFixture(data) : openMeteoFixture(data),
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    } else {
      await route.fulfill({ json: data });
    }
  }
  await page.route("**/api/weather?*", routeForecast);
  await page.route(`${OPEN_METEO_ORIGIN}/v1/forecast?*`, routeForecast);
  await page.route(`${BRIGHT_SKY_ORIGIN}/weather?*`, routeForecast);
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

test("compares individual models in the Worker build and preserves model choices", async ({ page }) => {
  let gemRequests = 0;
  const requests = await mockDashboard(page, { forecast: async (route, source) => {
    if (source !== "gem" || ++gemRequests !== 1) return false;
    await route.fulfill({ status: 429, headers: { "Access-Control-Allow-Origin": "*" } });
    return true;
  } });
  await initialForecast(page);
  const models = SOURCES.filter(({ model, provider }) => model || provider);
  for (const { name } of models) await page.getByRole("switch", { name: `Compare ${name}`, exact: true }).check();
  await expect(page.locator("#source-count")).toHaveText(`${SOURCES.length} reporting`);
  expect(gemRequests).toBe(2);
  await expect(page.locator("#legend li")).toHaveCount(SOURCES.length);
  await expect(page.locator("#details tbody tr")).toHaveCount(SOURCES.length);
  for (const { id } of models) {
    expect(requests.some(({ source }) => source === id)).toBe(true);
    await expect(page.locator(`#details tbody tr[data-source="${id}"]`)).toContainText("57°F");
  }
  await page.reload();
  await expect(page.locator("#source-count")).toHaveText(`${SOURCES.length} reporting`);
  for (const { name } of models) await expect(page.getByRole("switch", { name: `Compare ${name}`, exact: true })).toBeChecked();
});

for (const width of [1440, 900, 320]) {
  test(`scrollable sources list and Conditions stay within an independent comparison panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockDashboard(page);
    await initialForecast(page);
    const cards = page.locator("#source-list .source-card:visible");
    const sourceList = page.locator("#source-list");
    await expect(cards).toHaveCount(SOURCES.length);
    await expect(cards.first().locator(".source-name")).toHaveText("National Weather Service");
    const comparison = page.locator(".comparison");
    const plot = page.locator(".plot-wrap");
    const size = locator => locator.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
    const initialPanel = await size(comparison);
    const initialPlot = await size(plot);
    const difference = await page.locator("#difference").boundingBox();
    const insights = await page.locator("#insights").boundingBox();
    expect(difference.width).toBeCloseTo(insights.width, 0);
    if (width > 770) {
      const comparisonBox = await comparison.boundingBox();
      const differenceBox = await page.locator("#difference").boundingBox();
      expect(differenceBox.y).toBe(comparisonBox.y);
      expect(differenceBox.x).toBeGreaterThan(comparisonBox.x + comparisonBox.width);
    }
    await expect(sourceList).toHaveAttribute("tabindex", "0");
    expect(await sourceList.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await sourceList.focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => sourceList.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await size(comparison)).toEqual(initialPanel);
    expect(await size(plot)).toEqual(initialPlot);
    await page.getByRole("switch", { name: "Compare ECMWF IFS", exact: true }).check();
    await expect(page.locator("#source-count")).toHaveText("4 reporting");

    await page.getByRole("button", { name: "Conditions", exact: true }).click();
    await expect(page.locator("#difference")).toBeHidden();
    const outlook = page.getByRole("region", { name: "Scrollable hourly outlook" });
    await expect(outlook).toBeVisible();
    expect(await size(plot)).toEqual(initialPlot);
    expect((await size(outlook)).height).toBe(initialPlot.height);
    expect(await outlook.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await outlook.focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => outlook.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    if (width === 320) {
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => outlook.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("starts the forecast difference at the current hour and follows chart hover and selection", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await mockDashboard(page, { forecast: async (route, source) => {
    if (source !== "open-meteo") return false;
    const data = fixture(source);
    const earlier = Array.from({ length: 9 }, (_, index) => ({
      ...data.rows[0], t: START - (9 - index) * HOUR,
    }));
    data.rows.unshift(...earlier);
    await route.fulfill({ json: openMeteoFixture(data) });
    return true;
  } });
  await initialForecast(page);

  await expect(page.getByRole("heading", { name: "San Francisco, California" })).toBeVisible();
  await expect(page.locator("#hero-temperature")).toHaveText("54°F");
  await expect(page.locator("#hero-humidity")).toHaveText("80%");
  await expect(page.locator("#hero-temperature-note")).toHaveText("Average temperature across reporting sources");
  await expect(page.locator(".hero-stats").getByText("Median across reporting sources")).toBeVisible();
  await expect(page.locator("#hero-condition")).toHaveText("Cloudy");
  await expect(page.locator("#plot")).toBeVisible();
  await expect(page.locator("#legend li")).toHaveCount(3);
  await expect(page.locator("#gap-value")).toHaveText("3°F");
  await expect(page.locator("#gap-note")).toContainText("At 9 AM");
  await expect(page.locator("#detail-time")).toContainText("9 AM PST");

  const canvas = page.locator("#chart");
  const { width } = await canvas.boundingBox();
  await expect(page.locator("#hours option")).toHaveCount(24);
  await expect(page.locator("#hours option").first()).toHaveText("12 AM PST");
  await expect(page.locator("#hours option").last()).toHaveText("11 PM PST");
  await page.locator("#plot").press("Home");
  await expect(page.locator("#detail-time")).toContainText("12 AM PST");
  await expect(page.locator("#hero-temperature")).toHaveText("54°F");
  await expect(page.locator("#hero-time")).toContainText("12 AM");
  await expect(page.locator('#detail-rows [data-source="open-meteo"]')).toContainText("54°F");
  await page.getByRole("combobox", { name: "Forecast hour" }).selectOption(String(START));
  const shading = () => canvas.evaluate(element => {
    const context = element.getContext("2d");
    const scale = element.width / element.clientWidth;
    return [8.5, 9.5].map(hour => context.getImageData(
      Math.round((42 + (element.clientWidth - 58) * hour / 23) * scale), Math.round(17 * scale), 1, 1,
    ).data[3]);
  });
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "Dark mode", exact: true }).click();
    const [past, future] = await shading();
    expect(past).toBeGreaterThan(0);
    expect(future).toBe(0);
  }
  const afternoon = { x: 42 + (width - 58) * 14 / 23, y: 90 };
  await canvas.hover({ position: afternoon });
  await expect(page.locator("#gap-value")).toHaveText("14°F");
  await expect(page.locator("#gap-note")).toContainText("54°F to 68°F");
  await expect(page.locator("#hero-temperature")).toHaveText("59°F");
  await expect(page.locator("#hero-time")).toContainText("2 PM");
  await expect(page.locator("#detail-time")).toContainText("9 AM PST");
  await page.locator("#comparison-heading").hover();
  await expect(page.locator("#gap-value")).toHaveText("3°F");
  await expect(page.locator("#hero-temperature")).toHaveText("54°F");
  await canvas.hover({ position: { x: 42 + (width - 58) * 12 / 23, y: 90 } });
  await expect(page.locator("#hero-rain")).toHaveText("45%");
  await page.locator("#comparison-heading").hover();
  await expect(page.locator("#hero-rain")).toHaveText("5%");

  await canvas.click({ position: afternoon });
  await page.locator("#comparison-heading").hover();
  await expect(page.locator("#gap-value")).toHaveText("14°F");
  await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(0);
  await expect(page.locator("#detail-time")).toContainText("2 PM PST");
  await expect(page.locator("#hero-temperature")).toHaveText("59°F");
  await expect(page.getByRole("row", { name: /National Weather Service/ })).toContainText("68°FHighest");
  await expect(page.getByRole("row", { name: /Open-Meteo/ })).toContainText("54°FLowest");
  await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
  expect(await shading()).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test.describe("on a touch phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("dragging a finger across the chart scrubs hours like hover, and a tap selects", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Touch drags are dispatched through the Chrome DevTools Protocol");
    await mockDashboard(page);
    await initialForecast(page);
    const canvas = page.locator("#chart");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const at = hour => ({ x: box.x + 42 + (box.width - 58) * hour / 23, y: box.y + box.height / 2 });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, point) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: point ? [{ ...point, id: 1 }] : [],
    });
    const tooltip = page.locator("#chart-tooltip");
    await expect(page.locator("#detail-time")).toContainText("9 AM PST");

    await touch("touchStart", at(12));
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("12 PM");
    await expect(page.locator("#hero-time")).toContainText("12 PM");
    for (let hour = 12.25; hour <= 18; hour += .25) await touch("touchMove", at(hour));
    await expect(tooltip).toContainText("6 PM");
    await expect(page.locator("#hero-time")).toContainText("6 PM");
    await expect(page.locator("#gap-note")).toContainText("6 PM");
    await touch("touchEnd");
    await expect(tooltip).toBeHidden();
    await expect(page.locator("#hero-time")).toContainText("9 AM");
    await expect(page.locator("#detail-time")).toContainText("9 AM PST");

    await canvas.tap({ position: { x: 42 + (box.width - 58) * 14 / 23, y: box.height / 2 } });
    await expect(page.locator("#detail-time")).toContainText("2 PM PST");
    await expect(tooltip).toBeHidden();
  });
});

test("switches rain, wind, and temperature and handles missing rain probability", async ({ page }) => {
  await mockDashboard(page);
  await initialForecast(page);
  await page.getByRole("button", { name: "Rain", exact: true }).click();
  const hour = page.getByRole("combobox", { name: "Forecast hour" });
  await expect(page.locator("#gap-value")).toHaveText("10 pp");
  await hour.selectOption({ label: "12 PM PST" });
  await expect(page.locator("#hero-rain")).toHaveText("45%");
  await expect(page.locator("#gap-value")).toHaveText("60 pp");
  await expect(page.locator("#legend")).toContainText("MET Norway · No data");
  const metStatus = page.locator('#source-list [data-source="met-norway"] .source-status');
  await expect(metStatus).toHaveText("No rain chance data for this day");
  await expect(page.locator("#source-count")).toHaveText("2 reporting");
  const met = page.getByRole("row", { name: /MET Norway/ });
  await expect(met.locator("td").nth(2)).toHaveText("—");
  await expect(page.getByRole("row", { name: /Open-Meteo/ })).toContainText("75%Highest");

  await page.getByRole("button", { name: "Wind", exact: true }).click();
  await hour.selectOption({ label: "5 PM PST" });
  await expect(page.locator("#gap-value")).toHaveText("17 mph");
  await expect(metStatus).toHaveText("Forecast available");
  await initialForecast(page);
  await page.getByRole("button", { name: /Celsius and kilometers/ }).click();
  await expect(page.locator("#hero-temperature")).toHaveText("12°C");
  await expect(page.locator("#gap-value")).toHaveText("27 km/h");
  await page.getByRole("button", { name: "Temperature", exact: true }).click();
  await expect(page.locator("#chart-unit")).toHaveText("temperature (°C)");
  await hour.selectOption({ label: "2 PM PST" });
  await expect(page.locator("#gap-value")).toHaveText("8°C");
  await expect(page.locator("#hero-temperature")).toHaveText("15°C");
  await page.reload();
  await initialForecast(page);
  await expect(page.getByRole("button", { name: /Celsius and kilometers/ })).toHaveAttribute("aria-pressed", "true");
});

test("shows hourly conditions and opens Snow only for a selected source and date with snow", async ({ page }) => {
  await mockDashboard(page, { forecast: async (route, source) => {
    if (source !== "open-meteo") return false;
    const data = openMeteoFixture(fixture(source));
    data.hourly.weather_code[0] = 0;
    data.hourly.snowfall = Array(data.hourly.time.length).fill(0);
    data.hourly.snowfall[17] = 2.54;
    await route.fulfill({ json: data });
    return true;
  } });
  await initialForecast(page);
  const snow = page.getByRole("button", { name: "Snow", exact: true });
  await expect(snow).toBeHidden();
  await page.getByRole("button", { name: "Conditions", exact: true }).click();
  const outlook = page.locator("#outlook");
  const first = outlook.getByRole("row", { name: /^9 AM PST/ });
  await expect(first.locator("td")).toHaveText(["Sunny", "Cloudy", "Partly cloudy"]);
  await outlook.getByRole("row", { name: /^10 AM PST/ }).locator("td").first().click();
  await expect(page.locator("#detail-time")).toContainText("10 AM PST");
  await expect(outlook.getByRole("button", { name: "10 AM PST" })).toHaveAttribute("aria-pressed", "true");
  await outlook.getByRole("button", { name: "11 AM PST" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#detail-time")).toContainText("11 AM PST");
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await snow.click();
  await expect(outlook.getByRole("row", { name: /1 AM PST/ }).first()).toContainText("1 in");
  await page.getByRole("button", { name: /Celsius and kilometers/ }).click();
  await expect(outlook).toContainText("2.54 cm");
  await page.getByRole("switch", { name: "Compare Open-Meteo" }).uncheck();
  await expect(snow).toBeHidden();
  await expect(page.locator("#plot")).toBeVisible();
});

test("calendar offers only reported dates across months and keeps the selected day visible", async ({ page }) => {
  await mockDashboard(page, { forecast: async (route, source) => {
    if (source !== "met-norway") return false;
    const data = fixture(source);
    data.rows.push({ ...data.rows[0], t: START + 10 * 24 * HOUR });
    await route.fulfill({ json: data });
    return true;
  } });
  await initialForecast(page);
  await expect(page.locator("#dates button")).toHaveText(["Today", "Tomorrow"]);
  const trigger = page.getByRole("button", { name: /Choose forecast date/ });
  await trigger.click();
  const calendar = page.getByRole("group", { name: "Available forecast dates" });
  await expect(calendar.getByRole("button")).toHaveCount(5);
  await expect(calendar.getByRole("button", { name: "Sunday, November 22, 2026" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(calendar).toBeHidden();
  await trigger.click();
  await calendar.getByRole("button", { name: "Wednesday, December 2, 2026" }).click();
  await expect(calendar).toBeHidden();
  await expect(trigger).toContainText("Dec 2");
  await expect(page.locator("#detail-time")).toContainText("Wed, Dec 2");
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await expect(page.locator('#source-list [data-source="open-meteo"] .source-status')).toHaveText("No temperature data for this day");
  await expect(page.locator('#source-list [data-source="met-norway"] .source-status')).toHaveText("Forecast available");

  await page.getByRole("switch", { name: "Compare MET Norway" }).uncheck();
  await expect(page.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#source-count")).toHaveText("2 reporting");
  await trigger.click();
  await expect(calendar.getByRole("button", { name: "Wednesday, December 2, 2026" })).toHaveCount(0);
});

test("changes dates and selects hours with the chart, keyboard, and dropdown", async ({ page }) => {
  await mockDashboard(page);
  await initialForecast(page);
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#detail-time")).toHaveText("Mon, Nov 23 · 12 AM PST");
  await expect(page.locator("#hero-time")).toHaveText("Mon, Nov 23 · 12 AM PST");
  await expect(page.locator("#hero-humidity")).toHaveText("65%");
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

  await page.getByRole("button", { name: "Choose forecast date" }).click();
  await page.getByRole("button", { name: "Tuesday, November 24, 2026" }).click();
  await expect(page.locator("#detail-time")).toContainText("Tue, Nov 24");
  await page.getByRole("combobox", { name: "Forecast hour" }).selectOption({ label: "5 AM PST" });
  await expect(page.locator("#detail-time")).toContainText("5 AM PST");
  await expect(page.locator("#hero-time")).toHaveText("Tue, Nov 24 · 5 AM PST");
  await expect(page.locator("#hero-temperature")).toHaveText("55°F");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator("#hero-humidity")).toHaveText("80%");
});

test("stores source switches and favorites and guides users through empty states", async ({ page }) => {
  await mockDashboard(page);
  await initialForecast(page);
  const filter = page.getByRole("button", { name: "Compare favorites only" });
  const favorite = page.getByRole("button", { name: "Favorite Open-Meteo" });
  const toggle = page.getByRole("switch", { name: "Compare Open-Meteo" });

  await filter.click();
  await expect(page.getByText("No favorites in this comparison")).toBeVisible();
  await expect(page.locator("#hero-temperature")).toHaveText("—");
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await expect(page.locator("#gap-note")).toContainText("at least two sources");
  await expect(page.locator("#hero-temperature")).toHaveText("54°F");
  await page.getByRole("button", { name: "Favorite MET Norway" }).click();
  await expect(page.locator("#source-count")).toHaveText("2 reporting");

  await toggle.uncheck();
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await page.reload();
  await expect(page.locator("#source-count")).toHaveText("1 reporting");
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("#hero-temperature")).toHaveText("55°F");
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
    await expect(page.getByText("No matching places found.")).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.fill("error");
    await expect(page.getByText("Location search is unavailable. Try again.")).toBeVisible();
    await search.fill("slow");
    await expect(page.getByText("Searching places…")).toBeVisible();
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

test("automatically retries an unavailable source until it recovers", async ({ page }) => {
  let metRequests = 0;
  await mockDashboard(page, { forecast: async (route, source) => {
    if (source !== "met-norway" || ++metRequests > 1) return false;
    await route.fulfill({ status: 503, json: {} });
    return true;
  } });
  const status = page.locator('[data-source="met-norway"] .source-status');
  await expect(status).toHaveText("Temporarily unavailable");
  await expect(status).toHaveText("Forecast available");
  await initialForecast(page);
  expect(metRequests).toBe(2);
});

test("stops retrying an unavailable source after three attempts", async ({ page }) => {
  await page.clock.install({ time: START + 15_000 });
  let metRequests = 0;
  await mockDashboard(page, { forecast: async (route, source) => {
    if (source !== "met-norway") return false;
    metRequests++;
    await route.fulfill({ status: 503, json: {} });
    return true;
  } });
  const status = page.locator('[data-source="met-norway"] .source-status');
  for (let attempt = 1; attempt <= 4; attempt++) {
    await expect.poll(() => metRequests).toBe(attempt);
    await expect(status).toHaveText("Temporarily unavailable");
    await page.clock.fastForward(10_000);
  }
  await page.clock.fastForward(60_000);
  await expect(status).toHaveText("Temporarily unavailable");
  expect(metRequests).toBe(4);
  await page.getByRole("button", { name: "Refresh forecasts" }).click();
  await expect.poll(() => metRequests).toBe(5);
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

test("uses device coordinates only after the location button is clicked", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 42.36, longitude: -71.06 });
  const requests = await mockDashboard(page);
  await initialForecast(page);
  expect(requests.some(request => request.latitude === 42.36)).toBe(false);
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.locator("#hero-location")).toHaveText("Current location");
  await expect.poll(() => requests.some(request => request.latitude === 42.36)).toBe(true);
  await initialForecast(page);
  const locationButton = page.getByRole("button", { name: "Use my location" });
  await locationButton.click();
  await expect(locationButton).toBeEnabled();
  await initialForecast(page);
  expect(requests.filter(request => request.latitude === 42.36)).toHaveLength(3);
});

for (const selectCity of [false, true]) {
  test(`shows weather from a recent device fix while ${selectCity ? "a city selection supersedes detection" : "checking for movement"}`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", { value: {
        getCurrentPosition(success, _failure, { maximumAge }) {
          const age = 12 * 60_000;
          if (maximumAge >= age) {
            success({ coords: { latitude: 42.36, longitude: -71.06 }, timestamp: Date.now() - age });
          } else {
            window.finishLocationCheck = () => success({
              coords: { latitude: 42.5, longitude: -71.1 }, timestamp: Date.now(),
            });
          }
        },
      } });
    });
    const requests = await mockDashboard(page);
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.locator("#hero-location")).toHaveText("Recent device location");
    await initialForecast(page);
    expect(requests.filter(request => request.latitude === 42.36)).toHaveLength(3);
    if (selectCity) {
      await page.getByRole("combobox", { name: "Search for a city" }).fill("London");
      await cityOptions(page).first().click();
    }
    await page.evaluate(() => window.finishLocationCheck());
    if (selectCity) {
      await expect(page.locator("#hero-location")).toHaveText("London, England");
      expect(requests.some(request => request.latitude === 42.5)).toBe(false);
    } else {
      await expect(page.locator("#hero-location")).toHaveText("Current location");
      await initialForecast(page);
      expect(requests.filter(request => request.latitude === 42.5)).toHaveLength(3);
    }
  });
}

test("keeps loaded forecasts when a fresh device fix barely moves", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition(success, _failure, { maximumAge }) {
        const age = 12 * 60_000;
        if (maximumAge >= age) {
          success({ coords: { latitude: 42.36, longitude: -71.06 }, timestamp: Date.now() - age });
        } else {
          // About 200 m away: typical jitter between two fixes in the same place.
          window.finishLocationCheck = () => success({
            coords: { latitude: 42.3615, longitude: -71.0581 }, timestamp: Date.now(),
          });
        }
      },
    } });
  });
  const requests = await mockDashboard(page);
  await initialForecast(page);
  const heroTop = async () => (await page.locator(".hero").boundingBox()).y;
  const before = await heroTop();
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.locator("#hero-location")).toHaveText("Recent device location");
  await expect(page.locator("#geo-status")).toHaveText("Checking your current position…");
  await expect(page.locator("#geo-status")).toBeVisible();
  expect(await heroTop()).toBe(before);
  await initialForecast(page);
  const count = requests.length;
  await page.evaluate(() => window.finishLocationCheck());
  await expect(page.locator("#hero-location")).toHaveText("Current location");
  await expect(page.locator("#geo-status")).toHaveText("");
  await initialForecast(page);
  expect(requests).toHaveLength(count);
});

for (const permission of ["granted", "prompt"]) {
  test(`${permission === "granted" ? "shows" : "skips"} the remembered device fix while a slow first fix is ${permission === "granted" ? "found" : "requested again"}`, async ({ page }) => {
    await page.addInitScript((state) => {
      localStorage.setItem("skylens.device-fix.v1", JSON.stringify({ latitude: 42.36, longitude: -71.06, timestamp: Date.now() - 86_400_000 }));
      Object.defineProperty(navigator, "permissions", { value: { query: async () => ({ state }) } });
      // No cached position: the first fix only arrives when the test finishes it.
      Object.defineProperty(navigator, "geolocation", { value: {
        getCurrentPosition(success) {
          window.finishLocationCheck = () => success({ coords: { latitude: 42.3616, longitude: -71.0581 }, timestamp: Date.now() });
        },
      } });
    }, permission);
    const requests = await mockDashboard(page);
    await initialForecast(page);
    await page.getByRole("button", { name: "Use my location" }).click();
    if (permission === "granted") {
      await expect(page.locator("#hero-location")).toHaveText("Recent device location");
      await expect(page.locator("#geo-status")).toHaveText("Checking your current position…");
      await initialForecast(page);
      const count = requests.length;
      expect(requests.filter(request => request.latitude === 42.36)).toHaveLength(3);
      await page.evaluate(() => window.finishLocationCheck());
      await expect(page.locator("#hero-location")).toHaveText("Current location");
      await expect(page.locator("#geo-status")).toHaveText("");
      expect(requests).toHaveLength(count);
    } else {
      await expect(page.locator("#geo-status")).toHaveText("Finding your location…");
      await expect.poll(() => page.evaluate(() => localStorage.getItem("skylens.device-fix.v1"))).toBeNull();
      expect(requests.some(request => request.latitude === 42.36)).toBe(false);
      await page.evaluate(() => window.finishLocationCheck());
      await expect(page.locator("#hero-location")).toHaveText("Current location");
      await expect.poll(() => requests.some(request => request.latitude === 42.362)).toBe(true);
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("skylens.device-fix.v1")));
    expect(saved).toMatchObject({ latitude: 42.362, longitude: -71.058 });
  });
}

test("location errors float without moving the page and can be dismissed", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition(_success, failure) { failure({ code: 1 }); },
    } });
  });
  await mockDashboard(page);
  await initialForecast(page);
  const heroTop = async () => (await page.locator(".hero").boundingBox()).y;
  const before = await heroTop();
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.locator("#geo-status")).toHaveText("Location access was denied. Search for a city instead.");
  expect(await heroTop()).toBe(before);
  await page.keyboard.press("Escape");
  await expect(page.locator("#geo-status")).toBeHidden();
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.locator("#geo-status")).toBeVisible();
  await page.locator("h1").click();
  await expect(page.locator("#geo-status")).toBeHidden();
  expect(await heroTop()).toBe(before);
});

test("navigation and source links work, with no automated accessibility violations", async ({ page }) => {
  await mockDashboard(page);
  await initialForecast(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Dashboard" })).toHaveCount(0);
  await page.keyboard.press("Tab");
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


test("dark mode follows system preference and remembers a manual choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockDashboard(page);
  await initialForecast(page);
  const root = page.locator("html");
  const toggle = page.getByRole("button", { name: "Dark mode", exact: true });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(root).toHaveCSS("background-color", "rgb(18, 16, 25)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await initialForecast(page);
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "dark" });
  await toggle.click();
  await page.reload();
  await initialForecast(page);
  await expect(root).toHaveAttribute("data-theme", "light");
});

const THEME_LABELS = { light: "Daylight", sand: "Sand", mist: "Mist", dark: "Dusk", midnight: "Midnight", forest: "Forest" };
async function chooseTheme(page, id) {
  await page.getByRole("button", { name: "Color theme" }).click();
  await page.getByRole("menuitemradio", { name: THEME_LABELS[id] }).click();
}

test("theme picker offers two extra light and dark themes and remembers each mode's choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockDashboard(page);
  await initialForecast(page);
  const root = page.locator("html");
  const button = page.getByRole("button", { name: "Color theme" });
  const menu = page.getByRole("menu", { name: "Color theme" });
  await expect(menu).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("group", { name: "Light" }).getByRole("menuitemradio")).toHaveText(["Daylight", "Sand", "Mist"]);
  await expect(menu.getByRole("group", { name: "Dark" }).getByRole("menuitemradio")).toHaveText(["Dusk", "Midnight", "Forest"]);
  await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveText("Daylight");
  await expect(root).not.toHaveAttribute("data-palette", /.*/);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  await chooseTheme(page, "sand");
  await expect(menu).toBeHidden();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveAttribute("data-palette", "sand");
  await expect(root).toHaveCSS("background-color", "rgb(248, 243, 234)");

  await chooseTheme(page, "forest");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveAttribute("data-palette", "forest");
  await expect(page.getByRole("button", { name: "Dark mode", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(root).toHaveCSS("background-color", "rgb(12, 21, 16)");

  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expect(root).toHaveAttribute("data-palette", "sand");
  await page.reload();
  await initialForecast(page);
  await expect(root).toHaveAttribute("data-palette", "sand");
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expect(root).toHaveAttribute("data-palette", "forest");

  await chooseTheme(page, "mist");
  await expect(root).toHaveCSS("background-color", "rgb(238, 245, 247)");
  await chooseTheme(page, "midnight");
  await expect(root).toHaveCSS("background-color", "rgb(10, 16, 32)");
  await chooseTheme(page, "dark");
  await expect(root).not.toHaveAttribute("data-palette", /.*/);
  await expect(root).toHaveCSS("background-color", "rgb(18, 16, 25)");
});

test("theme menu works from the keyboard and closes on an outside click", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockDashboard(page);
  await initialForecast(page);
  const button = page.getByRole("button", { name: "Color theme" });
  const menu = page.getByRole("menu", { name: "Color theme" });
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "Daylight" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "sand");
  await expect(button).toBeFocused();
  await button.click();
  await expect(page.getByRole("menuitemradio", { name: "Sand" })).toBeFocused();
  await page.locator("h1").click();
  await expect(menu).toBeHidden();
});

test("every theme passes accessibility checks", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockDashboard(page);
  await initialForecast(page);
  for (const theme of Object.keys(THEME_LABELS)) {
    await chooseTheme(page, theme);
    await page.getByRole("button", { name: "Color theme" }).click();
    await page.getByRole("menu", { name: "Color theme" }).evaluate(menu => Promise.all(menu.getAnimations().map(animation => animation.finished)));
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations, theme).toEqual([]);
    await page.keyboard.press("Escape");
  }
});

test("dark mode keeps popovers accessible and fits a narrow screen", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockDashboard(page);
  await initialForecast(page);
  await page.getByRole("combobox", { name: "Search for a city" }).fill("London");
  await expect(cityOptions(page)).toHaveCount(2);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Choose forecast date", exact: true }).click();
  await expect(page.locator("#forecast-calendar")).toHaveCSS("background-color", "rgb(28, 25, 38)");
  await page.setViewportSize({ width: 320, height: 775 });
  await expect(page.getByRole("button", { name: "Dark mode", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("dark mode works when local storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
    Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
  });
  await page.emulateMedia({ colorScheme: "light" });
  await mockDashboard(page);
  await initialForecast(page);
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
