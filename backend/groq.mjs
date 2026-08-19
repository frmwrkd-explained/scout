// Groq bridge. FrameForge used this file for whisper transcription, vision analysis and
// story→shotlist breakdown. The last two were film and are gone; what remains is the key
// resolver and dictation.
//
// Dictation is not film. `docs/06_REUSE.md` keeps `frontend/VoiceInput.jsx`, and `GOAL.md`'s
// first-run interview is voice-enabled — so the transcribe path is a Scout capability, not a
// leftover. `distill.mjs` uses `groqKey()` for the same reason: cheap text work.
//
// The key resolver stays in this file rather than moving to env.mjs, keeping the parent repo's
// convention that a provider's resolver lives beside that provider's code.

import { getSettings } from './store.mjs';
import { ledger } from './ledger.mjs';

const GROQ = 'https://api.groq.com/openai/v1';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const WHISPER_PER_HOUR = 0.04;

export function groqKey() {
  return process.env.GROQ_API_KEY || getSettings().groqApiKey || '';
}

export async function transcribe(buf, filename = 'audio.m4a') {
  const key = groqKey();
  if (!key) throw new Error('No Groq API key — set it in Settings');
  const fd = new FormData();
  fd.append('file', new Blob([buf]), filename);
  fd.append('model', WHISPER_MODEL);
  fd.append('response_format', 'json');
  const r = await fetch(GROQ + '/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd
  });
  if (!r.ok) throw new Error('Groq transcribe ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  try {
    // Groq bills whisper per audio-hour; duration isn't returned, so estimate from size (~1MB/min)
    const mins = Math.max(0.1, buf.length / 1e6);
    ledger({ service: 'groq', op: 'whisper', model: WHISPER_MODEL, units: '~' + mins.toFixed(1) + ' min est', cost: (mins / 60) * WHISPER_PER_HOUR, ref: filename });
  } catch { /* never break the call */ }
  return j.text || '';
}
