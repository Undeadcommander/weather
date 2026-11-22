import { SOURCES } from "../shared/weather.js";
import { fetchOpenMeteo } from "../shared/open-meteo.js";
import { fetchBrowserForecast, findBrowserLocations } from "../shared/browser-providers.js";
import {
  METRICS, atHour, compareSources, conditionInfo, currentSummary, dateChoices, detailLabel,
  displayNumber, formatGap, formatValue, hourLabel, largestGap, locationLabel,
  normalizePreferences, timesForDay,
} from "./model.js";
import { createChart } from "./chart.js";

const STORE_KEY = "skylens.preferences.v1";
const STATIC_HOSTING = typeof __SKYLENS_STATIC__ !== "undefined" && __SKYLENS_STATIC__;
const US_COVERAGE = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);
const fields = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));
const $ = (id) => fields[id];

function readPreferences() {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(STORE_KEY)));
  } catch {
    return normalizePreferences();
  }
}

const preferences = readPreferences();
const state = { day: 0, metric: "temp", time: null, results: new Map(), pending: new Map() };
let view;
let dateSignature = "";
let hourSignature = "";

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are still available for this visit when storage is blocked.
  }
}

function text(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function announce(message) {
  $("announcement").textContent = message;
}

function swatch() {
  return text("span", "", "swatch");
}

function canReport(source) {
  const country = preferences.location.countryCode;
  return source !== "nws" || !country || US_COVERAGE.has(country);
}

function inComparison() {
  return compareSources(preferences);
}

function reporting(source) {
  return state.results.get(source)?.status === "ok";
}

function isPending(active) {
  return active.some(({ id }) => state.pending.has(id));
}

const sourceCards = new Map();
for (const source of SOURCES) {
  const card = text("li", "", "source-card");
  card.dataset.source = source.id;
  const mark = text("span", "", "source-mark");
  mark.append(icon(source.icon));
  const group = document.createElement("div");
  const title = text("p", source.name, "source-name");
  title.title = source.coverage;
  const status = text("p", "", "source-status");
  group.append(title, status);
  const actions = text("div", "", "source-actions");
  const favorite = text("button", "", "star-button");
  favorite.type = "button";
  favorite.setAttribute("aria-label", `Favorite ${source.name}`);
  favorite.append(icon("star"));
  const toggle = text("label", "", "switch");
  const switchInput = document.createElement("input");
  switchInput.type = "checkbox";
  switchInput.setAttribute("role", "switch");
  switchInput.setAttribute("aria-label", `Compare ${source.name}`);
  toggle.append(switchInput, text("span", "", "track"));
  actions.append(favorite, toggle);
  card.append(mark, group, actions);
  $("source-list").append(card);
  sourceCards.set(source.id, { status, favorite, switchInput });

  switchInput.addEventListener("change", () => {
    preferences.enabled = switchInput.checked
      ? [...preferences.enabled, source.id]
      : preferences.enabled.filter((id) => id !== source.id);
    persist();
    loadForecasts();
  });
  favorite.addEventListener("click", () => {
    const wasFavorite = preferences.favorites.includes(source.id);
    preferences.favorites = wasFavorite
      ? preferences.favorites.filter((id) => id !== source.id)
      : [...preferences.favorites, source.id];
    persist();
    loadForecasts();
    announce(wasFavorite ? `${source.name} removed from favorites.` : `${source.name} added to favorites.`);
  });
}

function renderSources(active) {
  const reportingCount = active.filter(({ id }) => reporting(id)).length;
  for (const { id } of SOURCES) {
    const { status, favorite, switchInput } = sourceCards.get(id);
    const enabled = preferences.enabled.includes(id);
    const isFavorite = preferences.favorites.includes(id);
    favorite.setAttribute("aria-pressed", String(isFavorite));
    favorite.title = isFavorite ? "Remove from favorites" : "Add to favorites";
    switchInput.checked = enabled;

    const result = state.results.get(id);
    let marker = "idle";
    let label = "Ready to compare";
    if (!enabled) label = "Hidden";
    else if (preferences.favoritesOnly && !isFavorite) label = "Outside favorites";
    else if (!canReport(id) || result?.status === "unsupported") label = "Outside coverage";
    else if (state.pending.has(id)) label = result?.status === "ok" ? "Refreshing…" : "Loading…";
    else if (result?.status === "ok") {
      marker = result.stale ? "stale" : "ok";
      label = result.stale ? "Cached forecast" : "Forecast available";
    } else if (result?.status === "unavailable") {
      marker = "unavailable";
      label = "Temporarily unavailable";
    }
    status.dataset.status = marker;
    status.textContent = label;
  }
  $("source-count").textContent = `${reportingCount} reporting`;
  $("favorites-only").setAttribute("aria-pressed", String(preferences.favoritesOnly));
  $("refresh").setAttribute("aria-busy", String(isPending(active)));
  $("refresh").setAttribute("aria-disabled", String(isPending(active)));
}

function renderHero(active, current, timezone) {
  const rows = active.map(({ id }) => state.results.get(id)?.byTime?.get(current));
  const summary = currentSummary(rows);
  const unit = preferences.unit;
  $("hero-location").querySelector("span").textContent = locationLabel(preferences.location);
  $("hero-temperature").textContent = formatValue(displayNumber(summary?.temp, "temp", unit), "temp", unit);
  $("hero-icon").querySelector("use").setAttribute("href", `#icon-${summary?.condition?.icon ?? "cloud"}`);
  $("hero-condition").textContent = summary?.condition?.label ??
    (summary?.isTied ? "Mixed conditions" : summary ? "Current forecast" :
      isPending(active) ? "Loading forecast" : "Current forecast unavailable");
  $("hero-time").textContent = summary ? `Forecast for ${hourLabel(current, timezone, true)}` : "";
  for (const metric of ["humidity", "wind", "rain"]) {
    $(`hero-${metric}`).textContent = formatValue(displayNumber(summary?.[metric], metric, unit), metric, unit);
  }
}

function renderDates(choices) {
  const signature = choices.map(({ key }) => key).join(",");
  if (dateSignature !== signature) {
    dateSignature = signature;
    $("dates").replaceChildren(...choices.map(({ label }, index) => {
      const button = text("button", label);
      button.type = "button";
      button.dataset.day = index;
      return button;
    }));
  }
  for (const button of $("dates").children) button.setAttribute("aria-pressed", String(Number(button.dataset.day) === state.day));
  for (const button of document.querySelectorAll("[data-metric]")) {
    button.setAttribute("aria-pressed", String(button.dataset.metric === state.metric));
  }
  for (const button of document.querySelectorAll("[data-unit]")) {
    button.setAttribute("aria-pressed", String(button.dataset.unit === preferences.unit));
  }
}

function emptyMessage(active, series) {
  if (!active.length) {
    return preferences.favoritesOnly
      ? ["No favorites in this comparison", "Star and enable a source, or turn off the favorites filter."]
      : ["No sources selected", "Enable a source to see its forecast."];
  }
  if (isPending(active)) return ["Loading forecasts…", "Forecasts appear as each source responds."];
  if (series.length && series.some(({ id }) => reporting(id))) {
    return [`No ${METRICS[state.metric].label} data`, "Try a different day, metric, or source."];
  }
  return ["Forecasts unavailable", "Try refreshing or choose a source that covers this location."];
}

function renderAnalysis(active, gap) {
  const { times, series, metric, unit, timezone } = view;
  const hasChart = times.length > 0 && series.some(({ values }) => values.some(Number.isFinite));
  $("plot").hidden = !hasChart;
  $("plot-empty").hidden = hasChart;
  $("chart-unit").textContent = METRICS[metric][unit];
  if (!hasChart) {
    const [title, note] = emptyMessage(active, series);
    $("empty-title").textContent = title;
    $("empty-note").textContent = note;
  }

  $("legend").replaceChildren(...series.map(({ id, name, values }) => {
    const item = document.createElement("li");
    item.dataset.source = id;
    const hasValues = values.some(Number.isFinite);
    item.toggleAttribute("data-missing", !hasValues);
    item.append(swatch(), text("span", hasValues ? name : `${name} · No data`));
    return item;
  }));

  $("gap-value").textContent = gap ? formatGap(gap.spread, metric, unit) : "—";
  $("inspect-gap").hidden = !gap || gap.spread === 0;
  if (gap?.spread > 0) {
    const hour = hourLabel(gap.time, timezone);
    const label = METRICS[metric].gapLabel;
    const range = [gap.min, gap.max].map((n) => formatValue(n, metric, unit)).join(" to ");
    $("gap-note").textContent = `At ${hour}, ${label} range from ${range}.`;
    $("inspect-gap").textContent = `Inspect ${hour}`;
  } else if (gap) {
    $("gap-note").textContent = "Sources agree at the displayed precision for the hours they share.";
  } else {
    $("gap-note").textContent = isPending(active) ? "Waiting for comparable hours." :
      `Compare at least two sources with ${METRICS[metric].label} data at the same hour.`;
  }
}

function renderDetails() {
  const { active, detailTimes, metric, unit, timezone } = view;
  const selected = state.time;
  const signature = `${timezone}:${detailTimes.join(",")}`;
  if (signature !== hourSignature) {
    $("hours").replaceChildren(...detailTimes.map((time) => {
      const option = text("option", hourLabel(time, timezone, true));
      option.value = String(time);
      return option;
    }));
    hourSignature = signature;
  }
  $("hours").disabled = !detailTimes.length;
  $("hours").value = String(selected);
  $("detail-time").textContent = selected === null ? "Select an hour on the chart" : detailLabel(selected, timezone);

  const rows = active.map((source) => [source, state.results.get(source.id)?.byTime?.get(selected)]);
  const values = rows.map(([, row]) => displayNumber(row?.[metric], metric, unit)).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const hasDetails = rows.some(([, row]) => row);
  $("table-wrap").hidden = !hasDetails;
  $("details-empty").hidden = hasDetails;
  if (!hasDetails) {
    $("detail-rows").replaceChildren();
    return;
  }
  $("detail-rows").replaceChildren(...rows.map(([{ id, name }, row]) => {
    const item = document.createElement("tr");
    item.dataset.source = id;
    const head = document.createElement("th");
    head.scope = "row";
    const sourceLabel = text("span", "", "table-source");
    sourceLabel.append(swatch(), text("span", name));
    head.append(sourceLabel);
    const conditionCell = document.createElement("td");
    const info = conditionInfo(row);
    if (info) {
      const content = text("span", "", "table-condition");
      content.append(icon(info.icon), text("span", info.label));
      conditionCell.append(content);
    } else {
      conditionCell.textContent = "—";
    }
    item.append(head, conditionCell);
    for (const field of ["temp", "rain", "wind", "humidity"]) {
      const value = displayNumber(row?.[field], field, unit);
      const entry = text("td", formatValue(value, field, unit), value === null ? "unreported" : "");
      if (field === metric && value !== null && values.length >= 2 && min < max) {
        if (value === max) entry.append(text("span", "Highest", "range-label"));
        if (value === min) entry.append(text("span", "Lowest", "range-label low"));
      }
      item.append(entry);
    }
    return item;
  }));
}

const chart = createChart($("plot"), $("chart-tooltip"), selectTime);

function selectTime(time, keyboard = false) {
  if (typeof time !== "number" || !view.times.includes(time)) return;
  state.time = time;
  chart.update(view, state.time);
  renderDetails();
  if (keyboard) announce(`Forecast details for ${detailLabel(time, view.timezone)}.`);
}

function render() {
  const now = Date.now();
  const { timezone } = preferences.location;
  const active = inComparison();
  const choices = dateChoices(now, timezone);
  const times = timesForDay(now, choices[state.day].key, timezone);
  const { metric } = state;
  const { unit } = preferences;
  const reportingSources = active.filter(({ id }) => reporting(id));
  const firstPopulated = times.find((time) => reportingSources.some(({ id }) => state.results.get(id).byTime.has(time)));
  const detailTimes = firstPopulated === undefined ? [] : times;
  const series = reportingSources.map(({ id, name }) => ({
    id, name, values: times.map((time) => displayNumber(state.results.get(id).byTime.get(time)?.[metric], metric, unit)),
  }));
  if (!detailTimes.includes(state.time)) state.time = firstPopulated ?? null;
  view = { active, times, detailTimes, series, metric, unit, timezone, gap: largestGap(times, series) };

  renderSources(active);
  renderHero(active, atHour(now), timezone);
  renderDates(choices);
  renderAnalysis(active, view.gap);
  chart.update(view, state.time);
  renderDetails();
}

async function requestForecast(source, location, signal) {
  if (source === "open-meteo") return fetchOpenMeteo(location, signal);
  if (STATIC_HOSTING) return fetchBrowserForecast(source, location, signal);
  const query = new URLSearchParams({ source, lat: location.latitude, lon: location.longitude });
  const response = await fetch(`/api/weather?${query}`, { signal });
  if (!response.ok) throw new Error("Source unavailable");
  return response.json();
}

async function fetchForecast(source, location, controller) {
  const previous = state.results.get(source);
  let result;
  try {
    const payload = await requestForecast(source, location, controller.signal);
    if (payload.source !== source || !["ok", "unsupported"].includes(payload.status) || !Array.isArray(payload.rows)) {
      throw new Error("Unexpected forecast response");
    }
    result = { ...payload, byTime: new Map(payload.rows.map((row) => [row.t, row])) };
  } catch {
    result = previous?.status === "ok" && Date.now() - previous.retrievedAt < 60 * 60_000
      ? { ...previous, stale: true }
      : { status: "unavailable" };
  }
  if (state.pending.get(source) !== controller || controller.signal.aborted) return;
  state.pending.delete(source);
  state.results.set(source, { ...result, checkedAt: Date.now() });
  render();

  const active = inComparison();
  if (!isPending(active)) {
    const count = active.filter(({ id }) => reporting(id)).length;
    announce(`${count} of ${active.length} sources reporting for ${preferences.location.name}.`);
  }
}

function loadForecasts(force = false) {
  const { location } = preferences;
  for (const { id } of inComparison()) {
    if (!canReport(id) || state.pending.has(id)) continue;
    const previous = state.results.get(id);
    if (!force && previous && Date.now() - previous.checkedAt < 5 * 60_000) continue;
    const controller = new AbortController();
    state.pending.set(id, controller);
    void fetchForecast(id, location, controller);
  }
  render();
}

function chooseLocation(location) {
  for (const controller of state.pending.values()) controller.abort();
  state.pending.clear();
  state.results.clear();
  preferences.location = location;
  state.day = 0;
  state.time = null;
  persist();
  loadForecasts();
}

$("favorites-only").addEventListener("click", () => {
  preferences.favoritesOnly = !preferences.favoritesOnly;
  persist();
  loadForecasts();
});
$("refresh").addEventListener("click", () => {
  if (!isPending(inComparison())) loadForecasts(true);
});
$("dates").addEventListener("click", (event) => {
  const day = event.target.closest("button[data-day]");
  if (!day) return;
  state.day = Number(day.dataset.day);
  state.time = null;
  render();
});
document.querySelector(".metric-picker").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-metric]");
  if (!button) return;
  state.metric = button.dataset.metric;
  render();
});
document.querySelector(".units").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-unit]");
  if (!button) return;
  preferences.unit = button.dataset.unit;
  persist();
  render();
});
$("hours").addEventListener("change", () => selectTime(Number($("hours").value)));
$("inspect-gap").addEventListener("click", () => {
  if (!view.gap) return;
  selectTime(view.gap.time);
  $("hours").focus();
});

function syncNav() {
  const anchor = ["#comparison", "#sources"].includes(location.hash) ? location.hash : "#overview";
  for (const link of document.querySelectorAll(".top-nav a")) {
    if (link.getAttribute("href") === anchor) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
addEventListener("hashchange", syncNav);
syncNav();

function setupSearch() {
  const form = $("location-form");
  const input = $("location-query");
  const list = $("location-options");
  const popover = $("location-popover");
  const message = $("location-message");
  let controller;
  let timer;
  let matches = [];
  let selected = -1;

  function clearSearch() {
    controller?.abort();
    controller = undefined;
    clearTimeout(timer);
    matches = [];
    selected = -1;
    list.replaceChildren();
    input.removeAttribute("aria-activedescendant");
  }

  function close() {
    clearSearch();
    popover.hidden = true;
    input.setAttribute("aria-expanded", "false");
    message.textContent = "";
  }

  function open(note) {
    popover.hidden = false;
    input.setAttribute("aria-expanded", "true");
    message.textContent = note;
  }

  async function search(query) {
    clearSearch();
    const active = new AbortController();
    controller = active;
    open("Searching cities…");
    try {
      let locations;
      if (STATIC_HOSTING) {
        locations = await findBrowserLocations(query, active.signal);
      } else {
        const response = await fetch(`/api/locations?${new URLSearchParams({ q: query })}`, { signal: active.signal });
        if (!response.ok) throw new Error("Search unavailable");
        ({ locations } = await response.json());
      }
      if (controller !== active) return;
      matches = locations;
      list.replaceChildren(...matches.map(({ name, region, country }, index) => {
        const item = text("li", "", "location-option");
        item.id = `location-option-${index}`;
        item.dataset.option = index;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        item.append(text("strong", name), text("span", [region, country].filter(Boolean).join(", ")));
        return item;
      }));
      open(matches.length ? "" : "No matching cities found.");
    } catch {
      if (controller === active) open("City search is unavailable. Try again.");
    }
  }

  function choose(index) {
    const location = matches[index];
    if (!location) return;
    input.value = "";
    close();
    chooseLocation(location);
    announce(`Loading forecasts for ${locationLabel(location)}.`);
  }

  input.addEventListener("input", () => {
    close();
    const query = input.value.trim();
    if (query.length >= 2) timer = setTimeout(() => search(query), 250);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape" && !popover.hidden) event.preventDefault();
      close();
    }
    if (matches.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      selected = selected === -1 ? (step > 0 ? 0 : matches.length - 1) : (selected + step + matches.length) % matches.length;
      for (const option of list.children) option.setAttribute("aria-selected", String(Number(option.dataset.option) === selected));
      const option = list.children[selected];
      input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (matches.length) choose(Math.max(0, selected));
    else if (input.value.trim().length >= 2) void search(input.value.trim());
  });
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-option]");
    if (option) choose(Number(option.dataset.option));
  });
  document.addEventListener("pointerdown", (event) => {
    if (!form.contains(event.target)) close();
  });
}

setupSearch();
loadForecasts();
