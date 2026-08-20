// Door 2 — the `_inbox/` watcher.
//
// `docs/04_AGENT_CONTRACT.md` §1: three doors, one pipeline. HTTP is for agents Scout spawns
// locally, MCP is for hosts that speak it, and this is for everything else — an agent inside
// Devin or Buzz or a person dragging a file in by hand. All three call the SAME `upsertRecord`.
//
// The border, stated once: **`_inbox/` is untrusted input, `data/` is the store, and this watcher
// is the border between them.** Nothing here writes a document file; it parses, normalises, and
// calls `records.mjs`, which is the only writer in the app. A second write path here would bypass
// dedupe, provenance and the gate all at once and nobody would notice for weeks.
//
// A dropped file is a PROPOSAL IN FILE FORM. It succeeds and moves to `_done/<date>/`, or it
// fails and moves to `_failed/` **with the reason written into its own frontmatter** — because
// the thing that dropped it is an agent, and an agent that cannot read why it failed will drop
// the same broken file again tomorrow.

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getStorageRoot, readMd, safe } from './store.mjs';
import { listCollections, getCollection, AUTO_FIELDS } from './collections.mjs';
import { documentsFor } from './documents.mjs';

const R = () => getStorageRoot();
export const inboxDir = () => path.join(R(), '_inbox');
const doneDir = d => path.join(inboxDir(), '_done', d);
const failedDir = () => path.join(inboxDir(), '_failed');
const knownFile = () => path.join(R(), '_known.md');
const indexFile = () => path.join(R(), '_index.md');

const today = () => new Date().toISOString().slice(0, 10);

// Same tmp+rename discipline as store.mjs `writeMd`. These two files are regenerated constantly
// and are read by agents mid-write; a torn read of `_known.md` is a duplicate contact.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ── normalising a loose drop onto a schema ──────────────────────────────────────────────────
//
// T07 step 2: unknown keys go to `extra` RATHER THAN BEING DROPPED. An agent that wrote
// `instagram_url` when the schema says `source` has still told us something true, and silently
// discarding it is how the pipeline starts lying about what the agent actually found.
export function normalise(data, collection) {
  const declared = new Set((collection?.fields || []).map(f => f.key));
  const known = { collection: collection?.id };
  const extra = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (k === 'collection') continue;
    if (declared.has(k) || AUTO_FIELDS.includes(k)) known[k] = v;
    else extra[k] = v;
  }
  if (Object.keys(extra).length) known.extra = extra;
  return known;
}

// Which collection is this drop for? Explicit `collection:` wins. Otherwise infer from the
// declared tags — an agent working from `references/folder-mode.md` writes `tags: [guest]` and
// nothing else, and refusing that would make folder mode harder than it needs to be.
export function inferCollection(data) {
  if (data && data.collection) return getCollection(String(data.collection));
  const tags = [].concat(data?.tags ?? []).map(String);
  for (const c of listCollections()) {
    const tag = c?.query?.tag;
    if (tag && tags.includes(String(tag))) return c;
  }
  return null;
}

// ── one file ────────────────────────────────────────────────────────────────────────────────
export async function processInboxFile(absPath, { actor = null } = {}) {
  const base = path.basename(absPath);
  let data, content;
  try {
    ({ data, content } = readMd(absPath));
  } catch (e) {
    return fail(absPath, 'This file is not valid markdown with YAML frontmatter: ' + e.message);
  }

  const collection = inferCollection(data);
  if (!collection) {
    const ids = listCollections().map(c => c.id).join(', ') || '(none yet)';
    return fail(absPath, 'No collection. Add `collection: <id>` to the frontmatter, or a tag that '
      + 'one of these collections queries: ' + ids);
  }

  // The dropper's own claim about who it is. `_inbox/` is untrusted, so this is a claim and not
  // an identity — but it is the claim the gate is evaluated against, and an agent that lies about
  // being the human still cannot promote, because provenance is stamped by records.mjs, not here.
  const who = actor || data.created_by || data.updated_by || data.actor || 'inbox';

  let upsertRecord;
  try {
    ({ upsertRecord } = await import('./records.mjs'));
  } catch (e) {
    return fail(absPath, 'The write pipeline is unavailable: ' + e.message);
  }

  const input = { ...normalise(data, collection), body: content };
  let result;
  try {
    result = upsertRecord(input, { actor: who, via: 'inbox' });
  } catch (e) {
    return fail(absPath, e.message);
  }

  const dir = doneDir(today());
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(absPath, uniquePath(path.join(dir, base)));
  return { ok: true, file: base, ...result };
}

// The reason goes INTO the file, at the top of its frontmatter, so the agent that dropped it
// reads the failure the same way it reads everything else — by opening the file.
function fail(absPath, reason) {
  const base = path.basename(absPath);
  let data = {}, content = '';
  try { ({ data, content } = readMd(absPath)); }
  catch { content = safeRead(absPath); }
  fs.mkdirSync(failedDir(), { recursive: true });
  const target = uniquePath(path.join(failedDir(), base));
  const body = matter.stringify({ content }, {
    scout_failed: reason,
    scout_failed_at: new Date().toISOString(),
    ...data,
  });
  writeAtomic(target, body);
  try { fs.unlinkSync(absPath); } catch { /* already gone */ }
  return { ok: false, file: base, reason, moved: path.relative(R(), target) };
}

function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), stem = p.slice(0, -ext.length || undefined);
  for (let i = 2; i < 999; i++) { const c = stem + '-' + i + ext; if (!fs.existsSync(c)) return c; }
  return stem + '-' + Date.now() + ext;
}

// ── a pass over the folder ──────────────────────────────────────────────────────────────────
export async function sweepInbox(opts = {}) {
  const dir = inboxDir();
  ensureInbox();
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('._') && e.name !== 'README.md')
      .map(e => e.name);
  } catch { return { processed: [], failed: [] }; }

  const processed = [], failed = [];
  for (const n of names) {
    const r = await processInboxFile(path.join(dir, n), opts);
    (r.ok ? processed : failed).push(r);
  }
  // Written before returning, never after: the caller's next move is to grep `_known.md`.
  if (processed.length) refreshAgentFiles({ now: !!opts.flush || opts.flush === undefined });
  return { processed, failed };
}

// ── the watcher ─────────────────────────────────────────────────────────────────────────────
let watcher = null, pending = null;

export function startInboxWatch({ debounceMs = 400 } = {}) {
  if (watcher) return watcher;                 // safe to call twice
  ensureInbox();
  try {
    watcher = fs.watch(inboxDir(), { persistent: false }, () => {
      clearTimeout(pending);
      pending = setTimeout(() => { sweepInbox().catch(() => {}); }, debounceMs);
    });
  } catch { watcher = null; }
  return watcher;
}

export function stopInboxWatch() {
  clearTimeout(pending);
  if (watcher) { try { watcher.close(); } catch { /* already closed */ } }
  watcher = null;
}

// ── the two files a folder-mode agent actually reads ────────────────────────────────────────
//
// These are how an agent with no network dedupes and orients. `_known.md` is deliberately flat
// and greppable — `grep mariacooks _known.md` has to answer "do we already have her?" in one
// command, with no parser, from inside any sandbox.
export function writeKnown() {
  const lines = ['# Known records', '',
    'Flat and greppable, on purpose. One line per record: `id · name · handle · status`.',
    'Regenerated on every store change. Grep this before you add anyone.', ''];
  let n = 0;
  for (const c of listCollections()) {
    let rows = [];
    try { rows = documentsFor(c.id)?.documents || []; } catch { rows = []; }
    if (!rows.length) continue;
    lines.push('## ' + c.id);
    for (const r of rows) {
      const f = r.fields || {};
      lines.push([r.slug, f.name || r.title || r.slug, f.handle || '—', f.status || '—'].join(' · '));
      n++;
    }
    lines.push('');
  }
  if (!n) lines.push('_Nothing stored yet._', '');
  writeAtomic(knownFile(), lines.join('\n'));
  return n;
}

export function writeIndexFile() {
  const lines = ['# Index', '',
    'What exists in this workspace, and where. Regenerated on every store change.', ''];
  for (const c of listCollections()) {
    let total = 0;
    try { total = (documentsFor(c.id)?.documents || []).length; } catch { total = 0; }
    lines.push('- **#' + c.id + '** — ' + (c.label || c.id) + ' · ' + total + ' records · '
      + (c.query?.path || 'query') + ' · fields: ' + (c.fields || []).map(f => f.key).join(', '));
  }
  lines.push('', '## Where things live', '',
    '- `data/<collection>/<slug>.md` — the records', '- `me.md` — who you work for',
    '- `goals/` `territory/` `playbook/` `learnings/` — memory', '- `assistants/` — the team',
    '- `projects/<id>/tasks/` — the queue', '- `_inbox/` — drop new findings here',
    '- `.scout/cache/context.md` — read this first, it is your whole wake-up', '');
  writeAtomic(indexFile(), lines.join('\n'));
  return true;
}

// Debounced, because a batch of 50 records must not regenerate these 50 times.
let refreshTimer = null;
export function refreshAgentFiles({ debounceMs = 500, now = false } = {}) {
  // `now` is not an optimisation, it is a correctness fix. An explicit sweep (the route, a test,
  // the demonstration) answers the caller the moment it returns, and the very next thing a caller
  // does is read `_known.md` — which the debounce had not written yet. The result was a route
  // that reported success over a file that did not exist. The watcher still debounces, because a
  // batch of fifty drops must not regenerate these fifty times.
  clearTimeout(refreshTimer);
  if (now) {
    try { writeKnown(); writeIndexFile(); } catch { /* derived files; never fatal */ }
    return;
  }
  refreshTimer = setTimeout(() => {
    try { writeKnown(); writeIndexFile(); } catch { /* derived files; never fatal */ }
  }, debounceMs);
  if (refreshTimer.unref) refreshTimer.unref();
}

// ── the drop instructions, sitting where they are needed ─────────────────────────────────────
const README = `# Drop findings here

This folder is **door 2**. A \`.md\` file dropped here is a proposal — it is parsed, deduped
against everything already stored, and either written into \`data/\` or moved to \`_failed/\`
with the reason written into the file.

You do not need the app running or a network connection to use this.

## The shape

\`\`\`markdown
---
collection: guest          # which collection this belongs to (required)
name: Maria Santos         # the primary field (required)
handle: "@mariacooks"      # used for dedupe — always include it if you have it
platform: instagram
found_in: nurses-ph        # REQUIRED on a finding. Territory scores are computed from it;
                           # omit it and the app cannot learn where your good finds come from.
source: https://...        # the URL you actually saw
score: 9
found: 2026-08-19
---

One paragraph, in plain language, saying why this person is worth her time.
\`\`\`

## Rules

- **Dedupe before you drop.** \`grep <handle> ../_known.md\` — if it is already there, do not
  drop it again. The pipeline will skip it, but you will have wasted the pass.
- **Unknown keys are kept**, not dropped — they land under \`extra\`. Use the schema's keys where
  you can, and do not invent a key when one already fits.
- **You may not promote past \`shortlist\`.** A stage beyond it is ignored on read and shows up
  in Activity as a refusal.
- **One file per record.** Never a list file.

## What happens to your file

- Accepted → \`_done/<date>/\`
- Rejected → \`_failed/\`, with \`scout_failed:\` at the top of its frontmatter saying why.
`;

export function ensureInbox() {
  const dir = inboxDir();
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) writeAtomic(readme, README);
  return dir;
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────
export function registerInboxRoutes(app) {
  app.get('/api/inbox', (_req, res) => {
    ensureInbox();
    const ls = d => { try { return fs.readdirSync(d).filter(n => n.endsWith('.md') && !n.startsWith('._')); } catch { return []; } };
    res.json({
      dir: inboxDir(),
      waiting: ls(inboxDir()).filter(n => n !== 'README.md'),
      failed: ls(failedDir()),
      watching: !!watcher,
    });
  });

  app.post('/api/inbox/sweep', async (req, res) => {
    try { res.json(await sweepInbox({ actor: req.body?.actor })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/inbox/refresh', (_req, res) => {
    try { res.json({ known: writeKnown(), index: writeIndexFile() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
}
