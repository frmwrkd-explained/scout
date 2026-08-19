// Phase 9 — structured search: typed filters + free text, exact location objects, secret exclusion.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedItem, seedShot, seedGen, req } from './helpers.mjs';
import { parseQuery } from '../backend/search.mjs';

test('parseQuery splits typed filters, aliases, has:, and free text', () => {
  const { filters, terms } = parseQuery('p:neon t:clip rating:>=4 has:note amber drift');
  assert.equal(filters.project, 'neon');   // p: alias
  assert.equal(filters.type, 'clip');       // t: alias
  assert.equal(filters.rating, '>=4');
  assert.deepEqual(filters.has, ['note']);
  assert.deepEqual(terms, ['amber', 'drift']);
});

function seedSearchRoot() {
  freshRoot();
  seedProject('neon', { name: 'Neon Alley', sub: 'spec spot' });
  seedProject('amber', { name: 'Amber Fields' });
  seedShot('neon', 'SH030', { no: 3, title: 'Broken drone', status: 'done', tags: ['drone', 'rain'], selectedCandidate: 'g2' });
  seedGen('neon', 'g1', { shot: 'SH030', model: 'fal-ai/flux', reviewState: 'new', rating: 2, status: 'done', prompt: 'neon drone in rain' });
  seedGen('neon', 'g2', { shot: 'SH030', model: 'fal-ai/flux', reviewState: 'kept', rating: 5, final: true, status: 'done', prompt: 'amber sunset drone' });
  seedGen('neon', 'g3', { shot: 'SH030', model: 'kling', status: 'failed', reviewState: 'pending', error: 'timeout', prompt: 'x' });
  seedItem('neon', 'legacy1', { st: 'new', type: 'clip', name: 'old clip', note: 'camera drift' });
}

/* Three tests lived here, all walking the search results for 'shot' and 'generation' rows: filter
 * combination (project + rating + free text), has:failure / final:true, and exact location objects
 * for a shot. backend/search.mjs's rows() was rewritten with the film domain on 2026-08-19 and now
 * builds only project / item / asset rows — there is no 'shot' or 'generation' row type left to
 * search, so every one of these threw or asserted on results that can never come back.
 *
 * The rule each guarded still holds — matchFilters() and rows() are the same subject-agnostic code
 * for whichever row types exist, and 'secret settings are never returned by search' below still
 * exercises that engine end-to-end (a real request through matchFilters + the free-text scan). What
 * is not re-proven here is filter-combination / has: / tag: / exact-location specifically for the
 * new project/item/asset rows — that would be new coverage for the current search surface, not a
 * like-for-like port of a dead one, so it is left for whoever next touches search.mjs rather than
 * invented against a shot/generation fixture that no longer means anything.
 */
test('secret settings are never returned by search', async () => {
  seedSearchRoot();
  // put a secret in settings.md
  await req('PUT', '/api/settings', { falApiKey: 'sk-SUPERSECRET-42', kieApiKey: 'kie-TOPSECRET' });
  const r = await req('GET', '/api/search?q=' + encodeURIComponent('SUPERSECRET'));
  assert.equal(r.body.total, 0, 'search leaked a secret from settings');
  const blob = JSON.stringify(r.body);
  assert.ok(!/SUPERSECRET|TOPSECRET/.test(blob), 'secret string present in search response');
});

// 'shot:SH030 filter scopes to that shot; tag: filter matches shot tags' lived here — same removal
// as the block above (no 'shot' row type left). Note its first assertion (`!x.fields || ...`) was
// already vacuous before the strip: search() strips `fields` off every result before it reaches
// JSON (see the `.map(({ haystack, fields, score, ...r }) => r)` in search()), so `x.fields` was
// always undefined and `!x.fields` always true — it never actually checked the shot: filter.
