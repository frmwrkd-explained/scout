// Serializable location ↔ URL hash (Phase 6). One explicit location model, encoded into the URL
// hash so palette deep links, browser/Electron back/forward, and session resume all work. Only real
// navigation state is encoded here — never transient modal booleans.
//
//   { page, projectId, tab, subview, entity: { type, id, scope, folder }, filters, reviewSessionId }

export function encodeLocation(loc) {
  const p = new URLSearchParams();
  if (loc.page && loc.page !== 'home') p.set('page', loc.page);
  if (loc.projectId) p.set('proj', loc.projectId);
  if (loc.tab) p.set('tab', loc.tab);
  if (loc.subview) p.set('sub', loc.subview);
  if (loc.entity && loc.entity.id) {
    p.set('e', loc.entity.type + ':' + loc.entity.id);
    if (loc.entity.scope) p.set('scope', loc.entity.scope);
    if (loc.entity.folder) p.set('folder', loc.entity.folder);
  }
  if (loc.reviewSessionId) p.set('rv', loc.reviewSessionId);
  if (loc.filters) for (const [k, v] of Object.entries(loc.filters)) if (v && v !== 'all') p.set('f_' + k, v);
  const s = p.toString();
  return s ? '#' + s : '#';
}

export function decodeLocation(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const loc = {
    page: p.get('page') || 'home', projectId: p.get('proj') || null,
    tab: p.get('tab') || null, subview: p.get('sub') || null,
    reviewSessionId: p.get('rv') || null, entity: null, filters: {}
  };
  const e = p.get('e');
  if (e) { const i = e.indexOf(':'); loc.entity = { type: e.slice(0, i), id: e.slice(i + 1), scope: p.get('scope') || null, folder: p.get('folder') || null }; }
  for (const [k, v] of p) if (k.startsWith('f_')) loc.filters[k.slice(2)] = v;
  return loc;
}

// Cheap equality so we don't push duplicate history entries.
export function sameLocation(a, b) { return encodeLocation(a) === encodeLocation(b); }
