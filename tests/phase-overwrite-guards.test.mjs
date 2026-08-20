/* Four data-loss bugs, all the same shape: something overwrote or dropped user content while
 * reporting success. None was caught by the suite, because in each case the wrong behaviour was
 * indistinguishable from the right one unless you looked at what was already on disk.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-guards-'));
process.env.SCOUT_DATA = ROOT;
// SCOUT_DATA alone is NOT enough: `getStorageRoot()` reads the `config.md` POINTER first, and that
// file lives outside the storage root by design — so a config.md in the checkout (or one written
// by a dev server run) silently outranks SCOUT_DATA and this file reads somebody else's workspace.
// Claim both, the way tests/_env.mjs does.
process.env.SCOUT_CONFIG = path.join(ROOT, 'config.md');

const store = await import('../backend/store.mjs');
const lib = await import('../backend/library.mjs');

const ctx = name => path.join(ROOT, 'projects', 'neon', 'context', name);

test('a second upload of the same name does not overwrite the first', () => {
  const a = store.saveContextFile('neon', 'hero.png', Buffer.from('AAA'), '');
  const b = store.saveContextFile('neon', 'hero.png', Buffer.from('BBB'), '');
  assert.equal(a.name, 'hero.png');
  assert.equal(b.name, 'hero-2.png', 'the collision policy library.mjs already had');
  assert.equal(fs.readFileSync(ctx(a.name), 'utf8'), 'AAA', 'the original bytes must survive');
});

test('the stale sidecar cannot end up attached to different bytes', () => {
  // The real damage was not the lost file — it was that hero.png.meta.md (its description, tags
  // and cached fal URL, some of it produced by a paid vision call) stayed attached to whatever
  // was written over it, so a generation referencing that asset was conditioned on the wrong
  // image with nothing reporting a problem.
  const a = store.saveContextFile('neon', 'ref.png', Buffer.from('ORIGINAL'), '');
  lib.writeMeta(ctx(a.name), { description: 'a red door', falUrl: 'https://fal/red-door.png' });
  const b = store.saveContextFile('neon', 'ref.png', Buffer.from('DIFFERENT'), '');
  assert.notEqual(b.name, a.name);
  assert.equal(lib.readMeta(ctx(a.name)).description, 'a red door', 'sidecar still describes its own bytes');
  assert.equal(fs.existsSync(ctx(b.name) + '.meta.md'), false, 'the new file starts with no sidecar');
});

test('editing a note in place still lands on the same filename', () => {
  // The one caller that legitimately overwrites. Without the opt-out every save would fork
  // note-2.md, note-3.md and the edit would stop being an edit.
  const n1 = store.saveContextFile('neon', 'note.md', Buffer.from('v1'), '', { overwrite: true });
  const n2 = store.saveContextFile('neon', 'note.md', Buffer.from('v2'), '', { overwrite: true });
  assert.equal(n1.name, n2.name);
  assert.equal(fs.readFileSync(ctx('note.md'), 'utf8'), 'v2');
});

test('writeMeta preserves sidecar keys outside readMeta\'s shape', () => {
  const a = store.saveContextFile('neon', 'keys.png', Buffer.from('x'), '');
  const p = ctx(a.name);
  lib.writeMeta(p, {
    description: 'a hero',
    reconstruct: 'expensive vision output',
    handWrittenNote: 'the sidecar body invites editing, so this is a real case',
  });
  lib.writeMeta(p, { tags: ['unrelated'] });          // a tag edit must not cost anything else
  const after = store.readMd(p + '.meta.md').data;
  assert.equal(after.handWrittenNote, 'the sidecar body invites editing, so this is a real case',
    'an unknown key must survive a write — "never clobber the rest" is what this function is for');
  assert.equal(after.reconstruct, 'expensive vision output');
  assert.deepEqual(after.tags, ['unrelated']);
});

/* The fifth guard here checked that a new shot never took an id another shot already owned
 * (backend/story.mjs freeShotNo). Shots went with the film domain on 2026-08-19. The rule it
 * encoded outlives them: when ids are derived from a count but reordering renumbers something
 * else, max()+1 can collide with a live id, and a merging writer will silently overwrite it.
 * Scout mints record slugs — check this the moment slug derivation stops being the title.
 */
