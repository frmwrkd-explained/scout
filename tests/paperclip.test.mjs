import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import express from 'express';
import { freshRoot } from './helpers.mjs';
import { readMd, writeMd, getStorageRoot, saveSettings } from '../backend/store.mjs';
import { ensureWorkCollections, getToday, registerTodayRoutes } from '../backend/today.mjs';
import { localDay } from '../backend/daytime.mjs';
import { saveGoal } from '../backend/memory.mjs';
import { upsertRecord, readRecord, listRecords } from '../backend/records.mjs';
import { accept, listProposals, reject } from '../backend/proposals.mjs';
import { readEvents } from '../backend/log.mjs';
import { saveTask, claimTask, saveAssistant } from '../backend/tasks.mjs';
import { saveWorkerPolicy, issueWorkerRun, withWorkerIdentity, revokeWorkerRun } from '../backend/workerScope.mjs';
import { paperclipConfig, savePaperclipConfig, previewPaperclip, pushPaperclip, pullPaperclip,
  cancelPaperclip, paperclipStatus, paperclipDelegation, assertPaperclipWorkAvailable,
  registerPaperclipRoutes } from '../backend/paperclip.mjs';

const TOKEN = 'pcp_board_test_only_0123456789';
function seed() {
  const root = freshRoot();
  ensureWorkCollections();
  saveGoal('launch', { label: 'Launch useful onboarding', target: 10 });
  upsertRecord({ collection: 'work', id: 'draft', title: 'Draft onboarding', goal_id: 'launch',
    status: 'planned', done_when: 'Owner approves the draft', bucket: 'email', estimate_min: 20,
    body: 'Produce a first draft.\n\nPrivate token: ' + TOKEN }, { actor: 'crystal' });
  process.env.PAPERCLIP_TOKEN = TOKEN;
  return root;
}
async function mock(t, opts = {}) {
  const state = { projects: [], issues: [], comments: [], requests: [], drops: 0, interrupt: 0, deny: false, foreign: false };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const u = new URL(req.url, 'http://localhost');
    state.requests.push({ method: req.method, path: u.pathname, query: u.search, body, authorization: req.headers.authorization });
    assert.equal(req.headers.authorization, 'Bearer ' + TOKEN);
    const json = data => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };
    const row = data => ({ companyId: state.foreign ? 'wrong-company' : 'company-1', ...data });
    if (u.pathname === '/api/cli-auth/me') {
      if (state.deny) { res.statusCode = 403; return json({ error: TOKEN }); }
      return json({ companyIds: ['company-1'], userId: 'owner' });
    }
    if (u.pathname === '/api/agents/worker-1') return json(row({ id: 'worker-1', status: 'idle' }));
    if (u.pathname === '/api/companies/company-1/projects') {
      if (req.method === 'GET') return json(state.projects);
      const project = row({ id: 'project-' + (state.projects.length + 1), ...body }); state.projects.push(project); return json(project);
    }
    if (u.pathname === '/api/companies/company-1/issues') {
      if (req.method === 'GET') return json(state.issues.filter(it => it.description.includes(u.searchParams.get('q') || '')));
      if (!body.allowDuplicate && state.issues.some(it => it.title === body.title)) return json(state.issues.find(it => it.title === body.title));
      const issue = row({ id: 'issue-' + (state.issues.length + 1), updatedAt: '2026-10-02T12:00:00Z', ...body });
      state.issues.push(issue);
      if (opts.dropIssue && !state.drops++) return res.destroy();
      return json(issue);
    }
    const commentMatch = /^\/api\/issues\/([^/]+)\/comments$/.exec(u.pathname);
    if (commentMatch) {
      if (req.method === 'POST') { if (body.interrupt) state.interrupt++; return json({ id: 'cancel-comment' }); }
      const after = u.searchParams.get('after');
      const position = after ? state.comments.findIndex(c => c.id === after) + (opts.inclusiveAnchor ? 0 : 1) : 0;
      return json(state.comments.slice(position, position + 100));
    }
    const issue = state.issues.find(it => u.pathname === '/api/issues/' + it.id);
    if (issue) {
      if (req.method === 'PATCH') Object.assign(issue, body);
      return json({ ...issue, companyId: state.foreign ? 'wrong-company' : issue.companyId });
    }
    res.statusCode = 404; return json({ error: TOKEN });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  savePaperclipConfig({ enabled: true, url: 'http://127.0.0.1:' + server.address().port + '/api', companyId: 'company-1', agentId: 'worker-1' });
  return state;
}
async function approved() {
  const preview = previewPaperclip('draft');
  await accept(preview.proposalId);
  return preview;
}

test('Paperclip config is opt-in, validates transport and identity, keeps tokens outside Markdown', () => {
  const root = seed();
  assert.equal(paperclipConfig().enabled, false);
  assert.equal(paperclipConfig().ready, false);
  assert.throws(() => previewPaperclip('draft'), /disconnected/);
  for (const invalid of ['http://external.test', 'https://user:pass@example.test', 'https://example.test?token=x', 'https://example.test/other']) {
    assert.throws(() => savePaperclipConfig({ url: invalid }), /HTTPS|credentials|HTTP/);
  }
  assert.throws(() => savePaperclipConfig({ token: TOKEN }), /Unknown/);
  assert.throws(() => savePaperclipConfig({ enabled: true }), /Choose/);
  assert.throws(() => savePaperclipConfig({ enabled: false }, { actor: 'conductor' }), /person/);
  savePaperclipConfig({ enabled: false, url: 'https://paperclip.example.test', companyId: 'company-1', agentId: 'worker-1' });
  assert.equal(JSON.stringify(paperclipConfig()).includes(TOKEN), false);
  assert.equal(fs.readFileSync(path.join(root, '.scout/paperclip.md'), 'utf8').includes(TOKEN), false);
  writeMd(path.join(root, '.scout/paperclip.md'), { enabled: 'yes', url: 'http://external.test' }, '');
  assert.equal(paperclipConfig().ready, false);
});

test('preview makes one exact reviewable outbound proposal, with no network or broad memory', async t => {
  seed(); const remote = await mock(t);
  saveSettings({ hubToken: 'other-private-secret-0123456789' });
  const one = previewPaperclip('draft'), two = previewPaperclip('draft');
  assert.equal(one.proposalId, two.proposalId);
  assert.equal(listProposals({ kind: 'outbound' }).length, 1);
  assert.equal(remote.requests.length, 0);
  assert.match(one.payload.issue.description, /Completion evidence required/);
  assert.equal(JSON.stringify(one).includes(TOKEN), false);
  assert.equal(JSON.stringify(one).includes('groqApiKey'), false);
  assert.equal(one.sendsData, false);
  await assert.rejects(pushPaperclip('draft', { proposalId: one.proposalId }), /Approve/);
  assert.equal(remote.requests.length, 0);
  await reject(one.proposalId, { reason: 'off-target' });
  await assert.rejects(pushPaperclip('draft', { proposalId: one.proposalId }), /Approve/);
});

test('approved snapshot sends one project and issue across duplicate and concurrent pushes', async t => {
  seed(); const remote = await mock(t); const preview = await approved();
  const calls = await Promise.all([pushPaperclip('draft', { proposalId: preview.proposalId }), pushPaperclip('draft', { proposalId: preview.proposalId })]);
  assert.equal(calls.filter(r => r.pushed).length, 1);
  assert.equal(remote.projects.length, 1); assert.equal(remote.issues.length, 1);
  assert.equal(remote.issues[0].projectId, remote.projects[0].id);
  assert.equal(remote.issues[0].assigneeAgentId, 'worker-1');
  assert.equal(remote.issues[0].status, 'todo');
  assert.equal(remote.issues[0].description.includes(TOKEN), false);
  assert.equal(readRecord('data/work/draft.md').data.status, 'planned');
  assert.throws(() => assertPaperclipWorkAvailable('draft'), /delegated/);
  const receipt = paperclipDelegation('draft');
  assert.match(receipt.externalUrl, /\/issues\/issue-1$/); assert.equal(receipt.title, 'Draft onboarding');
  assert.equal(paperclipStatus().receipts.length, 2);
  assert.ok(readEvents({ type: 'run' }).some(event => event.detail.phase === 'paperclip-delegated'));
});

test('two Scout work occurrences with the same title remain two distinct Paperclip issues', async t => {
  seed(); const remote = await mock(t); const first = await approved();
  const one = await pushPaperclip('draft', { proposalId: first.proposalId });
  upsertRecord({ collection: 'work', id: 'draft-two', title: 'Draft onboarding', goal_id: 'launch', status: 'planned', body: 'A separate occurrence.' }, { actor: 'crystal' });
  const second = previewPaperclip('draft-two'); await accept(second.proposalId);
  const two = await pushPaperclip('draft-two', { proposalId: second.proposalId });
  assert.notEqual(one.receipt.remoteId, two.receipt.remoteId);
  assert.equal(remote.issues.length, 2); assert.equal(remote.projects.length, 1);
  assert.notEqual(remote.issues[0].idempotencyKey, remote.issues[1].idempotencyKey);
});

test('work changes invalidate approval before any outbound request', async t => {
  const root = seed(); const remote = await mock(t); const preview = await approved();
  const file = path.join(root, 'data/work/draft.md'), original = readMd(file);
  writeMd(file, original.data, 'Changed plan.');
  await assert.rejects(pushPaperclip('draft', { proposalId: preview.proposalId }), /Changed work/);
  assert.equal(remote.requests.length, 0);
  const renewed = previewPaperclip('draft'); assert.notEqual(renewed.proposalId, preview.proposalId);
});

test('export requires a human decision bound to the exact accepted outbound content', async t => {
  const root = seed(); const remote = await mock(t); const preview = await approved();
  const file = path.join(root, 'proposals', preview.proposalId + '.md'), original = readMd(file);
  for (const patch of [{ approved_content_hash: '' }, { decided_by: 'conductor' }, { approved_by: '' }, { subject: 'Changed after acceptance' },
    { updated_by: 'conductor' }, { decided_by: 'different-person' }]) {
    writeMd(file, { ...original.data, ...patch }, original.content);
    await assert.rejects(pushPaperclip('draft', { proposalId: preview.proposalId }), /Approve/);
    assert.equal(remote.requests.length, 0);
  }
});

test('rejected or obsolete same-content approvals produce a fresh review without changing issue identity', async t => {
  const root = seed(); const remote = await mock(t);
  const rejected = previewPaperclip('draft'); await reject(rejected.proposalId, { reason: 'off-target' });
  const fresh = previewPaperclip('draft');
  assert.notEqual(fresh.proposalId, rejected.proposalId); assert.equal(fresh.payload.issueKey, rejected.payload.issueKey);
  await accept(fresh.proposalId);
  const file = path.join(root, 'proposals', fresh.proposalId + '.md'), original = readMd(file);
  writeMd(file, { ...original.data, approved_content_hash: '' }, original.content);
  const renewed = previewPaperclip('draft');
  assert.notEqual(renewed.proposalId, fresh.proposalId); assert.equal(renewed.proposal.status, 'open');
  assert.equal(renewed.payload.issueKey, rejected.payload.issueKey); assert.equal(remote.requests.length, 0);
  await accept(renewed.proposalId);
  assert.equal((await pushPaperclip('draft', { proposalId: renewed.proposalId })).pushed, true);
  assert.equal(remote.issues.length, 1);
});

test('active and manually paused Now work cannot be handed to a second executor', async t => {
  const root = seed(); await mock(t);
  const file = path.join(root, 'data/work/draft.md'), original = readMd(file);
  writeMd(file, { ...original.data, status: 'now' }, original.content);
  assert.throws(() => previewPaperclip('draft'), /Only planned work/);
});

test('a claimed local worker task cannot also be exported to Paperclip', async t => {
  seed(); const remote = await mock(t);
  saveTask('demo', 'draft-task', { title: 'Prepare draft', work_id: 'draft' });
  assert.equal(claimTask('demo', 'draft-task', { actor: 'writer' }).won, true);
  assert.throws(() => previewPaperclip('draft'), /claimed by local worker/);
  assert.equal(remote.requests.length, 0);
});

test('canonical scoped worker identity cannot configure or delegate by naming a human actor', async t => {
  seed(); const remote = await mock(t); const preview = await approved();
  saveAssistant('bridge-worker', { name: 'Scoped bridge worker', job: 'Prepare drafts' });
  saveWorkerPolicy('bridge-worker', { enabled: true, universes: ['public'], projects: [],
    collections: { read: ['work'], write: ['work'] }, memory: { read: [], write: [] }, finance: false });
  const { token } = issueWorkerRun({ assistantId: 'bridge-worker', runId: 'bridge-worker-run' });
  try {
    await withWorkerIdentity(token, async () => {
      assert.throws(() => savePaperclipConfig({ enabled: false }, { actor: 'crystal' }), /person/);
      assert.throws(() => previewPaperclip('draft', { actor: 'crystal' }), /person/);
      await assert.rejects(pushPaperclip('draft', { proposalId: preview.proposalId, actor: 'crystal' }), /person/);
      await assert.rejects(pullPaperclip('draft', { actor: 'crystal' }), /person/);
      await assert.rejects(cancelPaperclip('draft', { reason: 'Forged human cancellation', actor: 'crystal' }), /person/);
    });
    assert.equal(remote.requests.length, 0); assert.equal(paperclipConfig().enabled, true);
  } finally { revokeWorkerRun({ runId: 'bridge-worker-run' }); }
});

test('Today keeps delegated work visible waiting, skips it for Next and advances the local clock', async t => {
  const root = seed(); const remote = await mock(t); const day = localDay();
  const file = path.join(root, 'data/work/draft.md'), draft = readMd(file);
  writeMd(file, { ...draft.data, day, order: 2 }, draft.content);
  for (const [id, order] of [['local-a', 1], ['local-c', 3]]) {
    upsertRecord({ collection: 'work', id, title: id, status: 'planned', day, order,
      bucket: 'admin', estimate_min: 10 }, { actor: 'crystal' });
  }
  const preview = await approved(); await pushPaperclip('draft', { proposalId: preview.proposalId });
  const app = express(); app.use(express.json()); registerTodayRoutes(app);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const post = async (action, body) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/today/' + action,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  await post('start', { id: 'local-a' });
  const before = await getToday();
  assert.equal(before.now.id, 'local-a'); assert.equal(before.next.id, 'local-c');
  const waiting = before.plan.find(item => item.id === 'draft');
  assert.equal(waiting.status, 'planned'); assert.match(waiting.wait_reason, /delegated to Paperclip/);
  const finished = await post('done', { id: 'local-a' });
  assert.equal(finished.next.id, 'local-c'); assert.equal(finished.today.now.id, 'local-c');
  assert.equal(finished.today.now.clock.running, true);
  assert.equal(readRecord('data/work/local-a.md').data.status, 'done');
  assert.equal(readRecord('data/work/draft.md').data.status, 'planned');
  assert.match(finished.today.plan.find(item => item.id === 'draft').wait_reason, /delegated to Paperclip/);
  const starts = readEvents({ type: 'work' }).filter(event => event.detail?.action === 'start').map(event => event.detail.id);
  assert.equal(starts.includes('draft'), false); assert.ok(starts.includes('local-c'));
  assert.equal(remote.issues.length, 1);
});

test('edits while preflight is in flight prevent the first remote create', async t => {
  const root = seed(); const remote = await mock(t); const preview = await approved();
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options);
    if (String(url).includes('/projects?')) {
      const file = path.join(root, 'data/work/draft.md'), original = readMd(file);
      writeMd(file, original.data, 'Changed while checking the remote project.');
    }
    return response;
  };
  await assert.rejects(pushPaperclip('draft', { proposalId: preview.proposalId, fetchImpl }), /Work changed/);
  assert.equal(remote.projects.length, 0); assert.equal(remote.issues.length, 0);
});

test('unknown issue creation reconciles stable markers without creating a second issue', async t => {
  seed(); const remote = await mock(t, { dropIssue: true }); const preview = await approved();
  await assert.rejects(pushPaperclip('draft', { proposalId: preview.proposalId }), /failed|timed out/);
  assert.equal(paperclipDelegation('draft').state, 'unknown');
  assert.throws(() => assertPaperclipWorkAvailable('draft'), /delegated/);
  const retry = await pushPaperclip('draft', { proposalId: preview.proposalId });
  assert.equal(retry.pushed, true); assert.equal(remote.issues.length, 1); assert.equal(remote.projects.length, 1);
});

test('denied auth redacts remote errors, reserves work and allows cancellation before create', async t => {
  seed(); const remote = await mock(t); const preview = await approved(); remote.deny = true;
  await assert.rejects(pushPaperclip('draft', { proposalId: preview.proposalId }), error => !error.message.includes(TOKEN) && /HTTP 403/.test(error.message));
  assert.equal(remote.issues.length, 0); assert.equal(paperclipDelegation('draft').state, 'reserved');
  const cancelled = await cancelPaperclip('draft', { reason: 'Use local work instead' });
  assert.equal(cancelled.cancelled, true); assert.doesNotThrow(() => assertPaperclipWorkAvailable('draft'));
});

test('remote results go through canonical proposed findings; duplicated pulls do not complete human work', async t => {
  seed(); const remote = await mock(t); const preview = await approved();
  await pushPaperclip('draft', { proposalId: preview.proposalId });
  remote.issues[0].status = 'done';
  remote.comments = [{ id: 'comment-1', issueId: 'issue-1', body: 'Draft is ready. Token ' + TOKEN },
    { id: 'comment-2', issueId: 'issue-1', body: 'Evidence: reviewed sample.' }];
  const result = await pullPaperclip('draft');
  assert.equal(result.imported.length, 2); assert.equal(result.receipt.state, 'done');
  assert.equal(listRecords('paperclip-result').total, 2);
  for (const imported of result.imported) {
    const record = readRecord(imported.path); assert.equal(record.data.proposed, true); assert.equal(record.data.status, 'found');
    assert.equal(record.data.provenance, 'pipeline'); assert.equal(record.content.includes(TOKEN), false);
  }
  assert.equal(listProposals({ kind: 'finding' }).length, 2);
  assert.equal(readRecord('data/work/draft.md').data.status, 'planned');
  const again = await pullPaperclip('draft');
  assert.equal(again.imported.length, 0); assert.equal(listRecords('paperclip-result').total, 2);
  assert.equal(listProposals({ kind: 'question' }).length, 1);
});

test('result cards show the approved task title and draft while preserving raw-source identity', async t => {
  const root = seed(); const remote = await mock(t);
  const workFile = path.join(root, 'data/work/draft.md'), source = readMd(workFile);
  writeMd(workFile, { ...source.data, project: 'onboarding', universe: 'public' }, source.content);
  const preview = await approved();
  await pushPaperclip('draft', { proposalId: preview.proposalId });
  const marker = '[Scout worker result ' + 'a'.repeat(64) + ']';
  const raw = marker + '\n\n# Onboarding comparison\n\nA clear, useful synthetic draft.';
  remote.comments = [{ id: 'comment-1', issueId: 'issue-1', body: raw, createdByRunId: 'native-run-1' },
    { id: 'comment-2', issueId: 'issue-1', body: 'Explain this literal example:\n' + marker + '\nKeep it as task content.' }];
  const pulled = await pullPaperclip('draft');
  const first = readRecord(pulled.imported[0].path), second = readRecord(pulled.imported[1].path);
  assert.equal(first.data.title, 'Paperclip draft: Draft onboarding');
  assert.equal(first.content.includes('Scout worker result'), false);
  assert.match(first.content, /# Onboarding comparison/);
  assert.equal(first.data.paperclip_source_hash, createHash('sha256').update(JSON.stringify(raw)).digest('hex'));
  assert.equal(first.data.paperclip_run, 'native-run-1');
  assert.equal(first.data.paperclip_comment, 'comment-1'); assert.equal(first.data.proposed, true);
  assert.equal(first.data.goal_id, 'launch'); assert.equal(first.data.project, 'onboarding'); assert.equal(first.data.universe, 'public');
  assert.match(second.content, /Explain this literal example/);
  assert.match(second.content, /Scout worker result/);
  assert.equal((await pullPaperclip('draft')).imported.length, 0);
  writeMd(workFile, source.data, source.content + '\nChanged after approved export');
  remote.comments.push({ id: 'comment-3', issueId: 'issue-1', body: 'A new result whose source has changed.' });
  const later = await pullPaperclip('draft'), unassigned = readRecord(later.imported[0].path);
  assert.equal(unassigned.data.goal_id, undefined); assert.equal(unassigned.data.project, undefined);
  assert.equal(unassigned.data.universe, undefined); assert.equal(unassigned.data.proposed, true);
});

test('inclusive deployed comment cursors cannot re-import their anchor or stall pagination', async t => {
  seed(); const remote = await mock(t, { inclusiveAnchor: true }); const preview = await approved();
  await pushPaperclip('draft', { proposalId: preview.proposalId });
  remote.comments = [{ id: 'comment-1', issueId: 'issue-1', body: 'First result' }];
  assert.equal((await pullPaperclip('draft')).imported.length, 1);
  assert.equal((await pullPaperclip('draft')).imported.length, 0);
  remote.comments.push({ id: 'comment-2', issueId: 'issue-1', body: 'Second result' });
  assert.equal((await pullPaperclip('draft')).imported.length, 1);
  assert.equal(listRecords('paperclip-result').total, 2);
});

test('cancel closes the issue and requests active run interruption, with one durable receipt', async t => {
  seed(); const remote = await mock(t); const preview = await approved();
  await pushPaperclip('draft', { proposalId: preview.proposalId });
  await assert.rejects(cancelPaperclip('draft', { reason: '' }), /reason/);
  assert.equal((await cancelPaperclip('draft', { reason: 'Changed direction' })).cancelled, true);
  assert.equal(remote.issues[0].status, 'cancelled'); assert.equal(remote.interrupt, 1);
  assert.equal((await cancelPaperclip('draft', { reason: 'Changed direction' })).duplicate, true);
  assert.equal(remote.interrupt, 1); assert.doesNotThrow(() => assertPaperclipWorkAvailable('draft'));
});

test('cancel checks the mapped marker before mutation and preserves already finished issues', async t => {
  seed(); const remote = await mock(t); const preview = await approved();
  await pushPaperclip('draft', { proposalId: preview.proposalId });
  const original = remote.issues[0].description;
  remote.issues[0].description = 'A different issue without the Scout identity';
  await assert.rejects(cancelPaperclip('draft', { reason: 'Cancel' }), /unexpected identity or company/);
  assert.equal(remote.requests.filter(r => r.method === 'PATCH').length, 0);
  remote.issues[0].description = original; remote.issues[0].status = 'done';
  const result = await cancelPaperclip('draft', { reason: 'Cancel' });
  assert.equal(result.cancelled, false); assert.equal(result.finished, true);
  assert.equal(result.receipt.state, 'done'); assert.equal(remote.interrupt, 0);
  assert.equal(remote.requests.filter(r => r.method === 'PATCH').length, 0);
});

test('foreign-company data cannot import a result or silently complete a delegation', async t => {
  seed(); const remote = await mock(t); const preview = await approved();
  await pushPaperclip('draft', { proposalId: preview.proposalId }); remote.foreign = true;
  await assert.rejects(pullPaperclip('draft'), /unexpected identity or company/);
  assert.equal(paperclipDelegation('draft').state, 'delegated');
  assert.equal(listProposals({ kind: 'finding' }).length, 0);
});

test('an older cancelled mapping cannot hide an active delegation; new connections cannot double-dispatch', async t => {
  const root = seed(); const remote = await mock(t); const preview = await approved();
  await pushPaperclip('draft', { proposalId: preview.proposalId });
  const active = paperclipDelegation('draft');
  writeMd(path.join(root, '.scout/paperclip/receipts/000000-old.md'), {
    ...active, key: '000000-old', state: 'cancelled', remoteStatus: 'cancelled', connection: 'old-connection' }, '');
  assert.equal(paperclipDelegation('draft').state, 'delegated');
  assert.throws(() => assertPaperclipWorkAvailable('draft'), /delegated/);
  assert.equal((await pullPaperclip('draft')).receipt.remoteId, active.remoteId);
  savePaperclipConfig({ url: 'https://other.example.test' });
  const changed = await approved();
  const calls = remote.requests.length;
  await assert.rejects(pushPaperclip('draft', { proposalId: changed.proposalId }), /another connection/);
  assert.equal(remote.requests.length, calls);
});

test('HTTP routes keep credentials server-side and expose disconnected state honestly', async t => {
  seed(); const app = express(); app.use(express.json()); registerPaperclipRoutes(app);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  const state = await fetch(base + '/api/paperclip').then(r => r.json());
  assert.equal(state.config.enabled, false); assert.equal(JSON.stringify(state).includes(TOKEN), false);
  const denied = await fetch(base + '/api/paperclip/config', { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, url: 'https://example.test', companyId: 'company-1', agentId: 'worker-1', actor: 'conductor' }) });
  assert.equal(denied.status, 403);
});
