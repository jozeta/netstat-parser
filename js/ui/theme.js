// Theme preference (a per-browser convenience): system, dark or light. "system" removes the key.
export const THEME_KEY = "netstat-parser.theme";
export const THEMES = ["system", "dark", "light"];

/** @param {Storage|null} storage */
export function readTheme(storage) {
  try {
    const v = storage?.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** @param {Storage|null} storage */
export function writeTheme(storage, theme) {
  try {
    if (theme === "system") storage?.removeItem(THEME_KEY);
    else if (THEMES.includes(theme)) storage?.setItem(THEME_KEY, theme);
  } catch { /* private mode: the choice lasts until reload */ }
}

/** Apply to <html data-theme>; Låda Glass and the graph tokens follow it. */
export function applyTheme(theme) {
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
