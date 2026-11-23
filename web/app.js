import { SOURCES } from "../shared/weather.js";
import { fetchOpenMeteo } from "../shared/open-meteo.js";
import { fetchBrowserForecast, findBrowserLocations } from "../shared/browser-providers.js";
import {
  METRICS, atHour, compareSources, conditionInfo, currentSummary, dateChoices, dateKey, detailLabel,
  displayNumber, formatGap, formatValue, gapAtHour, hourLabel, locationLabel,
  hasSnow, normalizePreferences, snowForecast, timesForDay,
} from "./model.js";
import { createChart } from "./chart.js";
import { createDatePicker } from "./calendar.js";
import { initializeTheme } from "./theme.js";

initializeTheme();

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
const state = { day: null, metric: "temp", time: null, results: new Map(), pending: new Map() };
let view;
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
const sourcePriority = ["nws", "open-meteo", "met-norway", "ecmwf", "gfs", "ukmo"];
const sourceRank = ({ id }) => {
  const rank = sourcePriority.indexOf(id);
  return rank < 0 ? sourcePriority.length : rank;
};
const listedSources = [...SOURCES].sort((a, b) => sourceRank(a) - sourceRank(b));
for (const source of listedSources) {
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
  sourceCards.set(source.id, { card, status, favorite, switchInput });

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

function updateScrollIndicator() {
  const list = $("source-list");
  const wrap = list.parentElement;
  const hasOverflow = list.scrollHeight > list.clientHeight + 1;
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
  const showOverflow = hasOverflow && !atBottom;
  list.classList.toggle("has-overflow", showOverflow);
  if (wrap) wrap.classList.toggle("has-overflow", showOverflow);

  const track = $("source-scroll-track");
  const thumb = $("source-scroll-thumb");
  if (track && thumb) {
    track.style.opacity = hasOverflow ? "1" : "0";
    track.style.pointerEvents = hasOverflow ? "auto" : "none";
    if (hasOverflow) {
      const height = Math.max(12, (list.clientHeight / list.scrollHeight) * 100);
      thumb.style.height = `${height}%`;
      const maxScroll = list.scrollHeight - list.clientHeight;
      const top = maxScroll > 0 ? (list.scrollTop / maxScroll) * (100 - height) : 0;
      thumb.style.top = `${top}%`;
    }
  }
}

$("source-list").addEventListener("scroll", updateScrollIndicator, { passive: true });

{
  const observer = new ResizeObserver(updateScrollIndicator);
  observer.observe($("source-list"));
}

{
  const track = $("source-scroll-track");
  const thumb = $("source-scroll-thumb");
  const list = $("source-list");
  if (track && thumb && list) {
    let isDragging = false;
    let startY = 0;
    let startScrollTop = 0;

    thumb.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      startY = e.clientY;
      startScrollTop = list.scrollTop;
      thumb.setPointerCapture(e.pointerId);
    });

    thumb.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const trackHeight = track.clientHeight;
      const thumbHeight = thumb.clientHeight;
      const scrollableTrack = trackHeight - thumbHeight;
      if (scrollableTrack <= 0) return;
      const deltaY = e.clientY - startY;
      const scrollableList = list.scrollHeight - list.clientHeight;
      list.scrollTop = startScrollTop + (deltaY / scrollableTrack) * scrollableList;
    });

    const stopDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        try { thumb.releasePointerCapture(e.pointerId); } catch {}
      }
    };
    thumb.addEventListener("pointerup", stopDrag);
    thumb.addEventListener("pointercancel", stopDrag);

    track.addEventListener("pointerdown", (e) => {
      if (e.target === thumb) return;
      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const thumbHeight = thumb.clientHeight;
      const targetTop = clickY - thumbHeight / 2;
      const scrollableTrack = rect.height - thumbHeight;
      if (scrollableTrack > 0) {
        const scrollableList = list.scrollHeight - list.clientHeight;
        list.scrollTop = Math.max(0, Math.min(scrollableList, (targetTop / scrollableTrack) * scrollableList));
      }
    });
  }
}

updateScrollIndicator();

function renderSources(active, availableSources, metric) {
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
      if (availableSources.has(id)) {
        marker = result.stale ? "stale" : "ok";
        label = result.stale ? "Cached forecast" : "Forecast available";
      } else {
        label = `No ${METRICS[metric].label} data for this day`;
      }
    } else if (result?.status === "unavailable") {
      marker = "unavailable";
      label = "Temporarily unavailable";
    }
    status.dataset.status = marker;
    status.textContent = label;
  }
  $("source-count").textContent = `${availableSources.size} reporting`;
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

const renderDates = createDatePicker($("date-row"), day => {
  state.day = day;
  state.time = null;
  render();
});

function renderOptions() {
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

function renderOutlook() {
  const { times, series, metric, timezone } = view;
  const table = document.createElement("table");
  table.append(text("caption", metric === "snow" ? "Hourly snow forecast" : "Hourly conditions", "sr-only"));
  const header = table.createTHead().insertRow();
  for (const label of ["Local time", ...series.map(source => source.name)]) {
    const cell = text("th", label);
    cell.scope = "col";
    header.append(cell);
  }
  const body = table.createTBody();
  times.forEach((time, index) => {
    const row = body.insertRow();
    const hour = text("th", "");
    hour.scope = "row";
    const button = text("button", hourLabel(time, timezone, true));
    button.type = "button";
    button.dataset.time = time;
    hour.append(button);
    row.append(hour);
    for (const { values } of series) {
      const cell = row.insertCell();
      const info = values[index];
      if (info) {
        const content = text("span", "", "table-condition");
        if (info.icon) content.append(icon(info.icon));
        content.append(info.label);
        cell.append(content);
      } else cell.textContent = "—";
    }
  });
  $("outlook").replaceChildren(table);
}

function renderAnalysis(active) {
  const { series, availableSources, metric, unit, isOutlook } = view;
  const hasData = availableSources.size > 0;
  const hasChart = hasData && !isOutlook;
  $("plot").hidden = !hasChart;
  $("outlook").hidden = !isOutlook || !hasData;
  if (!$("outlook").hidden) renderOutlook();
  $("plot-empty").hidden = hasData;
  $("chart-unit").hidden = !hasChart;
  $("chart-unit").textContent = hasChart ? `${METRICS[metric].label} (${METRICS[metric][unit]})` : "";
  if (!hasData) {
    const [title, note] = emptyMessage(active, series);
    $("empty-title").textContent = title;
    $("empty-note").textContent = note;
  }

  $("legend").hidden = isOutlook;
  $("difference").hidden = isOutlook;
  if (isOutlook) return;
  $("legend").replaceChildren(...series.map(({ id, name }) => {
    const item = document.createElement("li");
    item.dataset.source = id;
    const hasValues = availableSources.has(id);
    item.toggleAttribute("data-missing", !hasValues);
    item.append(swatch(), text("span", hasValues ? name : `${name} · No data`));
    return item;
  }));
  renderGap();
}

function renderGap(hoveredTime = null) {
  if (!view || view.isOutlook) return;
  const { active, times, series, metric, unit, timezone } = view;
  const time = hoveredTime ?? state.time;
  const hour = time === null ? null : hourLabel(time, timezone);
  const gap = gapAtHour(times, series, time);
  $("gap-value").textContent = gap ? formatGap(gap.spread, metric, unit) : "—";
  if (gap?.spread > 0) {
    const label = METRICS[metric].gapLabel;
    const range = [gap.min, gap.max].map((n) => formatValue(n, metric, unit)).join(" to ");
    $("gap-note").textContent = `At ${hour}, ${label} range from ${range}.`;
  } else if (gap) {
    $("gap-note").textContent = `At ${hour}, sources agree at the displayed precision.`;
  } else {
    const when = hour ? `for ${hour}` : "at the same hour";
    $("gap-note").textContent = isPending(active) ? `Waiting for comparable forecasts ${when}.` :
      `Compare at least two sources with ${METRICS[metric].label} data ${when}.`;
  }
}

function renderDetails() {
  const { active, detailTimes, metric, unit, timezone } = view;
  const selected = state.time;
  if (view.isOutlook) {
    for (const button of $("outlook").querySelectorAll("button[data-time]")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.time) === selected));
    }
  }
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

const chart = createChart($("plot"), $("chart-tooltip"), selectTime, renderGap);
$("outlook").addEventListener("click", event => {
  const button = event.target.closest("button[data-time]");
  if (button) selectTime(Number(button.dataset.time));
});

function selectTime(time, keyboard = false) {
  if (typeof time !== "number" || !view.times.includes(time)) return;
  state.time = time;
  chart.update(view, state.time);
  renderGap();
  renderDetails();
  if (keyboard) announce(`Forecast details for ${detailLabel(time, view.timezone)}.`);
}

function render() {
  const now = Date.now();
  const { timezone } = preferences.location;
  const active = inComparison();
  const reportingSources = active.filter(({ id }) => reporting(id));
  const current = atHour(now);
  const available = new Set();
  let end = current;
  for (const { id } of reportingSources) {
    for (const { t } of state.results.get(id).rows) {
      if (t < current) continue;
      available.add(dateKey(t, timezone));
      end = Math.max(end, t);
    }
  }
  const choices = dateChoices(now, timezone, end);
  if (!available.has(state.day)) state.day = choices.find(({ key }) => available.has(key))?.key ?? choices[0].key;
  const times = timesForDay(now, state.day, timezone, end);
  const snowDay = reportingSources.some(({ id }) => times.some(time => hasSnow(state.results.get(id).byTime.get(time))));
  $("snow-tab").hidden = !snowDay;
  if (!snowDay && state.metric === "snow") state.metric = "temp";
  const { metric } = state;
  const { unit } = preferences;
  const isOutlook = metric === "conditions" || metric === "snow";
  const firstPopulated = times.find((time) => reportingSources.some(({ id }) => state.results.get(id).byTime.has(time)));
  const detailTimes = firstPopulated === undefined ? [] : times;
  const series = reportingSources.map(({ id, name }) => ({
    id, name, values: times.map(time => {
      const row = state.results.get(id).byTime.get(time);
      if (metric === "conditions") return conditionInfo(row);
      if (metric === "snow") {
        const label = snowForecast(row, unit);
        return label ? { label, icon: hasSnow(row) ? "snow" : null } : null;
      }
      return displayNumber(row?.[metric], metric, unit);
    }),
  }));
  const availableSources = new Set(series.filter(({ values }) => values.some(value => value !== null)).map(({ id }) => id));
  if (!detailTimes.includes(state.time)) state.time = detailTimes.includes(current) ? current : firstPopulated ?? null;
  const isToday = state.day === dateKey(now, timezone);
  view = { active, times, detailTimes, series, availableSources, metric, unit, timezone, isOutlook, isToday };

  renderSources(active, availableSources, metric);
  renderHero(active, atHour(now), timezone);
  renderDates(choices, available, state.day);
  renderOptions();
  renderAnalysis(active);
  chart.update(view, state.time);
  renderDetails();
}

async function requestForecast(source, location, signal) {
  const feed = SOURCES.find(({ id }) => id === source);
  if (source === "open-meteo" || feed.model) return fetchOpenMeteo(location, signal, feed);
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
    announce(`${view.availableSources.size} of ${active.length} sources reporting for the selected forecast in ${preferences.location.name}.`);
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

let locationVersion = 0;
function chooseLocation(location) {
  locationVersion++;
  $("detect-location").disabled = false;
  $("geo-status").textContent = "";
  for (const controller of state.pending.values()) controller.abort();
  state.pending.clear();
  state.results.clear();
  preferences.location = location;
  state.day = null;
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

  $("detect-location").addEventListener("click", () => {
    close();
    const status = $("geo-status");
    if (!navigator.geolocation) {
      status.textContent = "Location detection is unavailable. Search for a city instead.";
      return;
    }
    const version = ++locationVersion;
    $("detect-location").disabled = true;
    status.textContent = "Finding your location…";
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (version !== locationVersion) return;
      input.value = "";
      close();
      chooseLocation({ name: "Current location", region: "", country: "", countryCode: "",
        latitude: Number(coords.latitude.toFixed(3)), longitude: Number(coords.longitude.toFixed(3)),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
      announce("Loading forecasts for your current location.");
    }, (error) => {
      if (version !== locationVersion) return;
      $("detect-location").disabled = false;
      status.textContent = error.code === 1 ? "Location access was denied. Search for a city instead." :
        "Could not find your location. Try again or search for a city.";
    }, { timeout: 12000, maximumAge: 300000 });
  });

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
