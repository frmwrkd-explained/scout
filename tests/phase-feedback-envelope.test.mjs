// The egress path: what actually leaves the machine when someone files a bug report.
//
// tests/phase-feedback-redaction.test.mjs pins the redactor in isolation. This file pins the
// thing that matters operationally — that the redactor is actually WIRED IN, on every field, in
// the right order, and that the payload the review step shows is the payload that gets sent.
// A perfect redactor that the envelope builder forgets to call is worth nothing.
//
// No SCOUT_FEEDBACK_URL is set under test, so nothing is ever transmitted: every report lands in
// the outbox, which is also the failure mode we want to prove works.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot, req } from './helpers.mjs';
import { getStorageRoot, saveSettings } from '../backend/store.mjs';
import { buildEnvelope } from '../backend/feedback.mjs';

const outbox = () => path.join(getStorageRoot(), 'feedback', 'outbox');
const readOutbox = code => fs.readFileSync(path.join(outbox(), code + '.md'), 'utf8');

// A report carrying every shape we care about, in the places they really turn up.
const loaded = extra => ({
  title: 'Reroll does nothing',
  body: 'pressed reroll, nothing happened',
  kind: 'bug', severity: 'blocks-me',
  client: {
    errors: [{ kind: 'uncaught', t: 10, message: 'undefined is not an object', stack: 'at reroll (/Users/ada/Scout/frontend/ShotWorkspace.jsx:212:14)' }],
    console: [{ level: 'error', t: 9, msg: 'POST /api/generate 401 Authorization: Bearer gsk_LiveKeyAbCdEfGhIjKlMnOp1234' }],
    network: [{ t: 8, method: 'GET', url: 'https://fal.media/files/x/out.png?X-Amz-Signature=deadbeef', status: 403, ms: 12 }],
    interactions: [{ t: 7, kind: 'click', what: 'reroll' }],
    totals: { console: 40, errors: 1, network: 9, interactions: 22 }
  },
  ...extra
});

test('the settings key is stripped everywhere, including where no pattern would find it', async () => {
  freshRoot();
  // A key whose shape matches none of the rules — the case exact-secret exists for.
  saveSettings({ falApiKey: 'totally-unguessable-shape-9182-abc' });

  const env = buildEnvelope(loaded({
    body: 'my key totally-unguessable-shape-9182-abc stopped working',
    where: { note: 'totally-unguessable-shape-9182-abc' }
  }));

  const flat = JSON.stringify(env);
  assert.ok(!flat.includes('totally-unguessable-shape-9182-abc'), 'the configured key leaked into the envelope');
  assert.ok(flat.includes('<redacted:key>'));
});

test('the envelope carries no key, no signed URL and no home path', () => {
  freshRoot();
  const flat = JSON.stringify(buildEnvelope(loaded()));
  assert.ok(!flat.includes('gsk_LiveKey'), 'a key-shaped token survived');
  assert.ok(!flat.includes('X-Amz-Signature'), 'a signed URL survived');
  assert.ok(!flat.includes('/Users/ada'), "the reporter's home path survived");
  // …while the parts that make the report useful are intact.
  assert.ok(flat.includes('ShotWorkspace.jsx'), 'lost the failing file — that was the evidence');
  assert.ok(flat.includes('fal.media/files/x/out.png'), 'lost the failing URL path');
});

test('provider state is booleans, never values', () => {
  freshRoot();
  saveSettings({ groqApiKey: 'gsk_ShouldNeverAppearAnywhere012345' });
  const env = buildEnvelope(loaded());
  for (const v of Object.values(env.app.providers)) assert.equal(typeof v, 'boolean');
  assert.ok(!JSON.stringify(env.app).includes('ShouldNeverAppear'));
});

test("the reporter's own email survives; a third party's does not", () => {
  freshRoot();
  const env = buildEnvelope(loaded({ email: '  Ada@Example.COM ', body: 'cc bob@other.com please' }));
  // It is the reply path — redacting it would silently delete the only way to answer them.
  assert.equal(env.reporter.email, 'ada@example.com');
  assert.ok(!JSON.stringify(env).includes('bob@other.com'), "a third party's address leaked");
});

test('an unticked section is absent, not empty', () => {
  freshRoot();
  const env = buildEnvelope(loaded({ include: { console: false, serverLog: false } }));
  // An empty array reads as "we looked and found nothing", which is a different and misleading
  // fact from "the reporter chose not to send this".
  assert.equal('console' in env.client, false);
  assert.ok('errors' in env.client, 'dropped a section the user kept');
  assert.equal('log' in (env.server || {}), false);
});

test('the redaction count is reported, so the panel can prove the redactor ran', () => {
  freshRoot();
  const env = buildEnvelope(loaded());
  const total = Object.values(env.redaction.hits).reduce((a, b) => a + b, 0);
  assert.ok(total >= 3, 'expected at least a key, a signed URL and a home path: ' + JSON.stringify(env.redaction.hits));
});

test('two machines hitting the same bug produce the same signature', () => {
  freshRoot();
  const a = buildEnvelope(loaded());
  const b = buildEnvelope(loaded({
    client: {
      ...loaded().client,
      errors: [{ kind: 'uncaught', t: 99, message: 'undefined is not an object', stack: 'at reroll (/Users/bob/dev/frontend/ShotWorkspace.jsx:219:9)' }]
    }
  }));
  assert.equal(a.signature, b.signature, 'the same bug on two machines would open two issues');
});

// ── over HTTP ───────────────────────────────────────────────────────────────────────────────

test('the preview route returns exactly what the send would build', async () => {
  freshRoot();
  const payload = loaded({ email: 'ada@example.com' });
  const preview = await req('POST', '/api/feedback/preview', payload);
  assert.equal(preview.status, 200);

  const sent = await req('POST', '/api/feedback', payload);
  assert.equal(sent.status, 200);
  const stored = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(readOutbox(sent.body.code))[1]);

  // Compare everything that is not inherently per-call. If these two ever diverge, the review
  // step is showing the user something we do not send, and its promise is broken.
  const strip = e => { const c = { ...e }; delete c.code; delete c.sentAt; delete c.reporter; delete c.app; delete c.server; return c; };
  assert.deepEqual(strip(stored), strip(preview.body));
  assert.equal(stored.signature, preview.body.signature);
});

test('a report with no network is queued to the outbox, and says so', async () => {
  freshRoot();
  const r = await req('POST', '/api/feedback', loaded());
  assert.equal(r.status, 200);
  assert.equal(r.body.queued, true);
  assert.match(r.body.code, /^FF-[0-9A-Z]{4}$/);
  // Never a silent success — the tester is told where their report actually is.
  assert.match(r.body.note, /Saved on this machine/);
  assert.ok(readOutbox(r.body.code).includes('"kind": "bug"'));
});

test('the outbox copy is redacted too — a queued report is not a raw one', async () => {
  freshRoot();
  saveSettings({ falApiKey: 'another-unguessable-value-4471' });
  const r = await req('POST', '/api/feedback', loaded({ body: 'key another-unguessable-value-4471 here' }));
  const raw = readOutbox(r.body.code);
  assert.ok(!raw.includes('another-unguessable-value-4471'), 'the outbox holds an unredacted key on disk');
  assert.ok(!raw.includes('gsk_LiveKey'));
});

test('an empty report is refused rather than filed', async () => {
  freshRoot();
  const r = await req('POST', '/api/feedback', { title: '  ', body: '' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /title or a description/);
});

test('the context route leaks no secret and reports providers as booleans', async () => {
  freshRoot();
  saveSettings({ falApiKey: 'ctx-route-secret-value-1234', groqApiKey: 'gsk_CtxRouteSecret01234567' });
  const r = await req('GET', '/api/feedback/context');
  assert.equal(r.status, 200);
  const flat = JSON.stringify(r.body);
  assert.ok(!flat.includes('ctx-route-secret-value-1234'));
  assert.ok(!flat.includes('gsk_CtxRouteSecret'));
  for (const v of Object.values(r.body.app.providers)) assert.equal(typeof v, 'boolean');
});

test('a placeholder or malformed feedback URL behaves as unset, not as a broken service', async () => {
  freshRoot();
  const original = process.env.SCOUT_FEEDBACK_URL;
  try {
    // The value the setup docs ship verbatim. Pasting it must not turn every status lookup into a
    // 502 that surfaces as "not found" beside the user's own report code.
    for (const bad of ['https://<your-deployment>.convex.site', 'not-a-url', 'ftp://example.com', '   ']) {
      process.env.SCOUT_FEEDBACK_URL = bad;
      const status = await req('GET', '/api/feedback/report/FF-4P9H');
      assert.equal(status.status, 200, `${bad} produced HTTP ${status.status}`);
      assert.equal(status.body.status, 'local-only', `${bad} did not degrade to local-only`);

      const sent = await req('POST', '/api/feedback', loaded());
      assert.equal(sent.body.queued, true, `${bad} did not queue to the outbox`);
    }
  } finally {
    if (original === undefined) delete process.env.SCOUT_FEEDBACK_URL;
    else process.env.SCOUT_FEEDBACK_URL = original;
  }
});

test('turning the module off closes the egress route', async () => {
  freshRoot();
  saveSettings({ enabledModules: { feedback: false } });
  const r = await req('POST', '/api/feedback', loaded());
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'module-disabled');
});
