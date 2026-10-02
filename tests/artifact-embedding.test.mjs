import { tempRoots } from './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import express from 'express';
import { setStorageRoot } from '../backend/store.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { upsertRecord, patchRecord, readRecord, registerRecordRoutes } from '../backend/records.mjs';

// Exercise this leaf and canonical record routes independently of the worker scheduler.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'node_modules/.cache/scout-jsx/artifact-embedding.mjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
await build({ entryPoints: [path.join(repo, 'frontend/Artifact.jsx')], outfile: out, bundle: true, format: 'esm',
  platform: 'neutral', jsx: 'automatic', logLevel: 'silent', external: ['react', 'react-dom', 'react/jsx-runtime', '@tiptap/*'] });
const { default: Artifact, localArtifactPath, messageArtifacts, artifactMessageText, workArtifacts, saveArtifactBody } = await import(out);

test('chat artifact references resolve only canonical local Markdown documents', () => {
  for (const path of ['/tmp/private.md', '.scout/paperclip.md', 'data/a/../private.md', 'data/a/%2e%2e/private.md',
    'https://example.test/data/artifacts/draft.md', 'data/a/file.md?token=x', 'data\\a\\file.md', 'projects/demo/config.md']) {
    assert.equal(localArtifactPath(path), null, path);
  }
  assert.equal(localArtifactPath('data/artifacts/draft.md'), 'data/artifacts/draft.md');
  assert.equal(localArtifactPath('data/notes/Useful draft.md'), 'data/notes/Useful draft.md');
  assert.equal(localArtifactPath('goals/growth.md'), 'goals/growth.md');
  assert.equal(localArtifactPath('projects/campaign/tasks/buyer-brief.md'), 'projects/campaign/tasks/buyer-brief.md');
});

test('structured and legacy chat references become named cards without exposing paths in prose', () => {
  const message = { text: 'Prepared [[data/artifacts/buyer.md|Buyer brief]] and `data/delivery/message.md`.',
    meta: { artifacts: [{ path: 'data/artifacts/buyer.md', title: 'Buyer brief', assistant: 'researcher' }] } };
  const refs = messageArtifacts(message);
  assert.equal(refs.length, 2); assert.equal(refs[0].assistant, 'researcher');
  const text = artifactMessageText(message, refs);
  assert.equal(text, 'Prepared Buyer brief and Delivery draft.');
  assert.equal(messageArtifacts({ text: 'https://example.test/data/artifacts/buyer.md' }).length, 0);
  const mixed = { text: 'See data/artifacts/buyer.md and https://example.test/data/artifacts/buyer.md' };
  assert.match(artifactMessageText(mixed), /https:\/\/example.test\/data\/artifacts\/buyer.md$/);
});

test('work packets collect canonical supporting documents and omit the work note itself', () => {
  const refs = workArtifacts({ path: 'data/work/review.md', artifact_path: 'data/artifacts/buyer.md',
    supporting_materials: [{ path: 'data/artifacts/buyer.md', title: 'Buyer brief', worker: 'researcher' }] },
    { data: { output_path: 'data/delivery/message.md' }, content: 'Review [[data/work/review.md]] using [[goals/growth.md]].' });
  assert.deepEqual(refs.map(ref => ref.path), ['data/artifacts/buyer.md', 'data/delivery/message.md', 'goals/growth.md']);
  assert.equal(refs[0].title, 'Buyer brief'); assert.equal(refs[0].assistant, 'researcher');
});

test('inline cards show title, type and author while keeping the raw file behind details', () => {
  const html = renderToStaticMarkup(React.createElement(Artifact, { artifact: { path: 'data/artifacts/buyer.md', assistant: 'researcher' },
    seed: { data: { title: 'Buyer brief', proposed: true }, content: 'A useful draft about buyer needs.', rev: 'current' } }));
  assert.match(html, /Buyer brief/); assert.match(html, /Prepared material/); assert.match(html, /researcher/);
  assert.match(html, /needs review/); assert.match(html, /Preview/);
  assert.equal((html.match(/data\/artifacts\/buyer.md/g) || []).length, 1, 'only the nonvisual card identifier carries the path');
});

test('a refreshed typed packet does not reattach an older check from the preserved work note', () => {
  const refs = workArtifacts({ path: 'data/work/review.md', artifacts: [
    { path: 'data/artifacts/new-guide.md', title: 'Corrected guide', assistant: 'writer' },
    { path: 'data/artifacts/new-check.md', title: 'Current check', assistant: 'reviewer' },
    { path: 'data/artifacts/my-note.md', title: 'My attached note' },
  ] }, { data: { artifacts: [{ path: 'data/artifacts/old-check.md' }] },
    content: 'Original note: [[data/artifacts/old-check.md]].' });
  assert.deepEqual(refs.map(ref => ref.path), ['data/artifacts/new-guide.md', 'data/artifacts/new-check.md', 'data/artifacts/my-note.md']);
  assert.equal(refs[0].assistant, 'writer');
});

test('inline body saves use canonical revision checks and preserve concurrent metadata', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-artifact-')); tempRoots.push(root); setStorageRoot(root);
  saveCollection({ id: 'artifact', label: 'Artifacts', query: { tag: 'artifact', path: 'data/artifacts/**' }, fields: [
    { key: 'title', type: 'text', required: true, primary: true }, { key: 'worker', type: 'text' },
  ] });
  const result = upsertRecord({ collection: 'artifact', id: 'buyer', title: 'Buyer brief', worker: 'researcher', body: 'Original draft.' }, { actor: 'crystal' });
  const original = readRecord(result.path);
  patchRecord(result.path, { body: 'Worker wrote a newer draft.', source: 'Fresh evidence' }, { actor: 'researcher' });
  const app = express(); app.use(express.json()); registerRecordRoutes(app);
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port, nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => nativeFetch(String(url).startsWith('/') ? base + url : url, options);
  t.after(() => { globalThis.fetch = nativeFetch; });
  await assert.rejects(saveArtifactBody(result.path, 'My unsaved edit.', original.rev), error => error.status === 409);
  const latest = readRecord(result.path);
  assert.equal(latest.content.trim(), 'Worker wrote a newer draft.');
  const saved = await saveArtifactBody(result.path, 'Reviewed human edit.', latest.rev);
  assert.equal(saved.content.trim(), 'Reviewed human edit.');
  assert.equal(saved.data.worker, 'researcher'); assert.equal(saved.data.source, 'Fresh evidence');
  await assert.rejects(saveArtifactBody(result.path, 'Unsafe write without revision.', null), /Reload/);
});
