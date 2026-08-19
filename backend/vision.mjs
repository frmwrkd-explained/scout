// Vision routing — one set of prompts, two tiers of model behind them.
//
//   groq  (free)    llama-4 scout on Groq's free tier. Fast, good enough to catalogue a board.
//   fal   (premium) Gemini via fal's `openrouter/router/vision` passthrough. Costs tokens,
//                   but reads the frame like a DP: angle, lens, light direction, wardrobe.
//
// and two depths:
//   quick  description + tags + palette + mood        (mood-board metadata)
//   deep   all of the above + `reconstruct`           (a full regeneration prompt)
//
// Depth is a superset, not a second call — deep asks the same model for more fields in one
// pass. Provider and depth both resolve from settings and are overridable per call.
import { groqVision, parseJson } from './groq.mjs';
import { falVision } from './fal.mjs';
import { getSettings } from './store.mjs';
// The move vocabulary is frontend/cameraMovements.js and it stays that way — same arrangement
// as modelCatalog.js and boardLayout.js, both pure data imported by both sides. The analyzer
// below CLASSIFIES into this list; it never names a move the Camera Moves tool cannot show.
import { CAMERA_MOVEMENTS, MOVE_SPEEDS, MOVE_STABILIZATIONS, assembleMovePrompt } from '../frontend/cameraMovements.js';

export const VISION_PROVIDERS = ['groq', 'fal'];
export const VISION_DEPTHS = ['quick', 'deep'];

const pick = (v, allowed, fallback) => (allowed.includes(String(v)) ? String(v) : fallback);
export function resolveVision({ provider, depth } = {}) {
  const s = getSettings();
  return {
    provider: pick(provider, VISION_PROVIDERS, pick(s.visionProvider, VISION_PROVIDERS, 'groq')),
    depth: pick(depth, VISION_DEPTHS, pick(s.visionDepth, VISION_DEPTHS, 'quick'))
  };
}

// single dispatch point — both tiers take the same args and return { text, model, falUrl? }
function run(provider, args) {
  return provider === 'fal' ? falVision(args) : groqVision(args);
}

// ── prompts ──────────────────────────────────────────────────────────────────
const QUICK_FIELDS = [
  '  "description": "<one vivid sentence, max 26 words — subject, style, light>",',
  '  "tags": ["<6-10 lowercase keywords: subject, medium, lighting, color, mood, composition>"],',
  '  "palette": ["<3-5 dominant colors as hex strings>"],',
  '  "mood": "<2-3 word mood label>"'
];

const quickPrompt = () => [
  'You are a film-production art director cataloguing a mood board.',
  'Analyze this reference image and respond with ONLY a JSON object:',
  '{', ...QUICK_FIELDS, '}'
].join('\n');

// The deep prompt exists to make an image reproducible, not to describe it nicely. Every axis
// below is one the generator actually acts on; vague mood words are the failure mode we're
// designing against, so the rules ban them explicitly.
const deepPrompt = () => [
  'You are a cinematographer and prompt engineer reverse-engineering a reference image so it can',
  'be REGENERATED as faithfully as possible by an image model (nano banana, Flux, SDXL, Seedream).',
  '',
  'Read the frame forensically. Someone holding only your `reconstruct` text — never having seen',
  'this image — must be able to produce a near-identical one. Cover every axis that changes the',
  'output:',
  '- SUBJECT: who/what, count, age/build, expression, gaze direction, pose, gesture, wardrobe',
  '  (garment, cut, fabric, colour), props, hair, skin/surface detail.',
  '- ENVIRONMENT: location, era, set dressing, background layers, what is in focus vs. not.',
  '- CAMERA ANGLE: eye-level / low / high / overhead / dutch, and camera HEIGHT relative to the',
  '  subject. State the shot size (extreme wide → macro) and the subject-to-camera distance.',
  '- FRAMING & COMPOSITION: where the subject sits in frame (thirds, centred, edge-weighted),',
  '  headroom, lead room, horizon placement, leading lines, symmetry, negative space, aspect ratio.',
  '- LENS: focal length in mm, aperture, depth of field and exactly what falls off, distortion,',
  '  bokeh character, flare, vignetting, perspective compression.',
  '- LIGHTING: key direction (clock position + height), quality (hard/soft) and apparent source',
  '  size, ratio to fill, rim/kicker/practicals, colour temperature of each source, shadow',
  '  hardness and direction, time of day.',
  '- COLOR: grade and hex casts in shadows / midtones / highlights, saturation, contrast curve,',
  '  named film stock or LUT.',
  '- TEXTURE & POST: grain size, halation, bloom, chromatic aberration, sharpness, motion blur,',
  '  and the capture medium (35mm, Super 16, digital, polaroid, scan, screengrab).',
  '',
  'Hard rules:',
  '- Name ONE camera body, ONE focal length, ONE film stock/LUT, ONE lighting setup. Commit.',
  '- Weave hex codes INTO the sentence as bare #RRGGBB tokens, e.g. "warm-shadow #RRGGBB,',
  '  cool-highlight #RRGGBB" with real values substituted. Never wrap them in tags or brackets.',
  '  SAMPLE EVERY HEX FROM THE PIXELS OF THIS IMAGE. Do not reuse hex values from these',
  '  instructions and do not emit stock palette values (#F5F5F5, #2E7D32, #1A237E and friends).',
  '- State the camera angle relative to the SUBJECT, and sanity-check it before answering: if you',
  '  can see the underside of things, the camera is low; if you see the tops of things, it is high.',
  '  Getting this backwards makes the whole prompt useless.',
  '- One specific noun beats three adjectives. NEVER pile up "moody, cinematic, dramatic".',
  '- Describe only what is actually visible. Do not invent detail you cannot see, and do not',
  '  hedge with "possibly" or "appears to be" — state it.',
  '',
  'Respond with ONLY a JSON object:',
  '{',
  ...QUICK_FIELDS,
  '  ,"reconstruct": "<180-320 words: the full regeneration prompt, written as flowing prompt',
  '                   text (not a bulleted list, not JSON), covering every axis above in the',
  '                   order subject → environment → angle → framing → lens → lighting → color',
  '                   → texture. This is the payload — make it dense and specific.>"',
  '}'
].join('\n');

const lookPrompt = measurements => [
  'You are a senior DP writing image-generation prompts for models like nano banana, Flux, and',
  'SDXL. You receive (1) the reference image and (2) a numerical profile of it. Produce',
  '*specific*, *named*, *measurement-grounded* prompts — not vague mood words.',
  '',
  'Hard rules:',
  '- Name ONE camera body (Arri Alexa, RED Monstro, Sony Venice, Super 16, Bolex H16, iPhone, VHS…)',
  '- Name ONE focal-length + lens personality ("40mm anamorphic (2x squeeze, streak flares)")',
  '- Name ONE film stock / LUT (Kodak Vision3 5219, Portra 400, CineStill 800T, HP5, 2383 print…)',
  '- Name ONE lighting setup (Rembrandt, butterfly, chiaroscuro, low-key noir, motivated practicals…)',
  '- Name ONE color grade, weaving hex codes into the text as bare #RRGGBB tokens (never wrapped',
  '  in tags or brackets) — "warm-shadow #RRGGBB, cool-highlight #RRGGBB, accent teal #RRGGBB"',
  '  with real values beats listing them separately. Sample every hex from THIS image; never',
  '  reuse a hex printed in these instructions or a stock palette value.',
  '- NEVER contradict the numbers. NEVER pile adjectives ("moody, cinematic, dramatic" = ban).',
  '  One specific noun > three adjectives.',
  '',
  measurements ? '## NUMERICAL PROFILE (measured from the image — ground truth)\n' + JSON.stringify(measurements) + '\n' : '',
  'Respond with ONLY a JSON object:',
  '{',
  '  "summary": "<one line describing the look>",',
  '  "tier1": "<50-80 tokens: compact reusable LOOK — lens/optics, lighting, grade, texture,',
  '            atmosphere; named camera + stock; NO numbers. For pasting into any prompt.>",',
  '  "tier2": "<120-180 tokens: same axes with hard numeric targets inline — shadow/mid/highlight',
  '            hex casts, palette swatches, saturation, contrast, grain/vignette/halation, aspect,',
  '            subject placement.>",',
  '  "palette": ["<4-6 dominant colors as hex strings>"]',
  '}'
].filter(Boolean).join('\n');

// ── public API ───────────────────────────────────────────────────────────────
export async function analyzeImage(buf, name, opts = {}) {
  const { provider, depth } = resolveVision(opts);
  const deep = depth === 'deep';
  const { text, model, falUrl } = await run(provider, {
    buf, name, imageUrl: opts.imageUrl || null,
    prompt: deep ? deepPrompt() : quickPrompt(),
    temperature: 0.3,
    maxTokens: deep ? 2200 : 700,
    op: 'vision'
  });
  const j = parseJson(text);
  const meta = {
    description: String(j.description || '').slice(0, 300),
    // models occasionally return one comma-joined string — normalize to atomic tags
    tags: (Array.isArray(j.tags) ? j.tags : String(j.tags || '').split(','))
      .flatMap(t => String(t).split(','))
      .map(t => t.toLowerCase().trim()).filter(t => t && t.length <= 30).slice(0, 12),
    palette: (Array.isArray(j.palette) ? j.palette : []).map(String).slice(0, 6),
    mood: String(j.mood || '').slice(0, 60),
    visionModel: provider + '/' + model
  };
  // a quick re-analyze must not wipe a reconstruct prompt an earlier deep pass paid for —
  // writeMeta merges, so simply omitting the key leaves the stored one intact.
  if (deep && j.reconstruct) meta.reconstruct = String(j.reconstruct).slice(0, 4000);
  if (falUrl) meta.falUrl = falUrl;
  return meta;
}

export async function extractLook(buf, name, measurements = null, opts = {}) {
  const { provider } = resolveVision(opts);
  const { text, model } = await run(provider, {
    buf, name, imageUrl: opts.imageUrl || null,
    prompt: lookPrompt(measurements),
    temperature: 0.2,
    maxTokens: 1400,
    op: 'look'
  });
  const j = parseJson(text);
  return {
    summary: String(j.summary || '').slice(0, 300),
    tier1: String(j.tier1 || '').slice(0, 900),
    tier2: String(j.tier2 || '').slice(0, 2000),
    palette: (Array.isArray(j.palette) ? j.palette : []).map(String).slice(0, 8),
    visionModel: provider + '/' + model
  };
}

// ── camera-move analyzer ─────────────────────────────────────────────────────
// The inverse of the Camera Moves tool: that one hands you a move and assembles a prompt,
// this one reads a CONTACT SHEET (backend/video.mjs) and works out which move you are
// looking at. It exists because a single still cannot show motion — the panels can, but
// only if whatever reads them is told they are time-ordered and given the clock.
//
// It returns IDS, not prose. `assembleMovePrompt` still writes the fragment, exactly as it
// does for a hand-picked move, so the analyzed prompt and the picked prompt are the same
// text for the same move. cameraMovements.js's own header calls that out — "deterministic
// assembly ... no AI in the loop" — and an analyzer that wrote its own prompt copy would be
// a second, drifting voice for the same twenty moves.
const moveList = () => CAMERA_MOVEMENTS.map(m => '  ' + m.id + ' — ' + m.name + ': ' + m.directionLabel).join('\n');

const movePrompt = sheet => {
  const panels = sheet?.panels || [];
  const map = panels.length
    ? panels.map(p => 'panel ' + String(p.panel).padStart(2, '0') + ' = ' + p.at).join(', ')
    : null;
  return [
    'You are a director of photography breaking down ONE continuous shot from a film.',
    '',
    'The image is a CONTACT SHEET: frames sampled from a single uninterrupted take, laid out in a',
    (sheet?.grid || 'rectangular') + ' grid and read LEFT TO RIGHT, TOP TO BOTTOM. Panel 1 is the',
    'earliest moment, the last panel is the latest. Each panel is stamped with its source time.',
    map ? 'Panel times: ' + map + '.' : null,
    sheet?.seconds ? 'The whole shot runs ' + sheet.seconds + ' seconds.' : null,
    '',
    'THE ONE MISTAKE TO AVOID: confusing SUBJECT motion with CAMERA motion. A car growing larger',
    'across the panels may be driving toward a parked camera, or the camera may be pushing in on a',
    'parked car. Decide from PARALLAX and the frame edges, not from the subject:',
    '- background scaling and sliding past the subject => the camera is travelling (dolly/track/arc)',
    '- background static while only the subject changes size => the subject moves, camera is fixed',
    '- everything smears the same direction at once => a whip pan or a fast arc, not a dolly',
    '- subject holds its size while the background stretches => dolly zoom',
    '- horizon staying level while the whole frame rises => boom/pedestal, not a tilt',
    '- horizon tipping => roll',
    '',
    'Pick the move from THIS LIST ONLY. Use the id exactly as written:',
    moveList(),
    '',
    'If the shot is a compound move (a push-in that becomes an arc, a track that booms up), name the',
    'dominant one as `move` and the second as `secondary`. Use null for `secondary` when it is a',
    'single clean move.',
    '',
    'speed must be one of: ' + MOVE_SPEEDS.map(s => s.id).join(', ') + '.',
    'stabilization must be one of: ' + MOVE_STABILIZATIONS.map(s => s.id).join(', ') + '.',
    '',
    'Respond with ONLY a JSON object:',
    '{',
    '  "move": "<id from the list>",',
    '  "secondary": "<id from the list, or null>",',
    '  "speed": "<speed id>",',
    '  "stabilization": "<stabilization id>",',
    '  "rig": "<what it was most likely shot on — drone, gimbal, crane, car mount, handheld, tripod, techno crane>",',
    '  "subject": "<one sentence: the subject and where it is, written so it can open a video prompt>",',
    '  "subjectMotion": "<what the SUBJECT does, stated separately from the camera>",',
    '  "startFrame": "<the opening composition — angle, height, where the subject sits in frame>",',
    '  "endFrame": "<the closing composition, same axes>",',
    '  "beats": [{"panels": "01-04", "what": "<what changes across these panels>"}],',
    '  "evidence": "<why this move and not the nearest alternative — cite panel numbers>",',
    '  "confidence": "high|medium|low"',
    '}'
  ].filter(Boolean).join('\n');
};

const pickId = (v, list) => { const s = String(v || ''); return list.some(x => x.id === s) ? s : null; };
const str = (v, n) => String(v || '').slice(0, n);

export async function analyzeMove(buf, name, sheet = null, opts = {}) {
  const { provider } = resolveVision(opts);
  const { text, model } = await run(provider, {
    buf, name, imageUrl: opts.imageUrl || null,
    prompt: movePrompt(sheet),
    temperature: 0.2,
    maxTokens: 1600,
    op: 'move'
  });
  const j = parseJson(text);
  // An unrecognised move id is dropped, not passed through: every consumer looks the id up in
  // CAMERA_MOVEMENTS, and a hallucinated "orbit-left" would render as a blank card downstream.
  const move = pickId(j.move, CAMERA_MOVEMENTS);
  const secondary = pickId(j.secondary, CAMERA_MOVEMENTS);
  const speed = pickId(j.speed, MOVE_SPEEDS) || 'normal';
  const stabilization = pickId(j.stabilization, MOVE_STABILIZATIONS) || 'smooth';
  const subject = str(j.subject, 400);
  const rec = {
    move, secondary: secondary === move ? null : secondary, speed, stabilization,
    rig: str(j.rig, 80),
    subject, subjectMotion: str(j.subjectMotion, 400),
    startFrame: str(j.startFrame, 400), endFrame: str(j.endFrame, 400),
    beats: (Array.isArray(j.beats) ? j.beats : []).slice(0, 8)
      .map(b => ({ panels: str(b?.panels, 20), what: str(b?.what, 300) })).filter(b => b.what),
    evidence: str(j.evidence, 600),
    confidence: ['high', 'medium', 'low'].includes(String(j.confidence)) ? String(j.confidence) : 'medium',
    visionModel: provider + '/' + model
  };
  // The fragment comes from the SAME assembler the picker uses — see the note above.
  const def = CAMERA_MOVEMENTS.find(m => m.id === move);
  const duration = sheet?.seconds ? Math.round(sheet.seconds * 10) / 10 : null;
  rec.prompt = def ? assembleMovePrompt(def, { subject, speed, duration, stabilization }) : '';
  return rec;
}
