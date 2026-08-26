// M4 / T14 step 1, the half that was never wired — sending an assistant out.
//
// The load-bearing test in this file is "a spawned assistant writes through door 1": it runs a real
// child process, whose only knowledge of Scout is the brief it was handed, and asserts the record
// it wrote arrived through the SAME pipeline `_inbox/` and MCP go through — deduped, gated, logged.
// A local CLI Scout spawned itself is the door most likely to grow a shortcut, and a shortcut there
// would be invisible: the record would look identical and simply never have been checked.
//
// The second one that matters: WHAT A RUN REPORTS IS COUNTED, NOT CLAIMED. The stub says it found
// forty. The run says one, because one `store` event carries its signature.
import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshRoot, getStorageRoot, server_, req } from './helpers.mjs';
import { saveAssistant, getAssistant, saveTask, claimTask, listRuns } from '../backend/tasks.mjs';
import { saveSettings } from '../backend/store.mjs';
import {
  buildBrief, countWork, countedLine, sendOut, DispatchError,
  dueNow, dueAssistants, normalizeSchedule, schedulerTick, startScheduler, stopScheduler, DAILY_HOUR,
} from '../backend/dispatch.mjs';
import { clearBinCache } from '../backend/jobs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(here, 'fixtures', 'stub-sortie.mjs');
const R = () => getStorageRoot();

// The brief carries the api base, so a spawned child can only reach the app if this is right. In
// production index.mjs stamps it when it binds; the harness listens on an ephemeral port.
async function boot() {
  const base = await server_();
  process.env.SCOUT_SELF_PORT = String(new URL(base).port);
  return base;
}

// A workspace with a collection to write into, one territory, and an assistant scoped to both.
//
// The schemas are the SHIPPED ones, copied file-for-file out of `workspace/.scout/collections/`.
// A hand-rolled fixture here is how three defects survived 580 green tests once already: the test
// collection declared a query with no `tag`, so a record upsertRecord had just written did not
// match the collection that defines it — invisible, undedupable and ungated. If the guest schema
// changes, this test finds out.
const SHIPPED = path.join(here, '..', 'workspace', '.scout', 'collections');

function seedTeam({ command = STUB } = {}) {
  freshRoot();
  clearBinCache();                       // a previous test's miss is cached for 5s
  saveSettings({ agentCommand: command });

  const dir = path.join(R(), '.scout', 'collections');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['guest.md', 'group.md']) fs.copyFileSync(path.join(SHIPPED, f), path.join(dir, f));

  fs.mkdirSync(path.join(R(), 'projects', 'guest-hunt', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(R(), 'projects', 'guest-hunt', 'project.md'), '---\nname: guest-hunt\n---\n');
  fs.mkdirSync(path.join(R(), 'territory'), { recursive: true });
  fs.writeFileSync(path.join(R(), 'territory', 'nurses-ph.md'),
    '---\nid: nurses-ph\nname: Nurses PH\nkind: group\nsweep_interval_days: 7\n---\n');

  saveAssistant('scout-fb', {
    name: 'Scout FB', job: 'Sweep Philippine nurse groups for guests',
    scope: { collections: ['guest'], territory: ['nurses-ph'] }, project: 'guest-hunt',
  }, { actor: 'crystal' });
  return 'scout-fb';
}

// ── the brief ──────────────────────────────────────────────────────────────────────────────────

test('the brief tells an assistant who it is, where it may work, and how to sign a write', () => {
  const brief = buildBrief(
    { id: 'scout-fb', name: 'Scout FB', job: 'Sweep nurse groups', scope: { collections: ['guest'], territory: ['nurses-ph'] } },
    { tasks: [{ id: 'sweep-nurses-ph', title: 'Sweep the nurses group' }], apiBase: 'http://127.0.0.1:5177', project: 'guest-hunt' },
  );
  assert.match(brief, /You are Scout FB/);
  assert.match(brief, /Sweep nurse groups/);
  assert.match(brief, /collections {3}guest/);
  assert.match(brief, /ground {8}nurses-ph/);
  // One read on wake, and the capability list — never a restatement of either (Law 7).
  assert.match(brief, /curl -s http:\/\/127\.0\.0\.1:5177\/api\/context/);
  assert.match(brief, /curl -s http:\/\/127\.0\.0\.1:5177\/api\/index/);
  assert.match(brief, /Never read data\/ in bulk/);
  // The actor is the load-bearing string: territory scoring and Law 4 both read it.
  assert.match(brief, /"actor": "scout-fb"/);
  // Its task, and the claim protocol that stops two assistants working the same one.
  assert.match(brief, /sweep-nurses-ph/);
  assert.match(brief, /\/api\/tasks\/sweep-nurses-ph\/claim/);
  assert.match(brief, /409/);
  // The run record is ours. An agent that also posts one would double-count its own night.
  assert.match(brief, /Do NOT post to \/api\/runs/);
});

test('an assistant with no queued task is told so, rather than handed an empty list', () => {
  const brief = buildBrief({ id: 'vetter', name: 'Vetter', job: 'Score every find' }, { tasks: [] });
  assert.match(brief, /Nothing is queued for you/);
  assert.doesNotMatch(brief, /claim it before you work it/);
  // No scope named is stated as a fact, not silently rendered as an empty line.
  assert.match(brief, /none named — ask before you write into one/);
});

// ── no CLI is not a failure ────────────────────────────────────────────────────────────────────

test('with no agent CLI connected the door says so, and records no run at all', async () => {
  const base = await boot();
  seedTeam({ command: path.join(here, 'fixtures', 'no-such-cli') });

  const r = await req('POST', '/api/assistants/scout-fb/run', { actor: 'crystal' });
  assert.equal(r.status, 503);
  assert.equal(r.body.setup, true);
  assert.match(r.body.error, /No agent CLI is connected/);
  // Doors 2 and 3 need no local CLI, and the message has to point at the fix rather than read as
  // a broken feature.
  assert.match(r.body.error, /_inbox\/|MCP/);
  // A run that never started is not a run. A blocked record here would put a fake bad night on
  // TODAY's overnight summary every time somebody pressed the button without a CLI.
  assert.equal(listRuns({ limit: 10 }).length, 0);
  assert.equal(getAssistant('scout-fb').status, 'idle');
});

// ── the loop ───────────────────────────────────────────────────────────────────────────────────

test('a spawned assistant writes through door 1, and the run reports what it COUNTED', async () => {
  const base = await boot();
  seedTeam();

  const started = await req('POST', '/api/assistants/scout-fb/run', { actor: 'crystal' });
  assert.equal(started.status, 200);
  assert.equal(started.body.run.status, 'running');
  assert.equal(started.body.run.assistant, 'scout-fb');
  // It answers before the work is done — a sweep is minutes long and a request that waits it out
  // dies to a timeout with the assistant marked running forever.
  assert.equal(started.body.running, true);
  assert.equal(getAssistant('scout-fb').status, 'running');

  const run = await settle(started.body.run.id);

  assert.equal(run.status, 'done');
  // The record exists, and it exists WHERE THE PIPELINE PUTS IT — not wherever the agent chose.
  const written = path.join(R(), 'data', 'guests', 'rosa-delgado.md');
  assert.ok(fs.existsSync(written), 'the spawned assistant’s finding is on disk');
  const file = fs.readFileSync(written, 'utf8');
  assert.match(file, /found_in: nurses-ph/);
  assert.match(file, /created_by: scout-fb/);
  // provenance is what tells quarantine this came through the pipeline rather than around it.
  assert.match(file, /provenance: pipeline/);

  // THE POINT: the stub claimed forty. One store event carries its signature.
  assert.match(run.summary, /Found 40 guests/);
  assert.equal(run.found, 1);
  assert.match(run.summary, /Counted from the log: 1 stored\./);

  // …and the assistant is home.
  assert.equal(getAssistant('scout-fb').status, 'idle');
  assert.ok(run.ended, 'the run knows when it came back');
});

test('the gate holds against a process Scout spawned itself', async () => {
  await boot();
  seedTeam();
  process.env.STUB_SORTIE_PROMOTE = '1';
  process.env.STUB_SORTIE_NAME = 'Bea Tolentino';
  try {
    const started = await req('POST', '/api/assistants/scout-fb/run', {});
    const run = await settle(started.body.run.id);
    const file = fs.readFileSync(path.join(R(), 'data', 'guests', 'bea-tolentino.md'), 'utf8');
    // Spawning it ourselves buys it nothing. Law 4 reads the actor, and the actor is an agent.
    assert.doesNotMatch(file, /status: won/);
    assert.equal(run.refused, 1, 'the refusal is counted onto the run that caused it');
    const acts = await req('GET', '/api/activity?limit=50');
    assert.ok((acts.body.events || []).some(e => e.type === 'refused' && e.actor === 'scout-fb'),
      'and it is visible in Activity, where she can see it');
  } finally {
    delete process.env.STUB_SORTIE_PROMOTE;
    delete process.env.STUB_SORTIE_NAME;
  }
});

test('a run that wrote nothing says so plainly instead of counting silence as a good night', async () => {
  await boot();
  seedTeam();
  process.env.STUB_SORTIE_QUIET = '1';
  try {
    const started = await req('POST', '/api/assistants/scout-fb/run', {});
    const run = await settle(started.body.run.id);
    assert.equal(run.found, 0);
    assert.match(run.summary, /Counted from the log: it wrote nothing\./);
  } finally { delete process.env.STUB_SORTIE_QUIET; }
});

test('an assistant that is already out is refused, not sent twice', async () => {
  await boot();
  seedTeam();
  process.env.STUB_SORTIE_SLEEP = '400';
  try {
    const first = await req('POST', '/api/assistants/scout-fb/run', {});
    assert.equal(first.status, 200);
    const second = await req('POST', '/api/assistants/scout-fb/run', {});
    assert.equal(second.status, 409);
    assert.match(second.body.error, /already out/);
    await settle(first.body.run.id);
  } finally { delete process.env.STUB_SORTIE_SLEEP; }
});

test('a run can be stopped, and the record says it was stopped rather than finished', async () => {
  await boot();
  seedTeam();
  process.env.STUB_SORTIE_SLEEP = '10000';
  try {
    const started = await req('POST', '/api/assistants/scout-fb/run', {});
    const id = started.body.run.id;
    const stop = await req('POST', '/api/runs/' + id + '/stop', {});
    assert.equal(stop.status, 200);
    const run = await settle(id, 15000);
    assert.equal(run.status, 'stopped');
    assert.match(run.summary, /Stopped before it finished/);
    assert.equal(getAssistant('scout-fb').status, 'idle', 'a stopped assistant is not left marked running');
  } finally { delete process.env.STUB_SORTIE_SLEEP; }
});

test('the one button sends every assistant, and reports who could not go', async () => {
  await boot();
  seedTeam();
  saveAssistant('vetter', { name: 'Vetter', job: 'Score every find', project: 'guest-hunt' }, { actor: 'crystal' });
  process.env.STUB_SORTIE_SLEEP = '400';
  try {
    const all = await req('POST', '/api/assistants/run', { actor: 'crystal' });
    assert.equal(all.status, 200);
    assert.equal(all.body.started.length, 2);
    assert.deepEqual(all.body.started.map(r => r.assistant).sort(), ['scout-fb', 'vetter']);

    // Press it twice: nobody goes out twice, and it says why rather than silently doing nothing.
    const again = await req('POST', '/api/assistants/run', { actor: 'crystal' });
    assert.equal(again.body.started.length, 0);
    assert.equal(again.body.skipped.length, 2);
    assert.match(again.body.skipped[0].reason, /already out/);

    for (const r of all.body.started) await settle(r.id);
  } finally { delete process.env.STUB_SORTIE_SLEEP; }
});

test('an assistant whose task is blocked comes home blocked, not idle', async () => {
  await boot();
  seedTeam();
  // Claimed the way an agent claims — `assigned` is written by claiming and by nothing else, which
  // saveTask enforces. Setting it by hand here would have tested a state the app cannot reach.
  saveTask('guest-hunt', 'ask-about-tone', {
    title: 'Should I approach the admin directly?',
  }, { actor: 'crystal' });
  claimTask('guest-hunt', 'ask-about-tone', { actor: 'scout-fb' });
  saveTask('guest-hunt', 'ask-about-tone', { status: 'blocked', needs_human: true }, { actor: 'scout-fb' });

  const started = await req('POST', '/api/assistants/scout-fb/run', {});
  await settle(started.body.run.id);
  // Blocked is a fact about the queue, read back after every run — not a flag somebody has to
  // remember to set. It is what puts the question band on ASSISTANTS.
  assert.equal(getAssistant('scout-fb').status, 'blocked');
});

test('GET /api/runs/:id answers one run, and 404s a name that is not one', async () => {
  await boot();
  seedTeam();
  const started = await req('POST', '/api/assistants/scout-fb/run', {});
  const id = started.body.run.id;
  await settle(id);
  const one = await req('GET', '/api/runs/' + id);
  assert.equal(one.status, 200);
  assert.equal(one.body.run.id, id);
  assert.equal(one.body.running, false);
  assert.equal((await req('GET', '/api/runs/never-happened')).status, 404);
});

// ── the counting rule, on its own ──────────────────────────────────────────────────────────────

test('countWork reads the log, is scoped to one actor, and ignores everything outside the window', async () => {
  freshRoot();
  const { logEvent } = await import('../backend/log.mjs');
  const before = new Date(Date.now() - 60_000).toISOString();
  logEvent({ type: 'store', actor: 'scout-fb', target: 'data/guests/a.md' });
  logEvent({ type: 'store', actor: 'vetter', target: 'data/guests/b.md' });   // somebody else's find
  logEvent({ type: 'skip', actor: 'scout-fb', target: 'data/guests/c.md' });
  logEvent({ type: 'refused', actor: 'scout-fb', target: 'data/guests/a.md' });

  const w = countWork('scout-fb', before);
  assert.equal(w.found, 1);
  assert.equal(w.skipped, 1);
  assert.equal(w.refused, 1);

  // A window that closed before any of it happened counts none of it.
  const after = new Date(Date.now() + 60_000).toISOString();
  assert.equal(countWork('scout-fb', after).found, 0);
  assert.match(countedLine({ found: 2, skipped: 3 }), /2 stored · 3 already known/);
  assert.match(countedLine({}), /it wrote nothing/);
});

test('a reply longer than the summary budget is trimmed, and SAYS it was trimmed', async () => {
  await boot();
  seedTeam();
  const { MAX_SUMMARY_CHARS } = await import('../backend/dispatch.mjs');
  process.env.STUB_SORTIE_NAME = 'X'.repeat(40);   // a long name makes a long reply
  process.env.STUB_SORTIE_BLATHER = String(MAX_SUMMARY_CHARS + 500);
  try {
    const started = await req('POST', '/api/assistants/scout-fb/run', {});
    const run = await settle(started.body.run.id);
    // A summary that stops mid-sentence with no explanation reads as a crash. Same rule the hot
    // cache lives by: a silent truncation is a defect.
    assert.match(run.summary, /the rest of the reply is not kept here/);
    assert.match(run.summary, /Counted from the log/, 'and the counted line still lands, after it');
  } finally { delete process.env.STUB_SORTIE_NAME; delete process.env.STUB_SORTIE_BLATHER; }
});

test('sendOut refuses an assistant that does not exist', async () => {
  await boot();
  seedTeam();
  assert.throws(() => sendOut('nobody', {}), e => e instanceof DispatchError && e.status === 404);
});

// ── the schedule ───────────────────────────────────────────────────────────────────────────────
// `schedule:` has been on every assistant file since M4 and on the HIRE screen since M5, and for
// that whole time nothing acted on it: the card said "Every morning" over an assistant that had
// never once gone out by itself. These guard the rule, not the timer.

test('a schedule written as a label still means what it says', () => {
  assert.equal(normalizeSchedule('daily'), 'daily');
  assert.equal(normalizeSchedule('every morning'), 'daily');   // what intake.mjs used to write
  assert.equal(normalizeSchedule('All day'), 'continuous');
  assert.equal(normalizeSchedule('Once a week'), 'weekly');
  // Anything we cannot plainly read is MANUAL. Guessing wrong here spends the person's money.
  assert.equal(normalizeSchedule('only when I ask'), 'manual');
  assert.equal(normalizeSchedule('every other tuesday'), 'manual');
  assert.equal(normalizeSchedule(''), 'manual');
  assert.equal(normalizeSchedule(undefined), 'manual');
});

test('dueNow answers each schedule against its last run, with no clock of its own', () => {
  const at = (h, m = 0) => { const d = new Date(2026, 7, 20, h, m, 0, 0); return d; };
  const run = d => ({ started: d.toISOString(), ended: d.toISOString() });

  // manual never goes, however long it has been.
  assert.equal(dueNow({ schedule: 'manual' }, null, at(11)), false);

  // daily: not before the hour, once after it, and not twice in one day.
  assert.equal(dueNow({ schedule: 'daily' }, null, at(DAILY_HOUR - 1)), false, 'before the hour');
  assert.equal(dueNow({ schedule: 'daily' }, null, at(9)), true, 'never run');
  assert.equal(dueNow({ schedule: 'daily' }, run(at(7)), at(9)), false, 'already went this morning');
  assert.equal(dueNow({ schedule: 'daily' }, run(at(DAILY_HOUR - 2)), at(9)), true, 'last night’s run is not this morning’s');

  // weekly.
  const weekAgo = new Date(at(9).getTime() - 8 * 24 * 3600_000);
  assert.equal(dueNow({ schedule: 'weekly' }, run(new Date(at(9).getTime() - 2 * 24 * 3600_000)), at(9)), false);
  assert.equal(dueNow({ schedule: 'weekly' }, run(weekAgo), at(9)), true);

  // continuous is measured from when it CAME HOME. A run longer than the gap would otherwise be
  // due again the instant it finished, for ever.
  const long = { started: new Date(at(9).getTime() - 5 * 3600_000).toISOString(), ended: at(9).toISOString() };
  assert.equal(dueNow({ schedule: 'continuous' }, long, at(9, 5)), false);
  assert.equal(dueNow({ schedule: 'continuous' }, long, at(11)), true);
});

test('the scheduler does nothing at all until she has turned it on', async () => {
  await boot();
  seedTeam();
  saveAssistant('scout-fb', { schedule: 'daily' }, { actor: 'crystal' });

  // autoRun defaults to false, deliberately: sending an assistant out spends money, and nothing in
  // this app spends money without a press.
  assert.deepEqual(schedulerTick({ now: new Date(2026, 7, 20, 9) }), []);
  assert.equal(listRuns({ limit: 5 }).length, 0, 'and it recorded nothing');

  saveSettings({ autoRun: true });
  const due = dueAssistants(new Date(2026, 7, 20, 9)).map(a => a.id);
  assert.deepEqual(due, ['scout-fb']);
  const sent = schedulerTick({ now: new Date(2026, 7, 20, 9) });
  assert.deepEqual(sent, ['scout-fb']);
  const run = await settle(listRuns({ limit: 5 })[0].id);
  assert.equal(run.status, 'done');

  // …and it does not go out twice for the same morning.
  assert.deepEqual(schedulerTick({ now: new Date(2026, 7, 20, 9, 30) }), []);
  saveSettings({ autoRun: false });
});

test('a scheduled sweep with no CLI connected raises the alarm once, not once per assistant', async () => {
  await boot();
  seedTeam({ command: path.join(here, 'fixtures', 'no-such-cli') });
  saveSettings({ autoRun: true });
  saveAssistant('scout-fb', { schedule: 'daily' }, { actor: 'crystal' });
  saveAssistant('vetter', { name: 'Vetter', job: 'Score', schedule: 'daily', project: 'guest-hunt' }, { actor: 'crystal' });
  try {
    assert.deepEqual(schedulerTick({ now: new Date(2026, 7, 20, 9) }), []);
    assert.equal(listRuns({ limit: 5 }).length, 0);
  } finally { saveSettings({ autoRun: false }); stopScheduler(); }
});

test('GET /api/schedule says what the schedule actually means right now', async () => {
  await boot();
  seedTeam();
  saveAssistant('scout-fb', { schedule: 'daily' }, { actor: 'crystal' });
  const off = await req('GET', '/api/schedule');
  assert.equal(off.status, 200);
  // Three separate facts, and a screen needs all three: what the schedules SAY, whether anything
  // acts on them, and who is due right now.
  assert.equal(off.body.auto, false, '`auto` is whether anything acts on a schedule');
  assert.equal(off.body.scheduled, 1, '`scheduled` counts the ones this app can actually act on');
  assert.deepEqual(off.body.due.map(d => d.id), ['scout-fb'], '`due` is what the schedule says');

  // A schedule she plainly meant — and that this app will not act on — counts as NONE, both here
  // and on her card. The seeded workspace ships four of these ("every 6 hours", "Sundays at 7am"),
  // and counting the raw strings would have promised four sweeps a night that are never coming.
  saveAssistant('scout-fb', { schedule: 'every 6 hours' }, { actor: 'crystal' });
  const vague = await req('GET', '/api/schedule');
  assert.equal(vague.body.scheduled, 0);
  assert.deepEqual(vague.body.due, []);
  assert.equal(getAssistant('scout-fb').schedule_kind, 'manual', 'and the assistant says so itself');
  assert.equal(getAssistant('scout-fb').schedule, 'every 6 hours', 'while her own words are untouched');
});

// Poll the run record until it has an `ended`. The route answers before the work finishes, which is
// the design — so every assertion about an OUTCOME has to wait for one.
async function settle(id, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = listRuns({ limit: 200 }).find(r => String(r.id) === String(id));
    if (found && found.ended) return found;
    if (Date.now() > deadline) throw new Error('run ' + id + ' never finished');
    await new Promise(r => setTimeout(r, 40));
  }
}
