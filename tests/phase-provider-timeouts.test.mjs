// DEV-131 — generations failed through the compose path with a bare "timed out after 120s".
//
// Two defects, both reproduced here without touching the network (globalThis.fetch is stubbed to
// fake the FAL queue, exactly as tests/phase-audio-kinds.test.mjs does):
//
//   1. backend/providers.mjs hardcoded 120s for every non-video model. `fal-ai/nano-banana-pro` is
//      the app's default RENDER model and measures 45–100s per call, so a busy queue pushed it past
//      the line and the job died. The wait is now a per-model fact in frontend/modelCatalog.js.
//   2. The status-poll loop swallowed every non-OK response with a bare `continue`, so a revoked
//      key (401) was indistinguishable from a slow model: the job burned the full timeout and
//      reported the same generic message. Auth failures now fail fast and say so.
import './_env.mjs'; // first — sets storage-root env before the store loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timeoutSecondsFor, timeoutMsFor, DEFAULT_TIMEOUT_SECONDS, modelKind
} from '../frontend/modelCatalog.js';
import { runProvider } from '../backend/providers.mjs';

const RENDER = 'fal-ai/nano-banana-pro';        // the model DEV-131 was reported against
const PREVIEW = 'fal-ai/flux/schnell';
const VIDEO = 'fal-ai/pixverse/v6/image-to-video';
const SLOW_EDIT = 'fal-ai/nano-banana-pro/edit'; // catalog note: "slow 2–4min"

// ── the timeout is a catalog fact ────────────────────────────────────────────────────────────────
test('every image kind gets more than the old 120s ceiling that killed nano-banana-pro', () => {
  // the regression itself: 120s was less than nano-banana-pro's observed 45–100s plus queue wait
  for (const id of [PREVIEW, RENDER, SLOW_EDIT]) {
    assert.ok(timeoutSecondsFor(id) > 120, id + ' still sits on the old 120s ceiling');
  }
  assert.equal(timeoutSecondsFor(RENDER), 300);
});

test('a per-model override beats its kind default; video keeps its 360s', () => {
  // the edit variant's own note says 2–4min, so 240s of work needs more than 240s of budget
  assert.equal(timeoutSecondsFor(SLOW_EDIT), 420);
  assert.ok(timeoutSecondsFor(SLOW_EDIT) > timeoutSecondsFor(RENDER), 'the override must win');
  assert.equal(timeoutSecondsFor(VIDEO), 360);   // unchanged from the old VID_TIMEOUT
  assert.equal(modelKind(VIDEO), 'video');
});

test('an id absent from the catalog still resolves through its inferred kind', () => {
  assert.equal(timeoutSecondsFor('fal-ai/brand-new/text-to-image'), timeoutSecondsFor(RENDER));
  assert.equal(timeoutSecondsFor('fal-ai/brand-new/image-to-video'), 360);
  assert.ok(DEFAULT_TIMEOUT_SECONDS > 120);
  assert.equal(timeoutMsFor(RENDER), timeoutSecondsFor(RENDER) * 1000);
});

// ── the poll loop no longer swallows provider errors ─────────────────────────────────────────────
// Submit succeeds, then every status poll answers `status`. The old loop `continue`d past all of
// them and only ever surfaced the timeout; these assert the real cause comes back instead.
function withFailingPolls(status, body, fn) {
  const real = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if ((init.method || 'GET') === 'POST' && u.startsWith('https://queue.fal.run/') && !u.includes('/requests/')) {
      return { ok: true, status: 200, json: async () => ({ request_id: 'r1' }) };
    }
    if (u.includes('/status')) { polls++; return { ok: false, status, text: async () => body }; }
    return real(url, init);
  };
  return fn(() => polls).finally(() => { globalThis.fetch = real; });
}

test('a 401 while polling fails immediately and names the credential, not a timeout', async () => {
  process.env.FAL_KEY = 'test-key-131';
  await withFailingPolls(401, '{"detail":"Unauthorized"}', async (pollCount) => {
    const err = await runProvider('fal', { model: RENDER, prompt: 'x', aspect: '16:9', resolution: '1K' })
      .then(() => null, e => e);
    assert.ok(err, 'a 401 status poll must reject');
    assert.match(err.message, /rejected the API key/i);
    assert.match(err.message, /401/);
    assert.doesNotMatch(err.message, /timed out/i, 'auth failure must not masquerade as a timeout');
    // fail FAST: one bad poll is enough, we must not burn the 300s budget re-asking
    assert.equal(pollCount(), 1);
  });
  delete process.env.FAL_KEY;
});

test('repeated transient poll failures give up with the real status instead of hanging', async () => {
  process.env.FAL_KEY = 'test-key-131';
  await withFailingPolls(503, 'upstream unavailable', async (pollCount) => {
    const err = await runProvider('fal', { model: RENDER, prompt: 'x', aspect: '16:9', resolution: '1K' })
      .then(() => null, e => e);
    assert.ok(err, 'a wall of 503s must reject');
    assert.match(err.message, /503/);
    assert.match(err.message, /upstream unavailable/);
    // tolerated a few, then stopped — nowhere near the 300s the old loop would have waited
    assert.ok(pollCount() >= 2 && pollCount() <= 8, 'gave up after ' + pollCount() + ' polls');
  });
  delete process.env.FAL_KEY;
});

// ── a transient blip must NOT abort a job that then succeeds ─────────────────────────────────────
// The counterpart to the two tests above: tightening the loop must not make it brittle. One 502 in
// the middle of an otherwise healthy poll sequence is normal queue weather and has to be ridden out.
test('an isolated transient poll failure is tolerated and the generation still completes', async () => {
  process.env.FAL_KEY = 'test-key-131';
  const real = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if ((init.method || 'GET') === 'POST' && u.startsWith('https://queue.fal.run/') && !u.includes('/requests/')) {
      return { ok: true, status: 200, json: async () => ({ request_id: 'r1' }) };
    }
    if (u.includes('/status')) {
      polls++;
      if (polls === 1) return { ok: false, status: 502, text: async () => 'bad gateway' }; // one blip
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
    }
    if (u.includes('/requests/')) {
      return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://v3.fal.media/f/ok.png' }] }) };
    }
    return real(url, init);
  };
  try {
    const res = await runProvider('fal', { model: RENDER, prompt: 'x', aspect: '16:9', resolution: '1K' });
    assert.equal(res.fileUrl, 'https://v3.fal.media/f/ok.png');
    assert.equal(polls, 2, 'should have retried past the single 502');
  } finally {
    globalThis.fetch = real;
    delete process.env.FAL_KEY;
  }
});
