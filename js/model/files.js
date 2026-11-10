// File-name bookkeeping for a job.

/**
 * Names must be unique inside one batch (or session): two files called "netstat.txt" from different
 * folders get "netstat.txt (2)". Across separate loads the same name replaces the earlier file.
 * @param {string[]} names
 * @returns {string[]}
 */
export function uniqueFileNames(names) {
  const seen = new Map();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n} (${count})`;
  });
}
