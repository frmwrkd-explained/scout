// Ticket 10 — the router skill, the session Index, and the isolated agent home.
//
// Three things, none of which contains domain knowledge:
//
//  1. THE ISOLATED AGENT HOME. A per-session config/home directory inside the workspace storage
//     root. The chat CLI is spawned pointed at it (CLAUDE_CONFIG_DIR + session-scoped flags) so the
//     user's GLOBAL skill library (~/.claude/skills), plugins and settings never load. The home
//     contains exactly the capability surface: the router skill (system copy, refreshed from source
//     on EVERY prepare so tampering never persists), the mounted skill packs, the house-rules skill,
//     plus the generated Index + Core-API reference the router consumes.
//
//  2. THE INDEX GENERATOR. renderIndex() produces the `<scout-index>` block the router skill
//     (backend/skills/scout-router/SKILL.md) reads: api base + project + mode + lock ids, one
//     line per mounted pack (from the pack's OWN frontmatter), one line per ENABLED tool (capability
//     + invocation pointer + registered directive types), and a pointer to the generated Core-API
//     route reference. Disabled entries are omitted entirely — invisible, not refused. Adding a
//     capability is a new Index line, never a router edit.
//
//  3. SKILL-PACK MOUNTING. Packs are existing large skills pointed at through the skill-repos
//     setting (backend/store.mjs scanSkillRepos), individually toggleable. Enabled packs are mounted
//     (symlink, else copy) into the isolated home with their file trees intact; their Index line
//     comes from their own description/triggers. Pack workspaces and scripts are never modified.
//
// The isolation mechanism is DATA-DRIVEN (ISOLATION_PROFILES below), keyed on the agent command, so
// swapping/extending it is a data edit — matching the installed `claude` 2.1.205 flag surface
// (CLAUDE_CONFIG_DIR relocates the user config dir; --setting-sources / --add-dir scope the rest).
//
// The chat-tools registry (ticket 15) is a SEAM here: registerChatTool() with tools defaulting OFF.
// It is empty-but-functional now; ticket 15 fills it. The router skill itself is never edited.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { getStorageRoot, getSettings, scanSkillRepos, readMd, writeMd, safe, safeScope, paths } from './store.mjs';
import { CHAT_TOOLS, resolveToolEnabled } from '../shared/chatTools.mjs';
import { listUserTools, mountName } from './userTools.mjs';

// The already-authored system router skill. Its canonical source is the backend source tree; we copy
// it fresh into every session home and never edit it. fileURLToPath (not URL.pathname) so a repo path
// containing spaces — this one does — resolves without percent-encoding.
// CLAUDE.md's source-of-truth table names `skills/scout-router/` canonical: the repo root, not
// backend/. The app copies it fresh into every session home on each run (copyTree below), so a
// tamper in a mounted copy never persists — which is only true while this points at the one
// canonical source.
const SYSTEM_SKILLS_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const SYSTEM_ROUTER_SRC = path.join(SYSTEM_SKILLS_SRC, 'scout-router');
export function systemRouterDir() { return SYSTEM_ROUTER_SRC; }

// The tool-builder system skill (ticket 25). Unlike the router it is NOT mounted into every session
// — only into a session created with kind:'toolsmith' (the "+ New tool" surface). Always-mounting it
// would tax every unrelated turn with its description and weaken the "only enabled skills mount"
// property the agent-home tests exist to guard.
const SYSTEM_TOOLSMITH_SRC = path.join(SYSTEM_SKILLS_SRC, 'scout-toolsmith');
export function toolsmithDir() { return SYSTEM_TOOLSMITH_SRC; }

// ── built-in skill packs (ticket 23) ──
// Unlike repo packs (discovered through the user's skill-repos setting, backend/store.mjs
// scanSkillRepos), these ship WITH the app in the backend source tree. They are enumerated by
// listSkillPacks() ALONGSIDE repo packs, toggled through the SAME enabledSkillPacks setting, and —
// like the router — COPIED fresh from source into each session home on EVERY prepare, so a tamper of
// the mounted copy never persists (a symlink would let an edit reach back into the source tree).
//
// Scout ships no built-in workflow pack yet. FrameForge's two (storyboard-workflow, manual-roundtrip)
// were film and went with the domain. The mechanism is untouched and the list is deliberately empty
// rather than deleted: M4 fills it, and an empty array keeps every enablement path exercised.
export const BUILTIN_PACKS = [];

const R = () => getStorageRoot();
const chatRoot = () => path.join(R(), 'chat');
export const agentHomesRoot = () => path.join(chatRoot(), 'agent-homes');
export const agentHomeDir = sessionId => path.join(agentHomesRoot(), safe(String(sessionId || 'default')));
// The house-rules canonical source lives OUTSIDE the per-session homes so user edits persist across
// sessions and survive the per-session tamper-reset. It is copied into each home on prepare.
export const houseRulesDir = () => path.join(chatRoot(), 'house-rules');
const houseRulesFile = () => path.join(houseRulesDir(), 'SKILL.md');

// ── the self API base the agent operates Scout through ──
// 127.0.0.1 only (never localhost — the backend binds IPv4).
//
// THE BOUND PORT IS THE TRUTH, and only the process that called listen() knows it: an ephemeral
// bind (`listen(0)`, which is what scripts/demonstrate.mjs and every test harness does) has a port
// no environment variable can predict. setSelfPort() is how that number gets here — index.mjs
// calls it from the listen callback with `server.address().port` — and it also stamps
// SCOUT_SELF_PORT so a spawned agent process inherits the same answer.
//
// The fallback chain below is for a hermetic call with nothing bound. Its last rung was 5176,
// which is FrameForge's port and not Scout's: `npm run demonstrate` and every embedded host
// rendered an Index whose `api:` line named a port nothing was listening on — an agent following
// the Index would get ECONNREFUSED on its first call. CLAUDE.md §Ports: the API is 5177.
let SELF_PORT = null;
export function setSelfPort(port) {
  const n = Number(port);
  SELF_PORT = Number.isFinite(n) && n > 0 ? n : null;
  // Child processes (agent runs, the MCP door) read the env var, so keep the two in step — in both
  // directions: clearing the port and leaving a stale number in the environment for a spawned
  // agent to trust would be worse than never having set one.
  if (SELF_PORT) process.env.SCOUT_SELF_PORT = String(SELF_PORT);
  else delete process.env.SCOUT_SELF_PORT;
  return SELF_PORT;
}
export function selfPort() {
  return SELF_PORT || Number(process.env.SCOUT_SELF_PORT) || Number(process.argv[2]) || Number(process.env.PORT) || 5177;
}
export function selfApiBase() { return 'http://127.0.0.1:' + selfPort(); }

// ── the chat-tools registry seam (ticket 15) ──
// Tools default OFF. Ticket 15 registers real tools here; today it is empty-but-functional so the
// Index's Tools section renders correctly (i.e. renders nothing) with zero further wiring.
const chatTools = new Map(); // id -> { id, capability, invocation, directiveTypes:[], enabledByDefault:false }
export function registerChatTool(tool = {}) {
  if (!tool || !tool.id) throw new Error('chat tool needs an id');
  chatTools.set(String(tool.id), {
    id: String(tool.id),
    // `name` is the display title for Settings → Chat tools and the Tools hub. It was dropped here
    // until ticket 25 made the switchboard read the SERVER list instead of the static import — with
    // it dropped, every built-in tool's row title would blank.
    name: String(tool.name || tool.id),
    capability: String(tool.capability || tool.description || tool.id),
    invocation: String(tool.invocation || ''),          // schema|endpoint pointer the agent calls
    directiveTypes: Array.isArray(tool.directiveTypes) ? tool.directiveTypes.map(String) : [],
    enabledByDefault: !!tool.enabledByDefault,
    source: tool.source || 'system',                    // 'system' | 'user' — drives the "built by you" chip
    skillDir: tool.skillDir || null                     // user tools mount this dir into the session home
  });
  return chatTools.get(String(tool.id));
}
export function clearChatTools() { chatTools.clear(); } // tests
// The registry (built-ins) PLUS the tools the filmmaker authored, discovered from disk on every call
// (backend/userTools.mjs). User tools are deliberately not registerChatTool()'d: clearChatTools()
// wipes the process-global Map and only seedChatTools() restores it — which re-adds the statics
// only — so a registered user tool would silently vanish. Reading the directory here keeps the disk
// authoritative, exactly like every other record in this datastore. Built-ins win an id collision.
// Enablement is PER PROJECT: pass the project id and the project's own map wins, falling through to
// the global setting and then the tool's default (resolveToolEnabled owns that rule — one copy, both
// sides). Called with no pid — a standalone, project-less session — only the global layer applies,
// which is exactly the behaviour this function had before the project layer existed.
export function listChatTools(pid) {
  const on = getSettings().enabledChatTools || {};
  const proj = projectToolMap(pid);
  const seen = new Set();
  const all = [];
  for (const t of chatTools.values()) { seen.add(t.id); all.push(t); }
  for (const t of listUserTools()) if (!seen.has(t.id)) all.push(t);
  return all.map(t => ({
    ...t,
    enabled: resolveToolEnabled(t.id, { project: proj, global: on, tool: t }),
    // what the rail needs to draw the toggle honestly: whether THIS project has an opinion, or is
    // still inheriting the global default. Without it the rail cannot show "inherited" vs "set here".
    scope: Object.prototype.hasOwnProperty.call(proj, t.id) ? 'project' : 'global'
  }));
}
export function enabledTools(pid) { return listChatTools(pid).filter(t => t.enabled); }

// Ticket 15 fills the seam: seed the registry from the shared declaration (shared/chatTools.mjs).
// Seeded at module load so every entry point that imports agentHome sees the same tools; idempotent
// (registerChatTool sets by id), so a re-seed after clearChatTools() in tests restores the defaults.
// Every seeded tool defaults OFF — enabledTools() stays empty until the user toggles one on, so the
// Index still renders "(none enabled)" out of the box (hackathon compliance).
export function seedChatTools() { for (const t of CHAT_TOOLS) registerChatTool(t); }
seedChatTools();

// ── skill packs (from the skill-repos setting) ──
// A pack == one installed skill (a dir with SKILL.md). We derive a stable id from its dir so toggles
// survive a rename of the display name, and read triggers straight from the pack's OWN frontmatter.
function packFrontmatter(dir) {
  let description = '', triggers = '';
  try {
    const { data } = readMd(path.join(dir, 'SKILL.md'));
    description = String(data.description || '');
    const t = data.triggers ?? data.when ?? data['when-to-use'] ?? '';
    triggers = Array.isArray(t) ? t.join(', ') : String(t || '');
  } catch { /* unreadable — leave blank, the pack still mounts */ }
  return { description, triggers };
}
export function packId(dir) { return safe(path.basename(String(dir || ''))); }
// A pack's display name comes from its OWN frontmatter `name`, falling back to the dir basename —
// used for built-in packs, where scanSkillRepos() (which supplies sk.name for repo packs) never runs.
function packName(dir) {
  try { const { data } = readMd(path.join(dir, 'SKILL.md')); if (data.name) return String(data.name); } catch { /* fall through */ }
  return path.basename(String(dir || ''));
}

// Every pack the app can see — the BUILT-IN packs shipped in the backend source tree FIRST, then the
// repo packs the skill-repos setting discovers. Enablement is resolved per pack (built-ins may default
// ON via their own flag; repo packs default OFF for compliance). Built-ins win an id collision.
export function listSkillPacks() {
  const on = getSettings().enabledSkillPacks || {};
  const out = [];
  const seen = new Set();
  // built-in packs — present in the source tree, copied fresh into each home on prepare (tamper-reset)
  for (const bp of BUILTIN_PACKS) {
    if (!fs.existsSync(path.join(bp.dir, 'SKILL.md'))) continue; // source missing → skip silently
    const id = packId(bp.dir);
    if (seen.has(id)) continue;
    const fm = packFrontmatter(bp.dir);
    out.push({
      id, name: packName(bp.dir), repo: 'built-in', dir: bp.dir,
      description: fm.description, triggers: fm.triggers, files: [], builtin: true,
      // explicit toggle wins; otherwise the built-in's own default (storyboard workflow: ON)
      enabled: Object.prototype.hasOwnProperty.call(on, id) ? !!on[id] : !!bp.enabledByDefault
    });
    seen.add(id);
  }
  for (const repo of scanSkillRepos()) {
    for (const sk of repo.skills || []) {
      const id = packId(sk.dir);
      if (seen.has(id)) continue; // a built-in with the same id already claimed it
      const fm = packFrontmatter(sk.dir);
      out.push({
        id, name: sk.name, repo: repo.name, dir: sk.dir,
        description: sk.description || fm.description,
        triggers: fm.triggers,
        files: sk.files || [],
        builtin: false,
        // sparse map: only ids the user explicitly toggled appear; everything else defaults OFF
        enabled: Object.prototype.hasOwnProperty.call(on, id) ? !!on[id] : false
      });
      seen.add(id);
    }
  }
  return out;
}
export function enabledPacks() { return listSkillPacks().filter(p => p.enabled); }

// ── locks (ids only — the router never restates their content) ──
// The Index carries "current lock ids by category". Style locks are the concrete category that
// exists today (project.md styleLock); other categories surface as they land in later tickets. A
// standalone session (no project) has no locks.
export function locksForProject(pid) {
  const locks = {};
  if (!pid) return locks;
  try {
    const { data } = readMd(paths.projectMd(pid));
    if (data.styleLock) locks.style = String(data.styleLock);
  } catch { /* no project record */ }
  return locks;
}

// ── per-project tool enablement ──
// The project's own sparse { toolId: bool } map, from project.md frontmatter. Same file and same
// read shape as locksForProject above; `styleLock` set the precedent for a project-scoped key that
// isn't in store.mjs's patchProject allow-list (see index.mjs's style-lock route), and listProjects()
// spreads frontmatter unfiltered, so this map reaches the frontend on /api/state for free.
// A missing project, a missing key, or a malformed value all mean "no opinion" → inherit.
export function projectToolMap(pid) {
  if (!pid) return {};
  try {
    const { data } = readMd(paths.projectMd(pid));
    const m = data.enabledTools;
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  } catch { return {}; }
}

// Write one tool's flag for one project. `null` CLEARS the project's opinion so it inherits the
// global default again — the rail's third toggle state, and the only way back to "inherited".
export function setProjectTool(pid, id, enabled) {
  const file = paths.projectMd(pid);
  const { data, content } = readMd(file);
  const cur = (data.enabledTools && typeof data.enabledTools === 'object' && !Array.isArray(data.enabledTools))
    ? { ...data.enabledTools } : {};
  if (enabled === null) delete cur[id]; else cur[id] = !!enabled;
  writeMd(file, { ...data, enabledTools: Object.keys(cur).length ? cur : undefined }, content);
  return cur;
}

// ── the Core API route reference (GENERATED from declared metadata, never hand-maintained prose) ──
// Declare the routes the router may drive; renderCoreApiRef() turns the metadata into the markdown
// file the Index points at. Adding a route here regenerates the reference — no prose to keep in sync.
// The route reference injected into EVERY agent session. It must describe routes that exist:
// an agent following a stale line here does not get a warning, it gets a 404 in the middle of a
// job. This list was 18 routes of which 17 had been deleted with the film domain, and nothing
// caught it because a reference is not code — keep it honest by hand, and only add a line when the
// route is real. Missing capabilities are M2-M5; they are absent rather than promised.
export const CORE_API_ROUTES = [
  { method: 'GET',  path: '/api/state', summary: 'Full app state: projects, items, settings, skillRepos, ledger, jobs.' },

  { method: 'GET',  path: '/api/collections', summary: 'Every collection and its schema, plus the legal field types. A collection is a SAVED QUERY — a document belongs to it because it matches, and may belong to several.' },
  { method: 'GET',  path: '/api/collections/:id', summary: 'One collection\'s schema (frontmatter of .scout/collections/<id>.md).' },
  { method: 'GET',  path: '/api/collections/:id/documents', summary: 'The documents matching a collection. ?view=<id> applies a saved view (filter + sort + group); ?bind=<json> is the subtable case — a collection plus a bound parameter. Rollups and formulas are computed on read; a value written in frontmatter always wins over the computed one.' },
  { method: 'POST', path: '/api/collections', summary: 'Create or replace a collection. Validated: exactly one primary field, at most one gate:true status field, relation targets must exist. An unknown field type is rejected with the legal set named.' },
  { method: 'POST', path: '/api/collections/:id/fields', summary: 'Add one field to a collection. Adding a field never rewrites existing documents — missing is empty.' },

  { method: 'GET',  path: '/api/views/:collection', summary: 'Saved views, stored in the vault at .scout/views/<collection>.json so they travel with the data. If none are saved, a default is inferred from the collection\'s shape.' },
  { method: 'PUT',  path: '/api/views/:collection', summary: 'Save a view. Body: { id, label, type: table|board|list|gallery, filter[], sort[], group, fields[] }.' },

  { method: 'GET',  path: '/api/document', summary: 'One document by its path in the store (?path=data/guests/maria-santos.md). Returns frontmatter, body, summary, and every collection it belongs to.' },
  { method: 'GET',  path: '/api/document/references', summary: 'What points AT this document, and through which field (?path=…). Declared relations and loose frontmatter pointers from memory objects both count.' },

  { method: 'GET',  path: '/api/search', summary: 'Structured search: key:value filters plus free text. Secrets are never searched or returned.' },

  { method: 'GET',  path: '/api/memory/:pid', summary: 'A project\'s memory document.' },
  { method: 'POST', path: '/api/memory/:pid/learnings', summary: 'Append a learning, deduped against what is already there.' },

  { method: 'GET',  path: '/api/board/:pid/describe', summary: 'What is on a project\'s whiteboard, without the coordinates — counts, frame labels and text. Ask for this rather than the raw document.' },

  { method: 'GET',  path: '/api/chat/sessions', summary: 'List chat sessions (?project=<id> | ?all=1).' },
  { method: 'GET',  path: '/api/chat/sessions/:id', summary: 'One session with its transcript.' },
  { method: 'POST', path: '/api/chat/sessions/:id/bind', summary: 'Promote a standalone chat to a project. Create the project first via POST /api/projects, then bind. Body: { project }. The same session id continues, now carrying the project.' },

  { method: 'GET',  path: '/api/actions', summary: 'The append-only action journal — what changed, when, and by whom.' },
  { method: 'GET',  path: '/api/jobs', summary: 'Background jobs and their status.' }
];
export function renderCoreApiRef(apiBase = selfApiBase()) {
  const lines = [
    '# Scout Core API — route reference',
    '',
    'Generated per session from route metadata. Base URL for every path below:',
    '',
    '    ' + apiBase,
    '',
    'The agent operates Scout exclusively through these HTTP routes (the same seam the app UI',
    'uses). Reference records by id and let the app render them — never restate stored data.',
    '',
    '| Method | Path | What it does |',
    '| --- | --- | --- |',
    ...CORE_API_ROUTES.map(r => '| ' + r.method + ' | `' + r.path + '` | ' + r.summary + (r.note ? ' (' + r.note + ')' : '') + ' |'),
    ''
  ];
  return lines.join('\n');
}

// ── the Index ──
// Render the `<scout-index>` block the router SKILL.md consumes verbatim. Pure + deterministic
// so it is unit-testable without any disk or process. Disabled packs/tools are omitted ENTIRELY.
//
// The `[skills/<id>]` pointer is a SKILL-INVOCATION REFERENCE the agent reads, not a filesystem path:
// it names a mount inside the session home the way `userTools.invocationFor()` does, and the router
// resolves it as a POSIX-style relative reference on every host. It must therefore be built by plain
// concatenation — path.join() renders it `skills\<id>` on Windows and hands the agent a pointer the
// router cannot resolve. Same canonical form as userTools.mjs; do not "fix" this to path.join.
// (Pack ids are safe()d — every separator is already collapsed to `_` — so on POSIX this is
// byte-identical to what path.join produced.)
const skillRef = id => 'skills/' + id;
export function renderIndex({ apiBase = selfApiBase(), project = null, mode = 'agent', locks = {}, packs = [], tools = [], coreApiRefPath = 'core-api.md', houseRules = false } = {}) {
  const lockStr = Object.keys(locks).length
    ? Object.entries(locks).map(([k, v]) => k + '=' + v).join(', ')
    : 'none';
  const L = [];
  L.push('<scout-index>');
  L.push('api: ' + apiBase);
  L.push('project: ' + (project || 'none') + '   mode: ' + (mode === 'manual' ? 'manual' : 'agent'));
  L.push('locks: ' + lockStr);
  L.push('');
  L.push('## Skill packs');
  if (packs.length) {
    for (const p of packs) {
      const desc = [p.description, p.triggers && ('triggers: ' + p.triggers)].filter(Boolean).join(' — ') || '(no description)';
      L.push(p.name + ' — ' + desc + ' [' + skillRef(p.id) + ']');
    }
  } else {
    L.push('(none enabled)');
  }
  L.push('');
  L.push('## Tools');
  if (tools.length) {
    for (const t of tools) {
      const dirs = t.directiveTypes && t.directiveTypes.length ? '  directives: ' + t.directiveTypes.join(', ') : '';
      L.push(t.id + ' — ' + t.capability + ' [' + (t.invocation || 'core-api') + ']' + dirs);
    }
  } else {
    L.push('(none enabled)');
  }
  if (houseRules) {
    L.push('');
    L.push('## House rules');
    L.push('house-rules — your standing preferences [' + skillRef('house-rules') + ']');
  }
  L.push('');
  L.push('## Core API');
  L.push(coreApiRefPath);
  L.push('</scout-index>');
  return L.join('\n');
}

// ── house-rules skill (seeded empty, user-editable, persistent) ──
const HOUSE_RULES_PLACEHOLDER = '(empty — add your standing preferences here and they load into every chat session.)';
export function seedHouseRules() {
  if (fs.existsSync(houseRulesFile())) return houseRulesFile();
  fs.mkdirSync(houseRulesDir(), { recursive: true });
  const body = [
    '---',
    'name: house-rules',
    'description: Your standing preferences for the Scout chat agent. Editable.',
    'user-editable: true',
    '---',
    '',
    '# House rules',
    '',
    HOUSE_RULES_PLACEHOLDER,
    ''
  ].join('\n');
  fs.writeFileSync(houseRulesFile(), body);
  return houseRulesFile();
}
// A house-rules skill is "active" (and thus listed in the Index + loaded by the router) only once the
// user has replaced the seeded placeholder with real content.
export function houseRulesActive(content) {
  const src = content != null ? String(content) : (() => { try { return fs.readFileSync(houseRulesFile(), 'utf8'); } catch { return ''; } })();
  const body = src.replace(/^---[\s\S]*?---/, '').replace(/^#.*$/m, '').trim();
  if (!body) return false;
  return !body.includes(HOUSE_RULES_PLACEHOLDER);
}
export function readHouseRules() {
  seedHouseRules();
  const content = fs.readFileSync(houseRulesFile(), 'utf8');
  return { content, active: houseRulesActive(content) };
}
export function writeHouseRules(content) {
  fs.mkdirSync(houseRulesDir(), { recursive: true });
  fs.writeFileSync(houseRulesFile(), String(content ?? ''));
  return readHouseRules();
}

// ── copy / mount helpers ──
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('._')) continue; // AppleDouble sidecars — never real source
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isSymbolicLink()) { try { fs.symlinkSync(fs.readlinkSync(s), d); } catch { /* skip */ } }
    else fs.copyFileSync(s, d);
  }
}
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone */ } }
// Mount a pack into the home: symlink (keeps the file tree intact + zero-copy, never modified),
// falling back to a copy where symlinks aren't available (some FS/OS combos). BUILT-IN packs (shipped
// with the app) are always COPIED fresh from source — exactly like the router — so a tamper of the
// mounted copy is wiped on the next prepare and can never reach back into the source tree.
function mountPack(pack, skillsDir) {
  const dst = path.join(skillsDir, pack.id);
  rmrf(dst);
  if (pack.builtin) { copyTree(pack.dir, dst); return 'builtin'; }
  try { fs.symlinkSync(pack.dir, dst, 'dir'); return 'symlink'; }
  catch { copyTree(pack.dir, dst); return 'copy'; }
}

// ── the data-driven isolation profiles ──
// env: layered on top of jobs.mjs agentEnv(). args: session-scoped CLI flags. carry: files linked
// from the REAL user config dir into the isolated home so subscription auth survives isolation.
// keychainService: the macOS fallback for when `carry` finds nothing — a keychain install writes no
// credentials file at all, and isolation blocks the keychain, so the token has to be materialised.
// See carryKeychainAuth() for the secret-at-rest trade-off that implies.
export const ISOLATION_PROFILES = {
  claude: {
    env: ({ home }) => ({ CLAUDE_CONFIG_DIR: home }),
    // Isolation is CLAUDE_CONFIG_DIR: the buyer's global ~/.claude is no longer the config dir, so
    // their global skills/plugins/settings never load. Our OWN skills live at the (relocated) user
    // source, so we deliberately do NOT pass --setting-sources project — that would exclude the
    // `user` source and drop the router/house-rules/packs with it. --add-dir makes the generated
    // Core-API ref + skill files readable once tools are enabled.
    args: ({ home }) => ['--add-dir', home],
    carry: ['.credentials.json'],
    keychainService: 'Claude Code-credentials'
  },
  // codex keeps its auth in ~/.codex and is not config-dir-relocated, so nothing to carry.
  generic: { env: () => ({}), args: () => [], carry: [] }
};
export function isolationProfile(command) {
  const base = String(command || 'claude').split('/').pop().toLowerCase();
  return /claude/.test(base) ? ISOLATION_PROFILES.claude : ISOLATION_PROFILES.generic;
}

// Carry auth files from the real user config dir into the isolated home so a subscription CLI still
// authenticates. On macOS auth is keychain-based (nothing to carry); this covers token-file installs.
// Link (never copy) any real credentials FILE into the home, so a file-based install keeps working
// with the token stored in exactly one place. Returns the auth env for the keychain case.
function carryAuth(home, profile) {
  const realHome = process.env.CLAUDE_CONFIG_DIR_REAL || path.join(os.homedir(), '.claude');
  let carried = false;
  for (const rel of profile.carry || []) {
    const src = path.join(realHome, rel), dst = path.join(home, rel);
    try {
      // A REGULAR file here is a materialised secret from an older build of this function. Remove
      // it: the token now travels in the environment and must not persist in the datastore.
      if (fs.existsSync(dst)) {
        if (fs.lstatSync(dst).isSymbolicLink()) { carried = true; continue; }
        fs.rmSync(dst, { force: true });
      }
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.symlinkSync(src, dst);
        carried = true;
      }
    } catch { /* auth carry is best-effort */ }
  }
  return carried ? {} : keychainAuthEnv(home, profile);
}

// macOS keychain auth. The file-based carry above silently no-ops on a keychain install, because a
// subscription login on darwin stores its OAuth token in the login keychain and writes NO
// `.credentials.json` at all — and relocating CLAUDE_CONFIG_DIR cuts the CLI off from that keychain
// entry, so an isolated session reports "Not logged in · Please run /login" while the very same
// binary authenticates fine outside isolation.
//
// The token therefore has to be handed to the child explicitly. We pass it in the ENVIRONMENT
// (CLAUDE_CODE_OAUTH_TOKEN) and never write it to disk: the secret lives only in the child process's
// memory and dies with it, instead of sitting in the datastore until cleanup. Verified: with a
// relocated config dir and this env var set, the CLI authenticates and writes no credentials file.
//
// keychainServiceFor() mirrors how Claude Code itself namespaces profiles — a relocated config dir
// gets `Claude Code-credentials-<sha256(dir)[:8]>`. We check the session home's own hashed entry
// first (so a session that was ever logged into directly keeps its own identity), then fall back to
// the default entry to inherit the user's normal login. That fallback is deliberate and is where we
// differ from a profile manager: Scout chat sessions are ephemeral views of ONE logged-in user,
// not separate accounts, so inheriting is correct rather than a cross-profile leak.
export function keychainServiceFor(base, configDir) {
  if (!configDir) return base;
  return base + '-' + createHash('sha256').update(configDir).digest('hex').slice(0, 8);
}
function readKeychainToken(service) {
  try {
    const r = spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) return null;
    const blob = String(r.stdout || '').trim();
    if (!blob.startsWith('{')) return null;
    const token = JSON.parse(blob)?.claudeAiOauth?.accessToken;
    // Subscription OAuth tokens are `sk-ant-oat01-…`. Anything else (notably an `enc:` blob we
    // cannot decrypt, or an API key) is not something we hand to the child.
    return typeof token === 'string' && token.startsWith('sk-ant-oat01-') ? token : null;
  } catch { return null; } // locked keychain / no entry → session is simply unauthenticated
}
function keychainAuthEnv(home, profile) {
  const base = profile.keychainService;
  if (!base || process.platform !== 'darwin') return {};
  const token = readKeychainToken(keychainServiceFor(base, home)) || readKeychainToken(base);
  return token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {};
}

// ── the whole thing: prepare a session's isolated home ──
// Idempotent + safe to call on EVERY session start / turn. Refreshes the router copy (tamper-reset),
// remounts the currently-enabled packs, regenerates the Index + Core-API ref against live state.
// Returns everything the runner needs to spawn an isolated, Index-aware CLI.
export function prepareAgentHome({ session = {}, apiBase = selfApiBase() } = {}) {
  const home = agentHomeDir(session.id);
  const skillsDir = path.join(home, 'skills');
  // Fresh skills dir each prepare — this is the tamper-reset: any edit to a previous session copy of
  // the router (or a stale pack mount) is wiped and re-materialized from source.
  rmrf(skillsDir);
  fs.mkdirSync(skillsDir, { recursive: true });

  // 1) router skill — always the fresh system copy from the backend source tree
  copyTree(SYSTEM_ROUTER_SRC, path.join(skillsDir, 'scout-router'));

  // 2) house-rules — seeded (empty) if missing, then copied in from its persistent canonical source
  seedHouseRules();
  copyTree(houseRulesDir(), path.join(skillsDir, 'house-rules'));
  const hr = readHouseRules();

  // 3) the tool builder — ONLY for a kind:'toolsmith' session. This is how the "+ New tool" button
  // "loads the skill": no pack toggle, no user setup, just a session born with it mounted.
  const toolsmith = session.kind === 'toolsmith';
  if (toolsmith) copyTree(SYSTEM_TOOLSMITH_SRC, path.join(skillsDir, 'scout-toolsmith'));

  // 4) enabled packs — mounted with file trees intact (symlink, else copy)
  // The toolsmith rides in this list rather than in an Index section of its own, deliberately: the
  // router already knows how to handle a pack ("one pack matches → load its SKILL.md and follow it
  // verbatim"), and inventing a new section would mean teaching the router a second contract. Its
  // Index line comes from its OWN frontmatter, exactly like every other pack.
  const packs = enabledPacks();
  if (toolsmith) {
    const fm = packFrontmatter(SYSTEM_TOOLSMITH_SRC);
    packs.unshift({ id: 'scout-toolsmith', name: 'scout-toolsmith', description: fm.description, triggers: fm.triggers });
  }
  // the toolsmith entry carries no `dir` — it is already copied above, so it is Index-only here
  const mounts = packs.filter(p => p.dir).map(p => ({ id: p.id, name: p.name, mode: mountPack(p, skillsDir) }));

  // 5) enabled USER tools — the filmmaker's own authored instructions, copied (never symlinked: the
  // source lives in the live datastore and the tamper-reset must not be able to reach back into it).
  // Prefixed `tool-` so an authored id can never shadow scout-router / house-rules / a pack.
  // Hoisted above the mount loop: tool enablement is PER PROJECT, so which tools get mounted into
  // this session home — not just which ones the Index lists — depends on the session's project.
  // A standalone session passes null and resolves against the global defaults alone.
  const project = session.project || null;
  const userMounts = [];
  for (const t of enabledTools(project)) {
    if (!t.skillDir) continue;
    const dst = path.join(skillsDir, mountName(t.id));
    // rmrf FIRST — non-negotiable. Step 4 mounts packs as SYMLINKS, and copyTree() only does
    // mkdirSync(recursive), which silently no-ops on an existing symlink-to-directory and then
    // copies THROUGH it. A repo pack whose directory is literally named `tool-<id>` (pack ids are
    // safe(basename), which preserves dashes) would therefore have its real source SKILL.md
    // overwritten — a write outside the session home and outside the storage root, into a tree we
    // promise only ever to read. mountPack() already rmrf's for exactly this reason.
    rmrf(dst);
    try { copyTree(t.skillDir, dst); userMounts.push(t.id); }
    catch { /* a tool that vanished mid-session must not break the turn */ }
  }

  // 6) generated Core-API reference the Index points at
  const coreApiRel = 'core-api.md';
  fs.writeFileSync(path.join(home, coreApiRel), renderCoreApiRef(apiBase));

  // 7) the Index itself
  const indexText = renderIndex({
    apiBase, project,
    mode: session.mode || 'agent',
    locks: locksForProject(project),
    packs, tools: enabledTools(project),
    coreApiRefPath: coreApiRel,
    houseRules: hr.active
  });
  const indexPath = path.join(home, 'INDEX.md');
  fs.writeFileSync(indexPath, indexText + '\n');

  // isolation hygiene: a self-contained settings.json so nothing user-global reads through the
  // relocated config dir — WITH the baseline permission allowlist. Headless -p auto-denies any
  // non-pre-approved tool call, so without these rules the session can't even curl the local API
  // and starts explaining permission walls to a filmmaker. Same baseline as the runner's
  // --allowedTools (belt and braces: flag pre-approves, settings allow survives resumes).
  try {
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['Bash(curl:*)', 'Bash(node:*)', 'Bash(python3:*)', 'Bash(python:*)', 'Read', 'Glob', 'Grep']
      }
    }, null, 2) + '\n');
  } catch { /* non-fatal */ }

  const profile = isolationProfile(session.agentCommand || getSettings().agentCommand || 'claude');
  const authEnv = carryAuth(home, profile);
  const env = { ...profile.env({ home, indexPath }), ...authEnv };
  const extraArgs = profile.args({ home, indexPath });

  return { home, skillsDir, indexText, indexPath, coreApiRefPath: path.join(home, coreApiRel), mounts, userMounts, toolsmith, env, extraArgs, houseRulesActive: hr.active };
}

// The system-prompt appendix that injects the Index into a headless run and binds the session to the
// router skill (the SKILL.md itself is never edited — the Index is "injected at session start").
export function indexInjection(indexText) {
  return [
    'You are operating as the Scout chat orchestrator. Load and follow the `scout-router`',
    'skill in this session. It contains no capability itself — everything you can do is enumerated in',
    'this session\'s Index below. Anything not in the Index does not exist here.',
    '',
    String(indexText || '')
  ].join('\n');
}

// Best-effort cleanup of a session's home (e.g. on delete). Never touches pack sources — the mounts
// are symlinks/copies under the home only.
export function cleanupAgentHome(sessionId) { rmrf(agentHomeDir(sessionId)); }

// ── skills surface for the Skills page (read-only router + editable house-rules + pack toggles) ──
// The frontend Skills page (App.jsx, owned elsewhere) consumes this to render the router read-only
// with a system badge and the house-rules editor. Exposed as data so no router content is ever
// duplicated into the UI.
// Routes for the isolated-home / router surface. Registered from index.mjs with one line. Toggles
// persist through the existing settings store (sparse maps → default OFF), so a new pack/tool added
// later arrives with its intended default instead of frozen off.
export function registerAgentHomeRoutes(app, deps = {}) {
  const saveSettings = deps.saveSettings;
  const appendActivity = deps.appendActivity || (() => {});

  // Skills page data: router (read-only, system badge), house-rules (editable), packs, tools.
  app.get('/api/chat/skills', (req, res) => res.json(chatSkillsSurface()));

  // router pack files (read-only): the router is a full pack — SKILL.md + references/ + scripts/.
  // rel is resolved inside the source dir only; traversal escapes 400.
  app.get('/api/chat/skills/router/file', (req, res) => {
    const rel = String(req.query.rel || 'SKILL.md');
    const abs = path.resolve(SYSTEM_ROUTER_SRC, rel);
    if (!abs.startsWith(SYSTEM_ROUTER_SRC + path.sep) && abs !== path.join(SYSTEM_ROUTER_SRC, 'SKILL.md')) {
      return res.status(400).json({ error: 'path escapes the router pack' });
    }
    try { res.json({ rel, content: fs.readFileSync(abs, 'utf8') }); }
    catch { res.status(404).json({ error: 'no such file in the router pack' }); }
  });

  // house-rules: read + write the user's persistent, editable extension skill.
  app.get('/api/chat/house-rules', (req, res) => res.json(readHouseRules()));
  app.put('/api/chat/house-rules', (req, res) => {
    const out = writeHouseRules(String(req.body?.content ?? ''));
    appendActivity({ dot: 'amber', t: 'House rules updated', t2: out.active ? '· active' : '· cleared', s: 'chat agent standing preferences', kind: 'skills' });
    res.json(out);
  });

  // toggle a skill pack on/off for the NEXT session's Index (disabled = absent, not refused).
  app.post('/api/chat/skills/pack/:id/toggle', (req, res) => {
    if (!saveSettings) return res.status(500).json({ error: 'settings unavailable' });
    const id = safe(String(req.params.id));
    const map = { ...(getSettings().enabledSkillPacks || {}) };
    map[id] = req.body?.enabled === false ? false : true;
    saveSettings({ enabledSkillPacks: map });
    res.json({ id, enabled: map[id], packs: listSkillPacks() });
  });

  // toggle a chat tool GLOBALLY — the default every project inherits until it has its own opinion,
  // and the only layer a standalone (project-less) session ever sees. Per-project enablement is the
  // route below; that is what the chat's TOOLS rail drives.
  app.post('/api/chat/tools/:id/toggle', (req, res) => {
    if (!saveSettings) return res.status(500).json({ error: 'settings unavailable' });
    const id = safe(String(req.params.id));
    const map = { ...(getSettings().enabledChatTools || {}) };
    map[id] = req.body?.enabled === false ? false : true;
    saveSettings({ enabledChatTools: map });
    res.json({ id, enabled: map[id], tools: listChatTools() });
  });

  // toggle a chat tool FOR ONE PROJECT — written to that project's project.md, so two projects in the
  // same install can run different tool sets. `enabled: null` clears the project's opinion and the
  // tool falls back to the global default (the rail's third state, and the only way back to it).
  app.post('/api/projects/:pid/tools/:id/toggle', (req, res) => {
    const pid = safeScope(String(req.params.pid));
    const id = safe(String(req.params.id));
    if (!pid || !fs.existsSync(paths.projectMd(pid))) return res.status(404).json({ error: 'project not found' });
    const enabled = req.body?.enabled === null ? null : req.body?.enabled === false ? false : true;
    let map;
    try { map = setProjectTool(pid, id, enabled); }
    catch (e) { return res.status(500).json({ error: e.message }); }
    const tools = listChatTools(pid);
    const tool = tools.find(t => t.id === id);
    appendActivity({
      dot: enabled === null ? 'grey' : enabled ? 'green' : 'amber',
      t: 'Tool ' + (enabled === null ? 'inherited' : enabled ? 'enabled' : 'disabled'),
      t2: '· ' + ((tool && tool.name) || id), s: 'project ' + pid, kind: 'skills'
    });
    res.json({ pid, id, enabled: tool ? tool.enabled : !!enabled, scope: tool ? tool.scope : 'project', enabledTools: map, tools });
  });

  // render the Index a given session would run with (the pointer target, for the UI + acceptance).
  app.get('/api/chat/sessions/:id/index', (req, res) => {
    const getSession = deps.getSession;
    const session = getSession ? getSession(req.params.id) : { id: req.params.id };
    if (!session) return res.status(404).json({ error: 'session not found' });
    const home = prepareAgentHome({ session, apiBase: selfApiBase() });
    res.json({ index: home.indexText, home: home.home, coreApiRef: home.coreApiRefPath, mounts: home.mounts, houseRulesActive: home.houseRulesActive });
  });
}

export function chatSkillsSurface() {
  let routerContent = '', routerDescription = '';
  try {
    const { data, content } = readMd(path.join(SYSTEM_ROUTER_SRC, 'SKILL.md'));
    routerDescription = String(data.description || '');
    routerContent = content;
  } catch { /* source missing — should never happen */ }
  // The router is a full pack: SKILL.md + references/ + scripts/. List every file so the
  // Skills page shows the real shape, not a naked SKILL.md.
  const routerFiles = [];
  const walk = (dir, prefix = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.startsWith('._')) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + e.name + '/');
      else routerFiles.push({ rel: prefix + e.name, size: fs.statSync(path.join(dir, e.name)).size });
    }
  };
  try { walk(SYSTEM_ROUTER_SRC); } catch { /* source missing */ }
  routerFiles.sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : a.rel.localeCompare(b.rel)));
  const hr = readHouseRules();
  return {
    router: { name: 'scout-router', description: routerDescription, content: routerContent, system: true, readOnly: true, files: routerFiles },
    houseRules: { name: 'house-rules', content: hr.content, active: hr.active, editable: true },
    packs: listSkillPacks().map(p => ({ id: p.id, name: p.name, repo: p.repo, description: p.description, triggers: p.triggers, enabled: p.enabled, builtin: !!p.builtin, files: p.files.length })),
    tools: listChatTools()
  };
}
