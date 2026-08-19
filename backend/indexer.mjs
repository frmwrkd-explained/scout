// Derived index, integrity report, and revision-based push (Phase 4).
//
// The markdown folder is the source of truth; this module adds three things on top of it:
//   1. A monotonically-increasing application revision, bumped on every change (app mutation OR
//      external agent edit), pushed to clients over SSE so they can drop the old 2s blind poll.
//   2. An integrity report: one malformed .md file must never break /api/state — bad files are
//      quarantined and listed here instead.
//   3. A reconciler: fs.watch is fast but lossy (rule #12), so a periodic full fingerprint sweep is
//      the safety net that guarantees external edits are eventually noticed even if a watch event
//      was dropped.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd } from './store.mjs';

// ── revision + change log ──
let revision = 1;
const changeLog = []; // [{ rev, domains:[], ts }] — ring buffer for since-delta
const LOG_MAX = 1000;
const subscribers = new Set();

export function currentRevision() { return revision; }

// Bump the revision for one or more domains and push {rev, domains} to every SSE subscriber.
// The SSE payload is intentionally tiny — the client fetches the actual data itself.
export function bump(domains) {
  const list = (Array.isArray(domains) ? domains : [domains]).filter(Boolean);
  if (!list.length) list.push('misc');
  revision += 1;
  changeLog.push({ rev: revision, domains: list, ts: Date.now() });
  if (changeLog.length > LOG_MAX) changeLog.shift();
  const payload = 'event: revision\ndata: ' + JSON.stringify({ rev: revision, domains: list }) + '\n\n';
  for (const res of subscribers) { try { res.write(payload); } catch { subscribers.delete(res); } }
  return revision;
}

// Domains changed strictly after `since`. [] = already current; null = gap too large, full refetch.
export function changedSince(since) {
  const s = Number(since);
  if (!s || s < 1) return null;
  // The client is AHEAD of us, which means we restarted (revision resets to 1 on boot) — its whole
  // snapshot predates this process and every id in it may be gone. `s >= revision` used to fold this
  // into "already current", so such a client would be told "nothing changed" forever and would never
  // refetch. Force a full rebuild instead. (Harmless while nothing called this route; a live trap the
  // moment anything did.)
  if (s > revision) return null;
  if (s === revision) return [];
  const oldest = changeLog.length ? changeLog[0].rev : revision;
  if (s < oldest - 1) return null;
  const set = new Set();
  for (const e of changeLog) if (e.rev > s) e.domains.forEach(d => set.add(d));
  return [...set];
}

export function subscribe(res) {
  subscribers.add(res);
  res.on('close', () => subscribers.delete(res));
  return () => subscribers.delete(res);
}
export function subscriberCount() { return subscribers.size; }

// ── integrity scan ──
const SKIP_DIRS = new Set(['.trash', '.git', 'node_modules']);
function walkMd(dir, acc, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    // Skip ALL dotfiles, not just the named SKIP_DIRS. The old first line tested startsWith('.')
    // and then only re-checked SKIP_DIRS, so it was a no-op: hidden entries fell through. On an
    // exFAT volume macOS writes a `._X` AppleDouble beside almost every file X, so `._*.md`
    // sidecars were being counted by integrityReport() and — worse — folded into fingerprint(),
    // whose mtimes then flipped on every Finder touch and pushed a spurious bump(['external'])
    // to every SSE client, making them all refetch /api/state for nothing.
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc, depth + 1);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
}

// Scan every .md record; return the ones gray-matter can't parse. lastKnownGood points at a .bak
// sibling when one exists (writeSkillFile / replaceShots leave these), so recovery is possible.
export function integrityReport() {
  const root = getStorageRoot();
  const files = [];
  walkMd(root, files);
  const malformed = [];
  let okCount = 0;
  for (const f of files) {
    try { readMd(f); okCount++; }
    catch (e) {
      const bak = f + '.bak';
      malformed.push({
        path: f, relativePath: path.relative(root, f),
        error: String(e.message || e).slice(0, 200),
        lastKnownGood: fs.existsSync(bak) ? path.relative(root, bak) : null
      });
    }
  }
  return { scanned: files.length, okCount, malformed, revision };
}

// ── reconciler + watch ──
let lastFingerprint = null;
let watchTimer = null;
let watcher = null;

// Cheap fingerprint of the record tree: count + summed mtime/size. Changes when anything is added,
// removed, or rewritten. Used by the periodic sweep to catch watch events that were dropped.
function fingerprint() {
  const root = getStorageRoot();
  const files = [];
  walkMd(root, files);
  let h = files.length;
  for (const f of files) {
    try { const st = fs.statSync(f); h = (h * 31 + Math.floor(st.mtimeMs) + st.size) >>> 0; } catch { /* vanished */ }
  }
  return String(h) + ':' + files.length;
}

// Full reconcile — if the tree changed since last time, bump 'external' so clients refetch.
export function reconcile() {
  const fp = fingerprint();
  if (lastFingerprint !== null && fp !== lastFingerprint) bump(['external']);
  lastFingerprint = fp;
  return fp;
}

// Start watching the storage root. fs.watch (recursive where supported) gives low-latency updates;
// the interval sweep is the correctness backstop for dropped/coalesced events (rule #12).
export function startWatch(intervalMs = 30000) {
  lastFingerprint = fingerprint();
  const root = getStorageRoot();
  const debounced = () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => reconcile(), 400);
  };
  try {
    watcher = fs.watch(root, { recursive: true }, (_ev, file) => {
      if (file && (String(file).startsWith('.trash') || String(file).includes('node_modules'))) return;
      debounced();
    });
    watcher.on('error', () => { /* keep the interval sweep as the safety net */ });
  } catch { /* recursive watch unsupported — the interval sweep still covers correctness */ }
  const timer = setInterval(() => reconcile(), intervalMs);
  timer.unref?.();
  return () => { try { watcher?.close(); } catch { /* */ } clearInterval(timer); };
}
