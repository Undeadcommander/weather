import { formatValue, hourLabel } from "./model.js";

const LINE_STYLES = {
  "open-meteo": { color: "--purple", dash: [] },
  "met-norway": { color: "--teal", dash: [7, 4] },
  nws: { color: "--amber", dash: [2, 5] },
  gfs: { color: "--gfs", dash: [9, 3, 2, 3] },
  icon: { color: "--icon", dash: [12, 4] },
  ecmwf: { color: "--ecmwf", dash: [6, 3] },
  gem: { color: "--gem", dash: [3, 3] },
  jma: { color: "--jma", dash: [14, 3, 3, 3] },
  meteofrance: { color: "--meteofrance", dash: [8, 3, 2, 3, 2, 3] },
  ukmo: { color: "--ukmo", dash: [16, 5] },
  cma: { color: "--cma", dash: [5, 4, 1, 4] },
  aifs: { color: "--aifs", dash: [10, 3, 5, 3] },
  aicon: { color: "--aicon", dash: [1, 4] },
  aigfs: { color: "--aigfs", dash: [12, 3, 2, 3, 2, 3] },
  hgefs: { color: "--hgefs", dash: [5, 3, 5, 7] },
  ecmwf9: { color: "--ecmwf9", dash: [4, 2] },
  mosmix: { color: "--mosmix", dash: [11, 3] },
  hrrr: { color: "--hrrr", dash: [2, 2] },
  nbm: { color: "--nbm", dash: [7, 2, 2, 2] },
  rdps: { color: "--rdps", dash: [18, 4] },
  hrdps: { color: "--hrdps", dash: [6, 2, 1, 2] },
  hrdpsw: { color: "--hrdpsw", dash: [3, 6] },
  icond2: { color: "--icond2", dash: [9, 5] },
  iconeu: { color: "--iconeu", dash: [4, 3, 1, 3, 1, 3] },
  arome: { color: "--arome", dash: [13, 3, 1, 3] },
  aromehd: { color: "--aromehd", dash: [2, 3] },
  arpege: { color: "--arpege", dash: [15, 3, 5, 3] },
  ukv: { color: "--ukv", dash: [8, 2] },
  knmi: { color: "--knmi", dash: [1, 2] },
  dmi: { color: "--dmi", dash: [10, 2, 2, 2, 2, 2] },
  nordic: { color: "--nordic", dash: [20, 4] },
  "icon-ch": { color: "--icon-ch", dash: [5, 5] },
  icon2i: { color: "--icon2i", dash: [3, 2, 8, 2] },
  msm: { color: "--msm", dash: [6, 4, 2, 4] },
};

function chartScale(metric, values) {
  if (metric === "rain") return { min: 0, max: 100, step: 25 };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(2, (high - low) * .1);
  const bottom = metric === "wind" ? Math.max(0, low - padding) : low - padding;
  const top = high + padding;
  const rawStep = (top - bottom) / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(1, ([1, 2, 5, 10].find((n) => n * power >= rawStep) ?? 10) * power);
  return { min: Math.floor(bottom / step) * step, max: Math.ceil(top / step) * step, step };
}

export function createChart(plot, tooltip, onSelect, onHover) {
  const canvas = plot.querySelector("canvas");
  const context = canvas.getContext("2d");
  let model;
  let hovered = null;
  let selected = -1;
  let geometry;

  function redraw() {
    if (!model || plot.hidden) return;
    const { times, series, metric, timezone } = model;
    const styles = getComputedStyle(document.documentElement);
    const colorFor = name => styles.getPropertyValue(name).trim();
    const width = plot.clientWidth;
    const height = plot.clientHeight;
    const usable = series.flatMap(({ values }) => values.filter(Number.isFinite));
    if (!width || !height || !usable.length || !context) return;

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const pixelsWide = Math.round(width * dpr);
    const pixelsHigh = Math.round(height * dpr);
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = '500 12px "DM Sans", system-ui, sans-serif';
    context.textBaseline = "middle";

    const { min, max, step } = chartScale(metric, usable);
    const left = 42;
    const right = width - 16;
    const top = 15;
    const bottom = height - 29;
    const x = (index) => times.length === 1 ? (left + right) / 2 : left + (right - left) * index / (times.length - 1);
    const y = (value) => bottom - (bottom - top) * (value - min) / (max - min);
    geometry = { x, width, left, right };

    for (let value = min; value <= max; value += step) {
      const py = y(value);
      context.strokeStyle = colorFor("--line");
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, py);
      context.lineTo(right, py);
      context.stroke();
      context.fillStyle = colorFor("--muted");
      context.textAlign = "right";
      const suffix = { temp: "°", rain: "%", wind: "" }[metric];
      context.fillText(`${value}${suffix}`, left - 8, py);
    }

    const n = Math.min(times.length, Math.max(2, Math.floor((right - left) / 80) + 1));
    for (let i = 0; i < n; i++) {
      const index = n === 1 ? 0 : Math.round(i * (times.length - 1) / (n - 1));
      const label = hourLabel(times[index], timezone);
      const halfLabel = context.measureText(label).width / 2;
      context.textAlign = "center";
      context.fillText(label, Math.min(width - halfLabel, Math.max(halfLabel, x(index))), bottom + 16);
    }

    const target = hovered ?? selected;
    if (target >= 0 && target < times.length) {
      context.fillStyle = colorFor("--chart-selection");
      context.fillRect(x(target) - 1, top, 2, bottom - top);
    }

    for (const { id, values } of series) {
      const { color, dash } = LINE_STYLES[id];
      context.strokeStyle = colorFor(color);
      context.fillStyle = colorFor(color);
      context.lineWidth = 2.6;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.setLineDash(dash);
      context.beginPath();
      values.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        if (Number.isFinite(values[index - 1])) context.lineTo(x(index), y(value));
        else context.moveTo(x(index), y(value));
      });
      context.stroke();
      context.setLineDash([]);
      values.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        const isTarget = index === target;
        const isolated = !Number.isFinite(values[index - 1]) && !Number.isFinite(values[index + 1]);
        if (!isTarget && !isolated) return;
        context.beginPath();
        context.arc(x(index), y(value), isTarget ? 4.6 : 3, 0, 2 * Math.PI);
        context.fill();
        if (isTarget) {
          context.strokeStyle = colorFor("--surface");
          context.lineWidth = 1.5;
          context.stroke();
        }
      });
    }

    if (model.isToday && times.length > 1) {
      const elapsed = Math.min(1, Math.max(0, (Date.now() - times[0]) / (times.at(-1) - times[0])));
      context.fillStyle = colorFor("--chart-past");
      context.fillRect(left, top, (right - left) * elapsed, bottom - top);
    }
  }

  function showTooltip(index) {
    if (!geometry || !model || !Number.isInteger(index) || model.times[index] === undefined) return;
    const { times, series, metric, unit, timezone } = model;
    const title = document.createElement("strong");
    title.textContent = hourLabel(times[index], timezone, true);
    const rows = series.map(({ id, name, values }) => {
      const row = document.createElement("div");
      row.className = "tooltip-row";
      row.dataset.source = id;
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      const label = document.createElement("span");
      label.textContent = name;
      const value = document.createElement("span");
      value.className = "tooltip-value";
      value.textContent = formatValue(values[index], metric, unit);
      row.append(swatch, label, value);
      return row;
    });
    tooltip.replaceChildren(title, ...rows);
    tooltip.hidden = false;
    const width = tooltip.offsetWidth;
    const x = geometry.x(index);
    const left = x + 12 + width <= geometry.width ? x + 12 : Math.max(4, x - width - 12);
    tooltip.style.setProperty("--tooltip-left", `${left}px`);
  }

  function indexAt(clientX) {
    if (!geometry || !model) return null;
    const offset = clientX - canvas.getBoundingClientRect().left;
    const fraction = (offset - geometry.left) / (geometry.right - geometry.left);
    return Math.round(Math.min(1, Math.max(0, fraction)) * (model.times.length - 1));
  }

  function hideTooltip() {
    hovered = null;
    tooltip.hidden = true;
    redraw();
    onHover(null);
  }

  function hoverAt(clientX) {
    const index = indexAt(clientX);
    if (index === null || index === hovered) return;
    hovered = index;
    redraw();
    showTooltip(index);
    onHover(model.times[index]);
  }

  // Touch scrubbing: a finger on the chart acts like a hovering mouse. The canvas keeps
  // touch-action: pan-y, so a vertical swipe still scrolls the page (the browser then
  // cancels the pointer) while a horizontal drag moves the line across the hours.
  // A touch that barely moves is a tap and selects the hour on release; touch selection
  // doesn't wait for the synthesized click, which browsers may drop (e.g. after a flick).
  let touchId = null;
  let touchStartX = 0;
  let scrubbed = false;
  let touchHandled = false;
  canvas.addEventListener("pointerdown", (event) => {
    touchHandled = false;
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    touchId = event.pointerId;
    touchStartX = event.clientX;
    scrubbed = false;
    hoverAt(event.clientX);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") {
      if (event.pointerId !== touchId) return;
      if (Math.abs(event.clientX - touchStartX) > 10) scrubbed = true;
    }
    hoverAt(event.clientX);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.pointerId !== touchId) return;
    touchId = null;
    touchHandled = true;
    const index = scrubbed ? null : indexAt(event.clientX);
    hideTooltip();
    if (index !== null) onSelect(model.times[index]);
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (event.pointerId !== touchId) return;
    touchId = null;
    touchHandled = true;
    hideTooltip();
  });
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") hideTooltip();
  });
  canvas.addEventListener("contextmenu", (event) => {
    if (touchId !== null) event.preventDefault();
  });
  canvas.addEventListener("click", (event) => {
    if (touchHandled) return;
    const index = indexAt(event.clientX);
    if (index !== null) onSelect(model.times[index]);
  });
  plot.addEventListener("keydown", (event) => {
    if (!model?.times.length) return;
    if (event.key === "Escape") {
      hideTooltip();
      return;
    }
    const key = event.key;
    const last = model.times.length - 1;
    const next = { ArrowLeft: Math.max(0, selected - 1), ArrowRight: Math.min(last, selected + 1), Home: 0, End: last }[key];
    if (next === undefined) return;
    event.preventDefault();
    hovered = null;
    onSelect(model.times[next], true);
    showTooltip(next);
  });
  plot.addEventListener("blur", hideTooltip);

  // The canvas can't transition its colors, so cross-fade a snapshot of the old theme instead.
  let fade;
  document.addEventListener("themechange", () => {
    fade?.remove();
    fade = null;
    if (document.documentElement.classList.contains("theme-fade") && model && !plot.hidden && canvas.width && canvas.height) {
      const snapshot = document.createElement("canvas");
      snapshot.className = "chart-fade";
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.after(snapshot);
      fade = snapshot;
      snapshot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease" }).finished
        .then(() => snapshot.remove(), () => snapshot.remove());
    }
    redraw();
  });
  setInterval(redraw, 60_000);
  new ResizeObserver(redraw).observe(plot);
  document.fonts?.ready.then(redraw);
  return {
    update(next, time) {
      if (model !== next) {
        // Keep an open tooltip on the same hour when new forecasts arrive, e.g. mid keyboard navigation.
        const shown = tooltip.hidden ? null : model?.times[hovered ?? selected];
        hovered = null;
        model = next;
        selected = next.times.indexOf(time);
        redraw();
        tooltip.hidden = true;
        const index = shown == null || next.isOutlook ? -1 : next.times.indexOf(shown);
        if (index >= 0 && next.series.length) {
          if (index !== selected) {
            hovered = index;
            redraw();
          }
          showTooltip(index);
        }
        return;
      }
      selected = next.times.indexOf(time);
      redraw();
    },
  };
}
