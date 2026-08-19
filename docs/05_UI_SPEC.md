# 05 · UI SPEC — shell, screens, views, light/dark

The round-3 design (Claude Design project `f84bb492`) is the visual starting point and it is good. This document says what is **still missing**, and fixes the layout contract so the app can grow without a redesign.

---

## 1. The shell

```
┌──────────────┬────────────────────────────────────────┬──────────────────┐
│ PROJECT ▾    │  TBL #guest·Needs review │ DOC Maria    │  INSPECTOR       │
│              │────────────────────────────────────────│  (collapsible)   │
│ Today        │                                        │                  │
│ Needs you  6 │        table · board · list · gallery   │  PROPERTIES   6  │
│ Project    8 │              or the document            │  REFERENCED BY 3 │
│              │                                        │  LINKS        2  │
│ COLLECTIONS  │                                        │  HISTORY      3  │
│ #guest   147 │                                        │  GRAPH           │
│ #group    12 │                                        │                  │
│ + new        │                                        │                  │
│              │                                        │                  │
│ MEMORY       │                                        │                  │
│ Goals      2 │                                        │                  │
│ Territory 12 │                                        │                  │
│ Playbook   6 │                                        │                  │
│ What they    │                                        │                  │
│  know        │                                        │                  │
│              │                                        │                  │
│ ASSISTANTS   │                                        │                  │
│ ● scout-fb   │                                        │                  │
│ ● vetter     │                                        │                  │
│ ○ writer     │                                        │                  │
│              │                                        │                  │
│ Files  ⌥     │                                        │                  │
├──────────────┴────────────────────────────────────────┴──────────────────┤
│ ● scout-fb — sweeping Nurses PH · 12 min · 8 found        [ ACTIVITY ▴ ]  │
└──────────────────────────────────────────────────────────────────────────┘
```

Additions to what exists: a **MEMORY** group in the rail (Goals, Territory, Playbook, **What they know**), and **Files** pinned at the bottom.

## 2. Fixes to the current design

### 2.1 Properties collapse when a document opens — required

Opening a record today shows nine property rows before a single human sentence. Invert it:

```
Maria Santos                                [Editor|Raw]  SAVED  [Shortlist A]

▸ PROPERTIES 8 · status: needs review · score 9 · found 2d ago     ← collapsed
──────────────────────────────────────────────────────────────────
SUMMARY                                        ▸ READ THE FULL NOTE
A nurse who started cooking on camera during the pandemic…
WRITTEN BY VETTER / 06:12 / FROM 40 POSTS
```

- Collapsed by default. The collapsed row carries the **three fields that matter** — the gate status, the primary number, and freshness — so nothing important is hidden.
- Expands on click, `P`, or when a card is opened for editing rather than reading.
- Remembers per collection, not per document. It is a working preference, not a per-record state.
- **The summary sits highest.** The full note is one click. This is Law 2 applied to the most-used screen in the app.

### 2.2 What is missing entirely

| Screen | Why it's needed |
|---|---|
| **GOALS** | `03_MEMORY.md` §7. A card per goal — the number, progress, days left, which assistants are on it. Behind-schedule goals surface on TODAY. |
| **MEMORY** | `me` · playbook · learnings on one editable surface, each showing its age. |
| **WHAT THEY KNOW** | The hot cache, rendered read-only, with its token count and a Regenerate button. The single best trust-builder in the app — she can see exactly what her assistant knows about her, and fix it. |
| **FILES** | A plain file browser over the workspace. Folder tree, markdown preview, **Reveal in Finder**. Law 8 — we compress hard, so the way down must exist. |
| **WHITEBOARD** | Relationships and documents on a canvas. See §5. |

## 3. View types

`table` · `board` · `list` · `gallery`, per `02_DATA_MODEL.md` §3. One component per type, chosen by the view's `type` field. The default is inferred from the collection's shape — **never ask a new person to pick a view before they have seen their data.**

Board cards may carry a **relation-derived activity line** (`last touch 3d ago`, `2 messages`) — that is the "kanban with more information" case for prospect-style work.

## 4. Light and dark — two token sets, one contract

Every colour in the app is already a custom property. Light mode is a **second `:root` block under `[data-theme="light"]`**, nothing else changes. No component may branch on theme.

| Token | Dark | Light |
|---|---|---|
| `--ink` | `#0D0E11` | `#FBFBFA` |
| `--surface` | `#101115` | `#FFFFFF` |
| `--surface-2` | `#14161B` | `#F6F6F4` |
| `--raise` | `#1C1F26` | `#EFEFEC` |
| `--sunk` | `#0A0B0E` | `#F2F2EF` |
| `--line` | `#1B1E24` | `#E8E8E4` |
| `--border` | `#22252C` | `#DEDEDA` |
| `--border-3` | `#3A3F49` | `#C4C4BE` |
| `--fg` | `#ECEEF2` | `#1A1B1E` |
| `--fg-soft` | `#C9CFD8` | `#3C3F45` |
| `--fg-muted` | `#9AA3AF` | `#6B7078` |
| `--fg-faint` | `#7B8797` | `#8B9099` |
| `--accent` | `#E3FF32` | `#3D4A00` |
| `--on-accent` | `#141519` | `#F4FFC0` |
| `--ok` / `--warn` / `--danger` | `#3FCF8E` / `#F0B23A` / `#F05B54` | `#127C4F` / `#9A6800` / `#B3322C` |
| `--marked` | `#5B9DFF` | `#2E5FCC` |

Acid green at full brightness on white fails contrast, so light mode uses a **deep olive** as the accent with a pale accent text colour on top. It is the same role, re-tinted for the surface — not a second brand. Every pair must clear **4.5:1**; a test asserts it.

Theme is a setting, `⌥⌘L` toggles it, and it follows the OS by default.

## 5. Whiteboard

Port FrameForge's `Board.jsx` / `BoardNodes.jsx` / `BoardInspector.jsx` / `boardLayout.js` **as-is in structure**. It is native — HTML nodes on one CSS transform, no canvas library — which is why a document can render inside a card. (Every mature canvas library paints to `<canvas>`, where a live document becomes a screenshot; tldraw is also separately licensed.)

What changes for Scout: node kinds become `document` · `collection-view` · `territory` · `goal` · `note` · `image` · `frame`. Edges are **derived from real relations** — placing two related documents on the board draws the edge automatically and labels it with the field name. Auto-align stays an **action**, never a render-time derivation.

Its value here is exactly what you said: *understanding the relationships, and putting documents in there.* Do not build a second graph feature — the inspector's GRAPH section is a preview that opens **into** the whiteboard.

## 6. Rules that keep this coherent

- **Altitude 1 everywhere.** Any screen that opens deeper is a bug (Law 2).
- **One solid accent fill per screen** — the primary action.
- **Selected is a neutral raised chip**, never an accent fill. `--marked` means "in flight", never "click this".
- **Density stays** everywhere except the DECIDE card, which holds one decision and gets room.
- **Every figure is mono**, tabular numerals wherever digits stack.
- **Freshness is a form**, not only a colour — one mechanism, used identically everywhere.
- **Empty states speak in short mono uppercase**: `NO QUESTIONS — YOUR ASSISTANTS ARE CLEAR`.
- **Every record shows its path** (`data/guests/maria-santos.md`) and it is clickable.
