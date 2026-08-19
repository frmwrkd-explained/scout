# 06 — Server-side grid split as a first-class operation

**What to build:** Splitting a generated grid image (3×3, 2×2, etc.) becomes a
backend operation any client — including the chat agent — can invoke. Extract the
grid splitter's detection/scoring core (grid candidates, edge-energy scoring, gutter
trim, cell geometry) into a shared module usable by both the browser tool and the
backend. Add an API route that takes a generation id (or context asset), an optional
rows/cols override, and an optional shot mapping; it writes each kept cell as a new
child generation record (parentGeneration set, provenance noted) with its own render
file, and optionally attaches cells to shots as candidates. The existing Grid
Splitter tool page adopts the shared core so detection logic exists once.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A shared module holds grid detection/scoring/cell-geometry, imported by both the tool page and the backend
      (`shared/gridsplit.mjs`: `detectGrid`, `scoreGrid`, `buildLumProfiles`, `cellRects`, `cellKey`; imported by
      `frontend/GridSplitter.jsx` and `backend/gridsplit.mjs`. The pure core takes a plain `{data,width,height}`
      RGBA view — the browser feeds canvas ImageData, the backend feeds sharp-decoded buffers; no canvas/DOM/fs in it)
- [x] The split route produces one child generation record + render file per kept cell, linked to the parent
      (`POST /api/generations/:pid/:id/split-grid` → `backend/gridsplit.mjs` `splitGridGeneration`; each cell is a
      schema-2 record, `tool:'gridsplit'`, `parentGeneration` set, born `status:'done'`/`reviewState:'new'`, with a
      cropped `.jpg` render written via an exclusive-create loop)
- [x] Optional shot mapping attaches each cell to the given shot as a candidate
      (`shots` map keyed `'r-c'` → shotId sets `shot` on the child record so it appears as a candidate; validated
      up-front so a bad shot id never leaves a partial split)
- [x] Auto-detection picks the right grid for a genuine 3×3 test image; explicit rows/cols override works
      (auto-detect decodes+downscales the parent with sharp and runs the shared `detectGrid`; `rows`/`cols` in the
      body override it)
- [x] node --test coverage: split a synthetic grid under temp FRFG_DATA, assert child records, files, and shot attachment
      (`tests/phase6-gridsplit.test.mjs` — 5 tests, all pass: 3×3 auto-detect → 9 linked children + files, 2×2
      override, skip + shot attachment, bad-shot rejection with no partial writes, unfinished-render guard)
