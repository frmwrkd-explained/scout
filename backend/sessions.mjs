// Persistent review sessions (Phase 5). A session is the durable state of an Inbox pass — its
// filter, the ordered candidate keys, the cursor, decisions and reviewed spend — stored as one
// portable markdown file so the exact review position survives Escape, navigation, reload and a
// full app restart. sessions/review/<session-id>.md
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safe } from './store.mjs';

const dir = () => path.join(getStorageRoot(), 'sessions', 'review');
const sessionMd = id => path.join(dir(), safe(id) + '.md');

const FIELDS = ['id', 'created', 'updated', 'status', 'query', 'candidateKeys', 'cursor', 'selectedKeys', 'decisions', 'reviewedSpend', 'projectGrouping'];

export function listSessions() {
  const d = dir();
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => { try { return readMd(path.join(d, f)).data; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export function getSession(id) {
  try { return readMd(sessionMd(id)).data; } catch { return null; }
}

// Upsert — create when new, otherwise merge the patch over the stored record. Only whitelisted
// fields are persisted (never arbitrary client data).
export function saveSession(patch = {}) {
  const id = patch.id || ('rv-' + Date.now());
  const prev = getSession(id) || { id, created: Date.now(), status: 'active', candidateKeys: [], cursor: 0, selectedKeys: [], decisions: {}, reviewedSpend: 0, projectGrouping: true, query: '' };
  const next = { ...prev };
  for (const k of FIELDS) if (patch[k] !== undefined) next[k] = patch[k];
  next.id = id;
  next.updated = Date.now();
  next.updatedAt = stamp();
  writeMd(sessionMd(id), next, '## Review session\n\n' + (next.status || 'active') + ' — ' + (next.candidateKeys || []).length + ' candidates, cursor ' + (next.cursor || 0) + '\n');
  return next;
}

export function deleteSession(id) {
  fs.rmSync(sessionMd(id), { force: true });
  return true;
}
