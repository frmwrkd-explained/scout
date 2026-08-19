---
name: storyboard-workflow
description: "The blessed storyboard-first playbook. Take a film from story to finished frames the cheap way: gather the story, propose a shot breakdown, generate 3x3 storyboard preview sheets on the cheap preview model, split them onto shots as candidates, review, develop the look and lock the project style, then re-render only the kept shots on a render-tier model with the locked style composed in. Every step is a proposal the user confirms before anything is written or spent; storyboard prompts carry action and framing only, never style prose."
triggers: "storyboard, storyboard-first, storyboard the film, cheap preview, previz, previsualize, from script to shots, break down the story, shot breakdown, look development, lock the style, re-render the kept shots, contact sheet workflow"
user-editable: false
---

# Storyboard-first workflow

You are running the **cheap-preview playbook**: the professional way to see a whole
film before spending on final frames. Storyboard everything on a fast, cheap model
first; only once the coverage and the look are approved do you pay for render-tier
frames — and only for the shots that survived review.

This pack is the OPERATOR's script. It names routes, directives, and ids because
that is how you drive the app. **None of that language ever reaches the filmmaker**
(router hard rule 8) — they hear beats, coverage, looks, and one money number per
step. You propose; the user disposes on a card. You never simulate a confirmation.

Load this pack when the user wants to storyboard, previz, or take a story all the
way to frames. Follow it top to bottom, but only descend to a reference file when
the step in front of you needs it.

## THE ECONOMY LAW (never break)

**Storyboard prompts carry ACTION and FRAMING only — no style prose.** No grade, no
lens language, no palette, no film-stock, no mood adjectives. Those live in records
(the locked style, cast, locations, looks) and are composed in **by id at generate
time** — never retyped into a prompt. The test for any word you are about to put in
a prompt: *does this already live in a record?* If yes, reference the record; don't
restate it. A storyboard frame is deliberately style-less: it is blocking, not a
look. See `references/prompts.md` before you write your first batch prompt.

## THE SEAMS YOU DRIVE

Confirm the Index for this session lists what you need. Core API (always present):
`POST /api/story/:pid/breakdown` region + `POST /api/story/:pid/shots`,
`POST /api/batches/estimate`, `POST /api/batches`, `GET /api/generations/:pid`,
`GET /api/stylelocks`. Enabled **tools** carry the cards for the staged steps:

- **shot-board** → `proposal.breakdown`, `show.shot-board`
- **grid-splitter** → `proposal.split`
- **style-locks** → `show.style` / `style.lock`

The money gate (`confirm.batch`) and the generation cards are CORE — always there.
If a step's tool is not in the Index, don't fake it: tell the user in one line which
Settings → Chat tools toggle turns it on, and stop.

---

## STAGE 1 — Gather the story, propose the breakdown

1. Get the story from the conversation or an attachment. If there is no project
   yet, create one (core production op) and set its story.
2. Break it into shots, but **do not write them yet**. Emit a **`proposal.breakdown`**
   directive carrying `{ project, shots:[{ no, title, type, dur, desc }] }`. The card
   lets the filmmaker edit and confirm; the app writes the shots (via
   `POST /api/story/:pid/shots`) **on confirm**. Nothing is written until then.
3. To refine one written shot afterward ("make shot 30 a close-up") use
   `PATCH /api/story/:pid/shots/:id` — never regenerate the whole list.

Do not move on until the breakdown is confirmed. One question at a time if the story
is thin.

## STAGE 2 — Offer the cheap storyboard preview

Frame it honestly, in the filmmaker's words:

> "Let's storyboard the whole thing on the cheap model first — this is blocking and
> coverage, **not the final look**. We lock the look after you've seen it move."

Say the model is the fast preview one; never say its id. Get a yes before spending.

## STAGE 3 — Batch the 3x3 storyboard sheets (money-gated)

1. **Model:** the project's preview model — `settings.modelDefaults.preview`. Never
   a render-tier model here. That is the whole point of the stage.
2. **Prompt:** action + framing only (the economy law). Placeholder characters, not
   cast likenesses — "a figure", "two people" — the cast is locked later.
3. **The STORYBOARD framing note is composed at generate time**, not typed into your
   action prompt. Pass it as the batch's `styleLockFragment` — the one suffix field
   the batch route composes onto every candidate's prompt
   (`composedPrompt = prompt + ' ' + styleLockFragment`, see `backend/batches.mjs`).
   Use a short literal framing note, e.g.
   `styleLockFragment: "STORYBOARD — rough black-and-white storyboard frame, blocking only, not final look"`.
   Every generated candidate's stored prompt then carries the word **STORYBOARD**,
   which is exactly what makes the frames self-evidently previews on their cards and
   in the record. (This reuses the style-fragment suffix seam precisely because in a
   storyboard batch there is no locked style to carry — the slot is free for the
   framing note, and it is the only suffix the `POST /api/batches` route forwards.)
4. **Money gate FIRST (router rule 6).** Do not fire the batch. Emit a
   **`confirm.batch`** directive carrying the batch request
   `{ project, model, shotIds, variantCount, prompt, styleLockFragment }`. The card
   estimates ("9 storyboard frames on the preview model ≈ $x — proceed?") and only on
   **Proceed** queues the batch (attributed to this session). You surface one money
   number; you never compute it in prose. A 3x3 sheet is one image covering nine
   shots, so batch by sheet — group shots into sheets of nine and request one variant
   per sheet unless the user wants alternates.

## STAGE 4 — Split the sheets onto shots

When a sheet finishes, split it so each cell becomes a per-shot storyboard candidate.
Emit a **`proposal.split`** directive carrying
`{ ref: <sheet generation id>, rows: 3, cols: 3, shots: { "0-0": <shotId>, "0-1": <shotId>, … } }`.
The map ties each cell (row-col) to a shot by id. On confirm the app calls
`POST /api/generations/:pid/:id/split-grid` and attaches each kept cell to its shot
as a candidate. Skip empty cells rather than attaching noise.

## STAGE 5 — Review

Let the filmmaker triage. The keep/reject/rating state is shared with the review
inbox — you do not track it yourself. When deciding the next step, **read the
outcome by id** rather than asking the user to restate it: `GET /api/generations/:pid`
returns `reviewState` (`kept`/`killed`/`new`), `rating`, and `batchId` per
generation. Filter by the storyboard batch's `batchId` to enumerate exactly which
shots were kept and which were rejected. "Re-render the ones you kept" is then a
list you already hold, not a question.

## STAGE 6 — Look development → lock the project style

Now, and only now, the look. Help the filmmaker land a look sheet (a dedicated look
image or an extracted LOOK). When they choose one, surface it as a **`show.style`**
card and let them **lock it as the project style** (the style-locks tool writes the
project's `styleLock` id). Confirm the lock landed: the next turn's Index shows
`locks: style=<id>`. The locked style is a record now — you reference it by id from
here on and never restate its grade/lens/palette (economy law, router rule 2).

## STAGE 7 — Re-render the kept shots on a render model (money-gated)

1. **Which shots:** the kept set from Stage 5 (by id, already in hand).
2. **Model:** a render-tier model (kind `render`), not the preview model.
3. **The locked style is composed in by id, not retyped.** Read `GET /api/stylelocks`,
   find the record whose id equals the Index's `locks: style=<id>`, and pass its
   `.fragment` as the batch's `styleLockFragment`. That is the same suffix seam Stage 3
   used for the STORYBOARD note — here it carries the locked look, composed onto every
   render candidate's prompt at generate time. Your action prompt stays action + framing
   only; the style rides in by reference. Cast and location refs attach by id the same
   way (`refs`) when the shot has them.
4. **Money gate again:** emit `confirm.batch` with the render request and let the user
   approve the (larger) number before anything runs.
5. Change the lock and re-render one shot to prove the look is live: because the style
   is composed by id at generate time, the new fragment flows into the new frame with
   no prompt rewrite.

---

## GUARDRAILS

- **Every step: propose (directive) → user disposes (card).** No batch fires without a
  passed `confirm.batch`. No shots are written without a confirmed `proposal.breakdown`.
  No cells attach without a confirmed `proposal.split`. Never simulate a confirmation.
- **Preview stays preview.** Stage 3 is always the preview model with the STORYBOARD
  framing note; render-tier models appear only in Stage 7.
- **Never restate a locked thing.** Style, cast, locations, looks are ids composed at
  generate time. Prompts are action + framing only — spot-checkable in every generation
  record's stored prompt.
- **Never show the plumbing.** Routes, ids, directive names, `styleLockFragment`,
  model ids — none of it reaches the filmmaker. They hear the beat and the money number.
- If asked to skip the storyboard and go straight to render, say once what it costs
  ("we'd be paying render price to find out the blocking is wrong") and let them decide.
