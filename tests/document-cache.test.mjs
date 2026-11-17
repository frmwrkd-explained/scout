// The parse cache in backend/documents.mjs remembers what a file said for as long as the file has
// not changed. What is gated here is the half that matters: it must never be the reason somebody
// sees an old value. A change made by the app's writer, by another program editing the file, by
// a delete or by a new file must all show up on the very next read.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, writeMd, fs, path } from './helpers.mjs';
import { allDocuments, forgetParsed } from '../backend/documents.mjs';

const find = rel => allDocuments().find(d => d.path === rel);

test('a read after any kind of change sees the change', () => {
  const root = freshRoot();
  const file = path.join(root, 'data', 'notes', 'one.md');
  writeMd(file, { name: 'One', score: 1 }, 'first body\n');
  assert.equal(find('data/notes/one.md').data.score, 1);
  assert.equal(find('data/notes/one.md').data.score, 1, 'the second read is served from memory and says the same');

  // 1. the app's own writer — same byte length on purpose, the case a stat alone could miss
  writeMd(file, { name: 'One', score: 2 }, 'first body\n');
  assert.equal(find('data/notes/one.md').data.score, 2);

  // 2. another program rewrites the file (Obsidian, an agent, a text editor)
  fs.writeFileSync(file, '---\nname: One\nscore: 30\n---\nedited elsewhere, and longer\n');
  const outside = find('data/notes/one.md');
  assert.equal(outside.data.score, 30);
  assert.match(outside.content, /edited elsewhere/);

  // 3. a new file appears, and an old one goes
  fs.writeFileSync(path.join(root, 'data', 'notes', 'two.md'), '---\nname: Two\n---\n');
  assert.equal(find('data/notes/two.md').data.name, 'Two');
  fs.rmSync(file);
  assert.equal(find('data/notes/one.md'), undefined);
});

test('a caller that changes its copy does not change what the next caller reads', () => {
  const root = freshRoot();
  writeMd(path.join(root, 'data', 'notes', 'one.md'), { name: 'One', tags: ['a'] }, 'body\n');
  const mine = find('data/notes/one.md');
  mine.data.name = 'Changed in memory';
  mine.data.added = true;
  delete mine.data.tags;
  const next = find('data/notes/one.md');
  assert.deepEqual([next.data.name, next.data.added, next.data.tags], ['One', undefined, ['a']]);
});

test('a malformed file stays out until it is fixed, and emptying the cache changes nothing', () => {
  const root = freshRoot();
  const file = path.join(root, 'data', 'notes', 'bad.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '---\nname: [unclosed\n---\nbody\n');
  assert.equal(find('data/notes/bad.md'), undefined);
  assert.equal(find('data/notes/bad.md'), undefined);
  fs.writeFileSync(file, '---\nname: Fixed now\n---\nbody\n');
  assert.equal(find('data/notes/bad.md').data.name, 'Fixed now');
  forgetParsed();
  assert.equal(find('data/notes/bad.md').data.name, 'Fixed now');
});
