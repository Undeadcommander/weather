export function initializeTheme() {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  const system = matchMedia("(prefers-color-scheme: dark)");
  let preference;
  try { preference = localStorage.getItem("skylens.theme"); } catch {}

  function apply(theme) {
    root.dataset.theme = theme;
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
    toggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    toggle.querySelector("use").setAttribute("href", theme === "dark" ? "#icon-sun" : "#icon-moon");
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#121019" : "#f6f7fb";
    document.dispatchEvent(new Event("themechange"));
  }

  apply(root.dataset.theme);
  toggle.addEventListener("click", () => {
    preference = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("skylens.theme", preference); } catch {}
    apply(preference);
  });
  system.addEventListener("change", event => {
    if (preference !== "light" && preference !== "dark") apply(event.matches ? "dark" : "light");
  });
  window.addEventListener("storage", event => {
    if (event.key !== "skylens.theme" && event.key !== null) return;
    preference = event.newValue;
    apply(preference === "light" || preference === "dark" ? preference : system.matches ? "dark" : "light");
  });
}
