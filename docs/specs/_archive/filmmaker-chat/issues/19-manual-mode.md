# 19 — Manual mode: structured, spec-driven generation from the chat

**What to build:** Flipping the composer's mode switch to Manual transforms it into
a structured generation form: an output-kind selector (image / video / music /
voice / sound design — the catalog kinds), the shared ModelPicker filtered to that
kind, and the SchemaForm for the chosen model (real resolution enums, duration
ranges, reference slots — never a hard-coded "HD only" assumption), plus prompt
field and reference attachments. Locked style/cast/location from the Production
Panel still compose in by id (a visible, toggleable "locks applied" row). Submitting
creates generations that appear as the same inline cards (ticket 14), recorded as
manual-mode turns in the session history. Switching back to Agent preserves the
conversation.

**Blocked by:** 05 — SchemaForm; 07 — Audio model kinds; 11 — Chat UI shell; 14 — Generation cards.

**Status:** done

- [x] Manual mode shows kind list → model picker → spec-driven settings; changing model visibly changes available settings — verified in-browser (nano-banana-2 renders its synced Aspect Ratio + Safety Tolerance spec; Seedance i2v renders the generic FormatControls fallback)
- [x] Video models expose their real duration/resolution options from the synced spec; unsynced models fall back to generic format controls — SchemaForm drives this (real spec fields when synced; FormatControls aspect/resolution/seed fallback otherwise), verified in-browser
- [~] Music/voice/sfx kinds generate playable audio via their cards — the three audio output kinds select their catalog models and the payload shape (prompt + refs + params via /api/generate) is identical to the visual path so ticket 14's cards render `kind:'audio'` playable audio; the actual generation needs a live FAL key + the ticket-07 audio provider branch, so end-to-end playback is **live-only** (payload shape verified hermetically + in-browser)
- [x] Locks-applied row shows the composed style/cast/loc ids and can be toggled off per submission — style lock (pdef.styleLock) composes its fragment into the prompt via joinFragment exactly like the console; cast/location (first board item of each) compose as generation refs by id; each pill toggles off per submission. Verified in-browser (all three ids shown)
- [x] Manual generations appear in session history and the cost ledger like agent-initiated ones — POST /api/chat/sessions/:id/manual-turn persists a user message + an assistant message carrying the `generation`/`generation.batch` directive at a ⟦frameforge:0⟧ marker (ticket 12 shape); the started generation records carry the ledgered cost the cards read. Covered by tests/phase19-manual-mode.test.mjs

**Implementation notes**
- `frontend/chat/ManualComposer.jsx` (new) — the structured composer; `frontend/Chat.jsx` mounts it in the Manual branch and shares the ticket-18 attachment tray (dropped images become refs).
- `backend/chat.mjs` — additive `recordManualTurn()` + `POST /api/chat/sessions/:id/manual-turn`; `frontend/api.js` — `chatManualTurn` (append-only).
- ModelPicker's built-in filter is video-vs-not only and cannot isolate a single kind or the audio kinds, and `GenerationControls.jsx` is out of this ticket's file scope — so ManualComposer filters the SAME `enabledCatalog` by output-kind itself (presentation only, no second catalog). SchemaForm / FormatControls / lookBuilder / estCost are reused untouched.
- `/api/generate` and `startGeneration` do not (yet) destructure `params` — the composer sends `...paramsField()` anyway to stay byte-identical to the generate console; wiring params → providers is ticket 07's job.
