# 01 — shared/redact.mjs and its test

**Status:** resolved
**Blocked by:** None — can start immediately.

Everything in this family is gated on this ticket. No capture code lands before it.

Build `shared/redact.mjs`, exporting:

- `redact(value, opts)` → `{ value, hits }`. Walks any JSON-serialisable value —
  strings, arrays, objects, **and object keys** — applying the seven rules of spec §6
  in that order. `hits` is `{ ruleName: count }`.
- `signature(parts)` → the `sha256:` dedupe signature of spec §8.
- `RULES` — the rule table, exported so the test enumerates it rather than restating it.

`opts.secrets` is the array of exact values (rule 1). The caller passes them; this
module never imports `store.mjs` — it stays pure so the frontend could use it too and
so the test needs no datastore.

## Done when

`tests/phase-feedback-redaction.test.mjs` passes, covering at minimum:

- a real-shaped `fal_`, `gsk_`, `sk-ant-`, `ghp_`, `AKIA`, `Bearer …` and a JWT
- an exact secret whose shape matches **no** rule (rule 1 is the one that must catch it)
- a signed `fal.media` URL: origin and path survive, query does not
- a 400 KB `data:image/png;base64,…` reduced to a size marker
- `/Users/theova/…` and `C:\Users\theova\…` → `~`
- a secret appearing as an **object key**, not a value
- entropy sweep hits a 40-char hex blob and does **not** hit a git sha or a uuid
- `redact()` never throws on `null`, cycles, `undefined`, functions or a 5 MB string
- the same input twice produces byte-identical output (no `Date`/`Math.random`)
