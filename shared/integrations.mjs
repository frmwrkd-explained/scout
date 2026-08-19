// Integration registry — the single source of truth for what FrameForge can turn on and off.
//
// Imported by BOTH backend/index.mjs (to gate route mounting) and the React UI (to gate the tool
// grid, nav and the Settings switchboard). It lives in shared/ rather than frontend/ deliberately:
// the existing backend → frontend/modelCatalog.js import is a known wart (ISSUES.md #6), and new
// cross-cutting data should not repeat it.
//
// A module here is something a user can genuinely live without. Things the app cannot run without
// (the markdown store, projects, the review inbox) are not modules and never appear in this list.
//
// `cost` is what the user actually pays by leaving it on — the reason this switchboard exists.
// Be honest in these strings; they are rendered verbatim in Settings.

export const INTEGRATIONS = [
  {
    id: 'remotion',
    label: 'Remotion',
    group: 'Render',
    line: 'Browse and re-render the compositions of an external Remotion project, with saved prop presets.',
    unlocks: ['Remotion library page', 'Story → Remotion handoff', 'Composition thumbnails'],
    npm: [],
    binaries: ["the project's own remotion CLI"],
    keys: [],
    disk: 'none in FrameForge — your Remotion project carries its own ~400 MB install',
    cost: 'free — renders locally on your machine',
    defaultOn: true,
    // requires a settings value before it can do anything; surfaced as a "needs setup" chip
    needs: 'remotionProject'
  },
  {
    id: 'stage3d',
    label: '3D Stage',
    group: 'Create',
    line: 'Block scenes in real 3D, keyframe camera and objects, export the move as a video reference.',
    unlocks: ['3D Stage tool', 'image → 3D mesh', 'camera-move video export'],
    npm: ['three'],
    binaries: ['ffmpeg (for video export)'],
    keys: ['falApiKey (image → 3D only)'],
    disk: '~14.5 MB packaged · ~168 KB gzip in the UI bundle',
    cost: 'FAL Trellis charges per image → 3D conversion; the editor itself is free',
    defaultOn: true
  },
  {
    id: 'videoimport',
    label: 'Video Import',
    group: 'Create',
    line: 'Pull in local or YouTube video, detect scene cuts, extract frames into the library.',
    unlocks: ['Video import', 'scene-cut detection', 'frame extraction'],
    npm: [],
    binaries: ['yt-dlp', 'ffmpeg', 'ffprobe'],
    keys: [],
    disk: 'none',
    cost: 'free itself — but extracted frames feed Mood auto-detect if that is also on',
    defaultOn: true
  },
  {
    id: 'moodanalyze',
    label: 'Mood auto-detect',
    group: 'Analyse',
    line: 'Automatically tag mood, palette and keywords on every image that lands in the library.',
    unlocks: ['automatic tags + palette on import'],
    npm: [],
    binaries: [],
    keys: ['groqApiKey'],
    disk: 'none',
    cost: 'one vision call per imported image — the main source of background spend',
    defaultOn: false,
    // this module IS the existing autoAnalyze flag; keep them in lockstep rather than adding a
    // second switch that contradicts the first
    legacyFlag: 'autoAnalyze'
  },
  {
    id: 'lookextract',
    label: 'Look Extractor',
    group: 'Analyse',
    line: 'Turn any reference still into a reusable LOOK — grade, light and lens feel.',
    unlocks: ['Look Extractor tool', 'looks/*.md'],
    npm: [],
    binaries: [],
    keys: ['groqApiKey'],
    disk: 'none',
    cost: 'one vision call per extraction — on demand, never in the background',
    defaultOn: true
  },
  {
    id: 'storybreak',
    label: 'Story Breakdown',
    group: 'Analyse',
    line: 'Break a written story into a numbered shot list.',
    unlocks: ['Story → shots'],
    npm: [],
    binaries: [],
    keys: ['groqApiKey'],
    disk: 'none',
    cost: 'one text call per breakdown — on demand',
    defaultOn: true
  },
  {
    id: 'transcribe',
    label: 'Transcription',
    group: 'Analyse',
    line: 'Voice memos and video into editable text, for notes or straight into a story.',
    unlocks: ['Transcriber tool', 'voice dictation'],
    npm: [],
    binaries: ['parakeet-mlx (local engine only)'],
    keys: ['groqApiKey (cloud engine only)'],
    disk: 'none for cloud · multi-GB python env for the local engine',
    cost: '$0.04/hour on Groq Whisper — or free on the local engine',
    defaultOn: true
  },
  {
    id: 'agent',
    label: 'Claude Agent',
    group: 'Automate',
    line: 'Background agent jobs — rerolls, skill editing, and Arcads generation.',
    unlocks: ['reroll jobs', 'skill enhancement', 'Arcads models'],
    npm: [],
    binaries: ['claude'],
    keys: ['a Claude subscription or API key (held by the CLI)'],
    disk: 'none',
    cost: 'counts against your Claude plan — not tracked in the FrameForge budget',
    defaultOn: true
  },
  {
    id: 'manualroundtrip',
    label: 'Manual Round-Trip',
    group: 'Create',
    line: 'Render outside FrameForge — hand the prompts to Google Flow, Midjourney or your own rig, then drop the downloads into the project Inbox and get them filed back onto their shots.',
    unlocks: ['Handoff sheets (copy prompts, in order)', 'project Inbox + Scan', 'AI sort of whatever order and filenames miss'],
    npm: [],
    binaries: ['claude or codex — only for the AI sort tier; filename + order matching needs nothing'],
    keys: [],
    disk: 'none — files move from inbox/ into renders/, nothing is duplicated',
    cost: 'free. Matching by filename and handoff order costs nothing. The AI sort tier runs on your agent CLI subscription — no provider spend either way',
    defaultOn: true
  },
  {
    id: 'feedback',
    label: 'Feedback',
    group: 'Automate',
    line: 'Send feedback from inside the app — a bug, a confusion, or something you want — with a screenshot and the evidence around it: the console, the last API calls, and what the server was doing. Nothing is collected in the background and nothing is sent until you press Send.',
    unlocks: ['Feedback panel + shortcut', 'screenshot, annotate, blur', 'status on what you have sent'],
    npm: [],
    binaries: [],
    keys: [],
    disk: 'none — the capture buffers live in memory and are dropped on reload',
    // The honest version of this string is the whole reason a user would leave it on.
    cost: 'free — nothing leaves your machine until you press Send, and you see the exact payload first',
    defaultOn: true
  },
  {
    id: 'chat',
    label: 'Filmmaker Chat',
    group: 'Automate',
    line: 'The conversational orchestrator — a chat that drives FrameForge through your enabled skill packs and chat tools. Individual tools have their own toggles (Settings → Chat tools).',
    unlocks: ['Chat tab', 'chat sessions + session Index', 'the chat-tools switchboard'],
    npm: [],
    binaries: ['claude'],
    keys: ['a Claude subscription or API key (held by the CLI)'],
    disk: 'none',
    cost: 'runs on the Claude Agent — counts against your Claude plan, like the agent itself',
    // `requires` the agent module: chat is meaningless without it. When agent is off, chat is forced
    // off regardless of its own toggle; when the user hasn't set an explicit chat toggle, chat simply
    // follows the agent's state (on by default only because agent is on by default). See isEnabled().
    requires: 'agent',
    defaultOn: false
  }
];

export const INTEGRATION_IDS = INTEGRATIONS.map(m => m.id);
export const byId = id => INTEGRATIONS.find(m => m.id === id) || null;

// Resolve a module's on/off state from a settings object.
// Missing key → the module's own default, so adding a module later doesn't silently arrive off
// for existing users (and doesn't require a settings migration).
export function isEnabled(settings, id) {
  const mod = byId(id);
  if (!mod) return true; // unknown id: never gate something we don't understand
  const s = settings || {};
  // A dependent module (`requires`) is force-off whenever its requirement is off — no toggle of its
  // own can turn it on without the thing it depends on. (agent has no requirement, so no recursion.)
  if (mod.requires && !isEnabled(s, mod.requires)) return false;
  if (mod.legacyFlag && Object.prototype.hasOwnProperty.call(s, mod.legacyFlag)) return !!s[mod.legacyFlag];
  const map = s.enabledModules;
  if (map && Object.prototype.hasOwnProperty.call(map, id)) return !!map[id];
  // No explicit toggle: a dependent module defaults to its requirement's state (so chat is on by
  // default precisely when agent is); an independent module falls back to its own defaultOn.
  if (mod.requires) return isEnabled(s, mod.requires);
  return !!mod.defaultOn;
}

// Full resolved state — handy for /api/state and the Settings switchboard.
export function resolveModules(settings) {
  const out = {};
  for (const m of INTEGRATIONS) out[m.id] = isEnabled(settings, m.id);
  return out;
}
