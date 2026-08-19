// Regenerate axis-option thumbnails via FAL (Nano Banana 2) at 1K, downscaled to the 360x360
// the bundle already ships. Key comes from .env (gitignored) — never hardcoded, never committed.
//
//   node scripts/gen-axis-images.mjs ref              -> generate + cache the character anchor
//   node scripts/gen-axis-images.mjs focal|lens|framing|misc [--dry]
//
// Character-driven axes (framing / focal / lens) pass the cached anchor as a reference image so
// every tile is unmistakably the same person — that is the whole point of the exercise.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FOCAL_LENGTH, LENS_TYPE, FRAMING, CHARACTER_REF_PROMPT } from './axis-prompts.mjs';
import { MISC } from './axis-prompts-misc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'axis-options');
const REF_CACHE = path.join(ROOT, 'scripts', '.character-ref.json');
const MODEL = 'fal-ai/nano-banana-2';
const CONCURRENCY = 4;

const KEY = (() => {
  const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^FAL_KEY=(.+)$/m);
  if (!m) throw new Error('FAL_KEY missing from .env');
  return m[1].trim();
})();

// Mirrors backend/providers.mjs: submit to the queue, poll status, fetch the result payload.
async function falImage(prompt, refUrls) {
  const input = {
    prompt,
    aspect_ratio: '1:1',
    resolution: '1K',
    num_images: 1,
    output_format: 'png',
    ...(refUrls?.length ? { image_urls: refUrls } : {})
  };
  const sub = await fetch('https://queue.fal.run/' + MODEL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + KEY },
    body: JSON.stringify(input)
  });
  if (!sub.ok) throw new Error('submit ' + sub.status + ': ' + (await sub.text()).slice(0, 200));
  const sj = await sub.json();
  const id = sj.request_id;
  const statusUrl = sj.status_url || `https://queue.fal.run/${MODEL}/requests/${id}/status`;
  const respUrl = sj.response_url || `https://queue.fal.run/${MODEL}/requests/${id}`;

  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    await new Promise(r => setTimeout(r, 1500));
    const st = await fetch(statusUrl, { headers: { Authorization: 'Key ' + KEY } });
    if (!st.ok) continue;
    const s = await st.json();
    if (s.status === 'COMPLETED') break;
    if (s.status === 'FAILED' || s.status === 'CANCELLED') throw new Error('job ' + s.status);
  }
  const r = await fetch(respUrl, { headers: { Authorization: 'Key ' + KEY } });
  if (!r.ok) throw new Error('result ' + r.status);
  const j = await r.json();
  const url = j.images?.[0]?.url || j.image?.url;
  if (!url) throw new Error('no media url');
  return url;
}

// Same slug rule the existing bundle uses: lowercase, non-alphanumerics collapsed to '-'.
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function download(url, dest) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = dest + '.tmp.png';
  fs.writeFileSync(tmp, buf);
  // match the shipped convention: 360x360 jpg, ~15KB
  const { execFileSync } = await import('child_process');
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', '-z', '360', '360', tmp, '--out', dest], { stdio: 'ignore' });
  fs.unlinkSync(tmp);
}

async function ensureRef() {
  if (fs.existsSync(REF_CACHE)) {
    const c = JSON.parse(fs.readFileSync(REF_CACHE, 'utf8'));
    if (c.url) { console.log('ref (cached):', c.url); return c.url; }
  }
  console.log('generating character anchor…');
  const url = await falImage(CHARACTER_REF_PROMPT);
  fs.writeFileSync(REF_CACHE, JSON.stringify({ url, at: new Date().toISOString() }, null, 2));
  await download(url, path.join(ROOT, 'scripts', 'character-ref.jpg'));
  console.log('ref:', url);
  return url;
}

// Bounded worker pool — FAL will happily take more, but a burst of 50 makes a partial failure
// expensive to reason about and the whole batch is only a couple of minutes at 4.
async function pool(items, fn) {
  const queue = [...items];
  let ok = 0, fail = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const it = queue.shift();
      try { await fn(it); ok++; console.log('  ✓', it.file); }
      catch (e) { fail++; console.log('  ✗', it.file, '—', e.message); }
    }
  }));
  return { ok, fail };
}

const SETS = {
  focal: { table: FOCAL_LENGTH, ref: true },
  lens: { table: LENS_TYPE, ref: true },
  framing: { table: FRAMING, ref: true },
  misc: { table: MISC, ref: false }
};

async function main() {
  const which = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (which === 'ref') { await ensureRef(); return; }
  const set = SETS[which];
  if (!set) throw new Error('usage: gen-axis-images.mjs ref|focal|lens|framing|misc [--dry]');

  const items = Object.entries(set.table).map(([name, def]) => ({
    name, file: `${def.axis}--${slug(name)}.jpg`, prompt: def.prompt
  }));

  if (dry) { items.forEach(i => console.log(i.file, '\n   ', i.prompt.slice(0, 160), '…\n')); return; }

  const refUrl = set.ref ? await ensureRef() : null;
  console.log(`generating ${items.length} → ${OUT}`);
  const { ok, fail } = await pool(items, async it => {
    const url = await falImage(it.prompt, refUrl ? [refUrl] : null);
    await download(url, path.join(OUT, it.file));
  });
  console.log(`done: ${ok} ok, ${fail} failed  (~$${(ok * 0.015).toFixed(2)})`);
}

main().catch(e => { console.error(e); process.exit(1); });
