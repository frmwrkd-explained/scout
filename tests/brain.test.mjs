// The brain's own contract: tier selection, the heavy-fallback law, the hermetic rule, and the
// run-event accounting — every brain call lands in the log with provider + purpose.
import './_env.mjs'; // first
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshRoot } from './helpers.mjs';
import { pickProvider, think, usageToday, parseJsonBlock, TIERS } from '../backend/brain.mjs';
import { readEvents } from '../backend/log.mjs';
import { saveSettings } from '../backend/store.mjs';

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-brain.mjs');

// A probe that answers from a { id: signedIn? } availability map — installed iff listed.
const probe = avail => async p => p.id in avail ? { installed: true, signedIn: !!avail[p.id] } : { installed: false, signedIn: false };

test('unverified tools/context restrictions fail closed even when signed in', async () => {
  freshRoot();
  assert.equal(await pickProvider('light', { probe: probe({ gemini: true, devin: true }) }), null);
  assert.equal(await pickProvider('heavy', { probe: probe({ codex: true }) }), null);
  assert.equal(await pickProvider('light', { probe: probe({}) }), null);
  // Installed but NOT signed in is the same as absent.
  assert.equal(await pickProvider('light', { probe: probe({ gemini: false }) }), null);
});

test('a light purpose never uses a heavy provider unless allowHeavyFallback is set', async () => {
  freshRoot();
  const available = probe({ claude: true, codex: true });
  assert.equal(await pickProvider('light', { probe: available }), null, 'heavy CLIs are not a light fallback');
  saveSettings({ allowHeavyFallback: true });
  const p = await pickProvider('light', { probe: available });
  assert.equal(p.id, 'claude', 'opt-in reaches the heavy tier');
  assert.equal((await pickProvider('heavy', { probe: probe({ claude: true }) })).id, 'claude');
});

test('settings.tiers overrides the provider order', async () => {
  freshRoot();
  saveSettings({ tiers: { light: ['claude'], heavy: TIERS.heavy } });
  assert.equal((await pickProvider('light', { probe: probe({ gemini: true, claude: true }) })).id, 'claude');
  assert.equal(await pickProvider('light', { probe: probe({ gemini: true }) }), null, 'gemini is not in the overridden tier');
});

test('an explicit empty tier disables providers, including opted-in heavy fallback', async () => {
  freshRoot();
  const available = probe({ claude: true });
  saveSettings({ tiers: { light: [], heavy: [] }, allowHeavyFallback: true });
  assert.equal(await pickProvider('heavy', { probe: available }), null);
  assert.equal(await pickProvider('light', { probe: available }), null);
  saveSettings({ tiers: { heavy: null } });
  assert.equal((await pickProvider('heavy', { probe: available })).id, 'claude', 'null retains the default tier');
});

test('under SCOUT_TEST nothing spawns without SCOUT_BRAIN_COMMAND', async () => {
  freshRoot();
  delete process.env.SCOUT_BRAIN_COMMAND;
  const res = await think({ purpose: 'plan', prompt: 'anything' });
  assert.equal(res.ok, false);
  assert.equal(res.provider, null);
  assert.match(res.reason, /no provider/);
  // …and the no-brain call is still logged — an absent brain is a fact of the day.
  const runs = readEvents({ type: 'run' }).filter(e => e.target === 'brain/plan');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].actor, 'conductor');
  assert.equal(runs[0].detail.provider, null);
  assert.equal(runs[0].detail.ok, false);
});

test('SCOUT_BRAIN_COMMAND stands in for every tier, and the run event carries provider + purpose', async () => {
  freshRoot();
  process.env.SCOUT_BRAIN_COMMAND = STUB;
  process.env.SCOUT_BRAIN_REPLY = 'hello from the stub';
  try {
    const res = await think({ purpose: 'chat', prompt: 'say hi' });
    assert.equal(res.ok, true);
    assert.equal(res.provider, 'stub');
    assert.equal(res.tier, 'light');
    assert.match(res.text, /hello from the stub/);
    // review_weekly is a HEAVY purpose — the stub still answers (it is the test double).
    const heavy = await think({ purpose: 'review_weekly', prompt: 'review' });
    assert.equal(heavy.ok, true);
    assert.equal(heavy.tier, 'heavy');
    const runs = readEvents({ type: 'run' }).filter(e => e.target === 'brain/chat');
    assert.equal(runs.length, 2);
    const completed = runs.find(e => e.detail.phase === 'completed');
    assert.equal(completed.detail.provider, 'stub');
    assert.equal(completed.detail.purpose, 'chat');
    assert.equal(completed.detail.ok, true);
    assert.equal(completed.detail.attemptId, runs.find(e => e.detail.phase === 'reserved').detail.attemptId);
    const u = usageToday();
    assert.equal(u.stub, 2);
  } finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY; }
});

test('a stub exit-1 reads as a failed think, still logged', async () => {
  freshRoot();
  process.env.SCOUT_BRAIN_COMMAND = STUB;
  process.env.SCOUT_BRAIN_FAIL = '1';
  try {
    const res = await think({ purpose: 'prep', prompt: 'x' });
    assert.equal(res.ok, false);
    assert.equal(res.provider, 'stub');
  } finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_FAIL; }
});

test('parseJsonBlock', () => {
  assert.deepEqual(parseJsonBlock('```json\n{"x":1}\n```'), { x: 1 });
  assert.deepEqual(parseJsonBlock('words {"x":[1,2]} words'), { x: [1, 2] });
  assert.equal(parseJsonBlock(''), null);
  assert.equal(parseJsonBlock('{"unterminated"'), null);
});
