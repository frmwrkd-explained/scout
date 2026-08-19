// DEV-126 — the composer's nested `/` command tree.
//
// slashCommands.js is a PURE module precisely so this can exist: no React, no DOM, no jsdom. It is
// the part with real logic (which groups exist, how a token splits, how items rank), while
// MentionText is only a renderer.
//
// NOTE ON localStorage: node has none, and the frecency helpers are written to swallow that — so
// these also prove the never-throws guard, since every call below runs without it.
import './_env.mjs'; // first — sets storage-root env before the store loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandGroups, splitToken, filterItems, bumpUse, useCount } from '../frontend/slashCommands.js';

const LOOKS = [
  { id: 'l1', name: 'Harbor Night', fragment: 'sodium vapour, wet asphalt' },
  { id: 'l2', name: 'Blue Hour', fragment: 'cold ambient' }
];
const full = () => commandGroups({
  settings: {}, looks: LOOKS,
  fp: { onLook() { }, onMove() { }, onAngle() { } },
  onModel() { }
});

// ── which groups exist ──────────────────────────────────────────────────────────────────────────
test('the tree offers model / look / camera / angle when the composer wires all four', () => {
  assert.deepEqual(full().map(g => g.id), ['model', 'look', 'camera', 'angle']);
});

test('a group is omitted when the surface has no setter for it', () => {
  // a composer with no camera state must not advertise /camera — the menu never offers something
  // it cannot actually do
  const g = commandGroups({ settings: {}, looks: LOOKS, fp: { onLook() { } }, onModel() { } });
  assert.deepEqual(g.map(x => x.id), ['model', 'look']);
  assert.deepEqual(commandGroups({}).map(x => x.id), [], 'no setters at all → no commands');
});

test('every group carries items and an apply', () => {
  for (const g of full()) {
    assert.ok(g.items.length > 0, g.id + ' has items');
    assert.equal(typeof g.apply, 'function', g.id + ' has apply');
    assert.ok(g.label.startsWith('/'), g.id + ' label is typed as a command');
    assert.ok(g.hint, g.id + ' explains itself');
  }
});

// ── token splitting ─────────────────────────────────────────────────────────────────────────────
test('a token with no space stays at the TOP level', () => {
  // "/mo" must narrow the group ROWS, not jump into /model before the user asked
  assert.deepEqual(splitToken('mo', full()), [null, 'mo']);
  assert.deepEqual(splitToken('', full()), [null, '']);
});

test('a token with a known group descends, keeping the rest as the query', () => {
  assert.deepEqual(splitToken('model nano banana', full()), ['model', 'nano banana']);
  assert.deepEqual(splitToken('angle low', full()), ['angle', 'low']);
  assert.deepEqual(splitToken('camera ', full()), ['camera', '']);
});

test('an unknown head does NOT descend', () => {
  assert.deepEqual(splitToken('nope something', full()), [null, 'nope something']);
});

// ── filtering ───────────────────────────────────────────────────────────────────────────────────
test('/camera push finds the dolly move; /angle low finds the low angle', () => {
  const g = full();
  const cam = g.find(x => x.id === 'camera');
  const hits = filterItems(cam.items, 'push', 'camera').map(i => i.label);
  assert.ok(hits.some(l => /push/i.test(l)), 'got ' + hits.join('|'));

  const ang = g.find(x => x.id === 'angle');
  assert.deepEqual(filterItems(ang.items, 'low', 'angle').map(i => i.label), ['Low-angle power']);
});

test('every term must hit, so a second word NARROWS', () => {
  const cam = full().find(x => x.id === 'camera');
  const one = filterItems(cam.items, 'pan', 'camera');
  const two = filterItems(cam.items, 'pan left', 'camera');
  assert.ok(two.length <= one.length && two.length >= 1);
  assert.ok(two.every(i => /pan/i.test(i.label + i.sub) && /left/i.test(i.label + i.sub)));
});

test('an empty query returns items, capped', () => {
  const cam = full().find(x => x.id === 'camera');
  const all = filterItems(cam.items, '', 'camera');
  assert.ok(all.length > 0 && all.length <= 8, 'capped at 8, got ' + all.length);
});

test('a query matching nothing returns nothing rather than everything', () => {
  const cam = full().find(x => x.id === 'camera');
  assert.deepEqual(filterItems(cam.items, 'zzzzz-not-a-move', 'camera'), []);
});

test('looks are searchable by name AND by their fragment text', () => {
  const look = full().find(x => x.id === 'look');
  assert.deepEqual(filterItems(look.items, 'harbor', 'look').map(i => i.id), ['l1']);
  assert.deepEqual(filterItems(look.items, 'sodium', 'look').map(i => i.id), ['l1']);
});

// ── frecency ────────────────────────────────────────────────────────────────────────────────────
test('usage helpers never throw where localStorage is absent', () => {
  // node has no localStorage; ranking must silently degrade to source order rather than crash the
  // whole menu
  assert.doesNotThrow(() => bumpUse('model', 'fal-ai/flux/schnell'));
  assert.equal(useCount('model', 'fal-ai/flux/schnell'), 0);
  assert.doesNotThrow(() => bumpUse(null, null));
});

test('a typed prefix still outranks usage — the list must not reorder under the keystrokes', () => {
  const cam = full().find(x => x.id === 'camera');
  const hits = filterItems(cam.items, 'pan l', 'camera');
  assert.ok(/pan left/i.test(hits[0].label), 'prefix match leads, got ' + hits[0].label);
});
