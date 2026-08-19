# Beta feedback capture — spec

**Status:** shipped 2026-07-30 — all 11 tickets resolved, and the Convex half is live
(`landingpage/js/data.js` `FF.CONVEX` points at a real deployment as of 074ab57).
This said `planned` until 2026-08-02 while every one of its own tickets said `resolved`.
**Created:** 2026-07-30
**Slug:** `beta-feedback`

A beta tester hits a bug in FrameForge. Today the only way that reaches us is if they
remember it, find us, and describe it in prose — which means we get "generation is
broken sometimes" and never the one line of evidence that would have made it a
five-minute fix.

This spec builds the thing that closes that gap: a capture surface inside the app that
takes a screenshot and the evidence around the moment, a redaction layer that makes
that evidence safe to send, a Convex store that collects it centrally, an AI triage
pass that decides **what kind of problem this is and whether it needs a human**, and a
GitHub Issue that lands with all of it already written up.

The reference implementation is `Brand Catalog Flow`'s `platformFeedback` — a Convex
table, a FAB, a dialog, an action that mirrors to ClickUp. This spec keeps its shape
and departs from it in four places, each for a reason stated below.

---

## 1. What this is, and what it is not

**It is** a bug-report pipeline for a small, known set of beta testers running a
desktop app on their own machines.

**It is not:**

- an analytics product. No background telemetry, no session recording, no event stream.
  Nothing is transmitted unless a human presses **Send report**.
- a crash reporter. Uncaught errors are *captured into a local ring buffer* so they are
  available if the user then files a report. They are never auto-sent.
- a second issue tracker. `docs/specs/` remains where **our own** specs and tickets
  live (`docs/agents/issue-tracker.md`). This pipeline writes GitHub Issues because
  inbound reports are a different class of object: they arrive from outside, they have
  a lifecycle we do not control, they need to be closeable by a commit, and there may
  be hundreds. Specs stay markdown. Reports become Issues. Neither moves.
- an auto-fixer. The AI triages and files. It does not write code, open branches, or
  raise PRs. (The reference project's `claude-bridge` does; we deliberately stop
  short — see §11.)

## 2. The privacy contract

This is the load-bearing section. Everything else is plumbing.

FrameForge is local-first and holds, in memory and on disk, things that must never
leave the user's machine by accident:

| What | Where it shows up |
|---|---|
| `FAL_KEY`, `GROQ_API_KEY`, `KIE_API_KEY` in cleartext | `workspace/settings.md`, `.env`, request headers, `/api/state` |
| Signed provider URLs granting read access to their media | `fetch` responses, `<img src>`, console logs |
| Absolute paths carrying the user's real name | every server log line, every error stack |
| Prompt text and generated imagery — the user's creative work | request bodies, `dataUrl` previews |

A naive "capture the console and the network tab" feature exfiltrates all four on the
first report. So:

1. **Nothing is transmitted without an explicit press.** The capture buffers are
   in-memory ring buffers in the renderer and the server. They are not persisted, not
   sampled, not flushed on a timer, and are dropped on reload.
2. **One egress point.** The renderer never talks to Convex. The report is assembled
   and sent by `backend/feedback.mjs` and nowhere else — one file to audit, and it is
   the only file in the repo that makes an outbound request to a FrameForge-owned
   server. (The app's local-only guard, `backend/index.mjs:96`, means a visited web
   page cannot reach the API to trigger it either.)
3. **Redaction is a shared, tested module,** `shared/redact.mjs`, applied on the server
   immediately before the envelope is sealed — after every contributor has added its
   part, so nothing can be added downstream of it. It is covered by
   `tests/phase-feedback-redaction.test.mjs`, and that test is the gate on this
   feature: if it fails, the feature is broken, not the test.
4. **The user sees the payload.** The review step of the panel renders the exact
   redacted envelope that will be sent, section by section, each with a toggle. It is
   not a summary of the payload; it is the payload. Sending is disabled until it has
   been rendered at least once.
5. **Request and response bodies are not captured by default.** We keep method, path,
   status, duration and — for a failed call — the `error` string our own routes already
   return, which is written for humans and carries no secrets. Full bodies are an
   explicit opt-in tick per report.
6. **No IP-derived geolocation, no persistent cross-machine identifier.** A random
   `machineId` is minted once into `ui-state.md` so repeat reports from one tester can
   be threaded. It means nothing off that machine and is not derived from hardware.

The panel states this in one line the user can actually read, and the review step
proves it. A privacy claim that cannot be checked is a marketing claim.

## 3. Shape

```
   ┌────────────────────────── the user's machine ──────────────────────────┐
   │                                                                        │
   │  renderer (React)                          server (Express, 5176)      │
   │  ┌──────────────────────────┐              ┌────────────────────────┐  │
   │  │ feedbackCapture.js       │              │ feedback.mjs           │  │
   │  │  · console ring    (100) │              │  · server log ring(200)│  │
   │  │  · error/rejection ring  │              │  · /api call ring (60) │  │
   │  │  · fetch ring       (40) │  ──POST──▶   │  · env facts           │  │
   │  │  · interaction trail(50) │  /api/       │  · REDACT  ← the gate  │  │
   │  │  · screenshot (native)   │  feedback    │  · seal envelope       │  │
   │  └──────────────────────────┘              └───────────┬────────────┘  │
   │           ▲ Feedback.jsx — capture · annotate · REVIEW │               │
   └───────────────────────────────────────────────────────┼───────────────┘
                                                            │ HTTPS, once,
                                                            │ on press
                    ┌───────────────────────────────────────▼──────────────┐
                    │ Convex  (the existing landing deployment)             │
                    │  reports · reportOccurrences · reportEvents           │
                    │     │                                                 │
                    │     ├─▶ signature dedupe  ── match ─▶ +1 occurrence   │
                    │     │                                    (no issue)   │
                    │     └─▶ triage action (Claude) ─▶ verdict             │
                    │                                    │                  │
                    │                       ┌────────────┴────────────┐     │
                    │                  not-a-bug /              else        │
                    │                  needs-more-info            │         │
                    │                       │                     ▼         │
                    │                  reply to reporter    GitHub Issue    │
                    └──────────────────────────────────────────────────────┘
```

## 4. Capture — what lands in the envelope

### 4.1 From the renderer

Installed by `frontend/main.jsx` **before** `createRoot`, so a crash during boot is
still in the buffer. All buffers are fixed-size rings; the oldest entry falls off.

| Buffer | Size | Contents |
|---|---|---|
| console | 100 | level, message, `t` (ms since load). `console.error/warn/log/info` are wrapped, and **the original is always called first** — the devtools console must behave identically with this installed. |
| errors | 25 | `window.onerror` + `unhandledrejection`: message, stack, source, line/col. Also fed by `main.jsx`'s `ErrorBoundary`, which currently swallows the error into a card — it will hand it here too. |
| network | 40 | `fetch` wrapped: method, path (query stripped unless same-origin `/api`), status, duration ms, and `error` from a non-2xx JSON body. No bodies (§2.5). The wrapper is pass-through on the happy path and must never change `fetch` semantics — it awaits nothing the caller doesn't. |
| interactions | 50 | The repro trail: page/tab changes, clicks (element role + accessible label + nearest `data-ff` marker — **never** input values or text content), keyboard shortcuts fired through `App.onKey`. This is what replaces jam.dev's video, at a fraction of the cost. |

A `screenshot`, captured on demand at the moment the panel opens (see §5).

### 4.2 From the server

`backend/feedback.mjs` owns these and they are new:

- **Log ring (200 lines).** `console.log/warn/error` in the server process are teed into
  a ring at startup. Nothing else about server logging changes — stdout still goes to
  the terminal and to Electron's `[server]` pipe.
- **API call ring (60).** The existing `res.on('finish')` middleware seam at
  `index.mjs:132` already runs on every request; it gains a sibling that records
  method, path, status, duration and — on a 4xx/5xx — the `error` string.
- **Job and generation failures (last 10).** Read from the jobs/ledger surface. A
  provider timeout or a poll error is the single most likely thing a tester reports,
  and it is already recorded; the report should carry it rather than make the tester
  describe it.

### 4.3 Environment facts

Booleans and versions only. Never a value.

```
app        0.1.0            (package.json)
build      electron | dev   (how the renderer was served)
platform   darwin 25.2.0 · arm64 · node 20.x · electron 33.x
storage    ~/…/storage      (redacted to ~)
providers  fal:configured  groq:configured  kie:absent      ← booleans, never keys
modules    remotion:on stage3d:on … (resolveModules())
agent      claude:present codex:absent
binaries   ffmpeg:present yt-dlp:absent
project    <id> · 42 shots · 310 generations               (counts, no names)
```

`providers` matters more than it looks: a large share of "it's broken" reports are a
missing key or a missing `ffmpeg`, and this line turns those into a
`not-a-bug` verdict with a one-line answer instead of an issue.

## 5. The screenshot

Two paths, one API:

- **Electron (the shipped app).** A new `desktop/preload.cjs` exposes
  `window.frameforge.capture(rect?)` over `contextBridge`; the main process answers
  with `win.webContents.capturePage(rect)`. This is the real native capture: it sees
  WebGL (the 3D stage), `<video>`, and everything else a DOM rasteriser gets wrong. It
  captures **only the FrameForge window**, never the desktop, so nothing else on the
  tester's screen can be caught by accident. No OS permission prompt.
  Adding a preload is a change to `webPreferences`; `contextIsolation: true` and
  `nodeIntegration: false` stay exactly as they are, and the bridge exposes **one
  function taking a rectangle and returning a PNG** — no filesystem, no shell, no IPC
  surface beyond that.
- **Browser dev (`npm run dev`).** No preload. Falls back to
  `getDisplayMedia({ preferCurrentTab: true })`, which shows the browser's own picker.
  Acceptable for developers; it is not the path a tester takes.

Region select is a drag over a dimmed overlay, then re-capture at that rect. Annotation
is two tools only — a box and an arrow, drawn onto a canvas layer and flattened into
the PNG on send. A blur tool is deliberately included as the third: a tester who spots
something private in their own shot needs to be able to remove it, and telling them to
"just don't screenshot that" is not an answer.

## 6. Redaction — `shared/redact.mjs`

Ordered, because order matters: exact secrets first (they may contain characters that
later rules would rewrite), then shapes, then paths.

1. **Exact known secrets.** Every non-empty value of `SECRET_SETTING_KEYS` from
   `getSettings()`, plus `process.env.FAL_KEY|GROQ_API_KEY|KIE_API_KEY`, replaced
   wherever they appear. This is the strongest rule in the file because it needs no
   guess about key format — it catches a provider that changes its key shape tomorrow.
   Server-side only; the renderer never holds these (`/api/state` returns
   `publicSettings()`).
2. **Key shapes**, for keys that are not ours — a tester pasting someone's key into a
   prompt, a third-party token in a log line:
   `sk-ant-…`, `sk-…`, `gsk_…`, `gh[pousr]_…`, `AKIA…`, `Bearer <token>`,
   `Key <token>`, `eyJ….….…` (JWT), and `fal_…` / the `<uuid>:<hex32>` FAL form.
3. **Signed URLs.** Any URL whose query carries `X-Amz-Signature`, `Signature`, `sig`,
   `token`, `key`, `Policy` or `Expires` keeps its origin and path and loses its query:
   `https://fal.media/files/…/out.png?<signed>`. A signed URL is a bearer credential
   for the user's own media; it is not less sensitive than a key.
4. **Base64 blobs.** `data:<mime>;base64,…` over 256 chars → `data:<mime>;base64,<12.4 KB elided>`.
   Non-negotiable: `styleLockPreview` returns a `dataUrl`, so these *will* be in the
   console ring, and one of them can be megabytes.
5. **Home directory.** `/Users/<name>` and `C:\Users\<name>` → `~`. Applied last among
   the rewrites so it does not corrupt an earlier match, and it removes the tester's
   real name from every stack trace at once.
6. **Third-party emails** → `<email>`. The reporter's own address rides in its own
   field and is not touched.
7. **Entropy sweep.** Any remaining bare run of ≥32 chars that is pure hex or
   base64url and is not a known-safe shape (git sha, content hash, uuid) →
   `<redacted:high-entropy>`. This over-redacts occasionally. That is the correct
   trade: an elided string costs one follow-up question, a leaked one cannot be undone.

`redact()` takes and returns a JSON-serialisable value and walks it — strings, arrays,
objects, keys included. It returns `{ value, hits: { rule: count } }`, and `hits` is
shown in the review panel: *"14 values redacted — 2 keys, 9 paths, 3 signed URLs."*
A user who can see the redactor working will trust it; a silent one they must take on
faith.

## 7. The envelope

```jsonc
{
  "code": "FF-7K2Q",            // minted client-side, shown before send, is the ticket
  "kind": "bug|confusing|idea",  // what the user picked
  "title": "...",                // user's words, one line
  "body": "...",                 // user's words, free text
  "severity": "blocks-me|annoying|cosmetic",   // the user's felt severity, not the AI's
  "reporter": { "email": "…|null", "machineId": "m_…", "consentedAt": 1753...  },
  "where": { "page": "project", "tab": "generate", "projectShots": 42 },
  "app": { /* §4.3 env facts */ },
  "client": { "console": [...], "errors": [...], "network": [...], "interactions": [...] },
  "server": { "log": [...], "api": [...], "failures": [...] },
  "attachments": [ { "kind": "screenshot", "storageId": "…", "bytes": 184320 } ],
  "signature": "sha256:…",       // §8
  "redaction": { "hits": { "exact-secret": 2, "home-path": 9 }, "version": 1 },
  "sentAt": 1753...
}
```

Sections the user untoggled are **absent**, not emptied — a present-but-empty section
reads as "we had nothing", which is a different and misleading fact.

## 8. Dedupe before AI, always

Twenty testers hitting one crash must produce **one** issue with twenty occurrences,
not twenty issues. The AI is not asked to work this out, because a deterministic
answer exists and is free:

```
signature = sha256(
     normalise(top error frame or the failing route)
  ‖  normalise(error message: digits, uuids, paths, ids → ·)
  ‖  app.version
)
```

On arrival: if an open report carries this signature, append a row to
`reportOccurrences`, bump `occurrences`, add a comment on the GitHub Issue only when
the count crosses 5, 25, 100 — and **stop**. No triage call, no second issue. Only a
novel signature reaches the model. Near-duplicates that differ in signature are caught
by the model's `duplicateOf`, against a shortlist of open reports it is shown.

## 9. Triage

A Convex `"use node"` action calls Claude with the redacted envelope, the repo's file
map (`docs/MAP.md` + a generated file index), and a shortlist of open reports. It must
return exactly this, validated before use — a malformed reply is retried once, then
parked as `triage-failed` with the raw text kept:

```jsonc
{
  "title": "...",                    // imperative, ≤70 chars, rewritten
  "kind": "bug|regression|ux|feature|question|not-a-bug",
  "severity": "critical|high|medium|low",
  "area": "frontend/ShotWorkspace.jsx | backend/generate.mjs | desktop | provider | unknown",
  "disposition": "auto-fixable|needs-human-decision|needs-more-info|not-a-bug|duplicate",
  "confidence": 0.0,
  "summary": "...",
  "reproSteps": ["..."],
  "expected": "...",
  "actual": "...",
  "suspects": [{ "file": "frontend/ShotWorkspace.jsx", "line": 212, "why": "..." }],
  "missingInfo": ["..."],
  "duplicateOf": "FF-XXXX|null",
  "rationale": "..."
}
```

`disposition` is the field the whole feature exists to produce. Its definitions are
part of the prompt and are not left to taste:

- **`auto-fixable`** — the correct behaviour is not in question and the change is
  local: a missing field on a request, a wrong prop, a bad guard, an off-by-one. One
  file, no product decision. *(Example: `ShotWorkspace` sends no `resolution` or
  `params` — CLAUDE.md already records this. There is one right answer.)*
- **`needs-human-decision`** — the correct behaviour is a **choice**. Two surfaces
  disagree and picking one is a product call; the fix trades cost, latency or UX
  against each other; or it needs a stance we have not taken.
- **`needs-more-info`** — the evidence does not identify the failure. `missingInfo`
  must name what to ask for, specifically enough to put in a reply.
- **`not-a-bug`** — working as designed, or the reporter's machine is missing a key or
  a binary that `app.providers`/`app.binaries` shows absent. No issue is opened; the
  reporter gets the answer.
- **`duplicate`** — matches `duplicateOf`. Recorded as an occurrence.

Confidence below 0.4 is downgraded to `needs-more-info` regardless of what the model
said. A confident-sounding wrong verdict is worse than an honest shrug.

## 10. The GitHub sink

One adapter, one interface, so the choice is reversible:

```js
// backend-agnostic; lives in Convex
export const sinks = { github, /* linear: laterIfWanted */ };
// sink.create(report, verdict) -> { url, ref }
// sink.comment(ref, text)
// sink.close(ref, reason)
```

GitHub is first because `DevFrmwrkd/frameforge` already exists, an Issue is closed by
the commit that fixes it, and it needs one fine-grained PAT (Issues: read+write on that
repo, nothing else) in Convex env. Linear slots in behind the same three methods if the
triage queue outgrows Issues; nothing above this line changes.

Issues open with labels `bug|ux|feature`, `sev:<severity>`, `ai:<disposition>`,
`area:<top-level dir>` and `beta`. `not-a-bug` and `needs-more-info` never open one.
The body is the verdict rendered as markdown, with the evidence in `<details>` blocks
and the screenshot inline — collapsed, so the issue stays readable.

## 11. Why no auto-fix PR

The reference project posts to a `claude-bridge` that runs Claude headless, pushes a
branch and opens a PR. It is a good idea and it is the natural next step. It is out of
scope here because it requires a machine holding a checkout and credentials, kept alive
and trusted, and because a PR from an untriaged report is a review burden, not a
saving. The `auto-fixable` verdict is the input that step would need; when the runner
exists, it reads that field and nothing in this spec changes. **Build the judgement
first, automate the judgement second.**

## 12. Back to the reporter

The part every internal feedback tool forgets, and the reason testers stop reporting.

The panel keeps a **My reports** list, polled from Convex by code: `triaged`,
`issue #41`, `fixed in 0.1.4`. The report code is shown at send and is copyable. When
an Issue closes, the report moves to `fixed` and the app says so the next time it is
opened. A tester who watches their bug get fixed files the next one.

## 13. Failure modes, and what happens

| Failure | Behaviour |
|---|---|
| Convex unreachable | The envelope is queued to `workspace/feedback/outbox/<code>.md` and retried on next launch. A report a tester typed must never be lost to a flaky network. |
| Convex configured but rejecting | Same queue, plus a visible error with the status. Never a silent success. |
| No Convex URL configured (a dev build) | The panel still works and writes the envelope to the outbox. Sending is disabled with the reason shown, not hidden. |
| Screenshot capture fails | Report sends without it, with a note in the envelope. Never blocks. |
| Triage model fails twice | Report parked `triage-failed`, raw response kept, **the Issue is opened anyway** from the user's own words. A broken model must not swallow a bug report. |
| GitHub PAT missing or 401 | Report stays `triaged`, `sinkError` recorded, retried by cron. The verdict is already the valuable part. |
| Redaction throws | **Send is aborted.** The one failure in this pipeline that fails closed. |

## 14. Out of scope

Screen recording (decided against — the interaction trail carries the repro at a
fraction of the cost and none of the "is it recording?" burden), in-app reply threads
(the reporter gets status, not a chat), voting or a public roadmap, and multi-tenant
anything. All of it is addable behind what this builds.

## 15. Ticket queue

| # | Ticket | Why it is where it is |
|---|---|---|
| 01 | `shared/redact.mjs` + tests | Everything else is gated on this. Written and tested before a single byte can be captured. |
| 02 | `frontend/feedbackCapture.js` — the four rings | Pure module, no React, testable |
| 03 | Server rings + env facts in `backend/feedback.mjs` | |
| 04 | Native screenshot: `desktop/preload.cjs` + IPC + browser fallback | |
| 05 | `frontend/Feedback.jsx` — capture · annotate · **review** · send | The review step is the deliverable, not the form |
| 06 | Egress + outbox + `POST /api/feedback`, wired to `shared/integrations.mjs` | |
| 07 | Convex: schema, mutations, signature dedupe, http routes | |
| 08 | Triage action + verdict validation | |
| 09 | GitHub sink behind the adapter interface | |
| 10 | My reports — status back to the reporter | |
| 11 | Docs: `docs/MAP.md` row, CLAUDE.md source-of-truth rows, `.env.example` | Repo rule: a new source of truth is declared where agents look for it |
