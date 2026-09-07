// M4 / T12 — assistants, the task queue, and the claim.
//
// The load-bearing test in this file is the last one: THREE PROCESSES RACING OVER ONE QUEUE. T12's
// Demonstrate is "three agents claim from one queue concurrently with no lost or double-claimed
// task", and the only way to demonstrate that is to actually race — a happy-path assertion that
// claim-then-claim returns false would pass against an implementation with the classic
// read-modify-write hole in it, because a single-threaded test never interleaves.

import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { freshRoot, getStorageRoot } from './helpers.mjs';
import {
  listAssistants, getAssistant, saveAssistant,
  listTasks, getTask, saveTask, claimTask, findTask,
  saveFinding, listFindings, findingPath,
  appendRun, listRuns, registerTaskRoutes, TaskError,
} from '../backend/tasks.mjs';
import { listProposals } from '../backend/proposals.mjs';
import { registerProposalRoutes } from '../backend/proposals.mjs';

const R = () => getStorageRoot();

// A server carrying ONLY the modules under test. index.mjs is an integration point owned by someone
// else (docs/08 §0) — these routes are exported to be mounted, so the test mounts them itself.
let baseUrl;
async function server() {
  if (baseUrl) return baseUrl;
  const app = express();
  app.use(express.json());
  registerTaskRoutes(app, {});
  registerProposalRoutes(app, {});
  const s = await new Promise(resolve => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  s.unref();
  baseUrl = 'http://127.0.0.1:' + s.address().port;
  return baseUrl;
}
async function req(method, p, body) {
  const r = await fetch((await server()) + p, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: parsed };
}

function seedProjectDir(pid) {
  fs.mkdirSync(path.join(R(), 'projects', pid, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(R(), 'projects', pid, 'project.md'), '---\nname: ' + pid + '\n---\n');
  return pid;
}

// ── assistants ─────────────────────────────────────────────────────────────────────────────────

test('an assistant is a name and a job; a sub-agent is one that names its parent', () => {
  freshRoot();
  saveAssistant('vetter', { name: 'Vetter', job: 'Read every find and score it', model: 'haiku' }, { actor: 'crystal' });
  saveAssistant('scout-fb', {
    name: 'Scout FB', job: 'Sweep Philippine Facebook groups for nurse guests',
    parent: 'vetter', scope: { collections: ['guest'], territory: ['nurses-ph'] }, schedule: 'daily 06:00',
  }, { actor: 'crystal' });

  const all = listAssistants();
  assert.deepEqual(all.map(a => a.id).sort(), ['scout-fb', 'vetter']);
  const sub = getAssistant('scout-fb');
  assert.equal(sub.parent, 'vetter');
  assert.deepEqual(sub.scope.territory, ['nurses-ph']);
  assert.equal(sub.created_by, 'crystal');
  // one file per entity, at the path the folder-mode agent is told to look in
  assert.ok(fs.existsSync(path.join(R(), 'assistants', 'scout-fb.md')));
});

test('an assistant cannot be its own parent', () => {
  freshRoot();
  assert.throws(() => saveAssistant('loop', { parent: 'loop' }), /own parent/);
});

// ── tasks ──────────────────────────────────────────────────────────────────────────────────────

test('a task is one file under its project, and lists filter by project and status', () => {
  freshRoot();
  seedProjectDir('guest-hunt'); seedProjectDir('supplier-hunt');
  saveTask('guest-hunt', 'sweep-nurses-ph', { title: 'Sweep Nurses PH', body: 'Look for nurses who cook.' }, { actor: 'crystal' });
  saveTask('guest-hunt', 'sweep-ofw', { title: 'Sweep OFW Stories', status: 'done' }, { actor: 'crystal' });
  saveTask('supplier-hunt', 'call-cebu', { title: 'Call Cebu shops' }, { actor: 'crystal' });

  assert.equal(listTasks().length, 3);
  assert.equal(listTasks({ project: 'guest-hunt' }).length, 2);
  assert.deepEqual(listTasks({ status: 'open' }).map(t => t.id).sort(), ['call-cebu', 'sweep-nurses-ph']);
  assert.equal(getTask('guest-hunt', 'sweep-nurses-ph').body, 'Look for nurses who cook.');
  // resolvable by id alone — the claim route has no project in its path
  assert.equal(findTask('call-cebu').project, 'supplier-hunt');
});

test('an unknown status is refused and names the legal set', () => {
  freshRoot(); seedProjectDir('p');
  assert.throws(() => saveTask('p', 't', { status: 'in-progress' }), /open · claimed · done · blocked/);
});

test('saveTask refuses to write assigned/claimed_at — claiming is the only writer', () => {
  freshRoot(); seedProjectDir('p');
  saveTask('p', 't', { title: 'T' });
  assert.throws(() => saveTask('p', 't', { assigned: 'scout-fb' }), /claiming only/);
  assert.throws(() => saveTask('p', 't', { claimed_at: 'now' }), /claiming only/);
  assert.equal(getTask('p', 't').assigned, null);
});

// ── the claim ──────────────────────────────────────────────────────────────────────────────────

test('the first claimer wins; the second is told who holds it and the file is unchanged', () => {
  freshRoot(); seedProjectDir('p');
  saveTask('p', 'sweep', { title: 'Sweep' });

  const a = claimTask('p', 'sweep', { actor: 'scout-fb' });
  assert.equal(a.won, true);
  assert.equal(a.task.status, 'claimed');
  assert.ok(a.task.claimed_at);

  const b = claimTask('p', 'sweep', { actor: 'scout-ig' });
  assert.equal(b.won, false);
  assert.equal(b.reason, 'claimed');
  assert.equal(b.assigned, 'scout-fb');
  assert.equal(getTask('p', 'sweep').assigned, 'scout-fb', 'the loser must not have overwritten the winner');
});

test('re-claiming your own task is idempotent, and re-opening returns it to the queue', () => {
  freshRoot(); seedProjectDir('p');
  saveTask('p', 'sweep', { title: 'Sweep' });
  claimTask('p', 'sweep', { actor: 'scout-fb' });
  assert.equal(claimTask('p', 'sweep', { actor: 'scout-fb' }).won, true);

  saveTask('p', 'sweep', { status: 'open' }, { actor: 'crystal' });
  const t = getTask('p', 'sweep');
  assert.equal(t.assigned, null, 're-opening must drop the claim or the next claimer loses to a ghost');
  assert.equal(claimTask('p', 'sweep', { actor: 'scout-ig' }).won, true);
});

test('claiming a task that does not exist is a 404, not a silent false', () => {
  freshRoot(); seedProjectDir('p');
  assert.throws(() => claimTask('p', 'nope', { actor: 'a' }), (e) => e instanceof TaskError && e.status === 404);
});

// ── findings ───────────────────────────────────────────────────────────────────────────────────

test('two agents finding the same person write two files, not one', () => {
  freshRoot(); seedProjectDir('p');
  saveFinding('p', { agent: 'scout-fb', slug: 'Maria Santos', title: 'Maria Santos', body: 'Nurse who cooks.' });
  saveFinding('p', { agent: 'scout-ig', slug: 'Maria Santos', title: 'Maria Santos', body: 'Also found her.' });

  const files = fs.readdirSync(path.join(R(), 'projects', 'p', 'findings')).sort();
  assert.deepEqual(files, ['scout-fb-maria-santos.md', 'scout-ig-maria-santos.md']);
  assert.equal(listFindings('p').length, 2);
  assert.match(findingPath('p', 'scout-fb', 'Maria Santos'), /scout-fb-maria-santos\.md$/);
});

// ── runs ───────────────────────────────────────────────────────────────────────────────────────

test('runs are one file each, newest first, filterable by assistant', () => {
  freshRoot();
  appendRun({ assistant: 'scout-fb', started: '2026-08-17T06:00:00.000Z', status: 'done', cost: 0.12, summary: 'Swept Nurses PH. 34 found, 6 shortlisted.' });
  appendRun({ assistant: 'scout-fb', started: '2026-08-19T06:00:00.000Z', status: 'running', cost: 0.03 });
  appendRun({ assistant: 'vetter', started: '2026-08-18T06:00:00.000Z', status: 'done', cost: 0.4 });

  const all = listRuns({});
  assert.deepEqual(all.map(r => r.started), [
    '2026-08-19T06:00:00.000Z', '2026-08-18T06:00:00.000Z', '2026-08-17T06:00:00.000Z',
  ]);
  assert.equal(listRuns({ assistant: 'scout-fb' }).length, 2);
  assert.match(listRuns({ assistant: 'scout-fb' })[1].summary, /34 found/);
  assert.equal(fs.readdirSync(path.join(R(), 'runs')).length, 3);
});

// ── routes ─────────────────────────────────────────────────────────────────────────────────────

test('POST /api/tasks/:id/claim is 200 for the winner and 409 for everyone after', async () => {
  freshRoot(); seedProjectDir('p');
  await req('POST', '/api/tasks', { project: 'p', id: 'sweep', title: 'Sweep', actor: 'crystal' });

  const first = await req('POST', '/api/tasks/sweep/claim', { actor: 'scout-fb' });
  assert.equal(first.status, 200);
  assert.equal(first.body.won, true);

  const second = await req('POST', '/api/tasks/sweep/claim', { actor: 'scout-ig' });
  assert.equal(second.status, 409, 'the router skill tells agents to read 409 and take another');
  assert.equal(second.body.won, false);
  assert.equal(second.body.assigned, 'scout-fb');
});

test('needs_human pulls the task straight into the DECIDE queue, once', async () => {
  freshRoot(); seedProjectDir('p');
  await req('POST', '/api/tasks', {
    project: 'p', id: 'stuck', title: 'Which of the two Marias?', status: 'blocked',
    needs_human: true, body: 'Two accounts, same name. Which one do you mean?', actor: 'scout-fb',
  });
  let cards = listProposals({ status: 'open' });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, 'question');
  assert.match(cards[0].question, /Two accounts/);

  // saving the task again must not fill the queue with copies of the same ask
  await req('PATCH', '/api/tasks/stuck', { project: 'p', needs_human: true, actor: 'scout-fb' });
  cards = listProposals({ status: 'open' });
  assert.equal(cards.length, 1, 'the same blocked task must not produce a second card');
});

test('GET /api/assistants and /api/runs serve what the modules wrote', async () => {
  freshRoot();
  saveAssistant('scout-fb', { name: 'Scout FB', job: 'Sweep groups' });
  appendRun({ assistant: 'scout-fb', status: 'done', summary: 'ok' });
  assert.equal((await req('GET', '/api/assistants')).body.assistants[0].name, 'Scout FB');
  assert.equal((await req('GET', '/api/runs?assistant=scout-fb')).body.runs.length, 1);
});

// ── THE RACE ───────────────────────────────────────────────────────────────────────────────────
// Real OS processes, a real shared filesystem, a starting gun so they collide rather than queue.
// Every worker loops the open list and tries to claim everything it sees, which is the worst case:
// maximum contention on every single file.

const CLAIMER = (tasksUrl) => `
import fs from 'node:fs';
import { claimTask, listTasks } from '${tasksUrl}';
const [actor, goFile, deadlineMs] = process.argv.slice(2);
// Two-phase barrier. A one-phase "wait for the gun" is not enough: the gun fires when the LAST
// process was spawned, not when the last process finished importing, so whoever booted first eats
// the whole queue and the "race" never happens. Announce ready, then wait.
fs.writeFileSync(goFile + '.' + actor + '.ready', '1');
while (!fs.existsSync(goFile)) {}
const deadline = Date.now() + Number(deadlineMs);
const won = [];
let attempts = 0;
while (Date.now() < deadline) {
  const open = listTasks({ status: 'open' });
  if (!open.length) break;
  // Start at a different point in the queue each pass, so the three do not walk in lockstep and
  // the collisions land all over the queue instead of only on whichever file is first.
  const off = Math.floor(Math.random() * open.length);
  for (let i = 0; i < open.length; i++) {
    const t = open[(i + off) % open.length];
    attempts++;
    const r = claimTask(t.project, t.id, { actor });
    if (r.won) won.push(t.id);
  }
}
process.stdout.write(JSON.stringify({ actor, won, attempts }));
`;

test('three agents claiming from one queue concurrently: no lost task, no double claim', async () => {
  const root = freshRoot();
  seedProjectDir('guest-hunt');
  const TASKS = Number(process.env.SCOUT_RACE_TASKS || 120);
  const ACTORS = ['scout-fb', 'scout-ig', 'scout-web'];
  for (let i = 0; i < TASKS; i++) saveTask('guest-hunt', 'sweep-' + String(i).padStart(3, '0'), { title: 'Sweep ' + i });

  // The workers and the starting gun live outside the workspace — a vault is not a scratch dir.
  const scratch = path.dirname(process.env.SCOUT_CONFIG);
  const worker = path.join(scratch, 'claimer.mjs');
  const goFile = path.join(scratch, 'go-' + Date.now());
  fs.writeFileSync(worker, CLAIMER(new URL('../backend/tasks.mjs', import.meta.url).href));

  const runs = ACTORS.map(actor => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, actor, goFile, String(process.env.SCOUT_RACE_MS || 20000)], {
      env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(actor + ' exited ' + code + ': ' + err))));
  }));

  // fire only once every worker has booted and is spinning on the gun
  const readyBy = Date.now() + 30000;
  while (ACTORS.some(a => !fs.existsSync(goFile + '.' + a + '.ready'))) {
    if (Date.now() > readyBy) throw new Error('workers never reported ready');
    await new Promise(r => setTimeout(r, 5));
  }
  fs.writeFileSync(goFile, 'go');
  const results = await Promise.all(runs);

  const claimed = results.flatMap(r => r.won);
  const dupes = claimed.filter((id, i) => claimed.indexOf(id) !== i);
  assert.deepEqual(dupes, [], 'DOUBLE CLAIM — the same task was won by two agents: ' + dupes.join(', '));
  assert.equal(claimed.length, TASKS, 'LOST TASK — ' + (TASKS - claimed.length) + ' of ' + TASKS + ' were never won');

  // and the files agree with the winners: every task is claimed, by exactly the actor that said so
  const winner = new Map();
  for (const r of results) for (const id of r.won) winner.set(id, r.actor);
  const onDisk = listTasks({ project: 'guest-hunt' });
  assert.equal(onDisk.length, TASKS);
  for (const t of onDisk) {
    assert.equal(t.status, 'claimed', t.id + ' is still ' + t.status);
    assert.equal(t.assigned, winner.get(t.id), t.id + ' on disk says ' + t.assigned + ', but ' + winner.get(t.id) + ' claimed it');
  }
  // every worker actually contended (a race in which two processes never overlapped proves nothing)
  for (const r of results) assert.ok(r.attempts > 0, r.actor + ' never attempted a claim');
  const contention = results.reduce((n, r) => n + r.attempts, 0);
  assert.ok(contention > TASKS, 'only ' + contention + ' attempts for ' + TASKS + ' tasks — the workers did not overlap');
  // Every process must have WON something, not merely tried. If one worker takes the whole queue
  // the assertions above still pass while proving nothing about concurrent claiming.
  for (const r of results) assert.ok(r.won.length > 0, r.actor + ' won nothing — the workers did not truly overlap');

  process.stdout.write('\n  RACE · ' + TASKS + ' tasks · ' + ACTORS.length + ' processes · '
    + contention + ' claim attempts · won: '
    + results.map(r => r.actor + '=' + r.won.length).join(' ') + ' · dupes=0 · lost=0\n');
  assert.ok(fs.existsSync(root));
});

// ── what the card asks her, and what a task is called ─────────────────────────────────────────
//
// Both of these were found by driving the app the way a human and an assistant actually do, with
// the whole suite green. See docs/decisions.md — "the agent's path was exercised and the human's
// was not" is the same shape a third time.

test('a blocked task asks HER QUESTION, not its own id', async () => {
  freshRoot(); seedProjectDir('p');
  // exactly what backend/agentIndex.mjs tells an agent to send: "blocked with needs_human and a
  // plain-language question", through frontend/api.js's { patch, actor } envelope.
  await req('POST', '/api/tasks', { project: 'p', title: 'Check UK scope', actor: 'scout' });
  const r = await req('PATCH', '/api/tasks/check-uk-scope', {
    patch: { status: 'blocked', needs_human: true, question: 'Are UK-based nurses in scope?' },
    project: 'p', actor: 'scout',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.question, 'Are UK-based nurses in scope?', 'the question must round-trip onto the file');

  const [card] = listProposals({ status: 'open' });
  assert.ok(card, 'a blocked task with needs_human must raise a card');
  assert.equal(card.kind, 'question');
  // The defect: the card asked her `task.body || task.title`, and with no body that is the slug id.
  assert.equal(card.question, 'Are UK-based nurses in scope?');
  assert.notEqual(card.question, 'check-uk-scope');
});

test('a task named only by its label is asked by that label, and a body still wins over nothing', async () => {
  freshRoot(); seedProjectDir('p');
  // The interview writes every task with `label` and no title (backend/intake.mjs startFirstWork).
  await req('POST', '/api/tasks', {
    project: 'p', label: 'Look through Nurses PH for guests', status: 'blocked', needs_human: true,
    body: 'Do you want the private group or the public page?', actor: 'scout',
  });
  const [card] = listProposals({ status: 'open' });
  assert.equal(card.question, 'Do you want the private group or the public page?');
  assert.equal(card.title, 'Look through Nurses PH for guests', 'the card names the task the way the screen does');
});

test('two tasks named only by their label are two files, not one merged one', async () => {
  freshRoot(); seedProjectDir('p');
  // `id || slugify(patch.title)` derived `untitled` from a label-only task, and saveTask MERGES —
  // so the second POST landed on the first one's file and inherited its territory. Laws 5 and 6.
  const a = await req('POST', '/api/tasks', { project: 'p', label: 'Sweep nurses-ph', territory: 'nurses-ph', actor: 'scout' });
  const b = await req('POST', '/api/tasks', { project: 'p', label: 'Sweep ofw-uk', territory: 'ofw-uk', actor: 'scout' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.body.id, b.body.id, 'both labels slugified to the same id');
  assert.equal(b.body.territory, 'ofw-uk', "the first task's territory leaked onto the second");

  const files = fs.readdirSync(path.join(R(), 'projects', 'p', 'tasks')).filter(f => f.endsWith('.md')).sort();
  assert.deepEqual(files, ['sweep-nurses-ph.md', 'sweep-ofw-uk.md']);
  assert.equal(listTasks({ project: 'p' }).length, 2);
});

test('a task with no title, no label and no id is a 400 that says so — never a file called untitled', async () => {
  freshRoot(); seedProjectDir('p');
  const r = await req('POST', '/api/tasks', { project: 'p', status: 'open', actor: 'scout' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /a task needs a title/);
  assert.ok(!fs.existsSync(path.join(R(), 'projects', 'p', 'tasks', 'untitled.md')));
  // and the second half of the guard, for any caller that is not the route
  assert.throws(() => saveTask('p', 'untitled', { status: 'open' }, { actor: 'scout' }), /a task needs a title/);
  // a task somebody genuinely called "Untitled" still saves — it arrives with a name
  assert.equal(saveTask('p', 'untitled', { label: 'Untitled' }, { actor: 'scout' }).label, 'Untitled');
});
