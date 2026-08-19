// Ticket 04 — FAL per-model spec sync + normalized schema route.
//
// The network is NEVER touched: globalThis.fetch is replaced with a stub that serves canned
// OpenAPI docs (or throws, to simulate offline). We assert the normalized shape for an image and
// a video model, the caching / offline behaviour, a forced re-sync, and the non-FAL fallback
// marker. Shape here is the contract tickets 05/19 consume — keep it in sync with modelSchemas.mjs.
import './_env.mjs'; // first — sets storage-root env before the store loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { freshRoot, req } from './helpers.mjs';
import {
  normalizeFalOpenapi, getModelSchema, fallbackSchema, readSchemaCache
} from '../backend/modelSchemas.mjs';

// ── canned OpenAPI docs (trimmed to the shapes FAL actually publishes) ──────────────────────────
const IMAGE_ID = 'fal-ai/flux/schnell';
const IMAGE_OPENAPI = {
  info: { 'x-fal-metadata': { category: 'text-to-image' } },
  paths: {
    '/fal-ai/flux/schnell': { post: { requestBody: { $ref: '#/components/schemas/FluxSchnellInput' } } },
    '/fal-ai/flux/schnell/requests/{request_id}': { get: {} }
  },
  components: { schemas: { FluxSchnellInput: {
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', title: 'Prompt', description: 'The prompt to generate an image from.' },
      image_size: {
        title: 'Image Size', default: 'landscape_4_3', description: 'The size of the generated image.',
        anyOf: [{ $ref: '#/components/schemas/ImageSize' },
                { type: 'string', enum: ['square_hd', 'square', 'portrait_16_9', 'landscape_16_9'] }]
      },
      num_images: { type: 'integer', title: 'Num Images', minimum: 1, maximum: 4, default: 1 },
      guidance_scale: { type: 'number', minimum: 1, maximum: 20, default: 3.5, multipleOf: 0.1 },
      enable_safety_checker: { type: 'boolean', default: true },
      seed: { anyOf: [{ type: 'integer' }, { type: 'null' }] }
    }
  } } }
};

const VIDEO_ID = 'fal-ai/kling-video/v3/pro/image-to-video';
const VIDEO_OPENAPI = {
  info: { 'x-fal-metadata': { category: 'image-to-video' } },
  paths: {
    '/fal-ai/kling-video/v3/pro/image-to-video': { post: { requestBody: { $ref: '#/components/schemas/KlingV3Input' } } }
  },
  components: { schemas: { KlingV3Input: {
    required: ['start_image_url'],
    properties: {
      start_image_url: { type: 'string', title: 'Start Image Url', description: 'First frame.' },
      end_image_url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'End Image Url' },
      duration: { type: 'string', default: '5', enum: ['3', '4', '5', '6', '7', '8', '9', '10'] },
      generate_audio: { type: 'boolean', default: true },
      cfg_scale: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
      prompt: { anyOf: [{ type: 'string' }, { type: 'null' }] }
    }
  } } }
};

// Install a fetch stub for the duration of `fn`. `docs` maps endpoint_id → OpenAPI object; a
// missing id (or docs===null) makes the stub throw, simulating an offline / failed fetch.
async function withFetch(docs, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.includes('fal.ai/api/openapi')) return real(url, init); // pass through (e.g. the test HTTP server)
    if (!docs) throw new Error('offline');
    const id = new URL(u).searchParams.get('endpoint_id');
    const doc = docs[id];
    if (!doc) throw new Error('no stub for ' + id);
    return { ok: true, status: 200, statusText: 'OK', json: async () => doc };
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const field = (schema, name) => schema.fields.find(f => f.name === name);

// ── pure normalization ─────────────────────────────────────────────────────────────────────────
test('image model: enums, numeric ranges, defaults and required are represented distinctly', () => {
  const s = normalizeFalOpenapi(IMAGE_OPENAPI, IMAGE_ID);
  assert.equal(s.ok, true);
  assert.equal(s.provider, 'fal');
  assert.equal(s.source, 'fal-openapi');
  assert.equal(s.fallback, false);
  assert.equal(s.category, 'text-to-image');
  assert.deepEqual(s.required, ['prompt']);

  const prompt = field(s, 'prompt');
  assert.equal(prompt.type, 'string');
  assert.equal(prompt.required, true);
  assert.equal(prompt.label, 'Prompt');

  const size = field(s, 'image_size');           // anyOf { $ref ImageSize } | { enum } → enum wins
  assert.equal(size.type, 'enum');
  assert.deepEqual(size.options, ['square_hd', 'square', 'portrait_16_9', 'landscape_16_9']);
  assert.equal(size.default, 'landscape_4_3');

  const n = field(s, 'num_images');              // integer range
  assert.equal(n.type, 'integer');
  assert.equal(n.min, 1);
  assert.equal(n.max, 4);
  assert.equal(n.default, 1);

  const g = field(s, 'guidance_scale');          // number range + step
  assert.equal(g.type, 'number');
  assert.equal(g.min, 1);
  assert.equal(g.max, 20);
  assert.equal(g.step, 0.1);

  assert.equal(field(s, 'enable_safety_checker').type, 'boolean');
  assert.equal(field(s, 'seed').nullable, true); // anyOf integer | null
  // a pure text-to-image model exposes no reference-media input
  assert.equal(s.fields.some(f => f.ref), false);
});

test('video model: string enum, reference-image inputs, and required flags are captured', () => {
  const s = normalizeFalOpenapi(VIDEO_OPENAPI, VIDEO_ID);
  assert.equal(s.category, 'image-to-video');
  assert.deepEqual(s.required, ['start_image_url']);

  const start = field(s, 'start_image_url');     // *_url → image reference input
  assert.equal(start.type, 'image');
  assert.equal(start.ref, 'image');
  assert.equal(start.required, true);

  const end = field(s, 'end_image_url');
  assert.equal(end.ref, 'image');
  assert.equal(end.required, false);
  assert.equal(end.nullable, true);

  const dur = field(s, 'duration');              // string enum (not a number range)
  assert.equal(dur.type, 'enum');
  assert.equal(dur.default, '5');
  assert.deepEqual(dur.options, ['3', '4', '5', '6', '7', '8', '9', '10']);

  const cfg = field(s, 'cfg_scale');
  assert.equal(cfg.type, 'number');
  assert.equal(cfg.max, 1);
});

// ── fallback marker for models without a fetchable spec ──────────────────────────────────────────
test('non-FAL models return the documented fallback marker without erroring', async () => {
  freshRoot();
  const s = await getModelSchema('kie/kling-2.6');
  assert.equal(s.ok, true);
  assert.equal(s.fallback, true);                // the marker: client uses generic FormatControls
  assert.equal(s.provider, 'kie');
  assert.equal(s.source, 'catalog');
  // minimal derived fields keep a form non-empty; a video model gets a reference-image input
  assert.ok(s.fields.some(f => f.name === 'prompt'));
  assert.ok(s.fields.some(f => f.ref === 'image'));
});

// ── caching, offline and re-sync ────────────────────────────────────────────────────────────────
test('a FAL schema is fetched once, cached under the storage root, then served offline', async () => {
  freshRoot();
  const docs = { [IMAGE_ID]: IMAGE_OPENAPI };

  const first = await withFetch(docs, () => getModelSchema(IMAGE_ID));
  assert.equal(first.source, 'fal-openapi');
  assert.ok(first.synced, 'cache write stamps synced');

  // it is now on disk as a markdown record with a staleness stamp
  const cached = readSchemaCache(IMAGE_ID);
  assert.ok(cached && cached.synced && cached.stale === false);

  // offline (fetch throws): a fresh cache is served straight from disk, no fetch attempted
  const offlineFresh = await withFetch(null, () => getModelSchema(IMAGE_ID));
  assert.equal(offlineFresh.source, 'fal-openapi');
  assert.equal(offlineFresh.fallback, false);
});

test('offline with a STALE cache still serves the cache (marked stale/offline)', async () => {
  const root = freshRoot();
  await withFetch({ [IMAGE_ID]: IMAGE_OPENAPI }, () => getModelSchema(IMAGE_ID));

  // age the cache past the TTL by rewriting its synced stamp to long ago
  const file = root + '/catalog/schemas/fal-ai_flux_schnell.md';
  const raw = fs.readFileSync(file, 'utf8').replace(/synced: .*/g, 'synced: 2000-01-01T00:00:00.000Z');
  fs.writeFileSync(file, raw);
  assert.equal(readSchemaCache(IMAGE_ID).stale, true);

  const served = await withFetch(null, () => getModelSchema(IMAGE_ID)); // fetch fails → serve stale
  assert.equal(served.offline, true);
  assert.equal(served.stale, true);
  assert.equal(served.source, 'fal-openapi'); // still the real schema, not a fallback
});

test('re-sync refreshes a stale cache when the network is back', async () => {
  const root = freshRoot();
  await withFetch({ [IMAGE_ID]: IMAGE_OPENAPI }, () => getModelSchema(IMAGE_ID));
  const file = root + '/catalog/schemas/fal-ai_flux_schnell.md';
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/synced: .*/g, 'synced: 2000-01-01T00:00:00.000Z'));

  const fresh = await withFetch({ [IMAGE_ID]: IMAGE_OPENAPI }, () => getModelSchema(IMAGE_ID, { force: true }));
  assert.equal(fresh.source, 'fal-openapi');
  assert.equal(readSchemaCache(IMAGE_ID).stale, false); // stamp is current again
});

test('offline first-request with no cache falls back without erroring', async () => {
  freshRoot();
  const s = await withFetch(null, () => getModelSchema(IMAGE_ID));
  assert.equal(s.ok, true);
  assert.equal(s.fallback, true);
  assert.match(s.reason, /fetch-failed/);
});

// ── HTTP route contract ──────────────────────────────────────────────────────────────────────────
test('GET /api/catalog/model-schema serves a normalized schema; POST /sync forces a refresh', async () => {
  freshRoot();
  const got = await withFetch({ [VIDEO_ID]: VIDEO_OPENAPI },
    () => req('GET', '/api/catalog/model-schema?id=' + encodeURIComponent(VIDEO_ID)));
  assert.equal(got.status, 200);
  assert.equal(got.body.source, 'fal-openapi');
  assert.equal(got.body.fields.find(f => f.name === 'start_image_url').ref, 'image');

  const synced = await withFetch({ [VIDEO_ID]: VIDEO_OPENAPI },
    () => req('POST', '/api/catalog/model-schema/sync?id=' + encodeURIComponent(VIDEO_ID)));
  assert.equal(synced.status, 200);
  assert.ok(synced.body.synced);

  // fallback marker still returns 200 through the route (never a 500)
  const fb = await req('GET', '/api/catalog/model-schema?id=higgsfield/soul-v2');
  assert.equal(fb.status, 200);
  assert.equal(fb.body.fallback, true);
});

test('fallbackSchema derives kind-appropriate fields from the catalog entry', () => {
  const img = fallbackSchema('kie/flux-2', 'kie', 'test');
  assert.equal(img.fallback, true);
  assert.equal(img.fields.some(f => f.ref === 'image'), false); // render kind → no forced ref input
  const vid = fallbackSchema('kie/veo-3.1', 'kie', 'test');
  assert.equal(vid.fields.some(f => f.ref === 'image'), true);  // video kind → reference input
});
