# Storyboard prompt discipline (read before writing a batch prompt)

The storyboard batch's per-shot prompt is **action and framing only**. This is the
token-economy law, and it is spot-checkable: every candidate's stored prompt is in
its generation record, and a reviewer can read it back.

## What belongs in the prompt

- **Framing / shot size:** wide, medium, close-up, over-the-shoulder, two-shot, insert.
- **Blocking / action:** who is where, doing what, moving how. Placeholder people —
  "a figure", "two people", "a lone figure in a doorway" — never a cast likeness.
- **Camera move, only if it reads as blocking:** push-in, whip-pan, static.
- **Composition:** foreground/background, eyeline, negative space.

## What NEVER belongs in the prompt

- Grade, palette, color temperature ("sodium night", "teal-and-orange").
- Lens/format language ("anamorphic", "35mm", "shallow depth of field") as *style*.
- Film stock, mood adjectives, lighting *look* ("moody", "cinematic", "golden hour").
- Any cast name, wardrobe detail, or location name that lives in a record.

All of the above are **records with ids**, composed in at generate time. The test
before you type a word: *does this already live in a record?* → reference it, don't
restate it.

## The STORYBOARD framing note

Do not type "STORYBOARD" into the action prompt. Pass it as the batch's
`styleLockFragment`, which `backend/batches.mjs` composes onto every candidate:

```
composedPrompt = prompt + ' ' + styleLockFragment
```

Example batch request field:

```
styleLockFragment: "STORYBOARD — rough black-and-white storyboard frame, blocking only, not final look"
```

Result: every candidate's stored prompt ends with the STORYBOARD note, so the frames
are self-evidently previews on their cards and in the record. In a storyboard batch
there is no locked style, so this suffix slot is free — and it is the only suffix the
`POST /api/batches` route forwards, so it is where the framing note has to ride.

## Example (good)

- Action prompt: `Wide establishing shot, a lone figure crosses an empty plaza toward a lit doorway, deep foreground shadow`
- `styleLockFragment`: `STORYBOARD — rough black-and-white storyboard frame, blocking only, not final look`
- Stored/composed prompt on the record:
  `Wide establishing shot, a lone figure crosses an empty plaza toward a lit doorway, deep foreground shadow STORYBOARD — rough black-and-white storyboard frame, blocking only, not final look`

## Example (bad — do not do this)

- `Cinematic teal-and-orange anamorphic wide of DETECTIVE MARA in her red coat crossing the neon-soaked plaza, moody sodium-vapour grade, shot on 35mm`

Every underlined-in-spirit word there (grade, lens, stock, cast name, wardrobe,
palette) belongs in a record and must be referenced by id, not typed.

## Re-render stage

Stage 7 uses the same `styleLockFragment` suffix seam, but now it carries the
**locked style's `.fragment`** (from `GET /api/stylelocks`, the record whose id equals
the Index `locks: style=<id>`). The action prompt still stays action + framing only;
the look rides in by reference and composes onto every render candidate at generate
time.
