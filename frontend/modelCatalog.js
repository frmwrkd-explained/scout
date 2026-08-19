// Provider-aware model catalog — the single source of truth for which AI models exist,
// which provider serves each, and how the app reaches that provider at runtime. Pure data +
// helpers, imported by BOTH the React app (frontend/*) and the Express server (backend/*).
// No React, no browser APIs, no other imports — keep it importable from Node.
//
// Integration TYPE = how a generation actually leaves the machine:
//   rest  — the server calls the provider's HTTP API with the user's API key   (FAL, Kie.ai)
//   cli   — the server drives a locally-installed, user-authed CLI              (Higgsfield)
//   agent — the server drives the Claude CLI, which reaches the provider's MCP  (Arcads)
//
// BACKWARD-COMPAT LAW: a FAL model `id` doubles as its queue path and is already persisted in
// settings.modelDefaults, settings.disabledModels, and every projects/*/generations/*.md.
// NEVER rename a `fal-ai/*` id. Other providers use a namespaced id (`kie/…`, `higgsfield/…`,
// `arcads/…`) so ids stay globally unique and the provider is always resolvable from the id.

export const PROVIDERS = [
  { id: 'fal', label: 'FAL', type: 'rest', keySetting: 'falApiKey', accent: '#E3FF32',
    connect: 'Paste your FAL key (id:secret) in Settings', docs: 'https://fal.ai/models' },
  { id: 'kie', label: 'Kie.ai', type: 'rest', keySetting: 'kieApiKey', accent: '#E3FF32',
    connect: 'Paste your Kie.ai key (Bearer) in Settings — one key, 100+ models', docs: 'https://kie.ai' },
  { id: 'higgsfield', label: 'Higgsfield', type: 'cli', cli: 'higgsfield', keySetting: null, accent: '#E3FF32',
    connect: 'Install the higgsfield CLI + run `higgsfield auth login` — the server drives it', docs: 'https://higgsfield.ai' },
  { id: 'arcads', label: 'Arcads', type: 'agent', keySetting: null, accent: '#E3FF32',
    connect: 'Reached through your connected Claude CLI (Arcads MCP tool)', docs: 'https://arcads.ai' }
];
export const providerDef = pid => PROVIDERS.find(p => p.id === pid) || null;

// kind = the generation "purposes" the app models (1:1 with modelDefaults keys). The first four are
// visual (image/video); music/voice/sfx (ticket 07) are the audio purposes — they land an audio file
// (.mp3/.wav) instead of an image/clip. AUDIO_KINDS is the audio subset used by pipeline branches.
export const KINDS = [
  { key: 'preview', group: 'IMAGE · PREVIEW', label: 'Preview' },
  { key: 'render', group: 'IMAGE · RENDER', label: 'Render' },
  { key: 'edit', group: 'IMAGE · CHARACTER / EDIT', label: 'Edit' },
  { key: 'video', group: 'VIDEO', label: 'Video' },
  { key: 'music', group: 'AUDIO · MUSIC', label: 'Music' },
  { key: 'voice', group: 'AUDIO · VOICE', label: 'Voice' },
  { key: 'sfx', group: 'AUDIO · SOUND FX', label: 'Sound FX' }
];
export const AUDIO_KINDS = ['music', 'voice', 'sfx'];
export const isAudioKind = k => AUDIO_KINDS.includes(k);
export const kindGroup = k => (KINDS.find(x => x.key === k) || {}).group || String(k || '').toUpperCase();

// OUTPUT kinds — what the USER picks ("give me an image"), as opposed to `kind` above, which is the
// catalog's finer-grained purpose. Image folds the three image purposes (preview/render/edit)
// because "preview vs render vs edit" is a model-selection detail, not something a director thinks
// about when choosing what to make. The rest are 1:1.
//
// This lived privately inside chat/ManualComposer.jsx until that file was deleted; it belongs here,
// with the rest of the catalog vocabulary, so the composer and every future surface read ONE list.
// Order is the display order of the filter row. `image` is the default everywhere.
export const OUTPUT_KINDS = [
  { key: 'image', label: 'Image', kinds: ['preview', 'render', 'edit'] },
  { key: 'video', label: 'Video', kinds: ['video'] },
  { key: 'music', label: 'Music', kinds: ['music'] },
  { key: 'voice', label: 'Voice', kinds: ['voice'] },
  { key: 'sfx', label: 'Sound design', kinds: ['sfx'] }
];
export const DEFAULT_OUTPUT_KIND = 'image';
export const outputKindOf = key => OUTPUT_KINDS.find(o => o.key === key) || OUTPUT_KINDS[0];
// which OUTPUT kind a model id belongs to — the inverse mapping, so picking a model can move the
// filter rather than the two disagreeing
export const outputKindForModel = id => {
  const k = modelKind(id);
  return (OUTPUT_KINDS.find(o => o.kinds.includes(k)) || OUTPUT_KINDS[0]).key;
};
// enabled models for one output kind, flattened from the canonical grouped catalog
export const modelsForOutputKind = (settings, outKey) => {
  const set = outputKindOf(outKey).kinds;
  return enabledCatalog(settings || {}).filter(g => set.includes(g.kind)).flatMap(g => g.models);
};
// the model to select when the user switches output kind: a matching per-kind modelDefaults entry
// if one is enabled, else the first enabled model of that kind, else '' (leave it to the caller)
export const defaultModelForOutputKind = (settings, outKey) => {
  const models = modelsForOutputKind(settings, outKey);
  if (!models.length) return '';
  const defs = (settings || {}).modelDefaults || {};
  for (const k of outputKindOf(outKey).kinds) {
    const want = defs[k];
    if (want && models.some(m => m.id === want)) return want;
  }
  return models[0].id;
};

// Every model the app knows about. Fields:
//   id         globally-unique id (FAL: the literal queue path — DO NOT RENAME)
//   provider   PROVIDERS.id
//   kind       preview | render | edit | video | music | voice | sfx
//   label      human name
//   cost       rough per-call USD (live UI estimate + ledger fallback when the API is silent)
//   note       one-line caption
//   slug       provider-native model string the adapter sends (Kie `model`, Higgsfield `--model`)
//   mcpTool    (agent providers) the MCP tool the Claude driver should call
//   promptField (audio models) the FAL input field the prompt maps to — TTS/SFX endpoints take
//               `text`, music endpoints take `prompt`. Defaults to `prompt` when unset.
export const MODELS = [
  // ── FAL · rest ─────────────────────────────────────────────────────────────
  // ids ARE the fal queue path — never rename (persisted across the whole data dir)
  { id: 'fal-ai/flux/schnell', provider: 'fal', kind: 'preview', label: 'FLUX Schnell', cost: 0.003, note: 'fastest · ~$0.003' },
  { id: 'fal-ai/nano-banana-2', provider: 'fal', kind: 'preview', label: 'Nano Banana 2', cost: 0.015, note: 'fast Gemini · ~$0.015' },
  { id: 'fal-ai/bytedance/seedream/v5/lite', provider: 'fal', kind: 'preview', label: 'Seedream 5 Lite', cost: 0.02, note: 'fast · ~$0.02' },
  { id: 'fal-ai/nano-banana-pro', provider: 'fal', kind: 'render', label: 'Nano Banana Pro', cost: 0.05, note: 'Google SOTA · ~$0.05' },
  { id: 'fal-ai/flux/dev', provider: 'fal', kind: 'render', label: 'FLUX.1 dev', cost: 0.025, note: 'flagship open · balanced' },
  { id: 'fal-ai/flux-pro/v1.1-ultra', provider: 'fal', kind: 'render', label: 'FLUX1.1 Pro Ultra', cost: 0.05, note: 'photoreal · up to 4MP' },
  { id: 'fal-ai/recraft/v4/pro/text-to-image', provider: 'fal', kind: 'render', label: 'Recraft v4 Pro', cost: 0.06, note: 'composition + typography' },
  { id: 'fal-ai/imagineart/imagineart-2.0-preview/text-to-image', provider: 'fal', kind: 'render', label: 'ImagineArt 2.0', cost: 0.04, note: 'visual reasoning' },
  { id: 'fal-ai/nano-banana-2/edit', provider: 'fal', kind: 'edit', label: 'Nano Banana 2 Edit', cost: 0.02, note: 'multi-image edit · 10–15s' },
  { id: 'fal-ai/nano-banana-pro/edit', provider: 'fal', kind: 'edit', label: 'Nano Banana Pro Edit', cost: 0.06, note: 'SOTA · slow 2–4min' },
  { id: 'fal-ai/bytedance/seedream/v5/lite/edit', provider: 'fal', kind: 'edit', label: 'Seedream 5 Lite Edit', cost: 0.02, note: 'fast edit' },
  { id: 'fal-ai/flux-pro/kontext', provider: 'fal', kind: 'edit', label: 'FLUX Pro Kontext', cost: 0.04, note: 'text + image edit' },
  { id: 'fal-ai/bytedance/seedance-2.0/image-to-video', provider: 'fal', kind: 'video', label: 'Seedance 2.0 i2v', cost: 0.40, note: 'cinematic + audio · ~$0.40' },
  { id: 'fal-ai/kling-video/v3/pro/image-to-video', provider: 'fal', kind: 'video', label: 'Kling v3 Pro i2v', cost: 0.42, note: 'top cinematic + audio' },
  { id: 'fal-ai/veo3.1/image-to-video', provider: 'fal', kind: 'video', label: 'Veo 3.1 i2v', cost: 0.50, note: 'Google SOTA + audio' },
  { id: 'fal-ai/sora-2/image-to-video', provider: 'fal', kind: 'video', label: 'Sora 2 i2v', cost: 0.30, note: 'OpenAI premium' },
  { id: 'fal-ai/pixverse/v6/image-to-video', provider: 'fal', kind: 'video', label: 'Pixverse v6 i2v', cost: 0.25, note: 'budget' },

  // ── FAL · audio (rest) ─────────────────────────────────────────────────────
  // text→audio endpoints. Output lands as .mp3/.wav (provider's choice), NOT an image_size payload —
  // the runFal adapter takes the audio branch (no aspect/resolution/image_size). `promptField` maps
  // the user's prompt onto the endpoint's input field. Costs are per-clip estimates (FAL bills music
  // per-audio, TTS/SFX per-1k-chars / per-second — the ledger records the live cost when returned).
  { id: 'fal-ai/stable-audio-25/text-to-audio', provider: 'fal', kind: 'music', label: 'Stable Audio 2.5', cost: 0.20, note: 'text→music · ~$0.20/clip' },
  { id: 'fal-ai/elevenlabs/tts/turbo-v2.5', provider: 'fal', kind: 'voice', label: 'ElevenLabs Turbo v2.5', cost: 0.02, note: 'TTS · ~$0.05/1k chars', promptField: 'text' },
  { id: 'fal-ai/elevenlabs/sound-effects/v2', provider: 'fal', kind: 'sfx', label: 'ElevenLabs Sound FX v2', cost: 0.01, note: 'text→SFX · ~$0.002/s', promptField: 'text' },

  // ── Kie.ai · rest ──────────────────────────────────────────────────────────
  // one Bearer key, POST /api/v1/jobs/createTask {model:<slug>, …} → poll recordInfo.
  { id: 'kie/flux-2', provider: 'kie', kind: 'render', label: 'FLUX 2', cost: 0.05, note: 'up to 4MP · 8 refs', slug: 'flux-2' },
  { id: 'kie/nano-banana-pro', provider: 'kie', kind: 'render', label: 'Nano Banana Pro', cost: 0.04, note: 'Gemini 3 Pro · text + character', slug: 'nano-banana-pro' },
  { id: 'kie/kling-2.6', provider: 'kie', kind: 'video', label: 'Kling 2.6', cost: 0.28, note: '5–10s · native audio', slug: 'kling-2.6' },
  { id: 'kie/veo-3.1', provider: 'kie', kind: 'video', label: 'Veo 3.1', cost: 0.50, note: 'high-fidelity audio', slug: 'veo-3.1' },
  // kie/sora2 REMOVED 2026-08-10. Kie serves no Sora model this key can reach: `sora2`, `sora-2`,
  // `sora-2/text-to-video`, `sora2/text-to-video` and `openai/sora-2` all answer "The model name you
  // specified is not supported", and there is no /api/v1/sora/generate (404) to match the Veo one.
  // Listing it offered users a model that could only ever fail. Sora is still reachable through FAL
  // (`fal-ai/sora-2/image-to-video`) and Arcads (`arcads/video-sora2`), both of which remain above.
  // Re-add only against a verified id — do not guess a slug from another provider's spelling.

  // ── Higgsfield · cli ───────────────────────────────────────────────────────
  // the server runs `higgsfield generate create --wait --model <slug> …` and reads the URL.
  // slugs verified against the higgsfield CLI model list (see backend/providers.mjs).
  { id: 'higgsfield/gpt-image-2', provider: 'higgsfield', kind: 'render', label: 'GPT Image 2', cost: 0.05, note: 'design · UI · on-image text', slug: 'gpt_image_2' },
  { id: 'higgsfield/nano-banana-pro', provider: 'higgsfield', kind: 'render', label: 'Nano Banana Pro', cost: 0.05, note: 'character / reference work', slug: 'nano_banana_pro' },
  { id: 'higgsfield/soul-v2', provider: 'higgsfield', kind: 'render', label: 'Soul V2', cost: 0.05, note: 'aesthetic UGC · editorial', slug: 'text2image_soul_v2' },
  { id: 'higgsfield/seedance-2', provider: 'higgsfield', kind: 'video', label: 'Seedance 2.0', cost: 0.40, note: 'cinematic · 4–15s · i2v', slug: 'seedance_2_0' },
  { id: 'higgsfield/kling-3', provider: 'higgsfield', kind: 'video', label: 'Kling 3.0', cost: 0.42, note: 'motion · i2v', slug: 'kling3_0' },

  // ── Arcads · agent (driven through the Claude CLI + Arcads MCP) ─────────────
  // no REST/CLI key exists — the server asks the connected Claude CLI to call the MCP tool.
  { id: 'arcads/image', provider: 'arcads', kind: 'render', label: 'Arcads Image', cost: 0.04, note: 'text-to-image', mcpTool: 'arcads_generate_image' },
  { id: 'arcads/image-nano-banana', provider: 'arcads', kind: 'render', label: 'Nano Banana (Arcads)', cost: 0.04, note: 'reference / character', mcpTool: 'arcads_generate_image_nano_banana' },
  { id: 'arcads/image-seedream', provider: 'arcads', kind: 'render', label: 'Seedream (Arcads)', cost: 0.04, note: 'stylized image', mcpTool: 'arcads_generate_image_seedream' },
  { id: 'arcads/video-kling-30-pro', provider: 'arcads', kind: 'video', label: 'Kling 3.0 Pro', cost: 0.45, note: 'cinematic video', mcpTool: 'arcads_generate_video_kling_30_pro' },
  { id: 'arcads/video-veo31', provider: 'arcads', kind: 'video', label: 'Veo 3.1 (Arcads)', cost: 0.50, note: 'Google SOTA', mcpTool: 'arcads_generate_video_veo31' },
  { id: 'arcads/video-sora2', provider: 'arcads', kind: 'video', label: 'Sora 2 (Arcads)', cost: 0.30, note: 'OpenAI premium', mcpTool: 'arcads_generate_video_sora2' },
  { id: 'arcads/video-seedance-20', provider: 'arcads', kind: 'video', label: 'Seedance 2.0 (Arcads)', cost: 0.40, note: 'cinematic + audio', mcpTool: 'arcads_generate_video_seedance_20' }
];

// ── lookups (legacy-safe: resolve provider/kind even for an id not in the table) ──
// The single declaration of the app-wide default preview model. backend/store.mjs imports it
// for DEFAULT_SETTINGS.modelDefaults.preview, so in practice callers reach it through
// settings.modelDefaults.preview; the `|| DEFAULT_PREVIEW_MODEL` arm in consumers is the
// last-resort guard for a settings object that predates or omits modelDefaults.
// Schnell is the house default for previews: fastest, and $0.003 vs $0.015 for nano-banana-2.
export const DEFAULT_PREVIEW_MODEL = 'fal-ai/flux/schnell';
export const modelById = id => MODELS.find(m => m.id === id) || null;
export function providerOfModel(id) {
  const m = modelById(id);
  if (m) return m.provider;
  const s = String(id || '');
  if (s.startsWith('fal-ai/')) return 'fal';                       // legacy fal ids
  const pre = s.split('/')[0];
  return PROVIDERS.some(p => p.id === pre) ? pre : 'fal';
}
export function modelKind(id) {
  const m = modelById(id);
  if (m) return m.kind;
  const s = String(id || '');
  // audio purposes first (none of these substrings collide with the visual tests below)
  if (/sound-effects|\/sfx\b/.test(s)) return 'sfx';
  if (/\/tts\/|text-to-speech|\/speech\b|elevenlabs\/tts/.test(s)) return 'voice';
  if (/stable-audio|text-to-audio|minimax-music|\/music\b/.test(s)) return 'music';
  if (/image-to-video|\/video|video/.test(s)) return 'video';
  if (/\/edit|kontext/.test(s)) return 'edit';
  return 'render';
}
// ── reference-image capacity ───────────────────────────────────────────────
// How many reference images a model actually accepts. The app used to hardcode "max 4"
// in three UIs and again in the backend, which throttled the multi-reference models
// (Nano Banana Pro takes 14) and over-promised on the ones that take one frame.
// This table is the only declaration — UI caps, toasts and the route's clamp all read it.
// A model absent from the table falls back to REF_CAP_DEFAULT for its kind.
const REF_CAPS = {
  'fal-ai/nano-banana-pro': 14, 'fal-ai/nano-banana-pro/edit': 14, 'kie/nano-banana-pro': 14,
  'higgsfield/nano-banana-pro': 14, 'arcads/image-nano-banana': 14,
  'fal-ai/nano-banana-2': 10, 'fal-ai/nano-banana-2/edit': 10,
  'fal-ai/bytedance/seedream/v5/lite': 10, 'fal-ai/bytedance/seedream/v5/lite/edit': 10,
  'arcads/image-seedream': 10,
  'kie/flux-2': 8,
  'fal-ai/flux-pro/kontext': 4,
  'higgsfield/gpt-image-2': 4,
  // one-frame conditioners: i2v takes a start frame (a few also take an end frame)
  'fal-ai/bytedance/seedance-2.0/image-to-video': 2, 'higgsfield/seedance-2': 2,
  'fal-ai/kling-video/v3/pro/image-to-video': 2, 'kie/kling-2.6': 2, 'higgsfield/kling-3': 2,
  'arcads/video-seedance-20': 2, 'arcads/video-kling-30-pro': 2,
};
const REF_CAP_DEFAULT = { video: 1, render: 4, preview: 4, edit: 4 };
export function maxRefs(id) {
  if (REF_CAPS[id]) return REF_CAPS[id];
  const cap = REF_CAP_DEFAULT[modelKind(id)];
  return cap == null ? 0 : cap;   // audio kinds take no reference frames
}

// ── how long to wait for a provider ────────────────────────────────────────
// DEV-131. Every provider adapter used to share two hardcoded constants: 120s for anything that
// wasn't video, 360s for video. 120s is simply not enough for the current SOTA image models —
// `fal-ai/nano-banana-pro` is this app's default RENDER model and measured 45–100s per call, so a
// queue busier than usual pushed it over the line and the job died with `timed out after 120s`.
// That is the DEV-131 failure, recorded verbatim in workspace/activity.md.
//
// So the wait is a model fact and lives here with the rest of them, not in the adapter. Seconds.
// A model absent from the table falls back to its kind's default. Raise a number here rather than
// re-hardcoding one in backend/providers.mjs.
const TIMEOUT_BY_KIND = {
  preview: 180,   // schnell/nano-banana-2 answer in seconds; the headroom is for queue depth
  render: 300,
  edit: 300,
  video: 360,
  music: 300, voice: 180, sfx: 180
};
const TIMEOUTS = {
  // its own catalog note says "slow 2–4min" — 240s of work needs more than 240s of budget
  'fal-ai/nano-banana-pro/edit': 420,
  // measured 2026-07-30 against the live higgsfield CLI: a single 16:9 render took 235s, i.e. 78%
  // of the 300s `render` default. That is the DEV-131 shape again — a model that fits on a quiet
  // queue and dies on a busy one. Same ~3x headroom the other slow models get.
  'higgsfield/gpt-image-2': 600
};
export const DEFAULT_TIMEOUT_SECONDS = 300;
export function timeoutSecondsFor(id) {
  return TIMEOUTS[id] ?? TIMEOUT_BY_KIND[modelKind(id)] ?? DEFAULT_TIMEOUT_SECONDS;
}
export const timeoutMsFor = id => timeoutSecondsFor(id) * 1000;

export const isVideoModel = id => modelKind(id) === 'video';
export const isAudioModel = id => isAudioKind(modelKind(id));
export const isEditModel = id => modelKind(id) === 'edit' || /\/edit|kontext|image-to-video/.test(String(id || ''));
export const estCost = id => (modelById(id)?.cost) ?? (isAudioModel(id) ? 0.05 : isVideoModel(id) ? 0.4 : 0.03);

// ── cost calculator ────────────────────────────────────────────────────────
// Video is billed PER SECOND by every provider this app routes to, so a flat per-generation number
// is wrong the moment the clip is not the default length. A model's `cost` field is the price of a
// DEFAULT_CLIP_SECONDS clip — 5s, which is exactly what backend/providers.mjs:129 requests when
// nothing overrides it — so the per-second rate is cost / 5 and a 10s clip costs double.
//
// This is a DERIVED rate, not a published price sheet: it is the catalog's own number divided by
// the length that number describes. If a provider publishes a real per-second rate that disagrees,
// add `costPerSecond` to that model entry and it wins. Images and audio are per-generation and are
// unaffected by duration.
export const DEFAULT_CLIP_SECONDS = 5;

export const perSecondRate = id => {
  const m = modelById(id);
  if (m && typeof m.costPerSecond === 'number') return m.costPerSecond;
  if (!isVideoModel(id)) return 0;
  return estCost(id) / DEFAULT_CLIP_SECONDS;
};

// estimateCost(id, { duration, variantCount }) -> { total, per, unit, seconds, rate, perSecond }
//   total     what the whole request costs
//   per       cost of ONE candidate
//   unit      'second' for video, 'generation' otherwise — drives the UI's breakdown line
//   perSecond true when duration actually moved the number
export function estimateCost(id, { duration, variantCount = 1 } = {}) {
  const n = Math.max(1, Number(variantCount) || 1);
  const vid = isVideoModel(id);
  const secs = vid ? Math.max(1, Number(duration) || DEFAULT_CLIP_SECONDS) : 0;
  const rate = vid ? perSecondRate(id) : 0;
  const per = vid ? rate * secs : estCost(id);
  return {
    total: per * n, per, rate, seconds: secs, variantCount: n,
    unit: vid ? 'second' : 'generation', perSecond: vid,
  };
}

// ── resolution ─────────────────────────────────────────────────────────────
// The composer asks for a shape (aspect) and a size (resolution); the two combine into the real
// pixel dimensions the provider is asked for. Kept here so the UI label, the FAL/Kie payloads and
// the ledger all read the same table. `long` is the long edge in px.
export const RESOLUTIONS = [
  { id: '1K', label: '1K', long: 1024, note: 'draft · fastest' },
  { id: '2K', label: '2K', long: 2048, note: 'delivery' },
  { id: '4K', label: '4K', long: 3840, note: 'max detail · slower' }
];
export const DEFAULT_RESOLUTION = '1K';
export const resolutionDef = id => RESOLUTIONS.find(r => r.id === id) || RESOLUTIONS[0];
const ASPECT_NUM = { '16:9': 16 / 9, '2.39:1': 2.39, '9:16': 9 / 16, '1:1': 1, '4:5': 0.8 };

// aspect + resolution → { width, height }, snapped to a multiple of 16 (diffusion models want it)
export function pixelSize(aspect, resolution) {
  const ratio = ASPECT_NUM[aspect] || ASPECT_NUM['16:9'];
  const long = resolutionDef(resolution).long;
  const snap = n => Math.max(256, Math.round(n / 16) * 16);
  return ratio >= 1
    ? { width: snap(long), height: snap(long / ratio) }
    : { width: snap(long * ratio), height: snap(long) };
}
// Nano Banana / Seedream take a named resolution tier instead of explicit pixels; everything else
// on FAL takes an image_size object. Kie has its own `resolution` string on the non-flux endpoints.
export const usesResolutionTier = id => /nano-banana|seedream/.test(String(id || ''));
export const fmtSize = (w, h) => (w && h ? w + '×' + h : '');

// FAL's `image_size` enum names a SHAPE, not a size — `landscape_4_3` is an aspect, and printing it
// next to the composer's own aspect says the same thing twice, in two vocabularies, and (when they
// disagree) contradicts itself. Normalise it into this app's aspect token so a chip reads
// "FLUX Schnell · 4:3 · 1K" instead of "FLUX Schnell · 16:9 · landscape_4_3".
// Returns null for anything unrecognised — callers fall back to their own aspect rather than
// printing a raw provider key at the user.
const IMAGE_SIZE_ASPECT = {
  square_hd: '1:1', square: '1:1',
  portrait_4_3: '3:4', portrait_16_9: '9:16',
  landscape_4_3: '4:3', landscape_16_9: '16:9',
};
export function aspectLabel(imageSize) {
  if (!imageSize) return null;
  // providers.mjs sends an explicit { width, height } for the aspects FAL has no enum for
  if (typeof imageSize === 'object') return fmtSize(imageSize.width, imageSize.height) || null;
  return IMAGE_SIZE_ASPECT[imageSize] || null;
}

// ── custom models (settings.customModels — endpoints enabled from a synced provider catalog) ──
// Each entry is opt-in: { id, provider, kind, label, note, custom:true } — for FAL the id is the
// literal queue path, so generation routes with zero extra plumbing. Curated ids win collisions.
export function customModels(settings) {
  const curated = new Set(MODELS.map(m => m.id));
  return ((settings || {}).customModels || []).filter(m => m && m.id && !curated.has(m.id))
    .map(m => ({ ...m, custom: true }));
}
// curated + custom — what every picker should iterate
export const allModels = settings => [...MODELS, ...customModels(settings)];

// ── enable / disable (settings.disabledModels — the Model Catalog toggles) ──
export const isModelEnabled = (settings, id) => !((settings || {}).disabledModels || []).includes(id);
export const enabledModels = settings => allModels(settings).filter(m => isModelEnabled(settings, m.id));

// grouped-by-kind, enabled-only — the shape Generate.jsx + PromptBuilder.jsx already consume:
//   [{ group:'IMAGE · PREVIEW', kind:'preview', models:[{id,label,note,provider,…}] }, …]
export function enabledCatalog(settings, opts = {}) {
  const providers = opts.providers || null; // optional whitelist of provider ids
  const pool = allModels(settings);
  return KINDS.map(k => ({
    group: k.group,
    kind: k.key,
    models: pool.filter(m => m.kind === k.key && isModelEnabled(settings, m.id) &&
      (!providers || providers.includes(m.provider)))
  })).filter(g => g.models.length);
}

// ── provider connection (rest providers only — cli/agent need a server round-trip) ──
export const providerHasKey = (settings, pid) => {
  const p = providerDef(pid);
  return !!(p && p.keySetting && (settings || {})[p.keySetting]);
};
