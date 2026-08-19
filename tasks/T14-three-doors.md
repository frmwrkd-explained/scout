# T14 · Doors 1 and 3, and the Index
**Milestone:** M4 · **Reads:** `docs/04_AGENT_CONTRACT.md` §1–2, §8

## Do
1. Port FrameForge's `agentHome.mjs` / `agentRunner.mjs` / `agentProviders.mjs` for the local-CLI path. **Keep it optional** — it is one door of three, and the app must work fully without it.
2. `renderIndex()` — API base, collections and their fields, enabled tools, current project, pointer to the route reference. **A new capability is a new Index line, never a router-skill edit.**
3. The router skill in **two modes, same content**: *API mode* (curl the context, POST upserts, read the verdict) and *folder mode* (read `context.md`, grep `_known.md`, drop into `_inbox/`, never touch `data/`). **Write folder mode first** — it works in any agent host that can see a folder.
4. MCP server exposing the same tools.
5. Agent provider table as data — Claude Code, Devin CLI, goose, generic one-shot. Adding one is a table entry. **Never architect on a free tier**; it is a setting.

## Demonstrate
The same job completes through all three doors and produces identical records.
