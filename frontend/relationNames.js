// relationNames — the pure half of "a link shows the record's NAME". No React, no fetch, so the
// tests can import it. The cache and the hook are in recordNames.js.

// What to show for a slug before (or without) the real title: `bellwether-trust` → `Bellwether
// Trust`. For most records this IS the title, so nothing visibly changes when the real one
// arrives — a link never flashes from an id to a name.
export function nameFromSlug(slug) {
  return String(slug ?? '').replace(/[-_]+/g, ' ').trim().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

// The records a picker offers for what has been typed: not the ones already linked, names that
// START with the text first, then names that contain it, then a match on the slug; alphabetical
// inside each band. `list` is [{ slug, title, path }].
export function rankRecords(list, text = '', exclude = []) {
  const needle = String(text).trim().toLowerCase();
  const skip = new Set(exclude.map(String));
  const pool = (list || []).filter(x => !skip.has(String(x.slug)));
  const byTitle = (a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' });
  if (!needle) return [...pool].sort(byTitle);
  const band = x => {
    const title = String(x.title).toLowerCase();
    if (title.startsWith(needle)) return 0;
    if (title.split(/\s+/).some(w => w.startsWith(needle))) return 1;
    if (title.includes(needle)) return 2;
    if (String(x.slug).toLowerCase().includes(needle)) return 3;
    return -1;
  };
  return pool.map(x => [band(x), x]).filter(([b]) => b >= 0).sort((a, b) => a[0] - b[0] || byTitle(a[1], b[1])).map(([, x]) => x);
}

// Is there already a record with exactly this name? Decides whether "Create …" is offered.
export const hasExactName = (list, text) => {
  const needle = String(text).trim().toLowerCase();
  return !!needle && (list || []).some(x => String(x.title).trim().toLowerCase() === needle);
};
