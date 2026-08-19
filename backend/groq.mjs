// Groq API bridge — transcription (whisper), vision (llama-4 scout), story breakdown (llama-3.3).
// All results are written back into the portable .md database; Groq is only ever a
// stateless accelerator. If the key is missing every endpoint fails soft with a clear error.
import { getSettings } from './store.mjs';
import { ledger } from './ledger.mjs';

const GROQ = 'https://api.groq.com/openai/v1';

// published Groq pay-per-token prices, $/1M tokens (F6: tokens from response.usage × price).
// unknown models fall back to the 70b rate — better a slight over-count than a silent zero.
const PRICE = {
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
  'qwen/qwen3.6-27b': { in: 0.285, out: 0.900 },
  // both llama-4 vision ids are deprecated on Groq; kept only so historic ledger rows still price
  'meta-llama/llama-4-scout-17b-16e-instruct': { in: 0.11, out: 0.34 },
  'meta-llama/llama-4-maverick-17b-128e-instruct': { in: 0.50, out: 0.77 }
};
const WHISPER_PER_HOUR = 0.04;

// canonical per-model price lookup, table + fallback in one place. Every ledger row that
// prices Groq tokens — here and in enhance.mjs — must go through this.
export function priceFor(model) {
  return PRICE[model] || PRICE['llama-3.3-70b-versatile'];
}

function ledgerChat(model, usage, op, ref) {
  try {
    const p = priceFor(model);
    const cost = ((usage?.prompt_tokens || 0) * p.in + (usage?.completion_tokens || 0) * p.out) / 1e6;
    ledger({ service: 'groq', op, model, units: (usage?.total_tokens || 0) + ' tok', cost, ref });
  } catch { /* ledger must never break the call */ }
}

export function groqKey() {
  return process.env.GROQ_API_KEY || getSettings().groqApiKey || '';
}

async function chat(body, op = 'chat', ref = '') {
  const key = groqKey();
  if (!key) throw new Error('No Groq API key — set it in Settings');
  // Qwen models on Groq are thinking models — without this the reasoning stream
  // consumes the whole max_tokens budget and the JSON payload arrives truncated.
  if (/qwen/i.test(body.model || '') && body.reasoning_effort === undefined) body.reasoning_effort = 'none';
  let r;
  try {
    r = await fetch(GROQ + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000) // never hold the client request open indefinitely
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'Groq request timed out — try again' : 'Groq request failed: ' + e.message);
  }
  if (!r.ok) {
    const raw = (await r.text()).slice(0, 400);
    // The free tier's ceiling is tokens-per-MINUTE, and one contact sheet is most of it. Reading
    // a couple of sheets back to back hits this every time, so the wait — which the API states
    // precisely — is the only part of the payload worth showing. Raw JSON in a toast is not an
    // error message.
    if (r.status === 429) {
      const wait = raw.match(/try again in ([\d.]+)s/);
      throw new Error('Groq rate limit reached' + (wait ? ' — wait ' + Math.ceil(parseFloat(wait[1])) + 's and retry' : ' — wait a minute and retry')
        + '. The free tier caps tokens per minute; a contact sheet is a big read. Switch vision to fal in Settings to skip the queue.');
    }
    throw new Error('Groq ' + r.status + ': ' + raw.slice(0, 300));
  }
  const j = await r.json();
  ledgerChat(body.model, j.usage, op, ref);
  // surface truncation explicitly — otherwise a cut-off JSON payload fails downstream as a
  // cryptic "malformed JSON" instead of a fixable "response too long, reduce shots".
  if (j.choices?.[0]?.finish_reason === 'length')
    throw new Error('the model response was cut off (too long) — try a shorter story or fewer shots');
  return j.choices?.[0]?.message?.content || '';
}

export function parseJson(text) {
  // models sometimes wrap JSON in fences or prose — cut to the outermost bracket pair
  if (!text.includes('{') && !text.includes('[')) throw new Error('model returned no JSON — try again');
  const s = text.indexOf(text.includes('[') && (text.indexOf('[') < text.indexOf('{') || !text.includes('{')) ? '[' : '{');
  const open = text.slice(s, s + 1);
  const close = open === '[' ? ']' : '}';
  const e = text.lastIndexOf(close);
  if (e <= s) throw new Error('model returned malformed JSON — try again');
  return JSON.parse(text.slice(s, e + 1));
}

// ── transcription: audio buffer → text (whisper-large-v3-turbo) ──
export async function transcribe(buf, filename = 'audio.m4a') {
  const key = groqKey();
  if (!key) throw new Error('No Groq API key — set it in Settings');
  const s = getSettings();
  const fd = new FormData();
  fd.append('file', new Blob([buf]), filename);
  fd.append('model', s.groqWhisperModel || 'whisper-large-v3-turbo');
  fd.append('response_format', 'json');
  const r = await fetch(GROQ + '/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd
  });
  if (!r.ok) throw new Error('Groq transcribe ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  try {
    // Groq bills whisper per audio-hour; duration isn't returned, so estimate from size (~1MB/min m4a)
    const mins = Math.max(0.1, buf.length / 1e6);
    ledger({ service: 'groq', op: 'whisper', model: s.groqWhisperModel || 'whisper-large-v3-turbo', units: '~' + mins.toFixed(1) + ' min est', cost: (mins / 60) * WHISPER_PER_HOUR, ref: filename });
  } catch { /* never break the call */ }
  return j.text || '';
}

// ── vision: raw image→text call. Prompts and JSON shaping live in vision.mjs, which
// routes this against the free Groq tier or the paid FAL tier with identical wording.
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
export const dataUrlFor = (buf, name) =>
  'data:' + (MIME[name.split('.').pop().toLowerCase()] || 'image/jpeg') + ';base64,' + buf.toString('base64');

export async function groqVision({ buf, name, prompt, temperature = 0.3, maxTokens = 700, op = 'vision' }) {
  const s = getSettings();
  const model = s.groqVisionModel || 'qwen/qwen3.6-27b';
  const text = await chat({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrlFor(buf, name) } }
      ]
    }]
  }, op, name);
  return { text, model };
}

// ── story breakdown: idea/script → shot list with skill routing ──
export async function breakdownStory(story, { brief = '', skills = [] } = {}) {
  const s = getSettings();
  const skillList = skills.length
    ? skills.map(k => '- "' + k.name + '" — ' + (k.description || '').slice(0, 160)).join('\n')
    : '- "manual" — no generation skill available';
  const text = await chat({
    model: s.groqTextModel || 'llama-3.3-70b-versatile',
    temperature: 0.4,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You are a seasoned film director and 1st AD breaking a story down into a shot list',
          'for an AI-generation pipeline. Shots must be concrete and generatable: one clear visual',
          'moment each, 2-8 seconds. Assign every shot the single best-suited skill from the',
          'available skill list (match skill purpose to shot needs: character/cinematic stills and',
          'video → shot builders; motion graphics/typography/diagrams → motion builders;',
          'programmatic video/slides → remotion). Respond with ONLY JSON:',
          '{ "shots": [ {',
          '  "no": 1,',
          '  "scene": <scene number, 1-based — group shots into 2-5 scenes / story beats>,',
          '  "sceneTitle": "<2-4 word scene name, same for every shot in the scene>",',
          '  "title": "<3-5 word shot name>",',
          '  "desc": "<what we SEE, one or two sentences, present tense>",',
          '  "beat": "<max 8 words: what this shot does for the story>",',
          '  "type": "<Wide|Medium|CU|OTS|Insert|Tracking|Drone|Macro>",',
          '  "dur": <seconds, 2-8>,',
          '  "move": "<camera movement: locked off | slow dolly in | crane down | handheld drift…>",',
          '  "light": "<lighting mood, max 6 words>",',
          '  "transition": "<cut|dissolve|match cut|whip|hold>",',
          '  "skill": "<exact skill name from the list>",',
          '  "skillWhy": "<max 10 words: why this skill>",',
          '  "prompt": "<STILL image prompt: subject, environment, framing, lens, lighting, color, atmosphere>",',
          '  "videoPrompt": "<MOTION prompt for image-to-video: subject motion + camera move + pacing, one sentence>",',
          '  "tags": ["<3-6 lowercase keywords>"]',
          '} ] }',
          'Aim for 6-14 shots covering the whole story arc.'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          brief ? '## PROJECT BRIEF (style authority)\n' + brief.slice(0, 3000) + '\n' : '',
          '## AVAILABLE SKILLS',
          skillList,
          '',
          '## STORY / IDEA',
          story.slice(0, 12000)
        ].join('\n')
      }
    ]
  }, 'breakdown');
  const j = parseJson(text);
  const shots = Array.isArray(j.shots) ? j.shots : [];
  const known = new Set(skills.map(k => k.name));
  // renumber strictly by array position — the model is asked to number its own shots and
  // sometimes repeats a number (1,2,2,3); since the shot id is derived from `no`, a duplicate
  // would make two shots write to the same SH0N0.md and silently overwrite one.
  return shots.map((sh, i) => ({
    no: i + 1,
    scene: Math.max(1, Number(sh.scene) || 1),
    sceneTitle: String(sh.sceneTitle || '').slice(0, 60),
    title: String(sh.title || 'Shot ' + (i + 1)).slice(0, 80),
    desc: String(sh.desc || '').slice(0, 600),
    beat: String(sh.beat || '').slice(0, 120),
    type: String(sh.type || 'Medium').slice(0, 20),
    dur: Math.min(20, Math.max(1, Number(sh.dur) || 4)),
    move: String(sh.move || '').slice(0, 80),
    light: String(sh.light || '').slice(0, 80),
    transition: String(sh.transition || '').slice(0, 30),
    skill: known.has(sh.skill) ? sh.skill : (skills[0]?.name || 'manual'),
    skillWhy: String(sh.skillWhy || '').slice(0, 120),
    prompt: String(sh.prompt || '').slice(0, 900),
    videoPrompt: String(sh.videoPrompt || '').slice(0, 600),
    tags: (Array.isArray(sh.tags) ? sh.tags : []).map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8)
  }));
}
