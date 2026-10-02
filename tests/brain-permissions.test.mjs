import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot } from './helpers.mjs';
import { providerById } from '../backend/agentProviders.mjs';
import { pickProvider, providersStatus, think, brainBudgetToday } from '../backend/brain.mjs';
import { saveSettings, setStorageRoot } from '../backend/store.mjs';
import { readEvents } from '../backend/log.mjs';

const signedIn = async () => ({ installed: true, signedIn: true });

function fixture(root) {
  const file = path.join(root, 'cli-fixture.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
import fs from 'node:fs';
const argv = process.argv.slice(2);
console.log(JSON.stringify({ argv, cwd: process.cwd(), files: fs.readdirSync('.') }));
process.exit(argv.includes('fixture-fail') ? 1 : 0);
`, { mode: 0o755 });
  return file;
}

test('provider status separates sign-in from verified text-only capability', async () => {
  freshRoot();
  const states = await providersStatus({ probe: signedIn });
  for (const id of ['gemini', 'devin', 'codex']) {
    const state = states.find(p => p.id === id);
    assert.equal(state.signedIn, true);
    assert.equal(state.textOnlyAvailable, false);
    assert.equal(typeof state.textOnlyReason, 'string');
    assert.equal(await pickProvider('light', { settings: { tiers: { light: [id] } }, probe: signedIn }), null);
  }
  assert.equal(states.find(p => p.id === 'claude').textOnlyAvailable, true);
  assert.equal(await pickProvider('heavy', { probe: async () => ({ installed: true, signedIn: true, textOnlyAvailable: false, textOnlyReason: 'old binary' }) }), null);
});

test('Today uses dedicated Claude tool/MCP/context restrictions in an empty cwd; assistants keep their argv', async () => {
  const root = freshRoot();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'private workspace instructions');
  const claude = providerById('claude');
  const oldBin = claude.bin;
  const normal = claude.promptArgs('normal');
  claude.bin = fixture(root);
  delete process.env.SCOUT_BRAIN_COMMAND;
  saveSettings({ tiers: { light: ['claude'] }, brainDailyLimits: { light: 20, heavy: 1 } });
  try {
    const result = await think({ purpose: 'chat', prompt: 'only Scout prompt', probe: signedIn });
    assert.equal(result.ok, true);
    const call = JSON.parse(result.text);
    const value = flag => call.argv[call.argv.indexOf(flag) + 1];
    assert.equal(value('--tools'), '');
    assert.equal(value('--disallowedTools'), '*');
    assert.equal(value('--mcp-config'), '{"mcpServers":{}}');
    assert.equal(value('--setting-sources'), '');
    assert.equal(JSON.parse(value('--settings')).disableAllHooks, true);
    for (const flag of ['--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--no-chrome']) assert.ok(call.argv.includes(flag));
    assert.equal(value('-p'), 'only Scout prompt');
    assert.deepEqual(call.files, []);
    assert.notEqual(call.cwd, root);
    assert.equal(fs.existsSync(call.cwd), false, 'temporary cwd is removed after completion');
    assert.deepEqual(claude.promptArgs('normal'), normal);
    assert.equal(brainBudgetToday().light.used, 0, 'putting Claude in light cannot evade the heavy cap');
    assert.equal(brainBudgetToday().heavy.used, 1);
    assert.match((await think({ purpose: 'chat', prompt: 'again', probe: signedIn })).reason, /heavy daily call limit/);
  } finally { claude.bin = oldBin; }
});

test('each fallback reserves its actual tier, including the failed attempt', async () => {
  const root = freshRoot();
  const gemini = providerById('gemini'), claude = providerById('claude');
  const saved = { geminiBin: gemini.bin, geminiTextOnly: gemini.textOnly, claudeBin: claude.bin };
  const bin = fixture(root);
  // This fixture is an explicitly verified test provider, never the real Gemini invocation.
  gemini.bin = bin;
  gemini.textOnly = { available: true, promptArgs: p => ['fixture-fail', String(p)] };
  claude.bin = bin;
  saveSettings({ allowHeavyFallback: true, tiers: { light: ['gemini'], heavy: ['claude'] }, brainDailyLimits: { light: 1, heavy: 1 } });
  try {
    const result = await think({ purpose: 'prep', prompt: 'x', probe: signedIn });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'claude');
    assert.equal(brainBudgetToday().light.used, 1);
    assert.equal(brainBudgetToday().heavy.used, 1);
    assert.equal(readEvents({ type: 'run' }).filter(e => e.detail.phase === 'reserved').length, 2);
    const blocked = await think({ purpose: 'prep', prompt: 'x', probe: signedIn });
    assert.equal(blocked.provider, null);
    assert.match(blocked.reason, /light daily call limit/);
    assert.match(blocked.reason, /heavy daily call limit/);
  } finally {
    gemini.bin = saved.geminiBin; gemini.textOnly = saved.geminiTextOnly; claude.bin = saved.claudeBin;
  }
});

test('workspace switch during provider probing stops before reservation or invocation', async () => {
  const oldRoot = freshRoot();
  saveSettings({ tiers: { light: ['claude'] } });
  let release;
  const pending = think({ purpose: 'chat', prompt: 'old private context', probe: () => new Promise(resolve => { release = resolve; }) });
  const newRoot = freshRoot();
  release({ installed: true, signedIn: true });
  assert.equal((await pending).code, 'root-changed');
  assert.deepEqual(readEvents({ type: 'run' }), []);
  setStorageRoot(oldRoot);
  assert.deepEqual(readEvents({ type: 'run' }), []);
  setStorageRoot(newRoot);
});
