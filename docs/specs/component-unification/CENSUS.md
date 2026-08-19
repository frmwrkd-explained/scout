# Component duplication census

Raw findings, 2026-07-19. Uncritiqued — verify citations before acting.

CENSUS — modelspec

## VERDICT: partially spec-driven. The machinery is complete and correct; adoption is 2 of 6 generation surfaces, and the spec is architecturally sidelined by a parallel hardcoded aspect/resolution path that runs on *every* generation regardless of schema.

---

## 1. The spec pipeline (exists, works, is genuinely per-model)

`backend/modelSchemas.mjs:21` — `FAL_OPENAPI = 'https://fal.ai/api/openapi/queue/openapi.json'`, fetched per endpoint at `falOpenapiUrl` (`:23`), public, no key.
`backend/modelSchemas.mjs:197` `getModelSchema(id, {force})` — FAL → cache/lazy-fetch/stale-serve; non-FAL → `fallbackSchema` (`:141`).
Cache: `catalog/schemas/<safe id>.md`, frontmatter staleness stamp, `SCHEMA_TTL_MS = 7 days` (`:20`, `:24`).
Routes: `backend/index.mjs:919` `GET /api/catalog/model-schema`, `:923` `POST …/sync`. Client: `frontend/api.js:204-205`.

**Normalized field shape** (`normalizeField`, `modelSchemas.mjs:82-117`):
```
{ name, label, type, required,
  ref?, options?, min?, max?, step?, default?, nullable?, description? }
type ∈ enum|integer|number|boolean|image|video|audio|array|object|string
```
**Schema envelope** (`:121-137` / `:141-160`):
```
{ ok, modelId, provider, source:'fal-openapi'|'catalog', fallback:bool,
  category?, required:[names], fields:[…], synced?, stale?, offline?, reason? }
```
`pickVariant` (`:73`) collapses FAL's `anyOf` "value | null" and "structured | enum shorthand" — this is what makes `image_size`, `resolution`, `duration` come through as clean enums.
`referenceKind` (`:36`) classifies `*_url`/`*_urls` by medium → image/video/audio slots.

**This does cover video duration and resolution.** Verified in ticket 04/05's own contract survey (`docs/specs/filmmaker-chat/issues/05-schema-form-renderer.md:44-49`): `kling-video/v3/pro/image-to-video` → `duration[13]` + `shot_type[2]`; `nano-banana-2` → `aspect_ratio[15]`; `flux/schnell` → `image_size[6]`.

`frontend/SchemaForm.jsx` renders it with **zero per-model branching** — `Field()` (`:56-173`) switches on `type` only. Module-level `SCHEMA_CACHE` (`:30`), abort token on model switch (`:213-236`), defaults applied once per model through `onChange` (`:240-249`). The claim in its header comment is accurate.

---

## 2. Adoption — the gap

| Surface | ModelPicker | SchemaForm | resolution | params | file:line |
|---|---|---|---|---|---|
| ProjectGenerate.jsx | yes | yes (FORMAT popover) | yes | yes | `:47-48`, `:1090-1102`, `:493-501` |
| chat/ManualComposer.jsx | **no — hand-rolled** | yes | yes | yes | `:29`, `:297-301`, `:209-241` |
| ShotWorkspace.jsx | **no** | **no** | **no** | **no** | `:357-372`, `:143-150` |
| Story.jsx (batch generate) | no | no | no | no | `:215-217` |
| AssetBoards.jsx | no | no | no | no | `:313` |
| App.jsx (video from still) | no | no | no | no | `:2077` |
| chat/confirmCard.jsx (agent) | n/a | n/a | passes through | passes through | `:41-47` |

Three of those six send a **string literal aspect and no resolution and no params**:
- `frontend/Story.jsx:217` — `aspect: '16:9'`
- `frontend/AssetBoards.jsx:313` — `aspect: '1:1'`
- `frontend/App.jsx:2077` — `aspect: '16:9'` (this is the **video** path — generating a clip from a still, hardcoded 16:9, no duration, no resolution)

`ManualComposer` reuses `SchemaForm` but reimplements the model list it could have gotten from `ModelPicker` — `renderModelPicker()` (`:209-241`) rebuilds the identical row markup (checkmark span, label, `providerDef(…).label`, `estCost` right-aligned) that `GenerationControls.jsx:57-66` already renders. Its own header comment (`:21-22`) states the reason: *"ModelPicker's own filter is video-vs-not only (it cannot isolate a single kind or the audio kinds)"* — a **~3-line prop addition to ModelPicker** (`kinds` whitelist alongside the existing `video` boolean at `GenerationControls.jsx:54-56`) would have removed 33 lines of duplicate rendering.

---

## 3. Hardcoded per-model literals — exact locations

**Aspect list, duplicated verbatim:**
- `frontend/GenerationControls.jsx:24` — `export const ASPECTS = ['16:9','2.39:1','9:16','1:1','4:5']`
- `frontend/ShotWorkspace.jsx:16` — `const ASPECTS = ['16:9','2.39:1','9:16','1:1','4:5']` ← byte-identical copy, module-local, not imported
- `frontend/modelCatalog.js:157` — `ASPECT_NUM` (the pixel-math table; legitimately canonical)

**Resolution tiers — app-global, not per-model:**
`frontend/modelCatalog.js:150-155` — `RESOLUTIONS = [1K/2K/4K]`, `DEFAULT_RESOLUTION='1K'`. Three tiers for every model on every provider. No model's real size enum informs this list.

**Per-model behaviour encoded as a regex, not read from spec:**
`frontend/modelCatalog.js:170` — `export const usesResolutionTier = id => /nano-banana|seedream/.test(String(id||''))`
This is *literally* "which models take a named tier vs explicit pixels" — a fact the fetched schema already states (`image_size` enum vs `width`/`height` integers). Consumed at `backend/providers.mjs:61`.

**Provider-native aspect mapping, hand-authored:**
- `backend/providers.mjs:25-31` — `FAL_ASPECT`, 5 aspects → `{image_size, aspect_ratio}` including magic pixels `{1376,576}` and `{1024,1280}`
- `backend/providers.mjs:32` — `ASPECT_WH`, a second table of the same 5 aspects → `[w,h]` pairs
- `backend/providers.mjs:126` — `aspect === '2.39:1' ? '16:9' : aspect` (Kie)
- `backend/providers.mjs:174` — `aspect === '2.39:1' ? '21:9' : aspect` (Higgsfield)

**Duration — hardcoded twice, spec-driven nowhere in the default path:**
- `backend/providers.mjs:129` — `payload.aspectRatio = ar; payload.duration = 5;` ← Kie video, unconditional 5 seconds
- `frontend/GenerationControls.jsx:107` — `showDuration = false, durations = [5]` ← default duration list is the literal `[5]`, and **no caller in the repo ever passes `showDuration`**. `rg` for `showDuration` finds only the declaration and its use at `:131`. The generic duration control is dead code.
- `frontend/ProjectGenerate.jsx:495` — `// No 'duration' — see queueBatch() for why it was removed`

**Video models get no size handling at all:**
`backend/providers.mjs:59` — `if (!isVid(model)) { …resolution logic… }`. A video model therefore ships `image_size: 'landscape_16_9'` (`:55`) and nothing else. This is precisely the user's "do not assume video models are just HD" — the code assumes video models are 16:9 landscape and 5 seconds, and the *only* escape hatch is `params` from SchemaForm, which 4 of the 6 surfaces never send.

---

## 4. The structural flaw: aspect/resolution run in parallel to the spec, always

`backend/providers.mjs:54-73`. Order of operations on every FAL call:
1. `input = { prompt, image_size: FAL_ASPECT[aspect].image_size, aspect_ratio: …, num_images: 1, output_format: 'png' }` — the hardcoded table, applied unconditionally
2. resolution tier/pixel override (non-video only)
3. `params` from SchemaForm merged **last**, overwriting keys (`:70-75`)

So the spec wins on collision — but only for keys the spec happens to name. `num_images: 1` and `output_format: 'png'` are injected into every FAL request whether or not the endpoint declares them.

Compounding this, `SchemaForm` is **either/or, never both** — `:255` returns `<FormatControls>` and bails, `:270` returns spec fields. When a real schema loads, the aspect chips *disappear from the UI* while `S.aspect` (default `'16:9'`, `ProjectGenerate.jsx` state) is still sent on the payload at `:493`. The user is shipping an aspect they can no longer see or change. `SchemaForm`'s `onSchema` callback (`:203`, `:220-221`) exists precisely to let a parent "stop sending aspect/resolution once a real spec is in play" — **no caller passes it.** `rg -n --text "onSchema"` → `SchemaForm.jsx` only.

---

## 5. What it would take to render ANY fal model from spec, no per-model code

The schema layer needs **nothing**. The work is all consumer-side:

**a. Wire the escape hatch that already exists.** `ProjectGenerate` and `ManualComposer` pass `onSchema`; when `schema.fallback === false`, stop sending top-level `aspect`/`resolution` and let `params` be the whole story. ~6 lines each. Requires `backend/generate.mjs:91` to tolerate absent aspect (currently defaults `'16:9'`; `backend/index.mjs:692` coerces `String(aspect || '16:9')`).

**b. Derive `usesResolutionTier` from the schema instead of `/nano-banana|seedream/`.** The fetched `fields` already say whether the model has an `image_size` enum, a `resolution` enum, or `width`/`height` integers. Delete `modelCatalog.js:170`; the regex is a per-model literal standing in for a fact already fetched.

**c. Give the spec a way to answer "what aspects does this model accept?"** Today `ASPECTS` is a fixed 5-chip UI list. A model whose spec declares `aspect_ratio` with 15 options (nano-banana-2) shows those 15 in `SchemaForm` as a `<select>` (`SchemaForm.jsx:64-74`, `opts.length > 6`), while `FormatControls` shows an unrelated 5. Two vocabularies for one concept. Fix: `FormatControls` becomes the *fallback-only* renderer it is documented to be, and the composer's persistent format chip reads its label from the resolved schema.

**d. Video duration/resolution needs no new code at all** — it already arrives as `duration[13]` enum chips via `Field()`'s enum branch. The blockers are only (i) `backend/providers.mjs:59` skipping video in the size path, (ii) `providers.mjs:129`'s unconditional `duration = 5` for Kie, and (iii) `App.jsx:2077` never sending `params`.

**e. Adopt on the 4 unwired surfaces.** `ShotWorkspace` (`:143-150`), `Story` (`:215`), `AssetBoards` (`:313`), `App` (`:2077`) each need `params` threaded through. `ShotWorkspace` additionally needs its literal `ASPECTS` (`:16`) deleted in favour of the import, and its raw `<select>` model dropdown (`:357-362`) replaced by `ModelPicker`.

**f. Non-FAL providers stay fallback forever** — `getModelSchema` (`:200`) returns `fallback:true` for kie/higgsfield/arcads by design. That is correct and should not change; it is the reason `FormatControls` must survive as the generic path.

---

## 6. Touchpoints with the two existing efforts

- `docs/specs/design-reconciliation/` ticket 05 (Btn/Card/Eyebrow/Empty/Field primitives) overlaps the *atoms* duplicated here: `Head` and `Chip` are defined **three times** — `GenerationControls.jsx:31/35`, `SchemaForm.jsx:38/44`, `ManualComposer.jsx:68/72` — with drifted sizing (`font-size:10px` vs `10.5px`, `border-radius:6px` vs `7px`). Those belong to ticket 05, not to this effort.
- `docs/specs/filmmaker-chat/issues/04` and `05` are both marked `done` and both **are** genuinely done — the schema layer is not the debt. Ticket 05's own notes flag the residue: its "Dev-server-unverified" section (`:56-59`) says live spec-driven field rendering was never exercised in-browser because the running backend 404'd the route. The spec-driven UI has, as far as the tracked record shows, never been seen working by a human.

---

I have what I need.

# CENSUS — contextrail (locked context surfacing)

## 1. Where locks live (storage)

| Concept | Store | Record shape | Route |
|---|---|---|---|
| **Style lock** | `<storageRoot>/styles/<slug>.md`, `backend/stylelocks.mjs:22-23` | frontmatter `{id,name,fav,refImage,tags[],model,picks{},camera{},aspect,presetId}` + **body = the prose fragment** (`stylelocks.mjs:4-7`) | `GET/POST /api/stylelocks`, `GET /api/stylelocks/:id/ref` (`stylelocks.mjs:250-302`) |
| **Project's active style lock** | `project.md` frontmatter `styleLock: <id>` | id only | `PATCH /api/projects/:id` (`backend/index.mjs:337-347`) |
| **Cast / Locations** | **Not locks.** Plain context-board files under `projects/<pid>/context/<folder>/` | classified by folder-name regex, `ASSET_KIND_FOLDERS` `frontend/AssetBoards.jsx:26-30` | `/api/context/:pid/…`; folder overrides in `context/_folders.md` (`backend/memory.mjs:19,114-128`) |
| **Look sheets** | `looks/` records `{id,tier1,tier2,palette,source}` | `GET /api/looks` (consumed `ProductionPanel.jsx:86`) |
| **Project understanding** | `brief.md` + `memory.md` (`backend/memory.mjs:18,39-59`) | markdown prose | `GET/PUT /api/memory/:pid` (`memory.mjs:136-152`) |
| **Per-shot bindings** | shot record fields `cast:[keys]`, `loc:key`, `look:styleLockId` | ids | `PATCH /api/story/:pid/shots/:id` (`agentHome.mjs:225`) |

**Finding:** only *style* is a real lock. Cast and Locations are folder-name conventions over loose files — there is no cast/location record with an id, only `folder/name` file coordinates.

## 2. How locks attach to a generation — three different mechanisms, none shared

**`ProjectGenerate.jsx`** — lock is *dissolved into state before the user sees it*. `syncLock()` seeds `state.style` from the lock; `composed()` (`:404-417`) returns `joinFragment(prompt, joinFragments(styleFragment(style), cameraFragment(camera)))`. It sends `styleLockFragment: ''` deliberately (`:473`, comment at `:469-472`) and posts the fully-composed prose. **Prose.**

**`chat/ManualComposer.jsx:167-181`** — `styleLock()` (`:105-108`) resolves `pdef.styleLock` → lock, then `joinFragment(rawPrompt, lock.fragment)` at `:169-170`, again sending `styleLockFragment: ''` (`:180`). Cast/loc attach differently: `effectiveRefs()` (`:120-129`) pushes the **first** board item matching `CAST_RE`/`LOC_RE` as `{kind:'asset',scope,name,folder}` — capped `.slice(0,4)`. **Style = prose; cast/loc = image ref (cheap).**

**`ShotWorkspace.jsx:133-152`** — third mechanism, and internally inconsistent: batch path passes `styleLockFragment: (lock&&lock.fragment)||''` (`:145`, server-side join), single path does `prompt + ', ' + lock.fragment` (`:149`, client-side join with a hardcoded `', '` instead of `joinFragment`). Refs seed from `sh.cast`/`sh.loc` in the constructor (`:27-30`).

**Server seam:** `backend/batches.mjs:58` — `composedPrompt = snapshot.prompt + ' ' + snapshot.styleLockFragment`. Note the space vs. ProjectGenerate/ManualComposer's `joinFragment` (comma-aware) vs. ShotWorkspace's `', '`. Three join grammars for one operation.

**Refs → provider:** `backend/generate.mjs:113,201` — `refInputs` `{scope,name,folder}` resolve to hosted https urls. This is the genuinely cheap, image-by-reference path and it already works.

## 3. Prose vs. reference — the actual verdict

### What already works (reference, cheap)

- **The Index.** `agentHome.locksForProject()` (`agentHome.mjs:205-213`) emits **ids only** — `locks.style = data.styleLock`. `renderIndex()` (`:255-263`) renders `locks: style=<id>`. Nothing restated.
- **The router skill's "one law"** (`backend/skills/frameforge-router/SKILL.md:17-33`) states the doctrine precisely: prompts carry action/framing only, locks ride by id, and "Never paste a record's contents into prose."
- **Mid-session lock changes** are id-only system events: `ProductionPanel.notify()` (`ProductionPanel.jsx:98-111`) posts `'style-lock changed: ' + id`.
- **`ProductionPanel.jsx` is the contextrail the user is asking for and it already exists** — `renderUnderstanding` / `renderLockedStyle` / `renderBoard('CAST') / renderBoard('LOCATIONS')` / `renderLookSheets` (`:310-314`). It is a pure read-through of records, renders ref images through the shared `RenderMedia`, and the LLM never writes it (header comment `:1-24`). 290px rail, collapsible, persisted via `api.saveUiState({prodPanelCollapsed})` (`:92-96`).
- **Cast/location as image refs**, `ManualComposer.effectiveRefs():120-129` → `generate.mjs:201`.

### What is prose today (token cost)

1. **`GET /api/stylelocks` returns the whole fragment body to the agent.** `listLocks()` `stylelocks.mjs:41` and `getLock()` `:50` both do `{...data, fragment: content.trim()}`; the route is unfiltered (`:250`). The Core-API reference the agent reads *describes* it as "ids + summaries, composed at generate time" (`agentHome.mjs:226`) — **that description is false.** One `GET /api/stylelocks` puts every lock's full style prose in the agent's context. This is the single largest gap between the doctrine and the code.

2. **`projectUnderstanding()` injects brief + memory verbatim, every session.** `backend/chat.mjs:34-46` builds `<frameforge-project-understanding>` with the full brief and the full memory body; `agentRunner.mjs:239-240` appends it to `--append-system-prompt`. Uncapped — no length clamp anywhere in that path.

3. **`contextForAgent()` (`backend/store.mjs:511-527`) inlines up to 6000 chars per note/text/link asset**, plus a line per binary. Used only by the legacy reroll job (`backend/jobs.mjs:302`, prompt built at `:299-325`), **not** by the chat. Worth stating explicitly because it looks like the chat context path and is not.

4. **Every generation still ships the style as prose.** All three composers concatenate `lock.fragment` into the prompt string. That is correct for the *model* (image models take text), but it means the lock's prose is re-serialized on every single generate rather than referenced — and `ProjectGenerate` additionally dissolves it into editable `state.style` so the lock stops being identifiable as a lock.

5. **A lock's ref image is never sent as a generation reference.** `refImagePath()` exists (`stylelocks.mjs:52-57`) and the UI shows it everywhere (`ProductionPanel.jsx:186`, `cards.jsx:84`, `StyleLockPicker.jsx:65`), but no composer pushes it into `refs[]`. The cheapest possible style transfer — the image — is display-only.

6. **Shot `cast`/`loc`/`look` are dead on the backend.** `grep -an cast backend/story.mjs backend/generate.mjs backend/batches.mjs` → zero hits. Only `ShotWorkspace.jsx:27-30` reads them, client-side, to seed refs. The router is told to set them (`agentHome.mjs:225`) but nothing composes them at generate time.

## 4. Contract drift — router skill vs. emitter

`SKILL.md:38-46` documents the injected block as:
```
<frameforge-manifest>
locks: style=<id|none> cast=[ids] loc=[ids] looks=[ids]
tools: … 
models: <the four defaults: preview/render/edit/video, plus enabled kinds>
</frameforge-manifest>
```
`agentHome.renderIndex():255-293` actually emits `<frameforge-index>` with `api:` / `project: … mode: …` / `locks: style=<id>` / `## Skill packs` / `## Tools` / `## Core API`. `indexInjection()` (`:547-555`) calls it "the Index".

Divergences: **the tag name differs** (`manifest` vs `index`); **cast/loc/looks lock lines do not exist**; **there is no `models:` line at all** — yet SKILL.md tells the agent "the Manifest wins" (`:14`) and `models` is where the user's wish #2 (model spec drives the UI/agent) would land. This is a live source-of-truth violation in the exact area this ticket covers.

## 5. What would need to change

- **Redact the fragment on the list route.** `GET /api/stylelocks` should return `{id,name,tags,model,picks,refImage}` and a `fragmentChars` count; add a `?full=1` or a separate compose route for the app's own composers. Makes `agentHome.mjs:226`'s summary true.
- **Reconcile SKILL.md's `<frameforge-manifest>` to `renderIndex()`'s `<frameforge-index>`** (one of the two is wrong; the emitter is canonical per CLAUDE.md's HTTP-contract rule). Extend `locksForProject()` to carry cast/loc/look ids and add the `models:` line if the doctrine is to be honoured, or delete those lines from SKILL.md.
- **One composer, one join grammar.** `joinFragment` (`frontend/lookBuilder.js:122`) already exists and is correct; `ShotWorkspace.jsx:149`'s `', '` and `batches.mjs:58`'s `' '` are the two strays. This is the contextrail's slice of the composer unification.
- **Promote cast/locations to real records with ids** if "referenced by id" is to mean anything for them — today they are `folder/name` strings, so `ManualComposer` can only guess with `items[0]`.
- **Send the style lock's ref image as a generation ref** where the model supports it (`refImagePath` already resolves it).
- **Make `ProjectGenerate` stop dissolving the lock into `state.style`** — that is why the same lock is a visible pill in ManualComposer and invisible in the Generate console.

## 6. Boundaries with existing specs

- `docs/specs/filmmaker-chat/issues/13-production-panel.md` **already specced and shipped** the visual context rail. This effort must not re-spec it — it should generalise it: the rail is chat-only today (`frontend/Chat.jsx:717`), and the same locked-context surface is absent from ProjectGenerate and ShotWorkspace, which is exactly the whole-app scope rule.
- `docs/specs/design-reconciliation/` ticket 05 owns low-level primitives. The lock **pill** (`ManualComposer.jsx:248-256`, `border-radius:999px`) and the dashed empty state (`ProductionPanel.jsx:198`) are ticket-05 surface. The **lock rail as a feature-level component** — SectionHead + locked-style card + board grid + look sheet, `ProductionPanel.jsx:56-62,170-283` — is this effort's.

---

I have what I need. Writing the census.

---

# COMPOSER CENSUS — three surfaces, one operation

## 0. Corrections to the brief (verify before planning)

| Brief claim | Actual |
|---|---|
| "`docs/specs/design-reconciliation/` (10 tickets)" exists | **Not on `main`.** `git ls-tree -r main --name-only \| grep docs/` returns only `filmmaker-chat` + `source-of-truth-reconciliation`. The 10 design tickets live on the unmerged branch `reconcile/design-system`. Ticket 05 is `05-ui-primitives.md`, not `05-shared-primitives.md`. `docs/DESIGN.md` was written in `ea27627` on that same branch and **does not exist on disk**. |
| "only ProjectGenerate.jsx imports ModelPicker/FormatControls" | **ModelPicker has 2 importers.** `PromptBuilder.jsx:11` also imports `{ ModelPicker, modelName }` and mounts it at `:531`. `FormatControls` has 2: `ProjectGenerate.jsx:47` and `SchemaForm.jsx:24` (as its fallback). The correct statement: **ShotWorkspace imports neither, and ManualComposer reaches FormatControls only transitively through SchemaForm.** |
| Three surfaces | There is a **fourth** model chooser at `App.jsx:1692` (`renderProjSettings`, `enabledCatalog(...).filter(g => g.kind === 'preview' \|\| g.kind === 'render')`) — not a composer, but it is a 4th hand-rolled model list and it sets `proj.model`, which two of the three composers read as their default. |

---

## 1. ProjectGenerate.jsx — "Quick Generate" (1402 lines)

**Composer:** `renderComposer()` **811–940**, pill row `renderPillRow()` **946–978**, button `generateButton()` **985–999**, pill shell `pill()` **1014–1035** / `popoverShell()` **1041–1045**, popover atoms `popHead/popChip/popInput` **1046–1062**, popover bodies **1068–1148**.

| Control | Lines | Hand-rolled vs imported |
|---|---|---|
| media switch (IMAGE/VIDEO segmented) | 838–848 | **hand-rolled**, unique to this surface |
| prompt | 870–880 | `SnippetText` (shared) + `VoiceInput` 851 |
| enhance quick/full + undo | 852–858 | **hand-rolled**, unique |
| refs (chips + `+ Reference n/4` + collapsible pool + drag-drop well) | 887–935; drag 822–831, `attach()` 336–344, `attachGen()` 348–356 | **hand-rolled** |
| model | pill 960 → `modelPopover()` **1068–1078** | **imported** `ModelPicker` (line 47) |
| style / camera | pills 961–962 → `StyleLab` overlay 737–740 | shared `StyleLab` + `lookBuilder`; unique to this surface |
| format (aspect/resolution) | pill 963 → `formatPopover()` **1090–1102** | **imported** `SchemaForm`, which falls back to `FormatControls` |
| batch | pill 964 → `batchPopover()` **1105–1125** — `[1,2,4,8]` + spend ceiling | **hand-rolled** via `popChip`, *not* `FormatControls showVariants` |
| seed / target shot | pill 965 → `morePopover()` **1129–1148** | **hand-rolled** via `popInput`, *not* `FormatControls showSeed` |
| cost readout | 969–974 | **hand-rolled** |

**State shape** (85–121, generation-relevant subset):
```js
{ prompt, model:'', aspect:'16:9', resolution:DEFAULT_RESOLUTION, seed:'', refs:[],
  modelParams:{}, media:'image', style:emptyStyle(), camera:emptyCamera(),
  studio:null, popover:null, refsOpen:false, shot:null,
  variantCount:1, maxSpend:'', busy, enhancing, undo, confirmSpend }
```
Flat. `aspect`/`resolution`/`seed` are **top-level**, so `formatPopover()` has to adapt at 1097–1100 (`value:{aspect,resolution}` in, `v => setState({aspect:v.aspect, resolution:v.resolution})` out).

**Payload** `go()` 493–502 / `queueBatch()` 460–480. Unique guards no other surface has: `billModel()` 219–222 (FAL t2i→edit reroute), `CONFIRM_SPEND` two-press arming 55/427–452, `⌥2/4/8` batch shortcut 642–650, `needsRefFrame()`/`blockReason()` 248–257.

---

## 2. chat/ManualComposer.jsx — vertical stacked form (327 lines)

**Composer:** whole file. `render()` **270–326**, model picker `renderModelPicker()` **209–241**, locks `renderLocks()` **243–268**.

| Control | Lines | Hand-rolled vs imported |
|---|---|---|
| output kind (image/video/music/voice/sfx) | `OUTPUT_KINDS` **43–49**, rendered **278–281** | **hand-rolled**; the only surface with the 5 audio-inclusive kinds |
| model | **209–241** + `modelsForKind()` **54–57**, `defaultModelFor()` **60–66** | **hand-rolled**, a full 32-line re-render of `ModelPicker`'s row (compare `ManualComposer.jsx:226–235` against `GenerationControls.jsx:57–66` — same ✓/label/provider·note/`$cost` layout, different padding: `7px 11px` vs `7px 13px`). Stated reason at **:21–22**: `ModelPicker`'s `video` prop is boolean-only and cannot isolate a single kind or the audio kinds. |
| prompt | **288–293**, `<textarea rows={2}>` with kind-aware placeholder | **hand-rolled** (no `SnippetText`, no `VoiceInput`, no enhance) |
| refs | **none rendered.** `effectiveRefs()` **122–130** pulls from `props.getAttachmentRefs()` (Chat's tray) + auto cast/loc | delegated outward |
| settings/format | **296–302** | **imported** `SchemaForm` with `format={{ value:S.format, showSeed:true, aspects: isVisual()? undefined : ['1:1'] }}` |
| variants | `VARIANTS=[1,2,4]` **:51**, rendered **304–310** | **hand-rolled**; deliberately outside SchemaForm (**:14–15**) |
| locks rail (style/cast/loc pills, toggle-off) | **243–268** | **hand-rolled**; unique — this is the closest thing in the app to the user's wished-for context rail |
| cost + Generate | **316–323** | **hand-rolled** |

**State shape** (81–91):
```js
{ outKind:'image', model:defaultModelFor(...), prompt:'', variantCount:1,
  format:{ aspect:'16:9', resolution:DEFAULT_RESOLUTION, seed:'' },
  modelParams:{}, excludeLocks:{}, pickerOpen:false, busy:false }
```
**Nested** — `format` is a sub-object, matching `FormatControls`' contract directly. This is the shape ProjectGenerate has to adapt to.

**Payload** `submit()` **156–207**. Adds `sessionId` (ticket 22 cost attribution) and a follow-up `api.chatManualTurn()` — no other surface does either. `paramsField()` **132–140** is a **byte-equivalent copy** of `ProjectGenerate.paramsField()` 226–234. `needsRefFrame()` **145–149** is a copy of `ProjectGenerate` 245–248.

---

## 3. ShotWorkspace.jsx — docked one-line bar (569 lines)

**Composer:** docked bar **309–382**. Ref picker `renderRefPick()` **458–488**.

| Control | Lines | Hand-rolled vs imported |
|---|---|---|
| prompt | **310–316** | `SnippetText` (shared), but with its own `promptBig` focus-grow (`height: 38 → 110`, **:34/:316**) — unique |
| refs | chips **319–327**, `+ Ref` **328–333**, picker **458–488** | **hand-rolled**, third implementation. Seeded from the shot's cast+loc in the constructor **26–29** — no other surface does this |
| look/style lock | **336–356** | **hand-rolled**, per-shot lock popover — not `StyleLab`, not `lookBuilder`. Writes to the server (`setLook()` **59–64**) rather than local state |
| model | **357–364**, native `<select>` + `<optgroup>` over `enabledCatalog` | **hand-rolled** — a raw `<select>`. No cost, no provider label, no note |
| aspect | **365–368**, native `<select>` over a **local `ASPECTS` const at `:16`** | **hand-rolled**. `frontend/ShotWorkspace.jsx:16` is a byte-identical duplicate of `frontend/GenerationControls.jsx:24`: `['16:9','2.39:1','9:16','1:1','4:5']` |
| resolution | **absent** | — |
| variants | **369–374**, `[1,2,4]` segmented `×1/×2/×4` | **hand-rolled**, third vocabulary |
| seed | **absent** — hardcoded `baseSeed:null` :145, `seed:null` :150 | — |
| cost | **absent** — no `estCost` import anywhere in the file | — |
| Generate | **377–380** | **hand-rolled**, `⚡ Generate ×N` |
| escape hatch | **375–376** `Full composer →` | admits the bar is a subset |

**State shape** (30–38):
```js
{ cur, zoom, details, draft, prompt, promptBig, refs, refPick,
  model:'', aspect:'16:9', variants:1, busy:false }
```
Flat, and **`variants` not `variantCount`** — a third name for the same integer.

**Payload** `generate()` **133–159**. Critically divergent: **:149** composes the style fragment as `prompt + ', ' + lock.fragment`, a raw comma join, while **:145** sends `styleLockFragment` to the server for the batch path. This is exactly the single/batch byte-divergence that `ProjectGenerate.jsx:466–473` and `ManualComposer.jsx:165–169` both explicitly document as a bug they avoid via `joinFragment`. **ShotWorkspace still has it.** It also patches the shot (`:153–155`) — no other surface does.

---

## 4. The three vocabularies, side by side

| Concept | ProjectGenerate | ManualComposer | ShotWorkspace |
|---|---|---|---|
| batch state key | `variantCount` | `variantCount` | **`variants`** |
| batch label | `BATCH` pill, `1×/2×/4×/8×` | `VARIANTS` head, `1×/2×/4×` | bare segmented `×1/×2/×4` |
| batch options | `[1,2,4,8]` :1111 | `[1,2,4]` :51 | `[1,2,4]` :370 |
| model UI | shared `ModelPicker` popover | hand-rolled popover, kind-filtered | native `<select>` |
| aspect UI | chips (via `FormatControls`) | chips (via `SchemaForm`→`FormatControls`) | native `<select>`, local `ASPECTS` |
| resolution | yes | yes | **no** |
| seed | `⋯ MORE` popover | `showSeed:true` in `format` | **no** |
| cost | `$0.000` + armed-confirm | `est $x.xx` | **none** |
| style | `StyleLab` + `lookBuilder` (8 axes) | `LOCKS APPLIED` toggle pills | per-shot look `<select>`-ish popover |
| output kind | 2-way `image|video` | 5-way `image|video|music|voice|sfx` | implicit (whatever the model is) |
| prompt widget | `SnippetText` + voice + enhance | bare `<textarea rows=2>` | `SnippetText`, focus-grow |
| refs | 4th impl (pool strip + drag well) | none (delegates to Chat tray) | 3rd impl (grid picker, cast/loc seeded) |
| chip radius | `border-radius:6px` :1051 | `border-radius:7px` :70 | n/a |

`Chip` is defined **three** times with three radii: `GenerationControls.jsx:35` (6px), `ManualComposer.jsx:68` (7px), `ProjectGenerate.popChip:1048` (6px, method not component). `Head`/eyebrow is defined **three** times: `GenerationControls.jsx:31`, `SchemaForm.jsx:38`, `ManualComposer.jsx:72`, plus `ProjectGenerate.popHead:1046` — four.

`paramsField()` exists twice, identical: `ProjectGenerate.jsx:226–234`, `ManualComposer.jsx:132–140`.
`needsRefFrame()` exists twice, identical: `ProjectGenerate.jsx:245–248`, `ManualComposer.jsx:145–149`.

---

## 5. Proposed `<Composer>` prop contract

The union of all three, expressed as one controlled component. Nothing here invents catalog data — `modelCatalog.js` stays canonical.

```jsx
<Composer
  density="full" | "stacked" | "bar"

  // ── value (ONE nested shape; adopt ManualComposer's, it already matches FormatControls) ──
  value={{
    outKind,                       // 'image'|'video'|'music'|'voice'|'sfx'
    model,                         // '' = fall to defaultModel
    prompt,
    refs: [],                      // [{kind:'asset'|'render', scope, name, folder, key?, gen?}]
    format: { aspect, resolution, seed, duration },
    variantCount,                  // ONE name. kill `variants`.
    maxSpend,
    modelParams: {},               // SchemaForm output
    style, camera                  // lookBuilder selections (may be null)
  }}
  onChange={next => …}             // full merged object, FormatControls idiom
  onSubmit={value => …}            // surface owns the API call — see §7

  // ── catalog scoping ──
  settings                         // drives enabledCatalog
  outKinds={['image','video']}     // which kinds this surface offers; default all five
  defaultModel                     // resolved fallback (proj.model / modelDefaults / DEFAULT_*)
  variantOptions={[1,2,4,8]}

  // ── control visibility (NOT restyling — same components, fewer of them) ──
  show={{ outKind, style, camera, refs, seed, maxSpend, cost, enhance, voice, snippets }}

  // ── refs: owned or delegated ──
  refsMode="internal" | "external" // ManualComposer needs "external"
  refPool                          // context items for the internal picker
  getExternalRefs                  // ManualComposer's getAttachmentRefs
  maxRefs={4}

  // ── the context rail (user wish #4) ──
  locks={[{ key, kind:'style'|'cast'|'loc'|'look', label, thumb, on }]}
  onToggleLock={key => …}

  // ── surface-specific ──
  targetShot                       // ShotWorkspace pins it; ProjectGenerate offers it in ⋯
  onTargetShotChange
  blockReason                      // or let Composer compute it — see §6
  busy
  submitLabel                      // 'Generate' | '⚡ Generate ×N' | 'Queue N×'
  extras                           // slot: 'Full composer →', enhance row, iterate ghost band
/>
```

**Density variants — what each actually means (all three stay dense; none get roomier):**

| | `full` (ProjectGenerate) | `stacked` (ManualComposer) | `bar` (ShotWorkspace) |
|---|---|---|---|
| layout | prompt + horizontal pill row | vertical labelled sections | single wrapping row under prompt |
| settings surface | pills → popovers | inline expanded | pills → popovers (upward) |
| eyebrows | inside popovers only | above every field | none |
| height | ~4 bands | ~8 sections | 2 rows (**hard constraint**) |

The `bar` variant is `full`'s pill row with `show.style/camera/seed/maxSpend = false` and popovers opening **upward** (`bottom:100%`) — which `ManualComposer.jsx:221` already does (`bottom:100%;margin-bottom:6px`). That mechanism exists; it just isn't shared.

**Must move into the shared component (not props):**
- `paramsField()` — currently duplicated 2×
- `needsRefFrame()` / `blockReason()` — currently duplicated 2×
- the `joinFragment` style composition — currently correct in 2 of 3, **broken in ShotWorkspace:149**
- `Chip` / `Head` — currently 3× and 4×
- `ASPECTS` — currently 2×; delete `ShotWorkspace.jsx:16`

---

## 6. Where the three genuinely differ (keep) vs arbitrarily (kill)

**Genuine — keep as density/prop, do not flatten:**

1. **ShotWorkspace's bar must stay one line tall.** `:309` is `flex:none` inside a `flex-direction:column` stage; the stage frame at `:413` is `flex:1;min-height:0`. Growing the bar shrinks the image being reviewed. Non-negotiable.
2. **ManualComposer's 5 output kinds.** `music`/`voice`/`sfx` (`:43–49`) route through `modelKind`, which the other two never expose. The `video` boolean on `ModelPicker` (`GenerationControls.jsx:50`) genuinely cannot express this — **the shared picker needs a `kinds` array prop, and that is a real gap, not laziness.**
3. **ManualComposer has no ref picker.** Chat owns an attachment tray (ticket 18); duplicating it inside the composer would be a second tray. `refsMode="external"` is correct.
4. **ShotWorkspace seeds refs from the shot's cast+loc** (`:26–29`) and **patches the shot on generate** (`:153–155`). Shot-scoped behaviour, correctly local.
5. **ProjectGenerate's spend arming** (`CONFIRM_SPEND` 55, 444–452). It is the only surface offering 8× — an 8× video is $3.20. Ship it as `confirmAbove={1.00}`, default off.
6. **ProjectGenerate's `billModel()`** (219–222) FAL t2i→edit reroute. Real provider behaviour, belongs in the shared cost path — the other two under-report cost because they lack it.
7. **`promptBig` focus-grow** (`:316`) is the one-line bar's answer to a multi-line prompt. Keep as a `bar`-density behaviour.

**Arbitrary — reconcile:**

1. `variants` vs `variantCount` — pick `variantCount`.
2. `[1,2,4]` vs `[1,2,4,8]` — one `variantOptions` prop.
3. `BATCH` / `VARIANTS` / `×N` — pick one word. `VARIANTS` reads correctly for both a single and a batch; `BATCH` is a lie at 1×.
4. Chip radius 6px vs 7px; eyebrow defined 4×.
5. Native `<select>` for model and aspect in ShotWorkspace (`:357`, `:365`) vs chips/popovers everywhere else. No reason — `ModelPicker` renders a body and the caller supplies the trigger (`GenerationControls.jsx:43`), which is exactly what a compact bar needs.
6. ShotWorkspace showing **no cost at all** while queueing up to 3 takes. It does not import `estCost`.
7. ShotWorkspace having **no resolution and no seed**, so a take generated from the shot bar cannot be reproduced or matched to one from Quick Generate.
8. `ShotWorkspace.jsx:149`'s raw `', '` join vs `joinFragment` — a real defect, documented as avoided in the other two.
9. `ManualComposer.jsx:226–235` re-rendering `ModelPicker`'s row body verbatim at different padding.

---

## 7. One thing the contract must NOT swallow

All three call the API differently and for good reason: ProjectGenerate `api.generate|createBatch` + shot linkage + `select(gen.id)`; ManualComposer adds `sessionId` + `api.chatManualTurn`; ShotWorkspace adds `api.patchShot`. **`<Composer>` should emit `onSubmit(value)` and own zero I/O** — the same discipline `GenerationControls.jsx:6–10` already states for `ModelPicker`/`FormatControls` ("they own no fetching and no persistence"). That contract is the reason those two are reusable; extend it, don't break it.

## 8. Boundary with the design tickets

`reconcile/design-system` ticket 05 (`frontend/ui.jsx`: `Btn`/`Card`/`Eyebrow`/`Empty`/`Field`) is **strictly below** this effort. `<Composer>`'s Generate button should *be* `<Btn variant="primary">`; its eyebrows should *be* `<Eyebrow>`; the four `Head` definitions collapse into it. The overlap is exactly one thing — **`Chip`, which ticket 05 does not cover and this effort needs 3× over.** Either ticket 05 grows a 6th primitive or `<Composer>` exports it. Say which; do not let both ship one.

That branch is **unmerged**. If `<Composer>` is built on `main` first, it will hardcode hex literals that ticket 01's token layer then has to unpick. Sequence this deliberately.

---

## CENSUS — result / review surfaces

### 0. Corrections to the brief

- **`docs/specs/design-reconciliation/` does not exist.** `docs/specs/` contains exactly two entries: `filmmaker-chat/` and `source-of-truth-reconciliation/` (verified by `ls`). Any claim about "ticket 05 covers Btn/Card/Eyebrow/Empty/Field" cannot be grounded. The primitives boundary must be asserted by this effort, not deferred to a spec that isn't on disk.
- **"32 files touch these verbs" is loose-regex noise.** Measured precisely:
  - **5 files issue review/reroll/route writes**: `ProjectGenerate.jsx`, `ShotWorkspace.jsx`, `App.jsx`, `chat/generationCards.jsx`, (+`App.jsx:2356` batch retry).
  - **7 files read decision state** (`reviewState|selectedCandidate|.final`): `App.jsx`(10 hits), `ProjectGenerate.jsx`(11), `chat/generationCards.jsx`(16), `ShotWorkspace.jsx`(3), `chat/shotBoardCard.jsx`(3), `ReviewInbox.jsx`(2), `Story.jsx`(2).
  - 30 frontend files match a bare `keep|kill` grep; the remainder are English prose in comments.

---

### 1. Canonical data model (backend — the contract all five surfaces must serve)

`backend/generate.mjs`:
- **`reviewState`** — 4 values, not 3. `'pending'` at creation (`:114`), flipped to `'new'` on completion (`:275`), then `'kept'` / `'killed'` by `reviewCandidate` (`:348`).
- **`final`** — an *orthogonal boolean*, not a reviewState. `:114` `final: false`.
- **`rating`** — 0–5, `:114`.
- **`shot.selectedCandidate`** — *derived*, written only by `syncShotSelection` (`:331`).
- Writable patch keys are exactly `['reviewState','rating','final','note','label']` (`:354`). A sixth field does not exist.
- `saveToShot(pid,id,shot,{final})` (`:416`) is **not a separate verb** — `:423` it calls `reviewCandidate(pid,id,{reviewState:'kept', final:!!final})`. Keep-to-shot IS keep.

`syncShotSelection` (`:331–342`) is the source of every vocabulary divergence below:
```
:335  if (gen.final && gen.reviewState === 'kept')  → selectedCandidate = gen.id; shot.status = 'done'
:339  else if (kept)  if (!sh.selectedCandidate) { patch.selectedCandidate = gen.id }   ← implicit promotion
:341  else if (killed && sh.selectedCandidate === gen.id) → selectedCandidate = null
```
`:339` means **the first kept take of a shot becomes `selectedCandidate` with `final === false`.**

---

### 2. The five surfaces

| | ProjectGenerate results grid | ShotWorkspace take strip | ReviewInbox | chat/generationCards | App.jsx (host) |
|---|---|---|---|---|---|
| file:line | `ProjectGenerate.jsx:1150–1308` (grid), `:1311–1399` (preview panel), `:758–801` (zoom) | `ShotWorkspace.jsx:266–294` (strip), `:405–455` (stage) | `ReviewInbox.jsx:88–115` (stage), `:160–172` (hints) | `generationCards.jsx:107–145`, `:194–402` | `App.jsx:946–1015` (verbs), `:1109–1146` (keymap) |
| layout | 180px auto-fill grid + filter chips + sticky bulk bar | 118×66 filmstrip + one big stage | one full-viewport stage, no grid | 120px thumb + meta row (single); `√n`-col grid capped at 4 (batch, `:351`) | none (logic only) |
| status source | `reviewBadge(g)` `:75–80` — reads the record | `takes()` `:80` — reads record + `sh.selectedCandidate` | `IB.decisions[key]` `:91` — **session-local**, + `cand.final` `:111` | `g.reviewState` direct `:109–110` | writes only |

**Status vocabulary, verbatim strings:**

| meaning | ProjectGenerate | ShotWorkspace | ReviewInbox | chat cards |
|---|---|---|---|---|
| done, undecided | `NEEDS REVIEW` `:79` | *(no badge)* | *(no badge)* | *(no badge)* |
| kept | `KEPT ✓` `:77` | `KEPT ✓` `:427` | `KEPT ✓` `:108` | `Kept ✓` `:123` + `✓` chip `:141` |
| killed | `KILLED ✕` `:78` | **row removed entirely** `:78` | `KILLED ✕` `:108` | `Rejected ✕` `:124` + `✕` chip `:142` |
| final | `FINAL ✓` `:77` (`g.final`) | `FINAL ✓` `:426` / `FINAL` `:286` (`sh.selectedCandidate`) | `FINAL ✓` `:108`, `FINAL` `:111` | **absent — no final concept** |
| rating | display only `:1275`, filter `:1199` | display only `:428` | display only `:104` | **read+write** `Stars` `:94–103` |

**Action sets:**

| action | ProjectGenerate | ShotWorkspace | ReviewInbox | chat single | chat batch |
|---|---|---|---|---|---|
| keep | `k` `:712`, `Keep (k)` `:784`/`:1365`, bulk `:1239` | `K` `:121`, `✓ Keep (K)` `:446` | `k` (App`:1134`) | `Keep` toggle `:123` | per-cell `:377` |
| kill | `x` `:713`, `Kill (x)` `:1373`, bulk `:1240` | `X` `:122`, `✕ Kill (X)` `:449` | `x` (App`:1135`) | `Reject` toggle `:124` | per-cell `:377` |
| final | **absent** | `L` `:120`, `★ Final (L)` `:445` | `l` (App`:1137`) | **absent** | **absent** |
| re-roll | `r` `:714`, `Re-roll (r)` `:785`/`:1366` | `R` `:123`, `↻ Re-roll (R)` `:448` | `r` (App`:1139`) | `Reroll` `:261` | `Retry failed` `:388` |
| rate | filter only | display only | `1`–`5` (App`:1136`) | `Stars` `:125` | `Stars` `:377` |
| use-as-ref | `d` `:711`, `Use as reference` `:783`/`:1369` | **absent** | **absent** | **absent** | **absent** |
| zoom | `f` `:710`, `⤢` `:1282`, dblclick `:1300` | `F` `:119`, dblclick `:417` | **absent** | click → `RenderLightbox` `:236` | cell click, `←/→` nav `:319` |
| route/send | `a` `:716`, `Send…` picker `:1378–1395` | **absent** | `a` → popover `ReviewInbox:189–206`, `S`/`B`/`L` (App`:1118–1120`) | `Save to shot` `:259` | **absent** |
| note→reroll | **absent** | **absent** | `n` `:174–187` | **absent** | **absent** |
| delete file | `Delete file` `:1374`, bulk two-step `:324–334` | **absent** | **absent** | **absent** | **absent** |
| reveal in Finder | **absent** | `⌖ Reveal in Finder` `:437` | `o` (App`:1142`) | **absent** | **absent** |
| open elsewhere | — | `Full composer →` `:375` | — | `Open in review` `:258` | `Review these` `:386` |

Same letter, three owners: `k`/`x`/`r` are bound by `ProjectGenerate.onKey` (`:712–714`), `ShotWorkspace.onKey` (`:121–123`), and `App.onKey` (`:1134–1139`) — all three attach **capture-phase** listeners (`ProjectGenerate` via its own `onKey`, `ShotWorkspace.jsx:42` `addEventListener('keydown', …, true)`, App as host). `l`/`n`/`p`/`o` route through `keymap.js:19–26` (user-overridable `settings.keys`) in App and ReviewInbox; **ProjectGenerate and ShotWorkspace hardcode their letters and ignore `settings.keys` entirely.**

---

### 3. Where the vocabulary DIVERGES IN MEANING (not just wording)

1. **`FINAL` means two different things.** `ProjectGenerate.jsx:77` reads `g.final`. `ShotWorkspace.jsx:80` defines `hero: sh.selectedCandidate === g.id` and `:286`/`:426` labels it `FINAL`. Because of `generate.mjs:339`, the *first kept* take gets `selectedCandidate` with `g.final === false`. **The same take reads `KEPT ✓` in the results grid and `FINAL ✓` in the shot workspace, simultaneously.** This is the single worst divergence in the census.
2. **`Kill` vs `Reject`** — identical write (`{reviewState:'killed'}`, `ProjectGenerate:556`, `ShotWorkspace:181`, `generationCards:74`), three labels: `Kill (x)`, `✕ Kill (X)`, `Reject`. The keymap id is `kill` (`keymap.js:20`).
3. **Killed is destructive-looking in one surface only.** `ShotWorkspace.takes()` `:78` `continue`s on `reviewState === 'killed'` — the take disappears from the strip with no undo affordance. Everywhere else killed is a filterable, reversible badge (`ProjectGenerate:1197`; `generationCards:73` re-click un-decides).
4. **Rating silently implies keep — in three different ways.** `App.ibRate:974` and `generationCards.ratePatchFor:80–83` both send `reviewState: cur === 'new' ? 'kept' : cur`. `ProjectGenerate` cannot set a rating at all yet *filters* on it (`:1199, :206`) — a filter over a value its own surface can never produce.
5. **ReviewInbox badges session state, not record state.** `:91` `IB.decisions[...]`, `:106–110`. A candidate already killed in chat or the grid shows **no badge** in the inbox until re-decided there. Only `cand.final` (`:111`) reads through to the record.
6. **`reviewState: 'pending'` (`generate.mjs:114`) is unhandled by every frontend surface.** All five treat "not done" via `status`, and every `'new'` filter (`App:846`, `:795`, `:1282`; `ProjectGenerate:203`, `:1157`) requires `status === 'done'` — so `'pending'` is dead weight, an undocumented fourth value that only exists between queue and completion.
7. **Three incompatible video oracles, while `RenderMedia` exports one.** `RenderMedia.jsx:25` `VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)$/i` and exports `mediaKind()`. But: `ProjectGenerate.jsx:1297,:1313,:760` use `/\.mp4$/` (no `i`, misses `.mov`/`.webm`), `ShotWorkspace.jsx:69` uses `/\.(mp4|mov|webm)$/i`, `ReviewInbox.jsx:18,:21` uses `/\.mp4$/i` **and does not import `RenderMedia` at all** — it hand-rolls `<video>`/`<img>` at `:101–102`, the exact branch `RenderMedia` was written to delete (see its own header comment, `:1–18`). A `.webm` generation renders as a broken `<img>` in the results grid.
8. **Cost formatting drifts.** `$(g.cost||0).toFixed(3)` (`ProjectGenerate:1291,:1351,:776`), `'$'+Number(t.cost).toFixed(3)` (`ShotWorkspace:441`), `'$'+Number(cand.cost||0).toFixed(3)` (`ReviewInbox:79`) — but `generationCards.costLabel:55–59` is the only one that distinguishes a **ledgered** cost from a `~$… est` catalog estimate. The other three print `$0.000` for an unfinished generation.

---

### 4. Proposed contract

**`<ResultCard>` — one component, three densities.** Densities map 1:1 onto the existing three geometries, so nothing has to become more spacious: `strip` (118×66, ShotWorkspace filmstrip), `grid` (180px min, ProjectGenerate + chat batch — chat's 120px thumb is the same component at `grid` density inside a narrower column), `stage` (full-viewport, ReviewInbox + ShotWorkspace stage).

```jsx
<ResultCard
  gen                        // the canonical generation record — the ONLY status source.
                             // Kills reviewBadge(), takes().kept/hero, IB.decisions-as-badge.
  shot                       // optional; supplies selectedCandidate for the FINAL distinction
  density="strip|grid|stage"
  selected marked            // cursor vs bulk-tick — already distinct in ProjectGenerate:1253–1255
  actions={[...]}            // subset of the ReviewActions vocabulary, surface-chosen
  onAction={(verb, gen) => } // single dispatch point
  slots={{ overlay, footer }}// pass-through to RenderTile:91 — already the right seam
/>
```
Built on `RenderTile`/`RenderMedia`/`RenderLightbox` (`RenderMedia.jsx:86,:38,:118`), which already have the correct slot shape and 10 importers. `ResultCard` supplies the *status chrome* that each of the five surfaces currently re-invents inside those slots. **`mediaKind()` (`RenderMedia.jsx:27`) becomes the only kind test** — the three regexes above get deleted, not reconciled.

**`<ReviewActions>` — one verb vocabulary, one keymap.**
```js
KEEP | KILL | FINAL | REROLL | RATE(n) | USE_AS_REF | ZOOM | ROUTE(shot|board|library) | NOTE | REVEAL | DELETE
```
- Labels are fixed by the verb, not by the surface: `KILL` renders `Kill` everywhere (matching `keymap.js:20`); `Reject` is retired.
- Every binding resolves through `keymap.js` + `settings.keys`. ProjectGenerate's and ShotWorkspace's hardcoded `k`/`x`/`r`/`l`/`f` become `K.keep` etc.
- Verb → API mapping collapses to one module (today it is duplicated at `ProjectGenerate:542–564`, `ShotWorkspace:126–186`, `App:946–1015`, `generationCards:71–83`). `KEEP` on a shot-linked gen must go through `api.saveGenToShot` and otherwise `api.reviewCandidate` — that branch exists identically at `ProjectGenerate:548–549` and `:308–309` and nowhere else; `ShotWorkspace:173` always uses `saveGenToShot` and `generationCards:253` never does.

**Status derivation — one function, replacing four.**
```js
resultStatus(gen, shot) → { key, label, tone }
// 'pending'|'queued'|'running'|'failed'|'needs-review'|'kept'|'selected'|'final'|'killed'
```
`'selected'` is the missing token: `shot.selectedCandidate === gen.id && !gen.final`. Naming it is what stops `ShotWorkspace:286,:426` from lying. Suggested labels: `SELECTED` (implicit, `generate.mjs:339`) vs `FINAL ✓` (explicit, `gen.final`). Both tones already exist in the palette (`#E3FF32` / `#3FCF8E`).

**Boundary with low-level primitives:** `ResultCard`/`ReviewActions` are *feature-level* and own decision semantics. If a Btn/Card/Empty primitive layer is created, `ReviewActions` composes it — the four chip renderers (`ProjectGenerate:1153,:1231,:1314,:762`, `generationCards:173`, `ShotWorkspace:445–449`) are the primitive layer's problem; the *verb set and its meaning* are this effort's.

**Surfaces after:** ReviewInbox = `stage` + `ReviewActions[keep,kill,final,rate,reroll,note,route,reveal]`; ShotWorkspace = `strip`+`stage`, same set minus `note`, and stops hiding killed takes; ProjectGenerate = `grid`, gains `rate` (closing the filter-without-writer gap at `:1199`) and `final`; chat single/batch = `grid`, gains `final`, keeps `Open in review` / `Review these` as navigation, not review.

---

CENSUS — ATOMS. All counts re-measured; several brief figures were wrong and are corrected below.

## CORRECTIONS TO THE BRIEF (verify these before writing tickets)

1. **`docs/specs/design-reconciliation/` DOES NOT EXIST.** `find docs/specs -maxdepth 2 -type d` returns only `filmmaker-chat` and `source-of-truth-reconciliation`. `rg "design-reconciliation" .` → exit 1, zero hits repo-wide. There is no "ticket 05 covering Btn/Card/Eyebrow/Empty/Field", and `rg "export (function|const) (Btn|Card|Eyebrow|Empty|Field|Pill|Chip|Head)"` over `frontend/` → exit 1. **No low-level primitive layer exists.** The instruction to "complement, not duplicate" that spec has no referent — this effort must either own the primitives or explicitly defer them. Do not write tickets that cite it. (`source-of-truth-reconciliation` has 8 tickets, all backend/data; its 05 is `05-folders-control-file.md`.)

2. **"Only ProjectGenerate imports ModelPicker/FormatControls" is wrong.** There are 3 importers of `GenerationControls.jsx`: `ProjectGenerate.jsx:47` (ModelPicker, FormatControls, ASPECTS, modelName), `PromptBuilder.jsx:11` (ModelPicker, modelName), `SchemaForm.jsx:24` (FormatControls). Adoption is better than stated; the gap is ShotWorkspace + ManualComposer only.

3. **ManualComposer's non-adoption is a documented functional gap, not neglect.** `ManualComposer.jsx:21-22`: "ModelPicker's own filter is video-vs-not only (it cannot isolate a single kind or the audio kinds), so this surface filters enabledCatalog by kind itself". `GenerationControls.jsx:49` confirms: `video` prop is tri-state boolean only. **Any migration ticket must first add a `kinds` prop to ModelPicker** — otherwise the ticket is unimplementable.

4. **`filmmaker-chat/issues/03-shared-generation-controls.md` is marked `Status: done (2026-07-19)` and carries an explicit DEVIATION section.** It consolidated 4 named surfaces (generate console, style lab, prompt builder, tools-suite catalog card) and documented why StyleLab and ToolsSuite were correctly left alone. **ShotWorkspace was never in its scope.** ToolsSuite's `<select>`s are deliberately NOT enabled-only (`!off.has(m.id) || d[key] === m.id`) — a shared enabled-only picker would regress documented behavior. Do not re-scope these as misses.

---

## FAMILY 1 — MODEL PICKER · 3 implementations, 2 migrate

| # | Impl | file:line | Shape |
|---|---|---|---|
| A | **`ModelPicker`** | `GenerationControls.jsx:54-80` | Grouped popover body, `enabledCatalog`, provider label + `$cost`, checkmark, `defaultRow`, `maxHeight`. Caller owns trigger. |
| B | `renderModelPicker()` | `ManualComposer.jsx:209-241` | Own trigger + popover. Rows at 226-234 are **near-verbatim A:57-66** — same `hRow`, same `rgba(227,255,50,.07)`, same 10px check span, same 11.5/9px label/provider stack, same `toFixed(3)`. Diverges only: `padding:7px 11px` vs A's `7px 13px`; flat list, not grouped. |
| C | native `<select>` + `<optgroup>` | `ShotWorkspace.jsx:358-364` | No cost, no provider, no custom-model awareness beyond `enabledCatalog`. |

**Promote:** A. **Blocker first:** add `kinds` prop (array of catalog `kind` values) to A — B exists solely because A cannot express `['preview','render','edit']` or the audio kinds. **Call sites migrating: 2** (B, C). Not migrating: `ToolsSuite.jsx` ModelCatalog card (management surface, deliberate), `PromptBuilder.jsx:11` + `ProjectGenerate.jsx:47` (already on A).

Cross-family note: B's dead-simple `defaultModelFor`/`modelsForKind` (`ManualComposer.jsx:54-66`) is genuine per-kind logic that belongs *with* A once A takes `kinds`.

## FAMILY 2 — ASPECT / FORMAT · 3 aspect lists, 2 pixel tables

| # | Impl | file:line |
|---|---|---|
| A | **`ASPECTS` (canonical, exported)** | `GenerationControls.jsx:24` — `['16:9','2.39:1','9:16','1:1','4:5']` |
| B | duplicate literal | `ShotWorkspace.jsx:16` — **byte-identical array**, consumed at `:367` |
| C | `ASPECT_MAP` (name→aspect, prompt-side) | `lookBuilder.js:60`, read at `:228`, `:329` — legitimately different concern (cinematic axis name → aspect string); keep |

Pixel math — **two tables, and they disagree**:
- `modelCatalog.js:157` `ASPECT_NUM` + `pixelSize()` at `:161` (canonical, snap-to-16)
- `backend/providers.mjs:32` `ASPECT_WH = {'16:9':[1344,768], '2.39:1':[1376,576], …}` — a hardcoded fallback used at `:132` only when `resolution` is absent. `16:9` → 1344×768 is **1.75, not 1.7778**. Real drift, backend-only.

**Promote:** A + `pixelSize()`. **Call sites migrating: 1** (B → import A). Flag `providers.mjs:32` as a separate correctness ticket — it is a source-of-truth violation under CLAUDE.md's table, not a UI concern. The brief's "23 files" counts every file that merely *mentions* `aspect` (passes it through a payload); only **2 files declare a competing list**.

## FAMILY 3 — BATCH / VARIANTS · 3 controls, 3 vocabularies, 3 option sets

| # | Impl | file:line | Label | Options | Widget |
|---|---|---|---|---|---|
| A | **`FormatControls` `showVariants`** | `GenerationControls.jsx:99-100,140-147` | `VARIANTS` | `[1,2,4,8]` | chips `n×` |
| B | pill + popover | `ProjectGenerate.jsx:964` (`'BATCH'`), popover `:1109-1113` | `BATCH` / `VARIANTS — ⌥2/⌥4/⌥8` | `[1,2,4,8]` | `popChip` |
| C | inline chips | `ManualComposer.jsx:51,304-310` | `VARIANTS` | `[1,2,4]` | local `Chip` |
| D | segmented control | `ShotWorkspace.jsx:369-374` | *(unlabelled)* | `[1,2,4]` | `×n`, joined border box |

Note the token order flips: A/C render `n + '×'` (`4×`), D renders `'×' + n` (`×4`). State key differs too: `variantCount` (A/B/C) vs `variants` (D, `ShotWorkspace.jsx:37,142,145`).

**Promote:** A, with `variantOptions` already parameterized (`:100`) — it can serve `[1,2,4]` and `[1,2,4,8]` unchanged. **Call sites migrating: 3** (B, C, D). B additionally owns the ⌥-digit keybinding (`ProjectGenerate.jsx:635-647`) and `maxSpend` — keep those in ProjectGenerate; migrate only the chip row.

## FAMILY 4 — COST DISPLAY · 6 render sites, 0 shared formatter

`estCost` (catalog) is correctly the single source. The **formatting** is not:

| file:line | Render |
|---|---|
| `GenerationControls.jsx:64` | `'$' + Number(c).toFixed(3)` |
| `ManualComposer.jsx:217` | `'~$' + estCost(cur).toFixed(3)` (trigger) |
| `ManualComposer.jsx:233` | `'$' + estCost(m.id).toFixed(3)` (row) |
| `ManualComposer.jsx:318` | `'est $' + total.toFixed(total >= 1 ? 2 : 3)` |
| `ProjectGenerate.jsx:952` | `n + '× ≈ $' + (cost*n).toFixed(n*cost >= 1 ? 2 : 3)` |
| `ProjectGenerate.jsx:971` | `'$' + cost.toFixed(3)` + accent `$total.toFixed(3)` |
| `confirmCard.jsx:53` | `localEstimate()` — object, formatted by caller |
| `generationCards.jsx:57` | `estCost(g?.model)` |

Three prefixes (`$`, `~$`, `est $`, `≈ $`) and two precision rules (fixed-3 vs the `>=1 ? 2 : 3` conditional, duplicated verbatim at `ManualComposer.jsx:318` and `ProjectGenerate.jsx:952`).

**Promote:** a `fmtCost(n, {prefix})` helper — no component needed, and it belongs in `modelCatalog.js` beside `estCost`/`fmtSize` (which already sets this precedent), **not** in GenerationControls. **Call sites migrating: 6.**

## FAMILY 5 — EMPTY STATE · 58 dashed instances, not 34; only 16 are empty states

`rg "dashed" frontend/` → **58 lines / 28 files**. Classified by hand:

| Sub-family | n | Promotable? | Examples |
|---|---|---|---|
| **True empty state** (centered "nothing here") | **16** | **yes — one `Empty`** | `ControlMaps.jsx:225,233`, `ToolsSuite.jsx:188,194`, `Library.jsx:182,243`, `RemotionLibrary.jsx:293,329`, `ProjectGenerate.jsx:1208,1214`, `Moodboard.jsx:480`, `AssetBoards.jsx:163,243`, `PromptBuilder.jsx:490`, `App.jsx:2516`, `ProductionPanel.jsx:198` |
| **Dropzone** (drag + click to upload) | 8 | yes — separate `Dropzone` | `ControlMaps.jsx:153`, `ToolsSuite.jsx:320`, `VideoImport.jsx:98`, `References.jsx:159`, `FilmEmulation.jsx:178`, `GridSplitter.jsx:309`, `LutApplier.jsx:362,400` |
| Placeholder tile (thumbnail slot) | 5 | maybe | `StyleLocks.jsx:197`, `StyleLab.jsx:345,577`, `App.jsx:2138`, `PromptBuilder.jsx:570` |
| "+ add" affordance | 5 | no — trigger, not container | `Story.jsx:874`, `ShotWorkspace.jsx:330`, `LutApplier.jsx:348`, `PromptBuilder.jsx:231`, `App.jsx:1466` |
| Hint/note box | 4 | no | `StyleLab.jsx:402,509`, `Settings.jsx:261`, `App.jsx:2202` |
| **Dashed separator** (`border-top/bottom`) | 7 | no — unrelated | `SheetComposer.jsx:423`, `ControlMaps.jsx:206`, `CallSheet.jsx:425`, `FilmEmulation.jsx:166`, `GridSplitter.jsx:290`, `LutApplier.jsx:383`, `PromptBuilder.jsx:309` |
| Drag-highlight only | 4 | no | `Library.jsx:132`, `AssetBoards.jsx:142`, `Chat.jsx:548,570` |
| Other (disabled card, ref slot, input) | 9 | no | `toolCards.jsx:22,25,78,132`, `toolRegistry.jsx:50`, `shotBoardCard.jsx:267`, `SchemaForm.jsx:145`, `Tools.jsx:251`, `Moodboard.jsx:518` |

No candidate exists to promote — **all 16 are inline**. Padding varies 14/16/30/34/40/44/52/60/70px, radius 10/12/14/16px, two border tones (`#2A2E36` neutral, `rgba(227,255,50,.4)` amber-for-actionable). **Scope a ticket to the 16, not 34, and not 58.** `chat/toolCards.jsx:22` `Shell({dashed})` is the closest thing to an existing abstraction but is chat-card-specific.

## FAMILY 6 — STATUS CHIP / PILL · 161 occurrences, and a real 4-way state-map fork

`border-radius:99px|999px|borderRadius:99` → **161 occurrences / 31 files** (not 148). Split: `99px` ×142, `999px` ×6, JS-object `99` ×12. Top: `App.jsx` 45, `ToolsSuite.jsx` 16, `Settings.jsx` 14, `Story.jsx` 11, `Moodboard.jsx` 10, `ShotWorkspace.jsx` 8.

**This number is not actionable as one family** — 23 of them are 5-8px pulse dots (`width:[5-9]px;height:[5-9]px;border-radius:99`), the rest split across ref chips, filter tabs, avatars, toggles, buttons. The `99px`/`999px` inconsistency is a token problem, not a component problem.

**The actionable finding underneath it is the status-color map, forked 4 ways:**

| file:line | Keys |
|---|---|
| `ProjectGenerate.jsx:72` | `queued running done failed` |
| `App.jsx:2940` | `queued running done failed` — **byte-identical to ProjectGenerate:72** |
| `App.jsx:2331` | `draft queued running paused done failed cancelled` (batch states, superset) |
| `ShotWorkspace.jsx:18` | `queued running failed` — **missing `done`**; `stC[t.status]` at a done take yields `undefined` |

All four are named `stC`. Separately, `models.js:105` `SHOT_STATUS` is the canonical map for *shot* status (`todo/generating/review/done`, with `fg`+`bd`) — a different axis, correctly separate; consumed by `Story.jsx:829,904` and imported by `ShotWorkspace.jsx:11`.

**Promote:** a `GEN_STATUS` map into `modelCatalog.js`/`models.js` beside `SHOT_STATUS`, superset-shaped (App.jsx:2331's 7 keys), `{fg, bd}` to match SHOT_STATUS's existing shape. **Call sites migrating: 4.** ShotWorkspace's missing `done` key is a live bug worth calling out in the ticket body.

---

## RANKED TICKET INPUT

| Rank | Ticket | Migrating call sites | Blocker |
|---|---|---|---|
| 1 | `ModelPicker` gains `kinds` prop | 0 (enabling) | — |
| 2 | ManualComposer + ShotWorkspace adopt `ModelPicker` | 2 | #1 |
| 3 | `GEN_STATUS` map → `models.js`, 4 `stC` forks deleted | 4 | — |
| 4 | Variant control → `FormatControls showVariants` | 3 | — |
| 5 | `fmtCost()` in `modelCatalog.js` | 6 | — |
| 6 | `ShotWorkspace.jsx:16` ASPECTS → import canonical | 1 | — |
| 7 | `Empty` component, 16 true empty states | 16 | none exists — must be authored |
| 8 | `Dropzone` component | 8 | none exists |
| 9 | *(separate, backend)* `providers.mjs:32` ASPECT_WH drift | 1 | — |

Two claims in the brief I could not substantiate and that would break tickets if carried forward: the `design-reconciliation` spec (does not exist) and the ModelPicker adoption count (3 importers, not 1). The pill-radius (161) and dashed (58) totals are larger than stated but *less* actionable than stated — both are heterogeneous, and only the 16-instance empty-state subset and the 4-way `stC` fork are true single-family duplications.