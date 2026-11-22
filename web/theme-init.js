(() => {
  let theme;
  try { theme = localStorage.getItem("skylens.theme"); } catch {}
  document.documentElement.dataset.theme = theme === "light" || theme === "dark"
    ? theme : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.querySelector('meta[name="theme-color"]').content =
    document.documentElement.dataset.theme === "dark" ? "#121019" : "#f6f7fb";
})();
