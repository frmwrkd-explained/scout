// Append-only action journal (Phase 3C). Every user-facing mutation writes one portable record
// under <root>/actions/YYYY-MM-DD/<action-id>.md so the app has a durable, human-readable history
// that survives restart and powers undo. This is NOT a transaction/undo system built on Git — it
// is a plain markdown log. Secrets are never written here (callers pass only field-level diffs).
import path from 'path';
import fs from 'fs';
import { getStorageRoot, writeMd, readMd, stamp } from './store.mjs';

const actionsRoot = () => path.join(getStorageRoot(), 'actions');
let seq = 0;

// keys whose values must never be persisted to the journal even if a caller passes them by mistake
const SECRET_KEY = /(key|secret|token|password|auth|bearer|credential)/i;
function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : v;
  return out;
}
function safeJson(v) { try { return JSON.stringify(scrub(v), null, 2); } catch { return '"<unserializable>"'; } }

// Append one action. Returns { id, day } or null (journaling must never break the mutation itself).
export function journalAction({ command, actor = 'app', targets = [], undoable = false, before = null, after = null, parentAction = null, sessionId = null, status = 'applied' }) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const id = 'act-' + Date.now() + '-' + (++seq);
    const rec = {
      id, ts: Date.now(), at: stamp(), actor, command, status,
      targets: Array.isArray(targets) ? targets : [targets],
      undoable: !!undoable, undoneAt: null, parentAction: parentAction || null, sessionId: sessionId || null,
      before: before != null ? scrub(before) : null, after: after != null ? scrub(after) : null
    };
    const body = '## ' + command + '\n\n' +
      (before != null ? '### before\n```json\n' + safeJson(before) + '\n```\n\n' : '') +
      (after != null ? '### after\n```json\n' + safeJson(after) + '\n```\n' : '');
    writeMd(path.join(actionsRoot(), day, id + '.md'), rec, body);
    return { id, day };
  } catch { return null; }
}

// List recent actions, newest first (scans the last `days` day-folders). Used by /api/actions and
// the undo stack. Cheap: reads frontmatter only.
export function listActions(limit = 200) {
  const root = actionsRoot();
  if (!fs.existsSync(root)) return [];
  const days = fs.readdirSync(root).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  const out = [];
  for (const day of days) {
    const dir = path.join(root, day);
    let files;
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')); } catch { continue; }
    for (const f of files) {
      try { out.push(readMd(path.join(dir, f)).data); } catch { /* skip malformed */ }
    }
    if (out.length >= limit * 2) break;
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out.slice(0, limit);
}

// Locate an action record file by id (searches day-folders newest first).
function actionFile(id) {
  const root = actionsRoot();
  if (!fs.existsSync(root)) return null;
  for (const day of fs.readdirSync(root).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()) {
    const p = path.join(root, day, id + '.md');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function getAction(id) {
  const p = actionFile(id);
  if (!p) return null;
  try { return readMd(p).data; } catch { return null; }
}

// Mark an action undone (or applied again). Preserves the original record; only flips status.
export function markAction(id, status) {
  const p = actionFile(id);
  if (!p) return null;
  const { data, content } = readMd(p);
  const next = { ...data, status, undoneAt: status === 'undone' ? Date.now() : null };
  writeMd(p, next, content);
  return next;
}
