/* Licence tokens — the format, and the only place a signature is checked.
 *
 * A token is what the server hands back after `activate`/`validate`. It says "this key,
 * this plan, this machine, good until this instant", signed with Ed25519. The app carries
 * the PUBLIC key only; the private half never leaves the Convex deployment.
 *
 * ── What this buys, stated honestly ──────────────────────────────────────────────────
 * Signing makes a licence key **unforgeable**. Nobody can write a keygen, because minting
 * a token that verifies requires a private key that is not in the bundle and never ships.
 * That kills the high-volume piracy vector — one working keygen on a forum costs more
 * sales than a hundred individually patched copies.
 *
 * It does NOT make the app uncrackable, and no amount of work here would. This is
 * JavaScript in an asar; someone determined can patch the call site out. That is a fact
 * about the platform, not a gap to close, and the honest response is to make the check
 * cheap to pass legitimately rather than expensive to remove. See `backend/licence.mjs`
 * for the grace policy that follows from it.
 *
 * ── Pure, like shared/redact.mjs ─────────────────────────────────────────────────────
 * No fs, no network, and NO `Date` — `now` is always a parameter. A token module that
 * reads the clock cannot be tested at an expiry boundary without faking time globally,
 * and every test that fakes time globally eventually breaks a different one.
 *
 * ── Format ───────────────────────────────────────────────────────────────────────────
 *     v1.<base64url(JSON payload)>.<base64url(ed25519 signature)>
 *
 * The signature covers the base64url payload string **as sent**, not a re-serialisation
 * of the parsed object. Signing the bytes on the wire removes every JSON-canonicalisation
 * question — key order, unicode escaping, number formatting — none of which we would win.
 */

import crypto from 'node:crypto';

export const TOKEN_VERSION = 'v1';

/* How long a token is good with no server contact. The app refreshes opportunistically
   long before this, so a real user never reaches it; someone who blackholes the domain
   gets exactly this long. 14 days is the grace window, chosen to cover a holiday. */
export const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/* Clock skew allowance. A machine whose clock is a few minutes fast must not reject a
   token the server issued a moment ago. Cuts both ways deliberately: `iat` in the near
   future is tolerated too, because that is the same wrong clock. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

const b64u = {
  enc: buf => Buffer.from(buf).toString('base64url'),
  dec: str => Buffer.from(String(str), 'base64url'),
};

/* A raw Ed25519 public key is 32 bytes. Accept it as base64url — that is what
   `scripts/make-licence-keypair.mjs` prints and what gets pasted into the constant in
   licence.mjs — and turn it into something node:crypto will verify with. */
export function publicKeyFrom(base64urlKey) {
  const raw = b64u.dec(base64urlKey);
  if (raw.length !== 32) throw new Error(`ed25519 public key must be 32 bytes, got ${raw.length}`);
  return crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw).toString('base64url') },
    format: 'jwk',
  });
}

/* The private half, as base64 of its PKCS#8 DER. Not base64url-of-raw-32-bytes like the
   public key: an Ed25519 JWK private key requires BOTH `d` and the matching `x`, so a bare
   seed cannot be imported without first deriving the public point. DER carries the pair,
   node:crypto reads it directly, and it stays a single line — which is what an env var
   needs. `scripts/make-licence-keypair.mjs` prints exactly this string. */
export function privateKeyFrom(base64Pkcs8) {
  return crypto.createPrivateKey({
    key: Buffer.from(String(base64Pkcs8), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

/* Sign. Lives here so the format is declared once, but note that NOTHING in the app calls
   it — the app has no private key. It exists for tests and for the Convex signer, which
   imports the same format description in `landingpage/backend/convex/sign.js`. */
export function signToken(payload, privateKeyObject) {
  const body = b64u.enc(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(body, 'utf8'), privateKeyObject);
  return `${TOKEN_VERSION}.${body}.${b64u.enc(sig)}`;
}

/* Verify a token and return a verdict, never a boolean.
 *
 * The caller has to tell "this is a forgery" from "this expired while you were offline"
 * from "this is for a different machine" — those three want three different behaviours,
 * and a boolean collapses them into one. Same reasoning as `licences.js`'s `resolve`.
 *
 * Reasons: malformed · bad-version · bad-signature · wrong-machine · expired · not-yet-valid
 */
export function verifyToken(token, publicKeyObject, { now, machineId } = {}) {
  if (typeof now !== 'number') throw new Error('verifyToken requires an explicit `now`');

  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [version, body, sig] = parts;
  if (version !== TOKEN_VERSION) return { ok: false, reason: 'bad-version', version };

  /* Signature FIRST, before the payload is parsed or trusted for anything. Parsing an
     unverified body and then acting on a field from it is how a forged token gets to
     influence control flow even when it is ultimately rejected. */
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(body, 'utf8'), publicKeyObject, b64u.dec(sig));
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  if (!valid) return { ok: false, reason: 'bad-signature' };

  let claims;
  try {
    claims = JSON.parse(b64u.dec(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'malformed' };

  /* Machine binding. A token lifted from one machine's data directory and dropped into
     another's is the cheapest possible "crack", and it is the one the seat cap on the
     server cannot see — no request is made. Checking it here is what makes the seat cap
     mean anything offline. */
  if (machineId && claims.machineId && claims.machineId !== machineId) {
    return { ok: false, reason: 'wrong-machine', claims };
  }

  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_MS > now) {
    return { ok: false, reason: 'not-yet-valid', claims };
  }
  if (typeof claims.exp !== 'number') return { ok: false, reason: 'malformed' };
  if (claims.exp + CLOCK_SKEW_MS < now) {
    return { ok: false, reason: 'expired', claims, expiredAt: claims.exp };
  }

  return { ok: true, claims, expiresAt: claims.exp };
}

/* Read the claims WITHOUT verifying. Exactly one legitimate use: telling a user why an
   expired token expired, and when. Never gate anything on this — it is unsigned data by
   definition. Named to be uncomfortable to type by accident. */
export function unsafeDecodeClaims(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(b64u.dec(parts[1]).toString('utf8')); } catch { return null; }
}
