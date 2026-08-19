# 08 — Information hierarchy — progressive disclosure over simultaneous controls

**Status:** resolved 2026-07-20 — chrome work landed 2026-07-19; the Production Panel disclosure
landed in the polish pass: `SectionHead` is a keyboard-reachable caret toggle with tabular counts,
all five sections collapse to one-line mono summaries, state persists via the `uiState` seam.
(CAST+LOCATIONS were kept as separate sections — collapse made the merge unnecessary.)
**Blocked by:** None — can start immediately.

> Citations re-measured 2026-07-19. Every `App.jsx` line number in this ticket was stale
> (drift of ~14–20 lines); all `ProductionPanel.jsx` citations were exact. One content
> correction: the ticket enumerates the nav as "Library/Tools/Skills/Settings" (4), but a
> **Chat** destination was added between Library and Tools by ticket 24, so there are 5 links
> today. The comment's "five destinations" is correct; the ticket's list was not.
>
> Deviation: the ticket specifies a 3-state severity stripe (ok / hot / over budget). Only two
> states are actually derivable — `paceHot` is the single threshold in the data and there is no
> over-budget concept — so the stripe ships with two, `var(--ok)` and `var(--warn)`. Adding a
> third would have meant inventing a threshold. `--danger` is reserved for when one exists.

## Problem

The project screen renders ~20 persistent controls before a single asset appears: 8 in the
global bar (`App.jsx:1296` logo, `:1298` crumb, `:1304` search, `:1333` INBOX, `:1337` cost,
`:1342-1347` Library/Tools/Skills/Settings), 4 in the project header (`:1862` title, `:1867`
gear, `:1874` Grid/Table, `:1882` Review), 6 tabs (`:1889`), plus the QUEUE dock. Nothing in
that stack says which one matters.

Four specific failures:

1. **Two cost readouts, one screen.** `App.jsx:1337-1340` (month spend) and `:1870-1873`
   (project spend) both use accent numerals, `border:1px solid rgba(227,255,50,.35)`,
   `border-radius:999px` — same object, different number. The global one has
   `onClick={() => this.go('costs')}`; the project one **has no onClick** — two
   identical-looking pills, one navigates, one is dead. And `renderCosts` (`App.jsx:2208`)
   already shows month spend at 26px plus a BY PROJECT breakdown (`:2241`), so the header pill
   duplicates a better surface one click away. `projCost` (`:1834`) has exactly one consumer.
2. **Status and navigation are typographically indistinguishable.** `App.jsx:1332` sets
   `gap:6px 14px` across the whole right cluster, so INBOX, the cost pill, and the four nav
   links are separated by identical whitespace and read as one row of six peers.
3. **The tab strip's prime slot holds static prose.** `App.jsx:1899` puts `margin-left:auto`
   on "context is injected into every agent run" — the row's most valuable real estate spent
   on a sentence that never changes.
4. **The Production Panel stacks five always-open sections** in a 290px scroller
   (`ProductionPanel.jsx:303`, `:309-314`). On a fresh project all five render explanatory
   prose and no data: `:149`, `:232` (twice — CAST and LOCATIONS are the same `renderBoard`,
   `:225`, rendered at `:312` and `:313`), `:257`. `SectionHead` (`:56`) is a non-interactive
   label whose count renders in `#3A3F49` at 9.5px — 1.83:1, effectively invisible.

## What to change

**One primary action per screen.** Exactly one solid `background:#E3FF32` fill in the
persistent chrome: project → "Review N new" (`App.jsx:1882`). Everything else in the chrome
demotes to the bordered `hBdAmber` pattern or plain text.

**Delete the project-header cost pill** (`App.jsx:1870-1873`) and the now-dead `projCost`
const (`:1834`). No information is lost — `renderCosts` BY PROJECT covers it. The header then
holds title · gear · [Grid/Table] · Review.

**Rezone the global bar.** Keep the five destinations — the comment at `App.jsx:1345` is
deliberate, do not add a sixth. Replace the single `gap:6px 14px` at `:1332` with two flex
groups separated by a `1px #22252C` divider and `gap:18px`: status (INBOX, spend), then
destinations. Strip the accent border and accent numeral from the spend readout; encode budget
state in **form** — a 3px×14px severity stripe before the number, `#3FCF8E` on track,
`#E3FF32` hot, `#F05B54` over budget, numeral at `#C9CFD8`. Pace is currently a bare word
(`:1340`); the stripe makes it readable without parsing text. Drive it off the existing
`paceHot` at `:1265` (note `renderCosts` recomputes the same expression at `:2214` — reuse,
don't add a third).

**Move the tab-strip caption** (`App.jsx:1899`) into the Assets tab body as an inline hint.
Leave the slot empty — negative space is what tells the eye the tab row is navigation, not a
toolbar.

**Make Production Panel sections disclosable.** Give `SectionHead` (`ProductionPanel.jsx:56`)
`open`/`onToggle` props and a caret; render `count` as a chip (`#1C1F26` bg, `#9AA3AF` text,
`border-radius:5px`) instead of `#3A3F49` text. Default-open only sections with content; an
empty section collapses to one header row showing `0` and an inline "Add" action, replacing the
prose at `:149`, `:232`, `:257`. Merge CAST and LOCATIONS into one REFERENCES section with a
two-item segmented control, dropping one `renderBoard` call from `:312-313`. Persist open state
in component state alongside the existing `collapsed` flag (`:68`).

**Encode state in form, not accent text.** `ProductionPanel.jsx:214` marks the active style
lock with 9px accent text "active" — replace with a chip. `:276` ("Lock this look", accent,
repeated per look — up to 6 simultaneous accent marks) becomes a bordered action revealed on
row hover/focus.

## Acceptance criteria

- `rg -n "projCost" frontend/App.jsx` returns **0 hits**.
- `rg -n "context is injected" frontend/App.jsx` returns **0 hits** (the string moves to the
  Assets tab body).
- In the running app on a project screen, the chrome above the tab content contains exactly
  **one** element with computed `background-color: rgb(227, 255, 50)` — the Review button.
- The global bar's right cluster (`App.jsx:1332`) renders **two** child groups with a divider
  between them, not one flat row.
- On a project with no cast, locations, or looks, the Production Panel scroller (`:309`) shows
  **≤ 1** paragraph of empty-state prose (down from 4) and does not scroll at 900px viewport
  height.
- Budget state is identifiable without reading the number or the word: the stripe color changes
  when `paceHot` (`App.jsx:1265`) flips.
- Keyboard paths unchanged: `r` starts review and `1`–`6` switch tabs (`App.jsx:1148-1149`).
  Disclosure must not remove a keyboard path.
- `node --test tests/` passes (139 green as of this ticket; treat green as the gate, not the
  number).

## Notes

The QUEUE dock is the in-repo precedent — copy it, don't change it. `App.jsx:2953` is a
collapsed pill carrying a summary (`N running · N queued`) plus a state dot; `:2930` expands to
detail on click. Summary before detail, state in form.

Density is not the problem. Padding, font sizes, and grid tightness stay as they are. This
ticket changes only *what is simultaneously visible* and *what looks primary*.

Focus rings for the new disclosure toggles are the accessibility ticket's job, not this one —
just don't add a control that has no keyboard route at all.

Ticket 05 (accent discipline) also touches `App.jsx:1337` and `ProductionPanel.jsx:214`.
Whichever lands second reconciles rather than re-applies. This ticket is the hierarchy
decision; 05 is the palette rule.
