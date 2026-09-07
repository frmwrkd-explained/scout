// Must be imported FIRST by every test file (before any ../backend/* import). ESM evaluates a
// module's imports depth-first in source order, so importing this before the store guarantees the
// storage-root env vars are set before store.mjs captures CONFIG_MD / DEFAULT_ROOT at module load.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-base-'));
// temp roots accumulate forever otherwise — remove the base (and any roots registered by
// helpers.freshRoot) when the test process exits
export const tempRoots = [base];
process.on('exit', () => {
  for (const dir of tempRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
// The stub CLIs under tests/fixtures are spawned DIRECTLY (planLaunch hands a POSIX bin to spawn
// untouched, exactly as it would a real `claude` on PATH), so they need their exec bit. The bit is
// committed (100755), but a checkout that lost it — a zip download, some Windows-authored clones,
// a filesystem that ignores modes — fails seven tests with `spawn … EACCES`, which reads like a
// runner bug. Re-asserting it here costs nothing and keeps the failure impossible.
try {
  // fileURLToPath, never `.pathname` — a URL keeps its percent-encoding, so on a checkout whose
  // path contains a space ('/New Coding Projects/') the join produced `/New%20Coding%20…`, the
  // readdir threw ENOENT, and the catch below swallowed it. The guard silently did nothing on
  // exactly the machines it was written for.
  const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
  for (const f of fs.readdirSync(fixtures)) {
    if (!f.endsWith('.mjs') || f.startsWith('.')) continue;
    const p = path.join(fixtures, f);
    const mode = fs.statSync(p).mode & 0o777;
    if ((mode & 0o111) !== 0o111) fs.chmodSync(p, mode | 0o111);
  }
} catch { /* best effort — the committed bit is the primary guarantee */ }
process.env.SCOUT_CONFIG = path.join(base, 'config.md');
process.env.SCOUT_DATA = path.join(base, 'data');
process.env.SCOUT_NO_LISTEN = '1';
process.env.SCOUT_TEST = '1'; // provider/agent queues never auto-run under tests (hermetic)
// The egress path must stay dead under test. `.env` carries a real deployment URL on a developer
// machine, and env.mjs only fills a key that is `undefined` — so claiming it here (empty reads as
// unset in feedback.mjs `endpoint()`) is what keeps the suite from POSTing to the live bug sink
// and what makes phase-feedback-envelope's "queued to the outbox" cases reachable at all.
process.env.SCOUT_FEEDBACK_URL = '';
