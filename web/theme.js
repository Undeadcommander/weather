export function initializeTheme() {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  const picker = document.getElementById("theme-select");
  const { THEMES, load, apply } = window.skylensTheme;
  const system = matchMedia("(prefers-color-scheme: dark)");
  let state = load();

  for (const [mode, heading] of [["light", "Light"], ["dark", "Dark"]]) {
    const group = document.createElement("optgroup");
    group.label = heading;
    for (const [id, theme] of Object.entries(THEMES)) {
      if (theme.mode === mode) group.append(new Option(theme.label, id));
    }
    picker.append(group);
  }

  function save() {
    try {
      if (state.mode) localStorage.setItem("skylens.theme", state.mode);
      for (const mode of ["light", "dark"]) localStorage.setItem(`skylens.palette.${mode}`, state.palettes[mode]);
    } catch {}
  }

  function render() {
    const id = apply(state);
    const dark = root.dataset.theme === "dark";
    picker.value = id;
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
    toggle.querySelector("use").setAttribute("href", dark ? "#icon-sun" : "#icon-moon");
    document.dispatchEvent(new Event("themechange"));
  }

  render();
  toggle.addEventListener("click", () => {
    state.mode = root.dataset.theme === "dark" ? "light" : "dark";
    save();
    render();
  });
  picker.addEventListener("change", () => {
    const theme = THEMES[picker.value];
    state.mode = theme.mode;
    state.palettes[theme.mode] = picker.value;
    save();
    render();
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
