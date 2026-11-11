// Default expand/collapse: a group starts expanded if it has at most `max` hosts (Settings).

/**
 * @param {{groups: Map<string, {hostIds: string[]}>}} model
 * @param {number} max
 * @param {Set<string>} [known] groups that already have a state (the user's choice is kept)
 * @returns {Set<string>} the new groups that start collapsed
 */
export function defaultCollapsed(model, max, known = new Set()) {
  const out = new Set();
  for (const [id, g] of model.groups) if (!known.has(id) && g.hostIds.length > max) out.add(id);
  return out;
}
