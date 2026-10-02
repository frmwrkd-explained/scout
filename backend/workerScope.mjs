// Worker membership and server-issued run credentials. Actor strings remain provenance;
// scoped authorization comes from this server's opaque, revocable run identity.
// This boundary protects Scout's API and prompts. It is not a host filesystem sandbox.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getStorageRoot, readMd, writeMd, revOf } from './store.mjs';
import { getCollection, listCollections } from './collections.mjs';
import { allDocuments, matchesQuery } from './documents.mjs';
import { isAgentActor, DEFAULT_ACTOR } from './actors.mjs';
import { logEvent } from './log.mjs';

export class WorkerScopeError extends Error {
  constructor(message, status = 403) { super(message); this.name = 'WorkerScopeError'; this.status = status; }
}
const scope = new AsyncLocalStorage();
const runs = new Map();
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const root = () => path.resolve(getStorageRoot());
const policyDir = () => path.join(root(), '.scout', 'worker-policies');
const policyPath = id => path.join(policyDir(), cleanId(id) + '.md');
const digest = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function cleanId(id) {
  if (!ID.test(String(id || ''))) throw new WorkerScopeError('worker id must be a slug', 400);
  return String(id);
}
function names(value, label) {
  if (!Array.isArray(value)) throw new WorkerScopeError(label + ' must be an explicit list', 400);
  return [...new Set(value.map(v => cleanId(v)))];
}
function universeNames(value) {
  if (!Array.isArray(value)) throw new WorkerScopeError('universes must be an explicit list', 400);
  return [...new Set(value.map(v => {
    const s = String(v || '');
    const id = s.startsWith('unit/') ? s.slice(5) : s;
    cleanId(id);
    return s;
  }))];
}
function memoryPaths(value, label) {
  if (!Array.isArray(value)) throw new WorkerScopeError(label + ' must be an explicit list', 400);
  return [...new Set(value.map(v => {
    const s = String(v || '');
    if (!/^(me\.md|(?:goals|playbook|learnings|territory)\/[a-zA-Z0-9_-]+\.md)$/.test(s)) {
      throw new WorkerScopeError(label + ' contains an unsupported memory path', 400);
    }
    return s;
  }))];
}

export function hasWorkerPolicy(assistantId) {
  try { return fs.existsSync(policyPath(assistantId)); } catch { return false; }
}
export function getWorkerPolicy(assistantId) {
  const id = cleanId(assistantId);
  if (!hasWorkerPolicy(id)) return null;
  try {
    const { data } = readMd(policyPath(id));
    return normalizePolicy(id, data);
  } catch (e) {
    if (e instanceof WorkerScopeError) throw e;
    throw new WorkerScopeError('worker membership cannot be read; access is denied');
  }
}
function normalizePolicy(id, data = {}) {
  const read = names(data.collections?.read || [], 'collections.read');
  const write = names(data.collections?.write || [], 'collections.write');
  const memoryRead = memoryPaths(data.memory?.read || [], 'memory.read');
  const memoryWrite = memoryPaths(data.memory?.write || [], 'memory.write');
  if (write.some(v => !read.includes(v)) || memoryWrite.some(v => !memoryRead.includes(v))) {
    throw new WorkerScopeError('write membership must also have read membership', 400);
  }
  return {
    assistantId: id, enabled: data.enabled !== false,
    universes: universeNames(data.universes || []),
    projects: names(data.projects || [], 'projects'),
    collections: { read, write }, memory: { read: memoryRead, write: memoryWrite },
    finance: data.finance === true,
  };
}
export function saveWorkerPolicy(assistantId, data, { actor = DEFAULT_ACTOR } = {}) {
  if (currentWorkerIdentity() || isAgentActor(actor)) throw new WorkerScopeError('only the local owner changes worker membership');
  const id = cleanId(assistantId);
  if (!fs.existsSync(path.join(root(), 'assistants', id + '.md'))) throw new WorkerScopeError('create the assistant before setting its membership', 404);
  const next = normalizePolicy(id, data);
  for (const cid of next.collections.read) if (!getCollection(cid)) throw new WorkerScopeError('no collection "' + cid + '"', 400);
  writeMd(policyPath(id), next, 'Explicit worker membership. Credentials are held only by the running server.\n');
  revokeWorkerRun({ assistantId: id });
  logEvent({ type: 'update', actor, target: '.scout/worker-policies/' + id + '.md', detail: { worker_membership: true } });
  return next;
}
export function listWorkerPolicies() {
  let files = [];
  try { files = fs.readdirSync(policyDir()).filter(f => !f.startsWith('.') && f.endsWith('.md')); } catch { return []; }
  return files.map(f => getWorkerPolicy(f.slice(0, -3)));
}
const policyStamp = id => {
  const { data, content } = readMd(policyPath(id));
  return revOf(data, content);
};

export function issueWorkerRun({ assistantId, runId, project = null, ttlMs = 30 * 60_000 } = {}) {
  if (currentWorkerIdentity()) throw new WorkerScopeError('a worker cannot issue another run identity');
  const id = cleanId(assistantId);
  const policy = getWorkerPolicy(id);
  if (!policy?.enabled) throw new WorkerScopeError('this worker has no enabled membership');
  if (project && !policy.projects.includes(String(project))) throw new WorkerScopeError('project is outside worker membership');
  if (!String(runId || '').trim()) throw new WorkerScopeError('a server run id is required', 400);
  const duration = Number(ttlMs);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60_000) throw new WorkerScopeError('run identity lifetime must be between 1ms and 24h', 400);
  const token = crypto.randomBytes(32).toString('base64url');
  const entry = {
    key: digest(token), root: root(), stamp: policyStamp(id), policy,
    identity: Object.freeze({ actor: id, runId: String(runId), project: project ? String(project) : null,
      expiresAt: new Date(Date.now() + duration).toISOString(), policyId: id }),
  };
  runs.set(entry.key, entry);
  return { token, identity: entry.identity, headers: { Authorization: 'Bearer ' + token }, revoke: () => runs.delete(entry.key) };
}
function validateEntry(entry) {
  if (!entry || !runs.has(entry.key)) throw new WorkerScopeError('worker run identity is missing or revoked', 401);
  let valid = entry.root === root() && Date.parse(entry.identity.expiresAt) > Date.now();
  try { valid = valid && entry.stamp === policyStamp(entry.identity.actor) && getWorkerPolicy(entry.identity.actor)?.enabled; }
  catch { valid = false; }
  if (!valid) { runs.delete(entry.key); throw new WorkerScopeError('worker run identity expired or membership/workspace changed', 401); }
  return entry;
}
export function currentWorkerIdentity() {
  const entry = scope.getStore();
  return entry ? validateEntry(entry).identity : null;
}
export function withWorkerIdentity(token, fn) {
  const entry = validateEntry(runs.get(digest(token)));
  return scope.run(entry, fn);
}
// Trusted server maintenance must not inherit a request credential into a later timer.
export function outsideWorkerIdentity(fn) { return scope.exit(fn); }
export function revokeWorkerRun({ runId = null, assistantId = null } = {}) {
  let revoked = 0;
  for (const [key, entry] of runs) {
    if (entry.root !== root()) continue;
    if (runId != null && entry.identity.runId !== String(runId)) continue;
    if (assistantId != null && entry.identity.actor !== String(assistantId)) continue;
    runs.delete(key); revoked++;
  }
  return { revoked };
}
function activePolicy(actor = null) {
  const entry = scope.getStore();
  if (entry) {
    validateEntry(entry);
    if (actor != null && String(actor) !== entry.identity.actor) throw new WorkerScopeError('actor does not match the server-issued run identity');
    return entry.policy;
  }
  if (actor != null && hasWorkerPolicy(actor)) throw new WorkerScopeError('this worker needs a server-issued run identity', 401);
  return null;
}
export function workerProjectAllowed(assistantId, project) {
  const policy = getWorkerPolicy(assistantId);
  return policy ? policy.enabled && !!project && policy.projects.includes(String(project)) : true;
}
export function assertWorkerDispatchAllowed(assistant, { toolsScoped = false, textOnly = false } = {}) {
  const policy = getWorkerPolicy(assistant?.id);
  if (!policy) return true;
  if (!policy.enabled) throw new WorkerScopeError('worker membership is disabled');
  if (!toolsScoped && !textOnly) throw new WorkerScopeError('restricted workers require text-only preparation or a runtime that enforces scoped tools; the local CLI has unrestricted filesystem access');
  return true;
}

function canonicalPath(value) {
  const s = String(value || '').replaceAll('\\', '/');
  if (!s || path.isAbsolute(s) || s.split('/').some(p => !p || p === '.' || p === '..')) throw new WorkerScopeError('path is outside worker membership');
  const abs = path.resolve(root(), s);
  if (!abs.startsWith(root() + path.sep)) throw new WorkerScopeError('path is outside worker membership');
  // A symlink inside an allowed collection must not become a door into another universe.
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== root()) probe = path.dirname(probe);
  try {
    const realRoot = fs.realpathSync(root()), real = fs.realpathSync(probe);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new WorkerScopeError('path resolves outside worker membership');
    const relativeReal = path.relative(realRoot, real).split(path.sep).join('/');
    const relativeProbe = path.relative(root(), probe).split(path.sep).join('/');
    if (relativeReal !== relativeProbe) throw new WorkerScopeError('worker record paths may not follow symlinks');
  } catch (e) { if (e instanceof WorkerScopeError) throw e; throw new WorkerScopeError('worker path cannot be verified'); }
  return s;
}
export function isProtectedFinance(data = {}, relPath = '', collection = null) {
  const labels = [data.sensitivity, data.access, data.classification, data.universe,
    collection?.sensitivity, collection?.access, collection?.classification,
    ...[].concat(data.tags || [])].map(v => String(v || '').toLowerCase());
  return labels.some(v => ['finance', 'financial', 'restricted-finance'].includes(v)
      || /^unit\/(finance|financial|payroll|invoices)([._-]|$)/.test(v))
    || /(^|\/)(finance|financial|payroll|invoices)(\/|[._-]|$)/i.test(relPath)
    || /^(finance|financial|payroll|invoices)([._-]|$)/i.test(collection?.id || '');
}
function membershipAllows(policy, doc, collection, operation = 'read') {
  if (!policy.enabled) return false;
  const p = canonicalPath(doc.path);
  const data = doc.data || doc.fields || {};
  if (!policy.finance && isProtectedFinance(data, p, collection)) return false;
  if (!policy.universes.includes(String(data.universe || 'local'))) return false;
  if (data.project && !policy.projects.includes(String(data.project))) return false;
  if (p.startsWith('data/')) return !!collection && policy.collections[operation].includes(collection.id);
  return policy.memory[operation].includes(p);
}
export function workerCanReadDocument(doc, collection = null) {
  const policy = activePolicy();
  if (!policy) return true;
  try { return membershipAllows(policy, doc, collection, 'read'); } catch { return false; }
}
export function assertWorkerRecordAccess({ actor = null, path: relPath, collection = null, data = {}, operation = 'read' } = {}) {
  const policy = activePolicy(actor);
  if (!policy) return true;
  if (!membershipAllows(policy, { path: relPath, data }, collection, operation)) throw new WorkerScopeError(operation + ' is outside worker membership');
  return true;
}
export function assertWorkerCollectionAccess(collectionId, { operation = 'read', actor = null } = {}) {
  const policy = activePolicy(actor);
  if (policy && !policy.collections[operation].includes(String(collectionId))) throw new WorkerScopeError(operation + ' is outside worker membership');
  return true;
}
export function assertWorkerMemoryAccess(relPath, { actor = null, data = null, operation = 'read' } = {}) {
  const policy = activePolicy(actor);
  if (!policy) return true;
  let fields = data;
  if (fields == null) { try { fields = readMd(path.join(root(), canonicalPath(relPath))).data; } catch { fields = {}; } }
  return assertWorkerRecordAccess({ actor, path: relPath, data: fields, operation });
}
export function assertWorkerMemoryMutation(relPath, patch = {}, { actor = null } = {}) {
  if (!activePolicy(actor)) return true;
  const rel = canonicalPath(relPath);
  const file = path.join(root(), rel);
  let existing = {};
  if (fs.existsSync(file)) {
    existing = readMd(file).data;
    assertWorkerMemoryAccess(rel, { actor, data: existing, operation: 'write' });
  }
  return assertWorkerMemoryAccess(rel, { actor, data: { ...existing, ...patch }, operation: 'write' });
}

// Raw fields only. Relation values pointing at excluded collections and every derived field
// are omitted: the ordinary view resolver computes rollups against the entire owner store.
export function projectWorkerDocument(doc, collection, policy = activePolicy()) {
  const data = { ...(doc.data || doc.fields || {}) };
  if (policy) for (const f of collection?.fields || []) {
    if (['rollup', 'formula', 'file'].includes(f.type)
      || (f.type === 'relation' && !policy.collections.read.includes(String(f.target)))) delete data[f.key];
  }
  return { path: doc.path, data, content: String(doc.content || ''), collection: collection?.id || null };
}
function projectedDocuments(policy) {
  const collections = listCollections();
  const out = [];
  for (const doc of allDocuments()) {
    const collection = collections.find(c => matchesQuery(doc, c.query)) || null;
    try {
      if (doc.data?.quarantined || doc.data?.archived || !membershipAllows(policy, doc, collection)) continue;
      out.push(projectWorkerDocument(doc, collection, policy));
    } catch { /* denied or malformed paths are absent */ }
  }
  return out;
}
export function projectWorkerPrompt({ assistantId = null, project = null, tokenBudget = 2000 } = {}) {
  const current = activePolicy();
  const policy = current || getWorkerPolicy(assistantId);
  if (!policy?.enabled) throw new WorkerScopeError('worker membership is required for a scoped prompt');
  if (current && assistantId && current.assistantId !== String(assistantId)) throw new WorkerScopeError('another worker membership cannot be requested');
  if (project && !policy.projects.includes(String(project))) throw new WorkerScopeError('project is outside worker membership');
  const max = Math.max(1, Math.min(2000, Number(tokenBudget) || 2000)) * 4;
  const header = '# Scoped Scout context\nWorker: ' + policy.assistantId + '\nUniverses: ' + policy.universes.join(', ') + '\n'
    + (project ? 'Project: ' + project + '\n' : '')
    + 'Only the documents below are in this worker membership. External actions require the human decision gate.\n';
  const chunks = [header];
  let used = header.length;
  for (const doc of projectedDocuments(policy)) {
    if (project && doc.data.project && String(doc.data.project) !== String(project)) continue;
    const section = '\n## ' + doc.path + '\n' + JSON.stringify(doc.data) + '\n' + doc.content + '\n';
    if (used + section.length > max) continue;
    chunks.push(section); used += section.length;
  }
  return chunks.join('').slice(0, max);
}

// Register before every existing API route, after express.json(). Scoped routes have a small
// allowlist. Owner aggregates, arbitrary files and the unscoped cache never pass this guard.
export function registerWorkerScope(app) {
  app.use('/api', (req, res, next) => {
    try {
      const raw = String(req.headers.authorization || '');
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(raw)?.[1];
      const claimed = req.body?.actor || req.query?.actor;
      if (raw && !token) throw new WorkerScopeError('invalid worker run identity', 401);
      if (!token) {
        if (claimed && hasWorkerPolicy(claimed)) throw new WorkerScopeError('this worker needs a server-issued run identity', 401);
        return next(); // the local owner's existing UI contract remains intact
      }
      return withWorkerIdentity(token, () => {
        const identity = currentWorkerIdentity();
        if ([req.body?.actor, req.query?.actor].some(v => v && String(v) !== identity.actor)) throw new WorkerScopeError('actor does not match the server-issued run identity');
        if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) req.body.actor = identity.actor;
        req.workerIdentity = identity;
        const endpoint = req.originalUrl.split('?')[0];
        if (req.method === 'GET' && ['/api/context', '/api/worker/context'].includes(endpoint)) {
          const text = projectWorkerPrompt({ assistantId: identity.actor, project: req.query.project || identity.project });
          if (req.query.format === 'json') return res.json({ text, tokens: Math.ceil(text.length / 4), budget: 2000, scoped: true, worker: identity.actor });
          return res.type('text/markdown').send(text);
        }
        if (req.method === 'GET' && endpoint === '/api/worker/identity') return res.json({ identity });
        if (req.method === 'GET' && endpoint === '/api/collections') {
          const policy = activePolicy();
          return res.json({ collections: listCollections().filter(c => policy.collections.read.includes(c.id)).map(c => ({ id: c.id, label: c.label })) });
        }
        if (req.method === 'GET' && /^\/api\/collections\/[^/]+\/documents$/.test(endpoint)) {
          const id = decodeURIComponent(endpoint.split('/')[3]);
          assertWorkerCollectionAccess(id);
          const rows = projectedDocuments(activePolicy()).filter(d => d.collection === id);
          return res.json({ collection: { id }, total: rows.length, rows, quarantined: [], scoped: true });
        }
        if (req.method === 'GET' && endpoint === '/api/document') {
          const rel = canonicalPath(req.query.path);
          const doc = projectedDocuments(activePolicy()).find(d => d.path === rel);
          if (!doc) throw new WorkerScopeError('read is outside worker membership');
          return res.json(doc);
        }
        if (req.method === 'GET' && endpoint === '/api/records') return next();
        if (req.method === 'POST' && ['/api/records/upsert', '/api/records/batch', '/api/records/match', '/api/records/move', '/api/records/archive'].includes(endpoint)) return next();
        if (req.method === 'POST' && /^\/api\/records\/[^/]+\/(move|archive)$/.test(endpoint)) return next();
        // The worker route verifies this wake belongs to identity.runId before accepting a beat.
        if (req.method === 'POST' && /^\/api\/workers\/wakes\/[^/]+\/heartbeat$/.test(endpoint)) return next();
        if (req.method === 'PATCH' && endpoint === '/api/records') return next();
        throw new WorkerScopeError('this endpoint is outside worker membership');
      });
    } catch (e) {
      res.status(e.status || 403).json({ error: e.message });
    }
  });
  app.get('/api/worker-policies', (_req, res) => {
    try { res.json({ policies: listWorkerPolicies() }); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
  app.get('/api/worker-policies/:id', (req, res) => {
    try { const policy = getWorkerPolicy(req.params.id); if (!policy) throw new WorkerScopeError('no worker membership', 404); res.json({ policy }); }
    catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
  app.put('/api/worker-policies/:id', (req, res) => {
    try { res.json({ policy: saveWorkerPolicy(req.params.id, req.body?.policy || req.body || {}, { actor: req.body?.actor || DEFAULT_ACTOR }) }); }
    catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
  return app;
}
