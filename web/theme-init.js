(() => {
  // Each theme belongs to a light or dark mode. The default theme of a mode needs no data-palette.
  const THEMES = {
    light: { mode: "light", label: "Daylight", color: "#f6f7fb", surface: "#fff", accent: "#6046cd" },
    sand: { mode: "light", label: "Sand", color: "#f8f3ea", surface: "#fffdf8", accent: "#b4501e" },
    mist: { mode: "light", label: "Mist", color: "#eef5f7", surface: "#fff", accent: "#0b6f84" },
    dark: { mode: "dark", label: "Dusk", color: "#121019", surface: "#1c1926", accent: "#aa90ff" },
    midnight: { mode: "dark", label: "Midnight", color: "#0a1020", surface: "#121a2e", accent: "#6fa8ff" },
    forest: { mode: "dark", label: "Forest", color: "#0c1510", surface: "#14201a", accent: "#5fd49a" },
  };
  const DEFAULTS = { light: "light", dark: "dark" };
  const root = document.documentElement;
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };

  // A null mode means "follow the system".
  function load() {
    const saved = read("skylens.theme");
    const palette = mode => {
      const id = read(`skylens.palette.${mode}`);
      return THEMES[id]?.mode === mode ? id : DEFAULTS[mode];
    };
    return {
      mode: saved === "light" || saved === "dark" ? saved : null,
      palettes: { light: palette("light"), dark: palette("dark") },
    };
  }

  function apply(state) {
    const mode = state.mode ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const id = state.palettes[mode];
    root.dataset.theme = mode;
    if (id === DEFAULTS[mode]) delete root.dataset.palette;
    else root.dataset.palette = id;
    document.querySelector('meta[name="theme-color"]').content = THEMES[id].color;
    return id;
  }

  window.skylensTheme = { THEMES, load, apply };
  apply(load());
})();
