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
import { createWorkClock } from './workClock';

import Rail from './Rail';
import Inspector from './Inspector';
import Activity from './Activity';
import Palette from './Palette';
// The new Scout-native settings screen — NOT frontend/Settings.jsx, which is FrameForge's and is
// deleted (item D). Its theme radio and key input are ported here; the name is deliberately
// different so a later cleanup pass can never confuse the two.
import ScoutSettings from './ScoutSettings';
import CollectionView from './CollectionView';
import Document from './Document';
import Today from './Today';
import Admin from './Admin';
import Paperclip from './Paperclip';
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

// How often to look, while an assistant is out. Long enough that a machine with four agents
// sweeping is not also re-reading its own rail ten times a second; short enough that "it came
// home" arrives while she is still looking at the card.
const RUN_POLL_MS = 3000;

// A 503 from the dispatcher means no agent CLI is connected. That is a setup step, not a defect,
// and saying so is the difference between "this app is broken" and "connect one and press again".
const setupToast = e =>
  (e && e.body && e.body.setup) ? e.message + ' You can also work through _inbox/ or MCP.' : (e && e.message) || 'Something went wrong.';

export default class App extends React.Component {
  state = {
    screen: 'today',          // she opens at 9am and three lines tell her where she is (GOAL §3)
    collections: [], counts: {}, active: null,   // active COLLECTION id — nothing else goes in here
    activeAssistant: null,
    view: null, views: [], viewCounts: {}, rows: [], quarantined: [],
    selected: null, docPath: null, docExpanded: false, section: 'props',
    referencedBy: [], refsFor: null, external: null,
    assistants: [], memoryCounts: {}, needsYou: 0, project: null, projects: [],
    activityOpen: false, nonce: 0, refreshKey: 0, findings: null,
    firstRun: false, paletteOpen: false, storageRoot: null,
    loading: true, error: null, toast: null, toastDanger: false,
  };

  componentDidMount() {
    // initTheme(), NOT applyTheme(). applyTheme only paints once; initTheme also binds the
    // `prefers-color-scheme` listener that keeps the app following the OS while the preference is
    // 'system', and owns the ⌥⌘L chord. Calling applyTheme here left the app frozen at whatever
    // the OS happened to be at first paint, and a second ⌥⌘L binding in this file would have
    // toggled twice and changed nothing.
    initTheme();
    this.workClock = createWorkClock({
      pause: () => api.todayPause(),
      resume: () => api.todayResume(),
      onChanged: () => this.setState(s => ({ refreshKey: s.refreshKey + 1 })),
      onError: (_error, action) => this.showToast('Could not ' + action + ' the work timer. Scout will retry.'),
    });
    this.boot();
    this.watchRuns();
    window.addEventListener('keydown', this.onGlobalKey);
  }

  componentWillUnmount() {
    this.workClock?.dispose();
    clearInterval(this.runWatch);
    window.removeEventListener('keydown', this.onGlobalKey);
    clearTimeout(this._toastTimer);
  }

  componentDidUpdate(_props, previous) {
    if (previous.storageRoot !== this.state.storageRoot) this.workClock?.reset();
  }

  // Stable for one workspace, so Today's loader does not restart on each render. A loader
  // from the previous workspace can still resolve after navigation; its callbacks are inert.
  getWorkClockCallbacks = () => {
    const root = this.state.storageRoot;
    if (this._clockCallbacks?.root === root) return this._clockCallbacks.props;
    const callbacks = { root };
    const current = () => this._clockCallbacks === callbacks && this.state.storageRoot === root;
    callbacks.props = {
      onWorkClockState: today => { if (current()) this.workClock?.update(today); },
      onWorkClockBusy: value => { if (current()) this.workClock?.setBusy(value); },
      onWorkClockIntent: action => { if (current()) this.workClock?.manualAction(action); },
    };
    this._clockCallbacks = callbacks;
    return callbacks.props;
  };
  onStorageRootChanged = storageRoot => {
    // The server has already switched roots. Stop using the old snapshot immediately,
    // including the interval before React commits the storageRoot state change.
    this.workClock?.reset();
    this._clockCallbacks = null;
    this.setState({ storageRoot }, () => this.boot());
  };

  // ── while anybody is out ───────────────────────────────────────────────────────────────────
  // A run answers before it finishes — that is the design (backend/dispatch.mjs) — so the card that
  // says WORKING has to find out when it stops. Without this it says WORKING until you navigate
  // away and back: the person presses Send out, watches a state that never resolves, and concludes
  // the button did nothing. That is the same failure as a capability with no affordance, one step
  // later in the story.
  //
  // Cheap by construction: it only ticks while an assistant is actually out, and it stops on the
  // pass that finds nobody. `loadSidebar()` is one batch of six reads the rail is already doing.
  watchRuns = () => {
    clearInterval(this.runWatch);
    this.runWatch = setInterval(() => {
      if (!(this.state.assistants || []).some(a => String(a.status) === 'running')) return;
      this.loadSidebar();
      // BOTH keys. `nonce` is what the rail and ASSISTANTS re-read on; `refreshKey` is what TODAY
      // re-reads on. Bumping only the first left the 9am screen — the one with the button on it —
      // showing four assistants RUNNING beside a rail that had already noticed they were home.
      this.setState(s => ({ nonce: s.nonce + 1, refreshKey: s.refreshKey + 1 }));
    }, RUN_POLL_MS);
  };

  // ⌘K everywhere — the palette is a screen-independent overlay, not a route.
  onGlobalKey = e => {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      this.setState(s => ({ paletteOpen: !s.paletteOpen }));
    }
  };

  // The app's one toast channel (item 9 — VoiceInput and Interview call this as `app.showToast`).
  // `tone` is either a semantic word ('danger') or one of the CSS-var strings VoiceInput already
  // sends ('var(--danger)', 'var(--warn)'); only danger sticks — a refusal is the important kind
  // of toast and must not vanish while she is still reading it. Everything else clears itself
  // after 8s AND whenever she navigates (go()/openPath()), so a stale confirmation does not sit
  // over the next screen she opens.
  showToast = (message, tone) => {
    const danger = tone === 'danger' || tone === 'var(--danger)';
    clearTimeout(this._toastTimer);
    this.setState({ toast: message, toastDanger: danger });
    if (!danger) {
      this._toastTimer = setTimeout(() => {
        this.setState(s => (s.toast === message ? { toast: null, toastDanger: false } : null));
      }, 8000);
    }
  };
  clearToast = () => { clearTimeout(this._toastTimer); this.setState({ toast: null, toastDanger: false }); };

  async boot() {
    try {
      const workspace = await api.state();
      this.setState({ storageRoot: workspace.storageRoot ?? null });
    } catch { /* older backends may not expose their storage root */ }
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
    this.clearToast();
    if (screen === 'newCollection') { this.showToast('A new collection is a proposal — it arrives here as a card.'); return this.setState({ screen: 'decide' }); }
    // Its OWN key. Putting an assistant id in `active` blanked the collection screen, because
    // `activeCollection` is looked up from the same field.
    if (screen === 'assistant') return this.setState({ screen: 'assistants', activeAssistant: arg });
    // `arg` always lands, cleared or set — a stale one from the last screen otherwise rides along
    // silently. `arg ?? null`, not `arg || null`: a falsy-but-real argument (an empty-string path,
    // a 0) must still overwrite what was there, never fall through to the same default.
    this.setState({ screen, arg: arg ?? null });
  };

  // A path is the app's one address for a thing on disk. Opening one always lands on the document
  // surface — including for a territory or a playbook claim, which have no collection and are read
  // straight from their frontmatter. That is why Law 8 costs two clicks everywhere and not five.
  openPath = (path, options = {}) => {
    if (!path) return;
    this.clearToast();
    // A `.md` opens on the document surface — that is Law 8's two clicks, and it is the same
    // surface for a record, a territory and a playbook claim. Anything else (a screenshot, a PDF)
    // has no frontmatter to render, so it goes to the file browser instead of an empty editor.
    if (!String(path).endsWith('.md')) return this.setState({ screen: 'files', arg: path });
    // `arg` cleared here too, not only in go() — a stale one from wherever she was standing
    // (a re-brief target, a board placement) must not survive onto the document screen.
    this.setState({ screen: 'document', docPath: path, docExpanded: !!options.expanded, selected: path, section: 'props', arg: null });
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
        else this.showToast('Nothing called "' + id + '" in #' + collection + ' yet.');
      }).catch(() => this.showToast('Could not follow that link.'));
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
      else this.showToast('Nothing called "' + id + '" here yet.');
    }).catch(() => this.showToast('Could not follow that link.'));
  };

  // ── collections ────────────────────────────────────────────────────────────────────────────
  // Every view's count is a real query, not an estimate — the rail and the view strip must never
  // disagree with the table they sit above.
  //
  // `keepSelection` is for an IN-PLACE refresh (reload(), a board drag) rather than a navigation —
  // the inspector must not go blank because a refresh happened to run. The selection is then
  // re-resolved against the rows that actually came back: still there → kept; gone (archived,
  // filtered out by the view) → cleared, because showing a document the view no longer holds is
  // worse than showing nothing.
  async pickCollection(id, viewId = null, { navigate = true, keepSelection = false } = {}) {
    this.setState(s => ({
      active: id,
      ...(keepSelection ? {} : { selected: null, referencedBy: [], refsFor: null, external: null }),
      screen: navigate ? 'collection' : s.screen,
    }));
    try {
      // `warnings` names a `default_view` that points at nothing — silently falling back to
      // index 0 is how #guest opened as a board called "Everything" for a whole build.
      const { views, warnings } = await api.views(id);
      if (warnings && warnings.length) this.showToast(warnings[0]);
      const results = await Promise.all(views.map(v => api.documents(id, v.id).catch(() => null)));
      const viewCounts = {};
      views.forEach((v, i) => { if (results[i]) viewCounts[v.id] = results[i].rows.length; });
      const wanted = viewId || (this.state.collections.find(c => c.id === id) || {}).default_view || views[0].id;
      const i = Math.max(0, views.findIndex(v => v.id === wanted));
      const chosen = results[i] || results.find(Boolean);
      if (!chosen) return;
      this.setState(s => {
        const stillThere = keepSelection && s.selected && chosen.rows.some(r => r.path === s.selected);
        return {
          views, view: chosen.view, rows: chosen.rows, viewCounts,
          quarantined: chosen.quarantined || [],
          counts: { ...s.counts, [id]: chosen.total },
          ...(keepSelection && !stillThere ? { selected: null, referencedBy: [], refsFor: null, external: null } : {}),
        };
      });
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
      await this.pickCollection(id, v.id, { navigate: false, keepSelection: true });
    } catch (e) { this.showToast(e.message, 'danger'); throw e; }
  };

  deleteView = async viewId => {
    const id = this.state.active;
    if (!id) return;
    try {
      const { views } = await api.deleteView(id, viewId);
      // Never leave the screen pointing at a view that no longer exists.
      await this.pickCollection(id, (views[0] && views[0].id) || null, { navigate: false, keepSelection: true });
      this.showToast('View removed. The records are untouched — a view is only a saved query.');
    } catch (e) { this.showToast(e.message, 'danger'); }
  };

  // TODAY and PROJECT's one solid accent fill, and one honest label between them. Scout does not
  // own the agent process (04_AGENT_CONTRACT §1) — there is no "runner" to dispatch — so this is
  // exactly what it says: reopen every task that is not claimed or done, and let whichever door
  // the assistants come through pick them up on their own schedule. If nothing is waiting, say so
  // rather than flashing a success state over a queue that was already empty.
  putTeamToWork = async () => {
    const { tasks } = await api.tasks({ project: this.state.project || '' }).catch(() => ({ tasks: [] }));
    const blocked = (tasks || []).filter(t => t.status === 'blocked' && !t.needs_human);
    if (!blocked.length) {
      const open = (tasks || []).filter(t => t.status === 'open').length;
      this.showToast(open
        ? open + ' task' + (open === 1 ? '' : 's') + ' waiting. Your assistants pick them up on their own schedule — nothing to push.'
        : 'The queue is empty. Add a task and whoever is free takes it.');
      return;
    }
    await Promise.all(blocked.map(t => api.patchTask(t.id, { status: 'open' }, t.project, HUMAN).catch(() => null)));
    this.showToast('Put ' + blocked.length + ' back in the queue.');
    this.reload();
  };

  // A refresh, never a navigation — the inspector stays put unless the row it is showing is
  // actually gone (see pickCollection's `keepSelection`).
  reload = () => {
    if (this.state.active) this.pickCollection(this.state.active, this.state.view && this.state.view.id, { navigate: false, keepSelection: true });
    this.loadSidebar();
    this.setState(s => ({ nonce: s.nonce + 1, refreshKey: s.refreshKey + 1 }));
  };

  // ── the one button (GOAL §3) ───────────────────────────────────────────────────────────────
  // Both of these ANSWER before the work is finished — the route returns the running record, the
  // screens poll api.runs() for the rest. They never rethrow: TODAY's button awaits this handler,
  // and a rejection there is an unhandled promise, not an error message.
  //
  // A 503 is not a failure, it is a missing connection: doors 2 and 3 need no local CLI, so the
  // toast says where to fix it rather than reading like the feature is broken.
  sendOutAll = async () => {
    try {
      const r = await api.sendOutAll(HUMAN);
      const out = (r.started || []).length;
      const held = (r.skipped || []).length;
      this.showToast(out
        ? out + (out === 1 ? ' assistant is out.' : ' assistants are out.') + ' What they find lands in the queue.'
        : held ? 'They are already out.' : 'Nobody is hired yet — hire an assistant first.');
      this.reload();
    } catch (e) { this.showToast(setupToast(e), 'danger'); }
  };

  sendOutOne = async id => {
    // Her name for it, not its id. `run.assistant` is the slug, and "scout-fb is out" is the app
    // talking about a file where she is talking about a colleague she hired.
    const who = (this.state.assistants || []).find(a => String(a.id) === String(id));
    const name = (who && who.name) || id;
    try {
      await api.sendOut(id, HUMAN);
      this.showToast(name + ' is out. What it finds lands in the queue.');
      this.reload();
    } catch (e) { this.showToast(setupToast(e), 'danger'); }
  };

  // Dragging a card between board columns is a promotion, and a promotion goes through the gate
  // like every other one. The board does not re-bucket optimistically: if the route refuses, the
  // card must not have appeared to move.
  // Accept a quarantined record — the one thing a human can do about a file an agent wrote around
  // the pipeline (Law 4). No try/catch on purpose: a refusal propagates to the strip in
  // CollectionView, which shows the server's own reason beside the specific record (Law 8).
  onAccept = async path => {
    await api.acceptRecord(path, HUMAN);
    this.reload();
  };

  onMove = async (row, to) => {
    try {
      await api.moveRecord(row.path, to, HUMAN);
      this.reload();
    } catch (e) {
      // The important kind of toast (Law 4's gate, most of the time this fires) — click-to-dismiss,
      // not a timer, so a refusal cannot vanish before she has read it.
      this.showToast(e.message, 'danger');
    }
  };

  // The light path an autosave takes. Document.jsx's `onSaved` fires after every accepted PATCH
  // with exactly the response it already has ({ path, data, content }) — there is no second read
  // here. It patches the ONE row in `rows` (so the table she is not even looking at stays honest
  // without a re-fetch) and the ONE external doc the inspector may be showing, and stops there:
  // ~10 GETs on every keystroke-driven save was reload()'s whole cost, and nothing about typing in
  // a field is structural. Archive, move, a schema change and a decision still call reload() —
  // those really do change which rows exist or which view they belong to.
  onDocSaved = ({ path, data, content }) => {
    this.setState(s => {
      const activeCollection = s.collections.find(c => c.id === s.active);
      const primary = activeCollection && (activeCollection.fields || []).find(f => f.primary);
      const title = (primary && data && data[primary.key]) || (data && data.name) || (data && data.title);
      return {
        rows: s.rows.map(r => (r.path === path ? { ...r, fields: data, ...(title ? { title } : {}) } : r)),
        external: s.external && s.external.path === path ? { ...s.external, fields: data, body: content } : s.external,
      };
    });
  };

  // Both PROJECT and ASSISTANTS hand back the same subject shape from a blocked task or a blocked
  // assistant's "Answer it" — `{ kind, id, path, question, task, assistant }` (frontend/Project.jsx
  // and frontend/Assistants.jsx doc comments). Landing on 'decide' with no argument dropped it, so
  // the button opened the queue at whatever card happened to be first rather than the question she
  // clicked. `backend/tasks.mjs pullIntoDecide` names a blocked task's card deterministically —
  // `'task-' + project + '-' + id` — so a task subject resolves to the real card id without a new
  // route; an assistant with no specific task falls back to its own id, which at worst finds
  // nothing and opens the queue at its first card, same as before this fix.
  onDecideSubject = subject => {
    const focus = subject && subject.kind === 'task' && subject.task
      ? 'task-' + subject.task.project + '-' + subject.task.id
      : (subject && subject.id) || null;
    this.go('decide', focus);
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
      assistants, activeAssistant, project, nonce, refreshKey, loading, error, arg,
    } = this.state;
    const activeCollection = collections.find(c => c.id === active) || null;
    const pad = 'flex:1;display:flex;align-items:center;justify-content:center;padding:40px';

    if (loading) return null;
    if (error && screen === 'collection') {
      return <div style={sx(pad)}><Empty size="page" style={sx('max-width:460px')} title="The workspace did not load" body={error} /></div>;
    }

    switch (screen) {
      case 'today':
        return <Today onGo={this.go} onOpenPath={this.openPath} onWrote={this.reload} refreshKey={refreshKey} actor={HUMAN} onSendOut={this.sendOutAll}
          {...this.getWorkClockCallbacks()} />;

      case 'admin':
        return <Admin key={this.state.storageRoot || 'workspace'} actor={HUMAN} project={project} refreshKey={refreshKey}
          onGo={this.go} onOpenPath={this.openPath} onWrote={this.reload}
          onOpenProject={id => this.setState({ project: id, screen: 'project' })} />;

      case 'paperclip':
        return <Paperclip key={this.state.storageRoot || 'workspace'} onGo={this.go} />;

      case 'decide':
        return (
          <Decide
            actor={HUMAN}
            focus={arg || null}
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
            onDecide={this.onDecideSubject}
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
            activeAssistant={activeAssistant}
            onHire={() => this.go('hire')}
            onSelect={id => this.setState({ activeAssistant: id })}
            onRebrief={a => this.go('hire', a)}
            onDecide={this.onDecideSubject}
            onOpenPath={this.openPath}
            onSendOut={this.sendOutOne}
            onSendOutAll={this.sendOutAll}
          />
        );

      case 'hire':
        return (
          <Hire
            existing={arg && arg.id ? arg : null}
            assistants={assistants} actor={HUMAN}
            onHired={() => { this.loadSidebar(); this.go('assistants'); }}
            onCancel={() => this.go('assistants')}
            onOpenPath={this.openPath}
          />
        );

      case 'files':  return <Files path={arg || docPath || ''} onOpenPath={this.openPath} />;
      case 'settings': return <ScoutSettings onToast={(m, tone) => this.showToast(m, tone)} onRootChanged={this.onStorageRootChanged} />;
      case 'board':
        // Whiteboard's own PROPS block names `board` / `onOpenDocument` / `onToast` — it was being
        // handed `project` / `onOpenPath` / `onOpen`, so `board` was undefined and `boardId()` fell
        // back to 'main': EVERY project shared one board. `onOpenDocument` missing meant no card
        // had a way down to its record (Law 8), and `onToast` missing made the 409 "your move was
        // not saved" a no-op — the drag was discarded in silence. `place` carries a path handed in
        // from the inspector's GRAPH ("Open in the whiteboard") — Whiteboard places it (and its
        // related nodes) on mount if it is not already on the board.
        return (
          <Whiteboard
            board={project || 'main'}
            place={arg || null}
            onOpenDocument={this.openPath}
            onToast={(message, tone) => this.showToast(message, tone)}
          />
        );

      case 'document':
        return (
          <Document
            path={docPath}
            startExpanded={this.state.docExpanded}
            collection={activeCollection}
            collections={collections}
            assistants={this.state.assistants}
            referencedBy={this.state.referencedBy}
            onOpenBoard={path => this.go('board', path || null)}
            actor={HUMAN}
            onOpen={this.openRelation}
            onOpenPath={this.openPath}
            onSaved={this.onDocSaved}
            onPromote={next => this.onMove({ path: docPath }, next)}
            onBack={() => this.go('collection')}
            // Presence says adding is allowed; the composer itself lives in the property list.
            onFieldAdded={activeCollection ? f => {
              this.showToast('"' + f.key + '" is on every #' + activeCollection.id + ' from now on.');
              this.boot();
            } : undefined}
            // Law 5: archived, never deleted, and never without a reason — the surface collects
            // one and `records.mjs` refuses the write if it somehow arrives without. Afterwards
            // the record is no longer where the person is standing, so this leaves the surface
            // instead of holding them on a document that has moved.
            onArchived={({ reason }) => {
              this.setState({ screen: 'collection', docPath: null, selected: null });
              this.showToast('Archived as "' + reason + '". It is still on disk, with the reason attached.');
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
            onAccept={this.onAccept}
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
      assistants, memoryCounts, needsYou, project, projects, activityOpen, toast, toastDanger,
    } = this.state;

    const activeCollection = collections.find(c => c.id === active) || null;
    // The inspector may be showing a document from ANOTHER collection, followed out of REFERENCED
    // BY. It is then read with THAT document's schema, not whichever one the table happens to be on.
    const outside = external && external.path === selected ? external : null;
    const doc = rows.find(r => r.path === selected) || outside;
    const collection = outside ? (collections.find(c => c.id === outside.collection) || null) : activeCollection;
    // On the collection screen with nothing selected, an inspector showing "NOTHING SELECTED" in a
    // 302px column is not collapsible chrome, it is a narrower window — item 13. The document
    // screen always has something to show (the document itself).
    const withInspector = screen === 'collection' && !!doc;
    const running = assistants.filter(a => a.status === 'running');

    if (this.state.firstRun) {
      return (
        <div style={sx('width:100%;height:100vh;background:var(--ink);overflow:auto')}>
          <Interview
            actor={HUMAN}
            app={this}
            onOpenPath={this.openPath}
            onDone={() => this.setState({ firstRun: false, screen: 'decide' }, () => this.boot())}
          />
        </div>
      );
    }

    return (
      <div style={sx('width:100%;height:100vh;display:flex;flex-direction:column;background:var(--ink);overflow:hidden')}>
        <div style={sx('flex:1;min-height:0;display:flex')}>
          {screen !== 'paperclip' ? <Rail
            screen={screen}
            onNavigate={this.go}
            onSearch={() => this.setState({ paletteOpen: true })}
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
          /> : null}

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
              <button type="button" onClick={this.clearToast}
                style={{
                  ...sx('position:absolute;left:50%;bottom:18px;transform:translateX(-50%);max-width:520px;padding:9px 14px;border-radius:8px;font-size:12px;cursor:pointer;text-align:left;box-shadow:0 12px 32px rgba(0,0,0,.45)'),
                  background: 'var(--surface-2)',
                  border: '1px solid ' + (toastDanger ? 'var(--danger)' : 'var(--border-3)'),
                  color: toastDanger ? 'var(--danger)' : 'var(--fg-soft)',
                }}>
                {toast}
              </button>
            ) : null}
          </main>

          {withInspector ? (
            <Inspector
              screen={screen}
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
              onOpenBoard={path => this.go('board', path || null)}
            />
          ) : null}
        </div>

        <Activity
          open={activityOpen}
          onToggle={() => this.setState(s => ({ activityOpen: !s.activityOpen }))}
          onOpenPath={this.openPath}
          running={running}
        />

        {/* ⌘K — a screen-independent overlay, never a route. It closes itself on Esc, on picking
            a result, and on the same chord that opened it. */}
        {this.state.paletteOpen ? (
          <Palette
            collections={collections}
            onClose={() => this.setState({ paletteOpen: false })}
            onGo={this.go}
            onOpenPath={this.openPath}
            onPickCollection={id => this.pickCollection(id)}
          />
        ) : null}
      </div>
    );
  }
}
