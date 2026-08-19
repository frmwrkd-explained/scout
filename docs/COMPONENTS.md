# COMPONENTS.md — the canonical component registry

**Written 2026-07-20. Partially reconciled 2026-08-02 — READ THE BANNER FIRST.**
Built from a 10-lens sweep of `frontend/`, 114 findings, each adversarially verified
against source before landing here.

---

## ⚠️ Staleness banner — what below is no longer true (checked 2026-08-02)

This file was written **before the Composer landed**. Its bones — the Tier 1/2/3/4
inventory of what is genuinely duplicated — are still the best map of this codebase. Its
headline verdict is not. Fix a row when you disprove it; do not act on one you have not
re-checked.

| Claim in this file | Reality on 2026-08-02 |
|---|---|
| "There is **no single composer**. There are three" + the three-column table below | **There is one.** `frontend/Composer.jsx` is imported by Chat, ProjectGenerate, ShotWorkspace, Story, AssetBoards, App and chat/shotBoardCard, and its design is deliberately **zero variants** — not the `console\|panel\|bar` densities §3.1 proposes |
| Every mention of `chat/ManualComposer.jsx` (12 of them) | **The file was deleted.** Its `OUTPUT_KINDS` vocabulary moved into `frontend/modelCatalog.js` |
| `MONO` — "`tokens.js:32`, adopted **0**, 47 local copies" | Adopted **everywhere**. Zero local declarations, zero inline literals |
| `Chip` — "module-local in *both* `GenerationControls` and `SchemaForm`, neither exported" | **Exported from `frontend/ui.jsx`**; both former owners import it |
| `Empty` / `Input` / `Field` — "**0** importers" | All three have importers now. `ui.jsx` exports **eight** primitives, not five or six — `InlineEdit` and `Chip` are not listed anywhere below |
| §3.3 `<CommandOverlay>` — "`StyleLockPicker.jsx:1-2` admits it… `fuzzy` is character-identical" | `StyleLockPicker.jsx` and `StyleLocks.jsx` were **deleted** 2026-08-02 (superseded by `StyleLab`, importerless). That duplicate `fuzzy`, and StyleLocks' private HTTP client, are gone with them |
| Every `file:line` in this document | Assume drifted. The 2026-08-02 sweep found pointers off by 5–70 lines throughout. Search by symbol |

**Still true and still worth doing**, re-verified: the review-action triads (`MediaAction`
exists in `RenderMedia.jsx` and only 3 surfaces use it), the six cost-badge prefixes, the
`Modal`/`Popover` chrome with zero focus traps and zero portals, the `runOp`/`isTyping`
shared-behaviour tier, and the `0–1 vs 0–100` progress ambiguity. Those are the live work.

---

This file is the answer to `CLAUDE.md:160` — *"grep for the concept before
implementing it"* — which was previously unfollowable, because the source-of-truth
table at `CLAUDE.md:49-59` names no UI component at all.

**Rule: if a concept has a row here, import it. Do not render its markup by hand.**

---

## The verdict, stated plainly

There is **no single composer**. There are three, and they do not share a submit path:

| | `ProjectGenerate.jsx` | `chat/ManualComposer.jsx` | `ShotWorkspace.jsx` |
|---|---|---|---|
| density | chip-row console | stacked panel | inline bar |
| lines | ~330 | 327 | ~80 |
| `ModelPicker` | yes | **hand-rolled fork** | **raw `<select>`** |
| `SchemaForm` | yes | yes | **none** |
| cost shown | `~$0.015` | `est $0.015` | **never** |
| resolution sent | yes | yes | **never** |
| `joinFragment` | yes | yes | **naive `', '`** |

They disagree on **behaviour**, not just pixels. See "Correctness bugs closed by
unification" below.

The deeper problem: **the extraction already happened, the adoption didn't.**
`frontend/ui.jsx` exports `Empty`, `Input` and `Field` with **zero importers
app-wide**. `tokens.js` exports `MONO` while 47 files declare their own copy of the
identical string. Roughly 40% of the duplication in this codebase is migration debt
against components that already ship.

---

## Corrections to `CENSUS.md` — two of its headline findings are STALE

Verified against source 2026-07-20 while implementing the composer handover. `CENSUS.md`
and six of the nine tickets assert these; **both were already reconciled in code** and the
docs never caught up. `CLAUDE.md` carried both and has been fixed in the same change.

| Stale claim | Reality | Cited in |
|---|---|---|
| `ASPECTS` is duplicated at `ShotWorkspace.jsx:16` | **False.** One declaration only, `GenerationControls.jsx:24`. `ShotWorkspace.jsx:12` and `ProjectGenerate.jsx:47` both import it. `:16` is `const MONO`. | `CENSUS.md:63,293,405,601,689`; tickets `01:19,48`, `02:17,22`, `03:95`, `04:39`, `05:28`, `09:12,21` |
| `CardShell` is defined at `chat/cards.jsx:27` but **not exported**, hence 4 copies | **False.** Exported at `chat/directives.jsx:33`; all 6 chat card files import it. `directives.jsx:27` documents the completed migration. | `CLAUDE.md` (fixed) |

Ticket `09` step 2 ("`ShotWorkspace.jsx:16` deleted") and ticket `04`'s acceptance
criterion are therefore **already satisfied**. Do not re-do them.

Still true and verified: the `Chip` duplication (`GenerationControls.jsx:37` ==
`SchemaForm.jsx:47`, neither exported) and `ui.jsx`'s three zero-importer exports.

**Lesson for this repo:** a spec family written in one pass and not re-verified will
outlive the bugs it describes. Re-verify a ticket against source before acting on it —
`CLAUDE.md`'s own checklist item 2 says exactly this.

---

## Tier 0 — already canonical, just not adopted

Zero new code. Pure migration. Cheapest wins in the audit; several are one-line imports.

| Component | Lives in | Adopted | Un-adopted sites |
|---|---|---|---|
| `MONO` | `tokens.js:32` | **0** | 47 local `const MONO` + 2 raw inlines (`Story.jsx:490,685`) |
| `Empty` | `ui.jsx:172` | **0** | 23 |
| `Input` | `ui.jsx:206` | **0** | 56 across 24 files — `ui.jsx:210` cites `Settings.jsx:158,307,350,603` as its source; all four still inline |
| `Field` | `ui.jsx:228` | **0** | 28, incl. 4 rival helpers (`Settings.jsx:20`, `ToolsSuite.jsx:12`, `Moodboard.jsx:434`, `App.jsx:2772`) |
| `Eyebrow` | `ui.jsx:148` | 2 | 8 private `eyebrow()` factories + 8 popover heads |
| `Card` | `ui.jsx:113` | 1 | 29 inline card boxes; `Settings.jsx:173`'s private `card()` names `ui.jsx Card` in its own comment |
| `Btn` | `ui.jsx:76` | 5 | 10 local factories |
| `RenderTile` / `RenderLightbox` | `RenderMedia.jsx` | 10 — **the model to follow** | 10 tiles, 1 lightbox, 3 raw kind-branches |
| `mediaKind` | `RenderMedia.jsx:27` | 6 | 3 rival regexes at 13 sites — the narrow `/\.mp4$/` ones render `.mov`/`.webm` in an `<img>` |
| `ModelPicker`/`FormatControls`/`ASPECTS` | `GenerationControls.jsx:56,103,24` | 2 | `ManualComposer.jsx:210` (fork), `ShotWorkspace.jsx:358,366`, `App.jsx:1740`, `Settings.jsx:497`, `ToolsSuite.jsx:427`. `showVariants:142` has **zero** callers |
| `SchemaForm` | `SchemaForm.jsx` | 2 | ShotWorkspace, Story, AssetBoards generate with no per-model settings at all |
| `joinFragment` | `lookBuilder.js:122` | 2 | `ShotWorkspace.jsx:150`, `Story.jsx:217` — still emit the double-comma bug |
| `BulkBar` | `Moodboard.jsx:268` | 2 | `App.jsx:2029` — **byte-identical** inline copy. Fix by adding an import. |
| `SnippetText` | `SnippetText.jsx` | several | `ManualComposer.jsx:290`, `ReviewInbox.jsx:181` — bare textareas, `/` snippets silently dead |
| `SHOT_STATUS` | `models.js` | 1 | `chat/cards.jsx:102` — stale second copy |

**~14 components · ~230 un-adopted call sites · ~430 lines.**

---

## Tier 1 — the atoms

Build first; everything above composes from these. Ordered by (sites × severity).

### 1.1 `<Chip>` — the selectable option pill
```jsx
<Chip label on onClick title tone="raise|accent|invert" size="sm|md" count color />
```
**Root cause of the worst duplication in the app.** `Chip` is module-local in *both*
`GenerationControls.jsx:37` and `SchemaForm.jsx:47` — byte-identical, neither exported,
so 27 surfaces retyped it.
- **39 sites.** Reconcile, don't average: three colour dialects (`--raise` is
  DESIGN.md-blessed; `--fg`-inverse = "view mode"; `--accent-12` = "filter narrowing").
  Radius 6/7/99px, padding spans 10 values, font 9.5–11.5px.
- **95 lines.**

### 1.2 Form field family — `<Input> <TextArea> <Select> <NumberInput>`
```jsx
<Input value onChange size="sm|md" mono width stopKeys />
<TextArea rows height tone="well|bare" mono autoGrow />
<Select value onChange options mode="value|menu" size />
<NumberInput value onChange min max step stepper align />
```
- **126 sites** (56 inputs + 28 textareas + 25 selects + 7 number + 10 filter).
- Bakes in a bug fix: 31 hand-written `onKeyDown={e => e.stopPropagation()}` guards
  shield the global keymap; the sites that forgot (`StyleLocks.jsx:124`,
  `RemotionLibrary.jsx:609`) are live bugs. Clamping is invented 7 ways; 4 sites accept
  values their own `min`/`max` call impossible — incl. `Settings.jsx:608`, **no upper
  bound on the monthly budget.**
- **98 lines.**

### 1.3 `<StatusPill>` + `STATUS_TONE` + `<Pulse>`
```jsx
<StatusPill status size variant="outline|solid|bare" />
export const STATUS_TONE = { draft, queued, running, paused, done, failed, cancelled }
```
- **7 rival colour maps + 11 pills + 19 hand-rolled pulsing dots.**
- Reconcile deliberately: `running` is `#5B9DFF` in 4 files, `var(--accent)` in 3 —
  `ProjectGenerate.jsx:72`'s comment and DESIGN.md say blue wins. `ShotWorkspace.jsx:19`
  omits `done` entirely, so finished takes render grey there.
- **100 lines.**

### 1.4 `<Cost>` + `fmtCost()` → new `frontend/money.js`
- **36 sites, six prefixes** (`$`, `~$`, `~$…est`, `est $`, `≈ $`, `≈`), three precisions.
- Live bug: `Chat.jsx:40` prefers `app.fmt$` (2dp), so a $0.003 generation reads
  **`$0.00` in chat** and `$0.003` in ProjectGenerate for the same record.
- **60 lines.**

### 1.5 `<Eyebrow>` + `<SectionHeader>` + `<PopoverHead>`
- **32 sites.** 8 private `eyebrow()` factories, 4 of them declared *inside* `render()`
  and rebuilt every frame.
- **44 lines.**

### 1.6 `<ReviewActions>` — keep · kill · re-roll · final
- **9 renderings.** `ProjectGenerate.jsx` renders the identical triad **twice in one
  file through two different local factories**, each commented as "the canonical order".
- Absorb: toggle-vs-one-way semantics, `final` (ShotWorkspace only), keycap suffix variants.
- **95 lines.**

### 1.7 `<KeyHints>`
- **9 sites.** Fixes two bugs: the gate disagrees (`showHints` truthy vs `!== false`),
  and only `App.jsx:2897` resolves user rebinds through `resolveKeys`/`keyLabel` — the
  rest hardcode `K`/`X`/`R` and **lie after a rebind**.
- **50 lines.**

### 1.8 `<SelectMark>` + `<DecisionBadge>` + `<Rating>`
- **38 sites.** `ShotWorkspace.jsx:427` has no `killed` branch. Ratings use `★` in
  generation surfaces and `●/○` in App. Four label vocabularies for one `reviewState`.
- **80 lines.**

### 1.9 `<Switch>` — `<button role="switch" aria-checked>`
- **9 sites, all `<span onClick>`.** None keyboard-operable, none has `role`/`aria-checked`.
- **16 lines.**

### 1.10 `<ProgressBar>` + `<ErrorText>`/`<ErrorBanner>` + `fmtBytes()`
- **33 sites.** ⚠️ Load-bearing: `job.progress` is read as 0–100 (`VideoImport.jsx:129`)
  **and** 0–1 (`RemotionLibrary.jsx:413,634`). Verify against the backend routes before
  unifying or every job renders at 1% or 10000%.
- **58 lines.**

### 1.11 Design tokens — the substrate (no component)
Add to `styles.css :root` + `tokens.js` in one commit.
- `--marked: #5B9DFF` — **17 raw literals of an undeclared fifth brand colour**; two
  source comments already call it "the marked channel"
- `--ok-05/12/35/60`, `--danger-05/12/35/60` — 43 sites invent **20 distinct alphas**
  while `styles.css:12` says *"Four accent alpha steps only. Anything between them is noise."*
- `--elev-1/2/3` (6 shadow recipes, ~40 sites) · `--scrim-modal`/`--scrim-chip`
  (3 near-black RGBs, 12 alphas) · `--r-xs…--r-pill` (15 radii, ~800 occurrences,
  **three spellings of "pill"**: 99px ×152, 999px ×3, `borderRadius: 50` ×4) ·
  `--dur-fast/base/slow` (`dl-in` runs at **six** durations)
- Fix now: `ToolsmithChat.jsx:171`, `chat/toolCards.jsx:125` use `rgba(227,255,50,.4)`
  where `--accent-35` exists.
- **Delete 22 colour aliases** — `const AMBER = 'var(--accent)'` in 9 files, naming a hue
  the acid-green palette does not contain. Keep only `ThreeDStage.jsx:44` (Three.js
  cannot resolve `var()`; that is what `tokens.js` is for).
- ⚠️ **Sequence the type scale LAST.** 23 font sizes, ~1000 occurrences, 456 on
  half-pixel steps. Tokenise the 9 whole-pixel values only — the half-step register may
  be intentional (`10.5px` MONO uppercase is the app's eyebrow voice).
- **~900 literals → ~30 tokens.** Net lines: 0.

---

## Tier 2 — the molecules

| # | Component | Sites | Lines | The reason it matters |
|---|---|---|---|---|
| 2.1 | `<Modal>` `<ConfirmDialog>` | 19 | 95 | Backdrop string **byte-identical 7×**. `App.jsx:1682,3012,3030,3051` have **no backdrop onClick** — click-outside is dead in 4 dialogs. Escape lives in a **9-branch hardcoded switchboard** at `App.jsx:1068-1079`. **Zero focus traps, zero scroll locks, zero `role="dialog"`, zero focus restore exist in `frontend/`.** |
| 2.2 | `<Popover>` | 14 | 90 | Three incompatible dismiss strategies; **8 sites have none at all**. `Story.jsx:591`/`:618` are byte-identical within one file. **Zero React portals exist in `frontend/`** — root cause of the z-index arms race. |
| 2.3 | `<ListRow>` `<MenuItem>` `<NavRail>` `<OptionRow>` | 37 | 60 | Active marker drawn two mechanically different ways — `borderLeft:2px` (shifts content) vs inset boxShadow (doesn't). The Settings rail and Palette rail are **not pixel-aligned today**. |
| 2.4 | `<PageHead>` `<PanelHeader>` `<DetailHeader>` `<Disclosure>` | 53 | 135 | `ToolsSuite.jsx:14` has a correct `pageHead`, module-local, never exported → **8 files re-typed it byte-for-byte**. Only `ProductionPanel.jsx:62` has `aria-expanded` — a shared `<Disclosure>` **fixes 11 a11y bugs in one edit**. |
| 2.5 | `<RailLayout>` `<CardGrid>` | 61 | 105 | **11 distinct `minmax()` values** for 12 grids, several 4px apart (196/200, 78/84, 340/380) — drift, not design. 6 of 8 rails lack the max-height and overflow on short windows. |
| 2.6 | `<DropZone>` | 8 | 75 | `LutApplier:396`/`FilmEmulation:174`/`GridSplitter:305` identical down to the copy string. `Chat.jsx` carries the same drag block **twice in one render** (`:583`, `:605`). |
| 2.7 | `<RefChip> <RefThumb> <Filmstrip> <AssetPickerGrid> <CompareView> <PreviewSlot> <SliderRow>` | 39 | 168 | `ManualComposer.jsx:130` enforces max-4 refs by **silent truncation** — attach 6, lose 2, no feedback. `PromptBuilder.jsx:579` omits `clearRef:true`, so **a removed thumbnail comes straight back**. |
| 2.8 | `<FloatingBar>` `<AnchoredComposer>` | 16 | 90 | `App.jsx:2030` is a byte-identical copy of the **already-exported** `Moodboard.jsx:268`. |
| 2.9 | `<SegmentedControl>` | 15 | 75 | Container byte-identical ×5. `Settings.jsx` retypes the track **three times** around a `seg` helper it already extracted. **None of the 15 has `role="radiogroup"` or arrow-key nav.** |
| 2.10 | `<TabBar>` `<FullscreenSurface>` | 6 | 70 | Should own the digit-shortcut contract currently detached at `App.jsx:1152-1158`, which hardcodes the tab array and re-applies `App.jsx:1916`'s filter — two places already commented as needing to stay "in lockstep". |

---

## Tier 3 — the organisms

### 3.1 `<Composer>` — one component, three densities ⭐
```jsx
<Composer
  density="console|panel|bar"        // ProjectGenerate | ManualComposer | ShotWorkspace
  pid shot sessionId
  kinds={['preview','render','edit']}
  pool refs onRefs
  value onChange   // {prompt, model, format:{aspect,resolution,seed}, variantCount, params}
  onSubmit         // → submitGeneration()
  showCost showVariants showSnippets
/>
```
Composed from `ModelPicker` (+`kinds`), `SnippetText`+`TextArea`, `RefChipRow`+
`AssetPickerGrid`, `FormatControls`, `SchemaForm`, `SegmentedControl`, `<Cost>`,
`<Btn>`, `<KeyHints>`.

Replaces `ProjectGenerate.jsx:836-1130`, `ManualComposer.jsx:210-325`,
`ShotWorkspace.jsx:311-390`, plus `Story.jsx:206-227` and `AssetBoards.jsx:312-317`.
**5 surfaces · ~52 duplicated concept instances · 330 lines.**

**Extract `frontend/generate.js` BEFORE the UI:**

| Export | Replaces | Bug it closes |
|---|---|---|
| `submitGeneration({…})` | `ProjectGenerate:440,453-509`, `ManualComposer:173-193`, `ShotWorkspace:143-153`, `confirmCard:80` | ShotWorkspace composes the style-lock fragment locally on the single route but sends `styleLockFragment` to the batch route — **a 1× and a 2× generate from identical state produce different prompts** |
| `effectiveModel({picked,pdef,settings,kind})` | 5 spellings, 9 sites | `AssetBoards.jsx:312` drops `pdef.model` — a project pinned to a model still quick-generates on the global default |
| `needsRefFrame(id)` / `blockReason()` | identical regex pair at `ProjectGenerate:248` + `ManualComposer:149` | `ShotWorkspace.generate()` and `Story.batchGenerate()` run **no guard** — i2v fails after the click, once per variant |
| `cleanParams(modelParams)` | `ProjectGenerate:227`, `ManualComposer:135` — identical incl. the `'-'` sentinel | — |
| `attachComposerKeymap(handlers)` | 14 capture-phase registrations, 7 files | `Story.jsx:231` misses `SELECT` + contenteditable; ShotWorkspace never checks `paletteOpen`. **Must preserve `ProjectGenerate.jsx:637-642`'s ⌥digit-before-bail ordering** — on a German Apple layout ⌥8 is `{`, and swallowing it silently armed a $3.20 batch |

**+130 lines.**

### 3.2 `<ResultCard>` — 21 sites · 140 lines
Close these `RenderTile` gaps first: per-item gradient background (`RenderMedia.jsx:99`
hardcodes `var(--sunk)`), an `onError` fallback (`RemotionLibrary.jsx:356`'s two-layer
trick `placeholder` cannot express), a 4th border state (ShotWorkspace's hero/kept
ladder), ref forwarding (`App.jsx:541`'s imperatively-driven video).

### 3.3 `<CommandOverlay>` + `fuzzy()` — 2 sites · 85 lines
`StyleLockPicker.jsx:1-2` admits it: *"mirrors frontend/Palette.jsx's overlay/list/
keyboard pattern exactly."* `fuzzy` is character-identical (`Palette.jsx:9` ==
`StyleLockPicker.jsx:10`). The 13×13 magnifier SVG appears a **third** time at `App.jsx:1321`.

### 3.4 `<ModelCatalogRow>` `<StyleLockCard>` `<SendToPicker>` — 11 sites · 155 lines
`ToolsSuite.jsx:485` and `Settings.jsx:377` are two full catalog-row implementations with
identical toggle, identical click-to-copy id, identical cost formatter.

---

## Tier 4 — shared behaviour (not components)

Found by the completeness critic; **every rendering lens missed these** because they are
logic, not markup. Several have higher site counts than ticketed components.

| Helper | Sites | The problem |
|---|---|---|
| `runOp(app, verb, fn)` | **49** across 15 files | `try { await api.X(); app.sync() } catch (e) { app.showToast('<Verb> failed — ' + …) }` identical to the character. **`busy:true` is set at 25 sites but `finally { busy:false }` at only 2** — the rest leak a stuck spinner on throw. |
| `<Num>` (tabular-nums mono readout) | **58** | `{fontFamily: MONO, fontVariantNumeric:'tabular-nums'}` retyped. `<Cost>` becomes a wrapper on it. |
| `copyToClipboard(text, {app, label})` | **21** | `writeText().catch(()=>{})` + a toast whose copy and tone both diverge; some sites show no toast at all. |
| `isTyping(e)` | **11**, 5 incompatible predicates | Some omit `SELECT`, some omit `contentEditable`. **Shortcuts fire while typing in a `<select>` on some surfaces and not others.** Fixing this deletes most of the 60 `stopPropagation` escape hatches. |
| `download(name, data, mime)` | 8 files | Hand-rolled `createObjectURL` + `a.click()`, **no `revokeObjectURL` in most copies** — leaks. |
| `loadImage(url)` | 4 | `ToolsUite.jsx:26` sets `crossOrigin='anonymous'`; `LutApplier:242`, `splitCard:114`, `FilmEmulation:119` do not — they **silently taint the canvas on fal CDN sources**. |
| `slug()` / `safeFilename()` | 5, 4 character classes | Filenames from different surfaces are inconsistent. |
| `<PrintSurface>` | 2 | `CallSheet.jsx:21` and `Screenplay.jsx:161` each declare `PRINT_CSS`, inject it via `dangerouslySetInnerHTML`, and fight the same `height:100vh` app shell with `!important`. |
| `<Stat label value sub />` | 4 | KPI tile: eyebrow + oversized mono figure + sub-line. |
| — `api.js` leak | — | `StyleLocks.jsx:12-27` defines a **private HTTP client** (`j` + `opts`) duplicating `api.js`; `ThreeDStage.jsx` issues **13 raw `fetch('/api/…')`** calls with no shared error handling. |
| — stale comment | — | `ProjectGenerate.jsx:986` says `window.confirm` is "deliberately not used" and "nothing else in this app uses" it. `App.jsx:2411`, `App.jsx:2421`, `Settings.jsx:346` all call it. Reconcile onto `<ConfirmDialog>` or delete the comment. |

---

## Build order

| # | Work | Ticket |
|---|---|---|
| 1 | Design tokens (`--marked`, ok/danger ramps, elev, scrims, radii, motion). Delete 22 colour aliases. Import `MONO`. **Defer type scale.** | **01** |
| 2 | This file | **01** |
| 3 | Tier 0 adoption sweep — no new code | **09** partial ⚠️ `ui.jsx`'s 6 zero-importer exports are in **no** ticket |
| 4 | Tier 1 atoms | **09** partial ⚠️ `Switch`, `Select`, `TextArea`, `NumberInput`, `ProgressBar`, `ErrorText`, `Cost`, `SliderRow`, `fmtBytes` **uncovered** |
| 5 | `<Composer>` prop contract — doc + stub | **02** |
| 6 | `frontend/generate.js` | ⚠️ implied by 03, not its own unit — **split out as 03a** |
| 7 | `ModelPicker` gains `kinds`; `showVariants` gets its first caller | **04**/**09** |
| 8 | Extract `<Composer>` from ProjectGenerate (canonical) | **03** |
| 9 | Spec-driven settings — `SchemaForm` everywhere | **04** |
| 10 | Tier 2 overlays — `Modal`, `Popover`, `layers.js` | ⚠️ **UNCOVERED — highest-value gap.** New **10** |
| 11 | Tier 2 structure — `PageHead`…`TabBar` | ⚠️ **UNCOVERED.** New **11** |
| 12 | `<ResultCard>` + review chrome | **08** |
| 13 | Adopt Composer in ShotWorkspace (bar) | **05** |
| 14 | Adopt Composer in ManualComposer (panel) | **06** |
| 15 | Output-kind switching | **07** |
| 16 | Media molecules | ⚠️ **UNCOVERED.** New **12** |
| 17 | Remaining organisms | ⚠️ **UNCOVERED.** New **13** |
| 18 | Tier 4 shared behaviour (`runOp`, `isTyping`, `<Num>`, …) | ⚠️ **UNCOVERED.** New **14** |
| 19 | Type scale — 9 whole-pixel sizes only | ⚠️ **UNCOVERED.** Highest risk, do last |

**Tickets 01–09 cover roughly 45% of this plan.** The uncovered half is concentrated in
overlays, layout chrome, shared behaviour, and the `ui.jsx` zero-adoption problem — all
with larger site counts than several ticketed items.

---

## Scoreboard

| | |
|---|---|
| Components | **58** — 14 exist (adoption only) · 21 atoms · 17 molecules · 6 organisms |
| Duplicate call sites eliminated | **~1,140** deduped (~1,610 raw before cross-lens merge) |
| Lines saved | **~2,600** deduped (4,216 raw, −38% double-count) |
| Literals → tokens | ~900 → ~30 |
| A11y defects fixed as a side effect | 11 disclosures, 9 switches, 15 segmented controls, 3 tab bars — none keyboard-operable; plus focus trap / scroll lock / `role="dialog"` / focus restore, of which the codebase has **zero instances** |
| Correctness bugs closed | **12** — double-comma join · batch-vs-single prompt divergence · silent 4-ref truncation · missing i2v guards · unclamped budget · `.mov`-in-`<img>` · `$0.00` cost · sticky style-lock ref · 0–1 vs 0–100 progress · stuck spinners on throw · tainted canvas · shortcuts firing while typing |
| **Single highest-leverage fix** | **Export `Chip` from `GenerationControls.jsx`, adopt `Empty`/`Input`/`Field`.** 4 exports, ~100 call sites, zero new design decisions. |

---

## Constraints on all of the above

- **The palette does not move.** Acid green `#E3FF32` on neutral darks. This is
  structural unification, not a redesign. `--marked: #5B9DFF` is not a new colour — it
  is 17 existing raw literals getting a name.
- **Each surface keeps its density.** `console` / `panel` / `bar` are three renderings
  of one contract. Collapsing them to one visual treatment breaks three working layouts.
- **`frontend/styles.css :root` stays machine truth**; `docs/DESIGN.md` explains it.
  Where they disagree, `:root` wins.
