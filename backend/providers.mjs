// Provider adapters + dispatch — the layer that makes generation provider-agnostic.
// generate.mjs prepares a request (prompt + refs resolved to BOTH hosted https urls AND local
// file paths) and calls runProvider(providerId, params); each adapter submits to its provider
// and resolves { fileUrl, cost, raw }. Four integration types (see frontend/modelCatalog.js):
//   fal, kie   → REST APIs called with the user's API key
//   higgsfield → the local `higgsfield` CLI the user is logged into
//   arcads     → the Claude CLI, which reaches Arcads through its MCP tool
import { getSettings } from './store.mjs';
import { falKey, testFal } from './fal.mjs';
import { runOnce, resolveBin, findAgent } from './jobs.mjs';
import { modelById, modelKind, isAudioModel, estCost, estimateCost, providerDef, PROVIDERS, pixelSize, usesResolutionTier, DEFAULT_RESOLUTION, maxRefs, timeoutMsFor, timeoutSecondsFor } from '../frontend/modelCatalog.js';

// Same env-over-settings precedence as falKey()/groqKey(). Every provider credential is
// resolved through exactly one function — never read getSettings().<x>ApiKey directly.
export function kieKey() {
  return process.env.KIE_API_KEY || getSettings().kieApiKey || '';
}

// DEV-131: how long to wait is a per-model fact and is declared in the catalog
// (frontend/modelCatalog.js `TIMEOUT_BY_KIND` / `TIMEOUTS`). The two constants that used to live
// here — 120s for everything non-video, 360s for video — killed `fal-ai/nano-banana-pro`, the
// default render model, which measures 45–100s and so sat right on the 120s line. Do not
// re-introduce a literal timeout in this file; raise the model's number in the catalog.
const isVid = model => modelKind(model) === 'video';

// A queue poll that returns non-OK used to be swallowed with a bare `continue`, so a revoked key,
// a 429, or a provider outage was indistinguishable from a slow model: the job burned its whole
// timeout and reported the generic "timed out after Ns". These classify instead.
//   · 401/403 — the credential is wrong and will not become right by waiting. Fail now.
//   · anything else — transient. Tolerate a few in a row, then report the real status and body.
const POLL_FAIL_TOLERANCE = 5;
function pollFailure(providerLabel, status, body) {
  const detail = String(body || '').trim().slice(0, 200);
  if (status === 401 || status === 403) {
    return new Error(providerLabel + ' rejected the API key while polling (' + status + ') — check the key in Settings' + (detail ? ': ' + detail : ''));
  }
  return new Error(providerLabel + ' status polling failed ' + POLL_FAIL_TOLERANCE + 'x in a row (last: ' + status + ')' + (detail ? ': ' + detail : ''));
}
// pull the last http(s) URL out of arbitrary CLI/agent output (bare URL, log noise, JSON…)
const lastUrl = s => { const m = String(s || '').match(/https?:\/\/[^\s"'<>)\]}]+/g); return m ? m[m.length - 1].replace(/[.,]+$/, '') : null; };

// aspect → provider-native shapes
const FAL_ASPECT = {
  '16:9': { image_size: 'landscape_16_9', aspect_ratio: '16:9' },
  '2.39:1': { image_size: { width: 1376, height: 576 }, aspect_ratio: '21:9' },
  '9:16': { image_size: 'portrait_16_9', aspect_ratio: '9:16' },
  '1:1': { image_size: 'square_hd', aspect_ratio: '1:1' },
  '4:5': { image_size: { width: 1024, height: 1280 }, aspect_ratio: '4:5' }
};
// (An ASPECT_WH table used to sit here as a fallback for the Kie flux-2 path. It was a
// SECOND aspect→pixel source of truth against frontend/modelCatalog.js's pixelSize(), and
// two of its five entries disagreed with it: '16:9' was [1344,768], a ratio of 1.750
// rather than 1.7778, and '9:16' was [768,1344] = 0.5714 rather than 0.5625. It was also
// unreachable — every caller defaults `resolution` to DEFAULT_RESOLUTION before it gets
// here, so the fallback arm never ran. Deleted 2026-08-02; use pixelSize().)

// ── FAL (rest) ──────────────────────────────────────────────────────────────
function extractFalCost(r) {
  for (const k of ['cost', 'cost_usd', 'costUsd', 'billed_cost']) if (typeof r?.[k] === 'number') return r[k];
  if (typeof r?.metrics?.cost === 'number') return r.metrics.cost;
  if (typeof r?.output?.cost === 'number') return r.output.cost;
  if (typeof r?.pricing?.cost_usd === 'number') return r.pricing.cost_usd;
  return null;
}
async function runFal({ model, prompt, aspect, seed, refUrls, resolution, params }) {
  const key = falKey();
  if (!key) throw new Error('No FAL key — add one in Settings');
  let input;
  if (isAudioModel(model)) {
    // audio (music/voice/sfx): no aspect / resolution / image_size — just the text on the endpoint's
    // own prompt field (`prompt` for music, `text` for the ElevenLabs TTS/SFX endpoints). Seed rides
    // along when the endpoint accepts it; refs are meaningless for text→audio and are dropped.
    const pf = modelById(model)?.promptField || 'prompt';
    input = { [pf]: prompt };
    if (seed != null && seed !== '') input.seed = Number(seed);
  } else {
    const asp = FAL_ASPECT[aspect] || FAL_ASPECT['16:9'];
    input = { prompt, image_size: asp.image_size, aspect_ratio: asp.aspect_ratio, num_images: 1, output_format: 'png' };
    // resolution: Nano Banana / Seedream take a named tier ('1K'|'2K'|'4K'); the rest take explicit
    // pixels. At the default tier we leave the legacy named image_size alone so existing behaviour
    // (and every model with a non-standard size enum) is untouched.
    if (!isVid(model)) {
      const res = resolution || DEFAULT_RESOLUTION;
      if (usesResolutionTier(model)) { input.resolution = res; delete input.image_size; }
      else if (res !== DEFAULT_RESOLUTION) input.image_size = pixelSize(aspect, res);
    }
    if (seed != null && seed !== '') input.seed = Number(seed);
    if (refUrls?.length) { input.image_urls = refUrls; if (isVid(model)) input.image_url = refUrls[0]; }
  }
  // SchemaForm params (ticket 05): the model's OWN spec fields override the generic mapping above —
  // e.g. a synced image_size/aspect_ratio/duration enum beats the aspect table. The prompt field
  // stays authoritative: params may not overwrite what the composer wrote.
  if (params && typeof params === 'object') {
    const pf = isAudioModel(model) ? (modelById(model)?.promptField || 'prompt') : 'prompt';
    for (const [k, v] of Object.entries(params)) {
      if (k === pf || v == null || v === '') continue;
      input[k] = v;
    }
  }
  const sub = await fetch('https://queue.fal.run/' + model, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + key }, body: JSON.stringify(input)
  });
  if (!sub.ok) throw new Error('FAL submit ' + sub.status + ': ' + (await sub.text()).slice(0, 300));
  const sj = await sub.json();
  const requestId = sj.request_id;
  if (!requestId) throw new Error('FAL returned no request_id');
  const statusUrl = sj.status_url || ('https://queue.fal.run/' + model + '/requests/' + requestId + '/status');
  const responseUrl = sj.response_url || ('https://queue.fal.run/' + model + '/requests/' + requestId);
  const timeout = timeoutMsFor(model);
  const t0 = Date.now();
  let done = false, fails = 0, lastStatus = null;
  while (Date.now() - t0 < timeout) {
    await new Promise(r => setTimeout(r, 1500));
    const st = await fetch(statusUrl, { headers: { Authorization: 'Key ' + key } });
    if (!st.ok) {
      const body = await st.text().catch(() => '');
      if (st.status === 401 || st.status === 403) throw pollFailure('FAL', st.status, body);
      if (++fails >= POLL_FAIL_TOLERANCE) throw pollFailure('FAL', st.status, body);
      continue;
    }
    fails = 0;
    const s = await st.json();
    lastStatus = s.status || lastStatus;
    if (s.status === 'COMPLETED') { done = true; break; }
    if (s.status === 'FAILED' || s.status === 'CANCELLED') throw new Error('FAL job ' + s.status.toLowerCase());
  }
  // name the model and where it got stuck — "timed out after 120s" told the user nothing about
  // whether the job was still queued behind other work or actually running (DEV-131).
  if (!done) throw new Error('FAL ' + model + ' timed out after ' + timeoutSecondsFor(model) + 's'
    + (lastStatus ? ' (last queue status: ' + lastStatus + ')' : ' (never reported a queue status)'));
  const resp = await fetch(responseUrl, { headers: { Authorization: 'Key ' + key } });
  if (!resp.ok) throw new Error('FAL result ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  const result = await resp.json();
  // audio endpoints return `audio` (a URL string on stable-audio, an { url } object on ElevenLabs)
  // or `audio_file`; images use `images[]`/`image`, video uses `video`.
  const media = result.images?.[0] || result.image || result.video || result.audio || result.audio_file || result.audio_url || result.output?.images?.[0] || result.output?.audio || null;
  const fileUrl = typeof media === 'string' ? media : media?.url;
  if (!fileUrl) throw new Error('FAL result had no media URL');
  return { fileUrl, cost: extractFalCost(result) ?? estCost(model), raw: result };
}

// ── Kie.ai (rest) ───────────────────────────────────────────────────────────
const KIE = 'https://api.kie.ai';
// The one place both Kie pollers read a finished job's media URL — /jobs/recordInfo and Veo's
// /veo/record-info answer with DIFFERENT shapes, and this has to satisfy both.
//
// Veo nests its output under `response`, which nothing here looked at. So a Veo job that finished
// perfectly was charged for, reported `finished`, then threw "Kie completed but returned no result
// URL" — the user pays and is told it failed, which is the worst possible pairing. Veo also spells
// the fallback `originUrls`, and delivers a plain `resultUrls` array rather than the JSON-in-a-
// string that createTask models use.
function kieUrl(d) {
  const first = v => (Array.isArray(v) ? v[0] : v) || null;
  let url = d.result?.url || d.resultUrl || first(d.resultUrls)
    || first(d.response?.resultUrls) || first(d.response?.originUrls)
    || d.response?.resultUrl || d.response?.url || null;
  if (!url && d.resultJson) {
    try {
      const rj = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson;
      url = first(rj.resultUrls) || first(rj.result_urls) || first(rj.originUrls) || rj.url
        || rj.results?.[0]?.url || rj.images?.[0]?.url || rj.video?.url;
    } catch { /* fall through */ }
  }
  return url || null;
}
// Every generation parameter goes inside `input`, in snake_case. The flat camelCase body this
// used to send is the shape of Kie's OLDER per-model endpoints (/api/v1/flux/kontext/generate and
// friends) aimed at the newer unified /jobs/createTask URL, so the server's null-check on `input`
// fired before it ever looked at the model. Every Kie generation has failed since the first commit.
//
// Verified against the live API on 2026-08-10, not inferred:
//   {"model":"nano-banana-pro","prompt":"…"}            -> 422 The input cannot be null
//   {"model":"nano-banana-pro","input":{"prompt":"…"}}  -> 200 success, taskId 6eb3e2f4…
//
// The task-qualified ids were confirmed the same way, by POSTing `input:{}` — an empty input fails
// validation AFTER the model is checked, so a bad id answers "model name not supported" while a
// good one answers "prompt is required". That distinguishes the two without creating a billable job:
//   nano-banana-pro           -> prompt is required        (bare slug IS correct here)
//   flux-2                    -> model name not supported
//   flux-2/pro-text-to-image  -> prompt is required
//   flux-2/pro-image-to-image -> input_urls is required
//   kling-2.6                 -> model name not supported
//   kling-2.6/text-to-video   -> This field is required
// There is no naming RULE — `nano-banana-pro` is bare and correct while `flux-2` must be qualified.
// Read each id off its own model page; do not pattern-match one family from another.
const KIE_TASK = {
  'flux-2':    { t2i: 'flux-2/pro-text-to-image', i2i: 'flux-2/pro-image-to-image', refs: 'input_urls' },
  'kling-2.6': { t2i: 'kling-2.6/text-to-video',  i2i: 'kling-2.6/image-to-video',  refs: 'image_urls' },
};

async function runKie({ model, prompt, aspect, refUrls, resolution, duration }) {
  const key = kieKey();
  if (!key) throw new Error('No Kie.ai key — set KIE_API_KEY in .env or add one in Settings');
  const slug = modelById(model)?.slug || String(model).replace(/^kie\//, '');
  const video = isVid(model);
  const ar = aspect === '2.39:1' ? '16:9' : aspect;

  // Veo is not a createTask model at all — it has its own endpoint and a FLAT body with no `input`
  // envelope. Confirmed live: POST /api/v1/veo/generate {} -> 422 "Please enter prompt", while
  // every veo id on createTask answers "model name not supported".
  if (slug.startsWith('veo')) return runKieVeo({ model, slug, prompt, aspect: ar, refUrls, key });

  const task = KIE_TASK[slug];
  const hasRefs = !!refUrls?.length;
  const id = task ? (hasRefs ? task.i2i : task.t2i) : slug;
  const input = { prompt };

  if (video) {
    // `duration` is a QUOTED STRING ("5"/"10"), not a number, and `sound` is required on both
    // kling endpoints. image-to-video takes no aspect_ratio — the supplied frame decides it.
    input.duration = '5';
    input.sound = false;
    // maxRefs(model), not a literal. The composer lets a user attach up to the catalog's cap and
    // promises they are all sent; this adapter quietly truncated to its own hardcoded number, so
    // refs past it were dropped with nothing said. runHiggsfield already reads the catalog.
    if (hasRefs) input[task?.refs || 'image_urls'] = refUrls.slice(0, Math.max(1, maxRefs(model)));
    else input.aspect_ratio = ['1:1', '16:9', '9:16'].includes(ar) ? ar : '16:9';
  } else {
    // flux-2 has NO width/height — size is aspect_ratio × resolution and the provider derives
    // pixels, so pixelSize() is deliberately not used here. resolution is capital-K ('2K').
    input.aspect_ratio = ar;
    input.resolution = String(resolution || '2K').toUpperCase();
    if (hasRefs) input[task?.refs || 'image_input'] = refUrls.slice(0, Math.max(1, maxRefs(model)));
  }

  const payload = { model: id, input };
  const sub = await fetch(KIE + '/api/v1/jobs/createTask', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(payload)
  });
  if (!sub.ok) throw new Error('Kie submit ' + sub.status + ': ' + (await sub.text()).slice(0, 300));
  const sj = await sub.json();
  const taskId = sj.data?.taskId || sj.data?.task_id || sj.taskId;
  if (!taskId) throw new Error('Kie returned no taskId: ' + JSON.stringify(sj).slice(0, 200));
  return pollKieTask({ model, taskId, key, video, duration });
}

// The one Kie poller. Extracted so the Veo path — which submits to a different endpoint — cannot
// drift into a second copy of this loop; the result-shape handling below is the fiddly part and
// duplicating it is how one provider quietly stops recognising a finished job.
async function pollKieTask({ model, taskId, key, video = false, duration, path = '/api/v1/jobs/recordInfo?taskId=' }) {
  const timeout = timeoutMsFor(model);
  const t0 = Date.now();
  let fails = 0, lastState = null;
  while (Date.now() - t0 < timeout) {
    await new Promise(r => setTimeout(r, video ? 5000 : 2500));
    const st = await fetch(KIE + path + encodeURIComponent(taskId), { headers: { Authorization: 'Bearer ' + key } });
    if (!st.ok) {
      const body = await st.text().catch(() => '');
      if (st.status === 401 || st.status === 403) throw pollFailure('Kie.ai', st.status, body);
      if (++fails >= POLL_FAIL_TOLERANCE) throw pollFailure('Kie.ai', st.status, body);
      continue;
    }
    fails = 0;
    const d = (await st.json()).data || {};
    lastState = d.status || d.state || lastState;
    const state = String(d.status || d.state || '').toLowerCase();
    const flag = d.successFlag;
    // Kie says `fail`, not `failed`. That one missing letter cost a user five minutes per failed
    // generation: the terminal state went unrecognised, the loop kept polling a job that was
    // already dead, and the error they finally saw was "timed out after 300s (last job state:
    // fail)" — which names the real state in the same breath as claiming it timed out.
    // Observed vocabulary on /api/v1/jobs/recordInfo: waiting → success | fail, with the reason
    // in failMsg/failCode. Match on prefix so `fail`, `failed` and `failure` all terminate.
    const finished = state.startsWith('succe') || state === 'completed' || flag === 1 || flag === '1';
    const failed = state.startsWith('fail') || state === 'error' || state === 'cancelled'
      || flag === 2 || flag === 3 || flag === '2' || flag === '3';
    if (finished) {
      const url = kieUrl(d);
      if (!url) throw new Error('Kie completed but returned no result URL');
      // Video is priced per SECOND. estCost() answers the flat per-generation figure, so a 10s
      // clip was ledgered at the 5s price and the spend column drifted from reality — while the
      // composer quoted the user from estimateCost(), the duration-aware calculator that exists
      // in the catalog for exactly this. Quote and ledger now read the same function.
      return { fileUrl: url, cost: estimateCost(model, { duration }).per, raw: d };
    }
    if (failed) throw new Error('Kie job failed: ' + String(d.error || d.errorMessage || d.failMsg || d.msg || 'unknown').slice(0, 200));
  }
  throw new Error('Kie.ai ' + model + ' timed out after ' + timeoutSecondsFor(model) + 's'
    + (lastState ? ' (last job state: ' + lastState + ')' : ' (never reported a job state)'));
}

// Veo: its own endpoint, its own body, its own polling. Not a createTask model — every veo id
// answers "model name not supported" there, while POST /api/v1/veo/generate {} answers
// "Please enter prompt", which is how we know this is the right door.
//
// Note the MIXED casing on this endpoint: `imageUrls` and `callBackUrl` are camelCase while
// `aspect_ratio` is snake_case. That is Kie's inconsistency, not a typo here — do not "tidy" it.
async function runKieVeo({ model, slug, prompt, aspect, refUrls, key }) {
  const body = { prompt, model: slug === 'veo-3.1' ? 'veo3' : slug, aspect_ratio: aspect === '9:16' ? '9:16' : '16:9' };
  if (refUrls?.length) body.imageUrls = refUrls.slice(0, Math.max(1, maxRefs(model)));
  const sub = await fetch(KIE + '/api/v1/veo/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body)
  });
  if (!sub.ok) throw new Error('Kie veo submit ' + sub.status + ': ' + (await sub.text()).slice(0, 300));
  const sj = await sub.json();
  if (sj.code && sj.code !== 200) throw new Error('Kie veo: ' + (sj.msg || 'submit refused') + ' (code ' + sj.code + ')');
  const taskId = sj.data?.taskId || sj.data?.task_id;
  if (!taskId) throw new Error('Kie veo returned no taskId: ' + JSON.stringify(sj).slice(0, 200));
  return pollKieTask({ model, taskId, key, path: '/api/v1/veo/record-info?taskId=' });
}

// ── Higgsfield (cli) ─────────────────────────────────────────────────────────
// `higgsfield generate create <model> --prompt … --aspect_ratio … [--image|--start-image] --wait`
// blocks and prints the result URL on stdout. Local file paths auto-upload — pass refs directly.
async function runHiggsfield({ model, prompt, aspect, refPaths }) {
  const bin = resolveBin(getSettings().higgsfieldCommand || 'higgsfield');
  if (!bin) throw new Error('Higgsfield CLI not found — install it and run `higgsfield auth login` (Settings)');
  const slug = modelById(model)?.slug || String(model).replace(/^higgsfield\//, '');
  const ar = aspect === '2.39:1' ? '21:9' : aspect;
  const args = ['generate', 'create', slug, '--prompt', prompt, '--aspect_ratio', ar, '--wait'];
  if (refPaths?.length) {
    if (isVid(model)) args.push('--start-image', refPaths[0]);
    else refPaths.slice(0, maxRefs(model)).forEach(p => args.push('--image', p));
  }
  const r = await runOnce(bin, args, timeoutMsFor(model));
  if (r.enoent) throw new Error('Higgsfield CLI not found on PATH');
  const url = lastUrl(r.out) || lastUrl(r.err);
  if (!url) throw new Error('Higgsfield: ' + String(r.err || r.out || 'exit ' + r.code).slice(0, 250));
  return { fileUrl: url, cost: estCost(model), raw: { out: String(r.out).slice(0, 500) } };
}

// ── Arcads (agent — driven through the Claude CLI + Arcads MCP) ───────────────
async function runArcads({ model, prompt, aspect, refUrls }) {
  const bin = findAgent();
  if (!bin) throw new Error('Claude CLI not connected — Arcads is reached through Claude (connect it in Settings)');
  const tool = modelById(model)?.mcpTool || 'arcads_generate_image';
  const video = isVid(model);
  const driver = [
    'You have the Arcads MCP tools available in this session.',
    'Call the tool `' + tool + '` exactly once to generate a ' + (video ? 'video' : 'image') + ' with these inputs:',
    '- prompt: ' + JSON.stringify(prompt),
    aspect ? '- aspect ratio: ' + aspect : '',
    refUrls?.[0] ? '- reference image URL: ' + refUrls[0] : '',
    'Wait until the asset finishes rendering, retrieving the finished asset URL if the first call only returns an id.',
    'Then output ONLY the final downloadable media URL (the https://… link to the ' + (video ? 'mp4' : 'image') + ')',
    'on a single line — no other text, no markdown, no commentary.'
  ].filter(Boolean).join('\n');
  // permissions scoped to the Arcads MCP tools only — the driver prompt carries
  // user-supplied text, so it must not be able to reach Bash/file tools
  const r = await runOnce(bin, ['--allowedTools', 'mcp__arcads__*', '--output-format', 'text', '-p', driver], timeoutMsFor(model));
  if (r.enoent) throw new Error('Claude CLI not found');
  const blob = (String(r.out) + ' ' + String(r.err)).trim();
  // the driver failed before it could reach Arcads — classify so the message is actionable
  if (/failed to authenticate|not signed in|invalid api key|unauthorized|oauth|please run .?claude|\blog ?in\b|api error|401/i.test(blob))
    throw new Error('Claude CLI isn’t signed in — Arcads runs through Claude. Open Settings → Claude Code Agent, finish the sign-in, then retry.');
  const url = lastUrl(r.out);
  if (url) return { fileUrl: url, cost: estCost(model), raw: { out: String(r.out).slice(0, 500) } };
  if (/no (such )?tool|don.?t have (a |any )?(tool|arcads)|unknown tool|arcads[^.]{0,24}(unavailable|not available|isn.?t|no access)/i.test(blob))
    throw new Error('Claude is signed in, but the Arcads MCP tool wasn’t reachable in a headless run — check that the Arcads MCP/plugin is enabled for the `claude` CLI.');
  throw new Error('Arcads via Claude returned no URL' + (blob ? ' — ' + blob.slice(0, 180) : ''));
}

// ── dispatch + readiness + live test ─────────────────────────────────────────
const ADAPTERS = { fal: runFal, kie: runKie, higgsfield: runHiggsfield, arcads: runArcads };
export function runProvider(providerId, params) {
  const fn = ADAPTERS[providerId];
  if (!fn) throw new Error('Unknown provider: ' + providerId);
  return fn(params);
}

// Every REST provider's credential precedence (shell env → .env → settings.md) lives in its
// resolver, so readiness must ask the resolver. Reading settings[keySetting] directly reports a
// provider as disconnected whenever its key comes from .env — which gated startGeneration() and
// with it every generating surface (generate, chat, style preview, storyboard).
const REST_KEY_RESOLVERS = { fal: falKey, kie: kieKey };

// Cheap reachability check (key present / CLI installed) — drives the Model Catalog dots.
export function providerReady(providerId, settings = getSettings()) {
  const p = providerDef(providerId);
  if (!p) return false;
  if (p.type === 'rest') {
    const resolve = REST_KEY_RESOLVERS[p.id];
    return !!(resolve ? resolve() : (p.keySetting && settings[p.keySetting]));
  }
  if (p.type === 'cli') return !!resolveBin(settings.higgsfieldCommand || p.cli);
  if (p.type === 'agent') return !!findAgent();
  return false;
}
export function providersStatus(settings = getSettings()) {
  const out = {};
  for (const p of PROVIDERS) out[p.id] = providerReady(p.id, settings);
  return out;
}

// Live authenticated Test (Settings buttons). May cost a token for the agent probe.
export async function testProvider(providerId) {
  const p = providerDef(providerId);
  if (!p) return { ok: false, error: 'unknown provider' };
  if (providerId === 'fal') return testFal();
  if (providerId === 'kie') {
    const key = kieKey();
    if (!key) return { ok: false, error: 'No Kie.ai key set — use KIE_API_KEY in .env or Settings' };
    const r = await fetch(KIE + '/api/v1/chat/credit', { headers: { Authorization: 'Bearer ' + key } });
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Key rejected (' + r.status + ') — check the Kie key in Settings' };
    if (!r.ok) return { ok: false, error: 'Kie ' + r.status + ': ' + (await r.text()).slice(0, 160) };
    let detail = '';
    try { const j = await r.json(); const c = j.data?.credits ?? j.data?.credit ?? j.credits; if (c != null) detail = c + ' credits'; } catch { /* ignore */ }
    return { ok: true, detail };
  }
  if (providerId === 'higgsfield') {
    const bin = resolveBin(getSettings().higgsfieldCommand || 'higgsfield');
    if (!bin) return { ok: false, error: 'higgsfield CLI not installed — install it, then run `higgsfield auth login`' };
    const r = await runOnce(bin, ['account', 'status'], 20_000);
    const blob = String(r.out) + String(r.err);
    if (r.code === 0 && !/expired|not authenticated|log ?in/i.test(blob)) return { ok: true, detail: (r.out.trim().split('\n')[0] || 'authenticated').slice(0, 80) };
    return { ok: false, error: /expired|auth|log ?in/i.test(blob) ? 'installed, not signed in — run `higgsfield auth login` in a terminal' : String(r.err || r.out || 'status check failed').slice(0, 160) };
  }
  if (providerId === 'arcads') {
    const bin = findAgent();
    if (!bin) return { ok: false, error: 'Claude CLI not connected — connect it in the Claude Code section, then test again' };
    const r = await runOnce(bin, ['--allowedTools', '', '--output-format', 'text', '-p',
      'Do you have any tool whose name contains "arcads"? Answer with exactly YES or NO — one word, nothing else.'], 60_000);
    if (r.code === 0 && /\byes\b/i.test(r.out)) return { ok: true, detail: 'Arcads MCP reachable through Claude' };
    if (r.code === 0) return { ok: false, error: 'Claude works, but the Arcads MCP tool isn’t available in headless runs — check your Claude MCP/plugin config' };
    return { ok: false, error: String(r.err || r.out || 'the Claude test call failed').slice(0, 160) };
  }
  return { ok: false, error: 'no test for ' + providerId };
}
