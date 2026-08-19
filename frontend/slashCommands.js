// DEV-126 — the composer's `/` command tree.
//
// The slash menu was a flat snippet list. This makes it two levels:
//
//   /              → snippets (unchanged, still first) + the group rows below
//   /model nano    → the model catalog, filtered
//   /look harbor   → saved style locks
//   /camera push   → camera movements
//   /angle low     → camera angles (the `framing` axis — see DEV-129)
//
// PURE MODULE. No React, no DOM: the tree is data plus a filter, so it can be unit-tested and so
// MentionText stays a renderer. The `apply` side-effect is supplied by the composer, which owns the
// state being mutated — a command must never reach into a surface directly.
//
// SNIPPETS STAY TEXT, GROUPS STAY STATE. Picking a snippet splices text into the prompt, exactly as
// before. Picking a group item mutates composer state (model, look, movement, angle) and inserts
// NOTHING — those are prompt fragments composed in at generate time, and injecting them as literal
// text would double them into the outgoing prompt.
//
// One registry, deliberately NOT a second one: the ⌘K Palette builds its own list inline
// (frontend/Palette.jsx `items()`) because it navigates the app, while this one configures a
// composer. They share no items. If they ever do, this is the file that should grow a shared
// source, not a copy. (A third registry, frontend/commands.js, was written for exactly that
// sharing and never wired to anything — deleted 2026-08-02. Keybindings are frontend/keymap.js.)

import { enabledCatalog, modelKind } from './models.js';
import { CAMERA_MOVEMENTS } from './cameraMovements.js';
import { AXES } from './models.js';

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
// `ctx` is what the composer knows: its settings (for the catalog), the looks list, and the
// fragmentProps callbacks that own each piece of state.
export function commandGroups(ctx = {}) {
  const { settings = {}, looks = [], fp = {}, onModel = null, video = null } = ctx;
  const out = [];

  if (onModel) {
    const models = enabledCatalog(settings).flatMap(g => g.models)
      .filter(m => video == null ? true : (modelKind(m.id) === 'video') === !!video);
    out.push({
      id: 'model', label: '/model', hint: 'pick a model',
      items: models.map(m => ({ id: m.id, label: m.label, sub: (m.note || '') })),
      // `text` is the prompt with the command already stripped. The model setter goes through
      // the composer's own set(), which merges into a CAPTURED value object — so writing the model
      // and the cleaned prompt as two calls made the second clobber the first (the command text
      // stayed in the field). They must land in one write; the other groups set surface state, not
      // composer value, and are unaffected.
      apply: (it, text) => { bumpUse('model', it.id); onModel(it.id, text); }
    });
  }
  if (fp.onLook) {
    out.push({
      id: 'look', label: '/look', hint: 'apply a saved style',
      items: (looks || []).map(l => ({ id: l.id, label: l.name, sub: l.fragment || '' })),
      apply: it => { bumpUse('look', it.id); fp.onLook(it.id); }
    });
  }
  if (fp.onMove) {
    out.push({
      id: 'camera', label: '/camera', hint: 'camera movement',
      items: CAMERA_MOVEMENTS.map(m => ({ id: m.id, label: m.name, sub: m.description || '' })),
      apply: it => { bumpUse('camera', it.id); fp.onMove(it.id); }
    });
  }
  if (fp.onAngle) {
    const tokens = (AXES.find(a => a.key === 'framing') || { tokens: [] }).tokens || [];
    out.push({
      id: 'angle', label: '/angle', hint: 'camera angle',
      items: tokens.map(t => ({ id: t.t, label: t.t, sub: t.d || t.f || '', thumb: t.img })),
      apply: it => { bumpUse('angle', it.id); fp.onAngle(it.id); }
    });
  }
  return out;
}

// Split a slash token into [groupId, rest]. `/model nano banana` → ['model', 'nano banana'].
// A token with no space is not yet a group entry — it is still filtering the top level, so that
// typing "/mo" narrows the group ROWS rather than jumping into one prematurely.
export function splitToken(token, groups) {
  const s = String(token || '');
  const sp = s.indexOf(' ');
  if (sp < 0) return [null, s];
  const head = s.slice(0, sp).toLowerCase();
  const g = groups.find(x => x.id === head);
  return g ? [g.id, s.slice(sp + 1)] : [null, s];
}
