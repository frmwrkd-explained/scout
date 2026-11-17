// The record page: a record opens on what it IS — its picture, then the long text a person came
// for (a prompt), then the note. Gated here: media comes from the schema's `file` fields and is
// served through the one raw-file route; long text keeps its line breaks and appears exactly once;
// the file editor treats a value as a workspace-relative path; labels are never cut off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadJsx } from './helpers.mjs';

const { default: Document, recordMedia, longTextFields } = await loadJsx('frontend/Document.jsx');
const { default: PropertyRows } = await loadJsx('frontend/PropertyRows.jsx');
const { LongText, Editor } = await loadJsx('frontend/cells.jsx');
const { mediaPath, mediaLabel } = await loadJsx('frontend/media.js');

const SHA = 'ab12cd34' + 'e'.repeat(56);
const collection = { id: 'references', label: 'References', fields: [
  { key: 'name', type: 'text', primary: true },
  { key: 'image', type: 'file', primary_media: true },
  { key: 'category', type: 'select', options: ['ADs'] },
  { key: 'signature', type: 'text', multiline: true },
  { key: 'prompt', type: 'text', multiline: true },
  { key: 'generated_image', type: 'file' },
  { key: 'generated_prompt', type: 'text', multiline: true },
  { key: 'airtable_number', type: 'number' },
] };
const PROMPT = 'Use the provided product image unchanged.\n\nComposition structure:\n- Product centered\n- Soft shadow beneath';
const data = { name: 'Centered product on a white ground', image: 'files/' + SHA + '.jpg', category: 'ADs',
  signature: 'Centered product, soft shadow', prompt: PROMPT, generated_image: 'files/clip.mp4', airtable_number: 7 };
const page = (props = {}) => renderToStaticMarkup(React.createElement(Document, {
  path: 'data/references/ref-0007.md', collection, doc: { data, content: 'A calm product shot.\n\n## Concept analysis\n\nMore.' }, ...props,
}));

test('the page leads with the picture, served through the raw-file route, and never the hash', () => {
  const html = page();
  const src = '/api/files/raw?path=' + encodeURIComponent('files/' + SHA + '.jpg');
  assert.ok(html.includes('src="' + src.replace(/&/g, '&amp;') + '"'), 'the lead image points at /api/files/raw');
  assert.match(html, /class="recordMediaLead"/);
  assert.match(html, /<button type="button" class="recordMediaBtn"/, 'the picture is a real button that opens the viewer');
  // The second file is a video: native controls, shown smaller, named by its field.
  assert.match(html, /<video[^>]*controls/);
  assert.match(html, /recordMediaCaption">Generated image</);
  assert.ok(html.indexOf('recordMediaLead') < html.indexOf('documentBody'), 'media sits above the note');
  assert.match(html, /class="recordMediaAdd/, 'a collection with a picture field offers to add one');
});

test('long text is in the reading column, word for word, once, with the prompt first', () => {
  const html = page();
  const escaped = PROMPT;   // no characters React escapes — line breaks must survive as they are
  assert.ok(html.includes(escaped), 'the prompt is on the page with its line breaks intact');
  assert.equal(html.split('Use the provided product image unchanged.').length - 1, 1, 'shown once, not repeated in a side panel');
  assert.ok(html.indexOf('recordTextLabel">Prompt<') < html.indexOf('recordTextLabel">Signature<'), 'a field keyed `prompt` leads');
  assert.match(html, /class="copyBtn"[^>]*>.*Copy/s);
  // An empty long field has no block — it would be a titled empty box on every record. It is one
  // small button that opens the block when somebody wants to write it.
  assert.ok(!html.includes('recordTextLabel">Generated prompt<'));
  assert.match(html, /recordTextAddBtn[^>]*>\+ (<!-- -->)?Generated prompt</);
  // The block IS the field: a textarea holding exactly the text, with no edit mode to enter.
  assert.match(html, /<textarea[^>]*class="longTextEdit"/);
});

test('a record with no files and no long text is just its title, its properties and its note', () => {
  const plain = { id: 'guest', label: 'Guests', fields: [{ key: 'name', type: 'text', primary: true }, { key: 'score', type: 'number' }] };
  const html = renderToStaticMarkup(React.createElement(Document, {
    path: 'data/guests/maria.md', collection: plain, doc: { data: { name: 'Maria Santos', score: 9 }, content: 'A nurse who cooks on camera.' },
  }));
  assert.ok(!html.includes('recordMedia') && !html.includes('recordText'));
  assert.match(html, /<h1>.*Maria Santos.*<\/h1>/s);
  assert.match(html, /class="documentBody"/);
});

test('the schema decides what leads: primary media first, prompt first, the title never a block', () => {
  const media = recordMedia(collection, data);
  assert.deepEqual(media.map(m => [m.label, m.kind]), [['Image', 'image'], ['Generated image', 'video']]);
  assert.deepEqual(recordMedia(collection, { image: ['a.png', 'notes.pdf'] }).map(m => [m.label, m.path, m.kind]),
    [['Image 1', 'files/a.png', 'image'], ['Image 2', 'files/notes.pdf', 'file']]);
  assert.deepEqual(recordMedia(null, data), []);
  assert.deepEqual(longTextFields(collection).map(f => f.key), ['prompt', 'signature', 'generated_prompt']);
  assert.deepEqual(longTextFields({ fields: [{ key: 'title', type: 'text', multiline: true, primary: true }] }), []);
});

test('a file value is a workspace-relative path, and its chip shows a name a person can read', () => {
  assert.equal(mediaPath('files/' + SHA + '.jpg'), 'files/' + SHA + '.jpg');
  assert.equal(mediaPath('photo.jpg'), 'files/photo.jpg', 'a bare name means under files/');
  assert.equal(mediaPath('projects/x/shot.png'), 'projects/x/shot.png');
  assert.equal(mediaPath('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(mediaLabel('files/' + SHA + '.jpg'), 'ab12cd34….jpg');

  const html = renderToStaticMarkup(React.createElement(Editor, {
    field: { key: 'image', type: 'file' }, value: 'files/' + SHA + '.jpg', onChange() {},
  }));
  assert.ok(!html.includes('files/files/'), 'the path is not prefixed twice');
  assert.match(html, /class="fileChipName"[^>]*title="files\/ab12cd34e+\.jpg"/);
  assert.match(html, />ab12cd34….jpg<\/button>/);
  assert.match(html, /class="fileChipThumb" src="\/api\/files\/raw\?path=files%2Fab12cd34/);
  assert.ok(!html.includes('+ file'), 'a single-file field that has its file offers no second one');
});

test('property labels read in full, and long text keeps its line breaks when read in a row', () => {
  const rows = renderToStaticMarkup(React.createElement(PropertyRows, {
    collection, values: data, variant: 'inspector', onChange() {}, omit: ['name', 'prompt', 'signature', 'generated_prompt'],
  }));
  assert.match(rows, />Generated image</);
  assert.match(rows, />Airtable number</);
  assert.ok(!rows.includes('text-overflow:ellipsis;white-space:nowrap">Generated'), 'a label is not truncated to one line');
  assert.ok(!rows.includes('Use the provided product image'), 'an omitted field is not drawn in the panel');

  const short = renderToStaticMarkup(React.createElement(LongText, { value: 'one\ntwo' }));
  assert.ok(short.includes('one\ntwo') && !short.includes('Show all'));
  const long = renderToStaticMarkup(React.createElement(LongText, { value: 'x'.repeat(1200), lines: 14, chars: 1100 }));
  assert.match(long, /Show all · 1,200 characters/);
  assert.match(long, /-webkit-line-clamp:14/);
});
