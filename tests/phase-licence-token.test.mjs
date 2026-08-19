/* Licence token format and signature checking.
 *
 * This is the file that decides whether "unforgeable" is true. If it goes red, the claim
 * in backend/licenceToken.mjs's header is false and keys can be minted by anyone — treat
 * that as a broken feature, never as a broken test.
 *
 * Every case passes an explicit `now`. The module refuses to read the clock itself, which
 * is what lets the expiry boundary be tested exactly rather than approximately.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  signToken, verifyToken, publicKeyFrom, privateKeyFrom, unsafeDecodeClaims,
  TOKEN_TTL_MS, CLOCK_SKEW_MS, TOKEN_VERSION,
} from '../backend/licenceToken.mjs';

/* A throwaway pair per run. Never a fixture: a committed private key in a test file is a
   private key on a public branch the day the repo opens up. */
function pair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    priv: privateKey,
    pub: publicKey,
    pubB64: publicKey.export({ format: 'jwk' }).x,
    privB64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

const NOW = 1_700_000_000_000;

function claims(over = {}) {
  return {
    v: 1,
    key: 'FFLT-ABCD-EFGH-JKMN',
    plan: 'lifetime',
    machineId: 'machine-one',
    seats: 3,
    iat: NOW,
    exp: NOW + TOKEN_TTL_MS,
    ...over,
  };
}

test('a signed token round-trips and returns its claims', () => {
  const k = pair();
  const tok = signToken(claims(), k.priv);
  const out = verifyToken(tok, k.pub, { now: NOW, machineId: 'machine-one' });
  assert.equal(out.ok, true);
  assert.equal(out.claims.plan, 'lifetime');
  assert.equal(out.claims.key, 'FFLT-ABCD-EFGH-JKMN');
  assert.equal(out.expiresAt, NOW + TOKEN_TTL_MS);
});

test('the exported base64 key strings import back to working keys', () => {
  const k = pair();
  // The round trip that matters operationally: what make-licence-keypair.mjs prints must
  // be what licence.mjs and the Convex signer can actually load.
  const tok = signToken(claims(), privateKeyFrom(k.privB64));
  assert.equal(verifyToken(tok, publicKeyFrom(k.pubB64), { now: NOW }).ok, true);
});

test('a token signed by a DIFFERENT key is rejected — this is the anti-keygen property', () => {
  const real = pair();
  const attacker = pair();
  // An attacker who knows the format exactly, and mints a perfectly well-formed token.
  const forged = signToken(claims({ plan: 'lifetime' }), attacker.priv);
  const out = verifyToken(forged, real.pub, { now: NOW });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'bad-signature');
  assert.equal(out.claims, undefined, 'a forged token must not return usable claims');
});

test('flipping one byte of the payload invalidates the signature', () => {
  const k = pair();
  const tok = signToken(claims({ plan: 'app' }), k.priv);
  const [ver, body, sig] = tok.split('.');

  // Upgrade oneself from app to lifetime by editing the payload — the obvious attack.
  const upgraded = Buffer.from(
    JSON.stringify(claims({ plan: 'lifetime' })), 'utf8').toString('base64url');
  const out = verifyToken(`${ver}.${upgraded}.${sig}`, k.pub, { now: NOW });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'bad-signature');
  assert.notEqual(body, upgraded, 'the test itself must actually change the payload');
});

test('a token for another machine is refused even though the signature is good', () => {
  const k = pair();
  const tok = signToken(claims({ machineId: 'machine-one' }), k.priv);
  const out = verifyToken(tok, k.pub, { now: NOW, machineId: 'machine-two' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'wrong-machine');
});

test('machine binding is skipped when the caller does not assert a machine', () => {
  const k = pair();
  const tok = signToken(claims(), k.priv);
  assert.equal(verifyToken(tok, k.pub, { now: NOW }).ok, true);
});

test('expiry is enforced, and reports when it lapsed', () => {
  const k = pair();
  const exp = NOW + TOKEN_TTL_MS;
  const tok = signToken(claims({ exp }), k.priv);

  assert.equal(verifyToken(tok, k.pub, { now: exp - 1 }).ok, true, 'valid one ms before');
  assert.equal(verifyToken(tok, k.pub, { now: exp + CLOCK_SKEW_MS - 1 }).ok, true,
    'still valid inside the skew allowance');

  const dead = verifyToken(tok, k.pub, { now: exp + CLOCK_SKEW_MS + 1 });
  assert.equal(dead.ok, false);
  assert.equal(dead.reason, 'expired');
  assert.equal(dead.expiredAt, exp);
  assert.equal(dead.claims.plan, 'lifetime', 'expired tokens still explain themselves');
});

test('a token issued in the future is refused beyond the skew allowance', () => {
  const k = pair();
  const tok = signToken(claims({ iat: NOW + 60 * 60 * 1000 }), k.priv);
  assert.equal(verifyToken(tok, k.pub, { now: NOW }).reason, 'not-yet-valid');
  // A clock a couple of minutes out is a wrong clock, not an attack.
  const near = signToken(claims({ iat: NOW + CLOCK_SKEW_MS - 1000 }), k.priv);
  assert.equal(verifyToken(near, k.pub, { now: NOW }).ok, true);
});

test('malformed input is refused without throwing', () => {
  const k = pair();
  for (const bad of ['', null, undefined, 'nonsense', 'a.b', 'a.b.c.d', 'v1..', 'v1.!!!.!!!']) {
    const out = verifyToken(bad, k.pub, { now: NOW });
    assert.equal(out.ok, false, `${JSON.stringify(bad)} must not verify`);
    assert.ok(typeof out.reason === 'string');
  }
});

test('a payload that is valid base64 but not JSON is refused', () => {
  const k = pair();
  const body = Buffer.from('not json at all', 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body, 'utf8'), k.priv);
  const out = verifyToken(`${TOKEN_VERSION}.${body}.${sig.toString('base64url')}`, k.pub, { now: NOW });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'malformed');
});

test('a token with no exp is malformed, not eternal', () => {
  const k = pair();
  const c = claims(); delete c.exp;
  const out = verifyToken(signToken(c, k.priv), k.pub, { now: NOW });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'malformed');
});

test('a future format version is refused rather than guessed at', () => {
  const k = pair();
  const tok = signToken(claims(), k.priv).replace(/^v1\./, 'v2.');
  const out = verifyToken(tok, k.pub, { now: NOW });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'bad-version');
});

test('verifyToken refuses to run without an explicit now', () => {
  const k = pair();
  const tok = signToken(claims(), k.priv);
  assert.throws(() => verifyToken(tok, k.pub, {}), /explicit `now`/);
  assert.throws(() => verifyToken(tok, k.pub), /explicit `now`/);
});

test('publicKeyFrom rejects a key of the wrong length instead of failing later', () => {
  assert.throws(() => publicKeyFrom(Buffer.alloc(16).toString('base64url')), /32 bytes/);
});

test('unsafeDecodeClaims reads a forged token without blessing it', () => {
  const real = pair();
  const attacker = pair();
  const forged = signToken(claims({ plan: 'lifetime' }), attacker.priv);
  // It reads — that is its job, for explaining an expiry to a user.
  assert.equal(unsafeDecodeClaims(forged).plan, 'lifetime');
  // And it is emphatically not a verdict.
  assert.equal(verifyToken(forged, real.pub, { now: NOW }).ok, false);
  assert.equal(unsafeDecodeClaims('rubbish'), null);
});
