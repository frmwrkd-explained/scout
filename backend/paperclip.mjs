// Optional Paperclip worker bridge. Scout owns Markdown work and decisions; Paperclip owns
// delegated issue execution. No scheduler, tool credentials, or workspace mounts are exported.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getStorageRoot, readMd, writeMd, getSettings, SECRET_SETTING_KEYS } from './store.mjs';
import { redact } from '../shared/redact.mjs';
import { DEFAULT_ACTOR, isAgentActor } from './actors.mjs';
import { readRecord, upsertRecord } from './records.mjs';
import { getCollection, saveCollection, addField } from './collections.mjs';
import { getGoal } from './memory.mjs';
import { workItems } from './today.mjs';
import { workReadiness } from './workflow.mjs';
import { propose, getProposal, outboundApprovalFingerprint } from './proposals.mjs';
import { logEvent } from './log.mjs';
import { assertLocalWorkAvailable, withWorkAssignmentLock, TaskError } from './tasks.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';

const VERSION = 1;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const TERMINAL = ['done', 'cancelled'];
const queues = new Map();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp = () => new Date().toISOString();
const dir = root => path.join(root, '.scout', 'paperclip');
const configFile = root => path.join(root, '.scout', 'paperclip.md');
const receiptFile = (root, key) => path.join(dir(root), 'receipts', key + '.md');

export class PaperclipError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function read(file) {
  if (!fs.existsSync(file)) return null;
  try { return readMd(file).data; }
  catch { throw new PaperclipError('Paperclip metadata is unreadable; repair the Markdown file before continuing', 409); }
}
function id(value, field, optional = false) {
  const s = String(value ?? '').trim();
  if (optional && !s) return '';
  if (!ID.test(s)) throw new PaperclipError(field + ' must be an ID containing letters, digits, - or _');
  return s;
}
function url(value, optional = false) {
  const s = String(value ?? '').trim();
  if (optional && !s) return '';
  let u;
  try { u = new URL(s); } catch { throw new PaperclipError('Paperclip URL must be an HTTP(S) origin'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname.toLowerCase());
  if (u.username || u.password || u.search || u.hash || !['', '/', '/api', '/api/'].includes(u.pathname)
    || !['http:', 'https:'].includes(u.protocol) || (u.protocol === 'http:' && !local)) {
    throw new PaperclipError('Use HTTPS, or HTTP on loopback, with no URL credentials, query or extra path');
  }
  return u.origin;
}
function human(actor) {
  if (currentWorkerIdentity() || isAgentActor(actor)) throw new PaperclipError('A person must configure, approve or cancel Paperclip work', 403);
}
function assertRoot(root) {
  if (getStorageRoot() !== root) throw new PaperclipError('Workspace changed; retry this action in its original workspace', 409);
}
async function serial(root, fn) {
  const previous = queues.get(root) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => { assertRoot(root); return fn(); });
  queues.set(root, next);
  try { return await next; }
  finally { if (queues.get(root) === next) queues.delete(root); }
}
function workspace(root) {
  const file = path.join(dir(root), 'workspace.md');
  const existing = read(file);
  if (existing) {
    if (!ID.test(existing.id)) throw new PaperclipError('Paperclip workspace identity is invalid', 409);
    return existing.id;
  }
  const identity = randomUUID();
  writeMd(file, { type: 'paperclip-workspace', id: identity, created: stamp() }, 'Stable identity for outbound worker mappings.\n');
  return identity;
}
function normalizedConfig(value = {}) {
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new PaperclipError('enabled must be true or false');
  const cfg = {
    enabled: value.enabled === true,
    url: url(value.url, true), companyId: id(value.companyId, 'companyId', true),
    agentId: id(value.agentId, 'agentId', true),
  };
  if (cfg.enabled && (!cfg.url || !cfg.companyId || !cfg.agentId)) {
    throw new PaperclipError('Choose a Paperclip URL, company and existing worker before enabling the bridge');
  }
  return cfg;
}
function privateConfig(root = getStorageRoot()) {
  const cfg = normalizedConfig(read(configFile(root)) || {});
  const token = String(process.env.PAPERCLIP_TOKEN || '').trim();
  if (/[\r\n]/.test(token) || (token && token.length < 16)) throw new PaperclipError('PAPERCLIP_TOKEN must be a single-line board token of at least 16 characters');
  return { ...cfg, token };
}
export function paperclipConfig() {
  try {
    const { token, ...cfg } = privateConfig();
    return { ...cfg, tokenConfigured: !!token, ready: cfg.enabled && !!token };
  } catch (e) {
    return { enabled: false, url: '', companyId: '', agentId: '', tokenConfigured: !!process.env.PAPERCLIP_TOKEN, ready: false, error: e.message };
  }
}
export function savePaperclipConfig(patch = {}, { actor = DEFAULT_ACTOR } = {}) {
  human(actor);
  const root = getStorageRoot();
  for (const key of Object.keys(patch)) {
    if (!['enabled', 'url', 'companyId', 'agentId'].includes(key)) throw new PaperclipError('Unknown Paperclip setting: ' + key);
  }
  const cfg = normalizedConfig({ ...(read(configFile(root)) || {}), ...patch });
  writeMd(configFile(root), { type: 'paperclip-config', ...cfg, updated: stamp(), updated_by: actor },
    'Opt-in worker bridge. Credential is PAPERCLIP_TOKEN in the backend environment, never this file.\n');
  logEvent({ type: 'update', actor, target: '.scout/paperclip.md', detail: { enabled: cfg.enabled } });
  return paperclipConfig();
}
function connection(root) {
  const cfg = privateConfig(root);
  if (!cfg.enabled || !cfg.token) throw new PaperclipError('Paperclip is disconnected. Enable the bridge and set PAPERCLIP_TOKEN on the backend', 409);
  return cfg;
}
function configIdentity(cfg) { return hash({ url: cfg.url, companyId: cfg.companyId, agentId: cfg.agentId }); }
function safeText(value, cfg) {
  const settings = getSettings();
  return redact(String(value ?? ''), { secrets: [cfg.token, ...SECRET_SETTING_KEYS.map(key => settings[key])].filter(Boolean) }).value;
}
function publicReceipt(receipt) {
  return { ...receipt, status: receipt.remoteStatus || receipt.state, externalUrl: receipt.externalUrl || '',
    proposalId: receipt.proposalId || receipt.statusProposal || null,
    path: '.scout/paperclip/receipts/' + receipt.key + '.md' };
}
function writeReceipt(root, key, data) {
  assertRoot(root);
  writeMd(receiptFile(root, key), { type: 'paperclip-receipt', version: VERSION, ...data, updated: stamp() },
    'Worker sync receipt. Scout work and goals stay canonical; remote completion is a proposal.\n');
  return data;
}
function receipts(root = getStorageRoot()) {
  let files = [];
  try { files = fs.readdirSync(path.join(dir(root), 'receipts')); } catch { return []; }
  return files.filter(f => f.endsWith('.md') && !f.startsWith('.')).map(f => read(path.join(dir(root), 'receipts', f))).filter(Boolean);
}
export function paperclipDelegation(workId) {
  const matches = receipts().filter(r => r.kind === 'issue' && (r.workId === workId || r.workPath === workId));
  const current = matches.find(r => !TERMINAL.includes(r.state)) || matches.at(-1);
  return current ? publicReceipt(current) : null;
}
export function assertPaperclipWorkAvailable(workId) {
  const receipt = paperclipDelegation(workId);
  if (receipt && !TERMINAL.includes(receipt.state)) {
    throw new PaperclipError('This item is delegated to Paperclip. Cancel or reconcile that delegation before starting local work', 409);
  }
}
export function paperclipStatus() {
  return { config: paperclipConfig(), receipts: receipts().map(publicReceipt) };
}
// Resolve the installed native UI, rather than constructing a second task board in Scout.
// Board credentials stay on this server. The frame uses Paperclip's own browser session (or
// local_trusted mode), and its origin is validated by the same connection configuration.
export async function paperclipUi({ fetchImpl = globalThis.fetch } = {}) {
  const root = getStorageRoot(), cfg = privateConfig(root);
  const result = { configured: !!(cfg.url && cfg.companyId), appUrl: cfg.url || null, boardUrl: null, company: null };
  if (!result.configured) return result;
  let company, error;
  try {
    company = await request(cfg, '/companies/' + encodeURIComponent(cfg.companyId), { fetchImpl });
    if (company?.id !== cfg.companyId || typeof company.issuePrefix !== 'string' || !ID.test(company.issuePrefix)
      || safeText(company.issuePrefix, cfg) !== company.issuePrefix) {
      throw new PaperclipError('Paperclip returned an unexpected company or board address', 502);
    }
  } catch (e) {
    error = e instanceof PaperclipError ? e.message : 'The Paperclip board could not be reached';
  }
  assertRoot(root);
  if (configIdentity(privateConfig(root)) !== configIdentity(cfg)) {
    throw new PaperclipError('Paperclip connection changed; reload the board', 409);
  }
  if (error) return { ...result, error };
  return { ...result, boardUrl: cfg.url + '/' + encodeURIComponent(company.issuePrefix) + '/issues',
    company: { id: cfg.companyId, name: safeText(company.name || company.issuePrefix, cfg).slice(0, 200), prefix: company.issuePrefix } };
}
function source(workId) {
  const items = workItems();
  const item = items.find(it => it.id === workId || it.path === workId);
  if (!item) throw new PaperclipError('No work item: ' + String(workId), 404);
  if (item.archived || item.status !== 'planned') throw new PaperclipError('Only planned work can be delegated; pause or finish active work first', 409);
  const ready = workReadiness(item, items);
  if (!ready.ready) throw new PaperclipError(ready.reason, 409);
  if (!item.goal_id) throw new PaperclipError('Link this work item to a goal before delegating');
  const goal = getGoal(item.goal_id);
  if (!goal) throw new PaperclipError('The linked goal no longer exists', 409);
  const doc = readRecord(item.path);
  if (doc.flags.quarantined || doc.flags.agentPromotion) throw new PaperclipError('Quarantined work cannot be delegated', 409);
  assertLocalWorkAvailable([item.id, item.path]);
  return { item, goal, doc };
}
function packageFor(workId, root, cfg) {
  const { item, goal, doc } = source(workId);
  const identity = workspace(root);
  const projectKey = hash([identity, cfg.url, cfg.companyId, 'goal', item.goal_id]);
  const issueKey = hash([identity, cfg.url, cfg.companyId, 'work', item.id]);
  const projectMarker = '[Scout bridge project ' + projectKey + ']';
  const issueMarker = '[Scout bridge issue ' + issueKey + ']';
  const goalTitle = safeText(goal.data?.title || goal.data?.name || goal.label || goal.id, cfg);
  const project = {
    name: 'Scout: ' + goalTitle.slice(0, 160) + ' (' + projectKey.slice(0, 8) + ')', status: 'planned',
    description: projectMarker + '\n\nScout goal: ' + item.goal_id + '\n' + goalTitle,
  };
  const issue = {
    title: safeText(item.title, cfg).slice(0, 300), status: 'todo', priority: 'medium', assigneeAgentId: cfg.agentId,
    // Packaged Paperclip 2026.1001.0 supports native issue keys and otherwise deduplicates
    // recent open issues by title. Two Scout occurrences with the same title are distinct.
    idempotencyKey: 'scout-' + issueKey, allowDuplicate: true,
    description: [issueMarker, '', 'Scout work: ' + item.id, 'Goal: ' + item.goal_id,
      item.key_result ? 'Key result: ' + safeText(item.key_result, cfg) : '',
      item.destination ? 'Destination: ' + safeText(item.destination, cfg) : '',
      item.done_when ? 'Completion evidence required: ' + safeText(item.done_when, cfg) : '', '',
      'Prepare a result for review. Scout alone approves findings, publishes, changes goals and marks human work done.',
      'No access to Scout files, private memory, API credentials or other collections is granted by this issue.', '', safeText(doc.content, cfg).slice(0, 24000),
    ].filter(line => line !== undefined).join('\n'),
  };
  const payload = { version: VERSION, connection: { url: cfg.url, companyId: cfg.companyId, agentId: cfg.agentId },
    workId: item.id, workPath: item.path, sourceRev: doc.rev, projectKey, projectMarker, project, issueKey, issueMarker, issue };
  return { ...payload, fingerprint: hash(payload) };
}
export function previewPaperclip(workId, { actor = DEFAULT_ACTOR } = {}) {
  human(actor);
  const root = getStorageRoot(), cfg = connection(root);
  const payload = packageFor(workId, root, cfg);
  const baseId = 'paperclip-push-' + payload.fingerprint.slice(0, 32);
  let proposalId = baseId, revision = 0;
  const message = JSON.stringify(payload, null, 2);
  while (getProposal(proposalId)) {
    const existing = getProposal(proposalId);
    const same = existing.kind === 'outbound' && existing.channel === 'paperclip'
      && existing.bridge_hash === payload.fingerprint && existing.message === message;
    let approved = false;
    if (same && existing.status === 'accepted') {
      try { assertApproved(existing, payload); approved = true; } catch { /* obsolete approval needs a fresh review */ }
    }
    if (same && (existing.status === 'open' || approved)) break;
    if (++revision > 100) throw new PaperclipError('Too many review revisions; create a new work item before delegating', 409);
    proposalId = baseId + '-review-' + revision;
  }
  const proposal = propose({ id: proposalId, kind: 'outbound', title: 'Delegate to Paperclip: ' + payload.issue.title,
    why: 'Send this exact goal and work snapshot to the chosen Paperclip worker. Assignment can start a paid worker run.',
    channel: 'paperclip', message, bridge_hash: payload.fingerprint, bridge_work: payload.workId,
    evidence: ['[[' + payload.workPath + ']]'], body: message }, { actor: 'conductor' });
  return { payload, proposal, proposalId, fingerprint: payload.fingerprint, sendsData: false };
}

// Responses and errors never echo external text: servers can accidentally include tokens in errors.
async function request(cfg, route, { method = 'GET', body, fetchImpl = globalThis.fetch, root, guard } = {}) {
  if (guard) guard();
  const response = await fetchImpl(cfg.url + '/api' + route, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { ...(cfg.token ? { authorization: 'Bearer ' + cfg.token } : {}), accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).catch(() => { throw new PaperclipError('Paperclip request failed or timed out; check the connection and reconcile before retrying', 502); });
  if (root) {
    assertRoot(root);
    const current = connection(root);
    if (configIdentity(current) !== configIdentity(cfg)) throw new PaperclipError('Paperclip connection changed during this request; reconcile its outcome', 409);
  }
  if (!response.ok) {
    const error = new PaperclipError('Paperclip refused the request (HTTP ' + response.status + ')', response.status === 409 ? 409 : 502);
    error.remoteStatus = response.status;
    throw error;
  }
  const reader = response.body?.getReader();
  let text = '', bytes = 0;
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024 * 1024) { await reader.cancel(); throw new PaperclipError('Paperclip response exceeds the 1 MiB limit', 502); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  } else text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { throw new PaperclipError('Paperclip returned invalid JSON', 502); }
  return data;
}
function remoteRow(row, cfg, expected = null, marker = null) {
  if (!row || !ID.test(String(row.id)) || row.companyId !== cfg.companyId || (expected && row.id !== expected)
    || (marker && !String(row.description || '').includes(marker))) {
    throw new PaperclipError('Paperclip returned an unexpected identity or company; no local record was changed', 502);
  }
  return row;
}
async function authorize(cfg, options) {
  const principal = await request(cfg, '/cli-auth/me', options);
  if (!Array.isArray(principal?.companyIds) || !principal.companyIds.includes(cfg.companyId)) {
    throw new PaperclipError('Use a board API token authorized for this Paperclip company', 403);
  }
  const worker = remoteRow(await request(cfg, '/agents/' + cfg.agentId, options), cfg, cfg.agentId);
  if (['paused', 'terminated', 'pending_approval'].includes(worker.status)) throw new PaperclipError('The Paperclip worker is ' + worker.status, 409);
}
async function ensureRemote(root, cfg, payload, kind, options) {
  const key = kind === 'project' ? payload.projectKey : payload.issueKey;
  const marker = kind === 'project' ? payload.projectMarker : payload.issueMarker;
  const existing = read(receiptFile(root, key));
  if (existing?.remoteId) return existing;
  if (existing?.state === 'cancelled') throw new PaperclipError('This export was cancelled; create a new work item to delegate again', 409);
  const listRoute = '/companies/' + cfg.companyId + (kind === 'project' ? '/projects?includeArchived=true'
    : '/issues?q=' + encodeURIComponent(marker) + '&limit=500&includeRoutineExecutions=true');
  const listed = await request(cfg, listRoute, options);
  if (!Array.isArray(listed)) throw new PaperclipError('Paperclip returned an unexpected list format', 502);
  const matched = listed.filter(row => String(row.description || '').includes(marker));
  if (matched.length > 1) throw new PaperclipError('More than one Paperclip object has this Scout marker; reconcile the duplicates before continuing', 409);
  const base = { key, kind, workId: kind === 'issue' ? payload.workId : '', workPath: kind === 'issue' ? payload.workPath : '',
    goalKey: payload.projectKey, connection: configIdentity(cfg), companyId: cfg.companyId,
    sourceRev: payload.sourceRev, approvedHash: payload.fingerprint, marker,
    title: kind === 'issue' ? payload.issue.title : payload.project.name,
    externalUrl: '', created: existing?.created || stamp() };
  if (matched.length) {
    const row = remoteRow(matched[0], cfg);
    return writeReceipt(root, key, { ...base, remoteId: row.id, externalUrl: cfg.url + '/' + (kind === 'issue' ? 'issues/' : 'projects/') + row.id,
      state: kind === 'issue' ? 'delegated' : 'reserved' });
  }
  // Projects have no native key. Issues use the current API's key as extra protection, while
  // both kinds reconcile an unknown POST by marker instead of silently resending approved data.
  if (existing && ['creating', 'unknown'].includes(existing.state)) throw new PaperclipError('Creation outcome is unknown. Find the Scout marker in Paperclip; retry only after it is visible', 409);
  writeReceipt(root, key, { ...base, state: 'creating' });
  try {
    const body = kind === 'project' ? payload.project : { ...payload.issue, projectId: payload.remoteProjectId };
    const row = remoteRow(await request(cfg, '/companies/' + cfg.companyId + (kind === 'project' ? '/projects' : '/issues'),
      { ...options, method: 'POST', body }), cfg, null, marker);
    return writeReceipt(root, key, { ...base, remoteId: row.id, externalUrl: cfg.url + '/' + (kind === 'issue' ? 'issues/' : 'projects/') + row.id,
      state: kind === 'issue' ? 'delegated' : 'reserved' });
  } catch (e) {
    const definitelyRefused = [400, 401, 403, 404, 409, 422, 429].includes(e.remoteStatus);
    writeReceipt(root, key, { ...base, state: definitelyRefused ? 'reserved' : 'unknown' });
    throw e;
  }
}
function assertApproved(card, payload) {
  if (!card || card.kind !== 'outbound' || card.status !== 'accepted' || card.channel !== 'paperclip'
    || !String(card.approved_by || '').trim() || !String(card.decided_by || '').trim()
    || isAgentActor(card.approved_by) || isAgentActor(card.decided_by)
    || card.approved_by !== card.decided_by || (card.updated_by && isAgentActor(card.updated_by))
    || card.approved_content_hash !== outboundApprovalFingerprint(card)
    || card.bridge_hash !== payload.fingerprint || card.message !== JSON.stringify(payload, null, 2)) {
    throw new PaperclipError('Approve the current Paperclip export in Needs you before sending. Changed work or connection needs a new preview', 409);
  }
}
export async function pushPaperclip(workId, { proposalId, actor = DEFAULT_ACTOR, fetchImpl = globalThis.fetch } = {}) {
  human(actor);
  const root = getStorageRoot();
  return serial(root, async () => {
    const cfg = connection(root), payload = packageFor(workId, root, cfg);
    const card = getProposal(id(proposalId, 'proposalId'));
    assertApproved(card, payload);
    const existing = read(receiptFile(root, payload.issueKey));
    if (existing?.remoteId) return { pushed: false, duplicate: true, receipt: publicReceipt(existing) };
    const other = receipts(root).find(r => r.kind === 'issue' && r.workId === payload.workId
      && r.key !== payload.issueKey && !TERMINAL.includes(r.state));
    if (other) throw new PaperclipError('This work is already delegated through another connection; cancel that delegation first', 409);
    withWorkAssignmentLock(payload.workId, () => {
      assertLocalWorkAvailable([payload.workId, payload.workPath]);
      if (!existing) writeReceipt(root, payload.issueKey, { key: payload.issueKey, kind: 'issue', workId: payload.workId,
        workPath: payload.workPath, title: payload.issue.title, state: 'reserved', companyId: cfg.companyId,
        connection: configIdentity(cfg), sourceRev: payload.sourceRev, approvedHash: payload.fingerprint,
        marker: payload.issueMarker, proposalId, created: stamp() });
    });
    const options = { fetchImpl, root, guard: () => {
      assertApproved(getProposal(proposalId), payload);
      if (packageFor(workId, root, cfg).fingerprint !== payload.fingerprint) {
        throw new PaperclipError('Work changed during the export. Preview and approve the updated snapshot', 409);
      }
    } };
    await authorize(cfg, options);
    const project = await ensureRemote(root, cfg, payload, 'project', options);
    const delegated = await ensureRemote(root, cfg, { ...payload, remoteProjectId: project.remoteId }, 'issue', options);
    const receipt = writeReceipt(root, delegated.key, { ...delegated, proposalId });
    logEvent({ type: 'run', actor, target: payload.workPath, detail: { phase: 'paperclip-delegated', issueId: receipt.remoteId, proposalId } });
    return { pushed: true, receipt: publicReceipt(receipt) };
  });
}
function linked(workId, root) {
  const cfg = connection(root);
  const matches = receipts(root).filter(r => r.kind === 'issue' && (r.workId === workId || r.workPath === workId));
  const receipt = matches.find(r => r.connection === configIdentity(cfg));
  if (!receipt && matches.length) throw new PaperclipError('This delegation belongs to another connection. Restore its URL, company and worker to sync it', 409);
  if (!receipt?.remoteId) throw new PaperclipError('No confirmed Paperclip delegation for this item', 404);
  if (receipt.connection !== configIdentity(cfg)) throw new PaperclipError('This delegation belongs to another connection. Restore its URL, company and worker to sync it', 409);
  return { cfg, receipt };
}
const RESULT_SCHEMA = {
  id: 'paperclip-result', label: 'Paperclip results', query: { tag: 'paperclip-result', path: 'data/paperclip-result/**' },
  fields: [{ key: 'title', type: 'text', primary: true, required: true },
    { key: 'status', type: 'status', gate: true, options: ['found', 'shortlist', 'accepted', 'archived'] },
    { key: 'source_work', type: 'text' }, { key: 'paperclip_issue', type: 'text' }, { key: 'paperclip_comment', type: 'text' },
    { key: 'paperclip_run', type: 'text' }, { key: 'paperclip_source_hash', type: 'text' },
    { key: 'goal_id', type: 'text' }, { key: 'project', type: 'text' }, { key: 'universe', type: 'text' }, { key: 'evidence', type: 'text' }],
};
function importResult(receipt, comment, cfg) {
  const collection = getCollection(RESULT_SCHEMA.id);
  if (!collection) saveCollection(RESULT_SCHEMA);
  else for (const field of RESULT_SCHEMA.fields) {
    if (!(collection.fields || []).some(existing => existing.key === field.key)) addField(RESULT_SCHEMA.id, field);
  }
  const recordId = 'pc-' + hash([receipt.key, comment.id]).slice(0, 40);
  const issueLink = cfg.url + '/issues/' + receipt.remoteId;
  const rawBody = String(comment.body || '');
  // The first line is a machine reconciliation marker, not part of the person's draft.
  // Keep its original source fingerprint and native attribution in metadata instead.
  const body = rawBody.replace(/^\[Scout worker result [a-f0-9]{64}\]\r?\n(?:\r?\n)?/, '');
  let membership = {};
  try {
    const source = readRecord(receipt.workPath);
    if (source.rev === receipt.sourceRev) membership = Object.fromEntries(['goal_id', 'project', 'universe']
      .filter(field => typeof source.data[field] === 'string' && source.data[field].trim())
      .map(field => [field, source.data[field]]));
  } catch { /* Unavailable or changed source needs the owner to assign its membership. */ }
  const result = upsertRecord({ collection: RESULT_SCHEMA.id, id: recordId,
    title: 'Paperclip draft: ' + safeText(receipt.title || receipt.workId, cfg).slice(0, 240),
    source_work: receipt.workId, paperclip_issue: receipt.remoteId, paperclip_comment: String(comment.id),
    paperclip_source_hash: hash(rawBody), ...(comment.createdByRunId ? { paperclip_run: String(comment.createdByRunId) } : {}),
    ...membership,
    evidence: issueLink, body: safeText(body, cfg).slice(0, 32000) + '\n\nSource: ' + issueLink,
  }, { actor: 'paperclip', via: 'paperclip-pull' });
  return { ...result, commentId: String(comment.id) };
}
export async function pullPaperclip(workId, { actor = DEFAULT_ACTOR, fetchImpl = globalThis.fetch } = {}) {
  human(actor);
  const root = getStorageRoot();
  return serial(root, async () => {
    const { cfg, receipt } = linked(workId, root), options = { fetchImpl, root };
    const issue = remoteRow(await request(cfg, '/issues/' + receipt.remoteId, options), cfg, receipt.remoteId, receipt.marker);
    if (!['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'].includes(issue.status)) {
      throw new PaperclipError('Paperclip issue status is unsupported', 502);
    }
    let cursor = receipt.commentCursor || '', imported = [], pages = 0;
    while (pages++ < 10) {
      const beforePage = cursor;
      const comments = await request(cfg, '/issues/' + receipt.remoteId + '/comments?order=asc&limit=100'
        + (cursor ? '&after=' + encodeURIComponent(cursor) : ''), options);
      if (!Array.isArray(comments)) throw new PaperclipError('Paperclip returned an unexpected comment list', 502);
      for (const comment of comments) {
        if (!ID.test(String(comment.id)) || (comment.issueId && comment.issueId !== receipt.remoteId)) {
          throw new PaperclipError('Paperclip comment identity is invalid', 502);
        }
        // Some deployed versions include the anchor because PostgreSQL timestamps have
        // finer precision than the JavaScript Date used by their cursor query.
        if (String(comment.id) === beforePage) continue;
        // Each remote message is untrusted evidence, never a patch to the work record or memory.
        if (String(comment.body || '').trim()) {
          const result = importResult(receipt, comment, cfg);
          if (result.verdict !== 'skip') imported.push(result);
        }
        cursor = String(comment.id);
        writeReceipt(root, receipt.key, { ...receipt, commentCursor: cursor });
      }
      if (comments.length < 100 || cursor === beforePage) break;
    }
    const state = TERMINAL.includes(issue.status) ? issue.status : ['blocked', 'in_review'].includes(issue.status) ? issue.status : 'delegated';
    let proposalId = receipt.statusProposal || null;
    if (['blocked', 'in_review', 'done'].includes(issue.status) && (receipt.remoteStatus !== issue.status || !proposalId)) {
      const cardId = 'paperclip-state-' + hash([receipt.key, issue.status, issue.updatedAt || '']).slice(0, 32);
      const card = propose({ id: cardId, kind: 'question', title: 'Paperclip ' + issue.status + ': ' + receipt.workId,
        why: 'The external worker reported ' + issue.status + '. Check its proposed results before changing Scout work.',
        question: issue.status === 'done' ? 'What result is accepted as completion evidence? Mark Done in Today after review.'
          : 'What should the Paperclip worker do next?', evidence: [cfg.url + '/issues/' + receipt.remoteId],
        source_work: receipt.workId, body: 'External status: ' + issue.status + '\n\nScout work has not changed.' }, { actor: 'paperclip' });
      proposalId = card.id;
    }
    const next = writeReceipt(root, receipt.key, { ...receipt, state, remoteStatus: issue.status, commentCursor: cursor,
      lastPulled: stamp(), ...(proposalId ? { statusProposal: proposalId } : {}) });
    logEvent({ type: 'run', actor: 'paperclip', target: receipt.workPath,
      detail: { phase: 'paperclip-pulled', state, imported: imported.length, proposalId } });
    return { receipt: publicReceipt(next), imported, proposalId, more: pages > 10 };
  });
}
export async function cancelPaperclip(workId, { reason, actor = DEFAULT_ACTOR, fetchImpl = globalThis.fetch } = {}) {
  human(actor);
  const explanation = String(reason || '').trim();
  if (!explanation || explanation.length > 2000) throw new PaperclipError('Cancellation requires a reason of 1–2000 characters');
  const root = getStorageRoot();
  return serial(root, async () => {
    const local = paperclipDelegation(workId);
    if (local && !local.remoteId && local.state === 'reserved') {
      const reasonSafe = safeText(explanation, privateConfig(root));
      const next = writeReceipt(root, local.key, { ...local, state: 'cancelled', reason: reasonSafe, cancelled_at: stamp() });
      logEvent({ type: 'run', actor, target: local.workPath, detail: { phase: 'paperclip-cancelled-before-create', reason: reasonSafe } });
      return { cancelled: true, receipt: publicReceipt(next) };
    }
    const { cfg, receipt } = linked(workId, root), options = { fetchImpl, root };
    if (receipt.state === 'cancelled') return { cancelled: true, duplicate: true, receipt: publicReceipt(receipt) };
    const safeReason = safeText(explanation, cfg);
    await authorize(cfg, options);
    const current = remoteRow(await request(cfg, '/issues/' + receipt.remoteId, options), cfg, receipt.remoteId, receipt.marker);
    if (current.status === 'done') {
      const finished = writeReceipt(root, receipt.key, { ...receipt, state: 'done', remoteStatus: 'done' });
      return { cancelled: false, finished: true, receipt: publicReceipt(finished) };
    }
    // Closing an issue retires pending approvals and queued issue work in Paperclip. The
    // board-only interrupt comment requests cancellation of any active run as well.
    const row = current.status === 'cancelled' ? current : remoteRow(await request(cfg, '/issues/' + receipt.remoteId, { ...options, method: 'PATCH',
      body: { status: 'cancelled', comment: 'Scout cancelled delegation: ' + safeReason } }), cfg, receipt.remoteId, receipt.marker);
    await request(cfg, '/issues/' + receipt.remoteId + '/comments', { ...options, method: 'POST',
      body: { body: 'Scout cancellation: ' + safeReason, interrupt: true } });
    if (row.status !== 'cancelled') throw new PaperclipError('Paperclip did not confirm cancellation', 502);
    const next = writeReceipt(root, receipt.key, { ...receipt, state: 'cancelled', remoteStatus: 'cancelled', cancelled_at: stamp(), reason: safeReason });
    logEvent({ type: 'run', actor, target: receipt.workPath, detail: { phase: 'paperclip-cancelled', issueId: receipt.remoteId, reason: safeReason } });
    return { cancelled: true, receipt: publicReceipt(next) };
  });
}

export function registerPaperclipRoutes(app) {
  const actor = req => String(req.body?.actor || DEFAULT_ACTOR);
  const wrap = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 400).json({ error: e instanceof PaperclipError || e instanceof TaskError ? e.message : 'Paperclip action failed; check the connection and metadata' }); }
  };
  app.get('/api/paperclip', wrap(() => paperclipStatus()));
  app.get('/api/paperclip/ui', wrap(() => paperclipUi()));
  app.get('/api/paperclip/config', wrap(() => paperclipConfig()));
  app.put('/api/paperclip/config', wrap(req => {
    const { actor: _, ...patch } = req.body || {};
    return savePaperclipConfig(patch, { actor: actor(req) });
  }));
  app.post('/api/paperclip/preview', wrap(req => previewPaperclip(req.body?.workId, { actor: actor(req) })));
  app.post('/api/paperclip/push', wrap(req => pushPaperclip(req.body?.workId, { proposalId: req.body?.proposalId, actor: actor(req) })));
  app.post('/api/paperclip/:workId/pull', wrap(req => pullPaperclip(req.params.workId, { actor: actor(req) })));
  app.post('/api/paperclip/:workId/cancel', wrap(req => cancelPaperclip(req.params.workId, { reason: req.body?.reason, actor: actor(req) })));
}
