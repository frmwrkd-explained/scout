# 25 — Tool builder: author your own chat tools by conversation

**What to build:** A way for the filmmaker to build their own tool by talking to
Claude, and then switch it on and off like any built-in. Three parts:

**(1) The skill.** `backend/skills/frameforge-toolsmith/` — a second SYSTEM skill
beside the router, mounted only into a session created with `kind: 'toolsmith'`.
Its spine is an interview with a stop rule ("four questions maximum, then draft"),
four FrameForge archetypes (ANSWERER / RECORDER / COMPOSER / CHECKER) so the model
can infer rather than interrogate, and a handoff that emits exactly one
`tool.draft` directive. Contract table and worked examples live in `references/`
and load only while drafting, per the router's own loading-ladder discipline.
Rides in the Index's `## Skill packs` section so the router's existing "one pack
matches → follow its SKILL.md verbatim" rule fires with no new router contract.

**(2) The artifact.** A user tool is ONE directory in the workspace —
`<root>/tools/<id>/SKILL.md` — whose frontmatter is a chat-tool declaration and
whose body is the instructions the agent follows. Named `SKILL.md` because the
directory then *is* a valid skill directory and mounts verbatim, with no
frontmatter synthesis step. `backend/userTools.mjs` discovers them from disk on
every `listChatTools()` call and concatenates them onto the static registry, so an
authored tool gets an Index line, a Settings toggle row and a mount through
machinery ticket 15 already built. Read-time discovery, never `registerChatTool()`
— `clearChatTools()` would silently drop a registered user tool.

**(3) The surface.** "+ New tool" as the FIRST cell of the Tools grid (the first
cell *is* the top of the library), opening `frontend/ToolsmithChat.jsx` — a
focused, project-free chat with a rail showing the tool taking shape. Authored
tools also get a "Your tools" section in the hub with an inline toggle.

**Blocked by:** 12 — Directive protocol; 15 — Chat tools registry.

**Status:** done

- [x] `backend/skills/frameforge-toolsmith/` ships SKILL.md + `references/anatomy.md` + `references/patterns.md`; no `scripts/`
- [x] A `kind:'toolsmith'` session mounts the skill and lists it in `## Skill packs`; an ordinary session does neither
- [x] `POST /api/tools` is the ONLY writer; it validates id / name / capability / instructions and rebuilds the frontmatter from validated scalars
- [x] Built-in ids are reserved; an authored file claiming one is ignored rather than allowed to shadow it
- [x] `directiveTypes` is forced to the single static `tool.card`, and `invocation` to the mount path — both server-side, whatever the draft proposed
- [x] An authored tool is absent from the Index and unmounted until enabled; enabling it adds one Index line and mounts `skills/tool-<id>/`
- [x] Deleting a tool removes the directory and prunes its `enabledChatTools` key without disturbing others
- [x] The Tools hub shows "+ New tool" first and a "Your tools" section; Settings → Chat tools lists authored tools with a "built by you" chip
- [x] `tests/phase-user-tools.test.mjs` — 18 tests, hermetic

## Deliberate exceptions, recorded

- **`frontend/Settings.jsx` was edited.** Ticket 15's rule is that adding a tool
  never touches Settings. That rule assumes a static `CHAT_TOOLS` entry; a
  runtime-discovered tool provably gets no row, and a tool you cannot switch on is
  not a shipped feature. The switchboard now reads the server list.
- **~80 lines of SSE handling are duplicated** from `Chat.jsx` into
  `ToolsmithChat.jsx`. Paid knowingly: `Chat.jsx` at `pid = null` is project-shaped
  in ways that are wrong here (Production Panel, checkpoints, attachments), and its
  four streaming invariants are small enough to restate correctly.

## Not built in this pass

- User-authored directive types or bespoke cards. One static `tool.card` with one
  generic renderer, display-only. Dynamic types are structurally ungateable given
  that `CHAT_TOOL_BY_DIRECTIVE` is a module-load snapshot — an unregistered type
  falls through to the UNGATED placeholder in `directives.jsx`.
- Bundled `scripts/` in an authored tool. Saving a tool writes exactly one
  `SKILL.md`; a tool that points at a script it invented is a dead end. It may
  point at `curl`, at `node`, or at a script an installed pack already ships.
- In-app editing. v1 is create + delete; editing is delete-and-re-interview.
- Export / import / sharing. A tool is already one zippable folder.
- An mtime cache on `listUserTools()`. `prepareAgentHome` now does a readdir plus
  N `readMd` per turn. Fine at 5–50 tools. **Measure before optimising** — a stale
  cache right after creation would break the payoff beat.
- Index-section capping. At ~50 enabled tools the `## Tools` section will dwarf the
  rest of the Index every turn. Defaults-off is the natural brake; revisit if it bites.
