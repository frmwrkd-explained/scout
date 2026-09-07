// Scout's real keyboard bindings — PURE module, no React.
//
// This used to be FrameForge's whole rebindable action list (30-odd entries: Inbox, Queue, Home,
// Library, Tools, Reel export, item review keep/kill…) for an app whose screens Scout never ported.
// Only `keyLabel` had a live importer (Decide.jsx). Reduced to what is actually true here: Scout
// has no settings.keys and no rebinding UI — every key below is fixed, the way Decide.jsx's own
// header says it is ("the keys never move") — so this is a plain list, read by the Settings
// screen's cheat sheet, not a resolver.
export const KEYS = [
  { key: 'D',    ctx: 'Global',   label: 'open the DECIDE queue' },
  { key: '⌘K',   ctx: 'Global',   label: 'search & jump' },
  { key: '⌥⌘L',  ctx: 'Global',   label: 'toggle light / dark' },
  { key: 'Esc',  ctx: 'Global',   label: 'back / close' },
  { key: 'A',    ctx: 'Decide',   label: 'accept the card' },
  { key: 'R',    ctx: 'Decide',   label: 'reject → pick a reason, 1–5' },
  { key: 'S',    ctx: 'Decide',   label: 'skip — comes back at the end (G)' },
  { key: 'W',    ctx: 'Decide',   label: 'WHY — one paragraph of reasoning' },
  { key: 'E',    ctx: 'Decide',   label: 'EVIDENCE — the record behind the card' },
  { key: 'O',    ctx: 'Decide',   label: 'open the record on its own screen' },
  { key: 'J / K',ctx: 'Decide',   label: 'next / previous card' },
  { key: '⌘Z',   ctx: 'Decide',   label: 'undo the last decision' },
  { key: 'P',    ctx: 'Document', label: 'toggle PROPERTIES open or collapsed' },
  { key: '⌘S',   ctx: 'Document', label: 'force the pending save now' },
];

export function keyLabel(k) {
  if (k === ' ') return 'Space';
  return String(k).length === 1 ? String(k).toUpperCase() : k;
}
