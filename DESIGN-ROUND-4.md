# Design round 4 — paste this to the design agent

Round 3 landed the shell, the collection table and the document surface. Five things are missing or wrong. Everything else stands.

---

## 1. Properties collapse when a document opens — required

Right now a record opens with nine property rows before a single human sentence. Invert it:

```
Maria Santos                                [Editor|Raw]  SAVED  [Shortlist A]

▸ PROPERTIES 8 · needs review · 9 · found 2d ago           ← COLLAPSED
──────────────────────────────────────────────────────────
SUMMARY                                    ▸ READ THE FULL NOTE
A nurse who started cooking on camera during the pandemic…
WRITTEN BY VETTER / 06:12 / FROM 40 POSTS
```

The collapsed row carries the three that matter — gate status, primary number, freshness — so nothing important hides. Expands on click or `P`. The preference is remembered **per collection**, not per document.

## 2. Three screens that do not exist yet

**GOALS** — a card per goal: the number, progress, days left, which assistants are on it. Behind-schedule goals surface on TODAY. Show one on track and one behind.

**MEMORY** — `me` (who I am, how I work) · playbook claims with evidence counts and age · learnings. All editable in place by a non-technical person: no modals, no jargon labels. The copy must make the causal link obvious — editing here changes what the assistants do tomorrow.

**WHAT THEY KNOW** — the highest-trust screen in the app. Render the agent's wake-up context read-only: who it thinks she is, her goals, her best and stalest ground, what it learned, what changed since its last run, its open questions. Show a **live token count against a 2,000 budget**, a Regenerate button, and a link from each block to the file it came from. Design it so seeing it makes her *want* to correct it.

## 3. FILES — the way down

A plain browser over the workspace folder: tree, markdown preview, **Reveal in Finder**. Pinned at the bottom of the rail. Every record's path (`data/guests/maria-santos.md`) is clickable and lands here.

We compress aggressively everywhere else. Compression without a way down is concealment — the two ship together.

## 4. Light mode

A second token set, not a redesign. Acid green fails contrast on white, so light mode's accent is a **deep olive `#3D4A00` with `#F4FFC0` text on it** — same role, re-tinted for the surface. Surfaces `#FBFBFA / #FFFFFF / #F6F6F4 / #EFEFEC`, text `#1A1B1E / #3C3F45 / #6B7078 / #8B9099`, lines `#E8E8E4 / #DEDEDA / #C4C4BE`. Status: `#127C4F` `#9A6800` `#B3322C`. Marked: `#2E5FCC`.

Show TODAY and the document surface in light. Density and every rule stay identical — no component branches on theme.

## 5. Whiteboard

Documents and their relationships on a canvas. Node kinds: document · collection-view · territory · goal · note · frame. **Edges derive from real relations** — placing two related documents draws the edge and labels it with the field name (`found_in`, `evidence`). Nodes are HTML, so a document card shows live content, not a screenshot. Show a guest, its territory and the project brief with two labelled edges.

---

## And one card type DECIDE is missing

A **schema proposal**, because the agent builds the person's database with them:

> **NEW FIELD** · `#guest` → `on_camera` · yes/no
> *14 of your last 20 shortlists post video. Worth filtering on.*
> `[ Add it  A ]` `[ No  R ]`

Same card, same two keys, same altitudes. It must carry evidence, never an opinion.

---

Same tokens, same density, one solid accent fill per screen, mono for every figure. Real content from the guest-research scenario. One self-contained HTML file per screen at 1440×900. Make the calls and note them in one line at the end.
