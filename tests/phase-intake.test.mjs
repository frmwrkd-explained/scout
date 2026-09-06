// M5 / T16 step 3 — the first-run interview. GOAL.md gate 1, docs/01_CANON.md Law 9.
//
// The thing under test is not "the questions render". It is the four promises the interview makes:
//
//   1. NOTHING IS LOST. Every answer is on disk the moment it is given, so closing the window
//      between question three and four resumes on question four with three answers intact.
//   2. NOTHING IS CREATED SILENTLY. The collection is a CARD. The interview writes identity and
//      ground — neither needs approval — and it never calls saveCollection itself.
//   3. THE VIEW IS FREE. Once the card is accepted, the view exists without anyone approving it,
//      and its type came off the shape (agent contract §4, docs/02 §3).
//   4. NOBODY IS INTERVIEWED TWICE. isFirstRun() is honest about a workspace that already exists,
//      including the workspace TEMPLATE's placeholder me.md.

import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { freshRoot, getStorageRoot } from './helpers.mjs';
import {
  QUESTIONS, QUESTION_KEYS, PLAIN_TYPE,
  isFirstRun, identityWritten, interviewState, saveAnswer, proposeWorkspace, buildWorkspace,
  settleWorkspace, collectionIdFrom, territoriesFrom, meFrom, registerIntakeRoutes, intakePath,
  goalFrom, deadlineFrom, targetFrom,
} from '../backend/intake.mjs';
import { validateSchema, saveCollection, getCollection, listCollectionIds } from '../backend/collections.mjs';
import { listViews, inferViewType } from '../backend/views.mjs';
import { propose, accept, getProposal } from '../backend/proposals.mjs';
import { readMe, cancelCacheRegen, listGoals, renderCache } from '../backend/memory.mjs';
import { getTerritory, listTerritories } from '../backend/territory.mjs';
import { writeMd } from '../backend/store.mjs';

const R = () => getStorageRoot();

// One real person's answers, in the register the examples teach.
const ANSWERS = {
  name: 'Crystal',
  work: 'I produce a Philippine podcast about work and family. Most of my week goes on finding people worth interviewing',
  win: 'Someone replies and agrees to a call',
  chasing: 'Six guests with a hazing story, by the end of August',
  thing: 'People who might be good guests',
  know: 'Their name, where I found them, an email address, and how strong their story is out of ten',
  where: 'Facebook groups for nurses, and groups for overseas workers',
};

function answerAll(answers = ANSWERS, actor = 'crystal') {
  let state = null;
  for (const q of QUESTIONS) state = saveAnswer(q.key, answers[q.key] ?? '', { actor });
  return state;
}

// ── the questions themselves ───────────────────────────────────────────────────────────────────

test('every question carries an example answer — T16 step 3', () => {
  assert.ok(QUESTIONS.length >= 6, 'the interview asks at least the six things GOAL.md names');
  for (const q of QUESTIONS) {
    assert.ok(q.key && /^[a-z][a-z_]*$/.test(q.key), q.key + ' is a usable key');
    assert.ok(String(q.question).trim().endsWith('?'), q.key + ' asks a question');
    assert.ok(String(q.example).trim().length > 0, q.key + ' shows an example answer');
    assert.ok(String(q.becomes).trim().length > 0, q.key + ' says what it is for');
  }
  // The shape GOAL.md gate 1 and the task describe: who they are, what a win is, what they are
  // chasing, what to collect, what to know about each, where they come from.
  for (const key of ['name', 'work', 'win', 'chasing', 'thing', 'know', 'where']) {
    assert.ok(QUESTION_KEYS.includes(key), 'the interview asks about ' + key);
  }
});

test('no field type or schema jargon reaches the screen', () => {
  // The reader is non-technical (GOAL.md §8). Nothing the API hands the screen may say "field",
  // "collection", "schema" or a type name.
  const jargon = /\b(field|schema|collection|frontmatter|yaml|multiselect|rollup|primary key)\b/i;
  for (const q of QUESTIONS) {
    for (const part of [q.question, q.hint, q.becomes, q.example]) {
      assert.ok(!jargon.test(String(part || '')), q.key + ' speaks plainly: ' + part);
    }
  }
  // and the plain vocabulary is AddField.jsx's, not a third wording
  assert.equal(PLAIN_TYPE.text, 'Words');
  assert.equal(PLAIN_TYPE.number, 'A number');
  assert.equal(PLAIN_TYPE.status, 'A stage');
});

// ── 4 · is this a first run? ───────────────────────────────────────────────────────────────────

test('isFirstRun is true on an empty workspace and false once one exists', () => {
  freshRoot();
  assert.equal(isFirstRun(), true);

  // a collection alone is enough to say "this person has a workspace"
  saveCollection({
    id: 'guest', label: 'Guests', query: { path: 'data/guest/**' },
    fields: [{ key: 'name', type: 'text', primary: true }],
  });
  assert.equal(isFirstRun(), false);
});

test('the workspace template placeholder me.md is not an identity', () => {
  freshRoot();
  // exactly what workspace-template/me.md ships
  writeMd(path.join(R(), 'me.md'), { name: '__NAME__', active_project: null },
    '## Who I am\n(not set yet — your assistant will ask you)\n');
  assert.equal(identityWritten(), false, 'a placeholder is not somebody');
  assert.equal(isFirstRun(), true, 'the template must not stop the interview happening');
});

test('a real me.md ends the first run', () => {
  freshRoot();
  writeMd(path.join(R(), 'me.md'), { name: 'Crystal' }, "I'm Crystal. I produce a podcast.\n");
  assert.equal(identityWritten(), true);
  assert.equal(isFirstRun(), false);
});

// ── 1 · nothing is lost ────────────────────────────────────────────────────────────────────────

test('each answer is on disk the moment it is given, and the interview resumes there', () => {
  freshRoot();
  assert.equal(interviewState().step, 0);

  saveAnswer('name', 'Crystal');
  assert.ok(fs.existsSync(intakePath()), 'the very first answer created the file');
  saveAnswer('work', ANSWERS.work);
  saveAnswer('win', ANSWERS.win);

  // the window is closed here. Nothing is in memory; everything below is read back off disk.
  const resumed = interviewState();
  assert.equal(resumed.step, 3, 'resumes on question four');
  assert.equal(resumed.answers.name, 'Crystal');
  assert.equal(resumed.answers.win, ANSWERS.win);
  assert.equal(resumed.complete, false);

  // Law 8: the same answers are readable in the file without the app
  const raw = fs.readFileSync(intakePath(), 'utf8');
  assert.ok(raw.includes('Crystal'), 'the answer is legible in the markdown');
  assert.ok(raw.includes(QUESTIONS[0].question), 'so is the question it answered');
});

test('an optional question left blank still counts as answered', () => {
  freshRoot();
  saveAnswer('name', 'Crystal');
  saveAnswer('work', ANSWERS.work);
  saveAnswer('win', '');
  assert.equal(interviewState().step, 3, 'a deliberate blank does not put them back on it');
});

test('a required question refuses a blank, and an unknown question refuses outright', () => {
  freshRoot();
  assert.throws(() => saveAnswer('name', '  '), /answer/i);
  assert.throws(() => saveAnswer('favourite-colour', 'blue'), /no interview question/i);
  // the refusal names the legal set rather than making the caller go and read the source
  try { saveAnswer('favourite-colour', 'blue'); } catch (e) {
    assert.ok(e.message.includes('name'), 'the error lists the real questions');
    assert.equal(e.status, 400);
  }
});

// ── the plan the answers produce ───────────────────────────────────────────────────────────────

test('the collection is named from the answer, not from a template', () => {
  freshRoot();
  assert.equal(collectionIdFrom('People who might be good guests'), 'guest');
  assert.equal(collectionIdFrom('Shops in Cebu I could sell to'), 'shop');
  assert.equal(collectionIdFrom('Candidates for the warehouse role'), 'candidate');
  assert.equal(collectionIdFrom('Suppliers'), 'supplier');
  // an id already in use is numbered, never silently reused
  assert.equal(collectionIdFrom('Guests', ['guest']), 'guest-2');
});

test('the columns come from their own words, with the type read off the phrase', () => {
  freshRoot();
  const plan = proposeWorkspace(ANSWERS);
  const byKey = Object.fromEntries(plan.schema.fields.map(f => [f.key, f]));

  assert.equal(plan.schema.id, 'guest');
  assert.equal(plan.schema.label, 'People who might be good guests');

  // "their name" folds into the document's own title — it is never a column beside it
  assert.equal(byKey.name.primary, true);
  assert.equal(plan.schema.fields.filter(f => f.primary).length, 1, 'exactly one primary field');

  assert.equal(byKey.email.type, 'email', '"an email address" is typed, so it renders as an action');
  assert.equal(byKey.found_in.type, 'text', '"where I found them" is the field territory scoring reads');
  const score = plan.schema.fields.find(f => f.type === 'number');
  assert.ok(score, '"how strong their story is out of ten" is a number');
  assert.equal(score.display, 'bar');
  assert.equal(score.max, 10, 'the stated ceiling is kept');
  // the label is always the person's own phrase
  assert.match(score.label, /how strong/i);
});

test('the gate is real: shortlist exists and everything past it is human-only', () => {
  freshRoot();
  const { schema } = proposeWorkspace(ANSWERS);
  const gates = schema.fields.filter(f => f.gate);
  assert.equal(gates.length, 1, 'at most one gate field, and a first list needs one');
  assert.equal(gates[0].type, 'status');
  const options = gates[0].options.map(o => o.value);
  assert.ok(options.includes('shortlist'), 'records.mjs AGENT_MAX_STAGE indexes into this list');
  assert.ok(options.indexOf('shortlist') < options.length - 1, 'there are stages only a human can reach');
  for (const o of gates[0].options) {
    assert.ok(['todo', 'active', 'done'].includes(o.group), o.value + ' belongs to a board column');
    assert.match(String(o.colour), /^var\(--[a-z0-9-]+\)$/, o.value + ' uses a token, never a hex');
  }
});

test('the proposed schema is one collections.mjs will actually accept', () => {
  freshRoot();
  const { schema } = proposeWorkspace(ANSWERS);
  assert.doesNotThrow(() => validateSchema(schema));

  // and one with every question answered awkwardly still validates — the failure mode this guards
  // is a 400 discovered on the card the person just approved.
  const awkward = proposeWorkspace({
    ...ANSWERS,
    thing: 'stuff',
    know: 'when it was created, when it was updated, who created it, a note, a note, a photo',
  });
  assert.doesNotThrow(() => validateSchema(awkward.schema), 'automatic field names are reserved away');
  assert.ok(!awkward.schema.fields.some(f => ['created', 'updated', 'created_by'].includes(f.key)));
  const noteKeys = awkward.schema.fields.filter(f => /^note/.test(f.key)).map(f => f.key);
  assert.deepEqual(noteKeys, ['note', 'note_2'], 'a repeated column is numbered, not dropped');
});

test('the ground is read off the answer, untried, with a handle the cache can render', () => {
  freshRoot();
  const t = territoriesFrom(ANSWERS.where);
  assert.equal(t.length, 2);
  assert.equal(t[0].id, 'nurses');
  assert.equal(t[0].kind, 'facebook-group', 'memory.mjs handleOf renders this as #group/nurses');
  assert.equal(t[1].id, 'overseas-workers', '"groups for X" is a place called X');
  for (const one of t) assert.equal(one.access, 'untried', 'the agent has never worked it and must ask first');
});

test('me.md is prose in their own words, not a form dump', () => {
  freshRoot();
  const me = meFrom(ANSWERS);
  assert.match(me.body, /^I'm Crystal\. I produce a Philippine podcast/, 'first person, their sentence');
  assert.ok(me.body.includes('Someone replies and agrees to a call.'), 'their words, punctuated');
  assert.ok(!/^\s*-\s/m.test(me.body), 'no bullet dump');
  assert.ok(!/[A-Za-z_]+:\s/.test(me.body.split('\n')[0]), 'the first line is a sentence, not a key');
  assert.equal(me.data.name, 'Crystal');
  assert.equal(me.data.owner, undefined,
    'never `owner`: memory.mjs isAgentActor would then 403 the UI default actor out of her own file');
});

// ── 2 · nothing is created silently ────────────────────────────────────────────────────────────

test('build writes identity and ground, and creates no collection and no records', () => {
  freshRoot();
  answerAll();
  const built = buildWorkspace({ actor: 'crystal' });

  assert.ok(built.me, 'me.md exists');
  assert.match(readMe().body, /I'm Crystal/);
  assert.equal(readMe().data.name, 'Crystal');

  assert.equal(built.territory.length, 2);
  assert.equal(getTerritory('nurses').access, 'untried');
  assert.equal(listTerritories().length, 2);

  // the collection is a PROPOSAL. Nothing is on disk under .scout/collections and nothing under data/.
  assert.deepEqual(listCollectionIds(), [], 'the interview never calls saveCollection');
  assert.equal(fs.existsSync(path.join(R(), 'data')), false, 'the interview writes no documents');
  assert.ok(built.card && built.card.schema, 'it hands back a card instead');
});

test('me.md stays human-owned — an agent cannot complete somebody else\'s interview', () => {
  freshRoot();
  answerAll();
  // memory.mjs isAgentActor: an actor with an assistants/<id>.md IS an agent (docs/04 §5)
  writeMd(path.join(R(), 'assistants', 'scout.md'), { id: 'scout', name: 'Scout' }, '');
  assert.throws(() => buildWorkspace({ actor: 'scout' }), e => {
    assert.equal(e.status, 403);
    assert.match(e.message, /human-owned/);
    return true;
  });
});

test('the card the interview builds is one the DECIDE queue accepts, and accepting it builds the table', async () => {
  freshRoot();
  answerAll();
  const built = buildWorkspace({ actor: 'crystal' });

  // exactly the body POST /api/collections/propose forwards — one door, one queue (docs/08 §8)
  const card = propose({
    kind: 'schema', change: 'collection', schema: built.card.schema,
    title: 'New collection · ' + built.card.schema.id,
    why: built.card.why, evidence: built.card.evidence,
  }, { actor: 'scout' });

  assert.equal(card.kind, 'schema');
  assert.equal(card.status, 'open');
  assert.ok(card.evidence.length, 'a schema card carries evidence, never an opinion');
  assert.ok(card.evidence.some(e => String(e).includes(ANSWERS.thing)), 'the evidence is her own words');

  // GOAL.md gate 8: the human approves on ONE card and the table exists.
  const decided = await accept(card.id, { actor: 'crystal' });
  assert.equal(decided.status, 'accepted');
  assert.equal(getProposal(card.id).status, 'accepted');
  const collection = getCollection('guest');
  assert.ok(collection, 'the collection exists only after the card was accepted');
  assert.equal(collection.fields.length, built.card.schema.fields.length);
});

// ── 3 · the view is free ───────────────────────────────────────────────────────────────────────

test('a view is created without approval once the collection lands, with the type inferred', async () => {
  freshRoot();
  answerAll();
  const built = buildWorkspace({ actor: 'crystal' });

  const card = propose({
    kind: 'schema', change: 'collection', schema: built.card.schema,
    title: 'New collection', why: built.card.why, evidence: built.card.evidence,
  }, { actor: 'scout' });
  await accept(card.id, { actor: 'crystal' });

  // Either door settles it — proposals.mjs flushes the pending view the moment the collection
  // lands, and `GET /api/intake` calls settleWorkspace() for anyone who got here another way. What
  // matters is the OUTCOME: once the collection exists, the view is a FILE.
  settleWorkspace();
  const viewsFile = path.join(R(), '.scout', 'views', 'guest.json');
  assert.ok(fs.existsSync(viewsFile), 'saved in the vault, so it travels with the data');

  const found = listViews('guest');
  assert.equal(found.views.length, 1);
  // nobody was asked. The shape decided: a status field with more than two options is a board.
  assert.equal(found.views[0].type, inferViewType(getCollection('guest')));
  assert.equal(found.views[0].type, 'board');
  assert.equal(found.defaultViewId, 'all', 'the schema names a default view that resolves');

  // and it is idempotent — a second settle does not stack a second view
  assert.equal(settleWorkspace(), null);
  assert.equal(listViews('guest').views.length, 1);
});

test('interviewState hands the screen a read-back before anything is written', () => {
  freshRoot();
  answerAll();
  const state = interviewState();
  assert.equal(state.complete, true);
  assert.equal(state.step, QUESTIONS.length);
  assert.ok(state.plan, 'the plan is computed, not stored');
  assert.equal(state.plan.schema.id, 'guest');
  // the read-back is in plain language: her phrase, and a plain type name for the card
  const labels = state.plan.fields.map(f => f.label);
  assert.ok(labels.includes('Name'));
  assert.ok(labels.some(l => /email/i.test(l)));
  for (const f of state.plan.fields) assert.ok(Object.values(PLAIN_TYPE).includes(f.plain), f.key + ' has a plain name');
  // still nothing on disk
  assert.deepEqual(listCollectionIds(), []);
  assert.equal(identityWritten(), false);
});

// ── the routes ─────────────────────────────────────────────────────────────────────────────────

let baseUrl;
async function server() {
  if (baseUrl) return baseUrl;
  const app = express();
  app.use(express.json());
  registerIntakeRoutes(app, {});
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

test('GET /api/intake · POST /api/intake/answer · POST /api/intake/build', async () => {
  freshRoot();

  const first = await req('GET', '/api/intake');
  assert.equal(first.status, 200);
  assert.equal(first.body.firstRun, true);
  assert.equal(first.body.step, 0);
  assert.equal(first.body.questions.length, QUESTIONS.length, 'the screen renders the API\'s questions');
  assert.equal(first.body.questions[0].example, QUESTIONS[0].example);

  for (const q of QUESTIONS) {
    const r = await req('POST', '/api/intake/answer', { key: q.key, value: ANSWERS[q.key], actor: 'crystal' });
    assert.equal(r.status, 200, q.key + ' was accepted');
  }
  const ready = await req('GET', '/api/intake');
  assert.equal(ready.body.complete, true);
  assert.equal(ready.body.plan.schema.id, 'guest');

  const bad = await req('POST', '/api/intake/answer', { key: 'nope', value: 'x' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.includes('nope'));

  const built = await req('POST', '/api/intake/build', { actor: 'crystal' });
  assert.equal(built.status, 200);
  assert.equal(built.body.schema.id, 'guest');
  assert.ok(built.body.card.why, 'the card carries a reason the human decides on');
  assert.equal(built.body.view.type, 'board', 'the view type was inferred, never asked');

  // and the app must not offer the interview again
  const after = await req('GET', '/api/intake');
  assert.equal(after.body.firstRun, false);
  assert.ok(after.body.built, 'the file records when it was built');
});

test('build refuses while a required answer is still missing', async () => {
  freshRoot();
  await req('POST', '/api/intake/answer', { key: 'name', value: 'Crystal' });
  const r = await req('POST', '/api/intake/build', {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /I still need one answer/);
});

test.after(() => cancelCacheRegen());

// ── 5 · the first goal ─────────────────────────────────────────────────────────────────────────
//
// "What are you chasing right now, and by when?" only ever became a paragraph in me.md until
// 2026-09-06, so the hot cache's `## GOALS` section was empty in every workspace this interview
// has built — and nothing in the app could create a goal at all.

test('a date is read off her own sentence, conservatively, and never lands in the past', () => {
  const now = Date.UTC(2026, 8, 6); // 2026-09-06

  assert.equal(deadlineFrom('Six guests with a hazing story, by the end of August', now).deadline, '2027-08-31',
    'the END of August, and the NEXT one — a goal that is already overdue on the day it is set is worse than no date');
  assert.equal(deadlineFrom('Six placements filled before the end of October.', now).deadline, '2026-10-31');
  assert.equal(deadlineFrom('Book six by 2026-11-30', now).deadline, '2026-11-30', 'an ISO date, as an agent would send it');
  assert.equal(deadlineFrom('Ten signed by 30 September', now).deadline, '2026-09-30');
  assert.equal(deadlineFrom('Ten signed by September 30', now).deadline, '2026-09-30');
  assert.equal(deadlineFrom('Get to twelve by the end of the year', now).deadline, '2026-12-31');

  // Not sure is not a date. Inventing one would put a deadline on her screen she never said.
  assert.equal(deadlineFrom('More guests, soon', now).deadline, null);
  assert.equal(deadlineFrom('', now).deadline, null);
});

test('the number is read from what is left once the date is out of the sentence', () => {
  assert.equal(targetFrom('Six guests with a hazing story'), 6, 'people write this answer in words');
  assert.equal(targetFrom('Book 6 hazing stories'), 6);
  assert.equal(targetFrom('More guests than last month'), null, 'no number is no number');
  // the trap this exists for: the 2026 of a date must never become the target
  const { deadline, match } = deadlineFrom('Six guests by 2026-08-31');
  assert.equal(deadline, '2026-08-31');
  assert.equal(targetFrom('Six guests by 2026-08-31'.replace(match, ' ')), 6);
});

test('the goal counts itself from the records, through the new collection\'s own gate', () => {
  freshRoot();
  answerAll();
  const plan = proposeWorkspace(ANSWERS);
  const { id, patch } = goalFrom(ANSWERS.chasing, plan.schema);

  assert.equal(patch.label, 'Six guests with a hazing story, by the end of August');
  assert.equal(patch.target, 6);
  assert.match(String(patch.deadline), /^\d{4}-08-31$/);
  // the rollup: the gate field's `done` group, so renaming `won` to `signed` moves progress with
  // no code change — and `archived` is never progress (Law 5 keeps a reject, it does not count it).
  assert.deepEqual(patch.count, { path: 'data/guest/**', where: { status: 'won' } });
  assert.ok(id.length && id.length <= 60);
});

test('a chasing answer with no number and no date still becomes a goal', () => {
  const g = goalFrom('More people who actually reply');
  assert.equal(g.patch.label, 'More people who actually reply');
  assert.equal(g.patch.target, undefined);
  assert.equal(g.patch.deadline, undefined);
  assert.equal(goalFrom('   '), null, 'and a blank answer is no goal, not an empty one');
});

test('DEMONSTRATE · after the interview builds, there is a goal and the cache has a GOALS section', () => {
  freshRoot();
  cancelCacheRegen();
  answerAll();
  const built = buildWorkspace({ actor: 'crystal' });

  const goals = listGoals();
  assert.equal(goals.length, 1, 'the interview leaves exactly one goal, from her own sentence');
  assert.equal(goals[0].id, built.goal.id);
  assert.equal(goals[0].target, 6);
  assert.equal(goals[0].current, 0, 'counted from her records — there are none yet');
  assert.equal(goals[0].computed, true, 'and it is a ROLLUP, not a number anybody typed');
  assert.equal(goals[0].data.created_by, 'crystal', 'human-owned, like me.md');

  const { text } = renderCache({});
  assert.match(text, /## GOALS\n- Six guests with a hazing story/,
    'and the agent reads it on wake — the whole reason a goal exists');
  cancelCacheRegen();
});
