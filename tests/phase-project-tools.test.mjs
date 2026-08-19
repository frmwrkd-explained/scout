// Per-project chat-tool enablement.
//
// A tool is enabled PER PROJECT (project.md frontmatter `enabledTools`), written from the chat's
// Production rail → TOOLS. settings.enabledChatTools is now only the GLOBAL DEFAULT a project
// inherits while it has no opinion of its own — and the only layer a standalone (project-less)
// session resolves against.
//
// The load-bearing rule is the fall-THROUGH: absent ≠ false. A project that has never touched a tool
// must inherit the global default rather than pinning it off, or a global enable would never reach
// an existing project. These tests pin that rule at both the resolver and the route/Index level.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, req } from './helpers.mjs';
import { saveSettings } from '../backend/store.mjs';
import { listChatTools, enabledTools, prepareAgentHome, projectToolMap, setProjectTool, seedChatTools } from '../backend/agentHome.mjs';
import { resolveToolEnabled } from '../shared/chatTools.mjs';

seedChatTools();

// ── the shared resolver: one rule, both sides ──
test('resolveToolEnabled: project wins, then global, then the tool default', () => {
  const tool = { id: 'style-locks', enabledByDefault: false };
  // nothing set anywhere → the tool's own default (OFF, hackathon compliance)
  assert.equal(resolveToolEnabled('style-locks', { tool }), false);
  // global only → inherited
  assert.equal(resolveToolEnabled('style-locks', { global: { 'style-locks': true }, tool }), true);
  // project overrides global, in BOTH directions
  assert.equal(resolveToolEnabled('style-locks', { project: { 'style-locks': false }, global: { 'style-locks': true }, tool }), false);
  assert.equal(resolveToolEnabled('style-locks', { project: { 'style-locks': true }, global: { 'style-locks': false }, tool }), true);
  // a project with an opinion about ANOTHER tool still inherits this one — absent is not false
  assert.equal(resolveToolEnabled('style-locks', { project: { 'grid-splitter': false }, global: { 'style-locks': true }, tool }), true);
  // an unknown id (a deleted user tool) resolves off rather than throwing
  assert.equal(resolveToolEnabled('no-such-tool', { project: {}, global: {} }), false);
});

// ── two projects, one install, different tool sets ──
test('two projects can run different tool sets from the same global default', async () => {
  freshRoot();
  seedProject('neon');
  seedProject('harbor');
  saveSettings({ enabledChatTools: { 'style-locks': true } });

  // both inherit the global default until one of them is told otherwise
  assert.equal(listChatTools('neon').find(t => t.id === 'style-locks').enabled, true);
  assert.equal(listChatTools('harbor').find(t => t.id === 'style-locks').enabled, true);
  assert.equal(listChatTools('neon').find(t => t.id === 'style-locks').scope, 'global', 'inherited, not pinned');

  // turn it off for harbor ONLY
  let r = await req('POST', '/api/projects/harbor/tools/style-locks/toggle', { enabled: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.equal(r.body.scope, 'project');

  assert.equal(listChatTools('neon').find(t => t.id === 'style-locks').enabled, true, 'neon must be untouched');
  assert.equal(listChatTools('harbor').find(t => t.id === 'style-locks').enabled, false);
  // and it is persisted on the project record, not in global settings
  assert.deepEqual(projectToolMap('harbor'), { 'style-locks': false });
  assert.deepEqual(projectToolMap('neon'), {});

  // enable a DIFFERENT tool for harbor only — the global map stays untouched throughout
  r = await req('POST', '/api/projects/harbor/tools/grid-splitter/toggle', { enabled: true });
  assert.equal(r.status, 200);
  assert.equal(enabledTools('harbor').map(t => t.id).sort().join(','), 'grid-splitter');
  assert.equal(enabledTools('neon').map(t => t.id).join(','), 'style-locks');
});

// ── clearing an override falls back to the global default ──
test('enabled:null clears the project override and restores inheritance', async () => {
  freshRoot();
  seedProject('neon');
  saveSettings({ enabledChatTools: { 'shot-board': true } });

  await req('POST', '/api/projects/neon/tools/shot-board/toggle', { enabled: false });
  assert.equal(listChatTools('neon').find(t => t.id === 'shot-board').enabled, false);

  const r = await req('POST', '/api/projects/neon/tools/shot-board/toggle', { enabled: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.scope, 'global', 'cleared override must report as inherited');
  assert.equal(r.body.enabled, true, 'and resolve back to the global default');
  assert.deepEqual(projectToolMap('neon'), {}, 'the key is removed, not set to true');
});

// ── the Index is what the agent actually sees ──
test("a project's tool set drives its session Index, not the global default", () => {
  freshRoot();
  seedProject('neon');
  seedProject('harbor');
  saveSettings({ enabledChatTools: { 'style-locks': true } });

  // the project's session sees the inherited tool
  let home = prepareAgentHome({ session: { id: 'pt-1', project: 'neon', mode: 'agent' } });
  assert.match(home.indexText, /style-locks — Show a locked style/);

  // disabling it for harbor removes it from HARBOR's Index only. prepareAgentHome is synchronous, so
  // this writes the override directly; the route path is covered by the tests above.
  setProjectTool('harbor', 'style-locks', false);
  home = prepareAgentHome({ session: { id: 'pt-2', project: 'harbor', mode: 'agent' } });
  assert.match(home.indexText, /## Tools\n\(none enabled\)/, 'harbor must not see a tool it disabled');
  home = prepareAgentHome({ session: { id: 'pt-3', project: 'neon', mode: 'agent' } });
  assert.match(home.indexText, /style-locks — Show a locked style/, 'neon keeps it');

  // a standalone session has no project, so it resolves against the global layer alone
  home = prepareAgentHome({ session: { id: 'pt-4', project: null, mode: 'agent' } });
  assert.match(home.indexText, /style-locks — Show a locked style/);
});

// ── a bad project id is a 404, never a write outside the project tree ──
test('toggling tools on an unknown project is refused', async () => {
  freshRoot();
  seedProject('neon');
  const r = await req('POST', '/api/projects/nope/tools/style-locks/toggle', { enabled: true });
  assert.equal(r.status, 404);
});
