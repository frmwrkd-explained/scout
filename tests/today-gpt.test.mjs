import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot } from './helpers.mjs';
import { saveSettings } from '../backend/store.mjs';
import { providerById, parseGptReply } from '../backend/agentProviders.mjs';
import { pickProvider, think, brainBudgetToday } from '../backend/brain.mjs';
import { readEvents } from '../backend/log.mjs';

const signedIn = async provider => ({ installed: provider.id === 'gpt', signedIn: provider.id === 'gpt' });
const jsonReply = text => [
  { type: 'thread.started', thread_id: 'fixture' },
  { type: 'item.completed', item: { type: 'error', message: 'Code-mode host is disabled' } },
  { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', text } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
].map(event => JSON.stringify(event)).join('\n');

function fixture(root) {
  const file = path.join(root, 'gpt-fixture.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
import fs from 'node:fs';
const argv = process.argv.slice(2);
const config = argv.find(arg => arg.startsWith('model_instructions_file='));
const instructions = config ? fs.readFileSync(JSON.parse(config.split('=').slice(1).join('=')), 'utf8') : '';
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({argv,cwd:process.cwd(),files:fs.readdirSync('.'),instructions})}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`, { mode: 0o755 });
  return file;
}

test('GPT-6 Luna is a light backup without enabling heavy fallback', async () => {
  freshRoot();
  assert.equal((await pickProvider('light', { probe: signedIn })).id, 'gpt');
  assert.equal(await pickProvider('heavy', { probe: signedIn }), null);
});

test('only a completed GPT text answer is accepted; protocol errors and tool events fail', () => {
  assert.deepEqual(parseGptReply({ code: 0, out: jsonReply('Hi'), err: '' }), { ok: true, text: 'Hi' });
  for (const type of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'collab_agent_tool_call']) {
    const out = JSON.stringify({ type: 'item.started', item: { type } }) + '\n' + jsonReply('pretend success');
    assert.equal(parseGptReply({ code: 0, out }).ok, false);
  }
  assert.equal(parseGptReply({ code: 0, out: 'plain text' }).ok, false);
  assert.equal(parseGptReply({ code: 0, out: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'unfinished' } }) }).ok, false);
  assert.equal(parseGptReply({ code: 1, out: jsonReply('old partial answer') }).ok, false);
  const failed = jsonReply('partial') + '\n' + JSON.stringify({ type: 'turn.failed', error: { message: 'quota exhausted' } });
  assert.match(parseGptReply({ code: 0, out: failed }).reason, /quota/);
});

test('GPT backup fixes its model, isolates instructions and spends the light cap', async () => {
  const root = freshRoot();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Private workspace instructions');
  const gpt = providerById('gpt');
  const oldBin = gpt.bin;
  gpt.bin = fixture(root);
  delete process.env.SCOUT_BRAIN_COMMAND;
  saveSettings({ tiers: { light: ['gpt'] }, brainDailyLimits: { light: 1, heavy: 0 } });
  try {
    const result = await think({ purpose: 'chat', prompt: 'Only the supplied prompt', probe: signedIn });
    assert.equal(result.ok, true);
    assert.equal(result.model, 'gpt-6-luna');
    const call = JSON.parse(result.text);
    assert.notEqual(call.cwd, root);
    assert.equal(fs.existsSync(call.cwd), false);
    assert.deepEqual(call.files, ['today-instructions.md']);
    assert.match(call.instructions, /no tools/);
    assert.doesNotMatch(call.instructions, /Private workspace/);
    assert.equal(call.argv[call.argv.indexOf('-m') + 1], 'gpt-6-luna');
    for (const flag of ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--json']) assert.ok(call.argv.includes(flag));
    for (const feature of ['code_mode_host', 'apps', 'plugins', 'shell_tool', 'multi_agent', 'hooks', 'browser_use']) {
      assert.ok(call.argv.some((value, index) => value === '--disable' && call.argv[index + 1] === feature));
    }
    assert.ok(call.argv.includes('project_doc_max_bytes=0'));
    assert.equal(brainBudgetToday().light.used, 1);
    assert.equal(brainBudgetToday().heavy.used, 0);
    assert.match((await think({ purpose: 'chat', prompt: 'again', probe: signedIn })).reason, /light daily call limit/);
    assert.equal(readEvents({ type: 'run' }).find(event => event.detail.phase === 'completed').detail.model, 'gpt-6-luna');
  } finally { gpt.bin = oldBin; }
});

test('GPT model overrides cannot turn the light backup into a heavier model', async () => {
  freshRoot();
  saveSettings({ tiers: { light: ['gpt'] }, brainModels: { gpt: 'gpt-6-astra' } });
  const result = await think({ purpose: 'chat', prompt: 'hello', probe: signedIn });
  assert.equal(result.ok, false);
  assert.match(result.reason, /fixed to gpt-6-luna/);
  assert.equal(brainBudgetToday().light.used, 0);
});
