// Settings persistence (settings only — never job data). Storage may be missing or throw.
import { validateSettings } from "../model/settings.js";

export const SETTINGS_KEY = "netstat-parser.settings.v1";

/** @param {Storage|null} storage */
export function loadSettings(storage) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    return validateSettings(raw ? JSON.parse(raw) : null, { legacy: true });
  } catch {
    return validateSettings(null);
  }
}

/** @returns {boolean} saved */
export function saveSettings(storage, settings) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
