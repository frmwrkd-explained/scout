// The reference-library skill reads the library with NO dependencies — it is meant to be copied out
// of this repo and run beside a workspace with Scout closed. So it carries its own frontmatter
// reader, and "the prompt, word for word" is only as true as that reader is exact.
//
// Every fixture here is written by `store.writeMd`, i.e. by the same gray-matter/js-yaml path that
// writes real records, and read back by the skill's parser. If the two ever disagree on a string,
// a prompt somebody pastes into a generator is not the prompt they saved.
import './_env.mjs'; // FIRST — sets SCOUT_CONFIG/SCOUT_DATA before store.mjs captures them
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempRoots } from './_env.mjs';
import { writeMd, readMd } from '../backend/store.mjs';
import { parseDocument, findRecords, loadLibrary, composePrompt, resolveWorkspace } from '../skills/reference-library/reflib.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'reference-library', 'reflib.mjs');

// Each of these has bitten a hand-rolled YAML reader somewhere: js-yaml picks a different scalar
// style for almost every one (plain, single-quoted, double-quoted, `|`, `>`, with and without
// indentation and chomping indicators).
const NASTY = {
  folded: 'Use the provided product image unchanged. Preserve all product details, colors, branding, materials, shape.\nCore concept: Product wrapped in oversized puffy yellow cushions on a perfectly color-matched yellow background.\n\nComposition structure:\n- Product centered and slightly above the vertical midline, dominant in frame.\n- Cushions embrace the product in the midground.',
  blank_runs: 'first paragraph that is long enough to be folded by the dumper at eighty columns wide\n\n\n\nfourth line after three blank ones\n\nlast',
  more_indented: 'Layers, each one long enough that the dumper has a reason to fold this scalar somewhere:\n  1. background plate\n    a. nested deeper\n  2. hero\nback at the margin\n\n  indented after a blank line\nend',
  leading_space: '  starts with two spaces and then runs long enough to be folded across more than one line of output\nsecond line',
  trailing_spaces: 'a line that ends in spaces   \nanother one \nand a clean one',
  trailing_newline: 'ends with one newline, and is long enough to be written as a block scalar by the dumper\nsecond\n',
  trailing_newlines: 'ends with three newlines, and is long enough to be written as a block scalar by the dumper\nsecond\n\n\n',
  dash_line: '- starts like a list item\n- and so does this\nplain',
  hash_line: '# starts like a comment\nmiddle # not a comment\nend',
  colon_line: ': starts with a colon\nkey: value on a line\ntrailing colon:',
  quotes: 'She said "keep it \'exactly\' like this" — and it\'s kept.',
  rule: '---\nthree dashes open this value\n---\nand close it',
  unicode: 'Ratio 6–8 cushions, café table, naïve façade, 🍋 lemon, 日本語, non-breaking\u00A0space',
  long_line: 'word '.repeat(400).trim(),
  tabs: 'column\tone\n\tindented by a tab\nend\t',
  one_word: 'Minimal',
  number_like: '5002',
  bool_like: 'true',
  null_like: 'null',
  date_like: '2026-11-17',
  no: 'no',
  only_newline: '\n',
  windows: 'line one\r\nline two\r\n',
  backslashes: 'C:\\Users\\theo\\refs and a \\n that is not a newline',
  brackets: '[PRODUCT] on a plinth, {curly} and [35%, 60%] ranges, *star, &amp, !bang, %percent, @at, `tick`',
};

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

test('the skill reads back every string exactly as the store wrote it', () => {
  const dir = tempDir('scout-refskill-parse-');
  for (const [name, value] of Object.entries(NASTY)) {
    const file = path.join(dir, name + '.md');
    writeMd(file, { name, prompt: value, tags: ['a & b', value.slice(0, 40), '- dash'], airtable_number: 7, flag: false, empty: null }, 'Body of ' + name + '.\n\n---\n\nstill the body\n');
    const mine = parseDocument(fs.readFileSync(file, 'utf8'));
    const theirs = readMd(file);
    assert.equal(mine.data.prompt, value, name + ': prompt differs from what was saved');
    assert.deepEqual(mine.data, theirs.data, name + ': frontmatter differs from gray-matter');
    assert.equal(mine.body, theirs.content, name + ': body differs from gray-matter');
  }
});

test('nested values, lists of records and empty collections parse like gray-matter', () => {
  const dir = tempDir('scout-refskill-shapes-');
  const file = path.join(dir, 'shapes.md');
  const data = {
    name: 'Shapes', count: 12, ratio: 0.75, negative: -3, big: 1e21, on: true, nothing: null,
    none: [], blank: {}, empty_string: '',
    nested: { deep: { deeper: 'value: with colon', list: ['x', 'y'] }, n: 1 },
    history: [{ at: '2026-11-17', by: 'crystal', note: 'first\nsecond line that is long enough to make the dumper choose a block scalar for it' }, { at: '2026-11-18', by: 'vetter' }],
    'key with space': 'ok', 'quoted: key': 'also ok',
  };
  writeMd(file, data, '');
  assert.deepEqual(parseDocument(fs.readFileSync(file, 'utf8')).data, readMd(file).data);
});

// A deterministic fuzz over the characters that decide which YAML style js-yaml reaches for.
test('fuzz: 400 generated strings survive the round trip', () => {
  const dir = tempDir('scout-refskill-fuzz-');
  const file = path.join(dir, 'fuzz.md');
  const alphabet = ['a', 'B', ' ', ' ', '\n', '\n', '\t', '-', ':', '#', "'", '"', '\\', '>', '|', '[', ']', '{', '}', ',', '&', '*', '!', '%', '@', '`', '?', '=', '—', 'é', '🍋', '0', '7', '.', 'word ', 'longer phrase here '];
  let seed = 20261117;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (let run = 0; run < 400; run++) {
    const length = 1 + (next() % (run % 5 === 0 ? 260 : 40));
    let value = '';
    for (let k = 0; k < length; k++) value += alphabet[next() % alphabet.length];
    writeMd(file, { prompt: value, after: 'sentinel' }, 'body\n');
    const mine = parseDocument(fs.readFileSync(file, 'utf8'));
    assert.equal(mine.data.prompt, value, 'run ' + run + ' — ' + JSON.stringify(value));
    assert.equal(mine.data.after, 'sentinel', 'run ' + run + ' lost the key after the prompt');
  }
});

// ── the CLI, against a small library on disk ───────────────────────────────────────────────────

function library() {
  const root = tempDir('scout-refskill-ws-');
  const refs = path.join(root, 'data', 'references');
  fs.mkdirSync(path.join(root, 'files'), { recursive: true });
  fs.writeFileSync(path.join(root, 'files', 'aaa.jpg'), 'jpeg bytes');
  writeMd(path.join(refs, 'ref-0001.md'), {
    name: 'Product wrapped in yellow cushions', image: 'files/aaa.jpg', category: 'ADs',
    tags: ['Food & Beverage', 'Home & Garden'], prompt: NASTY.folded,
    signature: 'Product wrapped in oversized yellow pillows against matching yellow background',
    airtable_id: 'recAAA111', airtable_number: 1,
  }, 'A soft-sculpture ad.\n');
  writeMd(path.join(refs, 'ref-0002.md'), {
    name: 'Shark behind a terrified swimmer', image: 'files/missing.jpg', category: 'YouTube Thumbnails',
    tags: ['Travel & Hospitality'], prompt: 'Place [PRODUCT] at center.\nAdd [BRAND LOGO] top right, [PRODUCT] stays sharp.  \n',
    airtable_id: 'recBBB222', airtable_number: 2,
  }, '');
  writeMd(path.join(refs, 'ref-0003.md'), { name: 'No prompt yet', category: 'ADs', tags: ['Home & Garden'], airtable_id: 'recCCC333', airtable_number: 3 }, '');
  writeMd(path.join(refs, 'ref-0004.md'), { name: 'Archived cushions', category: 'ADs', prompt: 'yellow cushions', archived: true, airtable_number: 4 }, '');
  // What an exFAT volume leaves beside every file. It is not a record.
  fs.writeFileSync(path.join(refs, '._ref-0001.md'), Buffer.from([0, 5, 22, 7, 0, 2, 0, 0]));
  return root;
}

const run = (root, ...args) => execFileSync(process.execPath, [SCRIPT, ...args, '--workspace', root], { encoding: 'utf8' });

test('find filters by category, tag and words in the prompt', () => {
  const root = library();
  const all = JSON.parse(run(root, 'find', '--json'));
  assert.equal(all.total, 3, 'archived records and ._ sidecars are not results');
  assert.deepEqual(all.results.map(r => r.id), ['ref-0001', 'ref-0002', 'ref-0003']);

  const ads = JSON.parse(run(root, 'find', '--category', 'ads', '--json'));
  assert.deepEqual(ads.results.map(r => r.id), ['ref-0001', 'ref-0003']);
  const tagged = JSON.parse(run(root, 'find', '--tag', 'home & garden', '--tag', 'Food & Beverage', '--json'));
  assert.deepEqual(tagged.results.map(r => r.id), ['ref-0001']);
  const words = JSON.parse(run(root, 'find', '--text', 'CUSHIONS midline', '--json'));
  assert.deepEqual(words.results.map(r => r.id), ['ref-0001']);
  assert.equal(words.results[0].image_path, path.join(root, 'files', 'aaa.jpg'));
  assert.equal(words.results[0].prompt_length, NASTY.folded.length);
  assert.equal(JSON.parse(run(root, 'find', '--has-prompt', '--json')).total, 2);
  assert.equal(JSON.parse(run(root, 'find', '--limit', '1', '--json')).shown, 1);
  assert.match(run(root, 'find', '--text', 'nothing-like-this'), /No references match/);
});

test('show --prompt prints the prompt and nothing else, byte for byte', () => {
  const root = library();
  const out = execFileSync(process.execPath, [SCRIPT, 'show', 'ref-0001', '--prompt', '--workspace', root]);
  assert.equal(Buffer.compare(out, Buffer.from(NASTY.folded, 'utf8')), 0);
  // trailing spaces and a trailing newline are part of a prompt too
  const second = execFileSync(process.execPath, [SCRIPT, 'show', 'recBBB222', '--prompt', '--workspace', root]);
  assert.equal(second.toString('utf8'), 'Place [PRODUCT] at center.\nAdd [BRAND LOGO] top right, [PRODUCT] stays sharp.  \n');

  const detail = JSON.parse(run(root, 'show', 'ref-0002', '--json'));
  assert.equal(detail.image_path, path.join(root, 'files', 'missing.jpg'));
  assert.equal(detail.image_exists, false);
  assert.equal(detail.airtable_id, 'recBBB222');
});

test('compose wraps the reference prompt and only edits what --fill names', () => {
  const root = library();
  const plain = JSON.parse(run(root, 'compose', 'ref-0001', '--subject', 'a red wool sweater', '--json'));
  assert.ok(plain.prompt.startsWith('Subject: a red wool sweater\n'));
  assert.ok(plain.prompt.endsWith('\n\n' + NASTY.folded), 'the reference prompt follows the header unchanged');
  assert.equal(plain.reference_prompt, NASTY.folded);
  assert.equal(plain.image_path, path.join(root, 'files', 'aaa.jpg'));
  assert.deepEqual(plain.placeholders, []);

  const open = JSON.parse(run(root, 'compose', 'ref-0002', '--subject', 'a diving watch', '--json'));
  assert.deepEqual(open.placeholders, ['[PRODUCT]', '[BRAND LOGO]']);

  const filled = JSON.parse(run(root, 'compose', 'ref-0002', '--subject', 'a diving watch', '--fill', 'PRODUCT=the diving watch', '--fill', 'MISSING=x', '--json'));
  assert.deepEqual(filled.filled, [
    { placeholder: '[PRODUCT]', value: 'the diving watch', count: 2 },
    { placeholder: '[MISSING]', value: 'x', count: 0 },
  ]);
  assert.deepEqual(filled.placeholders, ['[BRAND LOGO]']);
  assert.ok(filled.prompt.endsWith('Place the diving watch at center.\nAdd [BRAND LOGO] top right, the diving watch stays sharp.  \n'));

  const text = run(root, 'compose', 'ref-0002', '--subject', 'a diving watch');
  assert.match(text, /Reference image: .*missing\.jpg/);
  assert.match(text, /Still to fill: +\[PRODUCT\] \[BRAND LOGO\]/);
});

test('it refuses clearly, and it has no way to write', () => {
  const root = library();
  const before = fs.readdirSync(path.join(root, 'data', 'references')).sort();
  const noPrompt = spawnSync(process.execPath, [SCRIPT, 'compose', 'ref-0003', '--subject', 'x', '--workspace', root], { encoding: 'utf8' });
  assert.equal(noPrompt.status, 2);
  assert.match(noPrompt.stderr, /has no prompt/);
  const unknown = spawnSync(process.execPath, [SCRIPT, 'show', 'ref-9999', '--workspace', root], { encoding: 'utf8' });
  assert.match(unknown.stderr, /No reference "ref-9999"/);
  for (const verb of ['add', 'write', 'delete', 'import', 'edit']) {
    const r = spawnSync(process.execPath, [SCRIPT, verb, 'ref-0001', '--workspace', root], { encoding: 'utf8' });
    assert.equal(r.status, 2, verb + ' is not a command');
  }
  assert.deepEqual(fs.readdirSync(path.join(root, 'data', 'references')).sort(), before);

  const lost = spawnSync(process.execPath, [SCRIPT, 'stats'], { encoding: 'utf8', cwd: os.tmpdir(), env: { ...process.env, SCOUT_WORKSPACE: '' } });
  assert.equal(lost.status, 2);
  assert.match(lost.stderr, /--workspace/);
  assert.match(lost.stderr, /SCOUT_WORKSPACE/);
  assert.match(lost.stderr, /data\/references/);
});

test('the workspace is found from the flag, the env var, or a parent folder', () => {
  const root = library();
  assert.equal(resolveWorkspace(root, {}, os.tmpdir()), root);
  assert.equal(resolveWorkspace(null, { SCOUT_WORKSPACE: root }, os.tmpdir()), root);
  assert.equal(resolveWorkspace(null, {}, path.join(root, 'data', 'references')), root);
  const stats = JSON.parse(execFileSync(process.execPath, [SCRIPT, 'stats', '--json'], { encoding: 'utf8', cwd: path.join(root, 'data'), env: { ...process.env, SCOUT_WORKSPACE: '' } }));
  assert.deepEqual(stats, { total: 3, with_image: 2, image_missing_on_disk: 1, with_prompt: 2, by_category: { ADs: 2, 'YouTube Thumbnails': 1 } });
  // the library functions are importable too, for a caller that would rather not shell out
  const records = loadLibrary(root);
  assert.equal(findRecords(records, { text: 'shark' }).length, 1);
  assert.throws(() => composePrompt(records[0], ''), /--subject/);
});
