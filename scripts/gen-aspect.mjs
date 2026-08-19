// Aspect Ratio thumbnails: one generated scene, deterministically cropped to each ratio and
// padded into the 360x360 square tile — matching the letterboxed convention the surviving
// aspect tiles already use.
//
// Why not just prompt for it: a diffusion model asked to draw exact letterbox bars gets the
// geometry approximately right, and "approximately 2.39:1" is indistinguishable from
// "approximately 2.35:1" at 92px. The whole axis is about precise frame shape, so the bars are
// computed, not generated. The pixels inside them are still a real generated photograph.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ASPECT_SCENE, ASPECT_RATIOS } from './axis-prompts-misc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'axis-options');
const SCENE = path.join(ROOT, 'scripts', '.aspect-scene.png');
const MODEL = 'fal-ai/nano-banana-2';
const KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^FAL_KEY=(.+)$/m)[1].trim();

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function generateScene() {
  if (fs.existsSync(SCENE)) return SCENE;
  const sub = await fetch('https://queue.fal.run/' + MODEL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + KEY },
    body: JSON.stringify({ prompt: ASPECT_SCENE, aspect_ratio: '16:9', resolution: '1K', num_images: 1, output_format: 'png' })
  });
  const sj = await sub.json();
  const id = sj.request_id;
  const statusUrl = sj.status_url || `https://queue.fal.run/${MODEL}/requests/${id}/status`;
  const respUrl = sj.response_url || `https://queue.fal.run/${MODEL}/requests/${id}`;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const s = await (await fetch(statusUrl, { headers: { Authorization: 'Key ' + KEY } })).json();
    if (s.status === 'COMPLETED') break;
    if (s.status === 'FAILED') throw new Error('generation failed');
  }
  const j = await (await fetch(respUrl, { headers: { Authorization: 'Key ' + KEY } })).json();
  const url = j.images?.[0]?.url;
  fs.writeFileSync(SCENE, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return SCENE;
}

// Fit the widest possible WxH of the target ratio inside 360x360, centre it on black. Portrait
// ratios (9:16) pillarbox on the sides; wide ratios letterbox top and bottom. Both are the
// honest picture of what that frame shape does to a square canvas.
function render(name, ratio, src) {
  const S = 360;
  let w = S, h = Math.round(S / ratio);
  if (h > S) { h = S; w = Math.round(S * ratio); }
  const dest = path.join(OUT, `aspect-ratio--${slug(name)}.jpg`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src,
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},pad=${S}:${S}:(ow-iw)/2:(oh-ih)/2:black`,
    '-q:v', '4', dest]);
  console.log('  ✓', path.basename(dest), `${w}x${h} in ${S}x${S}`);
}

const scene = await generateScene();
console.log('rebuilding aspect-ratio tiles from one scene:');
for (const [name, ratio] of Object.entries(ASPECT_RATIOS)) render(name, ratio, scene);
