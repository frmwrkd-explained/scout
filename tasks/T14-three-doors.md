# T14 · Doors 1 and 3, and the Index
**Milestone:** M4 · **Reads:** `docs/04_AGENT_CONTRACT.md` §1–2, §8

## Do
1. Port FrameForge's `agentHome.mjs` / `agentRunner.mjs` / `agentProviders.mjs` for the local-CLI path. **Keep it optional** — it is one door of three, and the app must work fully without it.
2. `renderIndex()` — API base, collections and their fields, enabled tools, current project, pointer to the route reference. **A new capability is a new Index line, never a router-skill edit.**
3. **The router skill already exists at `skills/scout-router/` — do not write a new one.** It ships both modes (`references/api-mode.md`, `references/folder-mode.md`) and the legal field-type list agents must propose against. Your job here is to make the app *mount* it: copy the folder fresh into each agent session home on every prepare, so a tamper of the mounted copy never persists.
   - Folder mode already works with no app at all, via `skills/scout-router/scripts/refresh.mjs` — the zero-dependency cache renderer. When `renderCache()` (T10) lands, **the two must produce the same shape**; add a test that diffs them against the same fixture workspace, and treat `refresh.mjs` as the documented fallback rather than a duplicate.
4. MCP server exposing the same tools.
5. Agent provider table as data — Claude Code, Devin CLI, goose, generic one-shot. Adding one is a table entry. **Never architect on a free tier**; it is a setting.

## Demonstrate
The same job completes through all three doors and produces identical records.
