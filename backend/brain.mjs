// The brain — the ONE place a one-shot model call is made for the Today loop.
//
// THE PRINCIPLE THAT NAMES THIS FILE: code drives, models only write. Ordering, "what's next",
// time, stats, nudges and every number on the Today screen are computed by backend/today.mjs with
// no model call. Models are called only to WRITE — the morning plan's choices, prepared material,
// chat replies, review narratives — and a cheap-tier call gets NO tools: it receives a prompt
// Scout composed and returns text/JSON that Scout validates and applies through records.mjs.
// Today uses the registry's dedicated textOnly descriptor, never an assistant's promptArgs.
// Plan/read-only/automatic-approval modes are not tools-off modes. Unverified providers fail
// closed here; the normal interactive assistant remains available independently.
//
// Two tiers, and they are a budget line, not a preference:
//   light — gemini, then devin. Cheap/account-tier one-shots for the many small calls a day makes
//           (plan, prep, chat, the daily review).
//   heavy — claude, codex. The subscription CLIs, reserved for weekly review + automation
//           narratives. A light purpose NEVER falls back to heavy unless settings
//           `allowHeavyFallback` is true — a Max plan is not a cheap plan you forgot to cap.
//
// Every call — including the ones that fail — lands in the event log as a `run` event on
// `brain/<purpose>` with the provider, tier and duration, so "Agents today: Gemini 12 · Devin 0"
// in the footer is counted from the log like everything else.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSettings, getStorageRoot, brainDailyLimits } from './store.mjs';
import { providerById } from './agentProviders.mjs';
import { resolveBin, runOnce } from './jobs.mjs';
import { logEvent, readEvents } from './log.mjs';
import { localDay, dayStartMs } from './daytime.mjs';

export const TIERS = { light: ['gemini', 'devin'], heavy: ['claude', 'codex'] };

// Which tier each purpose buys. Plan/prep/chat/daily-review are the many-cheap-calls tier; the
// weekly review and its automation suggestions are the one-thoughtful-call tier.
export const PURPOSE_TIER = {
  plan: 'light', prep: 'light', chat: 'light',
  review_daily: 'light', review_weekly: 'heavy', automation: 'heavy'
};

// ── provider probing ───────────────────────────────────────────────────────────────────────────
// "Available" = the bin resolves AND the provider reports signed in (or has no way to report
// signed-out — a version-probe pass with no auth check is treated as usable, same as jobs.mjs's
// "we cannot probe its auth" branch). `probe` is injectable so tests never spawn a binary.
async function defaultProbe(provider) {
  const bin = resolveBin(provider.bin);
  if (!bin) return { installed: false, signedIn: false };
  let state;
  if (typeof provider.authProbe === 'function') {
    try { state = { installed: true, signedIn: !!(await provider.authProbe()) }; }
    catch { state = { installed: true, signedIn: false }; }
  } else if (!provider.authStatusArgs) {
    state = { installed: true, signedIn: true };
  } else {
    try {
      const a = await runIsolated(bin, provider.authStatusArgs, 20_000);
      state = { installed: true, ...provider.parseAuth({ code: a.code, out: a.out, err: a.err }) };
    } catch { state = { installed: true, signedIn: false }; }
  }
  if (!provider.textOnly?.available) return { ...state, ...textOnlyState(provider, state) };
  // Free help probe: older binaries must not silently lose a mandatory restriction. Never
  // launch a model to determine capability or auth. The same empty cwd is used for real calls.
  try {
    const help = await runIsolated(bin, ['--help'], 20_000);
    const missing = (provider.textOnly.requiredFlags || []).filter(f => !String(help.out).includes(f));
    const available = help.code === 0 && !missing.length;
    return { ...state, textOnlyAvailable: available,
      textOnlyReason: available ? null : 'Installed CLI cannot verify required text-only flags' + (missing.length ? ': ' + missing.join(', ') : '.') };
  } catch { return { ...state, textOnlyAvailable: false, textOnlyReason: 'Could not verify the installed CLI text-only flags.' }; }
}

async function runIsolated(bin, argv, timeoutMs) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-brain-'));
  try { return await runOnce(bin, argv, timeoutMs, cwd); }
  finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

function textOnlyState(provider, state = {}) {
  if (!provider.textOnly?.available) return { textOnlyAvailable: false,
    textOnlyReason: provider.textOnly?.reason || 'No verified text-only invocation.' };
  if (state.textOnlyAvailable === false) return { textOnlyAvailable: false,
    textOnlyReason: state.textOnlyReason || 'Installed CLI does not support text-only invocation.' };
  return { textOnlyAvailable: !!state.installed, textOnlyReason: state.installed ? null : 'CLI is not installed.' };
}

// Polling GET /api/today every 60s must not cost two process spawns per provider per poll.
const PROBE_TTL = 60_000;
const probeCache = new Map(); // id -> { at, state }
async function probe(provider) {
  const hit = probeCache.get(provider.id);
  if (hit && Date.now() - hit.at < PROBE_TTL) return hit.state;
  const state = await defaultProbe(provider);
  probeCache.set(provider.id, { at: Date.now(), state });
  return state;
}
export function _clearProbeCache() { probeCache.clear(); }

const tierList = (tier, settings) => {
  const t = settings && settings.tiers && settings.tiers[tier];
  return Array.isArray(t) ? t.map(String) : (TIERS[tier] || []);
};

// Every provider in the tier that is installed and signed in, in preference order — order IS the
// preference (light: gemini before devin; heavy: claude before codex). A provider that is signed
// in can still fail the call (Google retiring a client is exactly that shape), so think() walks
// the whole list rather than betting the day on the first entry. Empty when nothing can go.
// Hermetic under SCOUT_TEST: the default probe never runs — a test either injects `probe` or sets
// SCOUT_BRAIN_COMMAND (see think).
export async function pickProviders(tier, { settings, probe: probeFn } = {}) {
  const s = settings || getSettings();
  const useProbe = process.env.SCOUT_TEST === '1' && !probeFn
    ? async () => ({ installed: false, signedIn: false })
    : (probeFn || probe);
  // A light purpose falls through to the heavy tier ONLY on explicit opt-in — the subscription
  // CLIs are not a cheap plan's spillover.
  const lists = [tierList(tier, s)];
  if (tier === 'light' && s.allowHeavyFallback === true) lists.push(tierList('heavy', s));
  const out = [];
  const seen = new Set();
  for (const ids of lists) {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = providerById(id);
      if (!p || !p.textOnly?.available) continue;
      const st = await useProbe(p);
      if (st && st.installed && st.signedIn && textOnlyState(p, st).textOnlyAvailable) out.push(p);
    }
  }
  return out;
}

// First usable provider in the tier, or null — kept for callers (and tests) that want the pick
// itself rather than the whole ladder.
export async function pickProvider(tier, opts = {}) {
  return (await pickProviders(tier, opts))[0] || null;
}

// One honest read for the settings UI and the Today footer: every brain-eligible provider with
// installed/signed-in, so Devin's installed-but-unsigned state is reported as exactly that.
export async function providersStatus({ probe: probeFn } = {}) {
  const useProbe = process.env.SCOUT_TEST === '1' && !probeFn
    ? async () => ({ installed: false, signedIn: false })
    : (probeFn || probe);
  const out = [];
  for (const id of [...TIERS.light, ...TIERS.heavy]) {
    const p = providerById(id);
    if (!p) continue;
    const state = await useProbe(p);
    out.push({ id, label: p.label, ...state, ...textOnlyState(p, state) });
  }
  return out;
}

// ── think ──────────────────────────────────────────────────────────────────────────────────────
// { ok, text, provider, tier, ms } or { ok:false, reason, provider:null, tier, ms }.
// Every outcome logs the `run` event — an unavailable brain is a fact of the day, not silence.
export async function think({ purpose, prompt, timeoutMs = 120_000, probe: probeFn } = {}) {
  const root = getStorageRoot();
  const settings = getSettings();
  const tier = PURPOSE_TIER[purpose] || 'light';
  const started = Date.now();

  // Hermetic under tests: SCOUT_BRAIN_COMMAND names a stub binary that stands in for every tier
  // (the same trick as the phase-09 stub CLIs). Without it, no provider exists and no process
  // ever spawns.
  const stub = process.env.SCOUT_TEST === '1' ? (process.env.SCOUT_BRAIN_COMMAND || null) : null;
  const providers = stub
    ? [{ id: 'stub', bin: stub, textOnly: { promptArgs: p => ['-p', String(p)] }, sessionArgs: () => [] }]
    : await pickProviders(tier, { settings, probe: probeFn });
  const rootChanged = () => ({ ok: false, reason: 'workspace changed during model call', code: 'root-changed', provider: null, tier, ms: Date.now() - started });
  if (getStorageRoot() !== root) return rootChanged();

  if (!providers.length) {
    const res = { ok: false, reason: 'no provider available in tier "' + tier + '"', provider: null, tier, ms: Date.now() - started };
    logEvent({ type: 'run', actor: 'conductor', target: 'brain/' + purpose,
      detail: { provider: null, tier, purpose, ms: res.ms, ok: false } });
    return res;
  }

  // Walk the ladder: a provider whose probe passed can still fail the call (a retired client, a
  // revoked token) and the next candidate is better than a silent fallback to no-brain.
  const reasons = [];
  let lastProvider = null;
  for (const provider of providers) {
    if (getStorageRoot() !== root) return rootChanged();
    const model = settings.brainModels && settings.brainModels[provider.id];
    const argv = [
      ...provider.textOnly.promptArgs(prompt),
      ...(model && typeof provider.sessionArgs === 'function' ? provider.sessionArgs({ model }) : []),
    ];
    // A heavy provider always spends the heavy cap, even when explicitly added to light or
    // reached through allowHeavyFallback. The stub follows its purpose tier only in tests.
    const budgetTier = TIERS.heavy.includes(provider.id) ? 'heavy' : tier;
    let reservation;
    try { reservation = reserveAttempt({ provider: provider.id, tier, budgetTier, purpose }); }
    catch (e) { reasons.push(provider.id + ': ' + firstLine(e.message)); continue; }
    if (!reservation.ok) { reasons.push(provider.id + ': ' + reservation.reason); continue; }
    lastProvider = provider.id;
    let out;
    try { out = await runIsolated(resolveBin(provider.bin) || provider.bin, argv, timeoutMs); }
    catch (e) { out = { code: 1, out: '', err: String(e.message || e) }; }
    // The old root already owns its reservation. Never write its response or completion into
    // the newly selected workspace; the durable reservation still counts after a restart.
    if (getStorageRoot() !== root) return rootChanged();
    const ms = Date.now() - started;
    const ok = out.code === 0 && String(out.out || '').trim().length > 0;
    logEvent({ type: 'run', actor: 'conductor', target: 'brain/' + purpose,
      detail: { provider: provider.id, tier, budgetTier, purpose, ms, ok,
        phase: 'completed', attemptId: reservation.attemptId, day: reservation.day } });
    if (ok) return { ok: true, text: String(out.out).trim(), provider: provider.id, tier, ms };
    reasons.push(provider.id + ': exit ' + out.code + (out.err ? ' — ' + firstLine(out.err) : ''));
  }
  if (!lastProvider) logEvent({ type: 'run', actor: 'conductor', target: 'brain/' + purpose,
    detail: { provider: null, tier, purpose, ms: Date.now() - started, ok: false, phase: 'blocked', reason: reasons.join(' · ') } });
  return { ok: false, reason: reasons.join(' · '), provider: lastProvider, tier, ms: Date.now() - started };
}

// Check + append are synchronous, before the first awaited CLI work. Concurrent prep, retries
// and chat therefore reserve one slot at a time in this backend. The event log is the ledger;
// a failed or unfinished attempt still spends its slot after restart. No second counter exists.
function reserveAttempt({ provider, tier, budgetTier, purpose }) {
  const budget = brainBudgetToday();
  if (budget.error) return { ok: false, reason: budget.error };
  if (!budget[budgetTier].remaining) return { ok: false, reason: budgetTier + ' daily call limit reached (' + budget[budgetTier].limit + ')' };
  const attemptId = randomUUID();
  logEvent({ type: 'run', actor: 'conductor', target: 'brain/' + purpose,
    detail: { provider, tier, budgetTier, purpose, phase: 'reserved', attemptId, day: budget.day } });
  return { ok: true, attemptId, day: budget.day };
}

// A failed CLI's stderr can be pages of noise; the chat reply and the log only ever need the
// first informative line.
function firstLine(err) {
  const line = String(err).split('\n').map(l => l.trim()).find(l => l && !l.startsWith('202'));
  return (line || String(err).trim()).slice(0, 140);
}

// How many brain calls each provider has made today — counted FROM THE LOG (same as every run's
// figures in dispatch), never from a counter that dies with the process.
function attemptsToday(now) {
  const day = localDay(now);
  const out = [];
  const seen = new Set();
  // No display-sized limit: 5,000 unrelated assistant runs cannot erase a day's reservations.
  for (const ev of readEvents({ since: dayStartMs(day) - 1, limit: Infinity, type: 'run' })) {
    if (localDay(ev.ts) !== day) continue;
    if (!String(ev.target || '').startsWith('brain/')) continue;
    const d = ev.detail || {};
    if (!d.provider || d.phase === 'completed' || d.phase === 'blocked') continue;
    if (d.attemptId) {
      if (seen.has(d.attemptId)) continue;
      seen.add(d.attemptId);
    }
    out.push(d);
  }
  return out;
}

export function usageToday(now = Date.now()) {
  const out = {};
  for (const d of attemptsToday(now)) out[d.provider] = (out[d.provider] || 0) + 1;
  return out;
}

export function brainBudgetToday(now = Date.now()) {
  let limits, error = null;
  try { limits = brainDailyLimits(getSettings().brainDailyLimits); }
  catch { limits = { light: 0, heavy: 0 }; error = 'Invalid brainDailyLimits settings; model calls are disabled until corrected.'; }
  const used = { light: 0, heavy: 0 };
  for (const d of attemptsToday(now)) {
    const tier = TIERS.heavy.includes(d.provider) ? 'heavy' : (d.budgetTier || d.tier || 'light');
    if (tier in used) used[tier]++;
  }
  return { day: localDay(now), ...(error ? { error } : {}),
    light: { limit: limits.light, used: used.light, remaining: Math.max(0, limits.light - used.light) },
    heavy: { limit: limits.heavy, used: used.heavy, remaining: Math.max(0, limits.heavy - used.heavy) } };
}

// ── parseJsonBlock ─────────────────────────────────────────────────────────────────────────────
// The only contract a cheap-tier reply has: it contains JSON. Accept the first ```json fenced
// block, else the first top-level {...} object. Returns null when nothing parses — the caller
// (plan validation, chat actions) then falls back honestly instead of guessing at prose.
export function parseJsonBlock(text) {
  const s = String(text || '');
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(s);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    try { const v = JSON.parse(c); if (v && typeof v === 'object') return v; } catch { /* next */ }
  }
  return null;
}
