# FrameForge filmmaker-chat — hackathon demo script

The blessed **storyboard-first** run, end to end, in one continuous chat session:
story → shot breakdown → cheap 3×3 storyboard previews → split onto shots → review →
look development + style lock → re-render the kept shots on a render model. Every step
is a card the human confirms.

This is the exact human runbook. It requires a **live Claude subscription** (the chat
agent) and **real FAL spend** (the storyboard + render frames), so it is not run in CI —
each backend seam it rides is covered hermetically by `node --test tests/phase*.test.mjs`.

---

## 0. Prerequisites (one-time)

- **FAL connected.** Settings → Providers → FAL key present (or `FAL_KEY` in `.env`).
- **Signed into Claude** in the same environment the app spawns the agent from.
- Two shells running the app (see `CLAUDE.md`):
  - `npm run dev`    → Vite on **5175** (proxies `/api` → `127.0.0.1:5176`)
  - `npm run server` → Express API on **5176**
- Open `http://127.0.0.1:5175`.

## 1. Toggles to flip ON before the demo

Chat **tools default OFF** (hackathon compliance). The storyboard **pack** defaults ON
(it only orchestrates confirm-gated steps), so you do **not** toggle the pack — but you
**do** enable the tools whose cards the pack drives.

Settings → Chat tools — turn ON exactly these three:

| Toggle | Why the demo needs it | Card it lights up |
|---|---|---|
| **Shot board** | staged breakdown + inline shot board | `proposal.breakdown`, `show.shot-board` |
| **Grid splitter** | split each 3×3 sheet onto shots | `proposal.split` |
| **Style locks** | lock the project style | `show.style` / `style.lock` |

Leave the rest OFF. Confirm Settings → Chat skills shows **storyboard-workflow** present
and **enabled** with a "built-in" badge (it is not deletable; it is shipped with the app).

Nothing else needs enabling: the **money gate** (`confirm.batch`) and the **generation
cards** are core capabilities, always present.

## 2. Create a project and open the chat

1. New project (e.g. "Plaza"). Open it.
2. Open the chat panel. The agent boots in **APP MODE** (it sees the injected Index).
   The right-hand Production Panel shows the empty creative context.

## 3. The run — what to type, what to expect

Type in the chat. Bracketed lines are what you should SEE, not type.

**Step A — story + breakdown**
- You type: *"Here's the story: a lone courier crosses an empty night plaza to deliver a
  package to a lit doorway; a stranger watches from the shadows. Storyboard it."*
- Expect: a short reply, then a **breakdown card** (`proposal.breakdown`) listing shots
  (no, title, type, duration, one-line action). Nothing is written yet.
- You: edit if you like, then **Confirm**. The shot board fills in (shots now exist).

**Step B — offer the cheap preview**
- The agent offers the storyboard preview, framed as *"blocking and coverage, not the
  final look."* You say **yes**.

**Step C — storyboard sheets (money gate)**
- Expect a **confirm.batch estimate card**: *"9 storyboard frames on the preview model
  ≈ $0.03 — proceed?"* (preview model is `settings.modelDefaults.preview`, default
  FLUX Schnell ≈ $0.003/frame → ~$0.03 for a 3×3 sheet; a second sheet doubles it).
- You: **Proceed.** The card swaps in place to a live batch grid card as frames render.
- Spot-check (optional, for judges): each frame's stored prompt ends with **STORYBOARD …**
  and carries action + framing only — no grade/lens/palette prose. That is the token
  economy law, visible in the generation record.

**Step D — split onto shots**
- When a sheet is done, the agent proposes a **split** (`proposal.split`) mapping each
  cell to a shot. You **Confirm**; cells attach to shots as storyboard candidates.

**Step E — review**
- Keep/reject a few candidates on the cards (or "Review these" → the inbox scoped to the
  batch). The agent reads the outcome by id — you don't restate which you kept.

**Step F — look development + style lock**
- You: *"Now the look — something sodium-lit and noirish."* The agent helps land a look
  and surfaces a **style card** (`show.style`). You **lock it** as the project style.
- The Production Panel's Locked Style section updates; the next agent turn's Index shows
  `locks: style=<id>`.

**Step G — re-render the kept shots (money gate)**
- You: *"Re-render the ones I kept, with the locked look."*
- Expect a **confirm.batch** for the render-tier model (larger number, e.g. *"4 shots on
  the render model ≈ $0.16 — proceed?"*). The locked style is composed in **by id** — the
  action prompts stay action-only. You **Proceed.**
- Optional finale: change the style lock and ask to re-render **one** shot — the new look
  flows into the new frame with no prompt rewrite, proving the style is live and by-reference.

## 4. Expected spend (rough)

| Step | Model | Frames | ≈ Cost |
|---|---|---|---|
| Storyboard sheets (C) | preview (FLUX Schnell) | 9–18 | $0.03–$0.06 |
| Re-render kept shots (G) | render tier (~$0.04/frame) | ~4 | ~$0.16 |
| One-shot look swap (G) | render tier | 1 | ~$0.04 |

Total for a full demo: **well under $0.30.** That is the whole pitch — you saw the entire
film before paying render price, and paid render price only for the shots that survived.

## 5. If something is off

- A step's card doesn't appear → its **tool** is OFF. Settings → Chat tools, enable the
  one from the table in §1. (The agent will also say, in one line, which toggle to flip.)
- The agent talks about "storyboard" but never fires a batch → it is correctly waiting for
  your **Proceed** on the money-gate card. Nothing spends without it.
- The pack isn't listed → confirm you're on `feat/filmmaker-chat` and the app booted from
  this tree; the built-in pack ships in `backend/skills/storyboard-workflow/`.

## 6. Live-only vs. hermetically verified

- **Hermetically verified** (`node --test tests/phase*.test.mjs`, all green): the built-in
  pack discovery/default-ON/toggle/Index/tamper-reset (`phase-storyboard-workflow`), the
  STORYBOARD framing composing into batch records (same file), breakdown/shots
  (`phase-shot-board`), split (`phase-grid-split-chat`, `phase6-gridsplit`), review
  enumeration (`phase-review-integration`), style locks (`phase10-styles`), batch estimate
  + session attribution (`phase7-batches`, `phase22-cost-surfacing`).
- **Live-only** (this script): the single continuous agent-driven session tying all of the
  above together, the visual cards, and actual FAL frames. Needs the Claude subscription +
  FAL spend above; do not run it in CI.
