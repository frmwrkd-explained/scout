// Regressions for defects that were silent in production — each test fails loudly against the
// pre-fix code. Grouped here rather than scattered because they share one trait: every one of them
// was invisible (no crash, no error, no failing test) while actively costing correctness.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, fs, path, getStorageRoot, req, seedProject } from './helpers.mjs';
import { getSettings, saveSettings, paths, writeMd, readMd,
  contextDir, deleteContextFile, contextFilePath, CONTROL_FILES } from '../backend/store.mjs';
import { CONTROL_FILES as MEMORY_CONTROL_FILES } from '../backend/memory.mjs';
import { stageTrash, restoreTrash, listTrash } from '../backend/trash.mjs';
import { integrityReport, reconcile, currentRevision, changedSince, bump } from '../backend/indexer.mjs';
import { resolveBin, clearBinCache } from '../backend/jobs.mjs';

// ── store.mjs: the v1 skillRepos migration must not re-enter saveSettings ────────────────────
// getSettings() persisted the migration by calling saveSettings(), which re-read through
// getSettings(), which re-migrated… The recursion only ever ended by blowing the stack, and the
// RangeError was swallowed by getSettings()' own catch — after ~2500 rewrites of settings.md.
test('v1 skillRepos migration writes settings.md exactly once (no getSettings/saveSettings recursion)', () => {
  freshRoot();
  fs.writeFileSync(paths.settings(),
    '---\nbudget: 60\nfalApiKey: sk-live-key\nskillRepos:\n  - /legacy/a\n  - /legacy/b\n---\nv1 settings\n');

  const realWrite = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = (...a) => { writes++; return realWrite(...a); };
  let s;
  try { s = getSettings(); } finally { fs.writeFileSync = realWrite; }

  assert.equal(writes, 1, 'exactly one write — the recursive version made thousands');
  assert.ok(Array.isArray(s.skillRepos));
  assert.equal(typeof s.skillRepos[0], 'object', 'migrated to the v2 {name, paths} shape');
  assert.equal(s.falApiKey, 'sk-live-key', 'the migration must not drop the stored API key');
});

test('saveSettings folds the v1 migration into its own write instead of recursing', () => {
  freshRoot();
  fs.writeFileSync(paths.settings(), '---\nbudget: 60\nskillRepos:\n  - /legacy/a\n---\nv1\n');
  const real = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = (...a) => { writes++; return real(...a); };
  let next;
  try { next = saveSettings({ budget: 99 }); } finally { fs.writeFileSync = real; }
  assert.equal(writes, 1, 'saveSettings must write once, not recurse through getSettings');
  assert.equal(next.budget, 99);
  assert.equal(typeof next.skillRepos[0], 'object', 'migration still applied');
  assert.equal(readMd(paths.settings()).data.budget, 99, 'and it reached disk');
});

// a non-array skillRepos (hand-edited settings.md) took the same path — guard it too
test('a corrupt non-array skillRepos migrates without recursing', () => {
  freshRoot();
  fs.writeFileSync(paths.settings(), '---\nbudget: 60\nskillRepos: not-a-list\n---\ncorrupt\n');
  const real = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = (...a) => { writes++; return real(...a); };
  let s;
  try { s = getSettings(); } finally { fs.writeFileSync = real; }
  assert.equal(writes, 1, 'one repair write, not a recursive storm');
  assert.ok(Array.isArray(s.skillRepos));
  assert.equal(s.budget, 60);
});

// ── trash.mjs: restore is all-or-nothing ─────────────────────────────────────────────────────
// The existence check used to live INSIDE the move loop, so a conflict on the second path threw
// after the first had already been renamed out of .trash: the caller reported failure while the
// entry sat half-restored and permanently un-restorable (every retry re-hit the same conflict).
test('restoreTrash is atomic — a conflict on any path restores none of them', () => {
  const root = freshRoot();
  const dir = path.join(root, 'board');
  fs.mkdirSync(dir, { recursive: true });
  const A = path.join(dir, 'a.png'), B = path.join(dir, 'b.png');
  fs.writeFileSync(A, 'AAA'); fs.writeFileSync(B, 'BBB');

  const entry = stageTrash([A, B], { label: 'pair', itemKind: 'asset' });
  assert.equal(entry.paths.length, 2);
  assert.ok(!fs.existsSync(A) && !fs.existsSync(B), 'both staged out');

  fs.writeFileSync(B, 'NEWER-USER-DATA'); // b.png re-created → restore must refuse
  assert.throws(() => restoreTrash(entry.id), /already exists/);

  assert.ok(!fs.existsSync(A), 'a.png must NOT have been half-restored');
  assert.equal(fs.readFileSync(B, 'utf8'), 'NEWER-USER-DATA', 'newer data untouched');
  assert.ok(listTrash().some(x => x.id === entry.id), 'entry stays restorable');

  fs.rmSync(B); // clear the conflict — the whole entry now comes back
  const r = restoreTrash(entry.id);
  assert.deepEqual(r.restored.sort(), ['board/a.png', 'board/b.png']);
  assert.equal(fs.readFileSync(A, 'utf8'), 'AAA');
  assert.equal(fs.readFileSync(B, 'utf8'), 'BBB');
  assert.equal(listTrash().length, 0);
});

test('restoreTrash refuses a manifest relativePath that escapes the storage root', () => {
  const root = freshRoot();
  const f = path.join(root, 'x.png');
  fs.writeFileSync(f, 'X');
  const entry = stageTrash([f], { label: 'x' });
  // settings.md is user-editable by design, and so is the trash manifest — hand-edit it to point out
  const mf = path.join(root, '.trash', 'manifest.md');
  const { data } = readMd(mf);
  data.entries[0].paths[0].relativePath = path.join('..', '..', 'escaped.png');
  writeMd(mf, data, 'manifest\n');
  assert.throws(() => restoreTrash(entry.id), /outside the storage root/);
});

// ── indexer.mjs: the walker must skip dotfiles ───────────────────────────────────────────────
// The old guard tested startsWith('.') and then only re-checked SKIP_DIRS, so it was a no-op.
// This repo lives on exFAT, where macOS writes a `._X` AppleDouble beside almost every file X —
// those were counted by integrityReport() and folded into fingerprint(), whose mtimes flipped on
// every Finder touch and pushed a spurious bump() to every SSE client.
test('integrity scan and fingerprint ignore dotfiles (AppleDouble sidecars included)', () => {
  const root = freshRoot();
  const pdir = path.join(root, 'projects', 'demo');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, 'project.md'), '---\nname: Demo\n---\nbody\n');
  fs.writeFileSync(path.join(pdir, '._project.md'), 'AppleDouble junk\0\x01');
  fs.writeFileSync(path.join(root, '.hidden.md'), '---\nx: 1\n---\n');

  const before = integrityReport();
  assert.equal(before.scanned, 1, 'only the real record is scanned');
  assert.equal(before.malformed.length, 0);

  reconcile();                       // establish the fingerprint baseline
  const rev = currentRevision();
  fs.writeFileSync(path.join(pdir, '._project.md'), 'macOS rewrote the sidecar\0');
  reconcile();
  assert.equal(currentRevision(), rev, 'AppleDouble churn must not bump the revision');

  fs.writeFileSync(path.join(pdir, 'project.md'), '---\nname: Demo 2\n---\nreal edit\n');
  reconcile();
  assert.ok(currentRevision() > rev, 'a REAL external edit still bumps');
});

// ── indexer.mjs: the delta probe must not lie to a client that outlived the server ───────────
// revision resets to 1 on boot, so a client reconnecting after a restart holds a HIGHER revision
// than the server. `s >= revision → []` folded that into "already current", so such a client was
// told "nothing changed" forever and never refetched. Harmless while /api/state?since= had no
// callers; a live trap the moment the fallback poll started using it.
test('changedSince forces a full refetch when the client revision is ahead (server restarted)', () => {
  freshRoot();
  const now = currentRevision();
  assert.equal(changedSince(now + 500), null, 'client ahead of us → null → full rebuild');
  assert.equal(changedSince(now + 1), null, 'even one ahead is still a restart');
  assert.deepEqual(changedSince(now), [], 'exactly current → nothing changed');
});

test('changedSince still reports the domains for a genuinely stale revision', () => {
  freshRoot();
  const before = currentRevision();
  bump(['settings']);
  bump(['shots']);
  const changed = changedSince(before);
  assert.ok(Array.isArray(changed));
  assert.deepEqual([...changed].sort(), ['settings', 'shots']);
  assert.equal(changedSince(0), null, 'a missing/zero since → full refetch');
});

test('/api/state?since= answers the current revision cheaply, and a restart with the full payload', async () => {
  freshRoot();
  seedProject('p');
  const full = (await req('GET', '/api/state')).body;
  assert.ok(full.revision >= 1);
  assert.ok(Array.isArray(full.projects), 'full payload carries the actual state');

  const probe = (await req('GET', '/api/state?since=' + full.revision)).body;
  assert.equal(probe.full, false, 'cheap delta answer');
  assert.deepEqual(probe.changed, []);
  assert.equal(probe.projects, undefined, 'and it does NOT rebuild the world');

  const ahead = (await req('GET', '/api/state?since=' + (full.revision + 999))).body;
  assert.notEqual(ahead.full, false, 'client ahead → server must send the full payload');
  assert.ok(Array.isArray(ahead.projects), 'which really is the whole state');
});

// ── jobs.mjs: resolveBin memoization ─────────────────────────────────────────────────────────
// providersStatus() runs on every /api/state and used to pay two blocking spawnSync('which')
// round-trips per request. The cache must not change what gets resolved.
test('resolveBin caches without changing the answer, and clearBinCache re-probes', () => {
  clearBinCache();
  const cold = resolveBin('node');
  const warm = resolveBin('node');
  assert.equal(warm, cold, 'cached hit matches the cold lookup');
  assert.ok(cold && fs.existsSync(cold), 'and it is a real path');

  clearBinCache();
  assert.equal(resolveBin('node'), cold, 'still correct after a bust');

  clearBinCache();
  const missing = 'frameforge-definitely-not-installed-xyz';
  assert.equal(resolveBin(missing), null);
  assert.equal(resolveBin(missing), null, 'negative results cache too — that is the slow path');
  assert.equal(resolveBin(''), null, 'empty command short-circuits');
});

// ── store.mjs: the context surface must refuse control files ─────────────────────────────────
// `deleteContextFile` is an irreversible fs.rmSync (not a staged trash move) and `name` reaches
// it straight off the wire: POST /api/context/:pid/note passes req.body.replace through. Naming
// `_folders.md` there wiped the project's folder-classification manifest with no undo. The guard
// that library.mjs had since CONTROL_FILES was introduced was never applied to store.mjs's
// parallel surface over the same directory.
test('control files cannot be deleted or resolved through the store context surface', () => {
  const root = freshRoot();
  const pid = 'demo';
  const dir = contextDir(pid);
  fs.mkdirSync(path.join(dir, 'board'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_folders.md'), '---\nx: 1\n---\n');
  fs.writeFileSync(path.join(dir, 'note.md'), 'a user note');
  // a same-named file INSIDE a board folder is an ordinary user asset — the guard is root-only
  fs.writeFileSync(path.join(dir, 'board', '_folders.md'), 'ordinary asset');

  const at = p => path.join(dir, p);

  assert.equal(deleteContextFile(pid, '_folders.md'), false, 'refuses the control file');
  assert.ok(fs.existsSync(at('_folders.md')), '_folders.md must survive');

  // cleanName() collapses traversal to a basename, so this lands on the same guarded name
  assert.equal(deleteContextFile(pid, '../_folders.md'), false, 'refuses it via traversal too');
  assert.ok(fs.existsSync(at('_folders.md')), '_folders.md must still survive');

  assert.equal(contextFilePath(pid, '_folders.md'), null, 'does not resolve — no read, no stage-for-trash');

  // and the guard must not over-reach
  assert.equal(deleteContextFile(pid, '_folders.md', 'board'), true, 'a board-folder file of the same name is a user asset');
  assert.ok(!fs.existsSync(at('board/_folders.md')));
  assert.equal(deleteContextFile(pid, 'note.md'), true, 'ordinary notes still delete');
  assert.ok(!fs.existsSync(at('note.md')));
  assert.ok(root);
});

// One declaration, re-exported — not two Sets that agree today and drift tomorrow.
test('CONTROL_FILES has exactly one declaration; memory.mjs re-exports store.mjs', () => {
  assert.equal(CONTROL_FILES, MEMORY_CONTROL_FILES, 'must be the same Set instance, not a copy');
  assert.ok(CONTROL_FILES.has('_folders.md'));
});
