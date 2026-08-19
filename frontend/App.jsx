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
    this.setState({ active: id, selected: null });
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

  // Which documents point AT this one, and through which field. Computed from the rows already
  // loaded rather than a second round trip — the answer is in the relation values we have.
  referencedBy(doc) {
    const { collections, rows, active } = this.state;
    const collection = collections.find(c => c.id === active);
    if (!collection || !doc) return [];
    const out = [];
    for (const f of collection.fields || []) {
      if (f.type !== 'relation') continue;
      for (const r of rows) {
        if (r.path === doc.path) continue;
        const v = [].concat(r.fields[f.key] ?? []).map(String);
        if (v.includes(doc.slug)) out.push({ title: r.title, path: r.path, field: f.key, collection: active });
      }
    }
    return out;
  }

  render() {
    const { collections, counts, active, view, views, viewCounts, rows, selected, section, loading, error } = this.state;
    const collection = collections.find(c => c.id === active) || null;
    const doc = rows.find(r => r.path === selected) || null;

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
              ) : !collection ? (
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
                  collection={collection}
                  view={view}
                  views={views}
                  rows={rows}
                  counts={viewCounts}
                  selected={selected}
                  onSelect={r => this.setState({ selected: r.path })}
                  onOpen={r => this.setState({ selected: r.path })}
                  onPickView={id => this.pickCollection(active, id)}
                />
              ) : null}
          </main>

          <Inspector
            collection={collection}
            doc={doc}
            referencedBy={this.referencedBy(doc)}
            open={section}
            onToggle={id => this.setState({ section: id })}
            onOpen={() => {}}
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
