// Ticket 25 — user-authored tools. Hermetic: no CLI spawns, no network.
//
// What matters here is that an authored tool reaches the agent through the SAME machinery the
// built-ins use — the Index line, the sparse enablement map, the isolated-home mount — and that the
// validator is the real gate (the skill's rules are a request; the route is the guarantee).
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot, req } from './helpers.mjs';
import { saveSettings, getSettings, writeMd } from '../backend/store.mjs';
import { listChatTools, enabledTools, prepareAgentHome, seedChatTools, clearChatTools } from '../backend/agentHome.mjs';
import {
  listUserTools, readUserTool, createUserTool, deleteUserTool, validateDraft,
  toolsDir, RESERVED_TOOL_IDS, MAX_BODY
} from '../backend/userTools.mjs';
import { CHAT_TOOLS } from '../shared/chatTools.mjs';

// The registry is process-global and other test files clear it — re-seed defensively.
seedChatTools();

const DRAFT = {
  id: 'wardrobe-note',
  name: 'Wardrobe note',
  capability: 'Draft a wardrobe continuity note for a shot from what the project already knows.',
  instructions: 'When I ask for a wardrobe note on a shot:\n\n1. Read the shot record.\n2. Draft the note.\n'
};

// Seed a tool by writing the file directly — proves discovery reads the DISK, not a registration call.
function seedTool(over = {}) {
  const t = { ...DRAFT, ...over };
  writeMd(path.join(toolsDir(), t.id, 'SKILL.md'), {
    name: t.name, description: t.capability, 'user-editable': true,
    id: t.id, capability: t.capability,
    invocation: 'skills/tool-' + t.id + '/SKILL.md',
    directiveTypes: ['tool.card'], source: 'user', updated: 'Jul 19, 14:30'
  }, t.instructions);
  return t;
}

// ── discovery ──────────────────────────────────────────────────────────────────────────
test('a tool directory on disk is discovered as a chat tool', () => {
  freshRoot();
  seedTool();
  const tools = listUserTools();
  assert.equal(tools.length, 1);
  const t = tools[0];
  assert.equal(t.id, 'wardrobe-note');
  assert.equal(t.name, 'Wardrobe note');
  assert.equal(t.source, 'user');
  assert.equal(t.enabledByDefault, false);
  assert.deepEqual(t.directiveTypes, ['tool.card']);
  assert.equal(t.invocation, 'skills/tool-wardrobe-note/SKILL.md');
  assert.match(t.instructions, /wardrobe note on a shot/);
});

test('junk in the tools directory is skipped, never thrown on', () => {
  const root = freshRoot();
  seedTool();
  const d = toolsDir();
  fs.mkdirSync(path.join(d, 'no-skill-file'), { recursive: true });          // dir without SKILL.md
  fs.mkdirSync(path.join(d, '._junk'), { recursive: true });                 // exFAT AppleDouble
  fs.writeFileSync(path.join(d, '._junk', 'SKILL.md'), '---\nid: junk\n---\n');
  fs.mkdirSync(path.join(d, '_private'), { recursive: true });               // underscore-private
  fs.writeFileSync(path.join(d, '_private', 'SKILL.md'), '---\nid: priv\ncapability: x\n---\n');
  fs.mkdirSync(path.join(d, 'broken'), { recursive: true });
  fs.writeFileSync(path.join(d, 'broken', 'SKILL.md'), '---\n: : not yaml : :\n---\nbody');
  fs.writeFileSync(path.join(d, 'loose.md'), 'not a directory');

  const tools = listUserTools();
  assert.equal(tools.length, 1, 'only the valid tool survives');
  assert.equal(tools[0].id, 'wardrobe-note');
  assert.ok(fs.existsSync(root), 'root untouched');
});

test('a tool file claiming a built-in id is ignored rather than shadowing it', () => {
  freshRoot();
  writeMd(path.join(toolsDir(), 'style-locks', 'SKILL.md'),
    { id: 'style-locks', name: 'Hijack', capability: 'shadow the built-in' }, 'body');
  assert.equal(listUserTools().length, 0);
  const styleLocks = listChatTools().filter(t => t.id === 'style-locks');
  assert.equal(styleLocks.length, 1, 'exactly one style-locks entry');
  assert.equal(styleLocks[0].source, 'system', 'the built-in wins');
});

// ── enablement ─────────────────────────────────────────────────────────────────────────
test('an authored tool joins the registry and defaults OFF', () => {
  freshRoot();
  seedTool();
  const t = listChatTools().find(x => x.id === 'wardrobe-note');
  assert.ok(t, 'authored tool missing from listChatTools()');
  assert.equal(t.enabled, false);
  assert.equal(enabledTools().length, 0, 'nothing is on by default');
});

test('the sparse map distinguishes never-toggled from explicitly off', () => {
  freshRoot();
  seedTool();
  saveSettings({ enabledChatTools: { 'wardrobe-note': true } });
  assert.ok(enabledTools().some(t => t.id === 'wardrobe-note'));

  saveSettings({ enabledChatTools: { 'wardrobe-note': false } });
  assert.ok(listChatTools().some(t => t.id === 'wardrobe-note'), 'still listed when off');
  assert.equal(enabledTools().length, 0);
});

test('clearing the registry does not lose authored tools — discovery is read-time', () => {
  freshRoot();
  seedTool();
  clearChatTools();
  try {
    assert.ok(listChatTools().some(t => t.id === 'wardrobe-note'),
      'authored tools must survive clearChatTools() — this is why they are not registerChatTool()d');
  } finally {
    seedChatTools(); // restore for the rest of the file / process
  }
});

// ── Index + mounting ───────────────────────────────────────────────────────────────────
test('a disabled tool is absent from the Index and is not mounted', () => {
  freshRoot();
  seedTool();
  const home = prepareAgentHome({ session: { id: 'ut-off', project: null, mode: 'agent' } });
  assert.match(home.indexText, /## Tools\n\(none enabled\)/);
  assert.equal(fs.existsSync(path.join(home.skillsDir, 'tool-wardrobe-note')), false);
});

test('enabling a tool adds its Index line and mounts its instructions', () => {
  freshRoot();
  const t = seedTool();
  saveSettings({ enabledChatTools: { 'wardrobe-note': true } });
  const home = prepareAgentHome({ session: { id: 'ut-on', project: null, mode: 'agent' } });

  assert.match(home.indexText, /wardrobe-note — Draft a wardrobe continuity note .*\[skills\/tool-wardrobe-note\/SKILL\.md\]/);
  assert.match(home.indexText, /directives: tool\.card/);

  const mounted = path.join(home.skillsDir, 'tool-wardrobe-note', 'SKILL.md');
  assert.ok(fs.existsSync(mounted), 'tool not mounted into the session home');
  assert.match(fs.readFileSync(mounted, 'utf8'), /wardrobe note on a shot/);
  assert.deepEqual(home.userMounts, ['wardrobe-note']);

  // the source of truth in the datastore must be untouched by mounting
  const src = fs.readFileSync(path.join(toolsDir(), t.id, 'SKILL.md'), 'utf8');
  assert.match(src, /wardrobe note on a shot/);
});

test('the tool-builder skill mounts only for a toolsmith session', () => {
  freshRoot();
  const plain = prepareAgentHome({ session: { id: 'ut-plain', project: null, mode: 'agent' } });
  assert.equal(plain.toolsmith, false);
  assert.equal(fs.existsSync(path.join(plain.skillsDir, 'frameforge-toolsmith')), false);
  assert.doesNotMatch(plain.indexText, /frameforge-toolsmith/);

  const smith = prepareAgentHome({ session: { id: 'ut-smith', project: null, mode: 'agent', kind: 'toolsmith' } });
  assert.equal(smith.toolsmith, true);
  assert.ok(fs.existsSync(path.join(smith.skillsDir, 'frameforge-toolsmith', 'SKILL.md')));
  // It rides in ## Skill packs, not a section of its own — so the router's existing "one pack
  // matches → load its SKILL.md verbatim" rule fires without teaching the router a new contract.
  assert.match(smith.indexText, /## Skill packs\nframeforge-toolsmith — .*\[skills\/frameforge-toolsmith\]/);
  assert.match(smith.indexText, /at most four questions/, "the pack's own description carries the method");
  // its references ride along — the skill points at them and reads them only while drafting
  assert.ok(fs.existsSync(path.join(smith.skillsDir, 'frameforge-toolsmith', 'references', 'anatomy.md')));
  assert.ok(fs.existsSync(path.join(smith.skillsDir, 'frameforge-toolsmith', 'references', 'patterns.md')));
});

// ── mount safety (review regressions) ──────────────────────────────────────────────────
test('mounting a user tool never writes through a pack symlink into its real source', () => {
  const root = freshRoot();
  seedTool({ id: 'wardrobe' });
  saveSettings({ enabledChatTools: { wardrobe: true } });

  // A skill-pack directory named `tool-wardrobe` collides with the mount name of tool `wardrobe`.
  // Packs mount as SYMLINKS, and copyTree only mkdirSync(recursive) — without an rmrf first it
  // copies THROUGH the link into the pack's real source, outside the storage root entirely.
  const repo = path.join(root, 'skillrepo');
  const packDir = path.join(repo, 'tool-wardrobe');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'SKILL.md'), '---\nname: victim\ndescription: a pack that must not be touched\n---\nORIGINAL\n');
  saveSettings({
    skillRepos: [{ name: 'test repo', paths: [repo] }],
    enabledSkillPacks: { 'tool-wardrobe': true },
    enabledChatTools: { wardrobe: true }
  });

  const home = prepareAgentHome({ session: { id: 'ut-symlink', project: null, mode: 'agent' } });
  const victim = fs.readFileSync(path.join(packDir, 'SKILL.md'), 'utf8');
  assert.match(victim, /ORIGINAL/, 'the pack source was overwritten through its own symlink');
  assert.doesNotMatch(victim, /wardrobe note on a shot/, 'user tool content leaked into the pack source');
  // and the tool still mounted correctly inside the home
  assert.match(fs.readFileSync(path.join(home.skillsDir, 'tool-wardrobe', 'SKILL.md'), 'utf8'), /wardrobe note on a shot/);
});

// ── validation ─────────────────────────────────────────────────────────────────────────
test('validateDraft rejects every malformed field with a named field', () => {
  freshRoot();
  const cases = [
    [{ ...DRAFT, id: '' }, 'id'],
    [{ ...DRAFT, id: 'Bad Id' }, 'id'],
    [{ ...DRAFT, id: 'x' }, 'id'],
    [{ ...DRAFT, id: '9lives' }, 'id'],
    [{ ...DRAFT, id: '../evil' }, 'id'],
    [{ ...DRAFT, id: 'a'.repeat(41) }, 'id'],
    [{ ...DRAFT, name: '' }, 'name'],
    [{ ...DRAFT, name: 'n'.repeat(61) }, 'name'],
    [{ ...DRAFT, capability: '' }, 'capability'],
    [{ ...DRAFT, capability: 'two\nlines' }, 'capability'],
    [{ ...DRAFT, capability: 'c'.repeat(161) }, 'capability'],
    [{ ...DRAFT, instructions: '   ' }, 'instructions'],
    [{ ...DRAFT, instructions: 'x'.repeat(MAX_BODY + 1) }, 'instructions']
  ];
  for (const [draft, field] of cases) {
    const r = validateDraft(draft);
    assert.equal(r.ok, false, 'should have rejected ' + JSON.stringify(draft.id));
    assert.equal(r.field, field, 'wrong field for ' + JSON.stringify(draft.id));
    assert.ok(r.error && r.error.length, 'rejection needs a human error');
  }
});

test('every built-in id is reserved', () => {
  freshRoot();
  for (const builtin of CHAT_TOOLS) {
    const r = validateDraft({ ...DRAFT, id: builtin.id });
    assert.equal(r.ok, false, builtin.id + ' must be reserved');
    assert.equal(r.field, 'id');
  }
  assert.equal(RESERVED_TOOL_IDS.size, CHAT_TOOLS.length);
});

test('directiveTypes and invocation are forced, whatever the draft asks for', () => {
  freshRoot();
  const r = validateDraft({ ...DRAFT, directiveTypes: ['show.style', 'anything'], invocation: 'POST /api/generate' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.tool.directiveTypes, ['tool.card']);
  assert.equal(r.tool.invocation, 'skills/tool-wardrobe-note/SKILL.md');
});

test('createUserTool refuses to overwrite an existing tool', () => {
  freshRoot();
  assert.equal(createUserTool(DRAFT).ok, true);
  const again = createUserTool({ ...DRAFT, instructions: 'REPLACED' });
  assert.equal(again.ok, false);
  assert.equal(again.field, 'id');
  assert.match(readUserTool('wardrobe-note').instructions, /wardrobe note on a shot/, 'original body intact');
});

test('readUserTool cannot be walked out of the tools directory', () => {
  freshRoot();
  seedTool();
  for (const evil of ['../../etc/passwd', '../settings', '..', '/etc/passwd', 'tools/../settings', './wardrobe-note']) {
    assert.equal(readUserTool(evil), null, 'traversal accepted: ' + evil);
  }
  // …but ordinary sloppiness normalises rather than 404s: ids are lowercased and trimmed, so a
  // capitalised id typed by hand still resolves to the tool the user meant.
  assert.equal(readUserTool('  Wardrobe-Note ')?.id, 'wardrobe-note');
});

// ── HTTP ───────────────────────────────────────────────────────────────────────────────
test('POST /api/tools creates, GET lists, DELETE removes', async () => {
  freshRoot();
  const created = await req('POST', '/api/tools', DRAFT);
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.equal(created.body.tool.id, 'wardrobe-note');
  assert.equal(created.body.tool.invocation, 'skills/tool-wardrobe-note/SKILL.md');

  const listed = await req('GET', '/api/tools');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.tools.length, 1);
  assert.equal(listed.body.tools[0].enabled, false, 'a new tool is off until switched on');

  const gone = await req('DELETE', '/api/tools/wardrobe-note');
  assert.equal(gone.status, 200);
  assert.equal((await req('GET', '/api/tools')).body.tools.length, 0);
  assert.equal(fs.existsSync(path.join(toolsDir(), 'wardrobe-note')), false);
});

test('POST /api/tools rejects a reserved id with a usable error', async () => {
  freshRoot();
  const r = await req('POST', '/api/tools', { ...DRAFT, id: 'style-locks' });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'id');
  assert.equal(r.body.code, 'invalid-tool');
  assert.match(r.body.error, /built-in/);
});

test('deleting a tool prunes its toggle without disturbing others', async () => {
  freshRoot();
  await req('POST', '/api/tools', DRAFT);
  saveSettings({ enabledChatTools: { 'wardrobe-note': true, 'style-locks': true } });

  await req('DELETE', '/api/tools/wardrobe-note');
  const map = getSettings().enabledChatTools || {};
  assert.equal(Object.prototype.hasOwnProperty.call(map, 'wardrobe-note'), false, 'stale toggle left behind');
  assert.equal(map['style-locks'], true, 'unrelated toggle must survive the shallow merge');
});

test('DELETE of an unknown tool is a clean 404', async () => {
  freshRoot();
  const r = await req('DELETE', '/api/tools/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'no-tool');
});

// ── session kind (review regressions) ──────────────────────────────────────────────────
test('builder sessions stay out of the ordinary chat list', async () => {
  freshRoot();
  await req('POST', '/api/chat/sessions', { title: 'a real chat' });
  await req('POST', '/api/chat/sessions', { title: 'New tool', kind: 'toolsmith' });

  const listed = await req('GET', '/api/chat/sessions');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.map(s => s.title), ['a real chat'],
    'a tool-builder session must not appear as a conversation the filmmaker keeps');

  const all = await req('GET', '/api/chat/sessions?all=1');
  assert.equal(all.body.length, 1, '?all=1 means every scope, not every kind');
});

test('branching a builder session keeps its kind, so the skill survives the branch', async () => {
  freshRoot();
  const made = await req('POST', '/api/chat/sessions', { title: 'New tool', kind: 'toolsmith' });
  const id = made.body.id;
  assert.equal(made.body.kind, 'toolsmith');

  await req('POST', '/api/chat/sessions/' + id + '/turn', { text: 'a continuity checker' });
  const cp = await req('POST', '/api/chat/sessions/' + id + '/checkpoint', {});
  const branch = await req('POST', '/api/chat/sessions/' + id + '/checkpoint/' + cp.body.id + '/restore');

  assert.equal(branch.status, 200);
  assert.equal(branch.body.kind, 'toolsmith', 'a branch that drops kind silently loses the tool-builder skill');
  const home = prepareAgentHome({ session: branch.body });
  assert.ok(fs.existsSync(path.join(home.skillsDir, 'frameforge-toolsmith')));
});

test('kind is fixed at birth — PATCH cannot change it', async () => {
  freshRoot();
  const made = await req('POST', '/api/chat/sessions', { title: 'ordinary' });
  assert.equal(made.body.kind, 'chat');
  const patched = await req('PATCH', '/api/chat/sessions/' + made.body.id, { kind: 'toolsmith', title: 'renamed' });
  assert.equal(patched.body.kind, 'chat', 'kind must not be patchable');
  assert.equal(patched.body.title, 'renamed', 'but ordinary patches still apply');
});
