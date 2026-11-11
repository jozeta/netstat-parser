// Small decisions the UI asks about, kept pure so they are tested: DNS lookup buttons and what
// happens when files are loaded into a job that already has files.

/** The per-host "Resolve name" button. @returns {{disabled: boolean, warn: boolean}} */
export function resolveButton(settings) {
  return { disabled: !settings.dns.enabled, warn: !settings.dns.acknowledged };
}

/** Look up Internet addresses right after files are loaded? */
export function shouldAutoResolve(settings) {
  return settings.dns.enabled && settings.dns.acknowledged && settings.dns.auto;
}

/**
 * @param {number} loadedFiles files already in the job
 * @returns {"ask"|"merge"|"new"} merge also means "just load" when nothing is loaded yet
 */
export function loadChoice(settings, loadedFiles) {
  return loadedFiles > 0 ? settings.load.onMore : "merge";
}
