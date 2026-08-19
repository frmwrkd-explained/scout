# 09 — `scripts/lint-design.mjs` — a warn-mode ratchet

**Status:** open
**Blocked by:** 01 — the token layer (`:root` in `frontend/styles.css` + `frontend/tokens.js`) must exist before there is a token set to check against.

## Problem

There is no lint step of any kind. `package.json:7-16` "scripts" is exactly `dev`, `build`,
`server`, `start`, `app`, `dist:mac`, `dist:win`, `dist:linux` — nothing inspects source. So
every literal ever typed into an `sx()` string is still there and nothing stops the next one.

Measured across the 43 `.jsx` files in `frontend/` + `frontend/chat/` right now:

| pattern | matches | distinct |
|---|---|---|
| `#[0-9a-fA-F]{3,8}` | 3756 | 64 |
| `font-size:<n>px` | 1049 | — |
| `border-radius:<n>px` | 833 | — |
| `gap:<n>px` | 672 | — |

Ticket 01 adds `:root` custom properties and `frontend/tokens.js`, but nothing keeps them
canonical. Without a ratchet the token layer becomes a 65th color rather than a replacement
for the other 64. The goal here is explicitly **not** completeness — it is that literal
#3,757 cannot land.

## What to change

1. New file `scripts/lint-design.mjs`. Zero deps, plain ESM, `node:fs`/`node:path` only —
   same shape as the existing one-offs in `scripts/` (`axis-prompts.mjs`, `gen-aspect.mjs`).
2. Scan `frontend/**/*.jsx` recursively (`frontend/chat/` is the only subdir today).
   **Skip any filename starting with `._`** — this repo is on exFAT and AppleDouble sidecars
   regenerate constantly (see CLAUDE.md); counting them makes the baseline unstable.
   Report one violation per match of:
   - `#[0-9a-fA-F]{3,8}` whose uppercased value is not in the token set
   - `font-size:`, `border-radius:`, or single-value `gap:` followed by a `px` value not in
     the token set
   Import the token set from `frontend/tokens.js` (ticket 01) — do not restate it.
   After 01 a migrated call site reads `color:var(--fg-faint)`, which matches none of these
   patterns, so migration mechanically drives the count down.
   **`padding:` is out of scope for v1** — 961 declarations, mostly multi-value shorthand,
   so "not in the token set" has no single answer. Add it in a later ticket if wanted.
   Four `gap:Npx Npx` shorthands exist; the single-value anchor skips them deliberately.
3. Allowlist as `{file, values[]}` pairs — **not** whole-file exemptions:
   - `CallSheet.jsx` and `Screenplay.jsx`: exempt `#FFFFFF` and `#000000` only. These are
     real print-surface paper colors inside `PRINT_CSS` (`CallSheet.jsx:23`,
     `Screenplay.jsx:163` and `:169`). Their *screen* chrome still counts — e.g.
     `Screenplay.jsx:346` and `CallSheet.jsx:257` both use `#626B78`.
   - Three.js needs **no** allowlist: `PROP_COLOR = 0x8E97A5` (`ThreeDStage.jsx:44`, one of
     20 `0x` literals in that file) is `0x`-prefixed and cannot match a `#`-anchored regex.
     Say so in a comment so nobody adds a redundant exemption.
4. Baseline: `node scripts/lint-design.mjs --write-baseline` emits
   `scripts/design-baseline.json` (`{ total, byFile }`), committed. A plain run compares:
   - count <= baseline → print count and delta, **exit 0**
   - count > baseline → print the new violations grouped by file, **exit 1**
   - `--write-baseline` refuses to raise `total`; it only ratchets down.
5. `package.json`: add `"lint:design": "node scripts/lint-design.mjs"`. Do not wire it into
   `build` or `start` — standalone command in this ticket.

## Acceptance criteria

- [ ] `npm run lint:design` exits 0 on a clean checkout and prints a total plus a per-file
      breakdown.
- [ ] `scripts/design-baseline.json` is committed and its `total` equals what the script
      counts on that same commit.
- [ ] Add `color:#AB12CD` to any `sx()` string in `frontend/Tools.jsx` → `npm run lint:design`
      exits 1 and names both `frontend/Tools.jsx` and `#AB12CD`. Revert → exits 0.
- [ ] Replace one `#626B78` in `frontend/CallSheet.jsx:257` with `var(--fg-faint)` → total
      drops by exactly 1 and the run still exits 0.
- [ ] `frontend/ThreeDStage.jsx` reports zero violations for its 20 `0x` literals.
- [ ] `CallSheet.jsx`/`Screenplay.jsx` report zero for `#FFFFFF`/`#000000` but still report
      their `#626B78` screen-chrome uses.
- [ ] Creating a `frontend/._Tools.jsx` sidecar does not change the reported total.
- [ ] `node --test tests/` still passes (139 as of 2026-07-19) — this script is not imported
      by the app and must not change runtime behaviour.

## Notes

- Warn-mode is the point. A hard gate at 6,000+ violations gets `--no-verify`'d on day one;
  a ratchet that only fails on an increase gets kept.
- `sx()` (`frontend/sx.js:12`) passes declaration values through untouched, so `var(--token)`
  works today with no change to `sx.js`. That is what makes migration incremental and this
  ratchet enforceable rather than aspirational.
- No formatter, no ESLint, no devDependency. `scripts/` is excluded from the electron-builder
  `files` list (`package.json:36-42`), so this ships nothing to users.
- Later tickets can extend the rule set (accent-fill count per screen, `outline:none` with no
  paired `:focus`). Land the ratchet first; a rule with no ratchet behind it is a comment.
