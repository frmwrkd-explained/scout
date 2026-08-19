// Ticket 25 — user-authored tools. The filmmaker builds their own tool by conversation
// (backend/skills/frameforge-toolsmith), and it lands here as portable markdown.
//
// ONE artifact, three roles. A user tool is a single directory in the storage root:
//
//   <root>/tools/<id>/SKILL.md
//
// …whose FRONTMATTER is a chat-tool declaration (the same shape shared/chatTools.mjs declares for
// the built-ins) and whose BODY is the instructions the agent follows when the tool is enabled. That
// one file is simultaneously:
//
//   · an Index line          — agentHome.listChatTools() concatenates listUserTools() onto the
//                              static registry, so an authored tool reaches the agent through the
//                              exact machinery ticket 15 already built. No second registry.
//   · a mounted skill        — prepareAgentHome copies enabled tools to <home>/skills/tool-<id>,
//                              which is why the file is named SKILL.md: the directory IS a valid
//                              skill directory and mounts verbatim, with no frontmatter synthesis.
//   · a toggle               — settings.enabledChatTools[id], the same sparse map the built-ins use.
//                              ONE enablement key, never a second one in enabledSkillPacks.
//
// WHY DISCOVERY IS READ-TIME, NOT registerChatTool(). agentHome's registry is a process-global Map
// that clearChatTools() wipes with only seedChatTools() to restore it — and that re-adds the statics
// only. A registered user tool would silently vanish the first time a test (or any future caller)
// cleared the registry. Reading the directory inside listChatTools() is immune: the disk is the
// source of truth, exactly like every other record in this datastore.
//
// WHAT A USER TOOL GRANTS: nothing. It is instructions, not code, and it cannot widen the session's
// tool scope — that is fixed by BASELINE_ALLOWED_TOOLS in agentRunner.mjs (curl / node / python /
// Read / Glob / Grep, and notably NO Write). A tool re-arranges instructions over authority the
// agent already had.
//
// WHY THE AGENT DOES NOT WRITE THIS FILE ITSELF. It has curl, so POST /api/tools is within its
// reach — the toolsmith skill is told not to use it. This is a CONSENT gate, not a capability gate:
// a tool is a standing instruction that shapes sessions the filmmaker hasn't had yet, so they read
// the draft and press Create. Validation lives on the route below rather than in the skill, because
// a rule the model is asked to follow is a request; a rule the route enforces is a guarantee.
//
// This module must NEVER import ./agentHome.mjs — agentHome imports this, and the reverse is a cycle.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, getSettings, saveSettings, safe, stamp } from './store.mjs';
import { CHAT_TOOLS } from '../shared/chatTools.mjs';

// Feature-local storage lives as a one-line arrow in its own module (the library.mjs / stylelocks.mjs
// precedent), never as a new key on store.mjs's `paths` — that object is project/item core only.
export const toolsDir = () => path.join(getStorageRoot(), 'tools');
const toolDir = id => path.join(toolsDir(), safe(id));
const toolFile = id => path.join(toolDir(id), 'SKILL.md');

// A user tool may not take a built-in's id: both resolve against the same settings.enabledChatTools
// key, so a collision would hand the authored tool the built-in's on/off switch.
export const RESERVED_TOOL_IDS = new Set(CHAT_TOOLS.map(t => t.id));

// Lowercase slug, starts with a letter, 2–40 chars. Also the directory name and the mount-dir
// suffix, so it is validated BEFORE any path join — '../evil' never reaches the filesystem.
export const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const MAX_NAME = 60;
export const MAX_CAPABILITY = 160;
export const MAX_BODY = 16384;

// The single directive type a user tool may emit, and its Index pointer. Both are FORCED server-side
// regardless of what the draft proposed:
//  · directiveTypes — the frontend's directive→tool map is built once at module load, so a
//    per-tool directive type would get no renderer and fall through to the UNGATED placeholder,
//    rendering a disabled tool's card. One static type, registered once, gated once, forever.
//  · invocation — never an HTTP route. The agent cannot fetch, so an endpoint here would print a
//    capability into the Index that does not exist.
export const USER_TOOL_DIRECTIVE = 'tool.card';
export const mountName = id => 'tool-' + id;
export const invocationFor = id => 'skills/' + mountName(id) + '/SKILL.md';

const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();
const bad = (field, error) => ({ ok: false, field, error });

// Validate a draft and return the record to persist. Pure — no disk, no id-taken check (that is
// createUserTool's job, because it is a race the validator cannot see).
export function validateDraft(draft = {}) {
  const id = str(draft.id).toLowerCase();
  const name = str(draft.name);
  const capability = str(draft.capability);
  const instructions = typeof draft.instructions === 'string' ? draft.instructions : '';

  if (!id) return bad('id', 'a tool needs an id');
  if (!ID_RE.test(id)) return bad('id', 'id must be lowercase letters, numbers and dashes, start with a letter, and be 2–40 characters');
  if (safe(id) !== id) return bad('id', 'id contains characters that are not filename-safe');
  if (RESERVED_TOOL_IDS.has(id)) return bad('id', '"' + id + '" is a built-in FrameForge tool — pick another id');

  if (!name) return bad('name', 'a tool needs a name');
  if (name.length > MAX_NAME) return bad('name', 'name must be ' + MAX_NAME + ' characters or fewer');

  if (!capability) return bad('capability', 'a tool needs a one-sentence capability — it is what the agent sees');
  if (capability.length > MAX_CAPABILITY) return bad('capability', 'capability must be ' + MAX_CAPABILITY + ' characters or fewer');
  if (/[\r\n]/.test(capability)) return bad('capability', 'capability must be a single line — it becomes one Index line');

  if (!instructions.trim()) return bad('instructions', 'a tool needs instructions — the body the agent follows');
  if (instructions.length > MAX_BODY) return bad('instructions', 'instructions must be ' + MAX_BODY + ' characters or fewer');

  // Frontmatter is REBUILT from validated scalars, never passed through from agent-authored YAML:
  // writeMd's undefined filter is top-level only, so a nested undefined reaches js-yaml and throws,
  // failing the whole write.
  return {
    ok: true,
    tool: {
      id, name, capability, instructions,
      directiveTypes: [USER_TOOL_DIRECTIVE],
      invocation: invocationFor(id),
      source: 'user'
    }
  };
}

// The frontmatter written to disk. `name`/`description` carry the skill-frontmatter meaning too, so
// the directory reads as a valid skill when it is mounted into the agent home.
function frontmatterFor(t) {
  return {
    name: t.name,
    description: t.capability,
    'user-editable': true,
    id: t.id,
    capability: t.capability,
    invocation: t.invocation,
    directiveTypes: t.directiveTypes,
    source: 'user',
    updated: stamp()
  };
}

// One on-disk directory → a chat-tool record, or null if it is not one. Never throws.
function readToolDir(dirName) {
  if (!dirName || dirName.startsWith('.') || dirName.startsWith('_')) return null; // dotfiles + AppleDouble + private
  const dir = path.join(toolsDir(), dirName);
  const file = path.join(dir, 'SKILL.md');
  let data, content;
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
    ({ data, content } = readMd(file));
  } catch { return null; } // no SKILL.md, or unparseable frontmatter — skip, never crash the list
  const id = str(data.id) || dirName;
  if (!ID_RE.test(id)) return null;
  const capability = str(data.capability) || str(data.description);
  if (!capability) return null;
  return {
    id,
    name: str(data.name) || id,
    capability,
    // forced at read time as well as write time, so a hand-edited file cannot widen its own surface
    invocation: invocationFor(id),
    directiveTypes: [USER_TOOL_DIRECTIVE],
    enabledByDefault: false,
    source: 'user',
    instructions: content,
    updated: str(data.updated),
    dir,
    skillDir: dir
  };
}

// Every authored tool on disk, id-sorted. Never throws — a missing tools/ dir is the normal
// first-run state, and one unreadable folder must not hide the rest.
export function listUserTools() {
  let names = [];
  try { names = fs.readdirSync(toolsDir()); } catch { return []; }
  const out = [];
  for (const n of names) {
    const t = readToolDir(n);
    // a tool whose frontmatter id collides with a built-in is ignored rather than allowed to
    // shadow it — the same rule the validator enforces, applied to files that arrived some other way
    if (t && !RESERVED_TOOL_IDS.has(t.id)) out.push(t);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function readUserTool(id) {
  const clean = str(id).toLowerCase();
  if (!ID_RE.test(clean)) return null; // rejected before any path join
  return readToolDir(clean);
}

// Write a new tool. Refuses an existing id: a draft is machine-written, and a silent overwrite would
// destroy a tool the filmmaker had already tuned. There is deliberately no update path in v1.
export function createUserTool(draft) {
  const v = validateDraft(draft);
  if (!v.ok) return v;
  const t = v.tool;
  if (fs.existsSync(toolDir(t.id))) return bad('id', 'a tool called "' + t.id + '" already exists');
  writeMd(toolFile(t.id), frontmatterFor(t), t.instructions.endsWith('\n') ? t.instructions : t.instructions + '\n');
  return { ok: true, tool: readUserTool(t.id) };
}

export function deleteUserTool(id) {
  const clean = str(id).toLowerCase();
  if (!ID_RE.test(clean)) return { ok: false, error: 'no such tool' };
  const dir = toolDir(clean);
  if (!fs.existsSync(dir)) return { ok: false, error: 'no such tool' };
  fs.rmSync(dir, { recursive: true, force: true });
  // Prune the toggle too, or a re-created tool with the same id would inherit the old on/off state.
  // Spread first — saveSettings shallow-merges, so mutating the live map in place is not enough, and
  // `delete` (not `= undefined`) because writeMd only strips top-level undefined.
  const map = { ...(getSettings().enabledChatTools || {}) };
  if (Object.prototype.hasOwnProperty.call(map, clean)) {
    delete map[clean];
    saveSettings({ enabledChatTools: map });
  }
  return { ok: true, id: clean };
}

// The tool a card/list needs, without the body — the Tools hub renders many of these.
const summarize = t => ({
  id: t.id, name: t.name, capability: t.capability, invocation: t.invocation,
  directiveTypes: t.directiveTypes, source: t.source, updated: t.updated, instructions: t.instructions
});

export function registerUserToolRoutes(app, deps = {}) {
  const activity = deps.appendActivity || (() => {});

  app.get('/api/tools', (req, res) => {
    const on = getSettings().enabledChatTools || {};
    res.json({
      tools: listUserTools().map(t => ({
        ...summarize(t),
        enabled: Object.prototype.hasOwnProperty.call(on, t.id) ? !!on[t.id] : false
      }))
    });
  });

  // The ONLY writer. The chat agent cannot reach this route — it has no network tool; the user's
  // click on the draft card is what posts here.
  app.post('/api/tools', (req, res) => {
    const r = createUserTool(req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error, field: r.field, code: 'invalid-tool' });
    activity({ dot: 'green', t: 'Tool created', t2: '· ' + r.tool.name, s: 'built by conversation · off until enabled', kind: 'skills' });
    res.json({ ok: true, tool: summarize(r.tool) });
  });

  app.delete('/api/tools/:id', (req, res) => {
    const r = deleteUserTool(req.params.id);
    if (!r.ok) return res.status(404).json({ error: r.error, code: 'no-tool' });
    activity({ dot: 'amber', t: 'Tool deleted', t2: '· ' + r.id, s: 'removed from the workspace', kind: 'skills' });
    res.json({ ok: true, id: r.id });
  });
}
