// Ticket 10 — router skill, session Index, isolated agent home.
// Hermetic: no CLI is ever spawned. We exercise the Index renderer (packs/tools/locks/omission),
// pack mounting, the tamper-reset of the system router copy, house-rules seeding/activation, and the
// isolation guarantee (the home's skills dir excludes anything from a global skill dir), plus the
// HTTP surface the Skills page consumes.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsx from 'node:fs';
import { freshRoot, seedProject, req, getStorageRoot, writeMd, readMd, fs, path, paths } from './helpers.mjs';
import { saveSettings } from '../backend/store.mjs';
import {
  renderIndex, renderCoreApiRef, prepareAgentHome, agentHomeDir, systemRouterDir,
  listSkillPacks, packId, readHouseRules, writeHouseRules, houseRulesActive,
  registerChatTool, clearChatTools, listChatTools, chatSkillsSurface
} from '../backend/agentHome.mjs';

// ── build a fake global skill dir + a mountable multi-file pack repo ──
function seedGlobalSkill(name, desc = 'a global-only skill that must never leak into chat') {
  const dir = path.join(getStorageRoot(), 'fake-global-skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`);
  return dir;
}
// A large multi-file pack: SKILL.md (with triggers) + a reference file + a script, file tree intact.
function seedPackRepo(repoName, packName) {
  const root = path.join(getStorageRoot(), 'packs', repoName);
  const pack = path.join(root, packName);
  fs.mkdirSync(path.join(pack, 'reference'), { recursive: true });
  fs.mkdirSync(path.join(pack, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pack, 'SKILL.md'),
    `---\nname: ${packName}\ndescription: Storyboard the whole film cheaply.\ntriggers: storyboard, contact sheet, 3x3\n---\n# ${packName}\n`);
  fs.writeFileSync(path.join(pack, 'reference', 'grid.md'), '# grid reference\n');
  fs.writeFileSync(path.join(pack, 'scripts', 'split.mjs'), 'console.log("split");\n');
  // point the skill-repos setting at the repo root (scanSkillRepos discovers the pack inside it)
  saveSettings({ skillRepos: [{ name: repoName, paths: [root] }] });
  return { root, pack, id: packId(pack) };
}

// ── the Index renderer (pure) ──
test('Index renders api/project/mode/locks and one line per enabled pack + tool', () => {
  const idx = renderIndex({
    apiBase: 'http://127.0.0.1:5176', project: 'neon', mode: 'agent',
    locks: { style: 'st-42', cast: 'c-1' },
    packs: [{ id: 'storyboard', name: 'storyboard', description: 'Storyboard cheaply', triggers: '3x3' }],
    tools: [{ id: 'grid-split', capability: 'split a grid into frames', invocation: 'POST /api/grid/split', directiveTypes: ['show.grid'] }],
    coreApiRefPath: 'core-api.md', houseRules: false
  });
  assert.match(idx, /^<scout-index>/);
  assert.match(idx, /api: http:\/\/127\.0\.0\.1:5176/);
  assert.match(idx, /project: neon {3}mode: agent/);
  assert.match(idx, /locks: style=st-42, cast=c-1/);
  assert.match(idx, /storyboard — Storyboard cheaply — triggers: 3x3 \[skills\/storyboard\]/);
  assert.match(idx, /grid-split — split a grid into frames \[POST \/api\/grid\/split\] {2}directives: show\.grid/);
  assert.match(idx, /## Core API\ncore-api\.md/);
  assert.doesNotMatch(idx, /House rules/); // omitted when inactive
});

test('Index omits disabled entries entirely (no pack/tool => "(none enabled)")', () => {
  const idx = renderIndex({ apiBase: 'http://127.0.0.1:5176', project: null, mode: 'manual', packs: [], tools: [] });
  assert.match(idx, /project: none {3}mode: manual/);
  assert.match(idx, /locks: none/);
  assert.match(idx, /## Skill packs\n\(none enabled\)/);
  assert.match(idx, /## Tools\n\(none enabled\)/);
});

test('Index lists house-rules only when active', () => {
  const idx = renderIndex({ packs: [], tools: [], houseRules: true });
  assert.match(idx, /## House rules\nhouse-rules — your standing preferences \[skills\/house-rules\]/);
});

test('Core API reference is generated from declared route metadata', () => {
  const ref = renderCoreApiRef('http://127.0.0.1:5199');
  assert.match(ref, /http:\/\/127\.0\.0\.1:5199/);
  assert.match(ref, /\/api\/collections/);
  assert.match(ref, /\/api\/chat\/sessions/);
  assert.match(ref, /\| Method \| Path \| What it does \|/);
});

// This reference is injected into EVERY agent session, so a stale line here is not a lint problem —
// an agent following it gets a 404 in the middle of a job, with no warning. It sat at 18 routes of
// which 17 had been deleted with the film domain, and the test above passed the whole time because
// it only checked that SOME route was present.
//
// The corpus is the ROUTE REGISTRATIONS, not the source text. The first version of this guard
// searched every backend .mjs — which includes agentHome.mjs itself, so each advertised path
// matched its own declaration and the test passed with a route called
// '/api/definitely-not-a-route' in the list. A guard has to be shown to fail.
test('every route the agent reference advertises is actually registered', async () => {
  const { CORE_API_ROUTES } = await import('../backend/agentHome.mjs');
  const dir = new URL('../backend/', import.meta.url);
  const registered = new Set();
  for (const file of fsx.readdirSync(dir).filter(x => x.endsWith('.mjs'))) {
    const src = fsx.readFileSync(new URL(file, dir), 'utf8');
    for (const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) registered.add(m[2]);
  }
  assert.ok(registered.size > 40, 'sanity: found ' + registered.size + ' registered routes');
  const missing = CORE_API_ROUTES.map(r => r.path).filter(p => !registered.has(p));
  assert.deepEqual(missing, [], 'advertised to every agent session but never registered: ' + missing.join(', '));
});

// ── pack listing + enablement ──
test('a skill-repo pack lists disabled by default and enables via settings', () => {
  freshRoot();
  const { id } = seedPackRepo('house-packs', 'storyboard-flow');
  let packs = listSkillPacks();
  const p = packs.find(x => x.id === id);
  assert.ok(p, 'pack not discovered from skill-repos');
  assert.equal(p.enabled, false, 'packs must default OFF');
  assert.match(p.triggers, /storyboard/); // triggers come from the pack's OWN frontmatter
  saveSettings({ enabledSkillPacks: { [id]: true } });
  packs = listSkillPacks();
  assert.equal(packs.find(x => x.id === id).enabled, true);
});

// ── prepare the isolated home ──
test('prepareAgentHome mounts only enabled packs; disabled ones are absent', () => {
  freshRoot();
  const { id, pack } = seedPackRepo('house-packs', 'storyboard-flow');
  saveSettings({ enabledSkillPacks: { [id]: true } });

  const session = { id: 'chat-iso-1', project: null, mode: 'agent', agentCommand: 'claude' };
  const home = prepareAgentHome({ session, apiBase: 'http://127.0.0.1:5176' });
  const skillsDir = path.join(home.home, 'skills');

  // the pack's file tree is intact under the home
  assert.ok(fs.existsSync(path.join(skillsDir, id, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(skillsDir, id, 'reference', 'grid.md')));
  assert.ok(fs.existsSync(path.join(skillsDir, id, 'scripts', 'split.mjs')));
  // and the pack SOURCE was never modified
  assert.equal(fs.readFileSync(path.join(pack, 'scripts', 'split.mjs'), 'utf8'), 'console.log("split");\n');

  // the Index carries exactly one line for the pack, pointing at its mounted path
  assert.match(home.indexText, new RegExp('storyboard-flow — Storyboard the whole film cheaply.*\\[skills/' + id + '\\]'));

  // disable it → next prepare drops it from both the home and the Index
  saveSettings({ enabledSkillPacks: { [id]: false } });
  const home2 = prepareAgentHome({ session, apiBase: 'http://127.0.0.1:5176' });
  assert.equal(fs.existsSync(path.join(home2.home, 'skills', id)), false, 'disabled pack still mounted');
  assert.doesNotMatch(home2.indexText, new RegExp(id));
  assert.match(home2.indexText, /\(none enabled\)/);
});

test('isolation: the home skills dir excludes global skills; env relocates the config dir', () => {
  freshRoot();
  seedGlobalSkill('leak-me'); // present in a *global* dir the buyer might have
  const { id } = seedPackRepo('house-packs', 'storyboard-flow');
  saveSettings({ enabledSkillPacks: { [id]: true } });

  const session = { id: 'chat-iso-2', project: null, mode: 'agent', agentCommand: 'claude' };
  const home = prepareAgentHome({ session });
  const mounted = fs.readdirSync(path.join(home.home, 'skills')).sort();
  // EXACTLY: router (system copy) + house-rules + the one enabled repo pack — nothing global. The
  // film workflow packs (storyboard-workflow among them) went with the film domain on 2026-08-19;
  // BUILTIN_PACKS is now [] (backend/agentHome.mjs), so no built-in pack mounts by default any more.
  assert.deepEqual(mounted, ['scout-router', 'house-rules', id].sort());
  assert.equal(mounted.includes('leak-me'), false, 'a global skill leaked into the isolated home');

  // the isolation env points the CLI at the home (so ~/.claude/skills never loads)
  assert.equal(home.env.CLAUDE_CONFIG_DIR, home.home);
  assert.ok(home.extraArgs.includes('--add-dir'));
  // the generated Core-API reference exists at the Index's pointer target
  assert.ok(fs.existsSync(home.coreApiRefPath));
});

test('tamper-reset: an edit to the session router copy is overwritten on next prepare', () => {
  freshRoot();
  const session = { id: 'chat-tamper', project: null, mode: 'agent', agentCommand: 'claude' };
  prepareAgentHome({ session });
  const copy = path.join(agentHomeDir(session.id), 'skills', 'scout-router', 'SKILL.md');
  fs.writeFileSync(copy, '# TAMPERED — pack rules bypassed\n');
  assert.match(fs.readFileSync(copy, 'utf8'), /TAMPERED/);

  prepareAgentHome({ session }); // next session start
  const fresh = fs.readFileSync(copy, 'utf8');
  const source = fs.readFileSync(path.join(systemRouterDir(), 'SKILL.md'), 'utf8');
  assert.equal(fresh, source, 'router copy was not reset from source');
  assert.doesNotMatch(fresh, /TAMPERED/);
});

// ── house rules ──
test('house-rules is seeded empty (inactive), and becomes active + Index-listed when edited', () => {
  freshRoot();
  const seeded = readHouseRules();
  assert.equal(seeded.active, false, 'seeded house-rules must be inactive');
  assert.equal(houseRulesActive(seeded.content), false);

  const session = { id: 'chat-hr', project: null, mode: 'agent', agentCommand: 'claude' };
  let home = prepareAgentHome({ session });
  assert.doesNotMatch(home.indexText, /House rules/); // inactive → absent

  writeHouseRules('---\nname: house-rules\n---\n# House rules\n\nAlways prefer the cheap preview model first.\n');
  assert.equal(readHouseRules().active, true);
  home = prepareAgentHome({ session });
  assert.match(home.indexText, /## House rules/); // active → listed
  // the edited content is mounted into the home
  assert.match(fs.readFileSync(path.join(home.home, 'skills', 'house-rules', 'SKILL.md'), 'utf8'), /cheap preview model first/);
});

// ── locks come from the project record (ids only) ──
test('Index reflects the project style lock id', () => {
  freshRoot();
  seedProject('neon', { styleLock: 'st-neon-7' });
  const home = prepareAgentHome({ session: { id: 'chat-lock', project: 'neon', mode: 'agent' } });
  assert.match(home.indexText, /locks: style=st-neon-7/);
});

// ── the chat-tools registry seam (ticket 15) ──
test('registered chat tools default OFF and only enabled ones enter the Index', () => {
  freshRoot();
  clearChatTools();
  registerChatTool({ id: 'grid-split', capability: 'split a grid', invocation: 'POST /api/grid/split', directiveTypes: ['show.grid'] });
  assert.equal(listChatTools().find(t => t.id === 'grid-split').enabled, false);
  let home = prepareAgentHome({ session: { id: 'chat-tools' } });
  assert.match(home.indexText, /## Tools\n\(none enabled\)/);
  saveSettings({ enabledChatTools: { 'grid-split': true } });
  home = prepareAgentHome({ session: { id: 'chat-tools' } });
  assert.match(home.indexText, /grid-split — split a grid \[POST \/api\/grid\/split\]/);
  clearChatTools();
});

// ── HTTP surface for the Skills page ──
test('GET /api/chat/skills exposes router read-only (system) + editable house-rules + packs', async () => {
  freshRoot();
  const { id } = seedPackRepo('house-packs', 'storyboard-flow');
  const r = await req('GET', '/api/chat/skills');
  assert.equal(r.status, 200);
  assert.equal(r.body.router.system, true);
  assert.equal(r.body.router.readOnly, true);
  // pin to the stable identity, not prose — the skill body is under active revision
  assert.equal(r.body.router.name, 'scout-router');
  assert.ok(String(r.body.router.content || '').length > 100);
  assert.equal(r.body.houseRules.editable, true);
  assert.ok(r.body.packs.find(p => p.id === id));
});

test('PUT /api/chat/house-rules persists content and flips active', async () => {
  freshRoot();
  let r = await req('PUT', '/api/chat/house-rules', { content: '---\nname: house-rules\n---\n# rules\n\nShoot wide first.\n' });
  assert.equal(r.status, 200);
  assert.equal(r.body.active, true);
  r = await req('GET', '/api/chat/house-rules');
  assert.match(r.body.content, /Shoot wide first/);
});

test('toggling a pack changes the next session Index via the HTTP route', async () => {
  freshRoot();
  seedProject('neon');
  const { id } = seedPackRepo('house-packs', 'storyboard-flow');
  // a real chat session so /index can resolve it
  const cs = await req('POST', '/api/chat/sessions', { project: 'neon' });
  const sid = cs.body.id;

  let idx = await req('GET', '/api/chat/sessions/' + sid + '/index');
  assert.match(idx.body.index, /\(none enabled\)/);

  const tog = await req('POST', '/api/chat/skills/pack/' + id + '/toggle', { enabled: true });
  assert.equal(tog.body.enabled, true);

  idx = await req('GET', '/api/chat/sessions/' + sid + '/index');
  assert.match(idx.body.index, new RegExp('\\[skills/' + id + '\\]'));
  assert.ok(fs.existsSync(idx.body.coreApiRef));
});
