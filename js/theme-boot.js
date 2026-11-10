// Loaded synchronously in <head> so the saved theme applies before first paint (no flash).
// Kept tiny and dependency-free; the full logic lives in js/ui/theme.js.
(function () {
  try {
    var t = window.localStorage.getItem("netstat-parser.theme");
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  } catch { /* storage blocked: follow the system */ }
})();
