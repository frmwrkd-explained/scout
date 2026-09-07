// TODAY — the 9am screen, and the first frontend logic in this repo that `node --test` can reach.
//
// Why it exists now: wiring the runner (backend/dispatch.mjs) meant runs finally EXISTED, and the
// first thing the screen did with one was print the word "null" into the OVERNIGHT panel header.
// `normRun` converts every timestamp to epoch milliseconds the moment it arrives, and `clock()` —
// in the same file, ten lines away — only ever parsed strings. Both had been correct in isolation
// and wrong together since M5, and nothing could have noticed while `runs` was always empty.
//
// The lesson this file is the answer to: **a formatter that only speaks one of the two shapes its
// own module produces will fail on the day the data arrives.** Every screen keeps its real logic
// in exported pure functions; `loadJsx` is how they get tested.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJsx } from './helpers.mjs';

const { clock, normRun, overnightLines } = await loadJsx('frontend/Today.jsx');

// TODAY's date, never a fixed one. `overnightStart()` is relative to the current day (00:00
// minus six hours), so a hard-coded calendar date passes on the afternoon it is written and
// fails every day after — this file's fixtures were pinned to 2026-08-26 and the window test
// had been red ever since. A fixture for a relative-time function has to be relative too.
const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const sources = { proposals: true, goals: true, assistants: true, runs: true, activity: true };

test('clock reads a moment in either shape its own file produces', () => {
  // The bug: normRun hands it a NUMBER, and Date.parse(String(1756215600000)) is NaN.
  assert.equal(clock(at(7, 5).getTime()), '07:05');
  assert.equal(clock(at(7, 5).toISOString()), '07:05');
  assert.equal(clock(at(7, 5)), '07:05');
  // And it still refuses what is not a time, rather than rendering a wrong one.
  assert.equal(clock('not a time'), null);
  assert.equal(clock(null), null);
  assert.equal(clock(undefined), null);
  assert.equal(clock(NaN), null);
});

test('normRun turns every timestamp shape the API sends into epoch milliseconds', () => {
  const r = normRun({ assistant: 'scout-fb', started: '2026-08-26T05:05:00.000Z', ended: '2026-08-26T05:40:00.000Z', found: 3, status: 'done' });
  assert.equal(typeof r.started, 'number');
  assert.equal(typeof r.ended, 'number');
  assert.equal(r.found, 3);
  assert.equal(r.assistant, 'scout-fb');

  // A run still out has no `ended` — that is null, never 0 and never NaN.
  const out = normRun({ assistant: 'scout-fb', started: '2026-08-26T05:05:00.000Z', status: 'running' });
  assert.equal(out.ended, null);
  // …and "no figure" is null, not a zero dressed up as news.
  assert.equal(out.found, null);
});

test('the overnight line reports the window, not the word null', () => {
  const runs = [
    normRun({ assistant: 'scout-fb', started: at(2, 10).toISOString(), ended: at(2, 55).toISOString(), found: 4, status: 'done' }),
    normRun({ assistant: 'vetter', started: at(3, 30).toISOString(), ended: at(3, 40).toISOString(), found: 0, status: 'done' }),
  ];
  const [first] = overnightLines({ runs, events: [], cards: [], goals: [], sources });
  assert.equal(first.honest, false);
  assert.match(first.text, /2 runs overnight/);
  assert.match(first.text, /02:10 to 03:40/, 'the window renders — this is what printed as nothing');
  assert.match(first.text, /scout-fb, vetter/);
});

test('with no runs and no events it says so, and never invents a figure', () => {
  const [first] = overnightLines({ runs: [], events: [], cards: [], goals: [], sources });
  assert.equal(first.honest, true, 'an honest line renders as a status, not as prose');
  assert.match(first.text, /NO ASSISTANT RAN OVERNIGHT/);

  // And when neither log is even reachable, it distinguishes "nothing happened" from "I cannot see".
  const [blind] = overnightLines({ runs: [], events: [], cards: [], goals: [], sources: { ...sources, runs: false, activity: false } });
  assert.equal(blind.honest, true);
  assert.match(blind.text, /NOTHING IS RECORDED YET/);
});
