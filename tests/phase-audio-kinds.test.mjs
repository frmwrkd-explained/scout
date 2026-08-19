// Ticket 07 — music / voice / sfx model kinds end-to-end (catalog → defaults → FAL adapter).
//
// The network is NEVER touched: globalThis.fetch is stubbed to fake the FAL queue (submit → status
// → response). We assert the catalog vocabulary, the seeded modelDefaults, and that the FAL adapter
// builds an AUDIO payload (text/prompt only, no image_size/aspect) and parses an audio result URL.
import './_env.mjs'; // first — sets storage-root env before the store loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot } from './helpers.mjs';
import { getSettings } from '../backend/store.mjs';
import {
  KINDS, AUDIO_KINDS, isAudioKind, isAudioModel, isVideoModel, modelKind, estCost,
  enabledCatalog, modelById, DEFAULT_PREVIEW_MODEL
} from '../frontend/modelCatalog.js';
import { runProvider } from '../backend/providers.mjs';

const MUSIC = 'fal-ai/stable-audio-25/text-to-audio';
const VOICE = 'fal-ai/elevenlabs/tts/turbo-v2.5';
const SFX = 'fal-ai/elevenlabs/sound-effects/v2';

// ── catalog vocabulary ───────────────────────────────────────────────────────────────────────────
test('KINDS gains music/voice/sfx alongside the four visual purposes', () => {
  const keys = KINDS.map(k => k.key);
  for (const k of ['preview', 'render', 'edit', 'video', 'music', 'voice', 'sfx']) assert.ok(keys.includes(k), 'missing kind ' + k);
  assert.deepEqual(AUDIO_KINDS, ['music', 'voice', 'sfx']);
  assert.equal(isAudioKind('music'), true);
  assert.equal(isAudioKind('video'), false);
});

test('each new kind has at least one enabled FAL model with a cost', () => {
  const groups = enabledCatalog({});
  for (const kind of AUDIO_KINDS) {
    const g = groups.find(x => x.kind === kind);
    assert.ok(g && g.models.length, 'no enabled model for kind ' + kind);
    for (const m of g.models) {
      assert.equal(m.provider, 'fal');
      assert.equal(typeof m.cost, 'number');
      assert.ok(m.cost > 0);
    }
  }
});

test('modelKind / isAudioModel / isVideoModel classify the audio ids correctly', () => {
  assert.equal(modelKind(MUSIC), 'music');
  assert.equal(modelKind(VOICE), 'voice');
  assert.equal(modelKind(SFX), 'sfx');
  for (const id of [MUSIC, VOICE, SFX]) {
    assert.equal(isAudioModel(id), true, id + ' should be audio');
    assert.equal(isVideoModel(id), false, id + ' should not be video');
  }
  // a still image / video stays classified as before
  assert.equal(isAudioModel(DEFAULT_PREVIEW_MODEL), false);
  assert.equal(isAudioModel('fal-ai/veo3.1/image-to-video'), false);
  // legacy-safe inference for an id NOT in the table
  assert.equal(modelKind('fal-ai/some-new/text-to-speech'), 'voice');
  assert.equal(modelKind('fal-ai/whatever/sound-effects/v9'), 'sfx');
});

test('the voice/sfx endpoints declare promptField:text; music takes the default prompt field', () => {
  assert.equal(modelById(VOICE).promptField, 'text');
  assert.equal(modelById(SFX).promptField, 'text');
  assert.equal(modelById(MUSIC).promptField, undefined);
});

test('estCost falls back to a positive audio estimate for an unknown audio id', () => {
  assert.equal(estCost(MUSIC), 0.20);            // curated cost wins
  assert.ok(estCost('fal-ai/mystery/text-to-audio') > 0); // inferred audio → audio fallback
});

// ── seeded defaults ──────────────────────────────────────────────────────────────────────────────
test('modelDefaults seed music/voice/sfx without disturbing the visual defaults', () => {
  freshRoot();
  const d = getSettings().modelDefaults;
  assert.equal(d.preview, DEFAULT_PREVIEW_MODEL);          // untouched
  assert.equal(d.video, 'fal-ai/bytedance/seedance-2.0/image-to-video'); // untouched
  assert.equal(d.music, MUSIC);
  assert.equal(d.voice, VOICE);
  assert.equal(d.sfx, SFX);
});

// ── FAL adapter builds an AUDIO payload and parses an audio result ─────────────────────────────────
// Fake the three-call FAL queue flow (submit → status → response) and capture the submit body.
function withFalQueue(resultBody, fn) {
  const real = globalThis.fetch;
  let submittedBody = null, submittedUrl = null;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if ((init.method || 'GET') === 'POST' && u.startsWith('https://queue.fal.run/') && !u.includes('/requests/')) {
      submittedUrl = u; submittedBody = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ request_id: 'r1' }) };
    }
    if (u.includes('/status')) return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
    if (u.includes('/requests/')) return { ok: true, status: 200, json: async () => resultBody };
    return real(url, init);
  };
  return fn(() => ({ submittedBody, submittedUrl })).finally(() => { globalThis.fetch = real; });
}

test('FAL adapter: a TTS gen sends `text` (no image_size/aspect) and returns the audio url', async () => {
  process.env.FAL_KEY = 'test-key-audio'; // resolver precedence: env wins, no real network
  await withFalQueue({ audio: { url: 'https://v3.fal.media/files/x/out.mp3' } }, async (peek) => {
    const res = await runProvider('fal', { model: VOICE, prompt: 'Hello there, narrator voice.', aspect: '16:9', resolution: '1K' });
    assert.equal(res.fileUrl, 'https://v3.fal.media/files/x/out.mp3');
    const { submittedBody, submittedUrl } = peek();
    assert.equal(submittedUrl, 'https://queue.fal.run/' + VOICE);
    assert.equal(submittedBody.text, 'Hello there, narrator voice.'); // promptField → text
    assert.equal(submittedBody.prompt, undefined);
    assert.equal(submittedBody.image_size, undefined);   // audio payloads carry no visual shape
    assert.equal(submittedBody.aspect_ratio, undefined);
    assert.equal(submittedBody.num_images, undefined);
  });
  delete process.env.FAL_KEY;
});

test('FAL adapter: a music gen sends `prompt` and accepts a bare-string audio result', async () => {
  process.env.FAL_KEY = 'test-key-audio';
  await withFalQueue({ audio: 'https://v3.fal.media/files/y/song.wav' }, async (peek) => {
    const res = await runProvider('fal', { model: MUSIC, prompt: 'warm ambient pad, 20s', aspect: '1:1' });
    assert.equal(res.fileUrl, 'https://v3.fal.media/files/y/song.wav'); // string form parsed
    const { submittedBody } = peek();
    assert.equal(submittedBody.prompt, 'warm ambient pad, 20s'); // default promptField
    assert.equal(submittedBody.text, undefined);
    assert.equal(submittedBody.image_size, undefined);
  });
  delete process.env.FAL_KEY;
});
