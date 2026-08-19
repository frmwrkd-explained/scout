// Phase 9 — structured search: typed filters + free text, exact location objects, secret exclusion.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedItem, seedShot, seedGen, req, paths, getStorageRoot, fs, path } from './helpers.mjs';
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

test('project + type + rating filters combine and free text matches', async () => {
  seedSearchRoot();
  const r = await req('GET', '/api/search?q=' + encodeURIComponent('p:neon rating:>=4 amber'));
  assert.equal(r.status, 200);
  const ids = r.body.results.map(x => x.id);
  assert.ok(ids.includes('g2'), 'expected g2 (rating 5, "amber") — got ' + JSON.stringify(ids));
  assert.ok(!ids.includes('g1'), 'g1 (rating 2) should be filtered out');
});

test('has:failure surfaces failed generations; final:true finds the selected candidate', async () => {
  seedSearchRoot();
  const fail = await req('GET', '/api/search?q=' + encodeURIComponent('has:failure'));
  assert.ok(fail.body.results.some(x => x.id === 'g3'), 'failed generation not found via has:failure');
  const fin = await req('GET', '/api/search?q=' + encodeURIComponent('final:true'));
  assert.ok(fin.body.results.some(x => x.id === 'g2'), 'final candidate not found via final:true');
});

test('results carry exact location objects for navigation', async () => {
  seedSearchRoot();
  const r = await req('GET', '/api/search?q=' + encodeURIComponent('SH030'));
  const shot = r.body.results.find(x => x.type === 'shot');
  assert.ok(shot, 'shot result missing');
  assert.equal(shot.location.page, 'project');
  assert.equal(shot.location.projectId, 'neon');
  assert.equal(shot.location.entity.type, 'shot');
  assert.equal(shot.location.entity.id, 'SH030');
});

test('secret settings are never returned by search', async () => {
  seedSearchRoot();
  // put a secret in settings.md
  await req('PUT', '/api/settings', { falApiKey: 'sk-SUPERSECRET-42', kieApiKey: 'kie-TOPSECRET' });
  const r = await req('GET', '/api/search?q=' + encodeURIComponent('SUPERSECRET'));
  assert.equal(r.body.total, 0, 'search leaked a secret from settings');
  const blob = JSON.stringify(r.body);
  assert.ok(!/SUPERSECRET|TOPSECRET/.test(blob), 'secret string present in search response');
});

test('shot:SH030 filter scopes to that shot; tag: filter matches shot tags', async () => {
  seedSearchRoot();
  const r = await req('GET', '/api/search?q=' + encodeURIComponent('shot:SH030'));
  assert.ok(r.body.results.every(x => !x.fields || x.fields.shot === 'SH030' || x.type !== 'generation'));
  const tag = await req('GET', '/api/search?q=' + encodeURIComponent('tag:drone'));
  assert.ok(tag.body.results.some(x => x.type === 'shot' && x.id === 'SH030'));
});
