// The conductor's chat — a light-tier turn that can act through a validated action block.
// runTurn is awaited directly: the route fire-and-forgets it, so the test owns the timing.
import './_env.mjs'; // first
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshRoot, writeMd, getStorageRoot } from './helpers.mjs';
import { localDay, addDays } from '../backend/daytime.mjs';
import { getSession, runTurn } from '../backend/chat.mjs';
import { ensureWorkCollections, ensureTodaySession, todaySessionId, workItems, normDay } from '../backend/today.mjs';
import { parseJsonBlock } from '../backend/brain.mjs';

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-brain.mjs');
const DAY = () => localDay(Date.now());

function seedWork(id, data = {}) {
  writeMd(path.join(getStorageRoot(), 'data/work', id + '.md'), {
    tags: ['work'], title: data.title || id, bucket: 'seo', status: 'planned',
    estimate_min: 30, ...data,
  }, '');
}

const withBrain = async (reply, fn) => {
  process.env.SCOUT_BRAIN_COMMAND = STUB;
  process.env.SCOUT_BRAIN_REPLY = reply;
  try { return await fn(); }
  finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY; }
};

test('parseJsonBlock takes a fenced block, then a bare object, and refuses prose', () => {
  assert.deepEqual(parseJsonBlock('Sure.\n```json\n{"a":1}\n```\nDone.'), { a: 1 });
  assert.deepEqual(parseJsonBlock('prefix {"b":2} suffix'), { b: 2 });
  assert.equal(parseJsonBlock('no json here, just words'), null);
  assert.equal(parseJsonBlock('```json\n{bad}\n```'), null);
});

test('a chat reply applies a valid action block and strips the JSON from the shown text', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork(DAY() + '-big', { title: 'Big scary task', day: DAY(), order: 1 });
  await withBrain(
    'Splitting it for you.\n```json\n{"actions":[{"type":"split_item","id":"' + DAY() + '-big","into":[{"title":"Part one","bucket":"seo","estimate_min":15},{"title":"Part two","bucket":"seo","estimate_min":15}]}]}\n```',
    async () => {
      const s = ensureTodaySession(DAY());
      await runTurn(s.id, 'split this into smaller steps');
      const after = getSession(s.id);
      const reply = after.messages[after.messages.length - 1];
      assert.equal(reply.role, 'assistant');
      assert.ok(!reply.text.includes('```'), 'the JSON block is stripped — got: ' + reply.text);
      assert.ok(!reply.text.includes('"actions"'), 'the actions object is stripped');
      assert.match(reply.text, /Split Big scary task into 2/, 'the receipt line is there');
      const parts = workItems().filter(i => normDay(i.day) === DAY()).map(i => i.title);
      assert.ok(parts.includes('Part one') && parts.includes('Part two'), 'the two parts exist');
    });
});

test('invalid actions drop out and the reply says so', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork(DAY() + '-a', { title: 'Alpha', day: DAY(), order: 1 });
  await withBrain(
    'On it.\n```json\n{"actions":[{"type":"park_item","id":"ghost-id"},{"type":"nuke_everything"},{"type":"update_item","id":"' + DAY() + '-a","fields":{"bucket":"not-a-bucket"}}]}\n```',
    async () => {
      const s = ensureTodaySession(DAY());
      await runTurn(s.id, 'do those things');
      const reply = getSession(s.id).messages.at(-1);
      assert.match(reply.text, /Couldn.t apply/);
      assert.match(reply.text, /ghost-id|unknown item/);
      // the good request got wrecked alongside? no — nothing applied at all here.
      assert.equal(workItems().find(i => i.title === 'Alpha').status, 'planned');
    });
});

test('missing ids, off-day ids and invalid updates are refused while later valid actions still apply', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { title: 'Alpha', day: DAY(), order: 1 });
  seedWork('later', { title: 'Later', day: addDays(DAY(), 1) });
  await withBrain(JSON.stringify({ actions: [
    { type: 'park_item' },
    { type: 'update_item', id: 'later', fields: { title: 'Wrong day' } },
    { type: 'update_item', id: 'a', fields: { estimate_min: -5 } },
    { type: 'update_item', id: 'a', fields: { order: 0 } },
    { type: 'update_item', id: 'a', fields: { title: '' } },
    { type: 'update_item', id: 'a', fields: { why: 'Still moving' } },
  ] }), async () => {
    const s = ensureTodaySession(DAY());
    await runTurn(s.id, 'make those changes');
    assert.match(getSession(s.id).messages.at(-1).text, /Couldn.t apply/);
    const alpha = workItems().find(i => i.id === 'a');
    assert.equal(alpha.title, 'Alpha');
    assert.equal(alpha.estimate_min, 30);
    assert.equal(alpha.order, 1);
    assert.equal(alpha.why, 'Still moving');
    assert.equal(workItems().find(i => i.id === 'later').title, 'Later');
  });
});

test('a split with an invalid later part writes none of its parts', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { title: 'Alpha', day: DAY(), order: 1 });
  await withBrain(JSON.stringify({ actions: [{ type: 'split_item', id: 'a', into: [
    { title: 'Good part', bucket: 'seo', estimate_min: 15 },
    { title: 'Bad part', bucket: 'seo', estimate_min: 9999 },
  ] }] }), async () => {
    const s = ensureTodaySession(DAY());
    await runTurn(s.id, 'split this');
    assert.equal(workItems().length, 1);
    assert.equal(workItems()[0].status, 'planned');
    assert.match(getSession(s.id).messages.at(-1).text, /Couldn.t apply/);
  });
});

test('with no brain the conductor answers honestly instead of faking a reply', async () => {
  freshRoot(); ensureWorkCollections();
  delete process.env.SCOUT_BRAIN_COMMAND;
  seedWork(DAY() + '-a', { title: 'Alpha', day: DAY(), order: 1 });
  const s = ensureTodaySession(DAY());
  await runTurn(s.id, 'what should I do next?');
  const reply = getSession(s.id).messages.at(-1);
  assert.match(reply.text, /No light agent connected/);
  assert.match(reply.text, /track and plan/);
});

test('a normal reply without an action block lands as-is', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork(DAY() + '-a', { title: 'Alpha', day: DAY(), order: 1 });
  await withBrain('Keep going on Alpha — you are 12 minutes in.', async () => {
    const s = ensureTodaySession(DAY());
    await runTurn(s.id, 'how am I doing?');
    const reply = getSession(s.id).messages.at(-1);
    assert.equal(reply.text, 'Keep going on Alpha — you are 12 minutes in.');
  });
});

test('the today session is created standalone, kind today, executor today', () => {
  freshRoot(); ensureWorkCollections();
  const s = ensureTodaySession(DAY());
  assert.equal(s.id, todaySessionId(DAY()));
  assert.equal(s.scope, 'standalone');
  assert.equal(s.kind, 'today');
  assert.equal(s.executor, 'today');
  const again = ensureTodaySession(DAY());
  assert.equal(again.id, s.id, 'one session per day');
});
