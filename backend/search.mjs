// Structured search (Phase 9). GET /api/search?q=<query> parses `key:value` filters + free text and
// scans the markdown records, returning results that each carry an exact LOCATION object so the
// client can open the precise entity. Secrets (settings/API keys) are NEVER searched or returned.
// NB: settings.md (API keys, secrets) is deliberately NOT imported or scanned here (Phase 9 rule).
import { listProjects, listItems } from './store.mjs';
import { listAllShots, getStory } from './story.mjs';
import { listAssets } from './library.mjs';
import { listGenerations } from './generate.mjs';

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
function rows() {
  const out = [];
  const projects = listProjects();
  const projName = pid => (projects.find(p => p.id === pid) || {}).name || pid;

  for (const p of projects) {
    out.push({
      type: 'project', id: p.id, pid: p.id, title: p.name, sub: p.sub || '',
      haystack: [p.name, p.sub, p.brief].filter(Boolean).join(' ').toLowerCase(),
      fields: { project: p.id, type: 'project' },
      location: { page: 'project', projectId: p.id, tab: 'references' }
    });
    // story body is searchable text under the project
    const story = getStory(p.id);
    if (story.content) out.push({
      type: 'story', id: p.id, pid: p.id, title: p.name + ' — story', sub: 'story',
      haystack: story.content.toLowerCase(), fields: { project: p.id, type: 'story' },
      location: { page: 'project', projectId: p.id, tab: 'story' }
    });
  }

  for (const s of listAllShots()) {
    out.push({
      type: 'shot', id: s.id, pid: s.proj, title: s.id + ' · ' + (s.title || ''), sub: projName(s.proj),
      haystack: [s.id, s.title, s.desc, s.prompt, s.videoPrompt, (s.tags || []).join(' ')].filter(Boolean).join(' ').toLowerCase(),
      fields: { project: s.proj, type: 'shot', status: s.status, shot: s.id, tag: (s.tags || []).map(String), final: s.selectedCandidate ? 'true' : 'false', has: s.selectedCandidate ? ['route'] : [] },
      location: { page: 'project', projectId: s.proj, tab: 'story', entity: { type: 'shot', id: s.id } }
    });
  }

  for (const p of projects) {
    for (const g of listGenerations(p.id)) {
      const has = [];
      if (g.note) has.push('note');
      if (g.status === 'failed') has.push('failure');
      if ((g.promotedAssets || []).length || (g.routedTo && g.routedTo.kind && g.routedTo.kind !== 'none')) has.push('route');
      out.push({
        type: 'generation', id: g.id, pid: p.id, title: (g.label || g.shot || g.id), sub: projName(p.id) + ' · ' + (g.model || ''),
        haystack: [g.prompt, g.note, g.model, g.status, g.label].filter(Boolean).join(' ').toLowerCase(),
        fields: { project: p.id, type: g.status === 'failed' ? 'failure' : (g.tool === 'reroll' ? 'clip' : 'gen'), kind: /\.mp4$/i.test(g.file || '') ? 'clip' : 'img', status: g.status, review: g.reviewState, rating: g.rating || 0, final: g.final ? 'true' : 'false', model: g.model, shot: g.shot || '', batch: g.batchId || '', has, created: g.started },
        location: { page: 'project', projectId: p.id, tab: 'generate', entity: { type: 'generation', id: g.id } }
      });
    }
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
