# Design reconciliation

**Status:** open
**Created:** 2026-07-19

Close the gap between the design system FrameForge *declares* and the one it *ships*, and
give the app the hierarchy and affordances a dense professional tool needs.

## Why this exists

FrameForge was traced out of a design tool, and the tracing kept the pixels but dropped the
abstraction. `frontend/sx.js` says so in its own comment — *"Lets the app keep the design
prototype's style strings verbatim."* `frontend/styles.css:19` says the same about `!important`:
*"exactly like the design tool did."*

That was the right call for landing a high-fidelity prototype fast. The consequence is that
**every visual decision lives at its call site as a literal, and there is no place in the codebase
where a design decision can be made once.**

Everything below is downstream of that single fact.

## Measured state (2026-07-19)

Source counts across `frontend/`:

| | Declared | Shipped |
|---|---:|---:|
| Colors | ~17 | **66** (3828 hex literals) |
| Font sizes | — | **22** (incl. half-pixels 8.5–13.5) |
| Border radii | — | **16** (incl. both `99px` and `999px`) |
| Padding declarations | — | **288** |
| Gap values | — | **20** |
| Accent alpha levels | — | **23–24** |

Measured against the running app (1600×1000, chat view):

| | |
|---|---:|
| Visible text elements failing WCAG AA | **41 of 91** |
| …attributable to one token (`fg-faint #626B78`, 3.58:1) | **33** |
| …attributable to a *border* token used as text (`#3A3F49`, 1.83:1) | **8** |
| Elements with `cursor:pointer` | **173** |
| …keyboard-reachable | **0** |
| Real tab stops on screen | **1** |
| Elements with any `role` / `aria-*` | **0** |
| `:focus` rules in the stylesheet | **0** (vs 108–110 inline `outline:none`) |
| Resizable panels | **0** |

`frontend/styles.css:1` cites `docs/DESIGN.md` as **binding**. That file has never existed.
`frontend/Story.jsx:906` cites it too, inside render code, as live authority. A binding pointer
to nothing taught every reader — human and agent — that the header is decorative, which is how
66 colors landed behind a 17-color declaration.

## What this is *not*

**Not a redesign.** The visual direction is sound and the density is correct for a shot-list tool.
Nothing here should become more spacious. The problem is **variance** — the app doesn't look wrong,
it looks like eleven people made it — plus two genuine gaps (no keyboard operability, no resizable
layout).

One open question worth deciding rather than inheriting: Claude Design's guidance names
*"near-black with a lone acid-green or vermilion pop"* as a recognised AI-generated-design cluster,
which is precisely `#0D0E11` + `#E3FF32`. The accent's contrast math is genuinely excellent
(17.1:1 as text, 16.2:1 as a fill — both clear AAA), so this is not a defect to fix blindly.
But if the app reads as "AI-made," the palette *direction* is a live contributor, and that is a
call to make deliberately. Ticket 06 constrains how hard the accent is spent; it does not change
the hue. Revisit after 06 lands and judge from the result.

## Principles

Adopted from Claude Design (`artifact-design`), "When it's a UI, not a document":

1. **Surface summary before detail.** A tool is scanned and operated, not read top to bottom.
2. **Encode state in form as well as number** — pill, chip, severity stripe — so what needs
   attention reads at a glance.
3. **Semantic color (ok / warn / danger) is separate from the accent** and does not count against
   the accent budget.
4. **What's interactive should look interactive** — and be reachable.
5. **Density is a choice, not a defect.** Inconsistency is the bug.

## Tickets

| # | Title | Blocked by |
|---|---|---|
| [01](issues/01-token-layer.md) | Token layer — `:root` custom properties + `tokens.js` | — |
| [02](issues/02-focus-and-real-buttons.md) | Keyboard operability — focus ring and real `<button>` | Part B needs 05 |
| [03](issues/03-hover-lies-about-disabled.md) | Stop hover reporting the opposite of the truth | — |
| [04](issues/04-contrast-floor.md) | Contrast — lighten `fg-faint`, retire border-as-text, 9px floor | 01 |
| [05](issues/05-ui-primitives.md) | `frontend/ui.jsx` — five primitives to stop the drift | 01 |
| [06](issues/06-accent-discipline.md) | Accent discipline — one fill per screen | 01 |
| [07](issues/07-resizable-panels.md) | Resizable panels | — |
| [08](issues/08-information-hierarchy.md) | Information hierarchy — progressive disclosure | — |
| [09](issues/09-design-lint-ratchet.md) | `scripts/lint-design.mjs` — warn-mode ratchet | 01 |
| [10](issues/10-design-doc-and-naming.md) | Write `docs/DESIGN.md`, fix dangling authority | 01 |

### Suggested order

**Wave 1 — immediate feel, no dependencies.** 03 (hover lying about disabled) and 02 Part A (the
focus ring) are roughly an hour combined and both change how the app feels straight away.

**Wave 2 — the foundation.** 01, then 04 and 10 on top of it. One commit each.

**Wave 3 — the mechanism.** 05, then 02 Part B, then 06. Adoption is opportunistic — migrate as
you touch files, never big-bang.

**Wave 4 — the gaps the user actually reported.** 07 and 08. Independent of everything above, so
they can run in parallel with any wave; sequenced last only because 05's primitives make 08's
disclosure work cleaner.

**Ongoing.** 09 in warn mode with a committed baseline.

## Non-goals

- Migrating all 3828 hex literals. The token layer's job is to make sure literal #3829 can't land,
  not to be complete.
- TypeScript, a CSS framework, a component library, a test framework, or any new dependency.
- Making anything more spacious.
- Changing the accent hue (see the open question above — decide after 06).

## Verification

Every ticket carries checkable acceptance criteria. Repo-wide gates:

- `node --test tests/` green with `FRFG_DATA` on a temp dir (139 tests as of 2026-07-19; the count
  grows, so treat green as the gate, not the number).
- `npm run dev` + `npm run server`, then re-run the live contrast and tab-stop measurements from
  the "Measured state" table. Both numbers should move in the right direction and none should
  regress.
