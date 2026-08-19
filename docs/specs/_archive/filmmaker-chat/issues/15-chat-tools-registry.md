# 15 — Chat tools registry with enable/disable switchboard

**What to build:** The plug-in layer that connects existing FrameForge tools to the
chat, each individually toggleable and ALL OFF by default (hackathon compliance).
A registry keyed by tool id declares: display name, the one-line capability
description that becomes its Index line, the directive types it registers, its
inline card/panel component, and its enablement flag. The registry is the single
source both the Index generator (ticket 10) and the card renderer read — adding
the 200th tool is one registry entry, never a router-skill or Index-format edit.
Settings gains a "Chat tools" section of toggles (style-lab/style locks, sheet
composer, grid splitter, shot board, look extractor, control maps — registry
entries may ship before their cards exist). Enablement feeds the session Index
(ticket 10): disabled tools are invisible to the agent and their directives
render as an "enable this tool" notice instead of a card. Skill packs get the
same treatment via their toggles from ticket 10. A new `chat` module joins the
integration switchboard (requires the agent module) gating the whole surface.

**Blocked by:** 12 — Directive protocol. (Index side already prepared in 10.)

**Status:** done

- [x] A chat integration module exists in the switchboard; turning it off hides chat nav/tabs and gates chat routes like other modules
- [x] Per-tool toggles persist in settings, default OFF, and are reflected in the next session's Index
- [x] A directive from a disabled tool renders the enable-notice, not the card; enabling and retrying renders the card *(unverified in a live browser — verified by build + the render path; toolRegistry guarded renderer reads live `settings.enabledChatTools`)*
- [x] Adding a new chat tool is one registry entry plus its card — demonstrated by registering the style-lock card from ticket 12 through the registry

---

**Implementation (2026-07-19):**

- **Single registry, one declaration:** `shared/chatTools.mjs` (`CHAT_TOOLS`) is the one keyed
  source, imported by both sides. Backend `backend/agentHome.mjs` `seedChatTools()` feeds it into the
  existing `registerChatTool` seam (→ the session Index). Frontend `frontend/chat/toolRegistry.jsx`
  pairs each id with its card + the enable/disable notice.
- **Seed entries (all default OFF):** style-locks, sheet-composer, grid-splitter, shot-board,
  look-extractor, control-maps. Only style-locks ships a card (via `registerToolCard('style-locks', …)`
  in `cards.jsx`); the rest are `card: null` → the enabled-but-no-card placeholder until their ticket.
- **Entry shape for tickets 16/17:** add/refine an entry in `shared/chatTools.mjs`
  `{ id, name, capability, invocation, directiveTypes:[], enabledByDefault:false }`, then call
  `registerToolCard(id, (directive, ctx) => <Card …/>)` in the card module. Nothing else to touch.
- **Switchboard:** `chat` module added to `shared/integrations.mjs` with `requires:'agent'`; `isEnabled`
  now honours `requires` (dependent module is force-off when its requirement is off, else follows it).
  Routes gated at `backend/index.mjs` `MODULE_ROUTES` (`/api/chat`); nav gated in `frontend/App.jsx`.
- **Settings:** new "Chat tools" section (`renderChatTools`) with per-tool toggles → `enabledChatTools`.
- **Tests:** `tests/phase-chat-tools.test.mjs` — registry defaults OFF, Index reflection on toggle,
  `requires` relationship, and `/api/chat` route gating. Full suite 132/132 green; `npm run build` green.
