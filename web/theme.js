export function initializeTheme() {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  const button = document.getElementById("theme-button");
  const popover = document.getElementById("theme-popover");
  const { THEMES, load, apply } = window.skylensTheme;
  const system = matchMedia("(prefers-color-scheme: dark)");
  let state = load();

  for (const [mode, heading] of [["light", "Light"], ["dark", "Dark"]]) {
    const group = document.createElement("div");
    group.className = "theme-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", heading);
    const label = document.createElement("p");
    label.className = "theme-group-label";
    label.setAttribute("aria-hidden", "true");
    label.textContent = heading;
    group.append(label);
    for (const [id, theme] of Object.entries(THEMES)) {
      if (theme.mode !== mode) continue;
      const option = document.createElement("button");
      option.type = "button";
      option.className = "theme-option";
      option.dataset.themeId = id;
      option.setAttribute("role", "menuitemradio");
      option.tabIndex = -1;
      option.innerHTML = '<span class="theme-swatch" aria-hidden="true"></span><span class="theme-name"></span>' +
        '<svg class="icon" aria-hidden="true"><use href="#icon-check"/></svg>';
      option.querySelector(".theme-name").textContent = theme.label;
      const swatch = option.querySelector(".theme-swatch").style;
      swatch.setProperty("--swatch-page", theme.color);
      swatch.setProperty("--swatch-surface", theme.surface);
      swatch.setProperty("--swatch-accent", theme.accent);
      group.append(option);
    }
    popover.append(group);
  }
  const options = [...popover.querySelectorAll(".theme-option")];

  function save() {
    try {
      if (state.mode) localStorage.setItem("skylens.theme", state.mode);
      for (const mode of ["light", "dark"]) localStorage.setItem(`skylens.palette.${mode}`, state.palettes[mode]);
    } catch {}
  }

  function render() {
    const id = apply(state);
    const dark = root.dataset.theme === "dark";
    for (const option of options) option.setAttribute("aria-checked", String(option.dataset.themeId === id));
    button.title = `Color theme: ${THEMES[id].label}`;
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
    toggle.querySelector("use").setAttribute("href", dark ? "#icon-sun" : "#icon-moon");
    document.dispatchEvent(new Event("themechange"));
  }

  function setOpen(open, focus) {
    popover.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open && focus) (options.find(option => option.getAttribute("aria-checked") === "true") ?? options[0]).focus();
    if (!open && focus) button.focus();
  }

  render();
  toggle.addEventListener("click", () => {
    state.mode = root.dataset.theme === "dark" ? "light" : "dark";
    save();
    render();
  });
  button.addEventListener("click", () => setOpen(popover.hidden, true));
  button.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(true, true);
  });
  popover.addEventListener("click", event => {
    const option = event.target.closest(".theme-option");
    if (!option) return;
    const theme = THEMES[option.dataset.themeId];
    state.mode = theme.mode;
    state.palettes[theme.mode] = option.dataset.themeId;
    save();
    render();
    setOpen(false, true);
  });
  popover.addEventListener("keydown", event => {
    const index = options.indexOf(document.activeElement);
    const target = {
      ArrowDown: options[(index + 1) % options.length],
      ArrowUp: options[(index - 1 + options.length) % options.length],
      Home: options[0],
      End: options.at(-1),
    }[event.key];
    if (target) {
      event.preventDefault();
      target.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false, true);
    } else if (event.key === "Tab") {
      setOpen(false, false);
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!popover.hidden && !popover.contains(event.target) && !button.contains(event.target)) setOpen(false, false);
  });
  system.addEventListener("change", () => {
    if (!state.mode) render();
  });
  window.addEventListener("storage", event => {
    if (event.key !== null && !event.key.startsWith("skylens.theme") && !event.key.startsWith("skylens.palette.")) return;
    state = load();
    render();
  });
}
