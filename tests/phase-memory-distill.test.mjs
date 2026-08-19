// Ticket 20 — project understanding on open, learnings on close.
//   · session START injects the project brief + memory hot-cache into the executor context
//   · session END (explicit close / idle sweep / manual) distills durable learnings into memory
//   · dedupe: re-running distillation never piles up duplicates
//   · the chatAutoDistill toggle gates the AUTOMATIC triggers; manual distill runs regardless
// The distillation LLM is stubbed via setDistiller — no network, fully hermetic.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, req, server_, writeMd, paths } from './helpers.mjs';
import { saveSettings } from '../backend/store.mjs';
import { createSession, runTurn, registerExecutor, projectUnderstanding, recordManualTurn } from '../backend/chat.mjs';
import { writeMemory, readMemory, normalizeMemoryLine } from '../backend/memory.mjs';
import { distillSession, sweepIdleSessions, setDistiller, parseLearnings } from '../backend/distill.mjs';

function seedBrief(pid, text) {
  writeMd(paths.briefMd(pid), { project: pid, updated: 'Jul 6' }, text.trim() + '\n');
}

test('session start injects brief + memory into the executor context (only on the first turn)', async () => {
  freshRoot();
  seedProject('p');
  seedBrief('p', '# Neon — desaturated teal, handheld, always night.');
  writeMemory('p', '- Locked: no lens flares  _(Jul 6, 18:00)_');

  let captured = 'sentinel';
  registerExecutor('capture20', async ({ projectContext, emit }) => {
    captured = projectContext;
    emit({ type: 'text-delta', text: 'ok' });
    return { text: 'ok', directives: [], cost: 0 };
  });

  const s = createSession({ project: 'p', title: 'Direction', executor: 'capture20' });
  assert.equal(s.executor, 'capture20', 'explicit executor should win even under SCOUT_TEST');

  await runTurn(s.id, 'open on a rooftop');
  assert.ok(captured.includes('desaturated teal'), 'brief missing from injected context');
  assert.ok(captured.includes('no lens flares'), 'memory missing from injected context');
  // the injected block matches the inspectable understanding block exactly
  assert.equal(captured, projectUnderstanding('p'));

  // second turn is not "session start" → no re-injection
  captured = 'sentinel';
  await runTurn(s.id, 'second beat');
  assert.equal(captured, '', 'project context must only inject on the first turn');
});

test('a manual generation before the first agent turn does not swallow the injection', async () => {
  // Regression: the injection used to key on the count of user messages, but recordManualTurn appends
  // a user message WITHOUT running an executor (and without establishing a CLI resume id). Generating
  // in Manual mode first therefore pushed the counter past zero and the agent opened blind.
  freshRoot();
  seedProject('p');
  seedBrief('p', '# Neon — desaturated teal, handheld, always night.');
  writeMemory('p', '- Locked: no lens flares  _(Jul 6, 18:00)_');

  let captured = 'sentinel';
  registerExecutor('capture20b', async ({ projectContext, emit }) => {
    captured = projectContext;
    emit({ type: 'text-delta', text: 'ok' });
    return { text: 'ok', directives: [], cost: 0 };
  });

  const s = createSession({ project: 'p', title: 'Manual first', executor: 'capture20b' });
  recordManualTurn(s.id, { userText: 'Manual · image · flux', directive: { type: 'generation', ref: 'gen-1' } });

  await runTurn(s.id, 'what does my brief say about the tone?');
  assert.ok(captured.includes('desaturated teal'), 'brief missing after a manual-first turn');
  assert.ok(captured.includes('no lens flares'), 'memory missing after a manual-first turn');

  // and it still injects exactly once
  captured = 'sentinel';
  await runTurn(s.id, 'next beat');
  assert.equal(captured, '', 'project context must not re-inject on later turns');
});

test('understanding route exposes brief+memory; a standalone session has none', async () => {
  freshRoot();
  seedProject('p');
  seedBrief('p', '# Brief body marker here');
  await server_();

  const proj = await req('POST', '/api/chat/sessions', { project: 'p', title: 'X' });
  const u = await req('GET', '/api/chat/sessions/' + proj.body.id + '/understanding');
  assert.equal(u.status, 200);
  assert.equal(u.body.project, 'p');
  assert.ok(u.body.understanding.includes('Brief body marker here'), 'brief missing from understanding');

  const solo = await req('POST', '/api/chat/sessions', { title: 'loose idea' });
  const u2 = await req('GET', '/api/chat/sessions/' + solo.body.id + '/understanding');
  assert.equal(u2.body.understanding, '', 'standalone session should have no project understanding');
});

test('distillation appends learnings and dedupes on re-run (stubbed distiller)', async () => {
  freshRoot();
  seedProject('p');
  const s = createSession({ project: 'p', title: 'session' });
  await runTurn(s.id, 'lets lock a teal night look');
  await runTurn(s.id, 'yes and no lens flares ever');

  let sawTranscript = false;
  setDistiller(async ({ transcript }) => {
    if (transcript.includes('teal night look')) sawTranscript = true;
    return ['Lock the teal night look', 'No lens flares, ever'];
  });

  const r1 = await distillSession(s.id, { force: true });
  assert.ok(sawTranscript, 'distiller was not handed the transcript');
  assert.equal(r1.added.length, 2, 'both learnings should be appended on first pass');
  const mem1 = readMemory('p').body;
  assert.ok(mem1.includes('Lock the teal night look'));
  assert.ok(mem1.includes('No lens flares, ever'));

  // re-run with punctuation/case variants → dedupe skips them all, memory unchanged
  setDistiller(async () => ['lock the teal night look.', 'NO LENS FLARES ever!']);
  const r2 = await distillSession(s.id, { force: true });
  assert.equal(r2.added.length, 0, 'dedupe failed — duplicate learnings were appended');
  assert.equal(r2.skipped.length, 2);
  assert.equal(readMemory('p').body, mem1, 'memory must be byte-identical after a duplicate distill');
});

test('chatAutoDistill=false disables auto-distill on close; manual save-learnings still runs', async () => {
  freshRoot();
  seedProject('p');
  saveSettings({ chatAutoDistill: false });
  const s = createSession({ project: 'p', title: 'gated' });
  await runTurn(s.id, 'a decision was made: shoot at dawn');
  setDistiller(async () => ['Shoot at dawn']);
  await server_();

  const closed = await req('POST', '/api/chat/sessions/' + s.id + '/close');
  assert.equal(closed.status, 200);
  assert.equal(closed.body.closed, true);
  assert.equal(closed.body.distill.skipped, 'auto-off', 'close should not distill when auto is off');
  assert.equal(readMemory('p').body.includes('Shoot at dawn'), false, 'auto-off must not write memory');

  // manual route ignores the toggle
  const man = await req('POST', '/api/chat/sessions/' + s.id + '/distill');
  assert.equal(man.status, 200);
  assert.equal(man.body.added.length, 1, 'manual distill must run regardless of the toggle');
  assert.ok(readMemory('p').body.includes('Shoot at dawn'));
});

test('idle sweep distills a stale project session, then leaves it alone', async () => {
  freshRoot();
  seedProject('p');
  const s = createSession({ project: 'p', title: 'stale' });
  await runTurn(s.id, 'locked: anamorphic lenses');
  setDistiller(async () => ['Use anamorphic lenses']);

  // fresh session is not idle → sweep is a no-op
  let sweep = await sweepIdleSessions({ now: Date.now() });
  assert.equal(sweep.swept.length, 0, 'a fresh session must not be swept');

  // 40 minutes on → past the default 30-minute idle threshold
  const future = Date.now() + 40 * 60_000;
  sweep = await sweepIdleSessions({ now: future });
  const hit = sweep.swept.find(x => x.id === s.id);
  assert.ok(hit && hit.added.length === 1, 'idle session was not distilled');
  assert.ok(readMemory('p').body.includes('Use anamorphic lenses'));

  // second sweep: nothing new since last distillation → skipped
  setDistiller(async () => ['Use anamorphic lenses']);
  sweep = await sweepIdleSessions({ now: future + 60_000 });
  assert.ok(!sweep.swept.find(x => x.id === s.id), 'already-distilled idle session should be skipped');
});

test('parseLearnings + normalizeMemoryLine helpers', () => {
  assert.deepEqual(parseLearnings('{"learnings":["a","b"]}'), ['a', 'b']);
  assert.deepEqual(parseLearnings(['x', '', '  y ']), ['x', 'y']);
  assert.deepEqual(parseLearnings('not json at all'), []);
  assert.equal(normalizeMemoryLine('- Lock the Teal look!  _(Jul 6, 18:00)_'), 'lock the teal look');
});
