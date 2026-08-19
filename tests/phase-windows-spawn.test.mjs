/* Every spawn site launches through planLaunch.
 *
 * PR #1 fixed resolveBin (finding the binary) and agentRunner (launching it), and left every OTHER
 * spawn site launching raw — so resolveBin correctly handed back `…\npm\npm.CMD` and spawn() then
 * refused it. Agent status, the install button, Arcads, Remotion and the video tools were all dead
 * on Windows for that reason, and none of it was visible from macOS.
 *
 * These tests are mostly platform-agnostic on purpose: the structural ones (no import cycle, every
 * site routed) fail on ANY host if someone adds a raw spawn back, which is the regression that
 * actually matters. The one genuinely Windows-only case is marked as such rather than skipped
 * silently.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const read = f => fs.readFileSync(path.join(BACKEND, f), 'utf8');
const IS_WIN = process.platform === 'win32';

test('launch.mjs is a leaf — it imports nothing from the app', () => {
  // This is what lets jobs.mjs use planLaunch at all. agentRunner imports resolveBin FROM jobs.mjs,
  // so while planLaunch lived in agentRunner the cycle jobs -> agentRunner -> jobs made it
  // unreachable, and that is precisely why the other sites were never fixed.
  const imports = [...read('launch.mjs').matchAll(/^import .*?from '([^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['fs', 'path'],
    'launch.mjs must depend only on fs and path — anything else risks re-introducing the cycle');
});

test('agentRunner still exports the three names, so its importers and tests are unaffected', async () => {
  const m = await import('../backend/agentRunner.mjs');
  for (const n of ['planLaunch', 'cmdShimScript', 'cmdEscape']) {
    assert.equal(typeof m[n], 'function', n + ' must remain exported from agentRunner');
  }
});

test('there is exactly ONE planLaunch implementation', () => {
  const files = fs.readdirSync(BACKEND).filter(f => f.endsWith('.mjs'));
  const defs = files.filter(f => /export function planLaunch/.test(read(f)));
  assert.deepEqual(defs, ['launch.mjs'],
    'a second copy of this reasoning is how one caller quietly starts truncating prompts');
});

test('no backend module spawns a resolved binary without planLaunch', () => {
  /* The regression guard. A bare `spawn(cmd, …)` where cmd came from resolveBin is the exact bug:
     correct path, refused launch. Sites that spawn a plan are fine; so is video.mjs's run(), whose
     bin is an .exe validated by --version before it is ever cached. */
  // ffmpeg/ffprobe are exempt: they come from videoTools(), which runs each candidate with
  // --version before caching it, so the cached path is always a real executable (ffmpeg.exe on
  // Windows). A .cmd could never survive that gate — a stronger guarantee than planLaunch gives.
  const EXEMPT = new Set(['reelRender.mjs', 'video.mjs']);
  const offenders = [];
  for (const f of fs.readdirSync(BACKEND).filter(x => x.endsWith('.mjs'))) {
    if (EXEMPT.has(f)) continue;
    const src = read(f);
    if (!/from '\.\/launch\.mjs'/.test(src) && /\bspawn\(\s*(cmd|bin|cli\.cmd|npm)\b/.test(src)) {
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [],
    'these spawn a resolved binary but never import planLaunch: ' + offenders.join(', '));
});

test('planLaunch is identity off Windows — POSIX behaviour is unchanged by construction', async () => {
  const { planLaunch } = await import('../backend/launch.mjs');
  const args = ['--append-system-prompt', 'line one\nline two', '-p'];
  const out = planLaunch('/usr/local/bin/claude', args, { platform: 'darwin' });
  assert.equal(out.file, '/usr/local/bin/claude');
  assert.deepEqual(out.args, args);
  assert.equal(out.env, null);
  assert.equal(out.verbatim, false);
});

test('a .cmd shim resolves to node + script rather than going through cmd.exe', async () => {
  const { planLaunch } = await import('../backend/launch.mjs');
  // A real npm cmd-shim body. Routing this through cmd.exe would truncate at the first newline of
  // a multi-line prompt, so the unwrap is what keeps the argument intact.
  const shim = '@ECHO off\r\n"%dp0%\\node.exe"  "%dp0%\\..\\claude\\cli.js" %*\r\n';
  const out = planLaunch('C:\\npm\\claude.cmd', ['-p', 'a\nb'], {
    platform: 'win32', exists: () => false, readFile: () => shim, execPath: 'C:\\node\\node.exe',
  });
  assert.equal(out.file, 'C:\\node\\node.exe');
  assert.ok(out.args[0].endsWith('cli.js'), 'first arg must be the unwrapped script, got ' + out.args[0]);
  assert.deepEqual(out.args.slice(1), ['-p', 'a\nb'], 'the multi-line argument must survive intact');
});

test('a shim wrapping a NATIVE binary spawns that binary directly', async () => {
  /* Claude Code ships a native executable now, so its shim invokes an .exe rather than a .js:
       "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*
     Recovering only the .js form left this unparseable, planLaunch fell through to the cmd.exe
     route, and a multi-line prompt was then correctly refused — which a real user hit as
     "claude.CMD is a batch wrapper this build cannot unwrap". The refusal was right; the unwrap
     was too narrow. Spawning the .exe directly also means CreateProcess does the quoting, so the
     prompt survives exactly as it does on POSIX. */
  const { planLaunch } = await import('../backend/launch.mjs');
  const shim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\n'
    + 'SETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
  const out = planLaunch('C:\\Program Files\\nodejs\\claude.CMD', ['-p', 'line one\nline two'], {
    platform: 'win32', readFile: () => shim, exists: () => false, execPath: 'C:\\node\\node.exe',
  });
  assert.equal(out.file, 'C:\\Program Files\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
  assert.notEqual(out.file, 'C:\\node\\node.exe', 'a native binary must not be run through node');
  assert.equal(out.verbatim, false, 'direct spawn means CreateProcess quotes, not cmd.exe');
  assert.deepEqual(out.args, ['-p', 'line one\nline two'], 'the multi-line prompt must survive');
});

test('the target comes from the invocation line, not the first %dp0% mention', async () => {
  /* The script-shim generation probes for a sibling runtime FIRST:
         IF EXIST "%dp0%\\node.exe" ( SET "_prog=%dp0%\\node.exe" ) ...
         endLocal & ... "%_prog%"  "%dp0%\\node_modules\\pkg\\cli.js" %*
     Taking the first %dp0%-rooted path would return node.exe and silently run the wrong program. */
  const { cmdShimTarget } = await import('../backend/launch.mjs');
  const shim = 'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n'
    + '  SET "_prog=node"\r\n)\r\nendLocal & goto #_undefined_# 2>NUL || "%_prog%"  "%dp0%\\node_modules\\pkg\\cli.js" %*\r\n';
  assert.equal(cmdShimTarget(shim), 'node_modules\\pkg\\cli.js');
});

test('runOnce survives a storage root that does not exist yet', async () => {
  /* spawn() with a non-existent cwd fails ENOENT and Node reports it against the COMMAND, so this
     surfaced as `spawn C:\\Windows\\system32\\cmd.exe ENOENT` — a file that was plainly present.
     The storage root is gitignored (absent on a fresh CI checkout) and equally absent on a user's
     first run before anything has been written, so every runOnce would have failed there while
     blaming the binary. Caught by CI, not by the local box, where workspace/ happened to exist. */
  const missing = path.join(BACKEND, '..', 'no-such-storage-root-' + Date.now());
  assert.equal(fs.existsSync(missing), false);
  const prev = process.env.FRFG_DATA;
  process.env.FRFG_DATA = missing;
  try {
    const { runOnce, resolveBin } = await import('../backend/jobs.mjs');
    const node = resolveBin('node');
    assert.ok(node, 'node must be resolvable');
    const r = await runOnce(node, ['-e', 'process.stdout.write("ok")'], 20000);
    assert.equal(r.code, 0, 'a missing storage root must not look like a missing binary: ' + r.err);
    assert.equal(r.out, 'ok');
  } finally {
    if (prev === undefined) delete process.env.FRFG_DATA; else process.env.FRFG_DATA = prev;
  }
});

test('runOnce reports launchFailed, so a probe cannot read "did not start" as "installed"', async () => {
  const { runOnce } = await import('../backend/jobs.mjs');
  const r = await runOnce(path.join(BACKEND, 'definitely-not-a-binary-xyz'), [], 5000);
  assert.equal(r.code, -1);
  assert.equal(r.launchFailed, true,
    'localAsr reported installed:!enoent — on Windows the failure is EINVAL, not ENOENT, which inverted the probe');
});

test('runOnce actually launches an npm .cmd shim', { skip: !IS_WIN && 'Windows-only launch path' }, async () => {
  const { runOnce, resolveBin } = await import('../backend/jobs.mjs');
  const npm = resolveBin('npm');
  assert.ok(npm, 'npm must be resolvable for this test to mean anything');
  assert.match(npm.toLowerCase(), /\.cmd$/, 'on Windows npm is a .cmd — that is the whole point');
  const r = await runOnce(npm, ['--version'], 30000);
  assert.equal(r.code, 0, 'spawning a .cmd must succeed: ' + r.err);
  assert.match(r.out.trim(), /^\d+\.\d+/);
});

test('video tool resolution has a win32 branch — `which` does not exist there', () => {
  const src = read('video.mjs');
  assert.match(src, /process\.platform === 'win32'/,
    'resolveTool relied on which(1) plus POSIX-only fallbacks, so ffmpeg/ffprobe/yt-dlp resolved to '
    + 'null on every Windows machine even when installed');
  assert.match(src, /resolveBin\(name\)/, 'the win32 branch should reuse the PATHEXT walk, not invent a second one');
});

test('remotion prefers the .cmd shim on Windows over the unrunnable extensionless one', () => {
  const src = read('remotion.mjs');
  const m = /\['remotion\.cmd'[^\]]*\]/.exec(src);
  assert.ok(m, 'remotionCli must probe Windows shim spellings explicitly');
  assert.ok(m[0].indexOf("'remotion.cmd'") < m[0].indexOf("'remotion'"),
    'npm writes remotion, remotion.cmd AND remotion.ps1 — testing the extensionless sh script first '
    + 'always picked the one CreateProcess cannot run');
});
