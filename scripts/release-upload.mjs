// Publish a built release to the R2 feed that electron-updater polls.
//
// Run AFTER `npm run dist:mac` (or dist:win / dist:linux). Reads whatever
// electron-builder left in release/ and pushes exactly the files an update feed needs:
// the installers, and the *-.yml manifests that name them.
//
//   node scripts/release-upload.mjs            # upload
//   node scripts/release-upload.mjs --dry-run  # list what would go, touch nothing
//
// ── Why the yml files go LAST ────────────────────────────────────────────────────
// latest-mac.yml is the feed. The moment it lands, every installed copy of the app
// starts asking for the binaries it names. Uploading it before those binaries exist
// gives every user a failing download until the last PUT finishes. So: binaries first,
// manifest last, always. That ordering is the whole reason this is a script and not
// a `wrangler r2 object put` in a loop.
//
// ── Why wrangler and not the S3 API ──────────────────────────────────────────────
// The machine is already authenticated for wrangler (OAuth, `wrangler whoami`), so
// there is no access key to store anywhere. An S3 client would need one.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'frameforge-releases';
const DRY = process.argv.includes('--dry-run');

/* Where the build actually landed. Defaults to release/, but on this machine the build
   CANNOT run there — the repo is on exFAT and electron-builder's asar integrity step
   loses a read-after-write race against it (docs/RELEASE.md). So the output goes to an
   APFS path and gets pointed at here. CI, where the checkout is on ext4/APFS/NTFS
   already, just uses the default. */
const RELEASE_DIR = process.env.FRFG_RELEASE_DIR
  ? path.resolve(process.env.FRFG_RELEASE_DIR)
  : path.join(ROOT, 'release');

/* The manifests. These are the feed itself — electron-updater fetches one of these by
   name and everything else follows from what it says. They upload last (see above) and
   must never be cached, or a client will read a stale manifest and miss the release. */
const MANIFESTS = new Set([
  'latest-mac.yml', 'latest.yml', 'latest-linux.yml',
  'beta-mac.yml', 'beta.yml', 'beta-linux.yml',
]);

/* What an end user or an updater actually downloads. `.blockmap` is not optional
   decoration: electron-updater uses it to fetch only the changed chunks of a new
   build, which turns a ~100 MB update into a few MB. Dropping it still "works" and
   silently costs every user a full re-download. */
const INSTALLER_RE = /\.(dmg|zip|exe|AppImage|blockmap)$/;

function human(bytes) {
  return bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + ' MB'
    : (bytes / 1024).toFixed(0) + ' KB';
}

function put(file, { immutable }) {
  const key = path.basename(file);
  /* Installers are content-addressed by filename — FrameForge-0.1.0-arm64.dmg is that
     build forever — so they cache hard. Manifests are the opposite: the same name has
     to return new content on every release, so they must never be cached anywhere. */
  const cache = immutable
    ? 'public, max-age=31536000, immutable'
    : 'no-cache, no-store, must-revalidate';

  if (DRY) {
    console.log(`  would put  ${key}  (${human(fs.statSync(file).size)})  cache=${immutable ? 'immutable' : 'no-cache'}`);
    return;
  }

  execFileSync('wrangler', [
    'r2', 'object', 'put', `${BUCKET}/${key}`,
    '--file', file,
    '--cache-control', cache,
    '--remote',
  ], { stdio: 'inherit', cwd: ROOT });
}

function main() {
  if (!fs.existsSync(RELEASE_DIR)) {
    console.error('No release/ directory. Run `npm run dist:mac` first.');
    process.exit(1);
  }

  /* Top level only. electron-builder also leaves unpacked .app trees in
     release/mac-arm64/ etc; those are build intermediates, not artefacts, and
     recursing would try to upload a quarter-gigabyte of them. */
  const all = fs.readdirSync(RELEASE_DIR)
    .filter(f => fs.statSync(path.join(RELEASE_DIR, f)).isFile());

  const installers = all.filter(f => INSTALLER_RE.test(f));
  const manifests = all.filter(f => MANIFESTS.has(f));

  if (!installers.length) {
    console.error('release/ has no installers. Did the build fail?');
    process.exit(1);
  }
  if (!manifests.length) {
    /* Without a manifest the uploaded binaries are downloadable but invisible to
       every already-installed copy. That is a broken release, not a partial one. */
    console.error('release/ has installers but no *.yml manifest — auto-update would not see this release.');
    process.exit(1);
  }

  console.log(`${DRY ? '[dry run] ' : ''}Publishing to r2://${BUCKET}\n`);

  console.log('Installers:');
  for (const f of installers) put(path.join(RELEASE_DIR, f), { immutable: true });

  console.log('\nUpdate manifests (last, so no client ever reads a manifest before its binaries exist):');
  for (const f of manifests) put(path.join(RELEASE_DIR, f), { immutable: false });

  const total = installers.reduce((n, f) => n + fs.statSync(path.join(RELEASE_DIR, f)).size, 0);
  console.log(`\n${DRY ? 'Would publish' : 'Published'} ${installers.length} installers (${human(total)}) + ${manifests.length} manifest(s).`);
  console.log('Feed: https://pub-04eb7fb87e564f54b1ffd045b6f5ddfb.r2.dev');
}

main();
