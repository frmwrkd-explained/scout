import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { freshRoot, req, writeMd } from './helpers.mjs';
import { ensureWorkCollections } from '../backend/today.mjs';
import { upsertRecord, patchRecord, readRecord } from '../backend/records.mjs';
import { saveSettings, getStorageRoot } from '../backend/store.mjs';
import { saveGoal } from '../backend/memory.mjs';
import { previewOpsgraph, importOpsgraph } from '../backend/opsgraphImport.mjs';
import { previewDelivery, executeDelivery, reconcileDelivery, deliveryStatus } from '../backend/delivery.mjs';
import { proposeWidget, widgetData, widgetLayout } from '../backend/widgets.mjs';
import { accept } from '../backend/proposals.mjs';
import { ensureTodaySession, workItems } from '../backend/today.mjs';
import { runTurn, getSession } from '../backend/chat.mjs';
import { localDay } from '../backend/daytime.mjs';
import { documentsFor } from '../backend/documents.mjs';

function seed() {
  freshRoot(); ensureWorkCollections();
  upsertRecord({ collection: 'work', id: 'draft', title: 'Draft the invitation', bucket: 'email', status: 'planned', estimate_min: 15, body: 'Brief' });
}
const snapshot = { objectives: [{ id: 'objective/activation', unitId: 'unit/growth', title: 'Activation', target: 10, status: 'on-track', krs: [{ id: 'replies', text: 'Ten replies', target: 10 }] }],
  backlog: [{ id: 'bet/invitation', unitId: 'unit/growth', column: 'now', title: 'Draft invitations', objectiveId: 'objective/activation', krIds: ['replies'], why: 'Improve activation' },
    { id: 'bet/later', unitId: 'unit/growth', column: 'later', title: 'Later idea' },
    { id: 'bet/finance', unitId: 'unit/finance', column: 'now', title: 'Private budget' }] };

test('OpsGraph import selects one universe, links goals/KRs, and preserves local work on repeat', async () => {
  seed();
  const input = { snapshot, unit: 'unit/growth' }, preview = previewOpsgraph(input);
  assert.equal(preview.items.length, 2);
  assert.equal(preview.items.some(row => /finance|later/.test(row.source_id)), false);
  const work = preview.items.find(row => row.kind === 'work');
  assert.equal(work.goal_id, preview.items.find(row => row.kind === 'goal').id);
  assert.equal(work.key_result, 'Ten replies');
  assert.throws(() => importOpsgraph({ ...input, previewHash: 'old' }), /preview changed/);
  assert.throws(() => importOpsgraph({ ...input, previewHash: preview.hash }, { actor: 'scout' }), /operator/);
  assert.equal(importOpsgraph({ ...input, previewHash: preview.hash }).created.length, 2);
  await patchRecord('data/work/' + work.id + '.md', { title: 'My revised invitation', body: 'My local edits' });
  assert.equal(importOpsgraph({ ...input, previewHash: preview.hash }).skipped.length, 2);
  assert.equal(readRecord('data/work/' + work.id + '.md').content.trim(), 'My local edits');
});

test('OpsGraph mirror stays byte-for-byte unchanged and refuses symlink records', () => {
  seed();
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-import-mirror-'));
  try {
    writeMd(path.join(mirror, 'goals', 'growth', 'activation.md'), { id: 'goal/activation', type: 'goal', unit: 'unit/growth', label: 'Activation', target: 10 }, 'Original source');
    const file = path.join(mirror, 'goals', 'growth', 'activation.md'), before = fs.readFileSync(file, 'utf8');
    fs.symlinkSync(path.join(getStorageRoot(), 'settings.md'), path.join(mirror, 'goals', 'settings.md'));
    const input = { folder: mirror, unit: 'unit/growth' }, preview = previewOpsgraph(input);
    assert.equal(preview.items.length, 1);
    importOpsgraph({ ...input, previewHash: preview.hash });
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally { fs.rmSync(mirror, { recursive: true, force: true }); }
});

test('delivery approval binds exact output and destination; concurrent execution creates one artifact', async () => {
  seed();
  const preview = previewDelivery({ workId: 'draft', message: 'Hello — would you like to try the new onboarding flow?' });
  await assert.rejects(executeDelivery({ proposalId: preview.proposal.id }), /Approve/);
  await accept(preview.proposal.id);
  const receipts = await Promise.all([executeDelivery({ proposalId: preview.proposal.id }), executeDelivery({ proposalId: preview.proposal.id })]);
  assert.equal(receipts[0].id, receipts[1].id);
  assert.equal(receipts[0].status, 'delivered');
  assert.match(readRecord(receipts[0].result.path).content, /new onboarding flow/);
  assert.equal(documentsFor('delivery').documents.length, 1, 'saved output appears in its collection');
  assert.equal((await executeDelivery({ proposalId: preview.proposal.id })).duplicate, true);
  assert.equal(readRecord('data/work/draft.md').data.status, 'planned');
  await assert.rejects(executeDelivery({ proposalId: preview.proposal.id, actor: 'scout' }), /operator/);
  assert.throws(() => previewDelivery({ workId: '../private', message: 'bad' }), /Invalid work ID/);
});

test('ambiguous outbound failure requires evidence before retry and cannot silently duplicate a send', async () => {
  seed(); saveSettings({ deliveryDestinations: [{ id: 'test', kind: 'webhook', label: 'Test', url: 'https://example.com/inbox' }] });
  const preview = previewDelivery({ workId: 'draft', destinationId: 'test', message: 'Approved exact message' });
  await accept(preview.proposal.id);
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('lost acknowledgement'); };
  await assert.rejects(executeDelivery({ proposalId: preview.proposal.id, fetchImpl }), /inspect the destination/);
  assert.equal(deliveryStatus().receipts[0].status, 'uncertain');
  await assert.rejects(executeDelivery({ proposalId: preview.proposal.id, fetchImpl }), /Reconcile/);
  assert.equal(calls, 1);
  assert.throws(() => reconcileDelivery(deliveryStatus().receipts[0].id, { delivered: false, evidence: '' }), /evidence/);
  reconcileDelivery(deliveryStatus().receipts[0].id, { delivered: true, evidence: 'Destination receipt confirms message 42' });
  assert.equal((await executeDelivery({ proposalId: preview.proposal.id, fetchImpl })).duplicate, true);
  assert.equal(calls, 1);
});

test('changed connector target invalidates an approved delivery', async () => {
  seed(); saveSettings({ deliveryDestinations: [{ id: 'test', kind: 'webhook', url: 'https://example.com/first' }] });
  const preview = previewDelivery({ workId: 'draft', destinationId: 'test', message: 'Exact output' });
  await accept(preview.proposal.id);
  saveSettings({ deliveryDestinations: [{ id: 'test', kind: 'webhook', url: 'https://example.com/changed' }] });
  await assert.rejects(executeDelivery({ proposalId: preview.proposal.id, fetchImpl: () => { throw new Error('must not call'); } }), /fresh preview/);
});

test('widget proposals need evidence and approval; catalog forbids executable content', async () => {
  seed(); saveGoal('activation', { label: 'Activation', target: 10, current: 2, unit: 'replies' });
  assert.throws(() => proposeWidget({ type: 'goal_progress' }), /evidence/);
  assert.throws(() => proposeWidget({ type: 'goal_progress', html: '<script>bad</script>' }, { evidence: ['observed'] }), /executable/);
  const card = proposeWidget({ type: 'goal_progress', id: 'activation', goal_id: 'activation' }, { why: 'Track the goal', evidence: ['A goal is active'] });
  assert.equal(widgetLayout().length, 0);
  await accept(card.id);
  assert.equal(widgetLayout().length, 1);
  assert.match(widgetData().widgets[0].rows[0].detail, /2 \/ 10/);
  const refused = await req('PUT', '/api/widgets', { actor: 'scout', widgets: [] });
  assert.equal(refused.status, 403);
});

test('chat collaboration starts with permission and completes only after an explicit evidence statement', async () => {
  seed();
  await patchRecord('data/work/draft.md', { day: localDay(), done_when: 'A reviewed invitation exists' });
  const session = ensureTodaySession(localDay());
  process.env.SCOUT_BRAIN_COMMAND = fileURLToPath(new URL('./fixtures/stub-brain.mjs', import.meta.url));
  const action = type => { process.env.SCOUT_BRAIN_REPLY = 'Let’s take the next step.\n```json\n' + JSON.stringify({ actions: [{ type, id: 'draft' }] }) + '\n```'; };
  try {
    action('start_item');
    await runTurn(session.id, 'What should I do next?');
    assert.equal(workItems()[0].status, 'planned');
    await runTurn(session.id, 'Ready, start this');
    assert.equal(workItems()[0].status, 'now');
    action('complete_item');
    await runTurn(session.id, 'Done?');
    assert.equal(workItems()[0].status, 'now');
    await runTurn(session.id, 'Done');
    assert.equal(workItems()[0].status, 'now');
    await runTurn(session.id, 'Yes, done');
    assert.equal(workItems()[0].status, 'now');
    await runTurn(session.id, 'I have finished');
    assert.equal(workItems()[0].status, 'now');
    await runTurn(session.id, 'Done. What should I do next?');
    assert.equal(workItems()[0].status, 'now');
    await runTurn(session.id, 'Done — saved the reviewed invitation in Scout artifact 42. What should I do next?');
    assert.equal(workItems()[0].status, 'done');
    assert.match(getSession(session.id).messages.at(-1).text, /Completed: Draft/);
    assert.match(readRecord('data/work/draft.md').data.result_note, /artifact 42/);
  } finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY; }
});

test('unsafe delivery settings are refused before any configuration changes', () => {
  seed();
  for (const destination of [
    { id: 'x', kind: 'webhook', url: 'https://user:password@example.com/' },
    { id: 'x', kind: 'webhook', url: 'https://example.com/', token: 'private' },
    { id: 'local-artifact', kind: 'webhook', url: 'https://example.com/' },
  ]) assert.throws(() => saveSettings({ deliveryDestinations: [destination] }));
  assert.throws(() => saveSettings({ workerMaxConcurrent: 999 }));
});

test('explicit completion works without a model action and closes only the original Now item', async () => {
  seed();
  await patchRecord('data/work/draft.md', { day: localDay(), done_when: 'A reviewed invitation exists' });
  upsertRecord({ collection: 'work', id: 'next', title: 'Review the invitation', day: localDay(), status: 'planned', bucket: 'email', estimate_min: 10, order: 2 });
  const session = ensureTodaySession(localDay());
  process.env.SCOUT_BRAIN_COMMAND = fileURLToPath(new URL('./fixtures/stub-brain.mjs', import.meta.url));
  try {
    process.env.SCOUT_BRAIN_REPLY = 'Starting.\n```json\n{"actions":[{"type":"start_item","id":"draft"}]}\n```';
    await runTurn(session.id, 'Start the draft');
    process.env.SCOUT_BRAIN_REPLY = 'Next, review the invitation.';
    await runTurn(session.id, 'Done — the reviewed invitation is in Scout artifact 42. What next?');
    assert.equal(workItems().find(item => item.id === 'draft').status, 'done');
    assert.equal(workItems().find(item => item.id === 'next').status, 'now');
    assert.match(getSession(session.id).messages.at(-1).text, /Completed: Draft/);
  } finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY; }
});
