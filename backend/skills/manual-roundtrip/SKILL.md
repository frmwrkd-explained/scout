---
name: manual-roundtrip
description: "The BYO-render playbook. The filmmaker keeps FrameForge for story, shots, prompts, review and the edit — but renders the actual frames somewhere else (Google Flow, Midjourney, Krea, a local rig) because that spend is already paid for. Hand the prompts out as an ordered handoff, then file the downloads back onto their shots from the project inbox: filename first, handoff order second, and only look at the leftovers yourself. Nothing is ever filed without the user's word."
triggers: "manual, by hand, render elsewhere, google flow, veo in flow, midjourney, krea, my own rig, no fal, without spending, don't spend, copy the prompts, give me the prompts, paste into, sort my downloads, sort my inbox, file these, match these images to shots, i already rendered these, i generated these elsewhere"
user-editable: false
---

# Manual round-trip — render elsewhere, keep the pipeline

Some filmmakers will never let this app call a provider. They already pay for Google
Flow or a Midjourney seat, and spending again per image is the one thing they came
here to avoid. They still want everything else: the breakdown, the shot list, the
composed prompts, the review queue, the selects, the edit manifest.

Your job is to make that a first-class path, not a workaround.

## THE LOOP

```
shots → HANDOFF (prompts out, order recorded) → they render elsewhere
      → downloads land in projects/<pid>/inbox/
      → SCAN (free) → SORT (you, only for leftovers) → APPLY (they confirm)
      → normal generation records → review inbox → selects → edit
```

The imported files become **ordinary generation records**. Once applied, there is no
"manual" branch downstream: keep/kill, final, selects/, the edit manifest and the
Remotion handoff all work exactly as if FrameForge had rendered them.

## HARD RULES

1. **You never file anything.** `scan` and `sort` PROPOSE. Only `apply` writes, and
   `apply` runs on the user's word, on a card, with the matches visible. A wrong match
   that costs a click is fine; a wrong match applied silently loses someone's hero shot.
2. **Cheapest tier that works, always.** `scan` is free — it matches on filename and on
   the recorded handoff order. Run it first, every time. Only send `sort` the files it
   left unmatched. Re-confirming with a model what the filename already proved is exactly
   the waste this user left to avoid.
3. **Never invent a shot id.** If nothing matches, say so and return null. An honest
   "I can't tell which shot this is" is a good answer.
4. **Confidence is belief, not politeness.** Below 0.5 means "a human must look".
5. **`perShot` is the number that breaks things.** It is how many files the external tool
   produces per prompt — Flow gives 4. It is the stride order-matching counts in, so a
   wrong value misaligns everything after the first shot. Ask if you don't know.
6. Speak in shots and frames. Never say "generation record", "reviewState", or a route
   name to the filmmaker.

## THE SEAMS

Base: the self API in your Index.

| Step | Call |
|---|---|
| what's waiting | `GET /api/manual/:pid` → `{ inbox, handoffs, open, dir }` |
| hand prompts out | `POST /api/manual/:pid/handoff` `{ entries:[{shot,title,prompt,model,aspect}], perShot }` → `{ id, sheet, plain }` |
| match, free | `POST /api/manual/:pid/scan` `{ handoff? }` → `{ counts, proposals[] }` |
| match the rest | `POST /api/manual/:pid/sort` `{ files:[name…] }` → `{ proposals[], model, skipped }` |
| file them | `POST /api/manual/:pid/apply` `{ decisions:[{file,shot,prompt,matchedBy,confidence,handoff}] }` |
| drop folder | `POST /api/manual/:pid/reveal` |
| bin one | `DELETE /api/manual/:pid/file` `{ name }` |

`entries[].prompt` must be the **composed** prompt — the shot's action beat with the
project's look already joined in, i.e. what `POST /api/generate` would have received.
Read it from the shot and compose the active style lock's fragment yourself; handing out
the bare `shot.prompt` gives the filmmaker a prompt that renders differently from the one
this app would have run, and they will (rightly) blame the app.

## RUNNING IT

**Handing off.** Confirm which shots, confirm `perShot`, create the handoff, then give
them the sheet and one sentence: *drop the downloads into the project inbox and I'll file
them.* Tell them renaming is optional — order alone is enough. Never claim the prompts
are recorded until the call has returned an id.

**Filing.** `scan` first. Read the counts aloud in human terms ("34 files, 28 landed on
shots by download order, 6 I can't place"). Then, only if there are leftovers and only
with their agreement, `sort` those. Present the low-confidence rows individually — shot,
thumbnail, why — and let them correct before `apply`.

**When it goes wrong.** Files still downloading come back as `settling`; wait and re-scan
rather than importing a truncated file. `.crdownload`/`.part` files are ignored by design.
If the counts don't match what the handoff expected, say so plainly — it usually means the
tool produced a different number of variants than `perShot`, and the alignment after the
first gap is a guess, not a fact.

**When there is no handoff.** Order matching has nothing to work against, so everything
falls to filenames and then to you. Say that, and suggest making a handoff next time —
it is the difference between free filing and a slow one.
