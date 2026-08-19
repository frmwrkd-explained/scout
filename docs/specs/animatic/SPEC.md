<!-- Spec family: animatic. Created 2026-07-30.
     Status: SHIPPED. The header below said "PROPOSED - not started" until 2026-08-02,
     by which point backend/reel.mjs, reelExport/reelPack/reelRender, shared/timecode.mjs,
     frontend/Timeline.jsx and three test files (phase-reel-timeline/-clock/-timecode) were
     all live. Read this as the design record, not as a work queue.
     Produced by a 16-agent research + design + adversarial-judging pass.
     Independently verified by the author before filing:
       - backend/manifest.mjs already builds an ordered, trimmed selects list (edit-manifest.md)
       - shot.selectedCandidate is the approval marker (backend/generate.mjs syncShotSelection)
       - refreshSelectsOnDisk() rebuilds it on every keep/kill/final (backend/index.mjs)
       - shotsPayload emits `file:`, REMOTION_TEMPLATE reads `f.path` -> the starter comp's
         local-file branch has never worked. Real bug, fixed in A2.
       - shotsPayload's renders() uses a raw pid, not safeScope(pid). Real, fixed in A2.
     Everything marked "verified" in the Export section was checked against primary sources;
     everything marked "assumed" still needs a human to click Import once. -->

# Animatic — recommendation

## The bet

FrameForge already knows the cut. `backend/manifest.mjs:19-36` walks approved shots in `no` order and joins each to its `selectedCandidate` generation; `backend/index.mjs:811-846` does the same join with a richer three-tier fallback. The order, the picture and the runtime all exist on disk today. What is missing is not a timeline — it is (a) a way to *feel* the pacing without exporting, and (b) a file an editor can open. So we build **the Reel**: a derived, gapless, frame-quantised view over the shots you already approved, plus a conform pack that opens in Premiere, Resolve and Final Cut. The reel stores exactly one thing the shots cannot hold — **time, in integer frames** — and nothing else. Order comes from `shot.no`. Picture comes from `shot.selectedCandidate`. There is no import button, no "add shots to timeline", no sync panel, and structurally there can never be one.

We deliberately refuse: multi-track video, gaps (a gap is a slate clip, never an absence), lift-vs-ripple, slip, slide, tool modes, effects, keyframes, virtualization, AAF, WebCodecs, and any attempt to become an NLE. The x-axis-is-time decision is what makes an NLE hard — it makes a 1.2s cut fifteen pixels wide at any zoom that fits a 90-second reel, and every affordance an NLE ships (zoom, fit, snapping, scroll modes, trim handles, windowing) exists to compensate for that one choice. We take the middle path none of the drafts took: **card width proportional to duration, with a hard floor** — a 0.5s cut is visibly short *and* still clickable — plus a true-to-scale pace bar for the overview. Duration then stops being a length you approximate by dragging and becomes a number you read, nudge with `[` / `]`, or type exactly. That is the right shape for a keyboard-first app whose author hates web forms, and it is why this ships in ~1,100 lines instead of the ~3,400 an NLE model costs.

---

## Prior art — what we take, what we skip

| Project | License | What we steal | Why we don't depend on it |
|---|---|---|---|
| **Palmier Pro** — almost certainly the user's "Palmir" (French *palmier* ≈ PAL-mee-ay; released 2026-06-18 by YC-backed Palmier; the only open-source video editor whose entire pitch is agent-driven timeline editing over MCP, with the MCP server living inside the timeline) | GPL-3.0 | The rule that agent tools and UI controls must call the **same domain operation** and share **one undo history**, so an agent edit is Cmd-Z-able exactly like a human's; and time kept in integer frames, converted to floats only at UI and export boundaries | GPL-3.0 forecloses it for a proprietary desktop app. Swift + Metal, macOS-only. Zero reuse path. Reading it to learn architecture is fine; copying is not |
| **OpenCut Classic** | MIT | Controller-per-interaction decomposition (separate playhead / zoom / resize / drag state) — the thing that keeps a hand-written timeline from becoming one 3,000-line mousemove handler | **Archived 2026-05-17.** Vendoring = permanent fork. 105 files / ~428 KB of TypeScript entangled with a wasm `MediaTime` type plus animation/effects/masks/params. This repo is plain ESM JS by rule |
| **OpenTimelineIO** | Apache-2.0 | The schema *vocabulary*: `RationalTime` (value + rate, never floats), `TimeRange` (start + duration, never start + end), `media_reference` vs `source_range` | No production JS/WASM binding exists in 2026. The two real candidates are an 8-star personal repo last pushed 2023 and a Pyodide demo. Name our fields after it; don't import it |
| **Remotion** | Custom — free only for ≤3 employees | `durationInFrames` + `fps` discipline; `@remotion/player`'s imperative ref shape (`seekTo`/`play`/`getCurrentFrame`) | The Company Licence's Automators tier explicitly names *"embedding the Remotion Player"* at $100/mo minimum. FrameForge deliberately orchestrates an **external** Remotion project (`shared/integrations.mjs:28`, `needs: 'remotionProject'`); bundling the player would contradict that and import the obligation into the shipped app |
| **editly** | MIT | The JSON edit spec — `clips: [{ duration, layers, transition }]`, **no track abstraction at all**. Proof that a 1-D ordered clip list is sufficient and ergonomic for this exact problem shape | Headless CLI, no UI, quiet since 2025-05 |
| **auto-editor** | Unlicense | The escape-hatch pattern: never make the user live inside your editor — emit the cut into whatever NLE they already use. This is what converts "our timeline is deliberately simple" from an apology into a design position | No timeline UI. Nim CLI |
| **MLT family** (Kdenlive / Shotcut / Flowblade) | GPL-3.0 / LGPL-2.1 | The **shortcut vocabulary**, verbatim: J/K/L, I/O, Space, `S` split, `M` marker, `+`/`-` zoom, Home/End, arrows to frame-step. Keybindings carry no licence risk and users arrive already knowing them | Desktop C++/Qt/GTK, GPL. Olive (9.1k stars, dormant since 2024-12) is the cautionary tale about timeline scope creep |
| **@designcombo/timeline** — the one actual drop-in npm timeline | **None** | Nothing | **No license field on npm and no public source repo.** Unlicensed code is all-rights-reserved by default. Hard no, independent of anything else |
| **Storyboard Pro / Boords / Storyboarder** | — | Non-zero default duration so a board is playable the instant it exists; `N` for new panel; `,` / `.` for ±1 frame on the current panel | None is a timeline. All three require typing or dragging durations one at a time — which is the gap tap-to-time fills |

**Verdict: build bespoke, steal ruthlessly.** Not one candidate survives the licence gate *and* ships a reusable timeline *and* fits this codebase's plain-ESM rule.

---

## Data model

### Path

`workspace/projects/<safeScope(pid)>/reel.md` — **one per project, singular, no id, no collection.** A project has one reel the way it has one `brief.md` and one `edit-manifest.md`. No `cuts/` directory, no picker, no "which cut does the export read" question.

Helpers live in `backend/reel.mjs`, not in `store.mjs` `paths` — per-feature dirs belong to the feature module (`backend/story.mjs:12`, `backend/manual.mjs:45`, `backend/generate.mjs:23` all do this):

```js
const R = () => getStorageRoot();
const reelMd = pid => path.join(R(), 'projects', safeScope(pid), 'reel.md');
```

### The rule

**The reel stores only what a shot cannot hold: TIME.**

| Fact | Canonical home | Written by |
|---|---|---|
| shot order | `shot.no` | `PATCH /api/story/:pid/shots/reorder` (`backend/story.mjs:75-94`) |
| which picture | `shot.selectedCandidate` | `syncShotSelection` (`backend/generate.mjs:331-344`) |
| authored length | `shot.dur` (seconds) | AI breakdown, Story list, Composer TECH popover |
| **cut length** | `reel.timing[<shotId>].frames` | **the reel, and only the reel** |
| fps / canvas / tcStart / target / omissions / audio | `reel.md` frontmatter | `PATCH /api/reel/:pid` |

`timing` is **sparse**: it holds an entry only for shots the user has actually retimed. A fresh reel has `timing: {}` and is 100% derived. That is what kills the "second source of truth" objection — resolution is one function with a documented precedence, exactly like the existing settings precedence (shell → `.env` → `settings.md`):

```
framesFor(shot) =
  reel.timing[shot.id].frames          // user retimed it here
  ?? srcFrames(resolved generation)     // it's a video take → its real measured length
  ?? round(shot.dur * fps)              // authored intent
  ?? round(DEFAULT_SHOT_SECONDS * fps)  // 4, imported from backend/story.mjs — not restated
```

Every downstream consumer reads through that one function: `buildManifest`, `resolveShotMedia` (the ex-`shotsPayload`), the Story list's DUR column and runtime total, the Remotion handoff, `shots.csv`. **One displayed number, everywhere.**

**The reel never writes a shot record.** No unjournaled `patchShot`, no risk of a merge-mode breakdown clobbering your cut, and undo is a single reel-record undo. The reciprocal rule: **editing DUR in the Story list clears that shot's reel override** ("editing the duration in the shot list resets that shot to its authored length"). Upstream edit resets downstream. They can never disagree.

### Literal example

`workspace/projects/the-last-ferry/reel.md`

```markdown
---
project: the-last-ferry
fpsNum: 24
fpsDen: 1
width: 1920
height: 1080
tcStart: 0
targetFrames: 2160
omit: []
audio: ''
audioOffset: 0
timing:
  SH010:
    frames: 96
  SH020:
    frames: 55
    in: 12
    pinnedGen: gen-1784409911002-1
created: Jul 30, 14:02
createdAt: 1785412920000
updated: Jul 30, 16:41
updatedAt: 1785422460000
---
# Reel — the animatic for this project.
#
# Shot ORDER and PICTURE are deliberately NOT in this file. They live on the shots
# (shot.no, shot.selectedCandidate) and are joined at read time by backend/reel.mjs.
# `timing` is SPARSE: a shot with no entry derives its length from shot.dur (or, for a
# video take, from the measured length of the file). `pinnedGen` is a cache, never
# authority — it exists only so the reel can say "new take since you timed this".

| # | shot | tc in | frames | secs | state |
|---|---|---|---|---|---|
| 1 | SH010 | 00:00:00:00 | 96 | 4.00 | still |
| 2 | SH020 | 00:00:04:00 | 55 | 2.29 | clip · trimmed |
| 3 | SH030 | 00:00:06:07 | 96 | 4.00 | **slate** |

**247 frames · 00:00:10:07 · 10.29s @ 24 fps NDF · 1 shot unapproved**

## Reel log
- Jul 30, 14:02 — created @ 24fps 1920×1080
- Jul 30, 16:38 — SH010 96f (was 96f authored)
- Jul 30, 16:41 — SH020 55f in 12 · pinned gen-1784409911002-1
```

Twelve top-level keys plus a sparse map. `created`/`updated` are `stamp()` human strings; `createdAt`/`updatedAt` are the `Date.now()` sortable twins (the `backend/manual.mjs:135-136` house pair, and the fix for the mixed-timestamp wart on shot records). `patchReel` uses an explicit allow-list (the `UI_ALLOWED` pattern at `backend/index.mjs:231`) and `normalizeTiming()` **rejects unknown keys rather than spreading them** — the opposite of `backend/story.mjs:56`, which is why 46 live shot records carry `framing`/`code`/`seq`/`seqTitle` that nothing reads.

### What happens after the reel was built

| Event | Effect on the reel |
|---|---|
| **Shot reordered** (`no` rewritten, id stable — `story.mjs:75-94`) | Reel order follows on the next read. `timing` is keyed on shot **id**, and ids never change once written, so a reorder can never scramble timing. Nothing to sync |
| **Shot added** (manual, or a merge-mode breakdown) | Appears at its `no` position on the next read, as a slate if unapproved. No import step |
| **Shot re-rolled** | `rerollCandidate` writes a new generation with `parentGeneration` set and does **not** touch `selectedCandidate` (`backend/generate.mjs:367-377`). The reel is unchanged. Correct — a re-roll is not a decision |
| **A different take approved** | Picture re-points immediately. Timing is preserved. If the shot was hand-timed and `resolvedGen !== timing.pinnedGen`, the card draws a `--marked` edge and the header prints one line: *"SH020 — new take since you timed it."* No apply button, nothing to accept |
| **Selected take killed** | `syncShotSelection` clears `selectedCandidate` and demotes `done → review`. The reel falls back to any other kept/final take; if there is none the shot becomes a **slate at its stored length**. The runtime does not silently change |
| **Shot deleted** | `deleteShot` stages to trash and is restorable (`backend/index.mjs:419-422` restores id + no). Its `timing` entry is **kept, not GC'd**, so a restore brings the timing back. Orphans are inert and only cleared by an explicit "clean up" action |
| **fps changed** | `timing` frames are **re-scaled** (`round(f * newFps/oldFps)`) in the same write, with the before/after totals shown in a confirm. Never silently reinterpreted |

---

## The smart view — how approved shots lay themselves down

**The rule, in one sentence: the reel is `listShots(pid)` sorted by `no`, minus `omit[]`, with every shot present.**

There is no import, no "build from shots", no sync button, and no diff panel, because there is no stored ordered list that could drift. Press `a` on any project and it is already there.

### What counts as approved

Resolution reuses `resolveShotMedia(pid)` — the ex-`shotsPayload`, lifted into `backend/reel.mjs` in ticket A2 so the repo goes from two shot→media joiners to one:

1. **`shot.selectedCandidate`** → that generation's `file`. State `filled`. This is the real approval, written only by `syncShotSelection` (`generate.mjs:331-344`): *final + kept* sets it and flips the shot to `done`; a plain *keep* sets it only if the shot has none (first keep wins, later keeps never steal).
2. **Fallback**: any generation with `gen.shot === id` and `reviewState === 'kept' || final`, final sorted first (`index.mjs:834-838`). State `filled`, flagged `provisional` and drawn with a dotted edge — you kept it but never chose it.
3. **Nothing** → state `slate`.

**Legacy `shot.assets` is not consulted.** It is `[]` in all 84 live shot files and no code writes a non-empty value; carrying it forward would be inheriting dead weight.

### Where each shot's duration comes from

In precedence order, computed once per read as an **integer frame count**:

1. **`reel.timing[id].frames`** — you retimed it here. Wins over everything.
2. **The measured length of a video take** — if the shot resolves to a `.mp4` and you have not retimed it, the clip's real length wins. Laying a 5s Veo clip down as a 4s hold is a lie, and it is the exact gap `manifest.mjs:27` (`s.dur || 4`) has today. The card shows `3.7s · clip` so the source of the number is visible.
3. **`round(shot.dur * fps)`** — the AI breakdown's authored intent (`backend/groq.mjs:151` asks for 2–8s; `backend/story.mjs:53` defaults to 4).
4. **`round(DEFAULT_SHOT_SECONDS * fps)`** — imported from `backend/story.mjs`, not restated. This kills the duplicated literal `4` at `manifest.mjs:27` and `index.mjs:979`/`:987`.

Every value is clamped server-side to `[2, 60 * fps]`. **Two frames is the floor** because Resolve documents stills from XML as *"greater-than-one-frame-in-duration"* and rejects a single frame outright. Because we store frames and never touch `shot.dur`, we are free of the integer-seconds `min={1} max={60}` clamp at `frontend/Composer.jsx:557-565` — **a 12-frame flash cut is expressible**, which it is not if duration lives on the shot.

### Slates are in the cut

A shot with no approved take stays in the reel at its full length, drawn as a `--sunk` card with the shot id in mono accent and a clamped prompt in `--fg-faint`. It plays as a black slug with the shot id and prompt burned in, it exports as a **real clip pointing at a generated slate PNG**, and it counts toward the runtime. `buildManifest` keeps filtering to `selectedCandidate` for its own consumers; the reel does not. Stated once in the spec so two answers to "which shots are in the cut" never drift apart: **the manifest is a selects list, the reel is the film.**

---

## Surfaces

| File | Imports (shared, existing) | Net-new |
|---|---|---|
| **`shared/timecode.mjs`** *(new, ~70 lines)* | nothing | The only place a second becomes a frame. `RATES` — eight `[num, den]` pairs, each carrying its xmeml `timebase`/`ntsc`/`displayformat`, its FCPXML `frameDuration`, and a **`dfLegal` boolean the serialiser reads rather than decides** (DF is valid only at 30000/1001 and 60000/1001; 23.976 is *always* non-drop). Plus `framesFor`, `secs`, `tcStr`, `rationalStr`. In `shared/` because the ruler and the duration badge need identical math — `shared/integrations.mjs:5-7` explicitly calls the backend→`frontend/modelCatalog.js` import a wart new cross-cutting data must not repeat |
| **`backend/reel.mjs`** *(new, ~340)* | `readMd`/`writeMd`/`stamp`/`safe`/`safeScope`/`appendActivity` from `store.mjs`; `listShots` from `story.mjs`; `renderPath` from `generate.mjs`; `shared/timecode.mjs` | Three parts. (1) `resolveShotMedia(pid)` — `shotsPayload` **lifted verbatim** out of `index.mjs:811-846`, with its render paths routed through `safeScope(pid)` (`index.mjs:814` currently uses a raw `pid`, unlike `generate.mjs:25`). Joiners go 2 → 1. (2) `buildReel`/`getReel`/`patchReel`/`normalizeTiming` — allow-listed patch, defaults applied here and nowhere else. (3) `registerReelRoutes(app, { reveal })` — express deps **injected**, never imported (`backend/manual.mjs:502` pattern) |
| **`backend/probe.mjs`** *(new, ~60)* | `videoTools()` from `video.mjs` (one-word export) | ffprobe once per generation, memoised on `path + mtime`, persisting `srcFrames`/`srcFps`/`srcW`/`srcH` onto the **generation record**. Not a new source of truth — `generate.mjs:276` already persists `width`/`height` for images, and `backend/imageSize.mjs:51-52` explicitly declines MP4 (*"not worth parsing here"*). This completes an existing field rather than adding one, and it is what makes video export correct at all |
| **`backend/reelExport.mjs`** *(new, ~300)* | `shared/timecode.mjs` | `reelToTimeline(reel)` → one internal model; `toXmeml(tl)` and `toFcpxml(tl)` as pure `(model) → string`. Zero fs, zero express — so golden tests need no server and no temp root |
| **`backend/reelPack.mjs`** *(new, ~170)* | `sharp` (already a dependency) | The conform pack. `media/` populated by **copy** (hardlink within a volume), WEBP transcoded to PNG, per-clip absolute paths pointing **into the pack**. `CONFORM.md`. `preflight(pid)` — the structural check that runs before any write |
| **`backend/reelRender.mjs`** *(new, ~240)* | `videoTools()` from `video.mjs`; `writeGen` from `generate.mjs` | Two-pass ffmpeg, per-segment cache, in-memory job table + polled progress copied from `backend/video.mjs:115-137` including its explicit `startedAt` field |
| **`frontend/Reel.jsx`** *(new, ~430)* | `Btn`, `Card`, `Empty`, `Eyebrow` from `./ui` — **finally adopting three primitives with zero importers app-wide** (`docs/COMPONENTS.md:70-74`); `MediaAction` and `mediaKind` from `./RenderMedia`; `Chip` from `./GenerationControls` (**exported in this ticket** rather than typing a 40th copy — `GenerationControls.jsx:37` and `SchemaForm.jsx:47` are byte-identical and unexported); `ContextMenu` from `./ContextMenu`; `MONO` from `./tokens`; `sx` from `./sx`; `resolveKeys`/`keyLabel` from `./keymap` | Shell is `ShotWorkspace.jsx:321` verbatim — `position:fixed;inset:0;z-index:60;background:var(--void);animation:dl-in .14s ease-out`. Four bands: one dense header row (mono accent project name · tabular `00:00:10:07 / 00:01:30:00 −79:17` · `24 fps · 1920×1080` · export menu · 9px mono key legend · exits at `margin-left:auto`), the pace bar, a `flex:1;min-height:0` canvas stage on `--sunk`, and the strip. Capture-phase keydown that **bails on `app.state.paletteOpen`** — the defect `docs/COMPONENTS.md:238` records against ShotWorkspace, fixed rather than inherited |
| **`frontend/Scrub.jsx`** *(new, ~70)* | — | `<Scrub value max onSeek onCommit>{children}</Scrub>`. Pointer capture + `touch-action:none` + `userSelect` guard, and PanelSplitter's two-callback contract (`PanelSplitter.jsx:38-58`: live `onSeek`, single `onCommit` on pointerup). Adds what `ThreeDStage.jsx:739-758`'s inline lane lacks — `role="slider"`, `aria-valuenow/min/max`, arrow keys. **Exported**, so A13 can migrate ThreeDStage and the `App.jsx:2219` transport rail onto it: three scrubbers become one |
| **`frontend/reelClock.js`** *(new, ~140)* | — | Pure JS, no React, unit-testable. `bitmapCache` (pixel-budgeted LRU, mandatory `.close()`) and `createEngine()` |
| **Card visual** *(inside Reel.jsx)* | — | **Width ∝ frames, clamped to `[72px, 240px]`.** Thumbnail pinned flush-left at full saturation; the remaining width filled with a darkened, desaturated extension of the same image so the card reads as a **held frame**, not a repeated filmstrip. Duration drawn on the card at every size, degrading `2.29s` → `2.3` → nothing. Selection is a 1.5px inset accent ring + 6% `--accent-05` wash and **never** changes the card's size or position |
| **Edits** | | `backend/index.mjs` +8 (register at :185-199; `domainFor` gains `/api/reel → ['shots']`; delete `shotsPayload`, point its three callers at `resolveShotMedia`; **fix `REMOTION_TEMPLATE`'s `f.path` at `:976`/`:989` — `shotsPayload` emits `f.file` at `:820`/`:829`/`:837`, so local-file playback in the shipped starter comp has never worked**). `backend/manifest.mjs` −12/+8 (read duration + in/out through the reel; retire `savedEntries()`; `setInOut` writes reel timing). `backend/video.mjs` +1 (`export const videoTools`). `frontend/api.js` +7. `frontend/Story.jsx` +12 (header button, `a` key, DUR-clears-override). `frontend/App.jsx` +4 (`{S.reel && <Reel …/>}` beside `App.jsx:1271`'s overlay mount — **no nav slot** (the bar is capped at five, `App.jsx:1422`), no breadcrumb ternary, no shell decision). `frontend/keymap.js` +2. `shared/integrations.mjs` +14 |

No `ComposerDock` — the Reel does not generate.

---

## Keymap

Capture-phase, so it beats `App.onKey`'s bubble listener (`App.jsx:236`, registered without `true`). Bindings resolve through `resolveKeys(app.state.settings)` (`keymap.js:41-46`); every hint chip renders through `keyLabel()` (`keymap.js:49`) so it does not lie after a rebind. The typing guard is `App.jsx:1095-1099` **copied verbatim** including the `SELECT` branch — `docs/COMPONENTS.md:269` counts 11 sites with 5 incompatible predicates and this must not become the sixth.

### Two new rebindable rows in `KEY_ACTIONS`

| id | def | ctx | label |
|---|---|---|---|
| `reel` | `a` | Project | open the Reel (animatic) |
| `reelExport` | `e` | Reel | write the conform pack |

Reused, not redeclared: `play` (Space), `kill` (`x` → omit from the cut), `undo` (`u`), `help` (`?`).

### Reel-local fixed keys

| Key | Action | Why |
|---|---|---|
| `Space` | play / pause | Absolute across Premiere, Resolve, FCP |
| `J` `K` `L` | shuttle rev / stop / fwd, 1×→2×→4× on repeat | The industry triplet, and the tell that a tool was built by someone who edits. Stop at 4× — nobody shuttles a 20-second reel at 32× |
| `/` | play around playhead (−2s → +2s, playhead returns) | Resolve + FCP. ~20 lines, and it is how you actually judge whether a cut lands. Almost nothing outside a pro NLE ships it |
| `↑` `↓` | previous / next shot (moves selection **and** playhead) | Universal as prev/next edit point, and it maps exactly onto the only structural unit here |
| `←` `→` | ±1 frame | Absolute muscle memory |
| `Shift+←` `Shift+→` | ±1 second | Resolve's choice over Premiere's ±5 frames — animatics are thought about in seconds |
| `Home` `End` | start / end of reel | Universal |
| `I` `O` / `Opt+X` | set / clear **loop** in-out | Labelled LOOP, not RANGE. With no source monitor there is no three-point editing, so I/O scopes looping and range ops — a better use of two keys everyone already knows |
| `Shift+Space` | toggle loop (default ON) | |
| `[` `]` | −/+ 12 frames on the selected shot | Browser key-repeat gives hold-to-ramp free. Self-inverse. Shows the live runtime delta (`2.3s +0.5 · total 00:00:10:07 →`) so the effect is never a surprise |
| `,` `.` | ∓1 frame | Toon Boom's "Add/Remove Frame to Panel" |
| `0`–`9`, `.` | begin inline duration entry on the selected card | The precise retime. Typing `2.5` is four keystrokes and exact; dragging to 2.5s at 15px/second is not achievable. Digits are `RESERVED` globally (rating) and claimed here as a local fixed key, exactly as this overlay claims `Escape` |
| `Enter` | commit entry **if one is in flight**, else open the shot in `ShotWorkspace` | Modal-free disambiguation, no mode indicator. The second behaviour is the killer loop: feel the pacing → "that shot is wrong" → one key → the existing shot editor → Esc back |
| `Esc` | cancel entry → else stop playback → else close | Three-level. Never navigates while a field has focus |
| `x` (`K.kill`) | omit / un-omit from the cut | Never deletes the shot, never touches its status. Press again to restore |
| `t` | equalize — every shot to the selected shot's length | One line of code, used far more than it deserves |
| `f` | fit — scale all lengths to `targetFrames` or the audio | Rewrites everything in one gesture, so it shows before/after totals and needs `Enter` to confirm |
| `m` | marker at playhead (works during playback) | Universal. This is the muscle memory tap-to-time hijacks in A12 |
| `Shift+Z` / `\` | fit whole reel / fit loop range | `Shift+Z` is 2-of-3; `\` is Premiere's. Both idioms, two related commands |
| `Shift+Cmd+E` | render mp4 | |
| `Cmd+Z` / `Cmd+Shift+Z` | undo / redo | Journalled — see Playback/Risks |

**Deliberately absent:** zoom keys (fixed-density strip, nothing to zoom), a snapping toggle (positions are derived; there is nothing to snap to — which is what frees `s` and `n` if ever needed), blade/split (a still has no in/out), tool modes.

**Declared collisions:** `t` (goTools), `f` (feedback), `m` (openMemory), `e`, `i`, `o` are global bindings that the Reel shadows while open — the same precedent as `ShotWorkspace` shadowing `k/x/l/r`. `Esc` exits and the header legend is permanent.

---

## Playback

**One `<canvas>`, one rAF loop, clock derived not accumulated, `ImageBitmap` LRU. Silent in the first playback slice.**

**The failure mode we are designing against is a visible hitch at exactly the moment of a cut** — the one frame where the eye is already looking. Everything below follows from that.

**Why not swap `<img>` elements.** You get no control over when the browser paints, cuts land whenever the compositor decides, you cannot guarantee a decode has finished, and the burn-in becomes a separate DOM layer that can tear away from the image mid-cut.

**Decode.** `createImageBitmap(blob, { resizeWidth: 1280, resizeQuality: 'high' })` → LRU → `ctx.drawImage`. Reported measurements on this hardware: `createImageBitmap` ≈ 14.3ms median / 15.0 p95; `drawImage(ImageBitmap)` ≈ 0ms and **synchronous**; `HTMLImageElement.decode()` ≈ 16.7 median but **33.3 p95** — a spike inside a 41.67ms frame budget. *These numbers are third-party measurements, not from this repo* — **A7 lands `scripts/bench-decode.mjs` first** and we tune the cache from the result rather than from a claim.

You decode one image per **shot** (every 1–4 seconds), not per frame, so the per-frame budget is essentially untouched. LRU budgeted in **pixels** — a resized bitmap is ~3.7 MB, a full 1080p one 8.3 MB — capped at 40 entries with a **mandatory `.close()` on eviction**; these are not promptly GC'd and leaking them is how a renderer reaches gigabytes. Prefetch window `[i−1 … i+3]`, decoded in a Worker and `postMessage`'d back (Transferable, zero copy).

**The clock.** rAF is the **pacer**, never the clock, and we use the `timestamp` *argument* the callback receives, not `performance.now()` inside the body.

```js
const elapsed = () => playing ? (now() - startClock) + startOffset : startOffset;
const frame   = Math.min(total - 1, Math.max(0, Math.floor(elapsed() * fps)));
const shot    = binarySearch(cumulative, frame);   // never a linear scan
```

The frame index is a **pure function of a monotonic clock**. A dropped tick, a GC pause, or a 120 Hz ProMotion display changes how *often* we sample, never *where* we land — accumulated error over a two-minute reel is exactly zero by construction. There is no mutable `currentFrame` anywhere. Never `await` inside the callback: a missing bitmap draws the previous frame (invisible); a stalled loop is not.

**Silent first.** `AudioContext.currentTime` is the only clock that cannot drift against what the user hears; driving stills off `performance.now()` while audio plays off the audio device separates them measurably (~−156 ppm ≈ −19ms over two minutes, far worse on Bluetooth). Rather than build AudioContext plumbing before there is any audio to play, we ship silent — a silent pacing check is a real pacing check, and Storyboard Pro's own loop is adjust-then-play. A12 adds it properly, alongside the feature that needs it, with a **~2 second warm-up before trusting the clock** (measured cold it reports two orders of magnitude off — a startup transient, not drift).

**Still → video transition (A9).** Two stacked `<video>` elements above the canvas, `visibility:hidden` when idle — **never `display:none`**, which stops compositing so the element will not decode or fire `rVFC`. During the *previous* shot the idle element sets `.src`, awaits `loadeddata`, sets `.currentTime` to `in/fps`, awaits `seeked` (reported 10.9ms median, 0.000ms error at frame boundaries). At the cut, swap `visibility` and `play()`. Clips are muted (the audio bed is master, and muted dodges autoplay blocking). `requestVideoFrameCallback` is a **watchdog only** — nudge `currentTime` if `mediaTime` diverges by more than ~2 frames; correcting every frame stutters.

**No WebCodecs.** It solves frame-exact access to compressed video, which `<video>` already provides here, and the cost is owning mp4 demuxing (no browser demuxer exists), keyframe seeking, decode-vs-presentation ordering, and `VideoFrame` lifetimes where one missed `.close()` stalls the decoder permanently.

**Occlusion.** rAF and rVFC both stop entirely in a hidden or occluded Electron window. `visibilitychange` forces a recompute from the clock rather than assuming the loop kept ticking.

---

## Export

### Order and reasoning

**1st — FCP7 xmeml v5 (`.xml`), in slice 1.** The only timeline interchange Adobe Premiere Pro imports — still true in 2026; Premiere has never read `.fcpxml`, and Adobe's own help page points users at a third-party converter. DaVinci Resolve 20.3.2's binary contains the literal string *"DaVinci Resolve supports Final Cut Pro 7 XML version 4 and 5."* One file, two of three target NLEs, zero dependencies.

**2nd — FCPXML 1.10 (`.fcpxml`), A10.** Non-negotiable if "opens in Final Cut" matters, because modern Final Cut **cannot read xmeml at all** (FCP 12.3 registers only `.fcpxml`/`.fcpxmld`). 1.10 threads the needle: ≥1.9 for `<media-rep>`, ≤1.13 because that is Resolve 20.3.2's ceiling. Reuses the frame engine wholesale.

**3rd — mp4, A11.** The review deliverable.

**Never — AAF, EDL, OTIO.** AAF is a binary compound-file container with no Node writer in existence (`npm search aaf` returns zero authoring libraries; the only practical writer is Python's pyaaf2). EDL structurally cannot carry a file path — an 8-character reel id plus a `* FROM CLIP NAME:` comment — so it cannot deliver an animatic of stills to a fresh project. OTIO is cheap and Resolve reads it natively, but Premiere and Final Cut cannot, and nobody documents an OTIO still-image convention. We name our persisted fields after OTIO's schema instead, which costs nothing and makes an exporter a mapping exercise if it is ever wanted.

### The conform pack — not a bare XML

```
workspace/projects/<pid>/cuts/animatic-export/
  animatic.xml          FCP7 xmeml v5   → Premiere, Resolve
  animatic.fcpxml       FCPXML 1.10     → Final Cut Pro, Resolve   (A10)
  animatic.mp4                                                     (A11, optional)
  media/                COPIED, not symlinked
    001_SH010_heron-stalking-the-empty-pier.png
    002_SH020_ferryman-counts-coins.mp4
    003_SH030_SLATE.png
  CONFORM.md
```

Every interchange file points **into `media/`**, so the pack survives being emailed, dropped on a shuttle drive, or opened under another account. This is the single decision that determines whether an editor relinks or throws the file away. `media/` is **copied** (hardlinked within a volume), never symlinked — `manifest.mjs:59-79`'s symlink-first trick is right for a local `selects/` folder and wrong here, because `cp -R`, `rsync` without `-L` and `ditto` all preserve symlinks and the pack arrives with dangling links into a workspace the recipient does not have. `diskBytes` is reported.

**WEBP is transcoded to PNG** with `sharp` (already a dependency). Resolve's supported still list from XML is TIF/JPG/PNG/DPX/TGA/DNG; FAL image endpoints return `.webp` regularly and `generate.mjs:255-258` writes the provider extension verbatim, so without this every webp still imports offline with no error.

**`CONFORM.md`** carries: which file to open in which app; the sequence header (24 fps NDF, 1920×1080, total as both timecode and frames); the clip table (`# | shot | tc in | frames | secs | kind | source | model | seed`); a **MISSING section** listing every slate with its shot id and prompt, so the holes are obviously deliberate; and one paragraph naming the relink folder.

**Preflight (`v`, and automatic before every write)** — file-id reuse, even dimensions, ≥2 frames, path-encoding round-trip, DF legality, missing media, hollow `<samplecharacteristics>`. Premiere's XML importer fails with a crash or an empty sequence and **no message**, so a check that runs before writing is worth more than a check that runs after.

### Correctness rules the golden tests pin

1. **Frames only.** `shared/timecode.mjs` is the one place a second becomes a frame.
2. **Per-segment percent encoding.** `p.split('/').map(seg).join('/')` where `seg = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%'+c.charCodeAt(0).toString(16).toUpperCase())`. Never `encodeURI()` over the whole path — it leaves `#` and `?` unescaped and truncates the URL. `file://localhost/` for xmeml (what genuine FCP7 exports and Adobe both emit); `file:///` for FCPXML. A single unescaped character does not throw: the clip imports **Media Missing**.
3. **File-id reuse.** The first `<clipitem>` referencing a file carries the full `<file id="file-1">…</file>`; every later reference is a bare `<file id="file-1"/>`. Repeat it and Premiere mints duplicate unlinked master clips.
4. **`end` and `out` are exclusive**, and `out − in === end − start` always — free here, because both derive from one `frames` value.
5. **Stills.** `<stillframe>TRUE</stillframe>`; the file's `<rate>` is the **sequence's** rate; file `<duration>` equals the cut length; `<samplecharacteristics><width>/<height>` present (without dimensions the still imports offline); and **no `<timecode>`, no `<media><audio>` block, no `<link>`** — an audio block on a still file makes Premiere mint one empty phantom audio clip per image.
6. **Dimensions are real.** `srcW`/`srcH` come from `imageSize` for stills and from `backend/probe.mjs` for video. Never a hollow element.
7. **`out` never exceeds `srcFrames`.** Clamped at write, warned in preflight.
8. **NDF unless `dfLegal`.** Never `<ntsc>TRUE</ntsc>` with `<timebase>25</timebase>`.
9. **`tcStart`** emitted as the sequence `<timecode>`, so a reel conformed against a delivery starting at 01:00:00:00 is not an hour off.
10. **Dissolves export as hard cuts in v1**, stated in CONFORM.md. A real dissolve needs handles on both sides of the boundary; a still with `in=0 out=len` has none, and shipping a transition that imports as a freeze or is refused outright is worse than shipping an honest cut. `shot.transition` rides along as clip metadata.

### Real minimal xmeml — two stills at 24 fps

**A 4-second still at 24 fps is 96 frames.** `start=0, end=96` (exclusive), `in=0, out=96`, so `out − in === end − start`. The next clip starts at 96.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="frameforge-reel">
    <name>the-last-ferry — animatic</name>
    <duration>144</duration>
    <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
    <timecode>
      <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
      <string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat>
    </timecode>
    <media>
      <video>
        <format><samplecharacteristics>
          <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
          <width>1920</width><height>1080</height>
          <anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio>
          <fielddominance>none</fielddominance><colordepth>24</colordepth>
        </samplecharacteristics></format>
        <track>
          <clipitem id="ci-1">
            <name>SH010</name><enabled>TRUE</enabled>
            <duration>96</duration>
            <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
            <start>0</start><end>96</end><in>0</in><out>96</out>
            <stillframe>TRUE</stillframe>
            <logginginfo>
              <description>Wide. Heron stalking the empty pier.</description>
              <scene>1</scene><shottake>010</shottake>
              <lognote>fal-ai/flux-pro · seed 1234567</lognote>
              <good>TRUE</good>
            </logginginfo>
            <comments>
              <mastercomment1>SH010</mastercomment1>
              <mastercomment2>a heron stalks the empty pier at dusk, 35mm</mastercomment2>
            </comments>
            <file id="file-1">
              <name>001_SH010_heron-stalking-the-empty-pier.png</name>
              <pathurl>file://localhost/Users/theova/.../animatic-export/media/001_SH010_heron-stalking-the-empty-pier.png</pathurl>
              <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
              <duration>96</duration>
              <media><video><samplecharacteristics>
                <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
                <width>1920</width><height>1080</height>
              </samplecharacteristics></video></media>
            </file>
            <sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
          <clipitem id="ci-2">
            <name>SH030 — MISSING</name><enabled>TRUE</enabled>
            <duration>48</duration>
            <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
            <start>96</start><end>144</end><in>0</in><out>48</out>
            <stillframe>TRUE</stillframe>
            <comments>
              <mastercomment1>SH030</mastercomment1>
              <mastercomment2>NO APPROVED TAKE — the pier lights cut out, black water</mastercomment2>
            </comments>
            <file id="file-3">
              <name>003_SH030_SLATE.png</name>
              <pathurl>file://localhost/Users/theova/.../animatic-export/media/003_SH030_SLATE.png</pathurl>
              <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
              <duration>48</duration>
              <media><video><samplecharacteristics>
                <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
                <width>1920</width><height>1080</height>
              </samplecharacteristics></video></media>
            </file>
            <sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
          <enabled>TRUE</enabled><locked>FALSE</locked>
        </track>
      </video>
    </media>
  </sequence>
</xmeml>
```

**Verified vs assumed.** Verified against primary sources on this machine: Apple's FCPXML DTDs shipped inside Final Cut Pro 12.3 (`Interchange.framework`, v1.0–1.14, xmllint-validated); Resolve 20.3.2's own manual and binary strings (xmeml v4/v5, FCPXML 1.3–1.13, the still-image format list, the greater-than-one-frame rule); FCP 12.3's `Info.plist` registering only `.fcpxml`/`.fcpxmld`; two genuine FCP 7 exports and one genuine FCP 10.6 FCPXML on disk for path form and element ordering. **Assumed and requiring a human to click once:** that Premiere Pro 2026 imports this specific document cleanly, and that Resolve's xmeml importer relinks from the copied `media/` folder without prompting. Premiere is not installable in CI and its importer fails without a usable error, which is why preflight + a committed golden fixture exist — but the first real import is a manual gate before A5 is called done.

---

## mp4 render

**Two-pass normalise-then-copy, native ffmpeg, per-segment cache.**

### Pass 1 — one segment per shot

```
ffmpeg -v error -loop 1 -i media/001_SH010_....png \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,\
pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,\
drawtext=fontfile=/System/Library/Fonts/Menlo.ttc:textfile=/tmp/lbl001.txt:\
x=48:y=h-70:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14,\
format=yuv420p" \
  -r 24 -fps_mode cfr -c:v libx264 -profile:v high -level 4.1 -crf 18 \
  -preset veryfast -pix_fmt yuv420p -an -video_track_timescale 12288 \
  -frames:v 96 -y seg/000.mp4
```

Video takes are the same command with `-ss <in/fps> -i <clip>` instead of `-loop 1`. Slates use `-f lavfi -i color=c=0x0B0C0E:s=1920x1080:r=24` plus the same `drawtext`.

Four landmines, all of which **fail silently at exit code 0**:

- **`-r` + `-fps_mode cfr` as an OUTPUT option, never an `fps=24` FILTER.** Our stills come from different models at different aspect ratios; with mixed input sizes ffmpeg reconfigures the filtergraph and the `fps` filter loses state — a reported case where a 216-frame/9s timeline came out as **96 frames / 4s with the first two images missing entirely**. Output-side conversion survives reinit.
- **`-frames:v N`, never `-t seconds`.** Three 1s stills at 24 fps: `-t 3` → 71 frames / 2.958333s; `-frames:v 72` → exactly 72 / 3.000000s.
- **`setsar=1` is not optional.** Without it a source with non-square pixels renders stretched even though the dimensions look right.
- **A wrong `fontfile` path does not fail.** With fontconfig compiled in it exits 0 and silently renders in a different typeface. Validate with `fs.existsSync` and fall back deliberately. Labels go through `textfile=` so user-authored shot names containing colons and apostrophes need no escaping.

Encoder params are pinned explicitly (`-profile:v high -level 4.1 -pix_fmt yuv420p -video_track_timescale 12288`) because `-c copy` concat requires matching codec, profile, level, pix_fmt, dimensions, SAR, rate and timebase. Note `-video_track_timebase` does not exist in ffmpeg 8 — the mp4 muxer option is `-video_track_timescale`. libx264 + yuv420p hard-fails on odd dimensions, which the fixed even canvas plus `pad` already prevents.

Segments are cached under `<root>/reel-cache/<pid>/`, keyed on a djb2 of `(file, frames, in, fps, w, h, burnIn)`. Regenerate one image → re-encode one segment.

### Pass 2 — concat + mux

```
# seg/list.txt — no duration directives at all
file '/abs/.../seg/000.mp4'
file '/abs/.../seg/001.mp4'
file '/abs/.../seg/002.mp4'
```

```
ffmpeg -v error -f concat -safe 0 -i seg/list.txt -i media/vo.m4a \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -af apad \
  -frames:v 144 -movflags +faststart -progress pipe:1 -stats_period 0.2 -y out.mp4
```

**The trailing-duration gotcha, and why we avoid it by construction.** The naive approach is a concat list of raw images with `duration` directives:

```
ffconcat version 1.0
file '/abs/SH010.png'
duration 4
file '/abs/SH030.png'
duration 2
file '/abs/SH030.png'      ← last file REPEATED, no duration line
```

The demuxer **does not apply the last entry's `duration`** — verified by dumping packets: a 2/3/4s list emits pts 0.000, 2.000, 5.000 with a final packet duration of 0.04s. And it is worse than the folklore: with an `fps` filter in the chain ffmpeg EOF-extends the final frame by the *previous* inter-frame gap, so that list renders as 8.000s, not 9.000s, silently. Repeating the last file fixes the length but then **overruns** to 13.000s, because the trailing entry is itself EOF-extended. The complete fix is: repeat the last file with no duration line **and** bound with `-frames:v round(total_seconds * fps)`.

We sidestep all of it: pass 1 gives every segment an exact length via `-loop 1 -frames:v`, so the pass-2 list carries **no duration directives at all** and there is nothing to extend. `-frames:v <total>` stays as belt and braces. Concat-list paths are single-quoted with `'` escaped as `'\''` — unescaped, the path silently truncates at the apostrophe and ffmpeg reports "Impossible to open".

`-af apad` pads audio with silence so a short bed cannot truncate the picture. `+faststart` moves the moov atom forward so the file scrubs immediately.

### Progress, output, degradation

`-progress pipe:1 -stats_period 0.2` on **stdout**, leaving stderr for real errors. **`out_time_ms` is MICROseconds** — byte-identical to `out_time_us` — so divide by 1e6; dividing by 1e3 gives a bar that finishes at 0.1%. Weight the bar across pass-1 segments; pass 2 is a stream copy and jumps straight from ~98% to 100%. Job table, TTL sweep and the explicit `startedAt` field are copied from `backend/video.mjs:115-137` and `:211-216` — including the fix for the bug its own header comment records, where an id-derived timestamp meant the sweep never fired and every abandoned job leaked a full download. Keep the child handle so cancel is `SIGTERM` + delete the partial. Polled at `GET /api/reel/:pid/render/:jobId` every 1000ms — **not** SSE, whose payload is `{rev, domains}` by design.

**The mp4 becomes a real generation record.** Nothing in FrameForge lists `renders/` by directory — the UI reaches media exclusively through generation records. `reelRender` writes a `gen-reel-<ts>.md` with `provider: 'reel'`, `model: 'reel'`, `cost: 0`, `status: 'done'`, `reviewState: 'new'`, `shot: null` (the `backend/manual.mjs:445-469` precedent), writes the file with the exclusive-create `{flag:'wx'}` loop from `generate.mjs:158-166`, and calls **`bump(['generations'])` explicitly** — a background worker writing outside the HTTP cycle never reaches the `res.on('finish')` middleware at `index.mjs:132` and would otherwise wait on the indexer's ~400ms `fs.watch` debounce.

**No ffmpeg → the Render button is disabled, not failing**, with the house message style: *"ffmpeg not found — install with: brew install ffmpeg"* plus the `FRFG_FFMPEG` override hint and a manual re-check (the resolver memoises negatives for the process lifetime, `video.mjs:15,28`). Playback and XML export never touch a binary, so a user without ffmpeg still storyboards, still feels the pacing, and still hands a timeline to their editor. **Not ffmpeg.wasm** (files are already local, ~2 GB heap ceiling, most builds ship without libx264 so H.264 is unavailable, 5–20× slower). **Not MediaRecorder** — this repo already rejected it twice in writing, at `frontend/ThreeDStage.jsx:367-368` and `backend/threed.mjs:120-121`, and "some embedded browsers" means Electron.

---

---

## STATUS (2026-07-30)

**A1–A11 shipped.** `shared/timecode.mjs`, `backend/reel.mjs` (record + the one shot→media joiner
+ routes), `backend/probe.mjs`, `backend/reelExport.mjs` (xmeml + FCPXML + preflight),
`backend/reelPack.mjs` (conform pack), `backend/reelRender.mjs` (two-pass ffmpeg mp4),
`frontend/reelClock.js`, `frontend/Scrub.jsx`, `frontend/Reel.jsx`, wired into Story (`a`) and
`frontend/keymap.js`. 415 tests green.

Verified in a running app against an isolated datastore: the strip lays down approved shots with
proportional cards, playback advances exactly 24 frames/sec at 24fps and pauses clean, `[`/`]`
hold-to-ramp accumulates, retimes persist as `timing`, export writes both XMLs (xmllint-clean)
with a slate for every hole, and the mp4 renders with an ffprobe-verified exact frame count.

**Never verified: neither `animatic.xml` nor `animatic.fcpxml` has been opened in Premiere,
Resolve or Final Cut.** That is the one gate tests cannot close and it remains the manual check
before this is trusted.

Bugs found and fixed while building: `rateOf()` was not idempotent (every non-24fps reel computed
its seconds and timecode at 24); the shipped Remotion starter read `f.path` while the payload
emitted `f.file`, so its local-file branch had never worked; the joiner built render paths from a
raw `pid` instead of `safeScope(pid)`; `[`/`]` key-repeat coalesced because each press recomputed
from a round-trip that had not returned; and a throw inside the playback draw escaped `tick()`
before it rescheduled, killing playback forever while the derived clock kept advancing.

**Open:** A12 (audio + tap-to-time — deferred by the user). A13 (three scrubbers → one) skipped to
avoid colliding with concurrent edits in `ThreeDStage.jsx` / `App.jsx`.

---

## DECISIONS (locked 2026-07-30 by the user)

| Question | Answer |
|---|---|
| Where to start | **Slice 1 — export first (A1–A5).** No editor UI. Ships an Export button on the Story page producing a pack that opens in Premiere/Resolve |
| Scratch audio + tap-to-time | **Later.** Ship silent. A12 stays designed-for but unbuilt; the clock is built so adding audio is not a rewrite |
| Does the reel write back to `shot.dur` | **No.** `shot.dur` stays authored intent; the reel holds the cut length in integer frames. The reel never writes a shot record |
| Length of a video take | **Its real measured length** (ffprobe). A 5s clip occupies 5s; the reel's runtime may differ from the Story list's estimate |

Remaining open calls (defaults stand unless changed): frame floor 2; copy-not-symlink in the pack;
letterbox mixed aspects in the strip; normalise video takes when `srcFps !== fps` and ffmpeg is present.

## Build order

**Slice 1 = A1 → A5.** After it, with no editor UI at all, the user can press **Export animatic** on the Story page and get a folder they can email to an editor: `animatic.xml` opens in Premiere or Resolve with every approved shot laid out in order at the right length, shot numbers drawn on the clips, prompts in the comment columns, black slates at the correct duration for shots not yet approved, and a copied `media/` folder beside it so nothing goes offline on another machine. **Slice 2 = A6 + A7**, which is what they see.

| # | Title | What ships | Demo | Size |
|---|---|---|---|---|
| **A1** | Frame math | `shared/timecode.mjs` — `RATES` (8 pairs with `dfLegal`), `framesFor`, `secs`, `tcStr`, `rationalStr` | `node --test tests/phase-reel-timecode.test.mjs`: 4s = 96f at both 24 and 23.976, 100 at 25, 120 at 30 and 29.97, 240 at 60 and 59.94; DF refused at 23.976/24/25/30/50 | 70 + 120 test |
| **A2** | One joiner | `shotsPayload` lifted into `backend/reel.mjs` as `resolveShotMedia`; `safeScope` fix at `index.mjs:814`; manifest + `/api/remotion/open` + `/api/export/:pid` repointed; `REMOTION_TEMPLATE` `f.path` → `f.file` fixed | Full suite green; `GET /api/manifest/:pid` byte-identical before and after. Joiners 2 → 1 **before** any feature lands | +130 / −52 |
| **A3** | Measure the media | `backend/probe.mjs`; `export const videoTools` in `video.mjs`; `srcFrames`/`srcFps`/`srcW`/`srcH` persisted on generation records | `resolveShotMedia` on a project with an mp4 returns real dimensions and a real length where `imageSize` returns null | 60 + 40 test |
| **A4** | The reel record | `reel.md`, `buildReel`/`getReel`/`patchReel`/`normalizeTiming`, `GET|PATCH /api/reel/:pid`, `domainFor` row, api.js wrappers | Curl a real project: ordered reel, integer `startFrame`s, correct `totalFrames`, slates present, omits excluded; a PATCH with a junk key writes nothing; a `frames: 250` is clamped with a readable warning | 200 + 180 test |
| **A5** | **xmeml + conform pack** | `reelExport.toXmeml`, `reelPack` (copy `media/`, WEBP→PNG, slate PNGs, `CONFORM.md`), `preflight`, `POST /api/reel/:pid/export`, one button on Story | **Slice 1.** Export, then open the pack in Premiere and in Resolve — the whole reel is there, correct lengths, shot numbers on the clips, holes visible and named | 400 + 180 test |
| **A6** | The strip | `Reel.jsx` shell + proportional cards + header runtime; `Scrub.jsx` + pace bar; `a` from Story; Esc to close. Read-only | Press `a`: the whole approved reel is already laid down, in order, at the right widths. No import step to demo — there is none | 380 |
| **A7** | Play | `reelClock.js` (bench first, then bitmap cache + engine), canvas stage, Space / ↑↓ / ←→ / Home / End / `/` / loop. Stills, silent | Hit Space and feel the pacing with no startup latency | 270 |
| **A8** | Retime | `[`/`]`, digit entry, `x` omit, `t` equalize, `f` fit-with-confirm; **server clamp in this ticket, not later**; every reel write journalled with a `before` block so `POST /api/actions/:id/undo` works | Retime a 20-shot reel in 30 seconds without the mouse; Cmd+Z lands back exactly, playhead and selection restored | 160 |
| **A9** | Video takes | Two stacked `<video>` A/B roll, seek-and-pause preload, rVFC watchdog | A reel mixing stills and Veo clips plays through with no hitch at the boundaries | 110 |
| **A10** | FCPXML 1.10 | `toFcpxml` — rate-undefined `<format>`, `duration="0s"` asset, `<video>` never `<asset-clip>`, `<media-rep>` not `src=`, deterministic `@uid`, `<note>` before `<marker>` | Import into Final Cut Pro. Golden test asserts **zero `src=` attributes on any `<asset>`** — the single most expensive mistake in the format | 180 + 100 test |
| **A11** | mp4 | `reelRender.mjs`, segment cache, polled progress, generation record + explicit `bump`, honest disable without ffmpeg | A 90s reel renders in seconds, appears in the app like any other render, verified with `ffprobe -count_frames` — never by trusting the exit code | 240 + 90 test |
| **A12** | Audio + tap-to-time | AudioContext master with warm-up, peak-pyramid waveform in the same x-space, then `t`: play the VO and tap Space through the reel, into a **pending** layer with a before/after diff, 100ms anticipation offset, punch-in from the loop point, one undo step | Time an entire reel to a scratch VO in one real-time pass. **No mainstream storyboard tool ships this** — Toon Boom, Boords and Storyboarder all require typing or dragging one panel at a time, while every NLE already supports tapping `M` live. The gesture is universal; nobody has closed the loop | 260 |
| **A13** | Cleanup | Migrate `ThreeDStage.jsx:739-758` and the `App.jsx:2219` transport rail onto `Scrub.jsx`; migrate `threed.mjs:141`'s bare `execFile('ffmpeg')` onto `videoTools()` | Three scrubbers become one; two ffmpeg discovery strategies become one | 60 / −90 |

Slice 1 ≈ **860 lines of code, 520 of test.** Everything through A10 — a keyboard-driven animatic that plays, retimes, and hands a built timeline to Premiere, Resolve and Final Cut — is **under 2,000 lines.** Calibration: `frontend/ShotWorkspace.jsx` is ~700 lines for one full-screen keyboard-first surface with no drag, no zoom and no playback engine; `backend/manual.mjs` is 583 for a complete feature with a route block.

---

## What we are NOT building

| Cut | Reason |
|---|---|
| **Multiple video tracks** | An animatic has one picture track by definition. A second track drags in track headers, targeting, sync locks, lift-vs-ripple and gap semantics — 80% of NLE complexity for a problem we do not have |
| **Gaps** | Unrepresentable. A gap is black frames, i.e. a bug. Want a hold on black? Add a slate. This one decision deletes the gap tool, lift, "close gap", sync locks and clip-to-clip snapping |
| **The lift-vs-ripple distinction** | Both delete keys do one thing. FCP already works this way |
| **Slip** | Definitionally meaningless on a held still — no handles. The card greys its IN field with "stills have no handles" |
| **Slide, as a named concept** | In a gapless list it is exactly rolling both boundaries by the same amount. Ships as `Opt+←/→` "shift shot earlier/later"; the word never appears |
| **Drag-to-retime** | Typing `2.5` is exact and four keystrokes. Dragging to 2.5s at any density that fits a 90s reel is not achievable, so a drag handle promises a precision the geometry cannot keep |
| **Zoom, fit-to-window, horizontal scroll math, virtualization** | All four exist to compensate for x-axis-is-time. The strip is bounded-width and 20–60 cards is nothing to window. This app has zero virtualization today and this feature does not get to be the first |
| **A snapping toggle** | Positions are derived from durations in a gapless list. There is nothing to snap to. A snapping toggle is a confession that your snap targets are wrong |
| **Transitions beyond a metadata field** | A dissolve is a property of an edit point, and doing it properly needs handles a still export cannot provide. `shot.transition` already exists, rides into the XML as metadata, and renders as a hard cut — stated in CONFORM.md |
| **Effects, filters, colour, keyframes, Ken Burns** | None move the question "does this read at this length". Their absence is also what keeps pass 2 a free stream copy |
| **Markers as a separate layer** | The shot *is* the marker — id, title, beat, prompt — and `↑`/`↓` navigates them. A second annotation layer on a 20-item list is furniture |
| **Versioned cuts (`cuts/<id>.md`)** | One reel per project, like `brief.md`. Multiple cuts forces a picker, a `default` flag, and a "which cut does the export read" question nobody asked for |
| **A `MODULE_ROUTES` gate on playback** | Playback and XML export need no binary, no key, no npm and no disk. `shared/integrations.mjs:8-9`'s own rule is that a module is something with a real cost. One `animatic` descriptor exists so the surface is switchable, and its `binaries` string honestly reads `ffmpeg (mp4 export only)` |
| **A top-bar nav slot, breadcrumb entry, page shell decision, URL sub-state** | The Reel is a fixed `inset:0` overlay reached from the object that owns it — the ShotWorkspace precedent. `App.jsx:1422` caps the bar at five destinations. Integration is four lines instead of a seven-touchpoint page checklist |
| **AAF, EDL, OTIO** | No Node AAF writer exists. EDL cannot carry a file path. OTIO is unreadable by Premiere and Final Cut and has no documented still convention. Two XMLs cover all three target apps |
| **WebCodecs, MediaRecorder, an MCP server** | Precision already present; explicitly rejected twice in this repo; and FrameForge already has an agent seam — adding the reel routes to `backend/agentHome.mjs` `CORE_API_ROUTES:258-277` is the whole integration |

---

## Risks and open questions

**Design risks, and how this handles them**

1. **`shot.dur` has zero server-side validation.** `index.mjs:437` passes `req.body.patch` straight to `patchShot` and `story.mjs:56` spreads it. Handled by never writing `shot.dur` from the reel and by clamping reel timing to `[2, 60*fps]` **server-side in A4**, before the digit-entry UI exists in A8 — not eleven tickets later.
2. **Two places could hold a duration.** Handled by making `framesFor()` a single documented precedence chain that *every* consumer reads — manifest, `resolveShotMedia`, Story's DUR column and runtime, the Remotion handoff, `shots.csv` — plus the reciprocal rule that editing DUR in Story clears the reel override. A row lands in CLAUDE.md's source-of-truth table **in the same commit**, or A4 does not merge.
3. **Staleness.** Impossible: order and picture are derived on every read, so a shot added, reordered, re-rolled or re-approved after the reel was built simply appears correctly. The one thing worth reporting — a hand-timed shot whose take changed — is a `pinnedGen` cache diff surfaced as one line, with nothing to apply.
4. **Export cannot be verified in CI.** Handled by golden fixtures byte-compared on every run, `xmllint --dtdvalid` against Apple's shipped DTDs where available (skipped with a clear message otherwise), a preflight route that runs before writing, and a **manual import gate** on A5 and A10 recorded in `docs/specs/animatic/SPEC.md` naming exactly which apps a human has and has not opened it in.
5. **Playback numbers are third-party.** `scripts/bench-decode.mjs` lands at the top of A7; the LRU and prefetch window are tuned from its output, not from a claim.
6. **Capture-phase collisions.** `Reel.jsx` bails on `app.state.paletteOpen` (the `docs/COMPONENTS.md:238` defect, fixed not inherited) and copies `App.jsx:1095-1099` verbatim rather than becoming the sixth incompatible typing predicate.
7. **AppleDouble.** Any new reader filters `!f.startsWith('.')` — `backend/indexer.mjs:74` skips dotfiles specifically because exFAT `._X` sidecars were pushing spurious SSE refetches.
8. **Silent ffmpeg failures.** Every render test counts frames with `ffprobe -count_frames`. Never an exit code.

**Needs a human decision**

- **Does the reel ever write back to `shot.dur`?** My call: **no.** But it means the Story list's DUR column shows the authored number until you edit it there, and the Reel shows the cut. Confirm that split is what you want before A4.
- **Video takes seed from measured length, not `shot.dur`.** My call: **yes** — a 5s clip laid down as a 4s hold is a lie. It means the reel's runtime can differ from the Story list's estimate the moment a video take is approved. Confirm.
- **Frame floor of 2.** Resolve rejects a 1-frame still. At 24 fps that makes 0.083s the shortest expressible cut. Fine?
- **Copy, not symlink, in the pack.** A 40-shot 1080p reel is a few hundred MB per export. Confirm you want the disk cost in exchange for a pack that survives being moved.
- **Mixed source frame rates.** A 30 fps Kling take in a 24 fps reel: xmeml `in`/`out` decode against the *sequence* rate, and Premiere and Resolve do not reliably agree once source and sequence differ. The safe fix is normalising video takes to the sequence rate when populating `media/` — which makes the pack depend on ffmpeg for that case. My call: **normalise when `srcFps !== fps` and ffmpeg is present; warn loudly when it is not.** Confirm.
- **Aspect mixing in the strip.** 16:9 next to 9:16 next to 1:1 in a proportional-width card row needs a call: letterbox every card into the reel's canvas aspect (honest, matches the export), or let cards be their native shape (prettier, lies about the film). My call: **letterbox.**
- **When do we reopen this whole design?** Not at "we want dissolves" and not at "we want a title card" — both are solvable inside this model. **At "a second video track is a requirement."** That is the point where a gapless single-lane list is the wrong foundation and incrementally reinventing an NLE is the failure mode that has sunk larger projects. That sentence goes in the spec's Known Gaps section so the decision is on the record rather than made by drift.