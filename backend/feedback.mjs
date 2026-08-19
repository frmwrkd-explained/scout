// Beta feedback — assembly and egress.  docs/specs/beta-feedback/spec.md
//
// ⚠ THIS FILE IS THE ONLY PLACE FRAMEFORGE SENDS ANYTHING TO A SERVER WE OWN. ⚠
//
// Everything else in this app talks to providers the user chose and paid for (fal, groq, kie) or
// to nothing at all. If a second outbound call to a FrameForge endpoint ever appears somewhere
// else in this repo, the privacy claim in the panel stops being checkable — one file to audit is
// the whole point. Add to this one; do not add another.
//
// Order of operations in send(), and it is load-bearing:
//
//     assemble → merge client rings → attach server rings + env facts → REDACT → sign → transmit
//
// Redaction is last so that nothing can be added downstream of it. If redact() throws, the send
// is ABORTED — the single path in this feature that fails closed. Every other failure here
// degrades to the outbox, because a report a human took the trouble to type must not be lost to
// a flaky network.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { getSettings, getStorageRoot, writeMd, readMd, SECRET_SETTING_KEYS } from './store.mjs';
import { redact, signature } from '../shared/redact.mjs';
import { resolveModules } from '../shared/integrations.mjs';
import { providersStatus } from './providers.mjs';
import { videoToolsStatus } from './video.mjs';
import { listJobs } from './jobs.mjs';

const require = createRequire(import.meta.url);
const pkg = (() => { try { return require('../package.json'); } catch { return { version: '0.0.0' }; } })();

// ── rings ───────────────────────────────────────────────────────────────────────────────────
// Same shape as the renderer's (frontend/feedbackCapture.js) and for the same reason: fixed size,
// no persistence, no flush, read only when a human presses Send.

function ring(size) {
  const buf = new Array(size);
  let n = 0;
  return {
    push(rec) { buf[n % size] = rec; n++; },
    read() {
      const out = [];
      for (let i = Math.max(0, n - size); i < n; i++) out.push(buf[i % size]);
      return out;
    },
    get count() { return n; }
  };
}

const logRing = ring(200);
const apiRing = ring(60);

let logInstalled = false;

// Tee the server's console into a ring. stdout is untouched — the terminal and Electron's
// `[server]` pipe still get every line exactly as before; this only keeps a copy.
export function installLogRing() {
  if (logInstalled) return;
  logInstalled = true;
  const t0 = Date.now();
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level];
    console[level] = function (...args) {
      original.apply(console, args);          // always first — see frontend/feedbackCapture.js
      try {
        const msg = args.map(a => {
          if (typeof a === 'string') return a;
          if (a instanceof Error) return a.stack || a.message;
          try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' ');
        logRing.push({ level, t: Date.now() - t0, msg: msg.length > 2000 ? msg.slice(0, 2000) + '…' : msg });
      } catch { /* capture must never break the process it is capturing */ }
    };
  }
}

// Called from the existing res.on('finish') seam in index.mjs — deliberately NOT a second
// listener on every request. `error` is the message our own routes already return on a failure;
// it is written for a human and is usually the whole content of the bug report.
export function recordApiCall(rec) {
  try { apiRing.push(rec); } catch { /* as above */ }
}

// ── environment facts ───────────────────────────────────────────────────────────────────────
// Booleans and versions only, never a value. A large share of "it's broken" reports are a missing
// key or a missing binary, and this block turns those into a one-line answer instead of an issue.

export function envFacts() {
  const s = getSettings();
  let providers = {};
  try { providers = providersStatus(s); } catch { /* a probe failure is not worth failing a report */ }
  let binaries = {};
  try { binaries = videoToolsStatus(); } catch { /* ditto */ }

  return {
    app: pkg.version,
    // process.versions.electron is present only in the packaged app, which is exactly the
    // distinction that matters when reading a report.
    build: process.versions.electron ? 'desktop' : 'dev',
    electron: process.versions.electron || null,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    // Redaction turns this into ~/… — the shape of someone's storage layout is occasionally the
    // bug (a path with a '#' in it, an external volume), the name in it never is.
    storageRoot: getStorageRoot(),
    providers,      // { fal: true, groq: false, … } — configured-ness, never the key
    binaries,       // { ffmpeg: true, ytdlp: false, ffprobe: true }
    modules: resolveModules(s),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

// The last few failures the server already knows about. A provider timeout or a poll error is the
// most likely thing a tester reports, and making them describe something we have recorded is a
// waste of both sides' time.
export function recentFailures() {
  try {
    return listJobs()
      .filter(j => j.status === 'error' || j.status === 'failed')
      .slice(0, 10)
      .map(j => ({ id: j.id, kind: j.kind, status: j.status, label: j.label, at: j.endedAt || j.startedAt }));
  } catch { return []; }
}

// ── report codes ────────────────────────────────────────────────────────────────────────────

// Crockford-ish: no I, L, O, U. A tester reads this code aloud or types it into a message, and
// "was that a one or an ell" is a support conversation nobody should have to have.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function mintCode() {
  let out = '';
  const bytes = new Uint8Array(4);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return 'FF-' + out;
}

// A stable-per-machine, meaningless-off-machine id, so repeat reports from one tester can be
// threaded without an account. Not derived from hardware; it is a random string in a file the
// user can delete. Lives beside the datastore rather than in settings.md so it never rides along
// in a settings export.
function machineId() {
  const file = path.join(getStorageRoot(), 'feedback', 'machine.md');
  try {
    const existing = readMd(file);
    if (existing && existing.data && existing.data.id) return existing.data.id;
  } catch { /* first run */ }
  const id = 'm_' + Array.from({ length: 12 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join('');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeMd(file, { id, createdAt: new Date().toISOString() },
      'Random id so repeat reports from this machine can be threaded.\nMeaningless anywhere else. Delete this file to reset it.\n');
  } catch { /* read-only disk: an unthreaded report is still a report */ }
  return id;
}

// ── the envelope ────────────────────────────────────────────────────────────────────────────

const outboxDir = () => path.join(getStorageRoot(), 'feedback', 'outbox');

// Every exact value the redactor must kill. Settings first (what the user typed into the UI),
// then the environment (what .env / the shell set) — precedence does not matter here, presence
// does. This is the strongest rule in shared/redact.mjs because it needs no guess about format.
function knownSecrets() {
  const s = getSettings();
  const values = SECRET_SETTING_KEYS.map(k => s[k]);
  values.push(process.env.FAL_KEY, process.env.GROQ_API_KEY, process.env.KIE_API_KEY, process.env.ANTHROPIC_API_KEY);
  // A redacted sentinel is not a secret, and treating it as one would replace every '••••••••'
  // in the report with a different placeholder for no reason.
  return values.filter(v => typeof v === 'string' && v.length >= 8 && !/^•+$/.test(v));
}

/**
 * Build the sealed, redacted envelope. Exported separately from send() because the panel's review
 * step renders EXACTLY this — not a summary of it, not a preview built by different code. If the
 * two ever diverge, the review step becomes a lie, so there is only one builder.
 */
export function buildEnvelope(input = {}) {
  const client = input.client || {};
  const include = input.include || {};
  const on = k => include[k] !== false;   // absent means included; only an explicit false drops it

  const raw = {
    code: input.code || mintCode(),
    kind: input.kind || 'bug',
    title: String(input.title || '').slice(0, 200),
    body: String(input.body || '').slice(0, 8000),
    severity: input.severity || 'annoying',
    reporter: {
      // NOTE the email is deliberately absent here and re-attached after redaction below.
      machineId: machineId(),
      consentedAt: Date.now()
    },
    where: input.where || {},
    app: envFacts(),
    sentAt: Date.now()
  };

  // A section the user untoggled is ABSENT, not empty. An empty array reads as "we looked and
  // there was nothing", which is a different and misleading fact.
  const clientOut = {};
  if (on('console') && client.console) clientOut.console = client.console;
  if (on('errors') && client.errors) clientOut.errors = client.errors;
  if (on('network') && client.network) clientOut.network = client.network;
  if (on('interactions') && client.interactions) clientOut.interactions = client.interactions;
  if (client.totals) clientOut.totals = client.totals;
  if (Object.keys(clientOut).length) raw.client = clientOut;

  const serverOut = {};
  if (on('serverLog')) serverOut.log = logRing.read();
  if (on('serverApi')) serverOut.api = apiRing.read();
  if (on('failures')) serverOut.failures = recentFailures();
  if (Object.keys(serverOut).length) raw.server = serverOut;

  // ── the gate ──
  const { value: safeEnvelope, hits } = redact(raw, { secrets: knownSecrets() });

  // The reporter's own address is the ONE exemption, and it is applied after the walk rather than
  // as a rule inside it — an exemption a redactor knows about is an exemption that grows. Rule 6
  // exists to strip addresses belonging to people who did not consent; this one was typed into a
  // field labelled "so we can tell you when it's fixed", and redacting it would silently delete
  // the only way to answer a `needs-more-info` verdict.
  const email = String(input.email || '').trim().toLowerCase();
  safeEnvelope.reporter.email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;

  // Signed AFTER redaction, so the signature is computed over exactly what we send and two
  // machines with different usernames in their stack traces still agree on it.
  const topError = (client.errors || []).filter(e => e.kind !== 'resource').slice(-1)[0];
  const failedCall = (client.network || []).filter(c => c.status === 0 || c.status >= 400).slice(-1)[0];
  safeEnvelope.signature = signature({
    frame: topError ? String(topError.stack || '').split('\n')[1] || topError.message : (failedCall && failedCall.url),
    message: topError ? topError.message : (failedCall && (failedCall.error || 'http ' + failedCall.status)) || raw.title,
    route: failedCall && failedCall.url,
    version: raw.app.app
  });
  safeEnvelope.redaction = { hits, version: 1 };

  return safeEnvelope;
}

// ── egress ──────────────────────────────────────────────────────────────────────────────────

// A configured-but-unusable URL must behave exactly like an unset one: reports queue to the
// outbox and the panel says so. Anything else turns a copy-paste of the setup docs — which ship
// `https://<your-deployment>.convex.site` verbatim — into a 502 that reaches the user as
// "not found" next to their own report code, which reads as "we lost it".
function endpoint() {
  const raw = (process.env.FRFG_FEEDBACK_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/[<>]/.test(raw)) return '';                       // an unfilled placeholder from the docs
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? raw : '';
  } catch { return ''; }                                  // not a URL at all
}

function toOutbox(envelope, reason) {
  try {
    fs.mkdirSync(outboxDir(), { recursive: true });
    writeMd(path.join(outboxDir(), envelope.code + '.md'),
      { code: envelope.code, title: envelope.title, queuedAt: new Date().toISOString(), reason },
      '```json\n' + JSON.stringify(envelope, null, 2) + '\n```\n');
    return true;
  } catch { return false; }
}

async function transmit(envelope, screenshot) {
  const url = endpoint();
  if (!url) return { ok: false, reason: 'FRFG_FEEDBACK_URL is not set — the report was saved locally' };

  // 12s: long enough for a slow connection with a screenshot attached, short enough that a
  // tester does not sit watching a spinner wondering whether it worked.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    let attachments = [];
    if (screenshot) {
      const uploaded = await uploadScreenshot(url, screenshot, ac.signal);
      // A screenshot that would not upload must not sink the report — the words are the report.
      if (uploaded) attachments = [uploaded];
      else envelope.attachmentNote = 'screenshot upload failed; report sent without it';
    }
    const res = await fetch(url + '/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...envelope, attachments }),
      signal: ac.signal
    });
    if (!res.ok) return { ok: false, reason: 'server said ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 160) };
    const j = await res.json().catch(() => ({}));
    return { ok: true, ...j };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timed out after 12s' : (e.message || 'network error') };
  } finally {
    clearTimeout(timer);
  }
}

async function uploadScreenshot(url, dataUrl, signal) {
  try {
    const m = /^data:([\w./+-]+);base64,(.*)$/s.exec(dataUrl);
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) return null;   // a window screenshot that big is a bug of its own
    const gen = await fetch(url + '/api/report/upload-url', { method: 'POST', signal });
    if (!gen.ok) return null;
    const { uploadUrl } = await gen.json();
    if (!uploadUrl) return null;
    const put = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': m[1] }, body: buf, signal });
    if (!put.ok) return null;
    const { storageId } = await put.json();
    return storageId ? { kind: 'screenshot', storageId, bytes: buf.length, mime: m[1] } : null;
  } catch { return null; }
}

// Anything queued while the network was down goes out on next launch. Runs once, in the
// background, and never blocks startup or logs a scary line for the ordinary empty case.
export async function flushOutbox() {
  if (!endpoint()) return { sent: 0, queued: 0 };
  let files = [];
  try { files = fs.readdirSync(outboxDir()).filter(f => f.endsWith('.md') && !f.startsWith('._')); }
  catch { return { sent: 0, queued: 0 }; }

  let sent = 0;
  for (const f of files) {
    const full = path.join(outboxDir(), f);
    try {
      const { content } = readMd(full);
      const json = /```json\n([\s\S]*?)\n```/.exec(content || '');
      if (!json) { fs.unlinkSync(full); continue; }   // unreadable: not worth keeping forever
      const result = await transmit(JSON.parse(json[1]), null);
      if (result.ok) { fs.unlinkSync(full); sent++; }
    } catch { /* leave it queued and try again next launch */ }
  }
  if (sent) console.log('[feedback] sent ' + sent + ' queued report' + (sent === 1 ? '' : 's'));
  return { sent, queued: files.length - sent };
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────

export function registerFeedbackRoutes(app) {
  // What the panel's review step renders. Redacted here too — the preview must be the payload,
  // and a preview built from unredacted data would show the user something we never send.
  app.get('/api/feedback/context', (req, res) => {
    const { value, hits } = redact(
      { app: envFacts(), server: { log: logRing.read(), api: apiRing.read(), failures: recentFailures() } },
      { secrets: knownSecrets() }
    );
    res.json({ ...value, redaction: { hits }, configured: !!endpoint(), machineId: machineId() });
  });

  // The review step (spec §2.4). Builds the envelope through the SAME function the send uses and
  // returns it without transmitting. Deliberately not a separate "preview builder": the moment the
  // preview is assembled by different code from the send, the review step becomes decoration and
  // the user's consent is uninformed.
  app.post('/api/feedback/preview', (req, res) => {
    try {
      res.json(buildEnvelope(req.body || {}));
    } catch (e) {
      console.error('[feedback] preview failed:', e);
      res.status(500).json({ error: 'Could not build the payload: ' + (e.message || 'unknown error'), code: 'preview-failed' });
    }
  });

  app.post('/api/feedback', async (req, res) => {
    const b = req.body || {};
    if (!String(b.title || '').trim() && !String(b.body || '').trim()) {
      return res.status(400).json({ error: 'A report needs a title or a description' });
    }

    let envelope;
    try {
      envelope = buildEnvelope(b);
    } catch (e) {
      // FAIL CLOSED. If the redactor threw we do not know what is in the payload, so nothing
      // leaves — not to the network, not to the outbox.
      console.error('[feedback] redaction failed, send aborted:', e);
      return res.status(500).json({ error: 'Could not prepare the report safely, so nothing was sent. This is a bug in FrameForge itself.', code: 'redaction-failed' });
    }

    const result = await transmit(envelope, b.screenshot || null);
    if (result.ok) {
      return res.json({ ok: true, code: envelope.code, queued: false, status: result.status || 'received', duplicateOf: result.duplicateOf || null });
    }
    const queued = toOutbox(envelope, result.reason);
    res.json({
      ok: queued, code: envelope.code, queued,
      // Never a silent success. The tester is told exactly where their report is.
      error: queued ? null : 'Could not send or save the report: ' + result.reason,
      note: queued ? 'Saved on this machine and sent automatically next time FrameForge starts — ' + result.reason : null
    });
  });

  // Status back to the reporter (spec §12). Proxied through the server rather than called from
  // the renderer so the app keeps exactly one outbound destination.
  app.get('/api/feedback/report/:code', async (req, res) => {
    const url = endpoint();
    if (!url) return res.json({ code: req.params.code, status: 'local-only' });
    try {
      const r = await fetch(url + '/api/report/' + encodeURIComponent(req.params.code));
      if (!r.ok) return res.status(r.status).json({ error: 'lookup failed (' + r.status + ')' });
      res.json(await r.json());
    } catch (e) {
      res.status(502).json({ error: 'Could not reach the feedback service — ' + (e.message || 'network error') });
    }
  });

  // What is still sitting in the outbox, so the panel can say so rather than implying everything
  // has been delivered.
  app.get('/api/feedback/outbox', (req, res) => {
    let files = [];
    try { files = fs.readdirSync(outboxDir()).filter(f => f.endsWith('.md') && !f.startsWith('._')); } catch { /* none */ }
    res.json({ queued: files.map(f => f.replace(/\.md$/, '')), configured: !!endpoint() });
  });
}
