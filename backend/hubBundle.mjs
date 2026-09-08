// The hub link, read side — configuration and the BUNDLE Scout reads on wake.
//
// Why this is a separate module from `hub.mjs`: `memory.mjs` needs the bundle to prefix the hot
// cache, and `hub.mjs` needs `memory.mjs` to build the push payload. Importing one from the other
// closes a load-time cycle whose TDZ is import-order dependent — the same trap territory.mjs hit
// (see memory.mjs `ensureWired`). So everything memory.mjs needs lives HERE, and this file imports
// nothing but `store.mjs`. `hub.mjs` re-exports it, so a script or a test still has one door.
//
// Two rules that do not bend:
//   1. Scout NEVER writes into `hubFolder`. It is Theo's mirror, read-only to us, and a write into
//      it would make Scout a second author of records the hub owns.
//   2. `renderCache` is synchronous (memory.mjs), so the bundle read must be too. The mirror folder
//      is a plain file read. When only a URL+token are configured, `fetchHubBundle()` (hub.mjs,
//      async) writes a copy under `.scout/hub/` — Scout's own disposable cache, Law 1 — and this
//      reads that. A network round trip cannot happen inside a cache render.
import fs from 'fs';
import path from 'path';
import { getSettings, getStorageRoot } from './store.mjs';

// The bundle's own sections, in the order §8.1 of the hub handover fixes them, and the order in
// which Scout drops them when the 2,000-token cap is exceeded: bottom up.
// Nothing here is a heading Scout writes — these are patterns against a document the HUB rendered,
// so they are matched loosely on purpose. A section Scout cannot classify is never dropped.
export const HUB_DROP_ORDER = [
  { name: 'recent changes', test: /recent|change/i },
  { name: 'open items', test: /open|issue|proposal/i },
  { name: 'SOP index', test: /\bsops?\b/i },
];

// Scout's own cached copy of a fetched bundle. Under `.scout/`, which is disposable by Law 1 —
// never under `hubFolder`, which is not ours to write.
export const hubCachePath = () => path.join(getStorageRoot(), '.scout', 'hub', 'bundle.md');

// `person: person/crystal` → `crystal`. The mirror names its file by the slug, not the full id.
export function personSlug(person) {
  const s = String(person || '').trim();
  if (!s) return '';
  return s.split('/').filter(Boolean).pop() || '';
}

// One answer to "is a hub configured, and how". `settings.md` first — it is the source of truth
// the app and the person both edit — with the env vars as the fallback a CI job or a one-off
// `HUB_URL=… npm run hub:push` uses.
export function hubConfig(env = process.env) {
  const s = (() => { try { return getSettings(); } catch { return {}; } })();
  const url = String(s.hubUrl || env.HUB_URL || '').trim().replace(/\/+$/, '');
  const token = String(s.hubToken || env.HUB_TOKEN || '').trim();
  const folder = String(s.hubFolder || env.HUB_FOLDER || '').trim();
  return {
    url, token, folder,
    // What each half enables. They are genuinely independent: a mirror alone gives the bundle with
    // no network at all, and a URL+token alone gives both halves.
    canPush: Boolean(url && token),
    canFetch: Boolean(url && token),
    hasMirror: Boolean(folder),
    configured: Boolean((url && token) || folder),
    pushAfterRun: s.hubPushAfterRun === true,
  };
}

// The file the mirror daemon writes for one person: `<hubFolder>/.opsgraph/bundle-<slug>.md`.
export function mirrorBundlePath(folder, person) {
  const slug = personSlug(person);
  if (!folder || !slug) return null;
  return path.join(folder, '.opsgraph', 'bundle-' + slug + '.md');
}

// SYNCHRONOUS, and it must stay that way — `renderCache` calls it.
// Mirror first (it is the freshest thing on Theo's machine and costs no network), then the copy
// `fetchHubBundle` left behind. Missing, unreadable or empty → null, and the cache renders exactly
// as it did before the hub existed. A hub that is down must never cost the agent its own memory.
export function readHubBundle({ person = null, config = null } = {}) {
  const cfg = config || hubConfig();
  const mirror = mirrorBundlePath(cfg.folder, person);
  if (mirror) {
    try {
      const text = fs.readFileSync(mirror, 'utf8').trim();
      if (text) return { text, source: 'mirror', path: mirror };
    } catch { /* no mirror for this person — fall through to the fetched copy */ }
  }
  if (cfg.canFetch) {
    try {
      const text = fs.readFileSync(hubCachePath(), 'utf8').trim();
      if (text) return { text, source: 'fetched', path: hubCachePath() };
    } catch { /* never fetched, or `.scout/` was thrown away */ }
  }
  return null;
}

// Where `fetchHubBundle` puts what it got. tmp + rename like every other write in this app.
export function writeHubCache(text) {
  const file = hubCachePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, String(text || '').trim() + '\n');
  fs.renameSync(tmp, file);
  return file;
}

// Split a hub bundle into its sections so the trimmer can drop whole ones by name. A section is a
// heading line and everything under it; anything before the first heading is the preamble and is
// never droppable (it is who the subject is).
export function splitHubSections(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let cur = { heading: null, name: null, lines: [] };
  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line)) {
      out.push(cur);
      const heading = line.replace(/^#{1,6}\s+/, '').trim();
      const match = HUB_DROP_ORDER.find(d => d.test.test(heading));
      cur = { heading, name: match ? match.name : null, lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  out.push(cur);
  return out.filter(s => s.heading != null || s.lines.join('').trim());
}

// Render the hub bundle at a trim level, and NAME what the level dropped.
// `level` 0 keeps everything; each level above drops exactly one section, bottom up, in
// HUB_DROP_ORDER. The bundle's own headings are demoted to `###` because `## ` is the hot cache's
// grammar (docs/08 §5 fixes the eleven `##` sections) — a hub heading at that level would read as
// a Scout section to every consumer that parses the file, including the tests.
export function composeHub(text, level = 0) {
  if (!text) return { lines: [], dropped: [] };
  const sections = splitHubSections(text);
  const dropNames = HUB_DROP_ORDER.slice(0, Math.max(0, level)).map(d => d.name);
  const hit = new Set();
  const kept = [];
  for (const s of sections) {
    if (s.name && dropNames.includes(s.name)) { hit.add(s.name); continue; }
    kept.push(...s.lines);
  }
  // Named in DROP ORDER, not in the order the sections happened to appear in the document: the
  // list is a record of how far down the ladder this render had to go, and a document that puts
  // its changes above its SOPs must not make that read as a different ladder.
  const dropped = dropNames.filter(n => hit.has(n));
  const body = kept.join('\n').replace(/^#{1,6}[ \t]+/gm, '### ').trim();
  const lines = ['# Hub'];
  if (body) lines.push(body);
  return {
    lines,
    dropped: dropped.map(n => 'hub bundle: ' + n),
  };
}

// How many trim levels the hub half has. memory.mjs walks 0..HUB_TRIM_LEVELS before it starts
// compressing anything of Scout's own.
export const HUB_TRIM_LEVELS = HUB_DROP_ORDER.length;
