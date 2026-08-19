// The gate on the beta-feedback family (docs/specs/beta-feedback/spec.md §2.3).
//
// Every byte of a bug report passes through shared/redact.mjs before it leaves the user's
// machine, and that machine holds live provider keys, signed media URLs and the user's real
// name in every path. If this file fails, the feature is broken — not the test.
//
// No _env.mjs import: redact.mjs is pure and touches no datastore. That is the point of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, signature, normalise, RULES } from '../shared/redact.mjs';

const clean = (v, opts) => redact(v, opts).value;
const hitsOf = (v, opts) => redact(v, opts).hits;

// ── rule 1: exact secrets ───────────────────────────────────────────────────────────────────

test('an exact secret is killed even when its shape matches no pattern', () => {
  // The whole reason rule 1 exists: a provider changes key format tomorrow and every shape
  // pattern in the file goes stale. The user's own configured value must still die.
  const weird = 'zzz-not-a-known-key-format-at-all-9182';
  const out = clean(`fetch failed with key ${weird} against fal`, { secrets: [weird] });
  assert.ok(!out.includes(weird), 'exact secret survived');
  assert.match(out, /<redacted:key>/);
});

test('an exact secret dies inside a URL, a path and an object key alike', () => {
  const key = 'gsk_liveKeyValue1234567890abcd';
  const out = clean({
    [`header-${key}`]: 'x',
    url: `https://api.groq.com/v1/x?k=${key}`,
    path: `~/keys/${key}.txt`
  }, { secrets: [key] });
  assert.ok(!JSON.stringify(out).includes(key), 'secret survived somewhere in the tree');
});

test('a short settings value is not treated as a secret', () => {
  // A 6-char value left in settings would otherwise redact half the English in the report.
  const out = clean('the model returned an error', { secrets: ['error'] });
  assert.equal(out, 'the model returned an error');
});

// ── rule 2: key shapes ──────────────────────────────────────────────────────────────────────

for (const [label, sample] of [
  ['Anthropic', 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'],
  ['Groq', 'gsk_AbCdEfGhIjKlMnOpQrStUvWxYz0123'],
  ['OpenAI-shaped', 'sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'],
  ['GitHub PAT', 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123'],
  ['AWS key id', 'AKIAIOSFODNN7EXAMPLE'],
  ['FAL', 'fal_AbCdEfGhIjKlMnOpQrStUvWx'],
  ['FAL uuid:hex', '3f2504e0-4f89-11d3-9a0c-0305e82c3301:0123456789abcdef0123456789abcdef'],
  ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
]) {
  test(`key shape: ${label} is redacted without being configured`, () => {
    const out = clean(`Authorization failed for ${sample} on retry`);
    assert.ok(!out.includes(sample), `${label} key survived`);
    assert.match(out, /<redacted:/);
  });
}

test('an auth header keeps its scheme and loses its token', () => {
  // That it WAS an Authorization header is evidence worth keeping; the token is not.
  const out = clean('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345');
  assert.match(out, /Bearer <redacted:key>/);
  assert.ok(!out.includes('abcdefghijklmnop'));
});

// ── rule 3: signed URLs ─────────────────────────────────────────────────────────────────────

test('a signed media URL keeps origin and path, loses the query', () => {
  const url = 'https://fal.media/files/panda/abc123/out.png?X-Amz-Signature=deadbeefcafe&X-Amz-Expires=900';
  const out = clean(`img load failed: ${url}`);
  assert.ok(out.includes('https://fal.media/files/panda/abc123/out.png'), 'lost the path — that was the evidence');
  assert.ok(!out.includes('X-Amz-Signature'), 'signature survived');
  assert.match(out, /\?<redacted:signed>/);
});

test('an ordinary URL with a harmless query is left alone', () => {
  const url = 'https://fal.ai/models?page=2&sort=name';
  assert.equal(clean(url), url);
});

test('our own /api URLs survive intact — they are the evidence', () => {
  const url = '/api/generations/proj-a/gen-17/reroll';
  assert.equal(clean(url), url);
});

// ── rule 4: base64 blobs ────────────────────────────────────────────────────────────────────

test('a large data URL is reduced to mime and size', () => {
  // styleLockPreview returns a dataUrl, so these WILL be in the console ring.
  const blob = 'data:image/png;base64,' + 'A'.repeat(400_000);
  const out = clean({ preview: blob });
  assert.ok(out.preview.length < 200, 'blob was not elided: ' + out.preview.length + ' chars');
  assert.match(out.preview, /^data:image\/png;base64,<[\d.]+ [KM]B elided>$/);
});

test('a small data URL is left alone', () => {
  const tiny = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  assert.equal(clean(tiny), tiny);
});

// ── rule 5: home paths ──────────────────────────────────────────────────────────────────────

test('the home directory is collapsed to ~ on both platforms', () => {
  const out = clean([
    'ENOENT: /Users/theova/Projects/FAL HACKATON/workspace/settings.md',
    'at readFile (C:\\Users\\theova\\AppData\\scout\\store.mjs:12:9)'
  ]);
  assert.ok(!out.join(' ').includes('theova'), 'the reporter\'s name survived in a path');
  assert.ok(out[0].startsWith('ENOENT: ~/Projects'), 'lost the rest of the path: ' + out[0]);
  assert.ok(out[1].includes('~\\AppData'), 'windows path not collapsed: ' + out[1]);
});

test('a path that is not a home directory is untouched', () => {
  const p = '/usr/local/bin/ffmpeg';
  assert.equal(clean(p), p);
});

// ── rule 6: emails ──────────────────────────────────────────────────────────────────────────

test('a third-party email is redacted', () => {
  const out = clean('mailto set to someone.else@example.com in the sheet');
  assert.ok(!out.includes('someone.else@example.com'));
  assert.match(out, /<email>/);
});

// ── rule 7: entropy sweep ───────────────────────────────────────────────────────────────────

test('a long high-entropy blob is elided', () => {
  const blob = 'Xk29fJ4mQ8vB1nR7tY0wL5sD3hG6pZ2c';
  const out = clean(`opaque token ${blob} rejected`);
  assert.ok(!out.includes(blob), 'entropy sweep missed it');
});

test('the entropy sweep does not eat a git sha, a uuid or a signature', () => {
  const safe = [
    'da815a0',
    'da815a0f1e2d3c4b5a69788796a5b4c3d2e1f009',
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    'sha256:' + 'a1b2c3d4'.repeat(8),
  ];
  for (const s of safe) assert.equal(clean(`ref ${s} here`), `ref ${s} here`, `ate a safe shape: ${s}`);
});

test('a long lowercase identifier is not mistaken for a credential', () => {
  const id = 'shotworkspacegenerationcontrolsbar';
  assert.equal(clean(id), id);
});

// ── the walk ────────────────────────────────────────────────────────────────────────────────

test('redact walks object keys, not just values', () => {
  const key = 'sk-ant-api03-KeyInAnObjectKey0123456789abcdef';
  const out = clean({ [key]: 'value' });
  assert.ok(!Object.keys(out).join('').includes('sk-ant'), 'a secret in a KEY survived');
});

test('redact survives null, undefined, cycles, functions and deep nesting', () => {
  const cyclic = { name: 'root' };
  cyclic.self = cyclic;
  assert.equal(clean(null), null);
  assert.doesNotThrow(() => clean(cyclic));
  assert.equal(clean(cyclic).self, '<redacted:cycle>');
  assert.equal(clean({ fn: () => 1 }).fn, undefined);

  let deep = 'leaf';
  for (let i = 0; i < 40; i++) deep = { next: deep };
  assert.doesNotThrow(() => clean(deep));
});

test('an oversize string is truncated rather than sent whole', () => {
  const out = redact('x'.repeat(500_000));
  assert.ok(out.value.length < 210_000, 'oversize string went through at full length');
  assert.ok(out.hits.oversize >= 1);
});

test('redact is deterministic — same input, byte-identical output', () => {
  // The dedupe signature depends on this, and so does the review step's promise that what the
  // user saw is what was sent.
  const input = { log: ['sk-ant-api03-Abcdefghijklmnop0123456789', '/Users/theova/x'], n: 4 };
  assert.equal(JSON.stringify(clean(input)), JSON.stringify(clean(input)));
});

test('every rule in RULES has at least one hit somewhere in this file', () => {
  // Guard against a rule being added without a case: enumerate the real table rather than a copy.
  const kitchenSink = {
    a: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx0123',
    b: 'https://fal.media/f/x.png?X-Amz-Signature=abc',
    c: 'data:image/png;base64,' + 'A'.repeat(300),
    d: '/Users/theova/x',
    e: 'a@b.co',
    f: 'Xk29fJ4mQ8vB1nR7tY0wL5sD3hG6pZ2c',
    g: 'exactly-this-secret-value-here',
  };
  const hits = hitsOf(kitchenSink, { secrets: ['exactly-this-secret-value-here'] });
  for (const rule of RULES) {
    assert.ok(hits[rule.name] > 0, `rule "${rule.name}" is never exercised — add a case`);
  }
});

// ── the signature ───────────────────────────────────────────────────────────────────────────

test('two runs of the same crash share a signature', () => {
  // Twenty testers hitting one crash must produce one issue with twenty occurrences.
  const a = signature({
    frame: 'at reroll (/Users/ann/app/frontend/ShotWorkspace.jsx:212:14)',
    message: "Cannot read properties of undefined (reading 'params') for gen-8371",
    route: '/api/generations/proj-a/gen-8371/reroll',
    version: '0.1.0'
  });
  const b = signature({
    frame: 'at reroll (/Users/bob/Scout/frontend/ShotWorkspace.jsx:219:9)',
    message: "Cannot read properties of undefined (reading 'params') for gen-2044",
    route: '/api/generations/proj-z/gen-2044/reroll',
    version: '0.1.0'
  });
  assert.equal(a, b, 'the same bug on two machines produced two signatures');
});

test('a different failure gets a different signature', () => {
  const a = signature({ message: 'fetch failed', route: '/api/generate', version: '0.1.0' });
  const b = signature({ message: 'model not found', route: '/api/generate', version: '0.1.0' });
  assert.notEqual(a, b);
});

test('a version bump re-opens the signature', () => {
  // A bug that comes back after a release is a regression and deserves its own issue.
  const parts = { message: 'fetch failed', route: '/api/generate' };
  assert.notEqual(signature({ ...parts, version: '0.1.0' }), signature({ ...parts, version: '0.2.0' }));
});

test('normalise strips ids, digits, quotes and paths', () => {
  assert.equal(normalise('shot "abc" 42 at ~/x/y.js:9'), 'shot · · at ·');
});
