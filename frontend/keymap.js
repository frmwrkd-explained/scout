// Rebindable keyboard map — PURE module, no React.
// Defaults live here; user overrides persist as settings.keys ({ actionId: key }).
// Keys are stored as e.key.toLowerCase() values (' ' = Space). Escape, Enter, Tab,
// arrows, digits 1–5 and anything with ⌘/⌃/⌥ are reserved and can't be bound.
export const KEY_ACTIONS = [
  { id: 'help',       def: '?', ctx: 'Global',        label: 'shortcut cheat sheet' },
  { id: 'search',     def: '/', ctx: 'Global',        label: 'search & jump (same as ⌘K)' },
  { id: 'inbox',      def: 'i', ctx: 'Global',        label: 'open / resume the review Inbox' },
  { id: 'queue',      def: 'q', ctx: 'Global',        label: 'open the generation Queue' },
  { id: 'undo',       def: 'u', ctx: 'Global',        label: 'undo last action' },
  { id: 'goHome',     def: 'h', ctx: 'Global',        label: 'go to Home' },
  { id: 'goTools',    def: 't', ctx: 'Global',        label: 'go to Tools' },
  { id: 'goLibrary',  def: 'b', ctx: 'Global',        label: 'go to Library' },
  { id: 'styleLocks', def: 's', ctx: 'Global',        label: 'open style lock picker' },
  { id: 'projGenerate', def: 'g', ctx: 'Global',      label: 'jump to project Generate tab' },
  { id: 'quickNote',  def: 'n', ctx: 'Global',        label: 'quick note → project memory' },
  { id: 'openMemory', def: 'm', ctx: 'Global',        label: 'open References → Memory' },
  { id: 'feedback',   def: 'f', ctx: 'Global',        label: 'send feedback' },
  { id: 'review',     def: 'r', ctx: 'Project',       label: 'enter review mode (Generate → Review)' },
  { id: 'reel',       def: 'a', ctx: 'Project',       label: 'open the Reel (animatic)' },
  { id: 'reelExport', def: 'e', ctx: 'Reel',          label: 'write the animatic conform pack' },
  { id: 'keep',       def: 'k', ctx: 'Review · Item', label: 'keep' },
  { id: 'kill',       def: 'x', ctx: 'Review · Item', label: 'kill' },
  { id: 'note',       def: 'n', ctx: 'Review · Item', label: 'note → re-roll' },
  { id: 'play',       def: ' ', ctx: 'Review · Item', label: 'play / pause' },
  { id: 'final',      def: 'l', ctx: 'Item',          label: 'mark final' },
  { id: 'copyPrompt', def: 'p', ctx: 'Item',          label: 'copy prompt' },
  { id: 'compare',    def: 'c', ctx: 'Item',          label: 'A/B compare versions' },
  { id: 'reveal',     def: 'o', ctx: 'Item',          label: 'reveal in Finder' }
];

// Not rebindable — shown for completeness in Settings.
export const FIXED_KEYS = [
  ['⌘K', 'command palette'],
  ['1–5', 'fine rating (item)'],
  ['← →', 'previous / next · scrub'],
  ['Esc', 'exit / back']
];

export const RESERVED = new Set(['escape', 'enter', 'tab', 'backspace', 'delete',
  'arrowleft', 'arrowright', 'arrowup', 'arrowdown', '1', '2', '3', '4', '5']);

// action id → active key, with settings.keys overrides applied
export function resolveKeys(settings) {
  const o = (settings && settings.keys) || {};
  const m = {};
  KEY_ACTIONS.forEach(a => { m[a.id] = (typeof o[a.id] === 'string' && o[a.id]) ? o[a.id] : a.def; });
  return m;
}

export function keyLabel(k) {
  if (k === ' ') return 'Space';
  return k.length === 1 ? k.toUpperCase() : k;
}
