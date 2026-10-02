// Work handoffs live on the work record. This module owns readiness and delayed follow-ups;
// records.mjs remains the only document writer, and goals remain human-owned memory.
import { getCollection, saveCollection } from './collections.mjs';
import { documentsFor } from './documents.mjs';
import { getGoal } from './memory.mjs';
import { upsertRecord, readRecord } from './records.mjs';
import { localDay, dayStartMs, addDays } from './daytime.mjs';

export class WorkflowError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const WORKFLOW_FIELDS = [
  { key: 'goal_id', type: 'text' },
  { key: 'key_result', type: 'text' },
  { key: 'destination', type: 'text' },
  { key: 'done_when', type: 'text' },
  { key: 'depends_on', type: 'relation', target: 'work', many: true },
  { key: 'not_before', type: 'date' },
  { key: 'follow_up_days', type: 'number' },
  { key: 'follow_up_title', type: 'text' },
];

export function ensureWorkflowFields() {
  const collection = getCollection('work');
  if (!collection) return;
  const missing = WORKFLOW_FIELDS.filter(f => !collection.fields.some(existing => existing.key === f.key));
  if (missing.length) saveCollection({ ...collection, fields: [...collection.fields, ...missing] });
}

const calendarDay = value => value instanceof Date
  ? (Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)) : String(value || '');
function validDay(value) {
  const day = calendarDay(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && localDay(dayStartMs(day)) === day;
}
const dependencies = item => Array.isArray(item.depends_on) ? item.depends_on.map(String) : item.depends_on ? [String(item.depends_on)] : [];
const matches = (item, id) => item.id === id || item.path === id;

export function workReadiness(item, items, day = localDay()) {
  if (item.not_before) {
    if (!validDay(item.not_before)) return { ready: false, reason: 'Fix the follow-up date' };
    const due = calendarDay(item.not_before);
    if (due > day) return { ready: false, reason: 'Follow up on ' + due };
  }
  for (const id of dependencies(item)) {
    const required = items.find(it => matches(it, id));
    if (!required) return { ready: false, reason: 'Missing prerequisite: ' + id };
    if (required.status !== 'done') return { ready: false, reason: 'Waiting for ' + required.title };
  }
  return { ready: true, reason: '' };
}

// Validation finishes before a caller mutates the item. Dependencies must exist and remain
// acyclic, including an update that introduces a cycle through several existing records.
export function validateWorkflow(input, { id = null, items = [] } = {}) {
  const output = {};
  for (const key of ['goal_id', 'key_result', 'destination', 'done_when', 'follow_up_title']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new WorkflowError(key + ' must be text');
    output[key] = input[key].trim();
    if (output[key].length > 2000) throw new WorkflowError(key + ' is too long');
  }
  if (output.goal_id && !getGoal(output.goal_id)) throw new WorkflowError('Unknown goal: ' + output.goal_id);
  if (input.not_before !== undefined) {
    if (input.not_before && !validDay(input.not_before)) throw new WorkflowError('not_before must be a real YYYY-MM-DD date');
    output.not_before = input.not_before ? calendarDay(input.not_before) : '';
  }
  if (input.follow_up_days !== undefined) {
    const value = input.follow_up_days;
    if (value === '' || value === null) output.follow_up_days = null;
    else {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1 || number > 365) throw new WorkflowError('follow_up_days must be 1–365 whole days');
      output.follow_up_days = number;
    }
  }
  if (input.depends_on !== undefined) {
    if (!Array.isArray(input.depends_on) || input.depends_on.some(value => typeof value !== 'string' || !value.trim())) {
      throw new WorkflowError('depends_on must be an array of work item IDs');
    }
    output.depends_on = [...new Set(input.depends_on.map(value => value.trim()))];
    for (const dependency of output.depends_on) {
      const required = items.find(it => matches(it, dependency));
      if (!required) throw new WorkflowError('Unknown prerequisite: ' + dependency);
      const visited = new Set();
      const hasCycle = it => {
        if (id && matches(it, id)) return true;
        if (visited.has(it.id)) return false;
        visited.add(it.id);
        return dependencies(it).some(dep => {
          const next = items.find(row => matches(row, dep));
          return next && hasCycle(next);
        });
      };
      if (hasCycle(required)) throw new WorkflowError('Prerequisites would create a cycle');
    }
  }
  return output;
}

export function assertCompletion(item, resultNote) {
  if (item.done_when && !String(resultNote ?? item.result_note ?? '').trim()) {
    throw new WorkflowError('Record what proves done: ' + item.done_when);
  }
}

// One deterministic follow-up per source item. Repeating Done cannot create another item or
// postpone its due date. It carries context, but no recursive follow-up setting.
export function scheduleFollowup(item, { actor = 'conductor', now = Date.now() } = {}) {
  if (!item.follow_up_days) return null;
  const delay = Number(item.follow_up_days);
  if (!Number.isInteger(delay) || delay < 1 || delay > 365) throw new WorkflowError('follow_up_days must be 1–365 whole days');
  const id = 'followup-' + item.id;
  const existing = (documentsFor('work')?.documents || []).find(doc => doc.slug === id);
  if (existing) return { id, path: existing.path, existing: true, day: calendarDay(existing.fields.not_before) };
  const due = addDays(localDay(now), delay);
  const title = String(item.follow_up_title || '').trim() || 'Follow up: ' + item.title;
  const source = readRecord(item.path);
  const resultNote = String(source?.data?.result_note || '').trim();
  const record = upsertRecord({
    collection: 'work', id, title,
    bucket: item.bucket || 'admin', status: 'planned', estimate_min: 15,
    goal_id: item.goal_id || '', key_result: item.key_result || '', destination: item.destination || '',
    why: 'Check the outcome of ' + item.title, depends_on: [item.id], not_before: due,
    done_when: 'Record the observed outcome and its evidence',
    body: 'Follow up on ' + due + '.\n\nSource: [[' + item.path + ']].'
      + (resultNote ? '\n\nCompletion evidence: ' + resultNote : '') + '\n',
  }, { actor, via: 'today-followup' });
  return { ...record, id, title, day: due };
}
