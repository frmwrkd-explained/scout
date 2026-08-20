// Structured search (Phase 9). GET /api/search?q=<query> parses `key:value` filters + free text and
// scans the markdown records, returning results that each carry an exact LOCATION object so the
// client can open the precise entity. Secrets (settings/API keys) are NEVER searched or returned.
// NB: settings.md (API keys, secrets) is deliberately NOT imported or scanned here (Phase 9 rule).
import { listProjects, listItems } from './store.mjs';
import { listAssets } from './library.mjs';
import { allDocuments, collectionsOf, firstParagraph } from './documents.mjs';
import { isQuarantined } from './records.mjs';

// ── query parsing ──
// Recognized filter keys and their short aliases. Values compare loosely; rating: supports >=,<=,>,<.
const ALIASES = { p: 'project', t: 'type' };
export function parseQuery(q) {
  const filters = {};
  const terms = [];
  const tokens = String(q || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  for (const tok of tokens) {
    const m = /^([a-zA-Z]+):(.*)$/.exec(tok);
    if (m) {
      const key = ALIASES[m[1].toLowerCase()] || m[1].toLowerCase();
      const val = m[2].replace(/^"|"$/g, '');
      if (key === 'has') (filters.has = filters.has || []).push(val.toLowerCase());
      else filters[key] = val;
    } else {
      terms.push(tok.replace(/^"|"$/g, '').toLowerCase());
    }
  }
  return { filters, terms, text: terms.join(' ') };
}

function ratingMatch(spec, value) {
  const m = /^(>=|<=|>|<|=)?\s*(\d+)$/.exec(String(spec).trim());
  if (!m) return false;
  const op = m[1] || '='; const n = Number(m[2]); const v = Number(value || 0);
  return op === '>=' ? v >= n : op === '<=' ? v <= n : op === '>' ? v > n : op === '<' ? v < n : v === n;
}
function dateMs(s) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }

// ── record collection → normalized searchable rows ──
// Each row: { type, id, pid, title, sub, haystack, fields, location }. `haystack` is the lowercased
// text matched by free terms; `fields` powers typed filters.

// ── Scout's own records and memory ─────────────────────────────────────────────────────────────
//
// This module was inherited from FrameForge, where it indexed projects, triage items and library
// assets — and nothing else. Meanwhile `GET /api/index` advertises the route to every agent as
// *"find records. Never list data/ in bulk"*, so an agent that followed the Index searched for a
// guest, got nothing, and had exactly one way left to find her: read `data/` in bulk. That is Law
// 7 broken by an over-promise, which is worse than a missing capability — a missing one is
// obvious, a lying one costs a whole run.
//
// So: every markdown document under the storage root is searchable, with the fields that make a
// TYPED filter work (`collection:guest status:shortlist`, `type:territory`, `tag:manila`).
// Quarantined records are indexed but MARKED, not hidden: search is how a human finds the thing
// somebody wrote around the pipeline (Law 8), and the marker is how they know what they found.
const MEMORY_TYPES = new Set(['territory', 'playbook', 'learning', 'goal', 'assistant', 'identity', 'proposal', 'task']);

function scoutRows() {
  const out = [];
  for (const doc of allDocuments()) {
    const d = doc.data || {};
    // `.scout/` is cache and schema, not content the person is looking for.
    if (doc.path.startsWith('.scout/') || doc.path.startsWith('_inbox/')) continue;

    // collectionsOf() returns IDS, not schema objects. Mapping `.id` over strings gave a list
    // of undefined, so `collection:guest` matched nothing while every other filter worked.
    const inCollections = collectionsOf(doc);
    const kind = String(d.type || '') || (inCollections.length ? 'record' : 'note');
    const title = String(d.name || d.label || d.title || d.claim || doc.slug);
    const tags = [].concat(d.tags ?? []).map(String);
    // The one predicate, not the cached flag — search is how a human finds the thing somebody
    // wrote around the pipeline, and it must be marked the moment it lands, not at next boot.
    const held = isQuarantined(d, doc.path);

    // Only the values a person would search by. Frontmatter can hold anything, and stringifying
    // all of it turns every query into a match on somebody's ISO timestamp.
    const searchable = [
      title, d.handle, d.claim, d.job, d.summary, d.why, d.rules, d.url, d.source,
      d.status, d.access, d.kind, tags.join(' '), doc.slug, doc.path,
      firstParagraph(doc.content),
    ].filter(Boolean).join(' ').toLowerCase();

    out.push({
      type: MEMORY_TYPES.has(kind) ? kind : 'record',
      id: doc.slug,
      pid: null,
      title,
      sub: inCollections.length ? '#' + inCollections.join(' #') : (kind === 'record' ? doc.path : kind),
      haystack: searchable,
      fields: {
        type: MEMORY_TYPES.has(kind) ? kind : 'record',
        collection: inCollections[0] || '',
        status: d.status || d.access || '',
        tag: tags,
        created: d.created ? Date.parse(d.created) || null : null,
        quarantined: held ? 'true' : 'false',
        has: [d.handle && 'handle', d.source && 'source', d.evidence && 'evidence'].filter(Boolean),
      },
      // Everything in Scout is addressed by its path — the document surface takes exactly this.
      location: { page: 'document', path: doc.path, collection: inCollections[0] || null },
      ...(held ? { quarantined: true } : {}),
    });
  }
  return out;
}

function rows() {
  // Scout's records FIRST, so a tie on score resolves toward the thing this app is actually about.
  const out = scoutRows();
  const projects = listProjects();
  const projName = pid => (projects.find(p => p.id === pid) || {}).name || pid;

  for (const p of projects) {
    out.push({
      type: 'project', id: p.id, pid: p.id, title: p.name, sub: p.sub || '',
      haystack: [p.name, p.sub, p.brief].filter(Boolean).join(' ').toLowerCase(),
      fields: { project: p.id, type: 'project' },
      location: { page: 'project', projectId: p.id, tab: 'references' }
    });
  }

  for (const it of listItems()) {
    const has = [];
    if (it.note) has.push('note');
    if (it.fb) has.push('feedback');
    out.push({
      type: 'item', id: it.id, pid: it.proj, title: it.name || it.id, sub: projName(it.proj),
      haystack: [it.name, it.label, it.prompt, it.note, it.log].filter(Boolean).join(' ').toLowerCase(),
      fields: { project: it.proj, type: it.type, status: it.st, review: it.st, rating: it.rating || 0, final: it.fin ? 'true' : 'false', has, kind: it.type },
      location: { page: 'item', projectId: it.proj, entity: { type: 'item', id: it.id } }
    });
  }

  const scopes = ['library', ...projects.map(p => p.id)];
  for (const scope of scopes) {
    const { items } = listAssets(scope);
    for (const a of items) {
      const meta = a.meta || {};
      out.push({
        type: 'asset', id: (a.folder ? a.folder + '/' : '') + a.name, pid: scope === 'library' ? null : scope,
        title: a.name, sub: scope === 'library' ? 'library' : projName(scope),
        haystack: [a.name, meta.description, (meta.tags || []).join(' '), meta.mood, meta.kind].filter(Boolean).join(' ').toLowerCase(),
        fields: { project: scope === 'library' ? '' : scope, type: 'asset', kind: meta.kind || '', tag: (meta.tags || []).map(String) },
        location: { page: scope === 'library' ? 'library' : 'project', projectId: scope === 'library' ? null : scope, tab: scope === 'library' ? null : 'assets', entity: { type: 'asset', scope, folder: a.folder || '', name: a.name } }
      });
    }
  }

  return out;
}

function matchFilters(row, filters) {
  const f = row.fields;
  for (const [key, val] of Object.entries(filters)) {
    if (key === 'has') continue;
    const fv = f[key];
    if (key === 'rating') { if (!ratingMatch(val, fv)) return false; continue; }
    if (key === 'before') { const t = row.fields.created; const d = dateMs(val); if (!d || !t || t >= d) return false; continue; }
    if (key === 'after') { const t = row.fields.created; const d = dateMs(val); if (!d || !t || t <= d) return false; continue; }
    if (key === 'tag') { const tags = Array.isArray(fv) ? fv : (fv ? [fv] : []); if (!tags.some(t => String(t).toLowerCase() === String(val).toLowerCase())) return false; continue; }
    if (fv === undefined) return false;
    if (String(fv).toLowerCase() !== String(val).toLowerCase()) return false;
  }
  if (filters.has) {
    const rowHas = f.has || [];
    for (const h of filters.has) if (!rowHas.includes(h)) return false;
  }
  return true;
}

export function search(q, { cursor = 0, limit = 60 } = {}) {
  const { filters, terms } = parseQuery(q);
  const all = rows();
  const matched = [];
  for (const row of all) {
    if (!matchFilters(row, filters)) continue;
    if (terms.length && !terms.every(t => row.haystack.includes(t))) continue;
    // score: exact title hits rank above body hits; shorter titles win ties
    let score = 0;
    for (const t of terms) { if (row.title.toLowerCase().includes(t)) score += 3; if (row.haystack.includes(t)) score += 1; }
    if (Object.keys(filters).length) score += 2;
    matched.push({ ...row, score });
  }
  matched.sort((a, b) => (b.score - a.score) || (a.title.length - b.title.length));
  const start = Number(cursor) || 0;
  const page = matched.slice(start, start + limit).map(({ haystack, fields, score, ...r }) => r);
  return { total: matched.length, cursor: start, nextCursor: start + limit < matched.length ? start + limit : null, results: page };
}
