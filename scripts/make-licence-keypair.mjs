#!/usr/bin/env node
/* Mint the Ed25519 licence-signing keypair. Run ONCE, ever.
 *
 *     node scripts/make-licence-keypair.mjs
 *
 * Prints two strings:
 *
 *   PUBLIC  → paste into LICENCE_PUBLIC_KEY in backend/licence.mjs and COMMIT it. A public
 *             key in the bundle is not a leak; it is the entire point. Every copy of the
 *             app needs it to check signatures.
 *
 *   PRIVATE → set as the Convex env var LICENCE_SIGNING_KEY. Never commit it, never paste
 *             it into a chat, never put it in .env in this repo. It is the only thing
 *             standing between you and someone minting their own licences, and unlike a
 *             leaked API key you cannot rotate it without invalidating every token in the
 *             field.
 *
 * Rotating later is possible but not free: every installed copy carries the old public key,
 * so a new keypair means every existing token fails to verify until users update. If you
 * ever must, ship a version that accepts BOTH keys first, wait for adoption, then drop the
 * old one. Cheaper to keep this one safe.
 *
 * This script writes nothing to disk on purpose. A generated secret that lands in a file is
 * a secret you will forget to delete.
 */

import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

/* Public as raw 32 bytes, base64url — short enough to sit in a source constant without
   wrapping, and what `publicKeyFrom()` expects. */
const pub = publicKey.export({ format: 'jwk' }).x;

/* Private as base64 of PKCS#8 DER — single line, and what `privateKeyFrom()` expects. */
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

/* Prove the pair works before printing it. A keypair that does not round-trip is worse
   than no keypair: it fails at the point where a customer is trying to activate. */
const probe = crypto.sign(null, Buffer.from('probe'), privateKey);
if (!crypto.verify(null, Buffer.from('probe'), publicKey, probe)) {
  console.error('generated keypair failed its own round-trip — refusing to print it');
  process.exit(1);
}

process.stdout.write(`
Ed25519 licence keypair
=======================

PUBLIC KEY  — paste into backend/licence.mjs, commit it:

  ${pub}

PRIVATE KEY — set in Convex, never commit:

  cd landingpage/backend
  npx convex env set LICENCE_SIGNING_KEY '${priv}'

Verified: the pair round-trips.

Do not run this script again unless you intend to invalidate every licence token
already in the field.
`);
