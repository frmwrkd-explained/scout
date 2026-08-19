# design/EXTRACT.md — what the design files actually specify

Source: Claude Design project `f84bb492-1fc3-4729-8597-dc87f6c41485` ("Keyboard-driven review pipeline"), pulled 2026-08-19 via the `DesignSync` read methods. All nine files are in `design/` and are the **visual truth** for the UI. `support.js` is the `dc-runtime` bundle that renders the `.dc.html` prototypes — reference only, never ported.

Read this with `docs/05_UI_SPEC.md` open. Where the two disagree, §5 below lists it.

---

## 1 · The `:root` token block

All eight screens carry a **byte-identical** `:root` block. Diffed name-by-name against `frontend/styles.css` `:root`:

```
token count — styles.css: 27   design: 27
IDENTICAL: 27 of 27      CONFLICT: none
ONLY IN styles.css: none ONLY IN design: none
```

The block, verbatim from the design:

```css
:root{
  --ink:#0D0E11; --surface:#101115; --surface-2:#14161B;
  --raise:#1C1F26; --sunk:#0A0B0E; --void:#0B0C0E;
  --line:#1B1E24; --border:#22252C; --border-2:#2A2E36; --border-3:#3A3F49;
  --fg:#ECEEF2; --fg-soft:#C9CFD8; --fg-muted:#9AA3AF; --fg-faint:#7B8797;
  --accent:#E3FF32; --accent-hover:#EEFF66; --accent-deep:#B8CC28; --on-accent:#141519;
  --accent-05:rgba(227,255,50,.05);
  --accent-12:rgba(227,255,50,.12);
  --accent-35:rgba(227,255,50,.35);
  --accent-60:rgba(227,255,50,.6);
  --sand:#C9CFD8;
  --ok:#3FCF8E; --warn:#F0B23A; --danger:#F05B54;
  --marked:#5B9DFF;
}
```

**Phase 0c outcome: no change to `styles.css`, `tokens.js` or `docs/DESIGN.md`.** The design adds no token and conflicts on none. The reconciliation commit is empty by construction — which is the correct result, and is the evidence that the design was genuinely built on FrameForge's system rather than re-picked by eye.

### Type

Two families, loaded from Google Fonts on every screen:

| Role | Face | Weights used |
|---|---|---|
| UI / prose | `Schibsted Grotesk` | 400 · 500 · 600 · 700 · 800 |
| **Every figure** | `Spline Sans Mono` | 400 · 500 · 600 |

`frontend/tokens.js` already exports `MONO = "'Spline Sans Mono',monospace"`. It is the only declaration — import it, never retype the string. Digits that stack always carry `font-variant-numeric:tabular-nums`.

### Tokens the design does **not** define, and will need

- **The entire light-mode set.** No screen carries `[data-theme="light"]` or a `prefers-color-scheme` block — all eight are dark-only. The light palette exists only as the table in `docs/05_UI_SPEC.md` §4. It is unbuilt and unproven; the 4.5:1 assertion that spec promises has nothing to run against yet. → M5 / T16, and question **Q4**.
- **No spacing, radius or duration scale.** The design hard-codes `6px`/`8px` radii, `130ms ease` transitions and a 2–40px padding range inline, ~1,900 times across the eight files. `docs/DESIGN.md` does not name them either. Not a defect for M0–M1; flagged so nobody invents a second scale later.

---

## 2 · Components the design implies, and their name in `frontend/`

**Grep before building any of these.** The right-hand column is the canonical home; where a FrameForge file already exists it is named, and adding a second implementation is a defect (Law 10).

### Already in the repo — port, do not write

| Design surface | Existing file | Note |
|---|---|---|
| Buttons, chips, eyebrows, empty states, inline edit | `frontend/ui.jsx` — `Btn` `Card` `Eyebrow` `Empty` `Input` `Field` `Chip` `InlineEdit` | The registry. Eight exports, all with importers. |
| Verbatim style strings from the prototypes | `frontend/sx.js` — `sx()` | Exists **precisely** to keep the design's declaration strings intact. This is the porting mechanism: `style={sx("display:flex; gap:8px")}`. |
| The mono face | `frontend/tokens.js` — `MONO` | |
| Body prose / markdown | `frontend/Markdown.jsx` | |
| Any prompt or long-text field | `frontend/Composer.jsx` + `ComposerDock`, `SnippetText`, `MentionText` | `Composer` is THE composer, zero density variants, on purpose. |
| Split panes (rail ↔ centre ↔ inspector) | `frontend/PanelSplitter.jsx` | |
| Right-click menus | `frontend/ContextMenu.jsx` | |
| Command palette | `frontend/Palette.jsx` | |
| Whiteboard (§5 of the UI spec) | `frontend/Board.jsx` · `BoardNodes.jsx` · `BoardInspector.jsx` · `boardLayout.js` | T15. Node kinds change; structure does not. |
| Screenshot / file thumbs | `frontend/RenderMedia.jsx` | |

### New for Scout — the design is the spec for each

| Design surface | Seen in | Proposed `frontend/` name | Milestone |
|---|---|---|---|
| The three-column shell (rail · centre · inspector · status footer) | `Scout` | `Shell.jsx` | M1 |
| Left rail: project switcher, nav, COLLECTIONS, ASSISTANTS, FILES | `Scout` `Today` `Decide` `Project` | `Rail.jsx` | M1 |
| Collection table — sortable header, typed cells, row select | `Scout` (`cols`/`rows`/`r.cells`) | `TableView.jsx` | T03/T04 |
| The seven typed **cell** renderers | `Scout` (`isName` `isChip` `isPlain` `isMeter` `isRel` `isTags` `isYield`) | `cells/` — one file per type, dispatched by field type from `backend/collections.mjs` | T04 |
| The typed **property row** editor + `+ Add property` | `Scout` (`props`, `p.isText` `isStatus` `isTags` `isRel` `isBool` `isDate`) | `PropertyRows.jsx` | T04 — this is Tesseract's `FrontmatterEditor` pattern, ported to React |
| Freshness meter — 5 segments, filled = fresh | every screen (`meter`, `fresh`) | `Freshness.jsx` | T04 — **one** implementation; Law 3 says the form, not the colour, carries the meaning |
| Score/yield bar — 10 ticks or a filled bar | `Scout` `Decide` `Territory` `Review Deck` | `Meter.jsx` (`display: bar\|stars` from the `number` field type) | T04 |
| `Editor \| Raw` toggle + save state | `Scout` `Record Detail` | part of `DocumentSurface.jsx` | T04 |
| Conflict banner — merge both / take disk / keep mine | `Scout` (`conflict`) | `ConflictNotification.jsx` + `DiffView.jsx` | T04 — Tesseract pattern, "take this on day one" |
| Inspector — 5 sections, one open, count on each header | `Scout` (`sections`) | `Inspector.jsx` | T05 |
| REFERENCED BY (typed, shows the pointing field) vs LINKS (prose, in/out) | `Scout` (`refs`, `linksIn`/`linksOut`, eyebrows `IN / MENTIONS THIS` · `OUT / WRITTEN HERE`) | `Inspector.jsx` sections | T05 — **must look different**; the design already makes them so |
| The decision card — kind chip, score, WHY → EVIDENCE, A/R/S keys, reason grid | `Decide` `Review Deck` | `DecideCard.jsx` | M2/M4 |
| Mandatory reject-reason grid, 1–5 keys, ESC back | `Decide` `Review Deck` | `RejectReasons.jsx` | M2 |
| Status board with drag between stage columns | `Pipeline` | `BoardView.jsx` (the `board` view type) | T03 |
| Territory tiles banded working/waiting/untried/locked | `Territory` | `TerritoryScreen.jsx` | M3 |
| Task lanes grouped blocked/working/open/done + assignee chip | `Project` | `ProjectScreen.jsx` | M4 |
| Overnight summary, NEEDS YOU counter, agent questions | `Today` | `TodayScreen.jsx` | M4 |
| Goal card — figure, progress bar, days left | `Today` (`goals`) | `GoalCard.jsx` | M3 |
| Assistant row — dot, name, state, one-line job, cost | `Today` `Project` `Rail` | `AssistantRow.jsx` | M4 |
| File browser tree + preview | `Scout` (`tree`, `filesOpen`) | `Files.jsx` | M5 |
| Activity log drawer | `Scout` (`log`, `logOpen`) + footer `ACTIVITY ▴` on every screen | `Activity.jsx` | M2 |
| First-run interview — 1 of 6, progress pips, plain-language prompt | `Today` (`isFirstRun`) | `Interview.jsx` | M5 |

Not designed anywhere, and named in `docs/05_UI_SPEC.md` §2.2 as missing: **GOALS** (a full screen; only the TODAY side-panel exists), **MEMORY**, **WHAT THEY KNOW**, **FILES** (only the rail entry and a tree stub exist), **WHITEBOARD**.

---

## 3 · The layout contract

### 3.1 Two shells exist, and only one matches the spec

| Shell | Screens | Chrome |
|---|---|---|
| **Rail shell** — matches `docs/05_UI_SPEC.md` §1 | `Scout` `Today` `Decide` `Project` | 210px left rail · fluid centre · optional right panel · 38px global status footer |
| **Top-nav shell** — older round | `Territory` `Pipeline` `Record Detail` `Review Deck` | 48px header with `SCOUT` wordmark + tab nav · 212px secondary rail · 40–42px footer |

The two are not reconcilable and the spec picks the first. See question **Q1**.

### 3.2 Measurements, as built

| Element | Value | Screens |
|---|---|---|
| Left rail | **210px**, `flex:none`, `--surface`, `1px solid --line` right border | `Scout` `Today` `Decide` `Project` |
| Secondary rail (top-nav shell) | 212px | `Territory` `Pipeline` |
| Inspector (right) | **302px** | `Scout` |
| TODAY right panel | 388px | `Today` |
| PROJECT right panel | 352px | `Project` |
| Record slide-over | 576px, `position:absolute`, `-24px 0 48px rgba(0,0,0,.45)`, over a `rgba(10,11,14,.66)` scrim | `Record Detail` |
| Global status footer | **38px** | rail-shell screens |
| Screen-local footer | 40–42px | top-nav screens |
| Top header (top-nav shell) | 48px | |
| Decision column | `max-width:800px` (Decide) / `780px` (Review Deck), centred, `36–44px` top padding | |
| First-run column | `max-width:660px`, centred | `Today` |
| Canvas | 1440 × 900 | all |

### 3.3 Rail behaviour

Top to bottom, fixed order: **project switcher** (boxed, `--raise` + `--border-3`, ▾) → **nav** (`Needs you` with a `--warn` pill count, `Today`, `Project` with a neutral pill count) → `COLLECTIONS` group, eyebrow right-labelled `SAVED QUERIES`, one `#tag` row per collection with a tabular count, ending in an accent-coloured `+ new collection` → `ASSISTANTS` group, one row each: 6px status dot, mono name, right-aligned state word in the dot's colour → pinned at the bottom, above a `--line` divider, **`FILES ON DISK`**.

Rows: 30px (nav) / 29px (collections) / 28px (assistants). Group separators are `1px solid --line` with the group's own 6–12px padding. Selected is a `--raise` fill with a `--border-3` border and `--fg` text — **never an accent fill**, exactly as §6 requires. Hover is `--surface-2` + `--fg-soft` at `130ms ease`.

The rail carries **no MEMORY group**. `docs/05_UI_SPEC.md` §1 adds one (Goals · Territory · Playbook · What they know). Unbuilt.

### 3.4 Tab shapes

Two shapes, used for different things, and they must not merge:

- **Nav / view tabs** — 26px tall, `0 11px`, `6px` radius. Idle: transparent border, `--fg-muted`. Active: `--raise` fill, `--border-3` border, `--fg`, weight 600.
- **Segmented control** (stage picker, `Editor|Raw`) — a `--sunk` tray with `1px --border` and `8px` radius holding 3px of padding; each segment 28px, `6px` radius, active gets `--raise` + `--border-3`.

Chips: 17–20px tall, `9999px` radius, `1px` border, mono, 8.5–9.5px, weight 600–800, `.1–.14em` tracking. A status chip tints **border and text**, never the fill.

### 3.5 Motion, and the altitude ladder

Every transition in all eight files is `130ms ease` on `background`, `border-color` or `color` only. No transforms, no spring, no entrance animation anywhere.

The three altitudes are literal in the markup, and `Decide` is the reference implementation:

```
altitude 1   the card: kind chip · score · one headline · one line   (default)
altitude 2   ▸ WHY  [W]              one paragraph, ≤64ch            (one click)
altitude 3   ▸ SHOW ME THE EVIDENCE  [E]   key/value grid + shot + source link
```

Altitude 3's control is nested **inside** altitude 2 and is unreachable until it opens — a structural guarantee, not a styling one. Copy that nesting; do not flatten it to two sibling toggles.

Keys, consistent across `Decide` and `Review Deck`: `A` accept · `R` reject → reason grid · `S` skip · `W` why · `E` evidence · `1–5` pick a reason · `ESC` back · `⌘Z` undo. Every button prints its own key in a mono pill.

---

## 4 · Notes worth carrying into the build

1. **`sx()` is the porting mechanism.** `frontend/sx.js` parses a CSS declaration string into a React style object and exists so the prototypes' strings survive the port verbatim. Use it. Do not retype these into CSS classes and do not "improve" values while porting.
2. **Freshness is a 5-segment meter**, filled from the left, `3px` tall, `2px` gap, ~36px wide, unfilled segments `--border`. Identical in `Today`, `Decide`, `Territory` and the `date` property row. One component, no variants — Law 3.
3. **Yield is a different form** — a continuous 4px bar, not the segmented meter. Do not merge the two: staleness and productivity must not read alike.
4. **`--marked` is used exactly as `docs/DESIGN.md` says** — human-authored values (`CRYSTAL` in Record Detail's `src` column), `AWAITING` flags, `BEING WORKED` lanes, `NEW CLAIM`. Never a call to action.
5. **Provenance is on the surface, not buried.** `Record Detail` prints `AGENT` or `CRYSTAL` against every frontmatter row; the decision cards print `FOUND BY GROUP CRAWLER`. `updated_by` (`docs/02_DATA_MODEL.md` §2) is the field behind this, and Law 4 depends on it. The design already assumes it exists.
6. **Every screen shows a path.** `guests/maria-santos.md`, `memory/playbook.md`, `2026-08-hazing/brief.md`, `STAGES FROM config/guest-research.md`. Law 8 is already in the visual language.
7. **Empty states are short mono uppercase**, as §6 requires: `NO QUESTIONS — YOUR AGENTS ARE CLEAR`, `NOTHING WON THIS CYCLE / MOVE A REPLY HERE WHEN IT LANDS`.
8. **One solid accent fill per screen.** Verified on all eight — TODAY's *Send them out*, DECIDE's *A*, TERRITORY's *Sweep the cold ground*, PROJECT's *Put the team to work*. Everything else that is accent-coloured is an outline or text.

---

## 5 · Where the design and `docs/05_UI_SPEC.md` disagree — questions

Per `START.md`: I am not picking silently on these. **Q1–Q4 are open.** D1–D3 are conflicts the spec already resolves in its own text, so I have recorded them as decisions in `docs/decisions.md` rather than blocking on them.

### Q1 · Four screens are drawn in a shell the spec does not use
`Territory`, `Pipeline`, `Record Detail` and `Review Deck` use the 48px-header/tab-nav shell. `docs/05_UI_SPEC.md` §1 specifies the 210px rail for the app. Their **content** is clearly still wanted; their **chrome** is from an earlier round.
→ *Assumption if you don't answer:* re-host all four inside the rail shell and drop their local headers, keeping the single 38px global status footer. Confirm — this changes how `Record Detail`'s 576px slide-over is mounted.

### Q2 · `Record Detail` is a slide-over; `Scout` is a full-pane document surface
Two different presentations of one record, in one design set. `Scout`'s version has the property editor, `Editor|Raw`, the conflict banner and the inspector; `Record Detail`'s has a stage segmented-control, an evidence block and an inline HISTORY timeline that duplicates the inspector's HISTORY section. Law 10 says one of these is the implementation.
→ *Assumption if you don't answer:* `Scout`'s full-pane surface is canonical (`DocumentSurface.jsx`); the slide-over is a presentation mode of the same component; the stage control and evidence block move into it; `Record Detail`'s inline HISTORY is dropped in favour of the inspector's.

### Q3 · The pipeline's stages are a fifth vocabulary
`Pipeline` and `Record Detail` hard-code `inbox → shortlist → contacted → replied → won` and source them from `config/guest-research.md`. `docs/02_DATA_MODEL.md` §2 says stages are the options of a collection's one `gate: true` **status field**, stored in `.scout/collections/<id>.md`. `config/guest-research.md` is not a path in the §5 tree.
→ *Assumption if you don't answer:* those five are demo data for the `guest` collection's gate field; `config/guest-research.md` does not exist and no route reads it. Board columns come from the status field's options ordered by `group`. Confirm, because "Configure stages" in `Pipeline`'s header then means "edit the gate field", which is a schema proposal (§6), not a settings screen.

### Q4 · Light mode is entirely undesigned
`docs/05_UI_SPEC.md` §4 and `DESIGN-ROUND-4.md` §4 both specify the light token set and require a 4.5:1 test. No design file implements it, so there is no reference for how the deep-olive accent (`#3D4A00` on `#F4FFC0`) reads against a `--raise` chip, a `--marked` flag or the accent-05/12/35/60 alpha steps — those four are defined in terms of the *acid* hue and have no light-mode counterpart in the spec table.
→ *Assumption if you don't answer:* at T16 I derive the four light alpha steps from `#3D4A00`, assert 4.5:1 in `tests/`, and show you TODAY + the document surface before anything else adopts it. This is M5, so there is time — but the missing alpha steps are a real gap in §4's table, not an oversight on my side.

---

### Resolved without asking (recorded in `docs/decisions.md`)

**D1 · Properties are expanded in the design; the spec collapses them.** `Scout`'s document surface renders the full typed property list, then a divider, then `SUMMARY` with the body collapsed behind `READ THE FULL NOTE`. `docs/05_UI_SPEC.md` §2.1 names this exact behaviour and says *"Invert it"*, requiring PROPERTIES collapsed with a three-field summary row. The spec is explicitly overriding the design, so it wins; the design's body-collapse and `WRITTEN BY VETTER / 06:12 / FROM 40 POSTS` provenance line are kept as drawn.

**D2 · The design's inspector is already correct.** Five sections in the spec's order (`PROPERTIES` `REFERENCED BY` `LINKS` `HISTORY` `GRAPH`), one expanded at a time, count on every header that has one, and `REFERENCED BY` visually distinct from `LINKS`. T05 ports it as drawn.

**D3 · `Review Deck` is a subset of `Decide`.** One card kind (`PERSON FOUND`) against `Decide`'s five, same keys, same reason grid, same footer counters. Building both would be a second implementation of one screen. `DecideCard.jsx` is the one component; `Review Deck` is `Decide` filtered to a single collection.
