// Real cost ledger (F6.1 server part) — every paid external call appends one entry to
// <root>/costs.md frontmatter. Portable markdown like everything else; newest first.
//   { ts, at, service, op, model, units, cost, ref }
// service — 'groq' for groq.mjs/enhance.mjs, otherwise the model's provider id from
//   frontend/modelCatalog.js (fal, kie, higgsfield, …) as passed by generate.mjs/stylelocks.mjs.
// op — values actually written today:
//   'breakdown' (groq.mjs breakdownStory)     'whisper'  (groq.mjs transcribe)
//   'vision'    (vision.mjs analyzeImage)     'look'     (vision.mjs extractLook)
//   'enhance'   (enhance.mjs)                 'image'    (generate.mjs, stylelocks.mjs)
//   'video'     (generate.mjs)                'chat'     (groq.mjs chat() default — currently
//                                                         unused; every call site passes an op)
// NOTE: `op` (and `service`) are unvalidated free text — nothing here or upstream constrains
// them to a set. Treat the list above as a snapshot, not an enum: rows already in costs.md may
// carry values no longer produced (e.g. 'storage'), and a new call site can introduce one at any
// time. Never write an exhaustive switch over `op` without a default branch.
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp } from './store.mjs';

const costsMd = () => path.join(getStorageRoot(), 'costs.md');
const monthKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

// The detail-row cap must NOT cause monthly totals to undercount (Phase 3F). We keep the last 500
// detail rows for the ledger table AND a permanent rollup keyed by month → { total, count, byService,
// byOp } that is incremented on every call and never trimmed. Month/budget math reads the rollup, so
// it stays correct past 500 paid operations.
export function ledger({ service, op, model = '', units = '', cost = 0, ref = '' }) {
  let data = { entries: [], rollup: {} };
  try { const d = readMd(costsMd()).data; data = { entries: d.entries || [], rollup: d.rollup || {} }; } catch { /* first entry */ }
  const ts = Date.now();
  const c = Number(cost) || 0;
  const row = { ts, at: stamp(), service, op, model, units, cost: c, ref };
  const entries = [row, ...data.entries].slice(0, 500);
  const rollup = { ...data.rollup };
  const mk = monthKey(ts);
  const m = rollup[mk] || { total: 0, count: 0, byService: {}, byOp: {} };
  m.total = (m.total || 0) + c;
  m.count = (m.count || 0) + 1;
  m.byService = { ...m.byService, [service]: (m.byService?.[service] || 0) + c };
  m.byOp = { ...m.byOp, [op]: (m.byOp?.[op] || 0) + c };
  rollup[mk] = m;
  writeMd(costsMd(), { entries, rollup },
    'Scout cost ledger — detail rows (newest first, cap 500) + permanent monthly rollup that never trims.\n');
  return row;
}

export function getLedger() {
  try { return readMd(costsMd()).data.entries || []; } catch { return []; }
}
// Permanent monthly rollup — accurate even after >500 paid operations.
export function getLedgerRollup() {
  try { return readMd(costsMd()).data.rollup || {}; } catch { return {}; }
}
export { monthKey };
