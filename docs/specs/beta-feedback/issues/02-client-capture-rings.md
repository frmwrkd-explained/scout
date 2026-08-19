# 02 — frontend/feedbackCapture.js — the four rings

**Status:** resolved
**Blocked by:** 01

Pure module, no React, no JSX. `install()` is called from `frontend/main.jsx`
**before** `createRoot` so a boot crash is already in the buffer.

Four fixed-size rings (spec §4.1): console 100 · errors 25 · network 40 ·
interactions 50. Plus `snapshot()` → the plain object the panel reads.

## Constraints that are not negotiable

- The console wrapper **calls the original first**, always, before recording. Devtools
  must behave identically with this installed.
- The `fetch` wrapper is pass-through. It does not clone, buffer or await a body on the
  happy path; on a non-2xx it reads `error` from a cloned JSON body and swallows any
  failure doing so. A capture layer that changes `fetch` timing has broken the app.
- The interaction trail records element **role + accessible label + `data-ff`**. Never
  `value`, never `textContent`. Grep the diff for `.value` before calling this done.
- Ring writes are O(1) and allocate nothing per event beyond the record itself.

`main.jsx`'s `ErrorBoundary` gains a `componentDidCatch` that forwards to the error
ring — today it swallows the error into a card and the stack is lost.

## Done when

The app runs with the module installed and: devtools output is unchanged, a
deliberate throw appears in `snapshot().errors` with its stack, a failed `/api` call
appears in `snapshot().network` with the server's `error` string, and no captured
record contains user-typed text.
