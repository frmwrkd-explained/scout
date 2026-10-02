import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot } from './helpers.mjs';
import { think, usageToday, brainBudgetToday } from '../backend/brain.mjs';
import { saveSettings, getSettings, setStorageRoot } from '../backend/store.mjs';
import { logEvent, readEvents, logFileFor, formatEvent } from '../backend/log.mjs';
import { localDay, dayStartMs } from '../backend/daytime.mjs';

function stub(root) {
  const file = path.join(root, 'brain-fixture.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
import fs from 'node:fs';
if (process.env.SCOUT_BRAIN_CALLS) fs.appendFileSync(process.env.SCOUT_BRAIN_CALLS, 'attempt\\n');
if (process.env.SCOUT_BRAIN_STARTED) fs.writeFileSync(process.env.SCOUT_BRAIN_STARTED, 'started');
setTimeout(() => { console.log('answer'); process.exit(process.env.SCOUT_BRAIN_FAIL === '1' ? 1 : 0); }, Number(process.env.SCOUT_BRAIN_DELAY_MS || 0));
`, { mode: 0o755 });
  process.env.SCOUT_BRAIN_COMMAND = file;
}
function clean() {
  for (const name of ['SCOUT_BRAIN_COMMAND', 'SCOUT_BRAIN_CALLS', 'SCOUT_BRAIN_STARTED', 'SCOUT_BRAIN_DELAY_MS', 'SCOUT_BRAIN_FAIL']) delete process.env[name];
}

test('daily attempts default to 40 light and 4 heavy; caps are validated before saving', () => {
  freshRoot();
  assert.deepEqual(getSettings().brainDailyLimits, { light: 40, heavy: 4 });
  saveSettings({ brainDailyLimits: { light: 0 } });
  assert.deepEqual(getSettings().brainDailyLimits, { light: 0, heavy: 4 });
  for (const value of [{ light: -1 }, { heavy: 0.5 }, { light: '10' }, []]) {
    assert.throws(() => saveSettings({ brainDailyLimits: value }), /brainDailyLimits/);
  }
  assert.equal(getSettings().brainDailyLimits.light, 0);
});

test('concurrent prep reserves before await; blocked calls do not invoke or count twice', async () => {
  const root = freshRoot();
  stub(root);
  const calls = path.join(root, 'calls.txt');
  process.env.SCOUT_BRAIN_CALLS = calls;
  process.env.SCOUT_BRAIN_DELAY_MS = '80';
  saveSettings({ brainDailyLimits: { light: 2, heavy: 1 } });
  try {
    const results = await Promise.all(Array.from({ length: 12 }, () => think({ purpose: 'prep', prompt: 'prepare' })));
    assert.equal(results.filter(r => r.ok).length, 2);
    assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 2);
    assert.deepEqual(usageToday(), { stub: 2 });
    assert.deepEqual(brainBudgetToday().light, { limit: 2, used: 2, remaining: 0 });
    const events = readEvents({ type: 'run' });
    assert.equal(events.filter(e => e.detail.phase === 'reserved').length, 2);
    assert.equal(events.filter(e => e.detail.phase === 'completed').length, 2);
    assert.equal(events.filter(e => e.detail.phase === 'blocked').length, 10);
  } finally { clean(); }
});

test('failed attempts spend slots; heavy has its own cap; provider absence spends none', async () => {
  const root = freshRoot();
  stub(root);
  process.env.SCOUT_BRAIN_FAIL = '1';
  saveSettings({ brainDailyLimits: { light: 1, heavy: 1 } });
  try {
    assert.equal((await think({ purpose: 'chat', prompt: 'x' })).ok, false);
    assert.match((await think({ purpose: 'chat', prompt: 'retry' })).reason, /daily call limit/);
    delete process.env.SCOUT_BRAIN_FAIL;
    assert.equal((await think({ purpose: 'review_weekly', prompt: 'x' })).ok, true);
    assert.deepEqual(usageToday(), { stub: 2 });
    clean();
    assert.equal((await think({ purpose: 'prep', prompt: 'x' })).provider, null);
    assert.equal(brainBudgetToday().light.used, 1);
    assert.equal(brainBudgetToday().heavy.used, 1);
  } finally { clean(); }
});

test('orphan reservations and legacy failed runs survive module restart and old dates expire', async () => {
  const root = freshRoot();
  stub(root);
  saveSettings({ brainDailyLimits: { light: 2 } });
  logEvent({ type: 'run', actor: 'conductor', target: 'brain/prep', detail: {
    provider: 'stub', tier: 'light', budgetTier: 'light', phase: 'reserved', attemptId: 'crashed-attempt'
  } });
  logEvent({ type: 'run', actor: 'conductor', target: 'brain/chat', detail: { provider: 'stub', tier: 'light', ok: false } });
  const old = new Date(dayStartMs(localDay()) - 1).toISOString();
  fs.appendFileSync(logFileFor(new Date().toISOString().slice(0, 10)), formatEvent({ ts: old, type: 'run', actor: 'conductor', target: 'brain/prep', detail: { provider: 'stub', tier: 'light' } }) + '\n');
  try {
    const restarted = await import('../backend/brain.mjs?restart=' + Date.now());
    assert.deepEqual(restarted.usageToday(), { stub: 2 });
    assert.match((await restarted.think({ purpose: 'prep', prompt: 'x' })).reason, /daily call limit/);
  } finally { clean(); }
});

test('unrelated run volume cannot hide reservations from accounting', () => {
  freshRoot();
  logEvent({ type: 'run', actor: 'conductor', target: 'brain/chat', detail: { provider: 'stub', tier: 'light' } });
  const file = logFileFor(new Date().toISOString().slice(0, 10));
  const event = formatEvent({ ts: new Date().toISOString(), type: 'run', actor: 'assistant', target: 'session/example', detail: {} }) + '\n';
  fs.appendFileSync(file, event.repeat(5_001));
  assert.deepEqual(usageToday(), { stub: 1 });
  assert.equal(brainBudgetToday().light.used, 1);
});

test('switching workspace while a call runs keeps its reservation in the original root', async () => {
  const oldRoot = freshRoot();
  stub(oldRoot);
  const started = path.join(oldRoot, 'started');
  process.env.SCOUT_BRAIN_STARTED = started;
  process.env.SCOUT_BRAIN_DELAY_MS = '150';
  try {
    const pending = think({ purpose: 'prep', prompt: 'private old workspace' });
    for (let i = 0; i < 100 && !fs.existsSync(started); i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(fs.existsSync(started), true);
    const newRoot = freshRoot();
    const result = await pending;
    assert.equal(result.code, 'root-changed');
    assert.deepEqual(readEvents({ type: 'run' }), []);
    setStorageRoot(oldRoot);
    assert.equal(readEvents({ type: 'run' }).length, 1);
    assert.equal(brainBudgetToday().light.used, 1);
    setStorageRoot(newRoot);
  } finally { clean(); }
});
