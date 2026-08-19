# 06 · REUSE — what to take, from where, and what to leave

**Grep before you build. A second implementation of anything in this table is a bug.**
All four sources are MIT or the owner's own code — copying, including commercially, is fine.

---

## FrameForge — `/Volumes/SSD/New Coding Projects/FAL HACKATON` (owner's own)

**Scout is a fork of this.** Port the spine; delete the film domain.

| Take | What it gives you |
|---|---|
| `backend/store.mjs` | The markdown datastore, atomic tmp+rename writes, path safety, the config pointer that lets Electron redirect the storage root |
| `backend/memory.mjs` | Project memory doc + the learnings-dedupe normaliser — extend into `03_MEMORY.md` |
| `backend/indexer.mjs` · `search.mjs` | Incremental index and search |
| `backend/agentHome.mjs` | **The Index generator + isolated agent home + skill-pack mounting.** The "capability = one Index line" pattern comes from here. |
| `backend/agentRunner.mjs` · `agentProviders.mjs` | Spawning a CLI agent, streaming events, per-provider argv in data. This is door 1 — keep it optional. |
| `backend/jobs.mjs` · `sessions.mjs` · `chat.mjs` | Run/session plumbing |
| `backend/ledger.mjs` · `licence.mjs` · `feedback.mjs` | Cost ledger, licensing, redacted bug capture |
| `frontend/ui.jsx`, `Composer.jsx`, `ComposerDock`, `Markdown`, `SnippetText`, `MentionText`, `VoiceInput` | The component registry. **`Composer` is THE composer** — zero density variants, on purpose. |
| `frontend/Board.jsx`, `BoardNodes.jsx`, `BoardInspector.jsx`, `boardLayout.js` | The whiteboard. Native HTML nodes on one CSS transform — that is why a live document can sit in a card. |
| `frontend/styles.css` `:root`, `tokens.js`, `docs/DESIGN.md` | The design system, verbatim |
| `desktop/`, `updater.cjs` | Electron shell, packaging, notarised build, auto-update |

**Delete:** `video · remotion · reel* · threed · gridsplit · stylelocks · fal · localAsr · imageSize · boardExport` and the film frontend (Timeline, Screenplay, StyleLab, CameraMoves, FilmEmulation, LutApplier, ThreeDStage, MoveAnalyzer, Moodboard).

## Tesseract MD — `github.com/geckse/tesseract-md-app` (MIT)

Svelte 5 → **port the pattern, not the file.** The value is the interaction and the edge cases they already hit.

| Take | Where |
|---|---|
| **The frontmatter property editor** — typed rows above the body | `components/wysiwyg/FrontmatterEditor.svelte`, `PropertyRow.svelte`, `AddPropertyRow.svelte`, `PropertySettingsPopover.svelte`, `TypePickerDropdown.svelte` |
| **The 11 typed cell editors** | `components/table/cells/*` |
| **Relations as chips + picker** | `RelationCell`, `RelationChip`, `RelationPicker` |
| **Table views** | `TableView`, `TableHeader/Row/Toolbar/GroupHeader`, `SaveViewModal` |
| **Saved views stored in-vault** | `src/main/table-views.ts` — views travel with the data; an agent can write one |
| **Conflict UX — take this on day one** | `ConflictNotification.svelte`, `DiffView.svelte`. Agents write while humans edit; this is not optional. |
| **Safe concurrent writes** | `src/main/atomic-write.ts`, `file-write-queue.ts`, `own-writes.ts` — per-path serialisation and `origin: app \| external` classification |
| **Backlinks split in two** | `PropertiesPanel.svelte` — *Links* (body wikilinks) vs *Referenced by* (frontmatter relations). Keep them visually distinct; that split is what makes tags feel like a database. |
| Schema overlay YAML | `.markdownvdb.schema.yml` shape — relation targets, rollups. Language-neutral, lift directly. |

**Leave:** the `mdvdb` Rust binary and its index (rkyv/usearch/Tantivy), the 3D graph, collections-bound-to-folders (ours are saved queries).

## Hermes Fleet — `/Volumes/SSD/New Coding Projects/Hermes Assitants` (owner's own)

The self-improvement and governance machinery, already built and shipped.

| Take | What it is |
|---|---|
| **`skillSuggestions`** | propose → research → draft → **human approves** → materialise. This is exactly the shape of Scout's learning and schema proposals. Copy the state machine and the fields (`rationale`, `draftContent`, `research`, `version`, `status`). |
| **`requests` + `permissionGate`** | Typed human-in-the-loop requests with an authoritative allowlist. The model for Scout's gate. |
| **`runs` / `steps` / `usageEvents`** | Observability shape for agent runs |
| **`budgets` + `/api/budget/check`** | Pre-flight cost check before an expensive action. Agents running all day need this. |
| **`memberProfiles` + `/intake`** | The voice-enabled onboarding interview → a profile the agent folds into its prompt. **This is Scout's first-run interview**, already designed. |
| `lib/redact.ts` | One redactor, seven ordered rules. Never write a second. |
| Per-agent tokens, hashed | Auth shape if Scout ever exposes its API beyond localhost |

## TencentDB-Agent-Memory — `github.com/TencentCloud/TencentDB-Agent-Memory` (MIT)

**Design only. No code.**

| Take | Leave |
|---|---|
| L0–L3 layering + injection asymmetry | Hard-coded Chinese prompts |
| `store / update / merge / skip` batched resolution, many-to-many, timestamp union | Redis / TCVDB / COS / the team-agent identity plane |
| The **sandboxed** consolidation agent (chroot'd so system files are invisible) | **Their no-decay model — we invert it (Law 3)** |
| Async write queue so memory writing never blocks the working agent | |
| L2 scene naming (*"I'm doing Y with X"*) — the ancestor of our **project** | |

## codebase-memory-mcp — `github.com/DeusData/codebase-memory-mcp`

Three mechanics only: file-hash + cascade-delete as the whole incremental-reindex story; the committable compressed index artefact; and the **coverage table** that tells an agent honestly what it has *not* indexed. Its data model is 100% code-shaped — take none of it.

---

## The rule

Anything in the table above that gets re-implemented from scratch is a defect, not a preference. If a source's version is wrong for us, **say why in `docs/decisions.md`** and then write the replacement once.
