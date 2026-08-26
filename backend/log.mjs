// The event log — docs/08_MODULE_CONTRACTS.md §1.
//
// Append-only, one file per day at `<root>/log/<YYYY-MM-DD>.md`. EVERY mutation lands here, and
// this is what `GET /api/activity` and the inspector's HISTORY read. Law 8: nothing is hidden from
// a human who wants to look — so the line format is chosen to be read by a person with `grep`
// first and parsed by us second.
//
//   - 2026-08-19T09:04:12.331Z · scout-fb · store · data/guests/maria-santos.md · {"confidence":0}
//
// WHY THE APPEND IS A REAL APPEND. Every other write in this app is tmp+rename through
// `store.mjs writeMd`, because those are whole-document replacements and a torn write would make
// the document VANISH (readers swallow parse errors by design). A log is the one file where that
// reasoning inverts: a read-modify-rewrite of a growing day file puts the whole day at risk on
// every single event, and loses an event outright whenever two writers interleave. `O_APPEND` is
// atomic for a line-sized write, and the worst case is one torn last line — which the parser drops
// and the next append repairs (see `endsWithNewline`). The day file is still CREATED through
// `writeMd`, so it is a proper `.md` with frontmatter and can be opened in Obsidian like the rest.
//
// No control bytes anywhere in this file. `docs/decisions.md` records a raw NUL sentinel making
// `documents.mjs` invisible to grep — silently, exit 1 — and a LOG that grep cannot read would be
// the same bug in the one file whose entire job is being greppable.

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, readMd, writeMd } from './store.mjs';

// The vocabulary. A caller with a type outside this set is not refused — refusing to log is worse
// than logging something unexpected — but every module should be taking its type from here.
export const EVENT_TYPES = [
  'store', 'update', 'merge', 'skip', 'move', 'archive', 'refused',
  'quarantine', 'accept', 'propose', 'decide', 'cache', 'claim', 'inbox', 'schema',
  // `run` is the local-CLI door opening and closing: one event when an assistant is sent out and
  // one when it comes back, with what it actually wrote counted from the events in between.
  'run',
];

// One separator, three spaces of it, used nowhere inside a path. The JSON tail is re-joined on the
// same separator when parsing, so a `·` inside a reason string cannot break the line.
const SEP = ' · ';

const R = () => getStorageRoot();
export const logDir = () => path.join(R(), 'log');
export const logFileFor = (day) => path.join(logDir(), day + '.md');

const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

// A field that would break the line format breaks the log for everyone, so it is cleaned at the
// door rather than trusted: no newlines, no separator, never blank.
function oneLine(v, fallback) {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ').split(SEP).join(' / ').trim();
  return s || fallback;
}

// A previous process killed mid-append leaves a line without its newline. Detect it by reading the
// last byte rather than the whole file — a day file can be large and this runs on every event.
function endsWithNewline(file) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    if (!size) return true;
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } catch {
    return true;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already gone */ }
  }
}

// The day file is born through the store's atomic writer so it is a real .md with frontmatter;
// every event after that is an O_APPEND of one line.
function ensureDayFile(day) {
  const file = logFileFor(day);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(logDir(), { recursive: true });
  writeMd(file, { type: 'log', date: day }, [
    '# Activity · ' + day,
    '',
    'Append-only. One line per mutation, oldest first:',
    '`- <iso> ' + SEP.trim() + ' <actor> ' + SEP.trim() + ' <type> ' + SEP.trim() + ' <target> ' + SEP.trim() + ' <detail json>`',
    '',
  ].join('\n') + '\n');
  return file;
}

export function formatEvent(ev) {
  let detail = '{}';
  try { detail = JSON.stringify(ev.detail ?? {}); } catch { detail = '{"error":"detail not serialisable"}'; }
  return '- ' + [ev.ts, ev.actor, ev.type, ev.target, detail].join(SEP);
}

export function parseEvent(line) {
  if (!line.startsWith('- ')) return null;
  const parts = line.slice(2).split(SEP);
  if (parts.length < 5) return null;
  const [ts, actor, type, target] = parts;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(ts)) return null;
  let detail = {};
  try { detail = JSON.parse(parts.slice(4).join(SEP)) ?? {}; } catch { detail = {}; }
  return { ts, actor, type, target, detail };
}

export function logEvent({ type, actor, target, detail } = {}) {
  const ev = {
    ts: new Date().toISOString(),
    // `actor` is never blank (§1): an event nobody can be attributed to is worse than one
    // attributed to "unknown", because it reads as a bug in the log rather than in the caller.
    actor: oneLine(actor, 'unknown'),
    type: oneLine(type, 'store'),
    target: oneLine(target, '-'),
    detail: detail ?? {},
  };
  const file = ensureDayFile(dayOf(ev.ts));
  const prefix = endsWithNewline(file) ? '' : '\n';
  fs.appendFileSync(file, prefix + formatEvent(ev) + '\n');
  return ev;
}

function dayFiles() {
  try {
    return fs.readdirSync(logDir())
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse(); // newest day first
  } catch {
    return [];
  }
}

function eventsInDay(file) {
  let content;
  try { ({ content } = readMd(path.join(logDir(), file))); } catch { return []; }
  const out = [];
  for (const line of String(content).split('\n')) {
    const ev = parseEvent(line.trim());
    if (ev) out.push(ev);
  }
  return out;
}

// Newest first, across days. Filters are applied before the limit so `limit` always means
// "this many matching events", not "this many events, some of which match".
export function readEvents({ limit = 200, since = null, target = null, type = null } = {}) {
  const floor = since == null ? null : (typeof since === 'number' ? since : Date.parse(since));
  const wantTypes = type == null ? null : new Set([].concat(type).map(String));
  const out = [];
  for (const file of dayFiles()) {
    const day = file.slice(0, -3);
    if (floor != null && Date.parse(day + 'T23:59:59.999Z') < floor) break; // whole day predates `since`
    const events = eventsInDay(file);
    for (let i = events.length - 1; i >= 0; i--) { // within a file, newest is last
      const ev = events[i];
      if (floor != null && Date.parse(ev.ts) <= floor) continue;
      if (target != null && ev.target !== String(target)) continue;
      if (wantTypes && !wantTypes.has(ev.type)) continue;
      out.push(ev);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// HISTORY in the inspector (T05 §4): everything that ever happened to one file.
export function eventsFor(targetPath, limit = 50) {
  return readEvents({ limit, target: targetPath });
}
