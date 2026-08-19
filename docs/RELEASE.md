# Releasing FrameForge

How a build gets from this repo onto someone else's machine, and how it updates itself
afterwards. `desktop/updater.cjs` points here.

Last reconciled against source: 2026-07-30.

## The shape of it

```
npm run dist:mac          →  release/*.dmg, *.zip, latest-mac.yml
npm run release:upload    →  r2://frameforge-releases  (public)
                          →  https://pub-04eb7fb87e564f54b1ffd045b6f5ddfb.r2.dev
```

That public URL is three things at once: what a new user downloads, what
`package.json` `build.publish.url` bakes into the app, and what `electron-updater`
polls on every launch. One host, one source of truth.

## ⚠️ You cannot build on `/Volumes/SSD`

The repo lives on an **exFAT** volume mounted by macOS's `fskit` driver. electron-builder
writes `app.asar` and immediately reads its header back to compute the integrity hash;
on this filesystem the write has not flushed by the time the read lands, and the build
dies with:

```
⨯ The value of "offset" is out of range. It must be >= 0 and <= 4. Received -118883576
    at readAsarHeader (app-builder-lib/src/asar/asar.ts)
    at hashHeader (app-builder-lib/src/asar/integrity.ts)
```

The asar is **not** corrupt — inspect it and the header parses fine. It is a read-after-write
race, and it is why `release/mac-arm64/` used to contain `Electron.app` rather than
`FrameForge.app`: the build died before the rename step, so no DMG was ever produced.

**Always build with the output directory on an APFS volume.** Combined with the two
gotchas below, this is the command that actually works on this machine — copy it whole:

```bash
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false PYTHON_PATH=/usr/bin/python3 \
  npx electron-builder --mac --publish never \
  -c.directories.output=/tmp/frameforge-release

FRFG_RELEASE_DIR=/tmp/frameforge-release npm run release:upload
```

Source files can stay on exFAT. Only the *output* has to move.

## ⚠️ You must pin `PYTHON_PATH=/usr/bin/python3`

The second blocker, hit immediately after the first. The `.zip` targets build fine and the
`.dmg` targets die with a message that names the wrong culprit:

```
⨯ Exit code: 1. Command failed: which python
```

That is not the real error. `dmg-builder/out/dmg.js` runs `dmgbuild/core.py` with
`python3`, and *only if that fails* falls back to `python` — so the message you see is the
**fallback** failing, masking why `python3` failed. What actually happens:

- **Homebrew `python3` (3.14)** — `dmgbuild` vendors `biplist`, which imports `plistlib`
  in a way that has not worked since Python 3.13. Fails at import.
- **`/usr/bin/python3` (3.9.6, Command Line Tools)** — works.

So pin the system one explicitly. `dmg.js` reads `PYTHON_PATH` before it tries either:

```bash
export PYTHON_PATH=/usr/bin/python3
```

Do not "fix" this by installing an older Homebrew python or by symlinking `python` →
`python3`; the symlink just hands the 3.14 interpreter to the fallback path and fails
identically.

## ⚠️ Build every mac target in ONE electron-builder invocation

`latest-mac.yml` describes only what the invocation that wrote it produced. Building
arm64 and x64 separately means the second run overwrites the manifest with a file listing
only its own artefacts — the app silently loses an architecture, and because macOS
auto-update pulls the **`.zip`** (never the `.dmg`), a manifest assembled from `--mac dmg`
runs alone is one that no installed copy can update from at all.

One command, all targets:

```bash
npx electron-builder --mac --publish never -c.directories.output=/tmp/frameforge-release
```

A correct `latest-mac.yml` lists four files — both `.zip`s and both `.dmg`s — with `path:`
pointing at a `.zip`.

## Signing — and why auto-update depends on it

`npm run dist:mac` builds **unsigned**. That is fine for handing a build to one tester,
but be honest with them about two consequences:

1. **Gatekeeper blocks it.** macOS quarantines anything downloaded from a browser. The
   tester sees *"FrameForge is damaged and can't be opened"* — which is a lie the OS
   tells about every unsigned app. They clear it once:

   ```bash
   xattr -dr com.apple.quarantine /Applications/FrameForge.app
   ```

2. **Auto-update does not work.** Squirrel.Mac refuses to apply an update to an app whose
   signature it cannot validate, so an unsigned build checks the feed, downloads, and
   then silently fails to install. Unsigned testers update by re-downloading.

   This is the one that matters. If one-click updates are a requirement, signing is not
   optional polish — it is the feature.

### Switching signing on

Needs a **Developer ID Application** certificate in the login keychain. Check with:

```bash
security find-identity -v -p codesigning
```

`0 valid identities found` means the certificate is not installed — having an Apple
Developer *account* is not the same thing. Create the certificate in the Apple Developer
portal (Certificates → Developer ID Application), download it, double-click to install.

### Notarisation credentials — two routes, and they do NOT fall through

electron-builder checks them in order (`app-builder-lib/out/macPackager.js`) and stops at the
first one it sees:

| | Env vars | Behaviour |
|---|---|---|
| 1 | `APPLE_ID` | If set, **requires** `APPLE_APP_SPECIFIC_PASSWORD` — otherwise it THROWS |
| 2 | `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | All three or none |
| 3 | neither | Notarisation skipped **silently** |

The trap is that they are mutually exclusive in practice: leaving `APPLE_ID` in the environment
while intending to use an API key fails the build complaining about a password you deliberately
do not have. `release.yml` picks one and unsets the other.

**The API key is the better CI credential.** It survives an Apple ID password change, does not
depend on a personal account's 2FA, and can be revoked on its own. Get it from
App Store Connect → Users and Access → Integrations → App Store Connect API, with **Developer**
access. The `.p8` downloads once. `APPLE_API_KEY` is a PATH to that file, not its contents —
notarytool receives it as `--key <path>` — so CI stores the base64 as `APPLE_API_KEY_P8` and
decodes it to `$RUNNER_TEMP` at build time.

⚠️ **Signed but NOT notarised is the worst outcome**, and it looks like success: the app is
signed, the build is green, and Gatekeeper still blocks it — so the only symptom is a user
reporting "damaged" for a release you believe is correct. `release.yml` now fails a tag push in
that state rather than shipping it.

Then notarization credentials, as environment variables:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com → App-Specific Passwords
export APPLE_TEAM_ID="XXXXXXXXXX"                          # Apple Developer → Membership
npm run dist:mac:signed
```

`dist:mac:signed` drops `CSC_IDENTITY_AUTO_DISCOVERY=false`, so electron-builder finds
the certificate itself, and passes the team id through to the notarizer. Notarization adds
roughly 5–15 minutes while Apple's service scans the build.

The hardened-runtime entitlements this needs are already in
`desktop/entitlements.mac.plist` — read the comments there before adding to them.

## Cutting a release

1. **Bump the version** in `package.json`. electron-updater compares semver against the
   installed build; forgetting this ships a release nobody is offered.
2. `npm test` — 384 tests as of 2026-08-07. Treat green as the gate, not the number, and run
   it on the platform you are shipping: 16 of those failures were Windows-only and invisible
   on macOS for months.
3. Build — the copy-whole command above (APFS output, pinned python, one invocation).
4. Upload. Add `--dry-run` first to see what would go:
   `FRFG_RELEASE_DIR=/tmp/frameforge-release npm run release:upload -- --dry-run`
5. Update `FF.BUILD` in `landingpage/js/data.js` with the version, date, URLs and SHA-256s
   (`shasum -a 256 *.dmg`). Until that is filled in, `download.html` correctly says
   "not released yet" rather than serving a dead link.
6. Launch the built app once and confirm the updater log says `up to date` rather than a
   404. That one line proves the manifest, the URLs and the baked-in feed all agree —
   it is the cheapest end-to-end check there is, and it catches a broken release before
   a user does.

`release-upload.mjs` uploads **installers first, manifests last**, deliberately. The
`.yml` manifest *is* the feed: the moment it lands, every installed copy starts asking
for the binaries it names, so those binaries have to exist already. Do not reorder this.

It also uploads `.blockmap` files. They are not decoration — electron-updater uses them
to download only the changed chunks of a new build, turning a ~100 MB update into a few
MB. Skipping them still "works" and silently costs every user a full re-download.

## How big it is, and why

| Piece | Size | Can it shrink? |
|---|---|---|
| Electron framework | ~243 MB | No. This is the floor for any Electron app. |
| `sharp` + `@img` natives | ~27 MB | No — image processing is core. Unpacked from the asar by necessity. |
| `app.asar` (app + `dist/` + `express`, `gray-matter`) | ~14.5 MB | Already trimmed. |
| **DMG, compressed** | **~100–115 MB** | |

`three` (22 MB) used to sit in `dependencies` and ship raw inside the asar **in addition
to** the 698 KB chunk Vite already tree-shakes out of it. It is lazy-loaded by exactly one
file (`frontend/ThreeDStage.jsx`), so it is a build-time dependency. Moving it — along
with `react`, `react-dom` and `marked`, all bundled by Vite — to `devDependencies` cut the
asar from 33.7 MB to 14.5 MB. **Only `express`, `gray-matter`, `sharp` and
`electron-updater` are genuinely needed at runtime.** Check before adding to `dependencies`:
anything the frontend imports belongs in `devDependencies`.

### There is no demo payload to split out

A reasonable instinct is to ship the app lean and download demo content separately. That
is already how it works, and it saves nothing further: `backend/seed.mjs` `seedIfEmpty()`
writes the three starter projects as **markdown text** on first launch, and
`desktop/main.cjs` points `FRFG_DATA` at `~/Library/Application Support/FrameForge/storage`.
No generated media ships. The `workspace/` directory in this repo (451 MB) is *your* local
data — it is gitignored and has never been in a build.

The only bundled assets are `dist/axis-options` (291 reference JPEGs, ~6 MB) and
`dist/preset-previews` (~2 MB). Moving those to a CDN would save ~8 MB off a ~110 MB
download, at the cost of a first-run that needs network. Not worth it.

## Windows and Linux

Neither can be built from macOS without help:

- **Windows** (`nsis`) needs Wine, or a Windows runner.
- **Linux** (`AppImage`) needs Docker.

`npm run dist:win` and `dist:linux` exist but only run where those toolchains do, so the
route is a runner matrix: **`.github/workflows/release.yml`**, three legs (macos-14,
windows-latest, ubuntu-latest), triggered by a `v*` tag or by hand from the Actions tab.

### Building the Windows installer ON Windows — two traps

`npm run dist:win` works natively on a Windows box (verified 2026-08-07: `FrameForge Setup
0.1.0.exe`, 96,653,115 bytes, with a matching `latest.yml` and `.blockmap`). It hits two
environment blockers first, and neither error names its real cause.

**1. Symlink privilege.** electron-builder downloads a `winCodeSign` archive for every Windows
target — it needs `rcedit-x64.exe` from it to stamp the icon and version metadata into the exe,
even when nothing is being signed. That archive is cross-platform and carries macOS OpenSSL
dylibs, whose unversioned names are **symlinks**. Creating a symlink on Windows needs
`SeCreateSymbolicLinkPrivilege`, which non-admin users lack. 7-Zip exits status 2, electron-builder
retries four times (re-downloading each time) and aborts before NSIS:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
  ...winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

So a Windows build fails on macOS libraries it will never load. Fix: turn on **Developer Mode**
(Windows 10: Settings → Update & Security → For developers; Windows 11: Settings → Privacy &
security → For developers; or `ms-settings:developers`), which grants the privilege without
elevation. Building from an elevated shell also works. CI runners already hold it.

Test it directly rather than trusting the registry — `AppModelUnlock` can exist with the value
unset:

```bash
node -e "require('fs').symlinkSync('a','b','file')"   # EPERM => still blocked
```

If a run already failed this way, clear `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign`
before retrying: the partial extractions leave 0-byte stubs where the symlinks belong.

**2. Temp-drive free space.** NSIS memory-maps the whole compressed payload (~108 MiB) in `TEMP`.
On a system drive short of space it dies with a message that sounds like a compiler bug:

```
Internal compiler error #12345: error creating mmap the size of 112986886.
```

That is a full disk, not a toolchain fault. Point the build somewhere with room:

```bash
TMP=D:/frameforge-buildtmp TEMP=D:/frameforge-buildtmp npm run dist:win
```

This is the Windows sibling of the macOS "you cannot build on `/Volumes/SSD`" trap above: in both
cases the *output/scratch* location, not the source location, is what breaks the build.

**Check the exit code, not the artifact list.** A failed NSIS run still leaves a
`FrameForge Setup <ver>.exe` in `release/` — but as a ~160 KB stub with no payload. And if you
pipe the build through `tail`, the shell reports *tail's* status, so a failure reads as exit 0.
A real installer is ~92 MB and its sha512 matches `latest.yml`.

**It has been run three times — by hand, on 2026-07-30 — and has never yet gone fully green.**
Where it stands as of 2026-08-07: the **macOS leg passes** (run 30573554464 produced a 443 MB
artifact: both architectures, dmg + zip + blockmaps + `latest-mac.yml`), **Linux passes**, and
**Windows failed at `npm test`** with 16 platform-specific failures — fixed on branch
`fix/windows-ci`. Because `publish` declares `needs: build`, that single red leg is why nothing
has ever reached the R2 feed despite macOS building correctly the whole time.

Before trusting a tag, trigger it manually with `publish: false` and confirm all three legs go
green. It needs two R2 secrets to publish —
`CLOUDFLARE_API_TOKEN` (R2 → Manage API tokens → Object Read & Write; the OAuth login
wrangler uses locally does not exist on a runner) and `CLOUDFLARE_ACCOUNT_ID`.

### The three mac build scripts, and which is which

| Script | Signs? | For |
|---|---|---|
| `dist:mac` | **No** — sets `CSC_IDENTITY_AUTO_DISCOVERY=false` | local throwaway builds, no cert needed |
| `dist:mac:signed` | Yes, + notarizes via `$APPLE_TEAM_ID` | a signed build from your own machine |
| `dist:mac:ci` | Yes **if** `CSC_LINK` is set, otherwise unsigned | the Actions matrix |

The matrix used to call `dist:mac`, which meant the release build came out unsigned no
matter how many Apple secrets were configured — `CSC_IDENTITY_AUTO_DISCOVERY=false` tells
electron-builder not to go looking for an identity at all. If you ever point CI back at
`dist:mac`, you have silently turned signing off again.

`CSC_LINK`/`MAC_CERT_P12` must be the **base64 of the .p12**, not the raw file:

```bash
base64 -i cert.p12 | pbcopy                                              # macOS
```
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.p12")) | Set-Clipboard   # Windows
```

### Getting the certificate without a Mac

The certificate is a **Developer ID Application** one. `Apple Distribution` and
`Mac App Distribution` are for the Mac App Store and will not sign a self-hosted DMG.

Keychain Access normally generates the signing request, but a CSR is just PKCS#10, so OpenSSL
produces an identical one anywhere — which matters because this project is developed on Windows
as well as macOS:

```bash
openssl genrsa -out frameforge-private.key 2048
openssl req -new -key frameforge-private.key -out frameforge.certSigningRequest \
  -subj "/emailAddress=you@example.com/CN=FrameForge Developer ID/C=US"
```

Upload that at developer.apple.com → Certificates → **+** → Developer ID Application, download
the `.cer`, then combine it with the key and Apple's **Developer ID Certification Authority**
intermediate (from apple.com/certificateauthority) so the bundle carries a complete chain:

```bash
openssl x509 -inform DER -in developerID_application.cer -out cert.pem
openssl x509 -inform DER -in DeveloperIDCA.cer -out intermediate.pem
openssl pkcs12 -export -out cert.p12 -inkey frameforge-private.key \
  -in cert.pem -certfile intermediate.pem
```

**Set a non-empty export password.** An empty-password `.p12` fails to import into the runner's
temporary keychain, and the resulting error does not mention the password.

Two limits worth knowing before you start: only the Account Holder or an Admin can create a
Developer ID Application certificate, and Apple caps them per account (typically 5). Back up
`frameforge-private.key` and `cert.p12` — regenerating costs one of those slots.

## The update feed, in one paragraph

The app reads its feed URL from `resources/app-update.yml`, baked in at build time from
`package.json` `build.publish`. `FRFG_UPDATE_URL` overrides it at runtime,
`FRFG_UPDATE_CHANNEL` swaps channel, `FRFG_NO_UPDATE=1` disables it. On launch the app
checks once, downloads in the background, and installs on the next quit — never
mid-session, because a generation batch can run for many minutes and a surprise relaunch
would kill it. `desktop/updater.cjs` never calls `quitAndInstall()`, and that is on purpose.

If the feed ever moves to a custom domain (`updates.frameforge.app`), point it at the same
R2 bucket and change `build.publish.url`. Already-installed copies keep polling the old
r2.dev URL until they update once, so keep the old host alive through at least one release.
