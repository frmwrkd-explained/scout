// Ticket 20 — session-end distillation. When a filmmaker chat session ends (explicit close, or it
// goes idle past a threshold) a cheap LLM pass reads the transcript and extracts the DURABLE
// learnings — locked creative directions, decisions made, corrections the user insisted on — and
// appends them to the project's memory.md through the existing memory append path (deduplicated).
// The next session in that project then opens with those learnings already in context (see
// chat.mjs · projectUnderstanding). Session start is handled in chat.mjs; this module owns the "end".
//
// The distiller is INJECTABLE (setDistiller) so tests run with a stub and never touch the network.
// The default calls Groq — the repo's cheap-LLM accelerator — and fails soft to "no learnings" when
// no key is configured, so a keyless box simply never auto-distills instead of erroring.
//
// Triggers:
//   · explicit close   POST /api/chat/sessions/:id/close    — distills when chatAutoDistill is on
//   · manual save-now   POST /api/chat/sessions/:id/distill  — always distills (toggle-independent)
//   · idle threshold    lazy sweep on chat traffic           — distills idle project sessions
// The chatAutoDistill setting (default ON) gates the two AUTOMATIC triggers (close + idle); the
// manual route always runs. chatIdleDistillMinutes (default 30; 0 disables) sets the idle window.
import { getSettings, readMd, paths } from './store.mjs';
import { groqKey } from './groq.mjs';
import { readMemory, appendLearnings } from './memory.mjs';
import { getSession, listSessions, patchSession, markSessionDistilled, projectUnderstanding } from './chat.mjs';

const DEFAULT_IDLE_MIN = 30;
const distillModel = () => getSettings().groqTextModel || 'llama-3.3-70b-versatile';

// auto-distill (close + idle) defaults ON; explicit `false` disables it. Manual distill ignores this.
export function autoDistillEnabled() { return getSettings().chatAutoDistill !== false; }

// Idle window in ms. Undefined → default; explicit 0 → disabled (returns 0 → sweep is a no-op).
export function idleThresholdMs() {
  const raw = getSettings().chatIdleDistillMinutes;
  if (raw === 0 || raw === '0') return 0;
  const m = Number(raw);
  return Number.isFinite(m) && m > 0 ? m * 60_000 : DEFAULT_IDLE_MIN * 60_000;
}

// ── the injectable distiller ──
// Signature: async ({ transcript, brief, memory, project }) => string[] | { learnings: string[] } | string
let distiller = groqDistiller;
export function setDistiller(fn) { distiller = fn || groqDistiller; }
export function currentDistiller() { return distiller; }

// Coerce whatever the distiller returns into a clean string[] of learning bullets.
export function parseLearnings(raw) {
  if (Array.isArray(raw)) return raw.map(s => String(s || '').trim()).filter(Boolean);
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return []; } }
  const arr = Array.isArray(obj) ? obj
    : Array.isArray(obj?.learnings) ? obj.learnings
    : Array.isArray(obj?.memory) ? obj.memory : [];
  return arr.map(s => String(s || '').trim()).filter(Boolean);
}

// Default distiller — one cheap Groq JSON call. Self-contained (reads only the canonical groqKey);
// never throws (returns [] on any failure) so a distillation pass can't break the request that
// triggered it. Under tests there is no key, so this returns [] without a network call.
async function groqDistiller({ transcript, brief, memory }) {
  const key = groqKey();
  if (!key) return [];
  const sys = 'You distill DURABLE production learnings from a filmmaker\'s chat with an AI assistant. ' +
    'Extract only lasting facts worth remembering in the next session: locked creative directions, ' +
    'decisions that were made, and corrections the user insisted on. Ignore small talk, tool ' +
    'mechanics, and anything already present in the existing memory. Return JSON {"learnings": string[]} ' +
    'with short imperative bullets (max ~14 words each), or {"learnings": []} if nothing is durable.';
  const user = [
    brief ? '## Project brief\n' + String(brief).slice(0, 2000) : '',
    memory ? '## Existing memory (do NOT repeat these)\n' + String(memory).slice(0, 2000) : '',
    '## Transcript\n' + String(transcript).slice(0, 8000)
  ].filter(Boolean).join('\n\n');
  let r;
  try {
    r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: distillModel(), temperature: 0.2, max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
      }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch { return []; }
  if (!r.ok) return [];
  let j; try { j = await r.json(); } catch { return []; }
  return parseLearnings(j.choices?.[0]?.message?.content);
}

// Flatten a session's transcript into "User: … / Assistant: …" lines for the distiller.
function transcriptOf(session) {
  return (session.messages || []).map(m => {
    const who = m.role === 'user' ? 'User' : 'Assistant';
    const body = String(m.text || (m.error ? '[error] ' + m.error : '')).trim();
    return body ? who + ': ' + body : '';
  }).filter(Boolean).join('\n');
}

// Distill one session into its project's memory. force=true (manual) ignores both the auto toggle and
// the already-distilled guard; dedupe still prevents duplicates. Returns a plain result object.
export async function distillSession(id, { force = false } = {}) {
  const session = getSession(id);
  if (!session) return { ok: false, error: 'session not found' };
  if (session.scope !== 'project' || !session.project) return { ok: true, skipped: 'no-project', added: [] };
  // nothing new since the last distillation → skip (unless forced)
  if (!force && session.distilledAt && session.distilledAt >= (session.updated || 0)) {
    return { ok: true, skipped: 'already-distilled', added: [] };
  }
  const transcript = transcriptOf(session);
  const userTurns = (session.messages || []).filter(m => m.role === 'user').length;
  if (!transcript || userTurns === 0) {
    markSessionDistilled(id);
    return { ok: true, skipped: 'empty', added: [] };
  }
  let brief = '';
  try { brief = readMd(paths.briefMd(session.project)).content.trim(); } catch { /* none */ }
  const memory = readMemory(session.project).body;

  let learnings = [];
  try { learnings = parseLearnings(await distiller({ transcript, brief, memory, project: session.project })); }
  catch { learnings = []; }

  const { added, skipped } = appendLearnings(session.project, learnings);
  markSessionDistilled(id);
  return { ok: true, project: session.project, learnings, added, skipped };
}

// Distill every project session idle past the threshold. Auto-only (respects chatAutoDistill). Safe
// to call often — it skips fresh, closed-and-clean, and already-distilled sessions cheaply.
export async function sweepIdleSessions({ now = Date.now() } = {}) {
  if (!autoDistillEnabled()) return { swept: [] };
  const thr = idleThresholdMs();
  if (!thr) return { swept: [] };
  const sessions = listSessions({ all: true, includeArchived: true }).filter(s => s.scope === 'project' && s.project);
  const swept = [];
  for (const s of sessions) {
    if ((now - (s.updated || 0)) < thr) continue;
    if (s.distilledAt && s.distilledAt >= (s.updated || 0)) continue; // nothing new since last distill
    try { swept.push({ id: s.id, ...(await distillSession(s.id)) }); } catch { /* keep sweeping */ }
  }
  return { swept };
}

// Lazy, throttled idle sweep hooked onto chat traffic. Fire-and-forget so it never delays a request.
// Skipped under FRFG_TEST so unrelated tests stay hermetic — tests drive sweepIdleSessions directly.
let lastSweep = 0;
const SWEEP_EVERY_MS = 60_000;
function lazySweep() {
  if (process.env.FRFG_TEST === '1') return;
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  Promise.resolve().then(() => sweepIdleSessions({ now })).catch(() => { /* best-effort */ });
}

// Registered from index.mjs BEFORE registerChatRoutes so the sweep middleware runs ahead of the chat
// route handlers (Express matches in registration order). Adds the close/distill/understanding routes.
export function registerDistillRoutes(app, deps = {}) {
  const activity = deps.appendActivity || (() => {});
  const bump = deps.bumpHistory || (() => {});

  // lazy idle-distill on any chat traffic (throttled; no-op under tests)
  app.use('/api/chat', (req, res, next) => { lazySweep(); next(); });

  // the project-understanding block a session injects at start — exposed so the Production Panel can
  // show "what the agent knows" (inspectability) and acceptance can verify the injected content.
  app.get('/api/chat/sessions/:id/understanding', (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'session not found' });
    res.json({ project: s.project || null, understanding: projectUnderstanding(s.project) });
  });

  // explicit session close — marks the session closed and, when auto-distill is on, distills it.
  app.post('/api/chat/sessions/:id/close', async (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'session not found' });
    patchSession(req.params.id, { closed: true });
    let distill = { skipped: 'auto-off', added: [] };
    if (autoDistillEnabled()) {
      try { distill = await distillSession(req.params.id); } catch (e) { distill = { ok: false, error: String(e.message || e), added: [] }; }
    }
    if (distill.added?.length) {
      bump('briefs');
      const ev = { dot: 'green', t: 'Learnings saved on close', t2: '· ' + (s.title || req.params.id), s: distill.added.length + ' distilled into project memory', kind: s.project ? 'proj' : 'none' };
      if (s.project) ev.ref = s.project;
      activity(ev);
    }
    res.json({ ok: true, closed: true, distill });
  });

  // manual "save learnings now" — always distills, regardless of the auto toggle.
  app.post('/api/chat/sessions/:id/distill', async (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'session not found' });
    try {
      const r = await distillSession(req.params.id, { force: true });
      if (r.added?.length) {
        bump('briefs');
        const ev = { dot: 'green', t: 'Learnings distilled', t2: '· ' + (s.title || req.params.id), s: r.added.length + ' added to project memory', kind: s.project ? 'proj' : 'none' };
        if (s.project) ev.ref = s.project;
        activity(ev);
      }
      res.json(r);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
}
