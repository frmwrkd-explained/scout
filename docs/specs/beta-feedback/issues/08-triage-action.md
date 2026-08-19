# 08 — Triage action and verdict validation

**Status:** resolved
**Blocked by:** 07

A `"use node"` Convex action calling Claude with: the redacted envelope, `docs/MAP.md`
plus a generated file index, and a shortlist of open reports for `duplicateOf`.

Returns the verdict of spec §9. **Validate before use** — shape, enums, and
`confidence` in range. Malformed → retry once → park `triage-failed` keeping the raw
text, and file the issue anyway from the user's own words. A broken model must not
swallow a bug report.

The `disposition` definitions in spec §9 go in the prompt **verbatim**. They are the
whole product; paraphrasing them is how this feature stops being useful.

`confidence < 0.4` is forced to `needs-more-info` regardless of what the model
returned. A confident wrong verdict is worse than an honest shrug.

Model: the latest Claude. `ANTHROPIC_API_KEY` in Convex env, absent → park as
`triage-skipped` and file from the user's words.

## Done when

A seeded crash report returns a valid verdict naming a plausible file; a vague
"it's broken" returns `needs-more-info` with specific `missingInfo`; a report whose
env facts show `groq:absent` against a transcription failure returns `not-a-bug`; a
deliberately malformed model reply parks rather than throws.
