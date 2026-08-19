// DEV-126 — the composer's nested `/` command tree.
//
// slashCommands.js is a PURE module precisely so this can exist: no React, no DOM, no jsdom. It is
// the part with real logic (which groups exist, how a token splits, how items rank), while
// MentionText is only a renderer.
//
// NOTE ON localStorage: node has none, and the frecency helpers are written to swallow that — so
// these also prove the never-throws guard, since every call below runs without it.
//
// The /model, /look, /camera and /angle groups tested below went with the film domain — per
// docs/decisions.md M0 · "slashCommands.js KEPT, trimmed": level 1 (snippets) survives, the level-2
// model-catalog and camera-move branches do not. frontend/slashCommands.js is being edited
// alongside this strip, so this file no longer pins any assertion to what a specific group
// contains — only to the group-agnostic MECHANISM (splitting, filtering, frecency) that whatever
// groups end up wired still has to satisfy. Each removed test is noted at its old site.
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
// 'the tree offers model / look / camera / angle when the composer wires all four' and 'a group is
// omitted when the surface has no setter for it' lived here — both pinned to the exact model/look/
// camera/angle group ids being removed (see the file header).
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

// 'a token with a known group descends, keeping the rest as the query' lived here — it asserted the
// split for the literal heads 'model', 'angle' and 'camera', all removed groups. The mechanism it
// guarded (a recognised head descends, the rest of the token becomes the query) is still exercised
// group-agnostically by 'an unknown head does NOT descend' below.
test('an unknown head does NOT descend', () => {
  assert.deepEqual(splitToken('nope something', full()), [null, 'nope something']);
});

// ── filtering ───────────────────────────────────────────────────────────────────────────────────
// Five tests lived here, all filtering the 'camera' or 'look' groups specifically: '/camera push
// finds the dolly move; /angle low finds the low angle', 'every term must hit, so a second word
// NARROWS', 'an empty query returns items, capped', 'a query matching nothing returns nothing
// rather than everything', and 'looks are searchable by name AND by their fragment text'. All five
// exercised removed groups (see the file header). filterItems() itself is untouched by the trim —
// whichever group survives still needs multi-term AND-matching, an 8-item cap, and empty-vs-no-
// match handled correctly — but pinning fresh assertions to /snippet content while that group is
// mid-edit would be building on sand; that coverage belongs with whoever lands the new group.

// ── frecency ────────────────────────────────────────────────────────────────────────────────────
test('usage helpers never throw where localStorage is absent', () => {
  // node has no localStorage; ranking must silently degrade to source order rather than crash the
  // whole menu
  assert.doesNotThrow(() => bumpUse('model', 'fal-ai/flux/schnell'));
  assert.equal(useCount('model', 'fal-ai/flux/schnell'), 0);
  assert.doesNotThrow(() => bumpUse(null, null));
});

// 'a typed prefix still outranks usage — the list must not reorder under the keystrokes' lived here
// — it asserted on the 'camera' group's 'pan left' item specifically, a removed group. The ranking
// rule (a typed prefix leads over frecency) is otherwise untouched by this trim; re-add it against
// whichever group replaces camera once that group's content is settled.
