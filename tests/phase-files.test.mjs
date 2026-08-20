// The file browser — Law 8's "way down". Read-only, and it must not become a way OUT.
//
// The traversal cases are the point of this file. `../../etc/passwd` and an absolute path are
// both refused, and so is a symlink planted inside the workspace: a browser that can be talked
// into reading /etc/passwd is a local-file-disclosure hole on an unauthenticated localhost API.
import '../tests/_env.mjs'; // FIRST — sets SCOUT_CONFIG/SCOUT_DATA before store.mjs captures them
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { tempRoots } from './_env.mjs';
import { setStorageRoot, getStorageRoot } from '../backend/store.mjs';
import { listDir, readFile, revealPath, resolveRel, registerFileRoutes, FileError, MAX_PREVIEW_BYTES } from '../backend/files.mjs';

// A workspace of our own, shaped like the seeded one. Deliberately NOT helpers.freshRoot(): that
// imports backend/index.mjs and boots the whole app, and none of this needs the app.
function freshWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-files-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, 'data', 'guests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'goals'), { recursive: true });
  fs.writeFileSync(path.join(root, 'me.md'), '---\nname: Crystal\n---\n\nA producer.\n');
  fs.writeFileSync(path.join(root, 'data', 'guests', 'maria-santos.md'),
    '---\nname: Maria Santos\nstage: shortlist\n---\n\n---\n\nA nurse who started cooking on camera.\n');
  fs.writeFileSync(path.join(root, 'goals', 'book-8-guests.md'), '---\ntarget: 8\n---\n\nBook eight.\n');
  // noise the tree must not show: the exFAT AppleDouble sidecars, Finder metadata, and the
  // in-flight half of store.writeMd's tmp+rename
  fs.writeFileSync(path.join(root, 'data', 'guests', '._maria-santos.md'), 'apple double');
  fs.writeFileSync(path.join(root, '.DS_Store'), 'finder');
  fs.writeFileSync(path.join(root, 'data', 'guests', 'maria-santos.md.4711.tmp'), 'half written');
  setStorageRoot(root);
  return root;
}

// One express app for the HTTP cases, with a revealer stub standing in for index.mjs's revealInOS.
const revealed = [];
function httpApp() {
  const app = express();
  app.use(express.json());
  registerFileRoutes(app, { revealInOS: (target, select) => revealed.push([target, !!select]) });
  return app;
}
let baseUrl = null;
async function url() {
  if (baseUrl) return baseUrl;
  const server = await new Promise(resolve => { const s = httpApp().listen(0, '127.0.0.1', () => resolve(s)); });
  server.unref();
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  return baseUrl;
}
async function get(p) {
  const r = await fetch((await url()) + p);
  let body = null; try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}
async function post(p, payload) {
  const r = await fetch((await url()) + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  let body = null; try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}

// ── traversal ────────────────────────────────────────────────────────────────────────────────

test('a `..` traversal is refused, not clamped', () => {
  freshWorkspace();
  for (const bad of ['../../etc/passwd', '..', 'data/../../etc/passwd', 'data/guests/../../../..']) {
    assert.throws(() => listDir(bad), e => e instanceof FileError && e.status === 400, `listDir("${bad}") should refuse`);
    assert.throws(() => readFile(bad), e => e instanceof FileError && e.status === 400, `readFile("${bad}") should refuse`);
  }
});

test('an absolute path is refused', () => {
  const root = freshWorkspace();
  for (const bad of ['/etc/passwd', '/', root, path.join(root, 'me.md'), 'C:\\Windows\\win.ini']) {
    assert.throws(() => listDir(bad), e => e instanceof FileError && e.status === 400, `listDir("${bad}") should refuse`);
    assert.throws(() => readFile(bad), e => e instanceof FileError && e.status === 400, `readFile("${bad}") should refuse`);
  }
});

test('backslashes are separators too — a Windows-style traversal is refused', () => {
  freshWorkspace();
  assert.throws(() => readFile('..\\..\\etc\\passwd'), e => e.status === 400);
  assert.throws(() => readFile('data\\..\\..\\etc\\passwd'), e => e.status === 400);
});

test('a control byte in a path is refused', () => {
  freshWorkspace();
  // written as an escape, never as a literal byte: a raw control byte in source makes the file
  // invisible to grep (HANDOVER §3, and it has now happened twice in this repo)
  assert.throws(() => readFile('me.md\u0000.png'), e => e instanceof FileError && e.status === 400);
});

test('a symlink planted inside the workspace is not a way out', () => {
  const root = freshWorkspace();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-outside-'));
  tempRoots.push(outside);
  fs.writeFileSync(path.join(outside, 'secrets.md'), 'not yours');
  try { fs.symlinkSync(outside, path.join(root, 'escape')); }
  catch { return; } // no symlink privilege (Windows CI) — the other guards still cover it
  assert.throws(() => readFile('escape/secrets.md'), e => e instanceof FileError && e.status === 400);
  assert.throws(() => listDir('escape'), e => e instanceof FileError && e.status === 400);
});

test('the root itself resolves, and only inside it', () => {
  const root = freshWorkspace();
  assert.equal(resolveRel('').abs, path.resolve(root));
  assert.equal(resolveRel('data/guests').rel, 'data/guests');
  assert.equal(resolveRel('./data//guests/').rel, 'data/guests'); // empty + '.' segments collapse
});

// ── listing ──────────────────────────────────────────────────────────────────────────────────

test('listDir shows the real folder tree, one level at a time', () => {
  freshWorkspace();
  const top = listDir('');
  assert.deepEqual(top.dirs.map(d => d.name), ['data', 'goals']);
  assert.deepEqual(top.files.map(f => f.name), ['me.md']);
  assert.equal(top.path, '');
  assert.equal(top.parent, null);

  const guests = listDir('data/guests');
  assert.deepEqual(guests.files.map(f => f.name), ['maria-santos.md']);
  assert.equal(guests.files[0].path, 'data/guests/maria-santos.md'); // workspace-relative, clickable
  assert.equal(guests.parent, 'data');
  assert.ok(guests.files[0].size > 0 && guests.files[0].modified);
});

test('AppleDouble sidecars, .DS_Store and half-written tmp files are not part of the tree', () => {
  freshWorkspace();
  const names = [...listDir('').files, ...listDir('').dirs].map(e => e.name)
    .concat(listDir('data/guests').files.map(f => f.name));
  assert.ok(!names.some(n => n.startsWith('._')), 'AppleDouble sidecar leaked into the tree');
  assert.ok(!names.includes('.DS_Store'));
  assert.ok(!names.some(n => n.endsWith('.tmp')));
});

test('listing a file, or a folder that is not there, says which', () => {
  freshWorkspace();
  assert.throws(() => listDir('me.md'), e => e.status === 400);
  assert.throws(() => listDir('nope'), e => e.status === 404);
});

// ── reading ──────────────────────────────────────────────────────────────────────────────────

test('readFile returns the raw bytes — frontmatter intact, body unparsed', () => {
  freshWorkspace();
  const f = readFile('data/guests/maria-santos.md');
  assert.equal(f.name, 'maria-santos.md');
  assert.equal(f.ext, '.md');
  assert.equal(f.binary, false);
  assert.ok(f.text.startsWith('---\nname: Maria Santos'), 'frontmatter must survive — this IS the evidence altitude');
  // the body's own `---` rule must still be in the body, not hoisted into frontmatter
  assert.ok(f.text.includes('\n---\n\nA nurse'), 'the body rule was eaten');
});

test('a binary file is reported, not painted', () => {
  const root = freshWorkspace();
  fs.writeFileSync(path.join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const f = readFile('shot.png');
  assert.equal(f.binary, true);
  assert.equal(f.text, null);
  assert.equal(f.size, 6);
});

test('a .md that is secretly binary is reported as binary, not rendered', () => {
  const root = freshWorkspace();
  fs.writeFileSync(path.join(root, 'broken.md'), Buffer.concat([Buffer.from('---\n'), Buffer.from([0x00]), Buffer.from('x')]));
  assert.equal(readFile('broken.md').binary, true);
});

test('an oversized text file is truncated and says so', () => {
  const root = freshWorkspace();
  fs.writeFileSync(path.join(root, 'big.log'), 'x'.repeat(MAX_PREVIEW_BYTES + 4096));
  const f = readFile('big.log');
  assert.equal(f.truncated, true);
  assert.equal(f.text.length, MAX_PREVIEW_BYTES);
  assert.equal(f.size, MAX_PREVIEW_BYTES + 4096);
});

test('reading nothing, or a folder, is a usable error', () => {
  freshWorkspace();
  assert.throws(() => readFile(''), e => e.status === 400);
  assert.throws(() => readFile('data'), e => e.status === 400);
  assert.throws(() => readFile('data/guests/nobody.md'), e => e.status === 404);
});

// ── reveal ───────────────────────────────────────────────────────────────────────────────────

test('reveal does not spawn — it calls the revealer index.mjs already owns', () => {
  freshWorkspace();
  const calls = [];
  const r = revealPath('data/guests/maria-santos.md', { revealInOS: (t, s) => calls.push([t, s]) });
  assert.equal(r.ok, true);
  assert.equal(r.selected, true, 'a file is revealed INSIDE its folder (open -R), so the record is selected');
  assert.equal(calls.length, 1);
  assert.ok(path.isAbsolute(calls[0][0]));
  assert.equal(calls[0][1], true);

  const dir = revealPath('data/guests', { revealInOS: (t, s) => calls.push([t, s]) });
  assert.equal(dir.selected, false, 'a folder is opened, not selected');
});

test('reveal without a revealer is a 501 that names the fix, never a silent no-op', () => {
  freshWorkspace();
  // the message must name BOTH the dep and where it is mounted — this is the one thing a wiring
  // mistake cannot be allowed to hide, because the symptom is "the button does nothing"
  assert.throws(() => revealPath('me.md', {}), e =>
    e.status === 501 && /registerFileRoutes/.test(e.message) && /revealInOS/.test(e.message));
  assert.throws(() => revealPath('me.md', { logEvent: () => {} }), e => e.status === 501,
    'a deps object without revealInOS is still no revealer');
});

test('reveal refuses a traversal and a missing path', () => {
  freshWorkspace();
  const noop = () => {};
  assert.throws(() => revealPath('../../etc', { revealInOS: noop }), e => e.status === 400);
  assert.throws(() => revealPath('/etc', { revealInOS: noop }), e => e.status === 400);
  assert.throws(() => revealPath('nope.md', { revealInOS: noop }), e => e.status === 404);
});

// ── the routes ───────────────────────────────────────────────────────────────────────────────

test('GET /api/files lists, GET /api/files/read reads, POST /api/files/reveal reveals', async () => {
  freshWorkspace();
  revealed.length = 0;

  const top = await get('/api/files');
  assert.equal(top.status, 200);
  assert.deepEqual(top.body.dirs.map(d => d.name), ['data', 'goals']);

  const sub = await get('/api/files?dir=' + encodeURIComponent('data/guests'));
  assert.equal(sub.status, 200);
  assert.equal(sub.body.files[0].path, 'data/guests/maria-santos.md');

  const read = await get('/api/files/read?path=' + encodeURIComponent('data/guests/maria-santos.md'));
  assert.equal(read.status, 200);
  assert.ok(read.body.text.includes('Maria Santos'));

  const rev = await post('/api/files/reveal', { path: 'data/guests/maria-santos.md' });
  assert.equal(rev.status, 200);
  assert.equal(revealed.length, 1);
  assert.equal(revealed[0][1], true);
});

test('the routes refuse a traversal with 400 and a readable message', async () => {
  freshWorkspace();
  for (const bad of ['../../etc/passwd', '/etc/passwd']) {
    const l = await get('/api/files?dir=' + encodeURIComponent(bad));
    assert.equal(l.status, 400, `GET /api/files?dir=${bad}`);
    assert.match(l.body.error, /workspace/);

    const r = await get('/api/files/read?path=' + encodeURIComponent(bad));
    assert.equal(r.status, 400, `GET /api/files/read?path=${bad}`);
    assert.match(r.body.error, /workspace/);

    const v = await post('/api/files/reveal', { path: bad });
    assert.equal(v.status, 400, `POST /api/files/reveal ${bad}`);
  }
});

test('/api/files/read is matched before /api/files — the listing route never swallows it', async () => {
  freshWorkspace();
  const r = await get('/api/files/read?path=me.md');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'me.md');
});

test('the browser writes nothing', () => {
  const root = freshWorkspace();
  const before = fs.readdirSync(path.join(root, 'data', 'guests')).sort();
  listDir('');
  listDir('data/guests');
  readFile('data/guests/maria-santos.md');
  revealPath('data/guests/maria-santos.md', { revealInOS: () => {} });
  assert.deepEqual(fs.readdirSync(path.join(root, 'data', 'guests')).sort(), before);
  assert.equal(getStorageRoot(), root);
});
