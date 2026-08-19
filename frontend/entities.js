// The @-mention entity pool, shared. One resolver for "what can @ tag in this project" so the
// composer's inline pills, the autocomplete and Story's production data all agree. Mirrors
// Story.jsx's mentionPool()/entityPool() pair (which predates this file and stays authoritative
// for Story's own production columns) — if you change the key or kind rules here, change them
// there too, or a pill and a CAST cell will disagree about the same asset.
import { assetUrl } from './Moodboard';

const KINDS = { cast: 'talent', talent: 'talent', characters: 'talent', locations: 'location', location: 'location', props: 'prop', prop: 'prop', wardrobe: 'wardrobe', costumes: 'wardrobe' };

export const entityKey = name => String(name || '').replace(/\.\w+$/, '').toLowerCase();

// [{ key, label, thumb, kind, scope, name, folder }] — PRODUCTION ENTITIES ONLY: cast, locations,
// props, wardrobe, from the project's asset boards and the library. Moodboard/reference images are
// deliberately excluded — an @-mention pool holding every context image drowns the three names
// that matter under dozens of "lego ninjago …-shot-06" reference stills, and the whole point of
// tagging is fast recall of the people and places you shoot with. `key` is the stable id the
// @token carries; `label` is display-only (set by renaming the entity in the production strip).
export function buildEntityPool(app, pid) {
  const seen = new Set(); const out = [];
  const push = (c, scope) => {
    if (!(c.type === 'image' || c.type === 'video')) return;
    const base = String(c.folder || '').split('/').pop().toLowerCase();
    const kind = (c.meta || {}).kind || KINDS[base] || null;
    if (!kind) return; // not a production entity — reachable via + Ref / the asset boards instead
    const key = entityKey(c.name);
    if (seen.has(key)) return; seen.add(key);
    out.push({
      key,
      label: (c.label || (c.meta || {}).label || '').trim() || key,
      thumb: assetUrl(scope, c.name, c.folder),
      kind,
      scope, name: c.name, folder: c.folder || '',
    });
  };
  const p = (app.state.projects || []).find(x => x.id === pid);
  (((p || {}).context || {}).items || []).forEach(c => push(c, pid));
  ((app.state.library || {}).items || []).forEach(c => push(c, 'library'));
  // Ranking is what makes the @-menu useful — it shows only the first handful, so:
  //   1. THIS project's entities before anything from the global library. A menu opened inside
  //      The Last Ferry must lead with its own cast, not another project's stills that happen
  //      to sit in a library cast/ folder.
  //   2. named entities before raw gen-…-14 filenames,
  //   3. people before places before things (talent → location → prop → wardrobe).
  const KIND_ORDER = { talent: 0, location: 1, prop: 2, wardrobe: 3 };
  return out.sort((a, b) =>
    ((a.scope === 'library') - (b.scope === 'library')) ||
    ((a.label === a.key) - (b.label === b.key)) ||
    ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)));
}

// EVERY taggable image, unfiltered — the "＋ Add more" picker's inventory. Same shape as
// buildEntityPool but without the production-kind gate, split by scope so the picker's
// Project ⇄ Global toggle is a straight filter. Entities (kind set) sort first in each scope.
export function buildAssetPool(app, pid) {
  const seen = new Set(); const out = [];
  const push = (c, scope) => {
    if (!(c.type === 'image' || c.type === 'video')) return;
    const key = entityKey(c.name);
    if (seen.has(key)) return; seen.add(key);
    const base = String(c.folder || '').split('/').pop().toLowerCase();
    out.push({
      key,
      label: (c.label || (c.meta || {}).label || '').trim() || key,
      thumb: assetUrl(scope, c.name, c.folder),
      kind: (c.meta || {}).kind || KINDS[base] || null,
      scope, name: c.name, folder: c.folder || '',
    });
  };
  const p = (app.state.projects || []).find(x => x.id === pid);
  (((p || {}).context || {}).items || []).forEach(c => push(c, pid));
  ((app.state.library || {}).items || []).forEach(c => push(c, 'library'));
  return out.sort((a, b) => (!!b.kind - !!a.kind) || ((a.label === a.key) - (b.label === b.key)));
}
