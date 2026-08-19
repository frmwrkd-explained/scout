/* Licence state — the stateful half. `licenceToken.mjs` decides whether a token is
 * genuine; this decides what the app does about it.
 *
 * ── The policy, decided deliberately ─────────────────────────────────────────────────
 * A signed token is good for TOKEN_TTL_MS (14 days) with no server contact at all. The app
 * refreshes opportunistically once a token is older than REFRESH_AFTER_MS (1 day), in the
 * background, never blocking anything. So:
 *
 *   · A normal user never sees this. They activate once and the token silently rolls
 *     forward every time they are online.
 *   · A user on a plane, behind a corporate proxy, or during a Convex outage keeps working
 *     for a fortnight — which is the `licences.js` "fail open" instinct kept intact for
 *     every case where it protects a real customer.
 *   · Someone who blackholes the domain to avoid the check gets exactly 14 days.
 *
 * That is the whole difference from pure fail-open: an unreachable server stops being
 * permanently equivalent to a valid licence.
 *
 * ── What this cannot do ──────────────────────────────────────────────────────────────
 * It cannot stop someone patching the check out. Nothing written in JavaScript inside an
 * asar can. What it does stop is a keygen — see licenceToken.mjs — which is the difference
 * between one person cracking their copy and a working generator circulating. Enforcement
 * here is a lock on an honest person's door, plus a cryptographic floor under the honest
 * path. Sold as more than that, it would be a lie.
 *
 * ── Never throws into a request ──────────────────────────────────────────────────────
 * Every exported function answers with a verdict object. A licence layer that can throw is
 * a licence layer that takes the app down when the disk is full, which converts a paying
 * customer into a support ticket over a feature they did not ask for.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';

import { paths, readMd, writeMd } from './store.mjs';
import { verifyToken, publicKeyFrom, unsafeDecodeClaims, TOKEN_TTL_MS } from './licenceToken.mjs';

/* ── the public key ──────────────────────────────────────────────────────────────────
 * Generated once by `node scripts/make-licence-keypair.mjs`, which prints both halves.
 * This one is meant to be committed; the private half lives only in Convex.
 *
 * EMPTY until you run that script. While it is empty `isEnforced()` returns false and the
 * app behaves exactly as it does today — that is deliberate, so this file can land, be
 * reviewed and be tested before any customer is ever gated by it. Filling it in is the
 * switch. */
export const LICENCE_PUBLIC_KEY = '';

/* Must move together with FF.CHECKOUT.licenceIsEnforced in landingpage/js/data.js — that
   flag is what the site tells buyers about whether a key is needed. Two sources of truth
   for one fact, unavoidably, because they ship separately: the app cannot read the site's
   config and the site cannot read the app's constant. Grep for both when changing either. */
/* ── on the `publicKey` parameter these functions take ───────────────────────────────
 * It defaults to the committed constant and production never passes it; the tests do,
 * because a test cannot edit a `const` and the alternative — reading the key from an env
 * var — would be a genuine hole. An env-overridable public key lets anyone point the app
 * at a keypair they own and sign themselves a lifetime licence, with no patching at all.
 *
 * A parameter is not the same weakness. Passing it requires editing the call site, and
 * anyone who can edit the call site can delete the check outright. It costs an attacker
 * nothing they did not already have, and it buys real tests. */
export function isEnforced(publicKey = LICENCE_PUBLIC_KEY) {
  if (process.env.FRFG_LICENCE_OFF === '1') return false;   // escape hatch for support
  return typeof publicKey === 'string' && publicKey.length > 0;
}

const API_BASE = process.env.FRFG_LICENCE_API || 'https://agreeable-gnat-469.convex.site';

/* Refresh once a token is a day old. Far short of the 14-day expiry on purpose: it means a
   user has to be offline for thirteen consecutive days before expiry is even in sight. */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/* Short. This runs on a background timer, and a licence check that hangs for 30s holds a
   socket open for no benefit — a missed refresh is retried on the next tick anyway. */
const NET_TIMEOUT_MS = 8000;

/* ── local state ─────────────────────────────────────────────────────────────────── */

function readState() {
  try { return readMd(paths.licenceMd()).data || {}; } catch { return {}; }
}

function writeState(patch) {
  try {
    const next = { ...readState(), ...patch };
    writeMd(paths.licenceMd(),
      next,
      'Licence state for this machine. Written by the app; safe to delete — deleting it\n' +
      'de-activates this machine locally and you will be asked for your key again.\n');
    return next;
  } catch {
    return readState();        // a read-only disk must not break the app
  }
}

/* A random id in the data directory, NOT a hardware fingerprint. Matches the decision
   already recorded in landingpage/backend/convex/licences.js: a reinstall burning a seat,
   with three seats and a self-service release endpoint, generates far fewer support
   tickets than one seat welded to a machine serial. */
export function machineId() {
  const state = readState();
  if (typeof state.machineId === 'string' && state.machineId.length >= 16) return state.machineId;
  const id = crypto.randomBytes(16).toString('hex');
  writeState({ machineId: id });
  return id;
}

function machineName() {
  try { return os.hostname() || 'Unnamed machine'; } catch { return 'Unnamed machine'; }
}

/* ── the verdict ─────────────────────────────────────────────────────────────────── */

/* status:
 *   'off'        enforcement is not on — no key configured in this build
 *   'licensed'   a genuine, unexpired token for this machine
 *   'expired'    genuine but past its window; the server has not been reachable
 *   'invalid'    a token that does not verify — forged, tampered, or for another machine
 *   'none'       no token at all; the user has not entered a key
 */
export function licenceState({ now = Date.now(), publicKey = LICENCE_PUBLIC_KEY } = {}) {
  if (!isEnforced(publicKey)) return { status: 'off', ok: true };

  const state = readState();
  if (!state.token) return { status: 'none', ok: false };

  let pub;
  try { pub = publicKeyFrom(publicKey); }
  catch { return { status: 'off', ok: true, reason: 'bad-public-key' }; }

  const out = verifyToken(state.token, pub, { now, machineId: machineId() });

  if (out.ok) {
    return {
      status: 'licensed', ok: true,
      plan: out.claims.plan,
      key: out.claims.key,
      expiresAt: out.expiresAt,
      staleAfter: (state.refreshedAt ?? 0) + REFRESH_AFTER_MS,
    };
  }

  if (out.reason === 'expired') {
    /* Genuine, just stale. Distinguished from 'invalid' because the user experience is
       completely different: this person paid and needs a network, not an accusation. */
    return {
      status: 'expired', ok: false,
      plan: out.claims?.plan,
      key: out.claims?.key,
      expiredAt: out.expiredAt,
    };
  }

  return { status: 'invalid', ok: false, reason: out.reason };
}

/* ── network ─────────────────────────────────────────────────────────────────────── */

async function post(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NET_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return { reachable: true, ok: false, reason: `http-${res.status}` };
    return { reachable: true, ...(await res.json()) };
  } catch {
    /* Unreachable is NOT a verdict. Returning `ok:false` here without `reachable:false`
       would turn every flaky network into a revoked licence — the exact failure the
       fail-open note in licences.js warns about. */
    return { reachable: false, ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function appVersion() {
  try { return process.env.npm_package_version || 'unknown'; } catch { return 'unknown'; }
}

/* Claim a seat. This is the one call a user consciously triggers, by pasting their key.
 *
 * Takes `now` for the same reason the rest of this module does: `refreshedAt` is compared
 * against the `now` that `refresh()` is given, and a field stamped from the ambient clock
 * cannot be reasoned about against an injected one. That mismatch is not only a test
 * problem — a machine whose clock jumps backwards would otherwise never refresh again. */
export async function activate(rawKey, { now = Date.now() } = {}) {
  const out = await post('/api/licence/activate', {
    key: String(rawKey || ''),
    machineId: machineId(),
    machineName: machineName(),
    platform: process.platform,
    appVersion: appVersion(),
  });

  if (out.ok && out.token) {
    writeState({ token: out.token, key: out.key ?? null, refreshedAt: now });
    return { ok: true, plan: out.plan, seats: out.seats, used: out.used };
  }
  /* A server that says ok but sends no token is a deployment where the signer is not
     configured. Say so rather than silently storing nothing and looping forever. */
  if (out.ok && !out.token) return { ok: false, reason: 'no-token-issued' };
  return out;
}

/* The periodic re-check. Safe to call often; it no-ops unless the token is stale. */
export async function refresh({ force = false, now = Date.now(), publicKey = LICENCE_PUBLIC_KEY } = {}) {
  if (!isEnforced(publicKey)) return { ok: true, skipped: 'not-enforced' };

  const state = readState();
  if (!state.token) return { ok: false, reason: 'none' };
  if (!force && (state.refreshedAt ?? 0) + REFRESH_AFTER_MS > now) {
    return { ok: true, skipped: 'fresh' };
  }

  /* Read the key from the token itself rather than storing it twice. The token is signed,
     so the key inside it is the one the server issued — a separately stored copy could
     drift, and the drifted one would be the unsigned one. */
  const key = state.key || unsafeDecodeClaims(state.token)?.key;
  if (!key) return { ok: false, reason: 'malformed-state' };

  const out = await post('/api/licence/validate', {
    key, machineId: machineId(), appVersion: appVersion(),
  });

  if (out.ok && out.token) {
    writeState({ token: out.token, refreshedAt: now });
    return { ok: true, refreshed: true, plan: out.plan };
  }

  /* Refunded or unknown is a real verdict and the token should stop working now, not in
     fourteen days. Dropping the token is what makes a refund effective. */
  if (out.reachable && (out.reason === 'refunded' || out.reason === 'unknown')) {
    writeState({ token: null, revokedReason: out.reason, revokedAt: now });
    return { ok: false, revoked: out.reason };
  }

  /* Anything else — offline, 500, not-activated — leaves the existing token alone. It is
     still signed and still inside its window; the grace period is precisely this case. */
  return { ok: false, reason: out.reason, reachable: out.reachable };
}

/* Free this machine's seat and forget the token. */
export async function deactivate() {
  const state = readState();
  const key = state.key || unsafeDecodeClaims(state.token)?.key;
  let out = { ok: true };
  if (key) out = await post('/api/licence/release', { key, machineId: machineId() });
  writeState({ token: null, key: null, refreshedAt: null });
  return out;
}

/* Delete local state entirely. Test helper and support escape hatch — not routed. */
export function forgetLocalLicence() {
  try { fs.rmSync(paths.licenceMd(), { force: true }); } catch { /* already gone */ }
}
