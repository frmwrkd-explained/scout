#!/usr/bin/env node
// Regenerate _known.md and .scout/cache/context.md from the workspace files.
// Folder mode has no app to do this, so this script IS the cache renderer.
// Zero dependencies on purpose — plain node, nothing to install.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || process.cwd();
const BUDGET_CHARS = 8000;              // ~2000 tokens. The cap is the feature.
const WINDOW = { territory: 7, playbook: 30, learning: 90, record: 30 };
const DAY = 864e5;

// --- tiny frontmatter reader (a deliberate subset: scalars + inline arrays) ---
function readMd(file) {
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw.trim() };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v === '' || v === '|' || v === '>') { data[kv[1]] = ''; continue; }
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else { v = v.replace(/^["']|["']$/g, ''); if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v); else if (v === 'true') v = true; else if (v === 'false') v = false; }
    data[kv[1]] = v;
  }
  return { data, body: m[2].trim() };
}
const p = (...a) => path.join(ROOT, ...a);
const listMd = d => { try { return fs.readdirSync(p(d)).filter(f => f.endsWith('.md')).map(f => ({ id: f.slice(0, -3), ...readMd(p(d, f)) })); } catch { return []; } };
const listDeep = d => { const out = []; const walk = x => { let e = []; try { e = fs.readdirSync(x, { withFileTypes: true }); } catch { return; } for (const it of e) { const f = path.join(x, it.name); if (it.isDirectory()) { if (!it.name.startsWith('_') && !it.name.startsWith('.')) walk(f); } else if (it.name.endsWith('.md')) { const r = readMd(f); if (r) out.push({ id: it.name.slice(0, -3), file: path.relative(ROOT, f), ...r }); } } }; walk(p(d)); return out; };
const days = s => { const t = Date.parse(s); return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / DAY); };
const ago = s => { const d = days(s); return d == null ? 'never' : d === 0 ? 'today' : `${d}d ago`; };
const stale = (o, kind) => { const d = days(o.verified_at || o.last_swept || o.updated); const w = o.sweep_interval_days || WINDOW[kind] || 30; return d == null ? true : d >= w; };

// --- gather ---
const me        = readMd(p('me.md')) || { data: {}, body: '' };
const goals     = listMd('goals');
const territory = listMd('territory');
const playbook  = listMd('playbook');
const learnings = listMd('learnings').filter(l => (l.data.status || 'active') !== 'retired');
const records   = listDeep('data');
const activeProject = me.data.active_project || (fs.existsSync(p('projects')) ? (fs.readdirSync(p('projects')).find(d => !d.startsWith('.')) || '') : '');

// --- _known.md : the flat, greppable dedupe list ---
const known = ['# Known records', '',
  '`id · name · handle · status · collection` — grep this before writing anything.', ''];
for (const r of records) {
  known.push(`${r.id} · ${r.data.name || ''} · ${r.data.handle || ''} · ${r.data.status || ''} · ${r.data.collection || path.basename(path.dirname(r.file))}`);
}
fs.writeFileSync(p('_known.md'), known.join('\n') + '\n');

// --- context.md : the one file an agent reads on wake ---
const scored = territory.map(t => {
  const finds = records.filter(r => r.data.found_in === t.id).length;
  const wins  = records.filter(r => r.data.found_in === t.id && ['won', 'booked', 'replied'].includes(r.data.status || r.data.outcome)).length;
  return { ...t, finds, wins, rate: finds ? Math.round((wins / finds) * 1000) / 10 : 0, stale: stale(t.data, 'territory') };
});
const open    = scored.filter(t => (t.data.access || 'untried') === 'joined').sort((a, b) => b.rate - a.rate);
const blocked = scored.filter(t => ['rejected', 'banned', 'requested'].includes(t.data.access));
const untried = scored.filter(t => (t.data.access || 'untried') === 'untried');

const L = [];
const S = (...x) => L.push(...x);
S(`<scout-context v="${Date.now()}" generated="${new Date().toISOString().slice(0, 16).replace('T', ' ')}"${activeProject ? ` project="${activeProject}"` : ''}>`, '');
S('## WHO I WORK FOR', me.body || '(not set — ask them the setup questions)', '');
if (goals.length) { S('## GOALS'); for (const g of goals) S(`- ${g.data.statement || g.id}${g.data.target ? ` — target ${g.data.target}` : ''}${g.data.deadline ? ` by ${g.data.deadline}` : ''}`); S(''); }
if (activeProject) { const b = readMd(p('projects', activeProject, 'brief.md')); S(`## PROJECT · ${activeProject}`, b?.body?.slice(0, 700) || '(no brief)', ''); }
if (open.length)    { S('## BEST GROUND'); for (const t of open.slice(0, 5)) S(`- ${t.id} — ${t.rate}% · ${t.wins}/${t.finds} · swept ${ago(t.data.last_swept)}${t.stale ? '  ← STALE' : ''}`); }
const stalest = open.filter(t => t.stale).slice(5, 8);
if (stalest.length) { S('## ALSO STALE'); for (const t of stalest) S(`- ${t.id} — swept ${ago(t.data.last_swept)}`); }
if (blocked.length) { S('## BLOCKED'); for (const t of blocked) S(`- ${t.id} — ${t.data.access}${t.data.access_changed ? ` ${t.data.access_changed}` : ''}${t.data.access === 'rejected' ? ' · do not re-request' : ''}`); }
if (untried.length) { S('## NEVER TRIED'); for (const t of untried.slice(0, 5)) S(`- ${t.id}`); }
S('');
if (playbook.length) { S('## WHAT WORKS  (open the file when you need the body)'); for (const b of playbook) { const st = stale(b.data, 'playbook'); S(`- ${b.id}${st ? ' — STALE, re-verify before trusting' : ` — ${(b.body.split('\n')[0] || '').slice(0, 90)}`}`); } S(''); }
if (learnings.length) { S('## LEARNED'); for (const l of learnings) S(`- ${l.data.claim || l.id}`); S(''); }
const byStage = {}; for (const r of records) { const k = r.data.status || 'inbox'; byStage[k] = (byStage[k] || 0) + 1; }
S('## COUNTS', `records ${records.length} · ${Object.entries(byStage).map(([k, v]) => `${k} ${v}`).join(' · ')} · territory ${territory.length}`);
S('</scout-context>');

let out = L.join('\n') + '\n';
const dropped = [];
// The compression ladder from docs/03_MEMORY.md §2 — and it says what it dropped.
if (out.length > BUDGET_CHARS && untried.length > 5) { dropped.push('untried territory beyond 5'); }
if (out.length > BUDGET_CHARS) {
  out = out.replace(/^- (\S+) — (?!STALE)(.*)$/gm, (m0, id) => `- ${id}`);
  dropped.push('playbook one-liners');
}
if (out.length > BUDGET_CHARS) { out = out.slice(0, BUDGET_CHARS - 200) + '\n(truncated)\n</scout-context>\n'; dropped.push('tail'); }
if (dropped.length) out = out.replace('</scout-context>', `\n## COMPRESSED\nDropped to stay under budget: ${dropped.join(', ')}\n</scout-context>`);

fs.mkdirSync(p('.scout', 'cache'), { recursive: true });
fs.writeFileSync(p('.scout', 'cache', 'context.md'), out);

const pct = Math.round((out.length / BUDGET_CHARS) * 100);
console.log(`context.md  ${out.length} chars (~${Math.round(out.length / 4)} tokens) · ${pct}% of budget${dropped.length ? ' · compressed: ' + dropped.join(', ') : ''}`);
console.log(`_known.md   ${records.length} records`);
if (pct > 100) { console.error('OVER BUDGET'); process.exit(1); }
