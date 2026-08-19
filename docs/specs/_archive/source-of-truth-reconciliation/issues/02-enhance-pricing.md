# 02 — `enhance.mjs` prices every model at llama-3.3-70b rates

**Status:** resolved
**Blocked by:** None — can start immediately.

## The conflict

- `backend/groq.mjs:11-17` — `PRICE` is a **per-model** table, looked up at
  `groq.mjs:21` with a fallback: `PRICE[model] || PRICE['llama-3.3-70b-versatile']`.
- `backend/enhance.mjs:12` — `const PRICE = { in: 0.59, out: 0.79 };` a **flat rate**,
  applied at `enhance.mjs:57` regardless of which model actually ran.

## Correction to the original audit

The audit reported these as "~5× apart". They are not. `0.59 / 0.79` is *exactly*
`groq.mjs`'s `llama-3.3-70b-versatile` row, which is also the `groqTextModel` default
(`backend/store.mjs:108`). For the default configuration the two agree perfectly.

The real defect is narrower: the moment a user changes `groqTextModel`, enhance costs are
wrong. With `qwen/qwen3.6-27b` (`groq.mjs:13`, `in: 0.285, out: 0.900`), enhance
**over**-charges input by ~2× and **under**-charges output by ~12%. Those wrong numbers are
written into `costs.md` permanently via `ledger()`.

## The fix

Export a `priceFor(model)` helper from `groq.mjs` — it already encapsulates the table and
the fallback. Have `enhance.mjs` import it and delete its local `PRICE`.

Do not copy the table. `groq.mjs` `PRICE` is canonical per `CLAUDE.md`.

## Acceptance

- `backend/enhance.mjs` contains no price literals.
- `rg -n --text "0\.59|0\.79" backend/` matches only `groq.mjs`.
- Historic `costs.md` rows are left alone — do not retro-reprice.
- 63/63 tests pass.

## Outcome

Resolved as specified — one lookup path, no copied table.

**What changed**

- `backend/groq.mjs` — added `export function priceFor(model)`, which wraps the existing
  `PRICE` table *and* its `llama-3.3-70b-versatile` fallback. `ledgerChat()` was refactored to
  call it, so `groq.mjs` has exactly one lookup path rather than a helper plus an inline copy.
  The `PRICE` table itself is untouched and remains canonical.
- `backend/enhance.mjs` — deleted the local `const PRICE = { in: 0.59, out: 0.79 }`, imported
  `priceFor`, and priced the ledger row with `priceFor(model)` — the **same** `model` binding
  (`s.groqTextModel || 'llama-3.3-70b-versatile'`, line 34) already reported in the `ledger()`
  call on the next line, so the price and the model label on a row can no longer disagree.

**Verified**

`priceFor()` returns `{in:0.285,out:0.9}` for `qwen/qwen3.6-27b`, `{in:0.59,out:0.79}` for
`llama-3.3-70b-versatile`, and falls back to the 70b rate for an unknown id. The over/under-charge
described above is gone. `rg -n --text "0\.59|0\.79" backend/` matches only `backend/groq.mjs:12`.

**Decision:** kept the fallback *inside* `priceFor` rather than exposing `PRICE` directly, so the
"unknown model → 70b rate, never a silent zero" rule is enforced at the single call site instead of
being re-stated by each caller.

`workspace/costs.md` was not touched — historic rows keep their original prices.

**Follow-up (not done — outside file ownership)**

- Three AppleDouble `tests/._*.test.mjs` files (`._phase-chat`, `._phase-model-schema`,
  `._phase6-gridsplit`) are collected by `node --test tests/` and fail as unparseable. They inflate
  the reported test count and account for failures unrelated to any code change.
  `find . -name "._*" -not -path "./node_modules/*" -delete` clears them, per `CLAUDE.md`.
- `backend/vision.mjs` and other Groq callers were not audited for further price literals; only the
  duplicate named in this ticket was in scope.
