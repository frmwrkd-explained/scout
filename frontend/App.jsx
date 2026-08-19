// Scout's application shell.
//
// Rail · centre · inspector · status footer. Measurements come from design/Scout.dc.html and are
// recorded in design/EXTRACT.md §3.2 — 210px rail, 302px inspector, 38px footer. Do not re-derive
// them from a screenshot.
//
// The centre pane holds ONE of: a collection view, or a document. That is the design's `isTable` /
// `isDoc` split and it is why there is no third state here.
//
// Deliberately NOT here yet, and the milestone that brings each:
//   the document surface + typed editors   T04
//   HISTORY (the event log)                M2
//   MEMORY group, GOALS, WHAT THEY KNOW    M3
//   ASSISTANTS with real state             M4
//   FILES browser, light mode, whiteboard  M5

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Empty } from './ui';
import Rail from './Rail';
import Inspector from './Inspector';
import TableView from './TableView';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

export default class App extends React.Component {
  state = {
    collections: [], counts: {}, active: null,
    view: null, views: [], viewCounts: {}, rows: [],
    selected: null, section: 'props',
    referencedBy: [], refsFor: null, external: null,
    loading: true, error: null,
  };

  componentDidMount() { this.loadCollections(); }

  async loadCollections() {
    try {
      const { collections } = await api.collections();
      this.setState({ collections, loading: false });
      if (collections.length) await this.pickCollection(collections[0].id);
    } catch (e) {
      this.setState({ loading: false, error: e.message });
    }
  }

  // Every view's count is a real query, not an estimate — the rail and the view strip must never
  // disagree with the table they sit above.
  async pickCollection(id, viewId = null) {
    this.setState({ active: id, selected: null, referencedBy: [], refsFor: null, external: null });
    try {
      const { views } = await api.views(id);
      const results = await Promise.all(views.map(v => api.documents(id, v.id).catch(() => null)));
      const viewCounts = {};
      views.forEach((v, i) => { if (results[i]) viewCounts[v.id] = results[i].rows.length; });
      const wanted = viewId || (this.state.collections.find(c => c.id === id) || {}).default_view || views[0].id;
      const i = Math.max(0, views.findIndex(v => v.id === wanted));
      const chosen = results[i] || results.find(Boolean);
      if (!chosen) return;
      this.setState(s => ({
        views, view: chosen.view, rows: chosen.rows, viewCounts,
        counts: { ...s.counts, [id]: chosen.total },
      }));
    } catch (e) { this.setState({ error: e.message }); }
  }

  // Selecting a row is what loads REFERENCED BY. The count sits on the COLLAPSED header (T05), so
  // it cannot wait for the section to be opened.
  select(path) {
    this.setState({ selected: path });
    this.loadReferences(path);
    this.loadExternal(path);
  }

  // A REFERENCED BY entry can point OUT of the collection on screen — that is the whole point of
  // the section. Its row is then not in `rows`, so the document has to be fetched, or following a
  // reference dead-ends on an empty inspector. Reaching a record you did not have open is Law 8.
  async loadExternal(path) {
    if (!path || this.state.rows.some(r => r.path === path)) return this.setState({ external: null });
    try {
      const d = await api.document(path);
      // shaped like a table row, because that is what the inspector reads
      const doc = { path: d.path, slug: d.slug, title: (d.data && d.data.name) || d.slug, fields: d.data || {}, body: d.content || '' };
      this.setState(st => (st.selected === path ? { external: { ...doc, collection: (d.collections || [])[0] || null } } : null));
    } catch {
      this.setState(st => (st.selected === path ? { external: null } : null));
    }
  }

  // Which documents point AT this one, and through which field.
  //
  // This was computed client-side from the loaded rows of the active collection, which meant a
  // guest referenced by a territory, a learning and a project brief showed NOTHING — none of those
  // three is in the active collection, and two of them are memory objects that are in no collection
  // at all. That is T05's own Demonstrate case, so it had to become a real query.
  async loadReferences(path) {
    if (!path) return this.setState({ referencedBy: [], refsFor: null });
    this.setState({ refsFor: path });
    try {
      const { references } = await api.references(path);
      // The selection may have moved on while this was in flight — a late answer must not
      // overwrite the current one.
      this.setState(s => (s.refsFor === path ? { referencedBy: references } : null));
    } catch {
      this.setState(s => (s.refsFor === path ? { referencedBy: [] } : null));
    }
  }

  render() {
    const { collections, counts, active, view, views, viewCounts, rows, selected, section, referencedBy, external, loading, error } = this.state;
    const activeCollection = collections.find(c => c.id === active) || null;
    // The inspector may be showing a document from ANOTHER collection, followed out of REFERENCED
    // BY. It is then read with THAT document's schema, not whichever one the table happens to be on.
    const outside = external && external.path === selected ? external : null;
    const doc = rows.find(r => r.path === selected) || outside;
    const collection = outside ? (collections.find(c => c.id === outside.collection) || null) : activeCollection;

    return (
      <div style={sx('width:100%;height:100vh;display:flex;flex-direction:column;background:var(--ink);overflow:hidden')}>
        <div style={sx('flex:1;min-height:0;display:flex')}>
          <Rail
            collections={collections}
            counts={counts}
            activeCollection={active}
            onPickCollection={id => this.pickCollection(id)}
          />

          <main style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
            {loading ? null
              : error ? (
                <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
                  <Empty size="page" style={sx('max-width:460px')} title="The workspace did not load" body={error} />
                </div>
              ) : !activeCollection ? (
                <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
                  <Empty
                    size="page"
                    style={sx('max-width:440px')}
                    title="No collections yet"
                    body="A collection is a saved query over the markdown already on disk — not a folder, and not a table you have to fill. The agent proposes one; you approve it on a card."
                  />
                </div>
              ) : view ? (
                <TableView
                  collection={activeCollection}
                  view={view}
                  views={views}
                  rows={rows}
                  counts={viewCounts}
                  selected={selected}
                  onSelect={r => this.select(r.path)}
                  onOpen={r => this.select(r.path)}
                  onPickView={id => this.pickCollection(active, id)}
                />
              ) : null}
          </main>

          <Inspector
            collection={collection}
            doc={doc}
            referencedBy={referencedBy}
            open={section}
            onToggle={id => this.setState({ section: id })}
            onOpen={(_, path) => path && this.select(path)}
          />
        </div>

        <footer style={sx('flex:none;height:38px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 18px;background:var(--surface);border-top:1px solid var(--border)')}>
          <div style={sx('display:flex;align-items:center;gap:11px;min-width:0')}>
            <span style={sx('flex:none;width:7px;height:7px;border-radius:9999px;background:var(--border-3)')} />
            <span style={{ ...mono('font-size:10.5px;font-weight:500'), color: 'var(--fg-faint)' }}>NO ASSISTANTS RUNNING</span>
          </div>
          <span style={{ ...mono('font-size:10px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>SCOUT</span>
        </footer>
      </div>
    );
  }
}
