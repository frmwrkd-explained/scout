// backend/skillRecords.mjs — the skills on disk, read as a list a person can look through.
//
// A skill stays what it is everywhere else: a FOLDER with a SKILL.md and whatever scripts and
// reference files it carries (docs/10_SKILLS_AND_PLUGINS.md §1). It is not turned into a record —
// an assistant's runtime loads a skill by its folder, and a second copy as a record would be a
// second source of truth for the one thing that must not have two. This module only READS:
//
//   app         <app>/skills/<name>/         shipped with Scout, mounted into every assistant run
//   workspace   <workspace>/skills/<name>/   this workspace's own — it travels with the folder
//
// What a skill may say about itself, in SKILL.md frontmatter (all optional except the first two):
//   name, description            what every skill runtime already reads
//   reads:  [collection ids]     where it looks
//   writes: [collection ids]     where it puts things (always through the record pipeline)
//   schedule: manual|daily|weekly|continuous
//   assistant: <assistant id>    who runs it on that schedule (assistants/<id>.md owns the clock)
//
// The personal skill library configured in Settings (`skillRepos`) is deliberately not listed
// here: it belongs to the person, not to the workspace, and is mounted per assistant.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStorageRoot, readMd, getSettings } from './store.mjs';
import { listCollections } from './collections.mjs';
import { getAssistant, normalizeSchedule } from './tasks.mjs';

export class SkillError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'SkillError'; this.status = status; }
}

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const SOURCES = {
  app: { dir: () => APP_DIR, label: 'Built in' },
  workspace: { dir: () => path.join(getStorageRoot(), 'skills'), label: 'This workspace' },
};
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SCRIPT = new Set(['.mjs', '.js', '.cjs', '.ts', '.py', '.sh', '.rb', '.go']);
const DOC = new Set(['.md', '.txt']);
const DATA = new Set(['.json', '.yaml', '.yml', '.csv', '.toml']);
const kindOf = name => { const ext = path.extname(name).toLowerCase(); return SCRIPT.has(ext) ? 'script' : DOC.has(ext) ? 'doc' : DATA.has(ext) ? 'data' : 'other'; };

function filesIn(dir) {
  const out = [];
  const walk = (rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || out.length >= 200) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (depth < 4 && e.name !== 'node_modules') walk(r, depth + 1); continue; }
      if (r === 'SKILL.md') continue;
      let size = 0;
      try { size = fs.statSync(path.join(dir, r)).size; } catch { /* listed with size 0 */ }
      out.push({ path: r, size, kind: kindOf(e.name) });
    }
  };
  walk('', 0);
  return out;
}

const idList = v => [].concat(v ?? []).map(x => String(x).trim()).filter(Boolean).slice(0, 30);

function readSkillDir(source, name, { withBody = false } = {}) {
  const dir = path.join(SOURCES[source].dir(), name);
  let data = {}, content = '', readable = true;
  try { const md = readMd(path.join(dir, 'SKILL.md')); data = md.data || {}; content = String(md.content || ''); }
  catch { readable = false; }
  const collections = listCollections();
  const known = new Map(collections.map(c => [c.id, c.label || c.id]));
  const named = ids => ids.map(id => ({ id, label: known.get(id) || id, exists: known.has(id) }));
  const reads = idList(data.reads), writes = idList(data.writes);
  // A skill that declares nothing is still shown with the collections its text names, marked as
  // such — an inference is useful, but it is never presented as a declaration.
  const mentions = reads.length || writes.length ? [] : collections
    .filter(c => new RegExp('(`|#)' + c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(`|\\b)').test(content))
    .map(c => ({ id: c.id, label: c.label || c.id, exists: true }));

  const assistant = data.assistant ? getAssistant(String(data.assistant)) : null;
  const declared = data.schedule ? normalizeSchedule(data.schedule) : null;
  const files = filesIn(dir);
  const firstLine = content.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) || '';
  return {
    id: source + '/' + name, source, source_label: SOURCES[source].label, folder: name,
    name: String(data.name || name), description: String(data.description || firstLine).slice(0, 600),
    readable,
    reads: named(reads), writes: named(writes), mentions,
    schedule: {
      declared,                                             // what SKILL.md asks for
      assistant: assistant ? { id: assistant.id, name: assistant.name, schedule: assistant.schedule, kind: assistant.schedule_kind } : null,
      assistant_missing: data.assistant && !assistant ? String(data.assistant) : null,
      // Whether anything will actually happen on its own: the app's one switch for automatic runs.
      automatic_runs_on: !!getSettings().autoRun,
    },
    files, scripts: files.filter(f => f.kind === 'script').length,
    ...(withBody ? { body: content.trim() } : {}),
  };
}

export function listSkills() {
  const out = [];
  for (const source of Object.keys(SOURCES)) {
    let names = [];
    try { names = fs.readdirSync(SOURCES[source].dir(), { withFileTypes: true }).filter(e => e.isDirectory() && NAME.test(e.name)).map(e => e.name).sort(); }
    catch { /* a workspace with no skills folder has no skills of its own */ }
    for (const name of names) {
      if (!fs.existsSync(path.join(SOURCES[source].dir(), name, 'SKILL.md'))) continue;
      out.push(readSkillDir(source, name));
    }
  }
  return out;
}

function locate(id) {
  const [source, ...rest] = String(id || '').split('/');
  const name = rest.join('/');
  if (!SOURCES[source] || !NAME.test(name)) throw new SkillError('No skill called "' + id + '".', 404);
  const dir = path.join(SOURCES[source].dir(), name);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new SkillError('No skill called "' + id + '".', 404);
  return { source, name, dir };
}

export function readSkill(id) {
  const { source, name } = locate(id);
  return readSkillDir(source, name, { withBody: true });
}

// One of a skill's own files, as text. The path is checked against the skill's folder after
// resolving, so `../` cannot leave it.
export function readSkillText(id, rel) {
  const { dir } = locate(id);
  const abs = path.resolve(dir, String(rel || ''));
  if (!abs.startsWith(dir + path.sep)) throw new SkillError('That file is not part of the skill.', 400);
  let stat;
  try { stat = fs.statSync(abs); } catch { throw new SkillError('No such file in this skill.', 404); }
  if (!stat.isFile()) throw new SkillError('No such file in this skill.', 404);
  if (stat.size > 256_000) throw new SkillError('That file is too large to show here. Open it from Files.', 413);
  if (kindOf(abs) === 'other') throw new SkillError('That file is not text.', 415);
  return { path: path.relative(dir, abs).split(path.sep).join('/'), content: fs.readFileSync(abs, 'utf8') };
}
