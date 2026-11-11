// Graph questions over the observed connections. Pure (model in, ids out), so tested in Node.
// A connection's direction is the direction it was made: source (client) → target (server). If A
// connected to B, then from A you can reach B on that port; the reverse is not shown.

const RISKY = new Set(["vulnerable", "exploitable"]);

function adjacency(model, { directed, riskyOnly }) {
  const adj = new Map();
  const add = (from, to, e) => { if (!adj.has(from)) adj.set(from, []); adj.get(from).push([to, e.id]); };
  // sorted, so ties between equally short paths always resolve the same way
  const edges = [...model.edges.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of edges) {
    if (riskyOnly && !RISKY.has(e.risk)) continue;
    add(e.source, e.target, e);
    if (!directed) add(e.target, e.source, e);
  }
  return adj;
}

/**
 * Shortest path (fewest hops) from one host to another.
 * @param {{hosts: Map<string, object>, edges: Map<string, {id: string, source: string, target: string, risk: string}>}} model
 * @param {string} from host id
 * @param {string} to host id
 * @param {{directed?: boolean, riskyOnly?: boolean}} [opts] directed: follow connection direction
 *   (default); riskyOnly: only vulnerable/exploitable connections
 * @returns {{hosts: string[], edges: string[]}|null} null when there is no path
 */
export function findPath(model, from, to, { directed = true, riskyOnly = false } = {}) {
  if (!model.hosts.has(from) || !model.hosts.has(to)) return null;
  if (from === to) return { hosts: [from], edges: [] };
  const adj = adjacency(model, { directed, riskyOnly });
  const prev = new Map([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    for (const [next, edgeId] of adj.get(at) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, [at, edgeId]);
      if (next === to) {
        const hosts = [to], edges = [];
        for (let p = prev.get(to); p; p = prev.get(p[0])) { hosts.unshift(p[0]); edges.unshift(p[1]); }
        return { hosts, edges };
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Hosts within `hops` connections of the given hosts (either direction), and every connection
 * between two of those hosts.
 * @param {object} model
 * @param {string[]} ids host ids to start from
 * @param {number} hops 0 or more
 * @returns {{hosts: Set<string>, edges: Set<string>}}
 */
export function neighbourhood(model, ids, hops) {
  const adj = adjacency(model, { directed: false, riskyOnly: false });
  const hosts = new Set(ids.filter((id) => model.hosts.has(id)));
  let frontier = [...hosts];
  for (let d = 0; d < hops && frontier.length; d++) {
    const next = [];
    for (const id of frontier) for (const [n] of adj.get(id) ?? []) if (!hosts.has(n)) { hosts.add(n); next.push(n); }
    frontier = next;
  }
  const edges = new Set();
  for (const e of model.edges.values()) if (hosts.has(e.source) && hosts.has(e.target)) edges.add(e.id);
  return { hosts, edges };
}
