// FAL storage bridge — pushes a local asset to fal's CDN so image/video generation
// requests (image_urls, reference images) can point at it. Two-step flow used by the
// official @fal-ai/client: initiate → PUT to the signed URL → keep the public file_url.
import { getSettings } from './store.mjs';
import { ledger } from './ledger.mjs';

const INITIATE = 'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3';
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
  pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain'
};

export function falKey() {
  return process.env.FAL_KEY || getSettings().falApiKey || '';
}

// live key check — the initiate call is free and authenticated; nothing is uploaded
export async function testFal() {
  const key = falKey();
  if (!key) return { ok: false, error: 'No FAL key set' };
  const r = await fetch(INITIATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + key },
    body: JSON.stringify({ content_type: 'text/plain', file_name: 'frameforge-key-test.txt' })
  });
  if (r.status === 401 || r.status === 403) return { ok: false, error: 'Key rejected (' + r.status + ') — check the FAL key in Settings' };
  if (!r.ok) return { ok: false, error: 'FAL ' + r.status + ': ' + (await r.text()).slice(0, 200) };
  return { ok: true };
}

export async function uploadToFal(buf, name) {
  const key = falKey();
  if (!key) throw new Error('No FAL key — add one in Settings to push assets to fal storage');
  const ext = name.split('.').pop().toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  const init = await fetch(INITIATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + key },
    body: JSON.stringify({ content_type: contentType, file_name: name })
  });
  if (!init.ok) throw new Error('FAL initiate ' + init.status + ': ' + (await init.text()).slice(0, 300));
  const { upload_url, file_url } = await init.json();
  if (!upload_url || !file_url) throw new Error('FAL initiate returned no upload URL');

  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: buf
  });
  if (!put.ok) throw new Error('FAL upload ' + put.status + ': ' + (await put.text()).slice(0, 300));
  return file_url;
}

// ── vision (paid tier) ───────────────────────────────────────────────────────
// fal hosts no native Gemini vision endpoint; `openrouter/router/vision` is a passthrough
// where `model` is an OpenRouter slug (google/gemini-2.5-flash, google/gemini-3-pro-preview…),
// so a newer Gemini is a settings change, not a code change. The image must be a URL — we
// push the buffer to fal storage first and hand the caller the file_url back to cache.
const VISION_ENDPOINT = 'openrouter/router/vision';
const VISION_TIMEOUT = 180_000;

export async function falVision({ buf, name, prompt, temperature = 0.3, maxTokens = 700, op = 'vision', imageUrl = null }) {
  const key = falKey();
  if (!key) throw new Error('No FAL key — add one in Settings to use the premium vision tier');
  const model = getSettings().falVisionModel || 'google/gemini-2.5-flash';
  const url = imageUrl || await uploadToFal(buf, name);
  const auth = { Authorization: 'Key ' + key };

  const sub = await fetch('https://queue.fal.run/' + VISION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ model, prompt, image_urls: [url], temperature, max_tokens: maxTokens })
  });
  if (!sub.ok) throw new Error('FAL vision submit ' + sub.status + ': ' + (await sub.text()).slice(0, 300));
  const sj = await sub.json();
  const requestId = sj.request_id;
  if (!requestId) throw new Error('FAL vision returned no request_id');
  const statusUrl = sj.status_url || ('https://queue.fal.run/' + VISION_ENDPOINT + '/requests/' + requestId + '/status');
  const responseUrl = sj.response_url || ('https://queue.fal.run/' + VISION_ENDPOINT + '/requests/' + requestId);

  // DEV-131 again, in the poller nobody migrated. `if (!st.ok) continue;` swallows every failed
  // poll, so a revoked key, a 429 or an outage is indistinguishable from a slow model: the job
  // burns the whole timeout and then blames the timeout. providers.mjs classifies instead, and
  // this loop kept the old shape — so image analysis with a bad key waited the full window and
  // reported the wrong cause. Copied rather than imported: fal.mjs is the leaf that providers.mjs
  // depends on, and importing back would make a cycle.
  const POLL_FAIL_TOLERANCE = 5;
  const t0 = Date.now();
  let done = false, fails = 0, lastStatus = null;
  while (Date.now() - t0 < VISION_TIMEOUT) {
    await new Promise(r => setTimeout(r, 1200));
    const st = await fetch(statusUrl, { headers: auth });
    if (!st.ok) {
      const body = await st.text().catch(() => '');
      const detail = String(body || '').trim().slice(0, 200);
      // A rejected credential will not become right by waiting.
      if (st.status === 401 || st.status === 403) {
        throw new Error('FAL rejected the API key while polling vision (' + st.status + ') — check the key in Settings'
          + (detail ? ': ' + detail : ''));
      }
      if (++fails >= POLL_FAIL_TOLERANCE) {
        throw new Error('FAL vision status polling failed ' + POLL_FAIL_TOLERANCE + 'x in a row (last: '
          + st.status + ')' + (detail ? ': ' + detail : ''));
      }
      continue;
    }
    fails = 0;
    const s = await st.json();
    lastStatus = s.status || lastStatus;
    if (s.status === 'COMPLETED') { done = true; break; }
    if (s.status === 'FAILED' || s.status === 'CANCELLED') throw new Error('FAL vision job ' + s.status.toLowerCase());
  }
  if (!done) throw new Error('FAL vision timed out after ' + VISION_TIMEOUT / 1000 + 's'
    + (lastStatus ? ' (last queue status: ' + lastStatus + ')' : ' (never reported a queue status)'));

  const resp = await fetch(responseUrl, { headers: auth });
  if (!resp.ok) throw new Error('FAL vision result ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  const result = await resp.json();
  const text = result.output || '';
  if (!text) throw new Error('FAL vision returned no output — check the model slug in Settings');
  try {
    // OpenRouter bills per token and reports the real dollar cost back; no estimate needed.
    ledger({ service: 'fal', op, model, units: (result.usage?.total_tokens || 0) + ' tok', cost: Number(result.usage?.cost) || 0, ref: name });
  } catch { /* ledger must never break the call */ }
  return { text, model, falUrl: url };
}
