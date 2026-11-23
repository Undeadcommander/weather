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

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const index = indexAt(event.clientX);
    if (index === null || index === hovered) return;
    hovered = index;
    redraw();
    showTooltip(index);
    onHover(model.times[index]);
  });
  canvas.addEventListener("pointerleave", hideTooltip);
  canvas.addEventListener("click", (event) => {
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

  document.addEventListener("themechange", redraw);
  setInterval(redraw, 60_000);
  new ResizeObserver(redraw).observe(plot);
  document.fonts?.ready.then(redraw);
  return {
    update(next, time) {
      if (model !== next) {
        hovered = null;
        tooltip.hidden = true;
      }
      model = next;
      selected = next.times.indexOf(time);
      redraw();
    },
  };
}
