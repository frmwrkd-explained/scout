import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, server_, fs, path, writeMd, readMd } from './helpers.mjs';
import { setStorageRoot } from '../backend/store.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { saveAssistant } from '../backend/tasks.mjs';
import { upsertRecord, patchRecord, readRecord, nearMatches } from '../backend/records.mjs';
import { readCache, renderCache, regenerateCache, writeMe, saveLearning, cancelCacheRegen, flushCacheRegen } from '../backend/memory.mjs';
import { saveWorkerPolicy, getWorkerPolicy, issueWorkerRun, revokeWorkerRun, withWorkerIdentity,
  currentWorkerIdentity, projectWorkerPrompt, assertWorkerDispatchAllowed, workerProjectAllowed } from '../backend/workerScope.mjs';

const SECRET = 'FINANCE_PRIVATE_PAYROLL_91023';
const POLICY = {
  enabled: true, universes: ['public'], projects: ['campaign'],
  collections: { read: ['contact'], write: ['contact'] },
  memory: { read: ['goals/growth.md'], write: [] }, finance: false,
};
function seed() {
  const root = freshRoot();
  saveCollection({ id: 'finance', label: 'Finance', query: { path: 'data/finance/**' }, fields: [
    { key: 'name', type: 'text', primary: true }, { key: 'amount', type: 'number' },
  ] });
  saveCollection({ id: 'contact', label: 'Contacts', query: { path: 'data/contacts/**' }, fields: [
    { key: 'name', type: 'text', primary: true }, { key: 'universe', type: 'text' },
    { key: 'ledger', type: 'relation', target: 'finance', many: true },
    { key: 'total', type: 'rollup', via: 'ledger', target_field: 'amount', fn: 'sum' },
    { key: 'status', type: 'status', gate: true, options: ['needs-review', 'shortlist', 'won'] },
  ] });
  upsertRecord({ collection: 'finance', name: SECRET, universe: 'public', amount: 91023 });
  upsertRecord({ collection: 'contact', name: 'Public contact', universe: 'public', ledger: [SECRET] });
  upsertRecord({ collection: 'contact', name: 'Hidden contact', universe: 'ops', body: SECRET });
  upsertRecord({ collection: 'contact', name: 'Other project contact', universe: 'public', project: 'other-project', body: SECRET });
  upsertRecord({ collection: 'contact', name: 'Payroll contact', universe: 'public', sensitivity: 'finance', body: SECRET });
  writeMd(path.join(root, 'me.md'), { name: 'Crystal', universe: 'ops' }, SECRET);
  writeMd(path.join(root, 'goals', 'growth.md'), { id: 'growth', universe: 'public', label: 'Grow the audience' }, 'Approved public goal.');
  saveAssistant('researcher', { name: 'Researcher', job: 'Prepare research' });
  saveWorkerPolicy('researcher', POLICY);
  return root;
}
async function http(method, endpoint, { token = null, body = undefined } = {}) {
  const base = await server_();
  const res = await fetch(base + endpoint, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* markdown context */ }
  return { status: res.status, text, data };
}

test('the real API requires a run credential for a configured worker and refuses forged actors', async () => {
  seed();
  const uncredentialed = await http('POST', '/api/records/upsert', { body: { collection: 'contact', name: 'Unsigned', universe: 'public', actor: 'researcher' } });
  assert.equal(uncredentialed.status, 401);
  const run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-auth', project: 'campaign' });
  const forged = await http('POST', '/api/records/upsert', { token: run.token, body: { collection: 'contact', name: 'Forged', universe: 'public', actor: 'crystal', status: 'won' } });
  assert.equal(forged.status, 403);
  const otherActor = await http('GET', '/api/records?collection=contact&actor=conductor', { token: run.token });
  assert.equal(otherActor.status, 403);
  const stored = await http('POST', '/api/records/upsert', { token: run.token, body: { collection: 'contact', name: 'Scoped finding', universe: 'public' } });
  assert.equal(stored.status, 200);
  assert.equal(readRecord(stored.data.path).data.created_by, 'researcher');
  assert.equal(readRecord(stored.data.path).data.proposed, true);
  const promote = await http('POST', '/api/records/move', { token: run.token, body: { path: stored.data.path, to: 'won' } });
  assert.equal(promote.status, 403);
  const owner = await http('POST', '/api/records/move', { body: { path: stored.data.path, to: 'won', actor: 'crystal' } });
  assert.equal(owner.status, 200);
});

test('scoped reads omit finance, other universes, unsafe relations and derived rollups', async () => {
  seed();
  const run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-read' });
  const scoped = await http('GET', '/api/records?collection=contact', { token: run.token });
  assert.equal(scoped.status, 200);
  assert.equal(scoped.data.total, 1);
  assert.equal(scoped.data.rows[0].data.ledger, undefined);
  assert.equal(scoped.data.rows[0].data.total, undefined);
  assert.equal(scoped.text.includes(SECRET), false);
  for (const endpoint of ['/api/records?path=data/contacts/hidden-contact.md', '/api/records?path=data/contacts/payroll-contact.md', '/api/records?collection=finance']) {
    const refused = await http('GET', endpoint, { token: run.token });
    assert.equal(refused.status, 403, endpoint);
    assert.equal(refused.text.includes(SECRET), false);
  }
  const view = await http('GET', '/api/collections/contact/documents', { token: run.token });
  assert.equal(view.status, 200);
  assert.equal(view.data.total, 1);
  assert.equal(view.text.includes(SECRET), false);
  const match = await http('POST', '/api/records/match', { token: run.token, body: { collection: 'contact', name: 'Hidden contact' } });
  assert.equal(match.status, 200);
  assert.equal(match.text.includes('hidden-contact'), false);
  const markdown = await http('GET', '/api/context', { token: run.token });
  assert.equal(markdown.status, 200);
  assert.match(markdown.text, /Grow the audience/);
  assert.equal(markdown.text.includes(SECRET), false);
});

test('aggregate, arbitrary file, hub and administration endpoints fail closed for workers', async () => {
  seed();
  const { token } = issueWorkerRun({ assistantId: 'researcher', runId: 'run-aggregate' });
  for (const endpoint of ['/api/state', '/api/search?q=payroll', '/api/files/raw?path=me.md', '/api/activity', '/api/cache/version',
    '/api/goals', '/api/opsgraph/preview', '/api/deliveries', '/api/widgets', '/api/worker-policies']) {
    const refused = await http('GET', endpoint, { token });
    assert.equal(refused.status, 403, endpoint);
    assert.equal(refused.text.includes(SECRET), false);
  }
  const admin = await http('PUT', '/api/worker-policies/researcher', { token, body: { policy: { ...POLICY, finance: true } } });
  assert.equal(admin.status, 403);
  assert.equal(getWorkerPolicy('researcher').finance, false);
});

test('run identities expire, revoke, and bind to membership and workspace', async () => {
  const firstRoot = seed();
  let run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-expire', ttlMs: 1 });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await http('GET', '/api/worker/identity', { token: run.token })).status, 401);
  run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-revoke' });
  assert.equal((await http('GET', '/api/worker/identity', { token: run.token })).status, 200);
  assert.equal(revokeWorkerRun({ runId: 'run-revoke' }).revoked, 1);
  assert.equal((await http('GET', '/api/worker/identity', { token: run.token })).status, 401);
  run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-policy' });
  saveWorkerPolicy('researcher', { ...POLICY, enabled: false });
  assert.equal((await http('GET', '/api/worker/identity', { token: run.token })).status, 401);
  saveWorkerPolicy('researcher', POLICY);
  run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-root' });
  freshRoot();
  assert.equal((await http('GET', '/api/worker/identity', { token: run.token })).status, 401);
  setStorageRoot(firstRoot);
  assert.equal((await http('GET', '/api/worker/identity', { token: run.token })).status, 401);
});

test('canonical writers enforce membership even when bypassing HTTP, and hidden slug collisions stay intact', async () => {
  const root = seed();
  const { token } = issueWorkerRun({ assistantId: 'researcher', runId: 'run-writers' });
  assert.throws(() => upsertRecord({ collection: 'contact', name: 'Unsigned', universe: 'public' }, { actor: 'researcher' }), /run identity/);
  await withWorkerIdentity(token, async () => {
    assert.equal(currentWorkerIdentity().actor, 'researcher');
    assert.throws(() => upsertRecord({ collection: 'finance', name: 'Unauthorized' }, { actor: 'researcher' }), /membership/);
    assert.throws(() => upsertRecord({ collection: 'contact', name: 'Hidden contact', universe: 'public' }, { actor: 'researcher' }), /membership/);
    assert.throws(() => upsertRecord({ collection: 'contact', name: 'New payroll', universe: 'public', sensitivity: 'finance' }, { actor: 'researcher' }), /membership/);
    await assert.rejects(() => patchRecord('data/contacts/hidden-contact.md', { body: 'replace' }, { actor: 'researcher', rev: 'stale' }), e => e.status === 403 && !JSON.stringify(e).includes(SECRET));
    await assert.rejects(() => patchRecord('data/contacts/public-contact.md', { universe: 'ops' }, { actor: 'researcher' }), /membership/);
    await assert.rejects(() => patchRecord('data/contacts/public-contact.md', { body: 'spoofed' }, { actor: 'crystal' }), /actor/);
    assert.throws(() => writeMe('spoofed', {}, { actor: 'crystal' }), /actor/);
    assert.equal(nearMatches({ name: 'Hidden contact', collection: 'contact' }).some(m => m.path.includes('hidden-contact')), false);
    assert.equal(readCache().text.includes(SECRET), false);
    assert.equal(renderCache().text.includes(SECRET), false);
    assert.throws(() => regenerateCache(), /owner cache/);
  });
  assert.equal(currentWorkerIdentity(), null);
  assert.equal(readMd(path.join(root, 'data/contacts/hidden-contact.md')).content.trim(), SECRET);
});

test('scoped prompts have a hard cap and restricted CLI dispatch requires enforced tools', () => {
  seed();
  const text = projectWorkerPrompt({ assistantId: 'researcher', project: 'campaign', tokenBudget: 100 });
  assert.ok(text.length <= 400);
  assert.equal(text.includes(SECRET), false);
  assert.equal(workerProjectAllowed('researcher', 'campaign'), true);
  assert.equal(workerProjectAllowed('researcher', 'other-project'), false);
  assert.throws(() => projectWorkerPrompt({ assistantId: 'researcher', project: 'other-project' }), /project/);
  assert.throws(() => assertWorkerDispatchAllowed({ id: 'researcher' }), /unrestricted filesystem/);
  assert.equal(assertWorkerDispatchAllowed({ id: 'researcher' }, { textOnly: true }), true);
  assert.equal(assertWorkerDispatchAllowed({ id: 'legacy' }), true);
  assert.throws(() => saveWorkerPolicy('researcher', { ...POLICY, collections: { read: [], write: ['contact'] } }), /read membership/);
});

test('finance grants need explicit owner approval plus universe and collection membership', async () => {
  seed();
  let run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-no-finance' });
  const broaden = { ...POLICY, collections: { read: ['contact', 'finance'], write: ['contact'] } };
  saveWorkerPolicy('researcher', broaden);
  run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-finance-collection' });
  const excluded = await http('GET', '/api/records?collection=finance', { token: run.token });
  assert.equal(excluded.status, 200);
  assert.equal(excluded.data.total, 0);
  assert.equal(excluded.text.includes(SECRET), false);
  saveWorkerPolicy('researcher', { ...broaden, finance: true });
  run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-authorized-finance' });
  const permitted = await http('GET', '/api/records?collection=finance', { token: run.token });
  assert.equal(permitted.status, 200);
  assert.equal(permitted.data.total, 1);
  assert.equal(permitted.text.includes(SECRET), true);
  saveWorkerPolicy('researcher', { ...broaden, finance: true, universes: ['ops'] });
  run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-other-universe' });
  const wrongUniverse = await http('GET', '/api/records?collection=finance', { token: run.token });
  assert.equal(wrongUniverse.status, 200);
  assert.equal(wrongUniverse.data.total, 0);
});

test('OpsGraph unit universes stay exact and finance namespaces stay protected', async () => {
  seed();
  upsertRecord({ collection: 'contact', name: 'Growth unit', universe: 'unit/growth' });
  upsertRecord({ collection: 'contact', name: 'Other unit', universe: 'unit/ops', body: SECRET });
  upsertRecord({ collection: 'contact', name: 'Finance unit', universe: 'unit/finance', body: SECRET });
  saveWorkerPolicy('researcher', { ...POLICY, universes: ['unit/growth', 'unit/finance'] });
  const { token } = issueWorkerRun({ assistantId: 'researcher', runId: 'run-units' });
  const out = await http('GET', '/api/records?collection=contact', { token });
  assert.equal(out.status, 200);
  assert.equal(out.data.total, 1);
  assert.equal(out.data.rows[0].data.name, 'Growth unit');
  assert.equal(out.text.includes(SECRET), false);
  assert.throws(() => saveWorkerPolicy('researcher', { ...POLICY, universes: ['unit/../finance'] }), /slug/);
});

test('exact memory write grants preserve proposal gates and owner cache maintenance', async () => {
  seed();
  saveWorkerPolicy('researcher', { ...POLICY, memory: { read: ['learnings/lesson.md'], write: ['learnings/lesson.md'] } });
  cancelCacheRegen();
  const { token } = issueWorkerRun({ assistantId: 'researcher', runId: 'run-memory' });
  withWorkerIdentity(token, () => {
    const saved = saveLearning('lesson', { claim: 'Keep drafts concise', universe: 'public' }, { actor: 'researcher' });
    assert.equal(saved.status, 'proposed');
    assert.throws(() => saveLearning('lesson', { universe: 'unit/finance' }, { actor: 'researcher' }), /membership/);
    assert.throws(() => saveLearning('another', { universe: 'public', claim: 'Wrong file' }, { actor: 'researcher' }), /membership/);
  });
  revokeWorkerRun({ runId: 'run-memory' });
  assert.doesNotThrow(() => flushCacheRegen());
  assert.equal(readRecord('learnings/lesson.md').data.updated_by, 'researcher');
});

test('symlinks and generic record edits cannot bypass membership control', async () => {
  const root = seed();
  const outside = freshRoot();
  writeMd(path.join(outside, 'private.md'), { universe: 'public', name: 'Linked secret' }, SECRET);
  setStorageRoot(root);
  try { fs.symlinkSync(path.join(outside, 'private.md'), path.join(root, 'data/contacts/linked-secret.md')); }
  catch (e) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) throw e; return; }
  const run = issueWorkerRun({ assistantId: 'researcher', runId: 'run-symlink' });
  const linked = await http('GET', '/api/records?path=data/contacts/linked-secret.md', { token: run.token });
  assert.equal(linked.status, 403);
  assert.equal(linked.text.includes(SECRET), false);
  const prompt = projectWorkerPrompt({ assistantId: 'researcher' });
  assert.equal(prompt.includes(SECRET), false);
  const before = fs.readFileSync(path.join(root, '.scout/worker-policies/researcher.md'), 'utf8');
  const policyPatch = await http('PATCH', '/api/records', { body: { path: '.scout/worker-policies/researcher.md', actor: 'unknown-worker', patch: { finance: true } } });
  assert.equal(policyPatch.status, 403);
  assert.equal(fs.readFileSync(path.join(root, '.scout/worker-policies/researcher.md'), 'utf8'), before);
});

test('delivery and Paperclip result receipt IDs cannot fuzzy merge distinct occurrences', () => {
  freshRoot();
  for (const id of ['delivery', 'paperclip-result']) {
    saveCollection({ id, label: id, query: { path: 'data/' + id + '/**' }, fields: [{ key: 'title', type: 'text', primary: true }] });
    const first = upsertRecord({ collection: id, id: 'receipt-a', title: 'Approved campaign output' });
    const second = upsertRecord({ collection: id, id: 'receipt-b', title: 'Approved campaign output' });
    assert.equal(first.verdict, 'store');
    assert.equal(second.verdict, 'store');
    assert.notEqual(first.path, second.path);
  }
});
