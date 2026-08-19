// Prompt enhancement (Quick Generate tab) — POST /api/enhance { text, mode }.
// mode 'quick' = a fast, cheap tidy-up; mode 'full' = a richer cinematic rewrite (lens, light,
// atmosphere). Both run through Groq's free-tier text model; the improved prompt is returned
// verbatim as { text }. Groq is a stateless accelerator here — nothing is persisted. If no key
// is configured the route fails soft with a clear 400 so the client can toast a fixable reason.
import { groqKey, priceFor } from './groq.mjs';
import { getSettings } from './store.mjs';
import { ledger } from './ledger.mjs';

const GROQ = 'https://api.groq.com/openai/v1';

const SYSTEM = {
  quick: [
    'You improve image-generation prompts. Tighten wording, fix grammar, make the subject and',
    'framing concrete, and remove filler adjectives. Keep the user\'s intent and any @references,',
    'named entities, or style fragments intact. Return ONLY the improved prompt — no preamble,',
    'no quotes, no explanation.'
  ].join(' '),
  full: [
    'You are a senior cinematographer improving an image-generation prompt. Rewrite it into one',
    'vivid, specific prompt that layers in cinematic detail: a named lens / focal length, a lighting',
    'setup, atmosphere, and a color/grade cue — grounded, not a pile of mood adjectives (one precise',
    'noun beats three adjectives). Preserve the user\'s subject, intent, and any @references, named',
    'entities, or style fragments. Return ONLY the improved prompt — no preamble, no quotes, no lists.'
  ].join(' ')
};

async function enhance(text, mode) {
  const key = groqKey();
  if (!key) throw new Error('No Groq API key — set it in Settings');
  const s = getSettings();
  const model = s.groqTextModel || 'llama-3.3-70b-versatile';
  let r;
  try {
    r = await fetch(GROQ + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: mode === 'full' ? 0.7 : 0.4,
        max_tokens: mode === 'full' ? 500 : 300,
        messages: [
          { role: 'system', content: SYSTEM[mode] || SYSTEM.quick },
          { role: 'user', content: text }
        ]
      }),
      signal: AbortSignal.timeout(60_000) // never hold the client request open indefinitely
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'Groq request timed out — try again' : 'Groq request failed: ' + e.message);
  }
  if (!r.ok) throw new Error('Groq ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  try {
    // price by the model that actually ran — priceFor() owns the table and the fallback
    const p = priceFor(model);
    const cost = ((j.usage?.prompt_tokens || 0) * p.in + (j.usage?.completion_tokens || 0) * p.out) / 1e6;
    ledger({ service: 'groq', op: 'enhance', model, units: (j.usage?.total_tokens || 0) + ' tok', cost, ref: mode });
  } catch { /* ledger must never break the call */ }
  // strip stray wrapping quotes/fences the model sometimes adds despite the system prompt
  return String(j.choices?.[0]?.message?.content || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

// deps is accepted for symmetry with the other route modules; this one is self-sufficient.
export function registerEnhanceRoutes(app, deps = {}) {
  app.post('/api/enhance', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    const mode = req.body?.mode === 'full' ? 'full' : 'quick';
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      const out = await enhance(text, mode);
      res.json({ text: out || text });
    } catch (e) {
      // missing-key and Groq errors alike surface as a 400 with a human reason
      res.status(400).json({ error: e.message });
    }
  });
}
