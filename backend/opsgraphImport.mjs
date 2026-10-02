// Read-only OpsGraph snapshots. The mirror is never a write target; local imports use the
// canonical goal/record writers and stable source IDs. Re-imports preserve local work edits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStorageRoot, getSettings, readMd } from './store.mjs';
import { saveGoal, getGoal, readMe } from './memory.mjs';
import { upsertRecord } from './records.mjs';
import { documentsFor } from './documents.mjs';
import { ensureWorkCollections, WORK_BUCKETS } from './today.mjs';
import { isAgentActor } from './actors.mjs';
import { logEvent } from './log.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stable = value => 'opsgraph-' + hash(value).slice(0, 20);
const text = value => String(value ?? '').trim();
const unitOf = value => text(value.unitId || value.unit || value.universe);
const rows = value => Array.isArray(value) ? value : Object.values(value || {});
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function owner(actor) { if (currentWorkerIdentity() || isAgentActor(actor)) fail('Only the operator can import OpsGraph records.', 403); }

function mirrorRecords(folder) {
  if (!folder || !fs.existsSync(folder)) fail('Choose an existing OpsGraph mirror folder.');
  const realRoot = fs.realpathSync(folder), out = [];
  const scoutRoot = fs.realpathSync(getStorageRoot());
  if (scoutRoot === realRoot || scoutRoot.startsWith(realRoot + path.sep)) fail('The OpsGraph mirror must not contain Scout’s writable workspace.');
  const walk = (dir, depth = 0) => {
    if (depth > 6) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (!fs.realpathSync(file).startsWith(realRoot + path.sep)) continue;
      if (entry.isDirectory()) walk(file, depth + 1);
      else if (entry.name.endsWith('.md')) {
        if (fs.statSync(file).size > 256 * 1024) fail('Mirror record is too large: ' + entry.name);
        try { const { data, content } = readMd(file); out.push({ ...data, body: content, source_path: path.relative(realRoot, file) }); }
        catch { fail('Cannot parse mirror record: ' + path.relative(realRoot, file)); }
        if (out.length > 2000) fail('Select a smaller OpsGraph snapshot (maximum 2000 records).');
      }
    }
  };
  for (const directory of ['goals', 'sprints', 'backlog', 'bets']) {
    const dir = path.join(realRoot, directory);
    if (fs.existsSync(dir) && !fs.lstatSync(dir).isSymbolicLink()) walk(dir);
  }
  return out;
}

export function previewOpsgraph({ snapshot = null, unit, person = '', folder = null } = {}) {
  if (currentWorkerIdentity()) fail('Only the operator can preview OpsGraph records.', 403);
  const selected = text(unit);
  if (!selected) fail('Select one OpsGraph universe before importing.');
  const me = readMe().data;
  const who = text(person || me.person);
  const source = folder || getSettings().hubFolder;
  const candidates = snapshot ? [
    ...rows(snapshot.goals).map(row => ({ ...row, type: 'goal' })),
    ...rows(snapshot.objectives).map(row => ({ ...row, type: 'objective' })),
    ...rows(snapshot.backlog).map(row => ({ ...row, type: 'bet' })),
    ...rows(snapshot.sprints).map(row => ({ ...row, type: 'sprint' })),
    ...rows(snapshot.commitments).map(row => ({ ...row, type: 'commitment' })),
  ] : mirrorRecords(source);
  if (candidates.length > 2000) fail('Snapshot exceeds 2000 records.');
  const eligible = candidates.filter(row => unitOf(row) === selected && !row.archived && row.sample !== true);
  const goals = eligible.filter(row => ['goal', 'objective'].includes(row.type));
  const goalMap = new Map(goals.map(row => [text(row.id), stable([selected, row.type, row.id])]));
  const imports = goals.map(row => ({
    kind: 'goal', id: goalMap.get(text(row.id)), source_id: text(row.id),
    label: text(row.label || row.title || row.name), target: Number(row.target) || 1,
    current: Number(row.current) || 0, unit: text(row.unit_label || row.metric || row.unitLabel) || 'results',
    hub_goal: text(row.id), universe: selected, body: text(row.body),
    key_results: rows(row.krs || row.key_results || rows(row.route?.objectives).flatMap(objective => rows(objective.key_results))).map(kr => ({ id: text(kr.id), text: text(kr.text || kr.label || kr.name), target: Number(kr.target) || 0 })),
  }));
  const work = [];
  const add = (row, sourceId, title, parent = {}) => {
    if (!sourceId || !text(title)) return;
    const goalId = goalMap.get(text(row.objectiveId || row.serves || row.goal_id || parent.serves)) || '';
    const goal = imports.find(item => item.id === goalId);
    work.push({ kind: 'work', id: stable([selected, 'work', sourceId]), source_id: sourceId,
      title: text(title), universe: selected, goal_id: goalId,
      key_result: row.key_result ? (goal?.key_results || []).find(kr => kr.id === row.key_result)?.text || text(row.key_result) : (goal?.key_results || []).filter(kr => !row.krIds || row.krIds.includes(kr.id)).map(kr => kr.text).join('; '),
      bucket: WORK_BUCKETS.includes(row.bucket) ? row.bucket : 'admin',
      estimate_min: Math.max(5, Math.min(240, Number(row.estimate_min) || 30)),
      destination: text(row.destination || row.clickup?.url), done_when: text(row.done_when) || 'Record the completed output and its evidence',
      why: text(row.why || parent.goal), body: text(row.body), source_path: row.source_path || parent.source_path || '',
    });
  };
  for (const row of eligible) {
    if (['bet', 'backlog'].includes(row.type) && (row.column === 'now' || row.status === 'approved')) add(row, text(row.id), row.title || row.name);
    if (row.type === 'commitment' && (!who || row.personId === who) && !['done', 'stopped'].includes(row.clickup?.status)) add(row, text(row.id), row.text || row.title);
    if (row.type === 'sprint' && !['done', 'blocked'].includes(row.status)) {
      for (const commitment of rows(row.commitments)) {
        if (['done', 'carried'].includes(commitment.state) || (who && commitment.person && commitment.person !== who)) continue;
        add({ ...commitment, universe: selected }, text(row.id) + '/commitment/' + hash([commitment.person, commitment.text, commitment.key_result]).slice(0, 16), commitment.text, row);
      }
    }
  }
  const seen = new Set();
  const items = [...imports, ...work].filter(item => item.source_id && item.label !== '' && !seen.has(item.id) && seen.add(item.id));
  const existing = new Set((documentsFor('work')?.documents || []).map(doc => doc.slug));
  return { unit: selected, source: snapshot ? 'OpsGraph snapshot' : path.resolve(source), hash: hash(items),
    items: items.map(item => ({ ...item, existing: item.kind === 'goal' ? !!getGoal(item.id) : existing.has(item.id) })) };
}

export function importOpsgraph(input, { actor = 'crystal' } = {}) {
  owner(actor);
  const root = getStorageRoot(), preview = previewOpsgraph(input);
  if (input.previewHash !== preview.hash) fail('The import preview changed. Review it again.', 409);
  ensureWorkCollections();
  const created = [], skipped = [];
  for (const item of preview.items) {
    if (getStorageRoot() !== root) fail('Workspace changed during import.', 409);
    if (item.existing) { skipped.push(item.id); continue; }
    const provenance = { opsgraph_id: item.source_id, opsgraph_unit: preview.unit, opsgraph_source: preview.source, universe: preview.unit };
    if (item.kind === 'goal') saveGoal(item.id, { ...item, ...provenance, source: 'opsgraph' }, { actor });
    else {
      const { kind, existing, source_id, source_path, ...work } = item;
      upsertRecord({ collection: 'work', ...work, ...provenance, status: 'planned', prep: false,
        body: work.body + '\n\nImported from OpsGraph: ' + source_id + (source_path ? ' (' + source_path + ')' : '') + '\n' }, { actor, via: 'opsgraph-import' });
    }
    created.push(item.id);
  }
  logEvent({ type: 'store', actor, target: 'opsgraph/import', detail: { unit: preview.unit, created, skipped, hash: preview.hash } });
  return { created, skipped, unit: preview.unit };
}

export function registerOpsgraphRoutes(app) {
  const route = fn => (req, res) => { try { res.json(fn(req)); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } };
  app.post('/api/opsgraph/preview', route(req => { owner(req.body?.actor || 'crystal'); return previewOpsgraph(req.body); }));
  app.post('/api/opsgraph/import', route(req => importOpsgraph(req.body, { actor: req.body?.actor || 'crystal' })));
}
