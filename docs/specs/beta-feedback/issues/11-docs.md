# 11 — Docs, and declaring the new sources of truth

**Status:** resolved
**Blocked by:** 06

Repo rule: a new source of truth is declared where agents look for it, in the same
change that creates it. Otherwise the next session re-implements it.

- `docs/MAP.md` — a row for this family under **Active work**.
- `CLAUDE.md` source-of-truth table — three rows: redaction rules → `shared/redact.mjs`;
  capture rings → `frontend/feedbackCapture.js`; egress → `backend/feedback.mjs` *(the
  only outbound call to a FrameForge-owned server — say that here, it is the fact that
  keeps someone from adding a second one)*.
- `CLAUDE.md` conventions — `FRFG_FEEDBACK_URL` joins the recognised env names.
- `.env.example` — the new name, with a comment saying it is optional and what happens
  when it is unset.
- `landingpage/backend/README.md` — the three new tables and the two new env vars.

## Done when

A fresh session reading only `CLAUDE.md` and `docs/MAP.md` can find the redactor and
the egress point without grepping, and knows not to add a second sink.
