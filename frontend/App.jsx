// Scout's application shell.
//
// Rail · centre · inspector · activity drawer · status footer. Measurements come from
// design/Scout.dc.html and are recorded in design/EXTRACT.md §3.2 — 210px rail, 302px inspector,
// 38px footer. Do not re-derive them from a screenshot.
//
// This file is ONE thing: a screen router and the data loader the screens share. Every screen is
// its own component and owns its own behaviour. The rule that keeps it that way: a screen never
// reaches for another screen's data, and this file never renders a screen's internals.
//
// The centre pane holds exactly one screen at a time. The inspector rides alongside only the two
// screens that have a "current document" — a collection view and a document — because on TODAY or
// DECIDE there is nothing for it to inspect and an empty 302px column is just a narrower window.
//
// Screen keys are the list in docs/08_MODULE_CONTRACTS.md §10.

import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Empty } from './ui';
import { initTheme } from './theme';

import Rail from './Rail';
import Inspector from './Inspector';
import Activity from './Activity';
import CollectionView from './CollectionView';
import Document from './Document';
import Today from './Today';
import Decide from './Decide';
import Memory from './Memory';
import Goals from './Goals';
import Territory from './Territory';
import WhatTheyKnow from './WhatTheyKnow';
import Assistants from './Assistants';
import Hire from './Hire';
import Project from './Project';
import Files from './Files';
import Whiteboard from './Whiteboard';
import Interview from './Interview';

const HUMAN = 'crystal';   // the UI is never an agent. Law 4 reads the actor, so this is load-bearing.

export default class App extends React.Component {
  state = {
    screen: 'today',          // she opens at 9am and three lines tell her where she is (GOAL §3)
    collections: [], counts: {}, active: null,   // active COLLECTION id — nothing else goes in here
    activeAssistant: null,
    view: null, views: [], viewCounts: {}, rows: [], quarantined: [],
    selected: null, docPath: null, section: 'props',
    referencedBy: [], refsFor: null, external: null,
    assistants: [], memoryCounts: {}, needsYou: 0, project: null, projects: [],
    activityOpen: false, nonce: 0, refreshKey: 0, findings: null,
    firstRun: false,
    loading: true, error: null, toast: null,
  };

  componentDidMount() {
    // initTheme(), NOT applyTheme(). applyTheme only paints once; initTheme also binds the
    // `prefers-color-scheme` listener that keeps the app following the OS while the preference is
    // 'system', and owns the ⌥⌘L chord. Calling applyTheme here left the app frozen at whatever
    // the OS happened to be at first paint, and a second ⌥⌘L binding in this file would have
    // toggled twice and changed nothing.
    initTheme();
    this.boot();
  }

  async boot() {
    // Law 9 — the workspace is built WITH the person. A brand-new install has no `me.md` and no
    // collections, and putting an empty table in front of someone is how a tool teaches them it is
    // not for them. The interview owns the whole window until it is done; it is not a screen in
    // the rail, because there is nothing to navigate to yet.
    try {
      const st = await api.intake();
      if (st && st.firstRun) return this.setState({ firstRun: true, loading: false });
    } catch { /* the route is optional — an older workspace just goes straight in */ }
    try {
      const { collections } = await api.collections();
      this.setState({ collections, loading: false });
      // Every collection's count, not just the open one. The rail showed `#guest ·` beside
      // `#group 8` because only the collection being opened ever reported a total — a rail that
      // half-knows its own numbers reads as broken before anything else has a chance to.
      Promise.all(collections.map(c => api.documents(c.id).then(r => [c.id, r.total]).catch(() => null)))
        .then(pairs => this.setState(st => ({
          counts: { ...st.counts, ...Object.fromEntries(pairs.filter(Boolean)) },
        })));
      // Stay where the person is standing. `boot()` runs again after a schema change (adding a
      // property re-reads the collections), and jumping to collections[0] there yanked them off
      // #guest onto #group mid-edit — the document surface then read a guest through the group
      // schema, so the collapsed row showed `members` and `swept` on a person. Only a first boot,
      // or an active collection that no longer exists, falls back to the first one.
      const here = this.state.active && collections.some(c => c.id === this.state.active)
        ? this.state.active
        : (collections[0] && collections[0].id);
      if (here) await this.pickCollection(here, this.state.view && this.state.view.id, { navigate: false });
    } catch (e) {
      this.setState({ loading: false, error: e.message });
    }
    this.loadSidebar();
  }

  // Everything the RAIL needs, and nothing else. It is one pass rather than five screens each
  // fetching their own counts, because the rail is on screen the entire session and a count that
  // disagrees with the screen beside it destroys trust in both.
  loadSidebar = async () => {
    const [assistants, goals, territory, playbook, proposals, projects] = await Promise.all([
      api.assistants().catch(() => ({ assistants: [] })),
      api.goals().catch(() => ({ goals: [] })),
      api.territory().catch(() => ({ territory: [] })),
      api.playbook().catch(() => ({ playbook: [] })),
      api.proposals('open').catch(() => ({ proposals: [] })),
      api.scoutProjects().catch(() => ({ projects: [] })),
    ]);
    const list = projects.projects || [];
    const pid = this.state.project || (list[0] && list[0].id) || null;
    if (pid) api.findings(pid).then(r => this.setState({ findings: r.findings || [] })).catch(() => {});
    this.setState(s => ({
      assistants: assistants.assistants || [],
      memoryCounts: {
        goals: (goals.goals || []).length,
        territory: (territory.territory || []).length,
        playbook: (playbook.playbook || []).length,
      },
      needsYou: (proposals.proposals || []).length,
      projects: list,
      project: s.project || (list[0] && list[0].id) || null,
    }));
  };

  // ── navigation ─────────────────────────────────────────────────────────────────────────────
  go = (screen, arg) => {
    if (screen === 'newCollection') return this.setState({ screen: 'decide', toast: 'A new collection is a proposal — it arrives here as a card.' });
    // Its OWN key. Putting an assistant id in `active` blanked the collection screen, because
    // `activeCollection` is looked up from the same field.
    if (screen === 'assistant') return this.setState({ screen: 'assistants', activeAssistant: arg });
    this.setState({ screen, ...(arg ? { arg } : {}) });
  };

  // A path is the app's one address for a thing on disk. Opening one always lands on the document
  // surface — including for a territory or a playbook claim, which have no collection and are read
  // straight from their frontmatter. That is why Law 8 costs two clicks everywhere and not five.
  openPath = path => {
    if (!path) return;
    // A `.md` opens on the document surface — that is Law 8's two clicks, and it is the same
    // surface for a record, a territory and a playbook claim. Anything else (a screenshot, a PDF)
    // has no frontmatter to render, so it goes to the file browser instead of an empty editor.
    if (!String(path).endsWith('.md')) return this.setState({ screen: 'files', arg: path });
    this.setState({ screen: 'document', docPath: path, selected: path, section: 'props' });
    this.loadReferences(path);
    this.loadExternal(path);
  };

  openRelation = (collection, id) => {
    if (!id) return;
    if (String(id).endsWith('.md')) return this.openPath(String(id));
    const row = this.state.rows.find(r => r.slug === id);
    if (row) return this.openPath(row.path);
    // A relation names a slug, not a path. Ask the collection that owns it where that slug lives
    // rather than guessing a folder — a guessed path is how a link silently dead-ends.
    if (collection) {
      api.allDocuments(collection).then(r => {
        const hit = (r.rows || []).find(x => x.slug === id);
        if (hit) this.openPath(hit.path);
        else this.setState({ toast: 'Nothing called "' + id + '" in #' + collection + ' yet.' });
      }).catch(() => this.setState({ toast: 'Could not follow that link.' }));
      return;
    }
    // No target collection named — look for the slug anywhere before giving up, because a memory
    // object (a territory, a playbook claim) is in no collection at all and is exactly the kind of
    // thing a relation points at.
    api.collections().then(({ collections }) => Promise.all(
      collections.map(c => api.allDocuments(c.id).then(r => (r.rows || []).find(x => x.slug === id)).catch(() => null)),
    )).then(hits => {
      const hit = hits.find(Boolean);
      if (hit) this.openPath(hit.path);
      else this.setState({ toast: 'Nothing called "' + id + '" here yet.' });
    }).catch(() => this.setState({ toast: 'Could not follow that link.' }));
  };

  // ── collections ────────────────────────────────────────────────────────────────────────────
  // Every view's count is a real query, not an estimate — the rail and the view strip must never
  // disagree with the table they sit above.
  async pickCollection(id, viewId = null, { navigate = true } = {}) {
    this.setState(s => ({
      active: id, selected: null, referencedBy: [], refsFor: null, external: null,
      screen: navigate ? 'collection' : s.screen,
    }));
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
        quarantined: chosen.quarantined || [],
        counts: { ...s.counts, [id]: chosen.total },
      }));
    } catch (e) { this.setState({ error: e.message }); }
  }

  // A view is data in the vault (docs/02_DATA_MODEL.md §3), so changing its shape, its density or
  // its filters is a WRITE — one route, `PUT /api/views/:collection`, whether the change came from
  // this bar, from an agent, or from someone editing the JSON in Obsidian. There is no
  // second, session-local notion of "how I like this collection", because two people looking at
  // one collection and seeing different screens is worse than either screen.
  saveView = async v => {
    const id = this.state.active;
    if (!id) return;
    try {
      await api.saveView(id, v);
      await this.pickCollection(id, v.id, { navigate: false });
    } catch (e) { this.setState({ toast: e.message }); throw e; }
  };

  deleteView = async viewId => {
    const id = this.state.active;
    if (!id) return;
    try {
      const { views } = await api.deleteView(id, viewId);
      // Never leave the screen pointing at a view that no longer exists.
      await this.pickCollection(id, (views[0] && views[0].id) || null, { navigate: false });
      this.setState({ toast: 'View removed. The records are untouched — a view is only a saved query.' });
    } catch (e) { this.setState({ toast: e.message }); }
  };

  // PROJECT's one solid accent fill. Scout does not own the agent process (04_AGENT_CONTRACT §1),
  // so "put the team to work" means: open every task that is not claimed or done, and let whichever
  // door the assistants come through pick them up. If nothing is waiting, say so rather than
  // flashing a success state over a queue that was already empty.
  putTeamToWork = async () => {
    const { tasks } = await api.tasks({ project: this.state.project || '' }).catch(() => ({ tasks: [] }));
    const blocked = (tasks || []).filter(t => t.status === 'blocked' && !t.needs_human);
    if (!blocked.length) {
      const open = (tasks || []).filter(t => t.status === 'open').length;
      return this.setState({
        toast: open
          ? open + ' task' + (open === 1 ? '' : 's') + ' waiting. Your assistants pick them up on their own schedule — nothing to push.'
          : 'The queue is empty. Add a task and whoever is free takes it.',
      });
    }
    await Promise.all(blocked.map(t => api.patchTask(t.id, { status: 'open' }, t.project, HUMAN).catch(() => null)));
    this.setState({ toast: 'Put ' + blocked.length + ' back in the queue.' });
    this.reload();
  };

  reload = () => {
    if (this.state.active) this.pickCollection(this.state.active, this.state.view && this.state.view.id, { navigate: false });
    this.loadSidebar();
    this.setState(s => ({ nonce: s.nonce + 1, refreshKey: s.refreshKey + 1 }));
  };

  // Dragging a card between board columns is a promotion, and a promotion goes through the gate
  // like every other one. The board does not re-bucket optimistically: if the route refuses, the
  // card must not have appeared to move.
  onMove = async (row, to) => {
    try {
      await api.moveRecord(row.path, to, HUMAN);
      this.reload();
    } catch (e) {
      this.setState({ toast: e.message });
    }
  };

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
      const doc = { path: d.path, slug: d.slug, title: (d.data && d.data.name) || d.slug, fields: d.data || {}, body: d.content || '' };
      this.setState(st => (st.selected === path ? { external: { ...doc, collection: (d.collections || [])[0] || null } } : null));
    } catch {
      this.setState(st => (st.selected === path ? { external: null } : null));
    }
  }

  // Which documents point AT this one, and through which field. A real backend query, because it
  // crosses collections and reaches memory objects that are in no collection at all.
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

  // ── the centre pane ────────────────────────────────────────────────────────────────────────
  centre() {
    const {
      screen, collections, active, view, views, viewCounts, rows, quarantined, selected, docPath,
      assistants, project, nonce, refreshKey, loading, error,
    } = this.state;
    const activeCollection = collections.find(c => c.id === active) || null;
    const pad = 'flex:1;display:flex;align-items:center;justify-content:center;padding:40px';

    if (loading) return null;
    if (error && screen === 'collection') {
      return <div style={sx(pad)}><Empty size="page" style={sx('max-width:460px')} title="The workspace did not load" body={error} /></div>;
    }

    switch (screen) {
      case 'today':
        return <Today onGo={this.go} onOpenPath={this.openPath} refreshKey={refreshKey} actor={HUMAN} />;

      case 'decide':
        return (
          <Decide
            actor={HUMAN}
            onExit={() => this.go('today')}
            onOpenPath={this.openPath}
            onDecided={this.reload}
            onCount={n => this.setState({ needsYou: n })}
          />
        );

      case 'project':
        return (
          <Project
            project={project} actor={HUMAN}
            findings={this.state.findings}
            onRun={this.putTeamToWork}
            onDecide={() => this.go('decide')}
            onOpenPath={this.openPath}
            onOpenCollection={id => this.pickCollection(id)}
            onOpenAssistants={() => this.go('assistants')}
          />
        );

      case 'goals':      return <Goals onOpenPath={this.openPath} onWrote={this.reload} />;
      case 'territory':  return <Territory onOpenPath={this.openPath} onWrote={this.reload} />;
      case 'playbook':
      case 'memory':     return <Memory onOpenPath={this.openPath} onWrote={this.reload} />;
      case 'knows':      return <WhatTheyKnow onOpenPath={this.openPath} project={project} refreshKey={refreshKey} />;

      case 'assistants':
        return (
          <Assistants
            assistants={assistants} nonce={nonce}
            onHire={() => this.go('hire')}
            onSelect={id => this.setState({ activeAssistant: id })}
            onDecide={() => this.go('decide')}
            onOpenPath={this.openPath}
          />
        );

      case 'hire':
        return (
          <Hire
            assistants={assistants} actor={HUMAN}
            onHired={() => { this.loadSidebar(); this.go('assistants'); }}
            onCancel={() => this.go('assistants')}
            onOpenPath={this.openPath}
          />
        );

      case 'files':  return <Files path={this.state.arg || docPath || ''} onOpenPath={this.openPath} />;
      case 'board':
        // Whiteboard's own PROPS block names `board` / `onOpenDocument` / `onToast` — it was being
        // handed `project` / `onOpenPath` / `onOpen`, so `board` was undefined and `boardId()` fell
        // back to 'main': EVERY project shared one board. `onOpenDocument` missing meant no card
        // had a way down to its record (Law 8), and `onToast` missing made the 409 "your move was
        // not saved" a no-op — the drag was discarded in silence.
        return (
          <Whiteboard
            board={project || 'main'}
            onOpenDocument={this.openPath}
            onToast={(message) => this.setState({ toast: message })}
          />
        );

      case 'document':
        return (
          <Document
            path={docPath}
            collection={activeCollection}
            collections={collections}
            actor={HUMAN}
            onOpen={this.openRelation}
            onOpenPath={this.openPath}
            onSaved={this.reload}
            onBack={() => this.go('collection')}
            // Presence says adding is allowed; the composer itself lives in the property list.
            onFieldAdded={activeCollection ? f => {
              this.setState({ toast: '"' + f.key + '" is on every #' + activeCollection.id + ' from now on.' });
              this.boot();
            } : undefined}
            // Law 5: archived, never deleted, and never without a reason — the surface collects
            // one and `records.mjs` refuses the write if it somehow arrives without. Afterwards
            // the record is no longer where the person is standing, so this leaves the surface
            // instead of holding them on a document that has moved.
            onArchived={({ reason }) => {
              this.setState({ screen: 'collection', docPath: null, selected: null, toast: 'Archived as "' + reason + '". It is still on disk, with the reason attached.' });
              if (active) this.pickCollection(active, view?.id, { navigate: false });
              this.reload();
            }}
          />
        );

      case 'collection':
      default:
        if (!activeCollection) {
          return (
            <div style={sx(pad)}>
              <Empty
                size="page" style={sx('max-width:440px')}
                title="No collections yet"
                body="A collection is a saved query over the markdown already on disk — not a folder, and not a table you have to fill. The agent proposes one; you approve it on a card."
              />
            </div>
          );
        }
        if (!view) return null;
        return (
          <CollectionView
            collection={activeCollection} view={view} views={views} rows={rows} counts={viewCounts}
            quarantined={quarantined}
            selected={selected}
            onSelect={r => this.select(r.path)}
            // Two different actions, two different names. `onOpen(row)` opens a record; `onFollow`
            // takes a collection and a slug and follows a relation chip. They were one prop with
            // two signatures, and the row handler won — so every relation chip in the app looked
            // clickable and did nothing.
            onOpen={r => this.openPath(r.path)}
            onFollow={this.openRelation}
            onPickView={id => this.pickCollection(active, id, { navigate: false })}
            onSaveView={this.saveView}
            onDeleteView={this.deleteView}
            onMove={this.onMove}
          />
        );
    }
  }

  render() {
    const {
      screen, collections, counts, active, rows, selected, section, referencedBy, external,
      assistants, memoryCounts, needsYou, project, projects, activityOpen, toast,
    } = this.state;

    const activeCollection = collections.find(c => c.id === active) || null;
    // The inspector may be showing a document from ANOTHER collection, followed out of REFERENCED
    // BY. It is then read with THAT document's schema, not whichever one the table happens to be on.
    const outside = external && external.path === selected ? external : null;
    const doc = rows.find(r => r.path === selected) || outside;
    const collection = outside ? (collections.find(c => c.id === outside.collection) || null) : activeCollection;
    const withInspector = screen === 'collection' || screen === 'document';
    const running = assistants.filter(a => a.status === 'running');

    if (this.state.firstRun) {
      return (
        <div style={sx('width:100%;height:100vh;background:var(--ink);overflow:auto')}>
          <Interview
            actor={HUMAN}
            onOpenPath={this.openPath}
            onDone={() => this.setState({ firstRun: false, screen: 'decide' }, () => this.boot())}
          />
        </div>
      );
    }

    return (
      <div style={sx('width:100%;height:100vh;display:flex;flex-direction:column;background:var(--ink);overflow:hidden')}>
        <div style={sx('flex:1;min-height:0;display:flex')}>
          <Rail
            screen={screen}
            onNavigate={this.go}
            collections={collections}
            counts={counts}
            activeCollection={active}
            onPickCollection={id => this.pickCollection(id)}
            assistants={assistants}
            activeAssistant={this.state.activeAssistant}
            memoryCounts={memoryCounts}
            needsYou={needsYou}
            project={project}
            projects={projects}
            onPickProject={id => this.setState({ project: id, screen: 'project' })}
          />

          <main style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;position:relative')}>
            {this.centre()}
            {/* One line, bottom-centre, self-clearing. A refusal is the most important thing this
                app ever says to the person, and it must not require dismissing a modal. */}
            {/* A field is a schema change. An AGENT proposing one lands a card in DECIDE
                (docs/02_DATA_MODEL.md §6); the human IS the disposer, so hers is created. Both
                paths end in the same schema writer, which is why there is only one of them.
                The composer used to be mounted HERE, as a dialog over a dimmed page. It is now a
                row inside the property list it edits (Document.jsx → AddField.jsx). */}
            {toast ? (
              <button type="button" onClick={() => this.setState({ toast: null })}
                style={sx('position:absolute;left:50%;bottom:18px;transform:translateX(-50%);max-width:520px;padding:9px 14px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-3);color:var(--fg-soft);font-size:12px;cursor:pointer;text-align:left;box-shadow:0 12px 32px rgba(0,0,0,.45)')}>
                {toast}
              </button>
            ) : null}
          </main>

          {withInspector ? (
            <Inspector
              collection={collection}
              doc={doc}
              referencedBy={referencedBy}
              open={section}
              onToggle={id => this.setState({ section: id })}
              // eslint-disable-next-line -- see openRelation: the inspector's chips hand back a
              // TARGET and an ID, not a path (the same contract the table's cells use). Treating
              // the id as a path sent `nurses-ph` to the file browser instead of the territory.
              onOpen={this.openRelation}
              onOpenPath={this.openPath}
              onOpenBoard={() => this.go('board')}
            />
          ) : null}
        </div>

        <Activity
          open={activityOpen}
          onToggle={() => this.setState(s => ({ activityOpen: !s.activityOpen }))}
          onOpenPath={this.openPath}
          running={running}
        />
      </div>
    );
  }
}
