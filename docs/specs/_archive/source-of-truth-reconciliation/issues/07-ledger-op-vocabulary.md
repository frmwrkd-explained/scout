# 07 — `ledger.mjs` documented `op` vocabulary is incomplete

**Status:** resolved
**Blocked by:** None — trivial.

## The conflict

`backend/ledger.mjs:3` documents the ledger row shape as:

```
{ ts, service: groq|fal, op: breakdown|vision|whisper|image|video|storage, model, units, cost, ref }
```

But `enhance.mjs:58` writes `op: 'enhance'`, which is not in that list. Other call sites may
write further values — `op` is a free string and nothing validates it.

## Why it's worth fixing

Low severity, but it is a documented-vocabulary-vs-reality mismatch of exactly the kind that
sends an agent looking for a bug that doesn't exist, or writing a `switch` that silently
misses cases.

## The fix

1. Enumerate the real values: `rg -n --text "op: '" backend/` and collect every literal.
2. Correct the comment to the true set.
3. State explicitly that `op` is unvalidated free text, so nobody assumes it is an enum.

Do not add validation — that would be a behavior change, and old `costs.md` rows may carry
values no longer produced.

## Acceptance

- The comment matches the literals actually written.
- A note that the field is unvalidated.

## Outcome

Comment-only change to `backend/ledger.mjs` (header block, lines 1-16). No code, no validation.

**Enumerated `op` values actually written** (literals plus variables traced to their call sites):

| value | written by |
|---|---|
| `breakdown` | `groq.mjs:176` — `chat(..., 'breakdown')` from `breakdownStory` |
| `whisper` | `groq.mjs:86` |
| `vision` | `vision.mjs:137` → `run()` → `groqVision`/`falVision` `op` param |
| `look` | `vision.mjs:164` → same path |
| `enhance` | `enhance.mjs:58` |
| `image` | `generate.mjs:248` (non-video branch), `stylelocks.mjs:241` |
| `video` | `generate.mjs:248` (video branch) |
| `chat` | `groq.mjs:38` default param only — **unreachable today**, both `chat()` call sites pass an explicit `op` |

The old comment listed `breakdown|vision|whisper|image|video|storage`. It missed `look`, `enhance`
and the `chat` default, and listed `storage`, which **no call site writes** — so historic
`costs.md` rows are the only place it can appear.

**Decisions**

- `storage` documented as a historic-only example rather than dropped silently, so anyone finding
  it in a real `costs.md` doesn't file it as corruption.
- Also corrected `service`, on the same comment line: it is not `groq|fal`. `generate.mjs` and
  `stylelocks.mjs` pass `provider` from `providerOfModel()`, so any provider id in
  `frontend/modelCatalog.js` (fal, kie, higgsfield, …) can land there. Same unvalidated-free-text
  caveat applies.
- Added the explicit "never write an exhaustive switch over `op` without a default branch" line,
  which is the failure mode the ticket exists to prevent.
- No validation added, per the ticket.

**Follow-up:** none required. If a future change wants `op` constrained, it needs a migration plan
for existing `costs.md` rows first — `getLedgerRollup()`'s `byOp` map is keyed by these strings and
is never trimmed.
