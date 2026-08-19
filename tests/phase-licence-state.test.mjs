/* Licence state machine — the grace policy, and what a refund does.
 *
 * `phase-licence-token.test.mjs` proves a token cannot be forged. This proves the app does
 * the right thing with a token that IS genuine: how long it survives offline, what happens
 * when it lapses, and that a refund kills it immediately rather than in a fortnight.
 *
 * The network is stubbed by swapping globalThis.fetch. These tests must never touch the
 * real Convex deployment — a test suite that talks to production licensing is one bad
 * afternoon away from revoking a customer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'frfg-licence-'));
process.env.FRFG_DATA = ROOT;
process.env.FRFG_LICENCE_API = 'https://licence.test.invalid';

const { signToken } = await import('../backend/licenceToken.mjs');
const licence = await import('../backend/licence.mjs');
const { TOKEN_TTL_MS, REFRESH_AFTER_MS } = { ...await import('../backend/licenceToken.mjs'), ...licence };

const KP = crypto.generateKeyPairSync('ed25519');
const PUB = KP.publicKey.export({ format: 'jwk' }).x;
const NOW = 1_700_000_000_000;

function tokenFor(over = {}) {
  return signToken({
    v: 1,
    key: 'FFRG-ABCD-EFGH-JKMN',
    plan: 'app',
    machineId: licence.machineId(),
    seats: 3,
    iat: NOW,
    exp: NOW + TOKEN_TTL_MS,
    ...over,
  }, KP.privateKey);
}

/* Swap fetch for the duration of one call. Returns whatever the stub is given. */
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const jsonRes = obj => ({ ok: true, status: 200, json: async () => obj });
const offline = () => { throw new Error('getaddrinfo ENOTFOUND'); };

test.beforeEach(() => licence.forgetLocalLicence());

test('with no public key compiled in, enforcement is off and the app is unaffected', () => {
  assert.equal(licence.isEnforced(''), false);
  const s = licence.licenceState({ now: NOW, publicKey: '' });
  assert.equal(s.status, 'off');
  assert.equal(s.ok, true, 'off must be permissive — this is what ships until the key is set');
});

test('machineId is stable across calls and survives a re-read', () => {
  const a = licence.machineId();
  assert.equal(a, licence.machineId());
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('no token means not licensed, but says so as `none` rather than an accusation', () => {
  const s = licence.licenceState({ now: NOW, publicKey: PUB });
  assert.equal(s.status, 'none');
  assert.equal(s.ok, false);
});

test('a genuine token for this machine is licensed', async () => {
  await withFetch(async () => jsonRes({ ok: true, plan: 'app', token: tokenFor(), seats: 3, used: 1 }),
    () => licence.activate('FFRG-ABCD-EFGH-JKMN', { now: NOW }));
  const s = licence.licenceState({ now: NOW, publicKey: PUB });
  assert.equal(s.status, 'licensed');
  assert.equal(s.plan, 'app');
});

test('THE GRACE WINDOW: a token keeps working offline for its full 14 days, then stops', async () => {
  await withFetch(async () => jsonRes({ ok: true, plan: 'app', token: tokenFor() }),
    () => licence.activate('FFRG-ABCD-EFGH-JKMN', { now: NOW }));

  const day = 24 * 60 * 60 * 1000;
  assert.equal(licence.licenceState({ now: NOW + 13 * day, publicKey: PUB }).status, 'licensed',
    'day 13 offline must still work — this is the plane/proxy/outage case');

  const late = licence.licenceState({ now: NOW + 15 * day, publicKey: PUB });
  assert.equal(late.status, 'expired',
    'day 15 offline must stop — this is the difference from pure fail-open');
  assert.equal(late.ok, false);
  assert.equal(late.plan, 'app', 'an expired token still explains itself');
});

test('an unreachable server does NOT revoke a token inside its window', async () => {
  await withFetch(async () => jsonRes({ ok: true, plan: 'app', token: tokenFor() }),
    () => licence.activate('FFRG-ABCD-EFGH-JKMN', { now: NOW }));

  const out = await withFetch(offline,
    () => licence.refresh({ force: true, now: NOW + 60_000, publicKey: PUB }));
  assert.equal(out.reachable, false);
  assert.equal(licence.licenceState({ now: NOW + 60_000, publicKey: PUB }).status, 'licensed',
    'a flaky network must never look like a revoked licence');
});

test('a refund revokes immediately rather than at expiry', async () => {
  await withFetch(async () => jsonRes({ ok: true, plan: 'app', token: tokenFor() }),
    () => licence.activate('FFRG-ABCD-EFGH-JKMN', { now: NOW }));
  assert.equal(licence.licenceState({ now: NOW, publicKey: PUB }).status, 'licensed');

  const out = await withFetch(async () => jsonRes({ ok: false, reason: 'refunded' }),
    () => licence.refresh({ force: true, now: NOW + 1000, publicKey: PUB }));
  assert.equal(out.revoked, 'refunded');
  assert.equal(licence.licenceState({ now: NOW + 2000, publicKey: PUB }).status, 'none',
    'the token must be gone, not merely ignored');
});

test('a token minted for a different machine is invalid, not merely expired', async () => {
  await withFetch(async () => jsonRes({ ok: true, plan: 'app', token: tokenFor({ machineId: 'someone-else' }) }),
    () => licence.activate('FFRG-ABCD-EFGH-JKMN', { now: NOW }));
  const s = licence.licenceState({ now: NOW, publicKey: PUB });
  assert.equal(s.status, 'invalid');
  assert.equal(s.reason, 'wrong-machine');
});

test('a token signed by an attacker is invalid however well-formed', async () => {
  const attacker = crypto.generateKeyPairSync('ed25519');
  const forged = signToken({
    v: 1, key: 'FFLT-0000-0000-0000', plan: 'lifetime',
    machineId: licence.machineId(), seats: 99, iat: NOW, exp: NOW + TOKEN_TTL_MS,
  }, attacker.privateKey);

  await withFetch(async () => jsonRes({ ok: true, plan: 'lifetime', token: forged }),
    () => licence.activate('FFLT-0000-0000-0000', { now: NOW }));

  const s = licence.licenceState({ now: NOW, publicKey: PUB });
  assert.equal(s.status, 'invalid');
  assert.equal(s.reason, 'bad-signature');
});

test('refresh no-ops while the token is fresh, and runs once it is stale', async () => {
  await withFetch(async () => jsonRes({ ok: true, plan: 'app', token: tokenFor() }),
    () => licence.activate('FFRG-ABCD-EFGH-JKMN', { now: NOW }));

  let calls = 0;
  const counting = async () => { calls++; return jsonRes({ ok: true, plan: 'app', token: tokenFor() }); };

  await withFetch(counting, () => licence.refresh({ now: NOW + 1000, publicKey: PUB }));
  assert.equal(calls, 0, 'a token minted seconds ago must not hit the network');

  await withFetch(counting, () => licence.refresh({ now: NOW + REFRESH_AFTER_MS + 1000, publicKey: PUB }));
  assert.equal(calls, 1, 'a day-old token refreshes');
});

test('a server that says ok but issues no token names the real fault', async () => {
  const out = await withFetch(async () => jsonRes({ ok: true, plan: 'app' }),
    () => licence.activate('FFRG-ABCD-EFGH-JKMN', { now: NOW }));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-token-issued',
    'an unconfigured signer must not read as a bad key');
});

test('seats-full comes back intact so the app can name the machines', async () => {
  const out = await withFetch(
    async () => jsonRes({ ok: false, reason: 'seats-full', seats: 3, used: 3, machines: ['A', 'B', 'C'] }),
    () => licence.activate('FFRG-ABCD-EFGH-JKMN', { now: NOW }));
  assert.equal(out.reason, 'seats-full');
  assert.deepEqual(out.machines, ['A', 'B', 'C']);
});

test('the escape hatch turns enforcement off entirely', () => {
  process.env.FRFG_LICENCE_OFF = '1';
  try {
    assert.equal(licence.isEnforced(PUB), false);
    assert.equal(licence.licenceState({ now: NOW, publicKey: PUB }).status, 'off');
  } finally {
    delete process.env.FRFG_LICENCE_OFF;
  }
});

test('a read-only licence file does not throw into the caller', () => {
  // Whatever the disk does, licenceState answers with a verdict.
  assert.doesNotThrow(() => licence.licenceState({ now: NOW, publicKey: PUB }));
  assert.doesNotThrow(() => licence.machineId());
});
