import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, req, fs, path, readMd, writeMd, getStorageRoot } from './helpers.mjs';
import { ensureWorkCollections } from '../backend/today.mjs';
import { upsertRecord, patchRecord } from '../backend/records.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { saveSettings } from '../backend/store.mjs';
import { accept, reject, getProposal, outboundApprovalFingerprint } from '../backend/proposals.mjs';
import { previewDelivery, executeDelivery, deliveryStatus } from '../backend/delivery.mjs';
import { saveAssistant } from '../backend/tasks.mjs';
import { saveWorkerPolicy, issueWorkerRun, withWorkerIdentity } from '../backend/workerScope.mjs';
import { saveWidgetLayout, widgetLayout } from '../backend/widgets.mjs';
import { previewOpsgraph, importOpsgraph } from '../backend/opsgraphImport.mjs';

function seed() {
  freshRoot(); ensureWorkCollections();
  upsertRecord({ collection: 'work', id: 'draft', title: 'Prepare invitation', bucket: 'email', status: 'planned', estimate_min: 15 });
  saveSettings({ deliveryDestinations: [{ id: 'mail', kind: 'webhook', url: 'https://example.com/messages' }] });
}
const preview = message => previewDelivery({ workId: 'draft', destinationId: 'mail', message });
function changeFile(card, patch) {
  const file = path.join(getStorageRoot(), card.path);
  const { data, content } = readMd(file);
  writeMd(file, { ...data, ...patch }, content);
}

test('agents cannot approve or reject delivery proposals through the API or canonical decision functions', async () => {
  seed();
  const { proposal } = preview('The exact invitation for review');
  const refused = await req('POST', '/api/proposals/' + proposal.id + '/accept', { actor: 'conductor' });
  assert.equal(refused.status, 403);
  const rejection = await req('POST', '/api/proposals/' + proposal.id + '/reject', { actor: 'unknown-worker', reason: 'bad-data' });
  assert.equal(rejection.status, 403);
  await assert.rejects(() => accept(proposal.id, { actor: 'conductor' }), e => e.status === 403);
  await assert.rejects(() => reject(proposal.id, { actor: 'conductor', reason: 'bad-data' }), e => e.status === 403);
  assert.equal(getProposal(proposal.id).status, 'open');
  await accept(proposal.id);
  assert.equal(getProposal(proposal.id).approved_content_hash, outboundApprovalFingerprint(getProposal(proposal.id)));
  let calls = 0;
  const result = await executeDelivery({ proposalId: proposal.id, fetchImpl: async () => { calls++; return { ok: true, status: 202 }; } });
  assert.equal(result.status, 'delivered');
  assert.equal(calls, 1);
});

test('generic document edits cannot forge acceptance or silently rewrite approved delivery content', async () => {
  seed();
  const { proposal } = preview('Approved words');
  const file = path.join(getStorageRoot(), proposal.path);
  const before = fs.readFileSync(file, 'utf8');
  for (const actor of ['conductor', 'crystal']) {
    const forgery = await req('PATCH', '/api/records', { path: proposal.path, actor,
      patch: { status: 'accepted', approved_at: new Date().toISOString(), approved_by: 'crystal', decided_by: 'crystal', message: 'Different words' } });
    assert.equal(forgery.status, 403);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
  await accept(proposal.id);
  await assert.rejects(() => patchRecord(proposal.path, { message: 'Unreviewed words' }), e => e.status === 403);
  saveCollection({ id: 'proposal-control', label: 'Proposal control', query: { path: 'proposals/**' }, fields: [{ key: 'title', type: 'text', primary: true }] });
  assert.throws(() => upsertRecord({ collection: 'proposal-control', id: proposal.id, title: 'Forged acceptance', status: 'accepted' }, { actor: 'conductor' }), e => e.status === 403);
});

test('changing both message and destination hash after approval still cannot send unreviewed output', async () => {
  seed();
  const original = preview('Approved invitation');
  await accept(original.proposal.id);
  const changed = preview('Different unreviewed invitation');
  changeFile(original.proposal, { message: changed.proposal.message, delivery_hash: changed.hash, updated_by: 'crystal' });
  let calls = 0;
  await assert.rejects(() => executeDelivery({ proposalId: original.proposal.id, fetchImpl: async () => { calls++; return { ok: true, status: 202 }; } }), /human decision|exact content/);
  assert.equal(calls, 0);
  assert.equal(deliveryStatus().receipts.length, 0);
});

test('forged agent decisions are refused and legacy approvals can receive a fresh human review', async () => {
  seed();
  const original = preview('Invitation requiring review');
  changeFile(original.proposal, { status: 'accepted', approved_at: new Date().toISOString(), approved_by: 'conductor', decided_by: 'conductor',
    approved_content_hash: outboundApprovalFingerprint(original.proposal) });
  await assert.rejects(() => executeDelivery({ proposalId: original.proposal.id, fetchImpl: () => { throw new Error('must not send'); } }), /human decision/);
  const fresh = preview('Invitation requiring review');
  assert.notEqual(fresh.proposal.id, original.proposal.id);
  assert.equal(fresh.proposal.status, 'open');
  assert.equal(preview('Invitation requiring review').proposal.id, fresh.proposal.id);
  await accept(fresh.proposal.id);
  let calls = 0;
  await executeDelivery({ proposalId: fresh.proposal.id, fetchImpl: async () => { calls++; return { ok: true, status: 202 }; } });
  assert.equal(calls, 1);
  assert.equal((await executeDelivery({ proposalId: fresh.proposal.id })).duplicate, true);
});

test('damaged receipt history fails closed before a second outbound request', async () => {
  seed();
  const { proposal } = preview('An invitation that must not be duplicated');
  await accept(proposal.id);
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 202 }; };
  await executeDelivery({ proposalId: proposal.id, fetchImpl });
  const file = path.join(getStorageRoot(), '.scout/deliveries.md');
  const saved = readMd(file).data.receipts;
  const receiptId = Object.keys(saved)[0];
  writeMd(file, { receipts: { [receiptId]: { ...saved[receiptId], status: 'corrupted' } } }, 'Keep this file for repair.');
  await assert.rejects(() => executeDelivery({ proposalId: proposal.id, fetchImpl }), /Repair their history/);
  assert.equal(calls, 1);
  writeMd(path.join(getStorageRoot(), '.scout/deliveries.md'), { receipts: 'damaged history' }, 'Keep this file for repair.');
  await assert.rejects(() => executeDelivery({ proposalId: proposal.id, fetchImpl }), /Repair their history/);
  assert.equal(calls, 1);
});

test('a rejected output can receive a fresh explicit review while retaining its delivery idempotency key', async () => {
  seed();
  const initial = preview('Please reconsider these exact words');
  await reject(initial.proposal.id, { reason: 'wrong-tone' });
  const reconsidered = preview('Please reconsider these exact words');
  assert.equal(getProposal(initial.proposal.id).status, 'rejected');
  assert.equal(reconsidered.proposal.status, 'open');
  assert.notEqual(reconsidered.proposal.id, initial.proposal.id);
  assert.equal(reconsidered.hash, initial.hash);
  await accept(reconsidered.proposal.id);
  let calls = 0, key;
  const receipt = await executeDelivery({ proposalId: reconsidered.proposal.id, fetchImpl: async (_url, options) => {
    calls++; key = options.headers['idempotency-key']; return { ok: true, status: 202 };
  } });
  assert.equal(key, 'delivery-' + initial.hash.slice(0, 24));
  assert.equal(receipt.id, key);
  assert.equal((await executeDelivery({ proposalId: reconsidered.proposal.id })).duplicate, true);
  assert.equal(calls, 1);
});

test('a verified worker context cannot become the human by passing a forged actor to canonical functions', async () => {
  seed();
  const pending = preview('A pending human decision');
  const approved = preview('An already approved delivery');
  await accept(approved.proposal.id);
  saveAssistant('scoped-reviewer', { name: 'Scoped reviewer' });
  saveWorkerPolicy('scoped-reviewer', { universes: ['local'], projects: [], collections: { read: ['work'], write: [] }, memory: { read: [], write: [] } });
  const { token } = issueWorkerRun({ assistantId: 'scoped-reviewer', runId: 'run-forged-owner' });
  let calls = 0;
  await withWorkerIdentity(token, async () => {
    await assert.rejects(() => accept(pending.proposal.id, { actor: 'crystal' }), e => e.status === 403);
    await assert.rejects(() => reject(pending.proposal.id, { actor: 'crystal', reason: 'bad-data' }), e => e.status === 403);
    await assert.rejects(() => executeDelivery({ proposalId: approved.proposal.id, actor: 'crystal', fetchImpl: async () => { calls++; return { ok: true, status: 202 }; } }), e => e.status === 403);
    assert.throws(() => saveWidgetLayout([{ type: 'delivery_status' }], { actor: 'crystal' }), e => e.status === 403);
    assert.throws(() => previewOpsgraph({ unit: 'unit/finance', snapshot: { goals: [] } }), e => e.status === 403);
    assert.throws(() => importOpsgraph({ unit: 'unit/finance', snapshot: { goals: [] }, previewHash: '' }, { actor: 'crystal' }), e => e.status === 403);
  });
  assert.equal(getProposal(pending.proposal.id).status, 'open');
  assert.equal(widgetLayout().length, 0);
  assert.equal(deliveryStatus().receipts.length, 0);
  assert.equal(calls, 0);
});

test('generic record edits cannot erase delivery history and unlock a duplicate send', async () => {
  seed();
  const { proposal } = preview('One exact outbound invitation');
  await accept(proposal.id);
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 202 }; };
  await executeDelivery({ proposalId: proposal.id, fetchImpl });
  const file = path.join(getStorageRoot(), '.scout/deliveries.md');
  const before = fs.readFileSync(file, 'utf8');
  const attempt = await req('PATCH', '/api/records', { path: '.scout/deliveries.md', actor: 'conductor', patch: { receipts: {} } });
  assert.equal(attempt.status, 403);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal((await executeDelivery({ proposalId: proposal.id, fetchImpl })).duplicate, true);
  assert.equal(calls, 1);
});
