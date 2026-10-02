// Approved output -> destination -> durable receipt. Approving a proposal never sends it;
// an explicit execute action does. Ambiguous network failures require reconciliation.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getStorageRoot, getSettings, readMd, writeMd } from './store.mjs';
import path from 'node:path';
import { getProposal, propose, outboundApprovalFingerprint } from './proposals.mjs';
import { isAgentActor } from './actors.mjs';
import { getCollection, saveCollection } from './collections.mjs';
import { upsertRecord, readRecord } from './records.mjs';
import { logEvent } from './log.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const file = () => path.join(getStorageRoot(), '.scout', 'deliveries.md');
const state = () => {
  if (!fs.existsSync(file())) return {};
  try {
    const receipts = readMd(file()).data.receipts;
    if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts)) throw new Error('invalid receipts');
    for (const [id, receipt] of Object.entries(receipts)) {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.id !== id
        || !['sending', 'uncertain', 'delivered', 'failed'].includes(receipt.status)
        || !/^[a-f0-9]{64}$/.test(String(receipt.hash || ''))) throw new Error('invalid receipt');
    }
    return receipts;
  } catch { fail('Delivery receipts cannot be read. Repair their history before sending again.', 409); }
};
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function owner(actor) { if (currentWorkerIdentity() || isAgentActor(actor)) fail('Only the operator may execute an approved delivery.', 403); }
const active = new Map();
function saveReceipt(root, id, receipt) {
  if (root !== getStorageRoot()) fail('Workspace changed during delivery.', 409);
  writeMd(file(), { receipts: { ...state(), [id]: receipt } }, 'Delivery receipts. An uncertain send must be reconciled before retrying.\n');
  logEvent({ type: 'run', actor: receipt.actor, target: 'delivery/' + id, detail: { status: receipt.status, destination: receipt.destination } });
}

export function deliveryDestinations() {
  const configured = getSettings().deliveryDestinations;
  return [{ id: 'local-artifact', label: 'Scout artifact', kind: 'artifact' },
    ...(Array.isArray(configured) ? configured : []).map(destination => {
      if (!/^[a-z][a-z0-9-]{0,60}$/.test(destination.id || '') || destination.kind !== 'webhook') fail('Invalid delivery destination.');
      const url = new URL(destination.url);
      if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) fail('Destination must use HTTPS, or a local demo endpoint, without URL credentials.');
      if (destination.tokenEnv && !/^[A-Z][A-Z0-9_]+$/.test(destination.tokenEnv)) fail('Destination tokenEnv must name an environment variable.');
      return { id: destination.id, label: String(destination.label || destination.id), kind: 'webhook', url: url.href, tokenEnv: destination.tokenEnv || '' };
    })];
}
export function deliveryStatus() { return { destinations: deliveryDestinations().map(({ tokenEnv, ...rest }) => rest), receipts: Object.values(state()) }; }

function ensureDeliveryCollection() {
  const existing = getCollection('delivery');
  if (!existing) saveCollection({ id: 'delivery', label: 'Delivered artifacts', query: { tag: 'delivery', path: 'data/delivery/**' },
    fields: [{ key: 'title', type: 'text', primary: true }, { key: 'work_id', type: 'text' }, { key: 'goal_id', type: 'text' }] });
  else if (!existing.query) saveCollection({ ...existing, query: { path: 'data/delivery/**' } });
}

function payloadFor(workId, destinationId, message) {
  if (!/^[a-z0-9][a-z0-9_-]{0,160}$/i.test(String(workId || ''))) fail('Invalid work ID.');
  const work = readRecord('data/work/' + String(workId) + '.md');
  if (!work) fail('Work item not found.', 404);
  const destination = deliveryDestinations().find(item => item.id === destinationId);
  if (!destination) fail('Choose a configured destination.');
  const content = String(message || '').trim();
  if (!content || content.length > 50000) fail('Delivery needs an output of at most 50000 characters.');
  const payload = { workId: String(workId), title: work.data.title || String(workId), goal_id: work.data.goal_id || '', destination: destination.id, content };
  return { payload, destination, hash: digest({ payload, destination }) };
}
export function previewDelivery({ workId, destinationId = 'local-artifact', message, actor = 'conductor' }) {
  const { payload, destination, hash } = payloadFor(workId, destinationId, message);
  const card = { kind: 'outbound',
    title: 'Deliver: ' + payload.title, channel: destination.label, message: payload.content,
    why: 'Approve this exact output for ' + destination.label + '. Sending is a separate action.',
    work_id: workId, destination_id: destinationId, delivery_hash: hash, evidence: ['data/work/' + workId + '.md'],
  };
  const baseId = 'delivery-' + hash.slice(0, 24);
  let id = baseId;
  // Older or subsequently edited accepted cards need a new decision. Delivery's idempotency
  // key remains the exact payload hash, so re-review cannot cause a confirmed output to repeat.
  for (let revision = 0; revision < 100; revision++) {
    const existing = getProposal(id);
    const matches = existing && outboundApprovalFingerprint(existing) === outboundApprovalFingerprint(card);
    const validApproval = existing?.status === 'open' || (existing?.status === 'accepted' && existing.approved_content_hash === outboundApprovalFingerprint(existing)
      && !isAgentActor(existing.approved_by) && !isAgentActor(existing.decided_by)
      && existing.approved_by === existing.decided_by && !(existing.updated_by && isAgentActor(existing.updated_by)));
    if (!existing || (matches && validApproval)) break;
    id = baseId + '-review-' + (revision + 1);
    if (revision === 99) fail('Too many obsolete delivery previews. Review the proposal history.', 409);
  }
  const proposal = propose({ ...card, id }, { actor });
  return { proposal, payload, hash };
}

export async function executeDelivery({ proposalId, actor = 'crystal', fetchImpl = globalThis.fetch } = {}) {
  owner(actor);
  const root = getStorageRoot(), card = getProposal(proposalId);
  if (!card || card.kind !== 'outbound' || card.status !== 'accepted' || !card.approved_at || !card.delivery_hash) fail('Approve the current delivery preview in Needs you first.', 409);
  if (isAgentActor(card.approved_by) || isAgentActor(card.decided_by)
    || card.approved_by !== card.decided_by || (card.updated_by && isAgentActor(card.updated_by))
    || card.approved_content_hash !== outboundApprovalFingerprint(card)) {
    fail('Delivery approval is not bound to this exact content and a human decision. Approve a fresh preview.', 409);
  }
  const { payload, destination, hash } = payloadFor(card.work_id, card.destination_id, card.message);
  if (hash !== card.delivery_hash) fail('Output or destination changed. Approve a fresh preview.', 409);
  if (destination.kind === 'artifact') ensureDeliveryCollection();
  const id = 'delivery-' + hash.slice(0, 24), key = root + '/' + id;
  const prior = state()[id];
  if (prior?.status === 'delivered') return { ...prior, duplicate: true };
  if (active.has(key)) return active.get(key);
  if (prior && ['sending', 'uncertain'].includes(prior.status)) fail('Delivery outcome is uncertain. Reconcile its receipt before retrying.', 409);
  const run = (async () => {
    const receipt = { id, proposalId, workId: payload.workId, title: payload.title, destination: destination.id, actor, hash, status: 'sending', started: new Date().toISOString() };
    saveReceipt(root, id, receipt);
    try {
      let result;
      if (destination.kind === 'artifact') {
        result = upsertRecord({ collection: 'delivery', id, title: payload.title, work_id: payload.workId, goal_id: payload.goal_id, body: payload.content }, { actor, via: 'approved-delivery' });
      } else {
        const token = destination.tokenEnv ? process.env[destination.tokenEnv] : '';
        if (destination.tokenEnv && !token) throw Object.assign(new Error('Configure the destination token on the backend before sending.'), { refused: true });
        const response = await fetchImpl(destination.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
          headers: { 'content-type': 'application/json', 'idempotency-key': id, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload) });
        if (!response.ok) { const error = new Error('Destination refused delivery: HTTP ' + response.status); error.refused = response.status < 500; throw error; }
        result = { status: response.status }; // Do not retain arbitrary destination response content.
      }
      const completed = { ...receipt, status: 'delivered', completed: new Date().toISOString(), result };
      saveReceipt(root, id, completed);
      return completed;
    } catch (error) {
      const completed = { ...receipt, status: error.refused || destination.kind === 'artifact' ? 'failed' : 'uncertain', error: error.refused || destination.kind === 'artifact' ? error.message : 'Delivery did not confirm success; inspect the destination before retrying.' };
      saveReceipt(root, id, completed);
      throw Object.assign(new Error(completed.error), { status: 502 });
    }
  })();
  active.set(key, run);
  try { return await run; } finally { active.delete(key); }
}

export function reconcileDelivery(id, { delivered, evidence, actor = 'crystal' }) {
  owner(actor);
  if (typeof delivered !== 'boolean' || !String(evidence || '').trim()) fail('Reconciliation needs a yes/no outcome and destination evidence.');
  if (active.has(getStorageRoot() + '/' + id)) fail('The delivery is still running.', 409);
  const prior = state()[id];
  if (!prior || !['sending', 'uncertain'].includes(prior.status)) fail('Only uncertain deliveries need reconciliation.', 409);
  const next = { ...prior, status: delivered ? 'delivered' : 'failed', evidence: String(evidence).trim(), reconciled_by: actor, reconciled_at: new Date().toISOString() };
  saveReceipt(getStorageRoot(), id, next);
  return next;
}
export function registerDeliveryRoutes(app) {
  const route = fn => async (req, res) => { try { res.json(await fn(req)); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } };
  app.get('/api/deliveries', route(() => deliveryStatus()));
  app.post('/api/deliveries/preview', route(req => previewDelivery(req.body || {})));
  app.post('/api/deliveries/execute', route(req => executeDelivery(req.body || {})));
  app.post('/api/deliveries/:id/reconcile', route(req => reconcileDelivery(req.params.id, req.body || {})));
}
