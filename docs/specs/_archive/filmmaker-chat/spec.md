# Spec: Filmmaker Chat — an agent-driven production chat with visual context locks

**Status:** ready-for-agent
**Feature slug:** `filmmaker-chat`
**Created:** 2026-07-19

## Problem Statement

FrameForge's tools (prompt builder, style locks, sheet composer, grid splitter,
shot board, generate console) are powerful but live on separate pages. Directing a
film with them means constantly jumping between surfaces and re-entering context.

For the hackathon, the user cannot bring the pre-built tools directly — but wants a
single chat surface (a "Claude Chat for filmmakers") that can operate the whole app,
where the pre-existing tools plug in as *enableable* modules (shipped disabled for the
competition, architected as if enabled).

Today's pain, concretely:

1. **Token waste.** When the agent writes 100 image prompts, it re-describes the style,
   character, and location in every one. Style locks, cast refs, and location refs
   already exist in FrameForge precisely so prompts can stay *action-only* — but no
   chat surface exploits that.
2. **No conversational surface at all.** The agent runner is one-shot headless
   (`claude -p`), used only for Arcads generation, rerolls, and skill enhancement.
   There is no session, no streaming, no history, no visible reasoning.
3. **Global skill pollution.** Starting a normal Claude Code session loads the user's
   entire personal skill library. A FrameForge chat must load *only* FrameForge's own
   router skill and the in-app skills, nothing else.
4. **Context is invisible.** The locked style, cast, locations, and look sheets should
   be *seen* at a glance beside the chat — rendered by the UI from stored data, never
   re-written by the LLM.
5. **Component sprawl.** The "render an image/video" tile and lightbox is hand-rolled
   at least three times (generate console, shot workspace, home favorites), and the
   model/format pickers at least four times. Every new surface makes it worse. The chat
   must be built on ONE shared media component and ONE shared settings component.
6. **Hard-coded model settings.** Video/image model options (resolution, duration,
   aspect) are hand-branched per model in the provider layer. Manual mode needs
   settings driven by each model's actual spec (FAL publishes per-model OpenAPI
   schemas), not by hand-written per-model code.

## Solution

A new top-level **Chat** surface (per-project and standalone), driven by the user's
existing agent CLI subscription (Claude Code by default; any `agentCommand` CLI such
as Codex works in degraded one-shot mode). It is a document-like workspace, not a bare
message list:

- **Left/main: the conversation** — streamed agent output, markdown, inline
  tool-call cards (generation cards, shot-list cards, grid-split cards, style cards),
  session list with resumable history and per-turn checkpoints.
- **Right: the Production Panel** — always-visible visual context: project
  understanding (brief + memory), the locked style, cast (with turnaround/ref
  images), locations, look sheets. All rendered from stored data. One click pins or
  swaps a lock; the agent is *told about* locks by reference id, never asked to
  restate them.
- **Mode switch: Agent (auto, default) ⇄ Manual.** In Manual, the composer becomes a
  structured generation form — pick output kind (image / video / music / voice /
  sound design), pick a model, and get a settings form generated from that model's
  synced spec (resolution enums, duration ranges, etc.).
- **Router skill.** A FrameForge-authored skill, loaded (default-on, editable in the
  Skills page) into *every* chat session via an isolated agent home so the user's
  global skills never load. It teaches the agent to operate FrameForge through its
  local HTTP API and routes to in-app skills and enabled chat tools only.
- **Chat tools registry.** Every existing tool is a pluggable chat module with an
  enable/disable toggle (all OFF by default for hackathon compliance). Enabled tools
  are announced to the agent through the router skill's injected manifest and get an
  inline card UI in the conversation.
- **The blessed cheap-preview workflow**, encoded in the router skill: story →
  shot breakdown → 3×3 storyboard grid on a cheap preview model (explicitly framed
  as "storyboard, not final look") → split into per-shot frames → review → lock a
  look/style → re-render selects with the locked style composed in at generate time.

Token economy is the organizing principle throughout: styles, cast, and locations are
referenced by id and composed into provider payloads at generate time (the existing
shot-model pattern); the agent writes only action + framing.

## User Stories

1. As a filmmaker, I want a chat interface dedicated to film production, so that I can direct a whole project conversationally without jumping between tool pages.
2. As a filmmaker, I want the chat to run on my existing Claude Code (or Codex) subscription via the local CLI, so that the hackathon build costs me no extra API spend.
3. As a filmmaker, I want every chat session to load only FrameForge's router skill and in-app skills, so that my personal global skill library never leaks into or bloats the session.
4. As a filmmaker, I want to see the agent's replies stream live with visible progress on long generations, so that I trust something is happening.
5. As a filmmaker, I want named sessions per project with full history, so that I can resume yesterday's conversation where I left off.
6. As a filmmaker, I want per-turn checkpoints in a session, so that I can branch or roll back when a direction goes wrong.
7. As a filmmaker, I want a Production Panel beside the chat showing my locked style, cast, locations, and look sheets as images, so that I see my creative context at a glance without the LLM re-describing it.
8. As a filmmaker, I want to lock a style from the prompt-builder axis system directly in the chat sidebar, so that the lock carries camera, look, feel, and mood without retyping.
9. As a filmmaker, I want locked context sent to the agent as compact ids/summaries only, so that a 100-shot batch does not re-spend tokens restating the style 100 times.
10. As a filmmaker, I want the agent's image prompts to be action-and-framing only, with style/cast/location composed in at generate time, so that prompts stay cheap and consistent.
11. As a filmmaker, I want to attach images and documents (script, treatment, references) to a chat message, so that the agent can break down my actual material.
12. As a filmmaker, I want the agent to ask about my story and produce a shot list I can see as a board inside the chat, so that shot development never leaves the conversation.
13. As a filmmaker, I want the agent to offer a very cheap storyboard preview (3×3 grid on a preview model with placeholder characters) before any expensive render, so that I validate direction before spending.
14. As a filmmaker, I want the storyboard framing to be explicit ("this is a storyboard, not the final look"), so that rough previews don't read as failed renders.
15. As a filmmaker, I want to split a generated 3×3 grid into individual frames without leaving the chat, so that the contact-sheet → frames loop is one click.
16. As a filmmaker, I want split frames attached to their shots as candidates, so that the storyboard populates the shot board automatically.
17. As a filmmaker, I want generation results to appear as inline cards in the conversation with status (queued/running/done/failed) and cost, so that I follow a batch without opening another page.
18. As a filmmaker, I want to mark generations kept/rejected from the chat card and have that flow into the review inbox, so that chat and review share one triage state.
19. As a filmmaker, I want to develop a look sheet with the agent and then lock it as the project style, so that look development and style locking are one flow.
20. As a filmmaker, I want the chat to open with the project understanding visible (brief + memory + learnings), so that I can verify what the agent knows before directing it.
21. As a filmmaker, I want learnings from a session automatically distilled into project memory when the session ends, so that the next session starts smart without me re-explaining.
22. As a filmmaker, I want an Agent/Manual mode switch, so that I can drop to precise manual control (model, settings, references) whenever I don't want the agent to decide.
23. As a filmmaker, I want Manual mode to offer output kinds — image, video, music, voice, sound design — from a list, so that all generation types share one surface.
24. As a filmmaker, I want Manual mode's settings form (resolution, duration, aspect, etc.) generated from the selected model's actual synced spec, so that new FAL models get correct settings UI with zero hand-written code.
25. As a filmmaker, I want models whose spec hasn't synced to fall back to the generic format controls, so that manual mode never dead-ends.
26. As a filmmaker, I want each pre-existing tool exposed to the chat as a toggleable module, defaulting OFF, so that I stay hackathon-compliant while the architecture is ready to switch ON.
27. As a filmmaker, I want the router skill visible (read-only) in the Skills page, and a separate editable house-rules skill for my own standing preferences, so that I can tune the agent without ever breaking the system contract.
28. As a filmmaker, I want the agent to only see tools that are currently enabled, so that a disabled tool is truly invisible, not just refused.
29. As a filmmaker, I want image/video rendering to be ONE shared component across chat, generate console, shot workspace, and home, so that a fix or improvement lands everywhere at once.
30. As a filmmaker, I want model pickers and format controls to be ONE shared component, so that provider/price/aspect logic exists exactly once.
31. As a filmmaker, I want per-session and per-generation cost visible in the chat, so that I always know what a direction costs.
32. As a filmmaker, I want the chat to work when no agent CLI is installed (simulate/setup mode), so that first-run and demo environments degrade gracefully.
33. As a filmmaker, I want a standalone chat entry in the top-level nav plus a per-project chat tab, so that I can start from a conversation or from a project.
34. As a hackathon entrant, I want the whole feature behind an integration-switchboard module, so that it can be toggled like every other FrameForge integration.

## Implementation Decisions

### Seams (highest-possible, mostly existing)

- **Primary seam: the local HTTP API.** The agent operates FrameForge exclusively
  through the existing Express API on 127.0.0.1 — the same seam the React app uses.
  No new IPC, no MCP server, no direct file access by the agent. The router skill is
  documentation of this seam. New capabilities needed by chat (grid split, schema
  fetch, session turns) become new API routes, testable the same way existing routes
  are.
- **Secondary seam: the agent CLI boundary** — already exists in the jobs runner
  (`agentCommand`, arg builder, spawn). Extended from one-shot to streaming/resumable,
  behind the same abstraction so Claude Code, Codex, and simulate mode are swappable.
- **No third seam.** Chat persistence reuses the markdown-record convention of the
  store; chat UI reuses the SSE pattern of the activity feed.

### Backend

- New **chat module** registered like other route modules. Sessions are markdown
  records: one session file (frontmatter: id, project, title, mode, agent, created,
  updated, checkpoints) plus an append-only messages file per session, under the
  project directory (or a workspace-level dir for standalone sessions). Follows
  the generation-record pattern (schema field, frontmatter + body).
- **Turn execution:** each user turn spawns the agent CLI with streaming JSON output
  and resume-by-session-id where the CLI supports it (Claude Code); CLIs without
  resume (Codex et al.) degrade to one-shot with a transcript-tail prompt prefix.
  Output is parsed into typed events (text delta, tool call, tool result, done,
  error) and re-broadcast on a per-session SSE endpoint, mirroring the activity SSE.
- **Isolated agent home:** sessions run with a dedicated agent config/home directory
  managed by FrameForge (inside the workspace), containing only the router skill and
  links to in-app skills — the mechanism that guarantees global skills never load.
  The router skill is a **system skill**: its canonical source ships in the
  backend source tree (`backend/skills/frameforge-router/` — already authored;
  wire it, don't rewrite it), is copied fresh into the isolated agent home on
  every session start so tampering never persists, and is shown read-only in the
  Skills page. User customization lives in a separate optional editable
  `house-rules` skill, which the router skill loads and which may extend but not
  override the system contract.
- **Tool manifest injection:** at session start the backend renders the router
  skill's dynamic section — enabled chat tools, project id, locked context ids, API
  base URL — so the agent's world matches the switchboard state exactly. Disabled
  tools are omitted entirely (invisible, not refused).
- **Structured chat protocol:** agent → UI rich content rides on fenced directive
  blocks (a single convention, e.g. a `frameforge` JSON fence) emitted by the agent
  per the router skill: generation refs, shot-list refs, grid-split proposals, style
  proposals. The UI renders cards from refs by fetching canonical records — the LLM
  never restates stored data.
- **Grid split server-side:** the client-only splitter's detection/scoring core moves
  to a shared module; a new API route splits a generation's grid image into child
  generation records (parentGeneration set), optionally attaching each cell to a shot
  as a candidate. The existing splitter tool page adopts the shared core.
- **Model spec sync:** the catalog module (which already mirrors the FAL model list)
  additionally fetches per-model OpenAPI schemas from FAL, cached as records under the
  catalog dir with a staleness stamp. A route serves a *normalized* schema (enum
  fields, ranges, defaults, required refs) rather than raw OpenAPI. Non-FAL providers
  get hand-authored minimal schemas in the model catalog or fall back to generic
  format controls.
- **New model kinds** for manual mode: extend the catalog's kind vocabulary with
  `music`, `voice`, `sfx` alongside preview/render/edit/video, with at least one FAL
  model each; kind list drives the manual-mode output-kind selector.
- **Memory/learnings hook:** session start injects the project brief + memory
  (existing hot-cache pattern); session end (explicit or idle-close) runs a cheap
  distillation pass that appends durable learnings to project memory via the
  existing memory append route.
- **Switchboard:** a new `chat` integration module (group: agent; needs: agent
  binary), default ON only when the agent module is on; individual chat *tools*
  default OFF.

### Frontend

- **Prefactor first — shared media primitives:** one `RenderMedia` (image/video
  branch, hover-play, object-fit) + `RenderTile` + `RenderLightbox`, generalized
  from the moodboard's mosaic/lightbox, adopted by the generate console, shot
  workspace, and home favorites *before* chat uses them. This is the user's explicit
  "one component, not five" requirement.
- **Prefactor — shared generation controls:** one `ModelPicker` (provider/price
  aware, catalog-driven) and one `FormatControls` (aspect chips, resolution tiers,
  px readout, seed, variants, duration), consolidated from the four existing
  reimplementations; then a `SchemaForm` renderer that materializes a settings form
  from a normalized model schema and falls back to `FormatControls`.
- **Chat surface:** new page component with session sidebar, streamed message list
  (markdown + directive-card slots), composer with attachments and mode switch, and
  the Production Panel. Mounted as a top-level nav entry and as a project tab.
- **Production Panel** reads only canonical data: style locks, extracted looks,
  context boards (Cast/Locations/Wardrobe/Props), per-shot cast/loc/look locks, and
  project memory/brief. Panel actions (lock style, assign cast, open shot) call
  existing routes; a lock change notifies the active session as a compact system
  event (ids only).
- **Chat tool cards** live in a registry keyed by tool id: card component + directive
  type + enablement flag. Adding a tool to chat = one registry entry.

### Testing Decisions

- Test at the HTTP seam with plain `node --test` scripts in the existing
  `phase*.test.mjs` style, against a temp `FRFG_DATA` root (the established
  convention; anything bypassing the storage-root resolver breaks them).
- Good tests exercise external behavior: create session → post turn (simulate agent)
  → assert persisted messages, SSE event sequence, and directive parsing; grid-split
  route → assert child generation records and shot attachment; schema route →
  assert normalized shape and fallback for unsynced models; manifest injection →
  assert disabled tools absent from the rendered skill.
- The agent CLI is faked at the runner boundary (simulate mode / a stub command
  echoing scripted stream-JSON), so tests never require a real subscription.
- No new test framework; no snapshot testing of React (no harness exists — UI is
  verified by driving the dev server).

## Out of Scope

- Building an MCP server for FrameForge (the HTTP API + router skill is the seam).
- Multi-user/collaboration, auth, or any remote deployment of the chat.
- Editing timeline/NLE features, Remotion orchestration from chat (existing pages
  remain the surface; a chat tool entry may come later).
- Replacing the existing Generate console or Review inbox — chat composes them.
- Hand-writing per-model settings code for every FAL model (the schema sync exists
  precisely to avoid this); exhaustive schema coverage of Kie/Higgsfield/Arcads.
- Voice input inside chat (the existing VoiceInput component can be added later).
- Live token-usage metering of the subscription CLI (cost strip covers generation
  spend; CLI turn costs are subscription-flat).

## Further Notes

- The `agent` provider type ("driven through the Claude CLI") and the
  `agentCommand` setting already exist — the chat feature is an extension of an
  established pattern, not a new architecture.
- Hackathon compliance: every pre-existing tool is wired but ships toggled OFF;
  the demo runs with the router skill + core chat + storyboard workflow only.
  Flipping the toggles is the post-competition unlock, no code change.
- All 40 mattpocock workflow skills are installed at `.agents/skills/` (symlinked
  for Claude Code). Work the tickets with `/implement`, one per fresh session,
  frontier order.
