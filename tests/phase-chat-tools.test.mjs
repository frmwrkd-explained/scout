// Ticket 15 — chat-tools registry + the Filmmaker Chat integration module.
// Hermetic: no CLI spawns. We exercise (1) the seeded registry reflecting into the session Index as
// tools toggle on/off, (2) the shared `requires` relationship (chat needs agent), and (3) the route
// gate that turns the whole /api/chat surface off when the chat module is off.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, req } from './helpers.mjs';
import { saveSettings } from '../backend/store.mjs';
import { listChatTools, enabledTools, prepareAgentHome, seedChatTools, clearChatTools } from '../backend/agentHome.mjs';
import { isEnabled, byId } from '../shared/integrations.mjs';
import { CHAT_TOOLS } from '../shared/chatTools.mjs';

// The registry is seeded from shared/chatTools.mjs at agentHome import; re-seed defensively in case an
// earlier test in the same process cleared it.
seedChatTools();

// ── the seeded registry ──
test('every declared chat tool is registered and defaults OFF', () => {
  freshRoot();
  const tools = listChatTools();
  for (const decl of CHAT_TOOLS) {
    const t = tools.find(x => x.id === decl.id);
    assert.ok(t, 'tool not registered: ' + decl.id);
    assert.equal(t.enabled, false, decl.id + ' must default OFF');
  }
  assert.equal(enabledTools().length, 0, 'no chat tool may be on by default');
});

// ── registry → Index reflection (toggle on/off) ──
test('enabling a chat tool adds its Index line; disabling removes it', () => {
  freshRoot();
  const session = { id: 'ct-index', project: null, mode: 'agent' };

  let home = prepareAgentHome({ session });
  assert.match(home.indexText, /## Tools\n\(none enabled\)/, 'tools must start empty in the Index');

  saveSettings({ enabledChatTools: { 'style-locks': true } });
  home = prepareAgentHome({ session });
  // the enabled tool's capability + invocation pointer become its Index line
  assert.match(home.indexText, /style-locks — Show a locked style .*\[GET \/api\/stylelocks\]/);
  assert.match(home.indexText, /directives: show\.style/);
  // and only the enabled one — a still-off tool stays invisible
  assert.doesNotMatch(home.indexText, /grid-splitter/);

  saveSettings({ enabledChatTools: { 'style-locks': false } });
  home = prepareAgentHome({ session });
  assert.match(home.indexText, /## Tools\n\(none enabled\)/, 'disabled tool still in the Index');
});

// ── the shared requires relationship ──
test('chat integration requires agent: off-agent forces chat off regardless of its toggle', () => {
  // default (nothing set): agent on → chat on
  assert.equal(isEnabled({}, 'agent'), true);
  assert.equal(isEnabled({}, 'chat'), true, 'chat should default on when agent is on');
  // explicit chat off wins even with agent on
  assert.equal(isEnabled({ enabledModules: { chat: false } }, 'chat'), false);
  // agent off forces chat off even if chat is explicitly on
  assert.equal(isEnabled({ enabledModules: { agent: false, chat: true } }, 'chat'), false);
  assert.equal(byId('chat').requires, 'agent');
});

// ── route gating when the chat module is off ──
test('the /api/chat surface is refused when the chat module is off, and served when on', async () => {
  freshRoot();
  seedProject('neon');

  // on by default (agent on) → the tool toggle route works
  let r = await req('POST', '/api/chat/tools/style-locks/toggle', { enabled: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);

  // turn the chat module off → every /api/chat path is refused with the module-disabled contract
  saveSettings({ enabledModules: { chat: false } });
  r = await req('POST', '/api/chat/tools/style-locks/toggle', { enabled: false });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'module-disabled');
  assert.equal(r.body.module, 'chat');
  // a GET on the surface is gated too
  r = await req('GET', '/api/chat/skills');
  assert.equal(r.status, 403);

  // turn it back on → served again
  saveSettings({ enabledModules: { chat: true } });
  r = await req('GET', '/api/chat/skills');
  assert.equal(r.status, 200);
});
