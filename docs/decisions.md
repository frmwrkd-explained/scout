# Decisions

One entry per ambiguous choice made during the build: the question, the choice, and the reason. Newest first.

---

## 2026-08-19 · Phase 0 — source materials

### Fresh git history, not FrameForge's
**Q:** `tasks/T01` says copy FrameForge in. Copy its `.git` too?
**Choice:** No. `.git` (313MB) excluded; Scout gets its own history.
**Why:** FrameForge's history carries `origin → DevFrmwrkd/frameforge`, a private remote for a different product. Inheriting it means Scout's first push targets FrameForge, and the global git-hygiene rules exist because exactly that kind of entanglement cost days on `frmwrkd-studio`. The provenance is documented in `CLAUDE.md` and `docs/06_REUSE.md`; it does not need to be in the object store.

### Three more exclusions beyond T01's list
**Q:** T01 names `workspace/ .env node_modules/ dist/ release/ landingpage/`. What about the rest?
**Choice:** Also excluded `.env.bak.*`, `.wrangler/`, `frameforge-redesign DESIGN EXMPLE/`, and `._*` sidecars.
**Why:** All four are gitignored in FrameForge for stated reasons. `.env.bak.*` is the key-rotation script's output and held live FAL/Groq keys — `.env` alone does not match it, which is why FrameForge ignores the whole family. `.wrangler/` holds real dev bug-report screenshots. The redesign bundle is a design reference, and Scout has its own in `design/`. Everything else was copied verbatim and gets stripped in Phase 2, not pre-judged here.

### FrameForge's agent docs preserved, not overwritten
**Q:** The copy overwrote Scout's `CLAUDE.md` and `README.md` with FrameForge's.
**Choice:** Restored Scout's; moved FrameForge's to `docs/FRAMEFORGE_CLAUDE.md`, `docs/FRAMEFORGE_README.md`, `docs/FRAMEFORGE_ISSUES.md`.
**Why:** Scout's `CLAUDE.md` is the build contract and must win. But FrameForge's documents traps that have already cost days (the lying `rg -r` search, the NUL byte that made `store.mjs` invisible to grep, the `._*` sidecars that fail `npm test`, the `127.0.0.1` rule) and `START.md` requires reading it. Deleting it would delete the warnings.

### Phase 0c produced no change
**Q:** Which tokens does the design add or conflict on?
**Choice:** None. 27 of 27 identical, byte-for-byte, across all eight screens.
**Why:** Recorded because "no diff" is the finding, not a skipped step. There is no reconciliation commit because there is nothing to reconcile — the design was built on FrameForge's `:root`, as `README.md` claimed. Evidence and method are in `design/EXTRACT.md` §1.

### D1 · Properties collapse — the spec overrides the design
**Q:** `Scout.dc.html` renders properties expanded above the summary. `docs/05_UI_SPEC.md` §2.1 requires them collapsed.
**Choice:** Spec wins. Properties collapse on open, with a summary row carrying gate status, primary number and freshness.
**Why:** Not a real ambiguity — §2.1 quotes the design's own behaviour ("nine property rows before a single human sentence") and says *"Invert it"*. It is a deliberate override, not an oversight, and Law 2 is the reason. The design's body-collapse and its `WRITTEN BY …` provenance line are kept as drawn.

### D2 · The design's inspector is already correct
**Q:** Does the inspector need changes for T05?
**Choice:** No. Port as drawn.
**Why:** It already has the five sections in the spec's order, one expanded at a time, a count on every header that has one, and `REFERENCED BY` styled distinctly from `LINKS`.

### D3 · `Review Deck` is `Decide` filtered, not a second screen
**Q:** Two decision-card screens are drawn. Build both?
**Choice:** One component, `DecideCard.jsx`. `Review Deck` is `Decide` scoped to one collection and one card kind.
**Why:** Same keys, same reason grid, same footer counters, same altitude ladder; `Review Deck` has one card kind where `Decide` has five. Law 10 — a second implementation is a bug.
