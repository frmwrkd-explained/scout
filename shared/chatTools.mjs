// The ONE declaration of FrameForge's chat tools (ticket 15).
//
// Pure data — imported by BOTH backend/agentHome.mjs (to seed registerChatTool(), whose enabled
// entries feed the session Index) AND frontend/chat/toolRegistry.jsx (which pairs each id with its
// inline card component and the enable/disable notice). It lives in shared/ for the same reason
// shared/integrations.mjs does: it is read on both sides and must never fork into two drifting copies.
//
// NO JSX / browser globals here — the backend imports it directly, exactly like modelCatalog.js. The
// card COMPONENT for a tool lives on the frontend side (toolRegistry maps id → component); this file
// only carries the metadata a tool needs on both sides.
//
// Each entry:
//   id               — stable key. Also the settings.enabledChatTools[id] toggle key.
//   name             — display name (Settings → Chat tools; the enable notice card).
//   capability       — the one-line description that becomes the tool's Index line (agent-facing).
//   invocation       — schema/endpoint pointer the agent calls; rendered as the Index line's [pointer].
//   directiveTypes   — the directive `type` values this tool's card renders (see directives.jsx).
//   enabledByDefault — ALL false. Hackathon compliance: nothing is on until the user turns it on.
//
// Adding the 200th tool is ONE entry here plus its card in toolRegistry — never a router-skill edit,
// never an Index-format edit. Tickets 16 (grid-splitter) and 17 (shot-board) refine their entry's
// directiveTypes + land their card; the seed below reserves their id and description.
export const CHAT_TOOLS = [
  {
    id: 'style-locks',
    name: 'Style locks',
    capability: 'Show a locked style (grade/light/lens) as a card and set it as the project style.',
    invocation: 'GET /api/stylelocks',
    directiveTypes: ['show.style', 'style.lock', 'stylelock', 'style-lock', 'style'],
    enabledByDefault: false
  },
  {
    id: 'sheet-composer',
    name: 'Sheet composer',
    capability: 'Compose a contact sheet / plate / turnaround from the library into a single grid.',
    invocation: 'POST /api/generate (grid layout)',
    directiveTypes: ['show.sheet', 'sheet', 'sheet-composer'],
    enabledByDefault: false
  },
  {
    id: 'grid-splitter',
    name: 'Grid splitter',
    capability: 'Split a finished grid generation (3×3 sheet, 2×2 plate, turnaround) into per-cell child candidates, keeping/skipping cells and optionally attaching each to a shot. Reference the grid by generation id and shots by id; propose a split with `proposal.split` carrying { ref, rows, cols, shots:{ "r-c": shotId } }.',
    invocation: 'POST /api/generations/:pid/:id/split-grid',
    directiveTypes: ['show.grid', 'grid', 'grid-split', 'grid-splitter', 'proposal.split', 'split'],
    enabledByDefault: false
  },
  {
    id: 'shot-board',
    name: 'Shot board',
    capability: 'Break a story into shots and mirror the shot board inline. Point at a project with `show.shot-board` { project } to render the live board (rows fetched from canonical shot records — number, title, type, duration, status, cast/loc/look chips, selected-candidate thumb; inline edits and reorder persist through the shot routes). The board generates: each row renders on the board\'s model with that shot\'s own beat, its look, and its cast/location reference images attached automatically — so ASSIGN THEM. A breakdown is STAGED, not written: propose it with `proposal.breakdown` carrying { project, shots:[{ no, title, type, dur, desc, cast:[key], loc:key }] } — `cast` and `loc` are entity KEYS from the project\'s cast/location boards, and setting them is what holds a character\'s face and a place\'s geography steady from shot to shot. If you do not set them, write the beat with @key mentions instead (\'@deckhand crosses the stern deck\') and they resolve the same way; a shot with neither renders with no identity reference at all. Never restate a look in the beat — the style lock is attached by id. The user confirms before any shot is created. Refine a written shot by id via PATCH /api/story/:pid/shots/:id (never regenerate the whole list).',
    invocation: 'POST /api/story/:project/breakdown',
    directiveTypes: ['show.shot-board', 'shot-board', 'show.shots', 'breakdown', 'proposal.breakdown'],
    enabledByDefault: false
  },
  {
    id: 'board',
    name: 'Board',
    capability: 'Arrange the project on its infinite canvas. `show.board` { project } renders the live board inline. '
      + 'Read what is already there with GET /api/board/:project/describe (a digest \u2014 counts, shot ids, frame labels, note text \u2014 never raw coordinates). '
      + 'Add cards with POST /api/board/:project/nodes carrying { nodes:[{ t, ... }] }: `shot` takes { shot: shotId } and is a LIVE LINK to that shot\'s selected take (never a copy, never a pasted thumbnail); '
      + '`asset` takes { scope, folder, name }; `text` takes { text, size }; `note` takes { text, tone }; `frame` takes { label } and groups by position; `arrow` takes { from, to } as node ids. '
      + 'Coordinates are optional \u2014 omit x/y and then call POST /api/board/:project/align with { layout } to place everything: `scene-grid` (every scene a titled frame, shots in order \u2014 the default), `shot-strip`, `by-kind`, `tidy`. '
      + 'Aligning pulls in any shot not yet on the board, so it is also how you populate an empty canvas. '
      + 'POST /api/board/:project/show { show: "selected" | "all" } toggles between the approved plan and every take. '
      + 'Never restate a shot\'s title, status or picture on a text node \u2014 the shot card already carries them and a typed copy goes stale the moment a take is re-selected.',
    invocation: 'GET /api/board/:project/describe \u00b7 POST /api/board/:project/nodes|align|show',
    directiveTypes: ['show.board', 'board', 'board.add', 'board.align', 'proposal.board'],
    enabledByDefault: false
  },
  {
    id: 'look-extractor',
    name: 'Look extractor',
    capability: 'Turn a reference still into a reusable LOOK (grade, light, lens feel).',
    invocation: 'POST /api/looks/extract',
    directiveTypes: ['show.look', 'look', 'look-extract', 'look-extractor'],
    enabledByDefault: false
  },
  {
    id: 'control-maps',
    name: 'Control maps',
    capability: 'Derive depth / edge / pose / matte control maps from a reference frame.',
    invocation: 'POST /api/control/*',
    directiveTypes: ['show.control', 'control', 'control-map', 'control-maps'],
    enabledByDefault: false
  }
];

export const CHAT_TOOL_IDS = CHAT_TOOLS.map(t => t.id);
export const chatToolById = id => CHAT_TOOLS.find(t => t.id === id) || null;

// ── enablement resolution: the ONE rule, imported by both sides ──
//
// A tool is enabled PER PROJECT. The layers, most specific first:
//   1. the project's map   — project.md frontmatter `enabledTools`, written by the chat's TOOLS rail
//   2. the global map      — settings.enabledChatTools: the default a project inherits until it has
//                            an opinion, and the ONLY layer a standalone (project-less) session has
//   3. tool.enabledByDefault — all false (hackathon compliance: nothing runs until turned on)
//
// "Absent" is the load-bearing state: a project that has never touched a tool falls THROUGH to the
// global default rather than pinning false, so a global default still reaches existing projects.
//
// This function exists because the resolution was open-coded in five places (agentHome.listChatTools,
// userTools' GET /api/tools, Settings.renderChatTools, toolRegistry.isToolEnabled, toolCards.toolEnabled)
// and had already drifted — two of them fell back to `enabledByDefault`, three to a literal false.
// Adding the project layer to five copies would have guaranteed a sixth drift. Call this instead.
export function resolveToolEnabled(id, { project, global, tool } = {}) {
  const key = String(id);
  const has = (m, k) => m && typeof m === 'object' && Object.prototype.hasOwnProperty.call(m, k);
  if (has(project, key)) return !!project[key];
  if (has(global, key)) return !!global[key];
  const t = tool || chatToolById(key);
  return !!(t && t.enabledByDefault);
}

// directive type → owning tool. Used by the frontend registry to gate a directive's card behind its
// tool's enablement, and available anywhere the mapping is needed without re-deriving it.
export const CHAT_TOOL_BY_DIRECTIVE = (() => {
  const m = new Map();
  for (const t of CHAT_TOOLS) for (const dt of t.directiveTypes || []) m.set(String(dt), t);
  return m;
})();
