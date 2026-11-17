// The reference-library import: an Airtable snapshot → the `references` collection.
// What is gated here is what the import promises a person: the prompt arrives word for word, the
// picture is stored under its own hash, a second run adds nothing, a failed download costs no
// record, and nothing a person already has is overwritten. No network: `download` is injected.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { freshRoot, getStorageRoot, readMd, fs, path } from './helpers.mjs';
import { previewReferences, importReferences, mapReference, titleFrom, REFERENCES_ID } from '../backend/referenceImport.mjs';
import { storeAttachment, attachmentExt } from '../backend/attachments.mjs';
import { getCollection, saveCollection } from '../backend/collections.mjs';
import { listViews } from '../backend/views.mjs';
import { documentsFor } from '../backend/documents.mjs';

// A prompt with everything YAML likes to "help" with: edge whitespace, blank-line runs, a line that
// looks like a list item, a heading, a key, a document fence, quotes, and non-ASCII.
const PROMPT = '  Use the provided product image unchanged.  \n\n\n- Product centered\n# not a heading\nkey: value\n---\n"quoted" and \'single\' — 6–8 cushions, café ☕\n\tTabbed line\nlast line without newline';

const png = seed => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('scout-test-image-' + seed)]);
const attachment = (id, seed) => ({ id, url: 'https://example.invalid/' + id, filename: 'pin ' + seed, type: 'image/png', size: png(seed).length, __seed: seed });

function snapshot() {
  return {
    base: 'appTEST', table: 'tblTEST',
    records: [
      { id: 'recAAA', fields: { ID: 7, visual_signature: 'Centered product on a white ground, soft shadow beneath', 'Main Category': 'ADs',
        Category: ['[Electronics & Technology', 'Home & Garden]', 'Home & Garden'], 'Gender Fit': 'Female', 'Constructed Prompt': PROMPT,
        main_concept: 'A calm product shot.', 'Concept Analysis': '{"main_concept":"A calm product shot."}',
        'Inspiration Image': [attachment('attA', 'a')] } },
      // Same title as recAAA on purpose: two different references that read alike must stay two files.
      { id: 'recBBB', fields: { ID: 8, visual_signature: 'Centered product on a white ground, soft shadow beneath', 'Main Category': 'Dynamic',
        'Constructed Prompt': 'Second prompt.', 'Inspiration Image': [attachment('attB', 'b')], 'Image Bria Fibo': [attachment('attG', 'g')],
        'Prompt from Bria Fibo': '{"short_description":"x"}' } },
      { id: 'recCCC', fields: { ID: 9 } },   // an empty row in the source
    ],
  };
}
const download = async a => png(a.__seed);
const run = (snap, opts = {}) => importReferences({ snapshot: snap, previewHash: previewReferences({ snapshot: snap }).hash }, { download, ...opts });
const recordFile = id => path.join(getStorageRoot(), 'data', 'references', id + '.md');
const filesOnDisk = () => fs.readdirSync(path.join(getStorageRoot(), 'files')).filter(f => !f.startsWith('.')).sort();

test('the mapping keeps the prompt word for word and cleans only what is broken', () => {
  const item = mapReference(snapshot().records[0]);
  assert.equal(item.id, 'ref-0007');
  assert.equal(item.airtable_id, 'recAAA');
  assert.equal(item.fields.prompt, PROMPT);                       // not trimmed, not re-wrapped
  assert.deepEqual(item.fields.tags, ['Electronics & Technology', 'Home & Garden']);   // stray brackets off, duplicate folded
  assert.equal(item.fields.gender_fit, 'female');
  assert.equal(item.fields.category, 'ADs');
  assert.equal(item.fields.name, 'Centered product on a white ground');          // the first clause is the title
  assert.equal(item.fields.signature, 'Centered product on a white ground, soft shadow beneath');
  assert.ok(item.body.startsWith('A calm product shot.'), 'the concept is the first paragraph — the summary the document shows');
  assert.ok(item.body.includes('## Concept analysis\n\n- **Main concept:** A calm product shot.'), 'analysis JSON becomes readable Markdown');
  assert.equal(mapReference({ id: 'recX', fields: {} }), null, 'a row with no number is not importable');
});

test('a title is a whole phrase, never a cut-off sentence', () => {
  assert.equal(titleFrom('Monolithic black product silhouette with suspended droplet against deep navy-to-gray gradient background', 'x'),
    'Monolithic black product silhouette with suspended droplet');
  assert.equal(titleFrom('Full-street coverage of dense, colorful crowd', 'x'), 'Full-street coverage of dense, colorful crowd');
  assert.equal(titleFrom('', 'Reference 0042'), 'Reference 0042');
  for (const s of ['Sharp central subject at 15% frame size, surrounded by blur', 'A'.repeat(40) + ' ' + 'b'.repeat(60)]) {
    assert.ok(titleFrom(s, 'x').length <= 72 && !titleFrom(s, 'x').endsWith('…'));
  }
});

test('the dry run counts everything and writes nothing', () => {
  const root = freshRoot();
  const preview = previewReferences({ snapshot: snapshot() });
  assert.deepEqual(
    { records: preview.counts.records, importable: preview.counts.importable, rejected: preview.counts.rejected,
      with_image: preview.counts.with_image, with_prompt: preview.counts.with_prompt, generated: preview.counts.with_generated_image },
    { records: 3, importable: 2, rejected: 1, with_image: 2, with_prompt: 2, generated: 1 });
  assert.equal(preview.rejected[0].id, 'ref-0009');
  assert.equal(getCollection(REFERENCES_ID), null, 'a preview must not create the collection');
  assert.ok(!fs.existsSync(path.join(root, 'data')) && !fs.existsSync(path.join(root, 'files')));
});

test('import writes through the pipeline, stores pictures by content, and reads back identical', async () => {
  freshRoot();
  const report = await run(snapshot());
  assert.equal(report.created, 2);
  assert.equal(report.failed_downloads.length, 0);
  assert.equal(report.refused.length, 0);

  const a = readMd(recordFile('ref-0007'));
  assert.equal(a.data.prompt, PROMPT, 'the prompt on disk parses back byte-identical');
  assert.equal(a.data.airtable_id, 'recAAA');
  assert.equal(a.data.provenance, 'pipeline', 'written by records.mjs, so it is not quarantined');
  assert.equal(a.data.created_by, 'crystal');
  const sha = crypto.createHash('sha256').update(png('a')).digest('hex');
  assert.equal(a.data.image, 'files/' + sha + '.png');
  assert.deepEqual(fs.readFileSync(path.join(getStorageRoot(), a.data.image)), png('a'));

  // Two references with the same title are two files — a name match must not fold them together.
  const b = readMd(recordFile('ref-0008'));
  assert.equal(b.data.prompt, 'Second prompt.');
  assert.ok(b.data.generated_image.startsWith('files/') && b.data.generated_image !== b.data.image);
  assert.equal(documentsFor(REFERENCES_ID).documents.length, 2);

  // The collection is a gallery by shape, with a view per category.
  const schema = getCollection(REFERENCES_ID);
  assert.ok(schema.fields.find(f => f.key === 'image').primary_media);
  assert.ok(schema.fields.find(f => f.key === 'prompt').multiline);
  const views = listViews(REFERENCES_ID).views;
  assert.equal(views[0].type, 'gallery');
  assert.deepEqual([views[0].size, views[0].fit, views[0].fields], ['m', 'contain', ['category', 'tags']]);
  assert.deepEqual(views.map(v => v.label), ['Everything', 'ADs', 'Dynamic']);
});

test('a second run adds nothing, and local edits survive it', async () => {
  freshRoot();
  await run(snapshot());
  const before = filesOnDisk();
  // The person renames the record's title by hand, in the file — it is their workspace.
  const file = recordFile('ref-0007');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('name: Centered product on a white ground', 'name: My own name for it'));

  const changed = snapshot();
  changed.records[0].fields['Constructed Prompt'] = 'A DIFFERENT PROMPT FROM AIRTABLE';
  const again = await run(changed);
  assert.deepEqual({ created: again.created, repaired: again.repaired, skipped: again.skipped }, { created: 0, repaired: 0, skipped: 2 });
  assert.deepEqual(filesOnDisk(), before);
  assert.equal(fs.readdirSync(path.dirname(file)).filter(f => f.endsWith('.md') && !f.startsWith('.')).length, 2, 'no duplicate records');
  const kept = readMd(file).data;
  assert.equal(kept.name, 'My own name for it');
  assert.equal(kept.prompt, PROMPT, 're-importing never overwrites what is already here');
});

test('a failed download costs no record, is reported, and the next run fills it in', async () => {
  freshRoot();
  const flaky = async a => { if (a.id === 'attA') throw new Error('HTTP 410'); return png(a.__seed); };
  const first = await run(snapshot(), { download: flaky });
  assert.equal(first.created, 2);
  assert.deepEqual(first.failed_downloads.map(f => [f.id, f.field, f.error]), [['ref-0007', 'image', 'HTTP 410']]);
  assert.equal(readMd(recordFile('ref-0007')).data.image, undefined);
  assert.equal(readMd(recordFile('ref-0007')).data.prompt, PROMPT);

  const preview = previewReferences({ snapshot: snapshot() });
  assert.equal(preview.counts.to_repair, 1);
  const second = await run(snapshot());
  assert.deepEqual({ created: second.created, repaired: second.repaired, skipped: second.skipped }, { created: 0, repaired: 1, skipped: 1 });
  assert.ok(readMd(recordFile('ref-0007')).data.image.startsWith('files/'));
});

test('an existing references collection is used as it stands, never rewritten', async () => {
  freshRoot();
  saveCollection({ id: REFERENCES_ID, label: 'Mine', query: { path: 'data/references/**' },
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'image', type: 'file', primary_media: true }] });
  const report = await run(snapshot());
  assert.equal(report.collection_created, false);
  assert.equal(getCollection(REFERENCES_ID).label, 'Mine');
  assert.equal(report.created, 2);
});

test('only the operator can import, and a stale preview is refused', async () => {
  freshRoot();
  const snap = snapshot();
  const previewHash = previewReferences({ snapshot: snap }).hash;
  await assert.rejects(importReferences({ snapshot: snap, previewHash }, { actor: 'scout-fb', download }), e => e.status === 403);
  await assert.rejects(importReferences({ snapshot: snap, previewHash: 'not-the-hash' }, { download }), e => e.status === 409);
  assert.throws(() => previewReferences({ snapshot: { nope: true } }), /records/);
  assert.equal(getCollection(REFERENCES_ID), null);
});

test('attachments are named by their content and never overwritten', () => {
  const root = freshRoot();
  const first = storeAttachment(png('z'), { type: 'image/png', name: 'whatever.bin' });
  assert.equal(first.existed, false);
  assert.match(first.path, /^files\/[0-9a-f]{64}\.png$/);
  assert.equal(storeAttachment(png('z'), { type: 'image/png' }).existed, true, 'the same bytes are one file');
  assert.equal(attachmentExt({ type: 'image/jpeg' }), '.jpg');
  assert.equal(attachmentExt({ type: '', name: 'shot.JPEG' }), '.jpg');
  assert.throws(() => storeAttachment(Buffer.from('<script>'), { type: 'text/html', name: 'x.html' }), /unsupported/);
  // A file under the same name with different bytes is somebody's — reported, not replaced.
  fs.writeFileSync(path.join(root, first.path), 'tampered');
  assert.throws(() => storeAttachment(png('z'), { type: 'image/png' }), e => e.status === 409);
  assert.equal(fs.readFileSync(path.join(root, first.path), 'utf8'), 'tampered');
});
