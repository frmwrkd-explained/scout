// DEV-126 — the composer's `/` command tree.
//
// The slash menu was a flat snippet list. This makes it two levels:
//
//   /              → snippets (unchanged, still first) + the group rows below
//
// PURE MODULE. No React, no DOM: the tree is data plus a filter, so it can be unit-tested and so
// MentionText stays a renderer. The `apply` side-effect is supplied by the composer, which owns the
// state being mutated — a command must never reach into a surface directly.
//
// SNIPPETS STAY TEXT, GROUPS STAY STATE. Picking a snippet splices text into the prompt, exactly as
// before. Picking a group item mutates composer state and inserts NOTHING — those are prompt
// fragments composed in at generate time, and injecting them as literal text would double them
// into the outgoing prompt.
//
// One registry, deliberately NOT a second one: the ⌘K Palette builds its own list inline
// (frontend/Palette.jsx `items()`) because it navigates the app, while this one configures a
// composer. They share no items. If they ever do, this is the file that should grow a shared
// source, not a copy. (A third registry, frontend/commands.js, was written for exactly that
// sharing and never wired to anything — deleted 2026-08-02. Keybindings are frontend/keymap.js.)
//
// /model (the model catalog), /camera + /angle (camera movements/angles), and the saved-style
// group were removed with the film domain's catalog data and style-lock files. commandGroups()
// below pushes nothing today; it still returns a list of groups so a future Scout-specific group
// is a `push`, not a rewrite.

// ── frecency ──
// Usage counts per kind, in localStorage. Not settings.md: this is a per-machine habit, it changes
// on nearly every generation, and routing it through the settings PUT would put a network write in
// the path of picking a model. Never throws — private-mode Safari makes even getItem throw.
const USE_KEY = 'frfg.cmd.use';
function readUse() {
  try { return JSON.parse(localStorage.getItem(USE_KEY) || '{}') || {}; } catch { return {}; }
}
export function bumpUse(kind, id) {
  if (!kind || !id) return;
  try {
    const u = readUse();
    u[kind] = u[kind] || {};
    u[kind][id] = (u[kind][id] || 0) + 1;
    localStorage.setItem(USE_KEY, JSON.stringify(u));
  } catch { /* private mode — ranking silently falls back to catalog order */ }
}
export function useCount(kind, id) { return (readUse()[kind] || {})[id] || 0; }

// Rank: exact-prefix first (what the user is typing beats what they used yesterday), then usage,
// then the source order. Prefix-before-frecency matters — a picker that reorders under your
// keystrokes as you narrow is worse than one that never reordered at all.
function rank(items, q, kind) {
  const t = q.trim().toLowerCase();
  const starts = it => String(it.label || '').toLowerCase().startsWith(t) || String(it.id || '').toLowerCase().startsWith(t);
  return items.slice().sort((a, b) => {
    if (t) { const d = starts(b) - starts(a); if (d) return d; }
    return useCount(kind, b.id) - useCount(kind, a.id);
  });
}

const hay = it => [it.label, it.id, it.sub].filter(Boolean).join(' ').toLowerCase();
export function filterItems(items, q, kind) {
  const terms = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = items.filter(it => terms.every(t => hay(it).includes(t)));
  return rank(hits, q, kind).slice(0, 8);
}

// ── the tree ──
// `ctx` is what the composer knows: the fragmentProps callbacks that own each piece of state.
export function commandGroups(ctx = {}) {
  const { fp = {} } = ctx;
  const out = [];

  return out;
}

// Split a slash token into [groupId, rest]. `/group item name` → ['group', 'item name'].
// A token with no space is not yet a group entry — it is still filtering the top level, so that
// typing a partial group id narrows the group ROWS rather than jumping into one prematurely.
export function splitToken(token, groups) {
  const s = String(token || '');
  const sp = s.indexOf(' ');
  if (sp < 0) return [null, s];
  const head = s.slice(0, sp).toLowerCase();
  const g = groups.find(x => x.id === head);
  return g ? [g.id, s.slice(sp + 1)] : [null, s];
}
