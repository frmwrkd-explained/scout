// A reference library, imported from an Airtable snapshot. Same shape as `opsgraphImport.mjs`:
// the source is read-only, the preview is hashed, records go through the canonical writer with
// stable ids and provenance, and a second run adds nothing.
//
// THE SOURCE IS A SNAPSHOT, NOT A CONNECTION. `{ records: [{ id, fields }] }` is what Airtable's
// API and its connector both answer. Taking it as data means this module holds no token and can
// never write to Airtable — there is no client here to write with.
//
// ATTACHMENT LINKS EXPIRE (about two hours after they are listed), so the bytes are fetched in the
// same run that reads the snapshot and stored content-addressed through `attachments.mjs`. A
// download that fails does not cost the record: it is imported without its image, reported, and
// the next run fills the gap — `upsertRecord` only ever fills an empty field.
//
// IDENTITY IS THE AIRTABLE RECORD ID. `airtable_id` is looked up before anything is written, so a
// record that was renamed, re-titled or edited locally is still recognised and left alone.

import crypto from 'node:crypto';
import { getStorageRoot } from './store.mjs';
import { getCollection, saveCollection } from './collections.mjs';
import { listViews, saveView } from './views.mjs';
import { documentsFor } from './documents.mjs';
import { batchUpsert, DEFAULT_ACTOR } from './records.mjs';
import { storeAttachment } from './attachments.mjs';
import { isAgentActor } from './actors.mjs';
import { logEvent } from './log.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';

export const REFERENCES_ID = 'references';

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function owner(actor) { if (currentWorkerIdentity() || isAgentActor(actor)) fail('Only the operator can import a reference library.', 403); }

// A prompt is kept WORD FOR WORD: no trim, no re-wrap, no normalised quotes. Only a value that is
// nothing but whitespace counts as absent.
const verbatim = value => (typeof value === 'string' && value.trim() ? value : undefined);
const text = value => (typeof value === 'string' ? value.trim() : '');

// ── the mapping ────────────────────────────────────────────────────────────────────────────────
// Airtable field → Scout field. One table, read by the mapper, the dry run and the docs.
export const FIELD_MAP = [
  ['visual_signature', 'name', 'first clause, as the title — the table has no name field'],
  ['Inspiration Image', 'image', 'file · primary_media · stored as files/<sha256>.<ext>'],
  ['Main Category', 'category', 'select'],
  ['Category', 'tags', 'multiselect, open vocabulary'],
  ['Constructed Prompt', 'prompt', 'text · multiline · word for word'],
  ['visual_signature', 'signature', 'text · multiline · the full sentence'],
  ['Gender Fit', 'gender_fit', 'select'],
  ['Tagline Recommendation', 'tagline', 'select'],
  ['Image Bria Fibo', 'generated_image', 'file · stored as files/<sha256>.<ext>'],
  ['Prompt from Bria Fibo', 'generated_prompt', 'text · multiline · word for word'],
  ['Fal URL', 'fal_url', 'url'],
  ['(record id)', 'airtable_id', 'text · provenance and the idempotency key'],
  ['ID', 'airtable_number', 'number · also the file name: ref-0042.md'],
  ['main_concept · Concept Analysis · Template Description · Execution Guide · Application Guidelines', '(body)', 'the note itself, laid out as readable Markdown'],
];

// The table has no title. `visual_signature` is one descriptive sentence; its first clause reads as
// a name and the whole sentence is kept beside it as `signature`.
export function titleFrom(signature, fallback) {
  const s = text(signature).replace(/\s+/g, ' ');
  if (!s) return fallback;
  // Clause by clause until it says something: "Full-street coverage of dense" stops mid-thought
  // at its first comma, so a short opening takes the next clause with it.
  const parts = s.split(/(?<=[,;:])\s+| — | - /);
  let clause = '';
  for (const part of parts) {
    clause = clause ? clause + ' ' + part : part;
    if (clause.replace(/[,;:]$/, '').length >= 32) break;
  }
  clause = clause.trim().replace(/[,;:.\s]+$/, '');
  if (clause.length <= 72) return clause;
  // Too long for a title: cut at a word, then back to the last joining word ("against", "with",
  // "in"…) so it ends on a whole phrase — "…silhouette with suspended droplet" — and not on an
  // adjective whose noun was cut off.
  const words = clause.slice(0, 72).replace(/\s+\S*$/, '').split(' ');
  for (let at = words.length - 1; at >= 3; at--) {
    if (!TRAILING.has(words[at].toLowerCase().replace(/[,;:]$/, ''))) continue;
    const shorter = words.slice(0, at).join(' ').replace(/[,;:.\s]+$/, '');
    if (shorter.length >= 28) return shorter;
  }
  return words.join(' ').replace(/[,;:.\s]+$/, '');
}
const TRAILING = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'with', 'in', 'on', 'at', 'to', 'from', 'by', 'for', 'as', 'into', 'over', 'under',
  'against', 'between', 'behind', 'beneath', 'above', 'across', 'through', 'around', 'creating', 'featuring', 'using', 'showing', 'while', 'that', 'its', 'their']);

// `[Electronics & Technology` and `Home & Garden]` are one mis-split list in the source, not two
// more categories. Only the stray bracket is removed; the words are untouched.
const cleanTag = value => text(value).replace(/^\[+\s*/, '').replace(/\s*\]+$/, '');

// The analysis fields hold JSON the vision model wrote. A person reads the note, so it is laid out
// as Markdown they can read — a bold label and its text, nested values indented beneath — and an
// agent reads the same lines. Anything that is not JSON is kept as the prose it is.
const labelOf = key => { const w = String(key).replace(/_/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1); };
function readable(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(item => (item && typeof item === 'object' ? readable(item, depth) : [pad + '- ' + String(item)]));
  if (typeof value !== 'object') return [pad + String(value)];
  return Object.entries(value).flatMap(([key, v]) => {
    if (v == null || v === '') return [];
    if (typeof v === 'object') return [pad + '- **' + labelOf(key) + '**', ...readable(v, depth + 1)];
    return [pad + '- **' + labelOf(key) + ':** ' + String(v).replace(/\s*\n\s*/g, ' ')];
  });
}
function section(source) {
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object') { const lines = readable(parsed); if (lines.length) return lines.join('\n'); }
  } catch { /* prose, not JSON */ }
  return String(source).trim();
}

function bodyOf(fields) {
  const blocks = [];
  const concept = text(fields.main_concept);
  if (concept) blocks.push(concept);   // first paragraph = the summary the list and the page show
  for (const [key, heading] of [
    ['Concept Analysis', 'Concept analysis'],
    ['Template Description', 'Template description'],
    ['Execution Guide', 'Execution guide'],
    ['Application Guidelines', 'Application guidelines'],
  ]) {
    if (text(fields[key])) blocks.push('## ' + heading + '\n\n' + section(fields[key]));
  }
  return blocks.join('\n\n');
}

const firstAttachment = value => (Array.isArray(value) && value[0] && value[0].url ? value[0] : null);

export function mapReference(record) {
  const fields = (record && record.fields) || {};
  const number = Number(fields.ID);
  if (!record?.id || !Number.isInteger(number)) return null;
  const padded = String(number).padStart(4, '0');
  const gender = text(fields['Gender Fit']);
  const tags = [...new Set([].concat(fields.Category || []).map(cleanTag).filter(Boolean))];
  const image = firstAttachment(fields['Inspiration Image']);
  const generated = firstAttachment(fields['Image Bria Fibo']);
  return {
    id: 'ref-' + padded,
    airtable_id: record.id,
    fields: {
      name: titleFrom(fields.visual_signature, 'Reference ' + padded),
      category: text(fields['Main Category']) || undefined,
      tags: tags.length ? tags : undefined,
      prompt: verbatim(fields['Constructed Prompt']),
      signature: text(fields.visual_signature) || undefined,
      // `Female` and `female` are both options in the source. One value, lower case like the rest.
      gender_fit: gender ? (/^(female|male|unisex)$/i.test(gender) ? gender.toLowerCase() : gender) : undefined,
      tagline: text(fields['Tagline Recommendation']) || undefined,
      generated_prompt: verbatim(fields['Prompt from Bria Fibo']),
      fal_url: text(fields['Fal URL']) || undefined,
      airtable_id: record.id,
      airtable_number: number,
    },
    body: bodyOf(fields),
    attachments: { ...(image ? { image } : {}), ...(generated ? { generated_image: generated } : {}) },
  };
}

// ── the collection ─────────────────────────────────────────────────────────────────────────────
// Select options are read off the data rather than typed here, so a category added in Airtable
// next month is a legal value instead of a schema error.
export function referencesSchema(items = [], source = {}) {
  const distinct = key => [...new Set(items.map(item => item.fields[key]).filter(Boolean))].sort();
  const or = (values, fallback) => (values.length ? values : fallback);
  return {
    id: REFERENCES_ID,
    label: 'References',
    icon: 'image',
    query: { path: 'data/references/**' },
    default_view: 'all',
    fields: [
      { key: 'name', type: 'text', primary: true, required: true },
      { key: 'image', type: 'file', primary_media: true },
      { key: 'category', type: 'select', options: or(distinct('category'), ['ADs']) },
      { key: 'tags', type: 'multiselect' },
      { key: 'prompt', type: 'text', multiline: true },
      { key: 'signature', type: 'text', multiline: true },
      { key: 'gender_fit', type: 'select', options: or(distinct('gender_fit'), ['unisex']) },
      { key: 'tagline', type: 'select', options: or(distinct('tagline'), ['neutral']) },
      { key: 'generated_image', type: 'file' },
      { key: 'generated_prompt', type: 'text', multiline: true },
      { key: 'fal_url', type: 'url' },
      { key: 'airtable_id', type: 'text' },
      { key: 'airtable_number', type: 'number' },
    ],
    description: 'Reference images with the prompt that rebuilds each one. Imported from Airtable'
      + (source.base ? ' (base ' + source.base + (source.table ? ', table ' + source.table : '') + ')' : '')
      + '; every record keeps its Airtable record id as `airtable_id`.',
  };
}

function referenceViews(schema) {
  // How each view LOOKS is part of the view (docs/02_DATA_MODEL.md §3): cards, medium, the whole
  // picture, with the category and the tags under the name.
  const look = { type: 'gallery', size: 'm', fit: 'contain', fields: ['category', 'tags'], group: null };
  const sort = [{ field: 'airtable_number', dir: 'asc' }];
  const categories = (schema.fields.find(field => field.key === 'category')?.options || []).map(String);
  return [
    { id: 'all', label: 'Everything', filter: [], sort, ...look },
    ...categories.map(category => ({
      id: category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category',
      label: category, filter: [{ field: 'category', op: 'is', value: category }], sort, ...look, fields: ['tags'],
    })),
  ];
}

// Creates the collection and its views ONLY when they are absent. A `references` collection that
// already exists is the person's: it is used as it stands and never rewritten.
function ensureCollection(items, source) {
  if (getCollection(REFERENCES_ID)) return { created: false };
  const schema = referencesSchema(items, source);
  saveCollection(schema);
  const existing = listViews(REFERENCES_ID);
  if (!existing || existing.views.every(view => view.generated)) {
    for (const view of referenceViews(schema)) saveView(REFERENCES_ID, view);
  }
  return { created: true };
}

// ── preview ────────────────────────────────────────────────────────────────────────────────────

const existingByAirtableId = () => new Map(((documentsFor(REFERENCES_ID) || {}).documents || [])
  .filter(doc => doc.fields.airtable_id)
  .map(doc => [String(doc.fields.airtable_id), doc]));

const tally = values => values.reduce((out, value) => { out[value] = (out[value] || 0) + 1; return out; }, {});

export function previewReferences({ snapshot } = {}) {
  if (currentWorkerIdentity()) fail('Only the operator can preview a reference import.', 403);
  const records = Array.isArray(snapshot?.records) ? snapshot.records : null;
  if (!records) fail('The snapshot must be { records: [{ id, fields }] }.');
  if (records.length > 20000) fail('Snapshot exceeds 20000 records.');

  const known = existingByAirtableId();
  const seen = new Set();
  const items = [], rejected = [];
  for (const record of records) {
    const item = mapReference(record);
    if (!item) { rejected.push({ airtable_id: record?.id || null, reason: 'no Airtable id or number' }); continue; }
    if (seen.has(item.airtable_id)) { rejected.push({ airtable_id: item.airtable_id, reason: 'listed twice in the snapshot' }); continue; }
    seen.add(item.airtable_id);
    // Nothing to keep: no picture, no prompt and no analysis. An empty row in the source.
    if (!item.attachments.image && !item.fields.prompt && !item.body) { rejected.push({ airtable_id: item.airtable_id, id: item.id, reason: 'empty: no image, no prompt, no analysis' }); continue; }
    const on = known.get(item.airtable_id);
    const missing = on ? Object.keys(item.attachments).filter(key => !on.fields[key]) : [];
    items.push({ ...item, existing: !!on, path: on ? on.path : null, repair: missing });
  }
  items.sort((a, b) => a.fields.airtable_number - b.fields.airtable_number);

  return {
    source: { base: snapshot.base || null, table: snapshot.table || null },
    workspace: getStorageRoot(),
    hash: hash(items.map(item => [item.id, item.airtable_id, item.fields, item.body, Object.keys(item.attachments)])),
    counts: {
      records: records.length,
      importable: items.length,
      rejected: rejected.length,
      already_imported: items.filter(item => item.existing).length,
      to_repair: items.filter(item => item.existing && item.repair.length).length,
      with_image: items.filter(item => item.attachments.image).length,
      with_prompt: items.filter(item => item.fields.prompt).length,
      with_generated_image: items.filter(item => item.attachments.generated_image).length,
      image_bytes: items.reduce((sum, item) => sum + Object.values(item.attachments).reduce((n, a) => n + (Number(a.size) || 0), 0), 0),
      by_category: tally(items.map(item => item.fields.category || '(none)')),
    },
    rejected,
    items,
  };
}

// ── import ─────────────────────────────────────────────────────────────────────────────────────

async function fetchBytes(attachment) {
  const response = await fetch(attachment.url, { redirect: 'follow' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}

async function pool(list, size, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, list.length)) }, async () => {
    while (next < list.length) { const at = next++; await work(list[at], at); }
  }));
}

// `download(attachment) → Buffer` is injectable so tests never touch the network and a caller can
// read from bytes it already holds.
export async function importReferences({ snapshot, previewHash, limit = null } = {}, { actor = DEFAULT_ACTOR, download = fetchBytes, concurrency = 8, onProgress = null } = {}) {
  owner(actor);
  const root = getStorageRoot();
  const preview = previewReferences({ snapshot });
  if (previewHash !== preview.hash) fail('The import preview changed. Review it again.', 409);
  const schema = ensureCollection(preview.items, preview.source);

  const todo = preview.items.filter(item => !item.existing || item.repair.length);
  const work = Number.isInteger(limit) ? todo.slice(0, limit) : todo;
  const skipped = preview.items.filter(item => item.existing && !item.repair.length).map(item => item.id);
  const failedDownloads = [];
  const stored = new Map();   // item.id → { image?: 'files/…', generated_image?: 'files/…' }
  let bytes = 0, reused = 0, done = 0;

  await pool(work, concurrency, async item => {
    const files = {};
    for (const [key, attachment] of Object.entries(item.attachments)) {
      if (item.existing && !item.repair.includes(key)) continue;
      try {
        const buf = await download(attachment);
        if (Number(attachment.size) && buf.length !== Number(attachment.size)) throw new Error('got ' + buf.length + ' bytes, Airtable lists ' + attachment.size);
        const saved = storeAttachment(buf, { type: attachment.type, name: attachment.filename });
        files[key] = saved.path;
        if (saved.existed) reused++; else bytes += saved.size;
      } catch (error) {
        failedDownloads.push({ id: item.id, airtable_id: item.airtable_id, field: key, file: attachment.filename || null, error: error.message });
      }
    }
    stored.set(item.id, files);
    if (onProgress) onProgress(++done, work.length);
  });

  if (getStorageRoot() !== root) fail('Workspace changed during import.', 409);
  // ONE batch: the writer loads the collection once and each stored record joins the candidate
  // set, instead of re-reading every file in the workspace per record.
  const batch = [];
  for (const item of work) {
    const files = stored.get(item.id) || {};
    if (item.existing) {
      if (!Object.keys(files).length) continue;
      // Fill the empty file field on the record that is already there — found by its Airtable id,
      // so a record the person renamed is still the one that gets repaired.
      const slug = item.path.split('/').pop().replace(/\.md$/, '');
      batch.push({ item, input: { collection: REFERENCES_ID, id: slug, name: item.fields.name, ...files } });
    } else {
      batch.push({ item, input: { collection: REFERENCES_ID, id: item.id, ...item.fields, ...files, body: item.body } });
    }
  }
  const created = [], repaired = [], refused = [];
  const written = batchUpsert(batch.map(entry => entry.input), { actor, via: 'airtable-import' });
  written.results.forEach((result, at) => {
    const { item } = batch[at];
    if (result.verdict === 'refused') refused.push({ id: item.id, error: result.error });
    else if (item.existing) repaired.push(item.id);
    else if (result.verdict === 'store') created.push(item.id);
    // `ref-0042` already taken by a record that is NOT this Airtable row. The writer only ever
    // fills empty fields, so nothing was overwritten — but it is not a new record either.
    else refused.push({ id: item.id, error: 'a different record already uses this id (' + result.verdict + ')' });
  });

  const report = {
    workspace: root,
    collection_created: schema.created,
    created: created.length, repaired: repaired.length, skipped: skipped.length,
    rejected: preview.rejected, refused, failed_downloads: failedDownloads,
    files: { written_bytes: bytes, reused, dir: 'files/' },
    records_dir: 'data/references/',
    remaining: todo.length - work.length,
  };
  logEvent({ type: 'store', actor, target: 'references/import', detail: {
    source: preview.source, created: report.created, repaired: report.repaired, skipped: report.skipped,
    failed_downloads: failedDownloads.length, refused: refused.length, hash: preview.hash } });
  return report;
}

export default { previewReferences, importReferences, mapReference, referencesSchema, titleFrom, FIELD_MAP, REFERENCES_ID };
