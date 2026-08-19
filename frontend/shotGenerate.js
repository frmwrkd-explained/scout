// The ONE composer of "a shot → a generation request".
//
// A shot is WHO (cast) + WHERE (loc) + WHAT (props) + LOOK (style lock) + the action beat. Turning
// that into an /api/generate body means resolving four things, and every surface that generates a
// shot has to resolve them identically or the same shot renders differently depending on which
// button you pressed:
//
//   1. the MODEL      — the shot's project default, else the preview model
//   2. the LOOK       — the shot's own assigned look, else the project's active style lock
//   3. the PROMPT     — action beat + the look's fragment, joined (never re-typed by the model)
//   4. the REFS       — cast + props + location images, so identity holds across shots
//
// This lived only as private methods on Story.jsx (lookOf / entityRefs / batchModel), so the chat's
// shot-board card had no way to generate without copying them. Story now delegates here; this module
// is the single implementation. Do not re-derive any of it at a call site.
//
// ENTITY RESOLUTION is deliberately generous: a shot that carries explicit `cast`/`loc` fields uses
// them, but a shot the agent wrote as prose falls back to the @-mentions inside its own text. That
// fallback is what lets "the agent brings the character and location along" work without the agent
// having to fill structured fields it may not have set.
import { joinFragment } from './lookBuilder';
import { maxRefs, DEFAULT_PREVIEW_MODEL, DEFAULT_RESOLUTION } from './models';
import { buildAssetPool } from './entities';

// @tokens inside a shot's own text — the implicit cast/location assignment.
export function shotMentions(sh) {
  const text = (sh.desc || '') + ' ' + (sh.prompt || '');
  return (text.match(/@[\w\-.]+/g) || []).map(m => m.slice(1).toLowerCase());
}

// key → entity, over every taggable asset in the project + library.
export function entityIndex(app, pid) {
  return new Map(buildAssetPool(app, pid).map(e => [e.key, e]));
}

// Explicit field wins; otherwise read the shot's own @mentions and filter by entity kind.
// `loc === ''` is a deliberate CLEAR (the user removed it), not "unset" — it must not fall back.
export function shotCast(sh, m) {
  if (Array.isArray(sh.cast)) return sh.cast;
  return shotMentions(sh).filter(k => (m.get(k) || {}).kind === 'talent');
}
export function shotLoc(sh, m) {
  if (sh.loc) return sh.loc;
  if (sh.loc === '') return null;
  return shotMentions(sh).find(k => (m.get(k) || {}).kind === 'location') || null;
}
export function shotProps(sh) { return Array.isArray(sh.props) ? sh.props : []; }

// The LOOK governing a shot: its own assigned look, else the project's active lock. `extraLooks`
// carries extracted look-sheets (Story and the Production rail both load these separately), so a
// shot assigned an extracted look resolves it rather than silently falling back to the project lock.
export function lookForShot(app, pid, sh, extraLooks = []) {
  if (sh && sh.look) {
    const locks = (app.state.styleLocks || []).map(l => ({ id: l.id, name: l.name, fragment: l.fragment || '', model: l.model }));
    const looks = (extraLooks || []).map(k => ({ id: k.id, name: k.summary ? k.summary.slice(0, 48) : k.id, fragment: k.tier2 || k.tier1 || '' }));
    const hit = [...locks, ...looks].find(x => x.id === sh.look);
    if (hit) return hit;
  }
  return (app.state.activeStyleLocks || {})[pid] || null;
}

// Assigned entities' images ride along as references — this is what holds a character's identity
// steady from shot to shot. Capped at the model's own ref limit, never a hardcoded number.
export function refsForShot(app, pid, sh, model, m) {
  const idx = m || entityIndex(app, pid);
  const keys = [...shotCast(sh, idx), ...shotProps(sh)];
  const loc = shotLoc(sh, idx);
  if (loc) keys.push(loc);
  return keys.map(k => idx.get(k)).filter(Boolean)
    .map(c => ({ kind: 'asset', scope: c.scope, name: c.name, folder: c.folder || '' }))
    .slice(0, maxRefs(model));
}

// The action beat with the look composed in. joinFragment, never `a + ', ' + b` — the naive concat
// is the double-comma bug and makes this path disagree with every composer in the app.
export function shotPrompt(app, pid, sh, look) {
  const base = ((sh && (sh.prompt || sh.desc)) || '').trim();
  if (!base) return '';
  return look && look.fragment ? joinFragment(base, look.fragment) : base;
}

// The model a shot generates on unless the caller overrides it.
export function defaultShotModel(app, pid) {
  return app.projDef(pid).model
    || ((app.state.settings || {}).modelDefaults || {}).preview
    || DEFAULT_PREVIEW_MODEL;
}

// The complete /api/generate body for one shot. Returns null when the shot has no prompt to render —
// callers report that as "skipped", never as a silent no-op.
export function shotGenerateBody(app, pid, sh, opts = {}) {
  const model = opts.model || defaultShotModel(app, pid);
  const look = opts.look !== undefined ? opts.look : lookForShot(app, pid, sh, opts.extraLooks);
  const prompt = shotPrompt(app, pid, sh, look);
  if (!prompt) return null;
  const body = {
    pid, shot: sh.id, prompt, model,
    aspect: opts.aspect || '16:9',
    resolution: opts.resolution || DEFAULT_RESOLUTION,
    seed: opts.seed ?? null,
    refs: opts.refs || refsForShot(app, pid, sh, model, opts.entityIndex),
  };
  // params are per-model (SchemaForm's output) and only travel when the caller has some — sending
  // `params: {}` to a model with required schema defaults is not the same as sending nothing.
  if (opts.params && Object.keys(opts.params).length) body.params = opts.params;
  return body;
}
