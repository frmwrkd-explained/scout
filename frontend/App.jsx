import React from 'react';
import { marked } from 'marked';
import { sx } from './sx';
import { api } from './api';
import StoryTab from './Story';
import Timeline from './Timeline';
import LibraryPage from './Library';
import Tools from './Tools';
import ToolsmithChat from './ToolsmithChat'; // ticket 25 — the "+ New tool" builder surface
import Palette from './Palette';
import SettingsPage from './Settings';
import SnippetText from './SnippetText';
import ProjectGenerate from './ProjectGenerate';
import { References } from './References';
import { AssetBoards, folderKind } from './AssetBoards';
import StyleLab from './StyleLab';
import { styleFromLock, lockPayload, styleLabel } from './lookBuilder';
import RemotionLibrary from './RemotionLibrary';
import ReviewInbox from './ReviewInbox';
import { VoiceInput } from './VoiceInput';
import { resolveKeys, keyLabel, KEY_ACTIONS } from './keymap';
import { ACTIVITY_TYPES, activityType, groupByDay } from './activityKinds';
import { encodeLocation, decodeLocation, sameLocation } from './location';
import { Mosaic, Lightbox, BoardControls, AssetList, BulkBar, collectTags, collectKinds, matchesFilter, canAnalyze, selKey } from './Moodboard';
import { enabledCatalog, DEFAULT_PREVIEW_MODEL } from './models';
import { RenderMedia } from './RenderMedia';
import Chat from './Chat';
import Board from './Board';
import { Btn } from './ui';
import Composer from './Composer';
import { modelName } from './GenerationControls';
import Feedback from './Feedback';
import { isEnabled } from '../shared/integrations.mjs';
import { note as noteInteraction } from './feedbackCapture.js';
import { MONO } from './tokens';

marked.setOptions({ breaks: true, mangle: false, headerIds: false });
const Md = ({ src, style }) => <div className="mdBody" style={style} dangerouslySetInnerHTML={{ __html: marked.parse(src || '') }} />;

// THE project tab order — the rendered strip and the 1–9 digit shortcuts both read this. They used
// to hold separate copies, the strip gained Timeline and the shortcut list did not, and from that
// point 4 selected Assets while the 4th tab on screen was Timeline. Add a tab here, in this order,
// and both stay in step. `chat` is hidden when the module is off, so it is filtered in one place.
const PROJ_TAB_IDS = ['story', 'board', 'chat', 'generate', 'timeline', 'assets', 'references', 'activity'];
const projTabIds = S => PROJ_TAB_IDS.filter(t => t !== 'chat' || (S.modules || {}).chat !== false);
const CTX_ICON = { note: '📝', text: '📄', pdf: '📕', image: '🖼', video: '🎬', link: '🔗', file: '📎' };
const fmtKB = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// project-card gradients — strict palette: graphite family + the neon accent, nothing else
const G = [
  'linear-gradient(130deg,var(--ink),var(--border) 55%,var(--accent))',
  'linear-gradient(150deg,var(--surface),var(--border-2) 60%,var(--fg-faint))',
  'linear-gradient(120deg,var(--ink),var(--raise) 45%,var(--fg-soft))',
  'radial-gradient(120% 120% at 20% 10%,var(--border-2),var(--ink) 60%,var(--accent-12))',
  'linear-gradient(140deg,var(--ink),var(--accent-12) 70%,var(--accent))',
  'linear-gradient(125deg,var(--surface),var(--border) 50%,var(--fg-muted))',
  'linear-gradient(160deg,var(--ink),var(--accent-12) 60%,var(--accent))',
  'linear-gradient(135deg,var(--surface),var(--raise) 55%,var(--fg-faint))',
  'linear-gradient(115deg,var(--ink),var(--border-2) 45%,var(--accent))',
  'linear-gradient(145deg,var(--surface),var(--border-3) 60%,var(--fg))',
  'linear-gradient(105deg,var(--ink),var(--raise) 55%,var(--accent-deep))',
  'linear-gradient(155deg,var(--surface),var(--border-2) 50%,var(--fg-soft))',
  'linear-gradient(130deg,var(--ink),var(--accent-12) 55%,var(--accent))',
  'linear-gradient(130deg,var(--surface),var(--border) 55%,var(--fg-muted))'
];
const gradOf = x => (x.gradIx >= 0 && x.gradIx != null) ? G[x.gradIx % G.length] : (x.grad || G[0]);
const DOTC = { amber: 'var(--accent)', green: 'var(--ok)', grey: 'var(--fg-faint)', red: 'var(--danger)' };

// DEV-122 — read a localStorage UI preference, never throwing. Private-mode Safari makes even
// getItem throw, and a corrupt stored value must not take the whole app down before first paint.
// How many rows a day shows before "+ N more" — a day of heavy work is 40 events and the rail is
// a glance, not a log.
const ACT_PER_DAY = 6;
function readPref(key, parse, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : parse(v); }
  catch { return fallback; }
}

export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loaded: false, storageRoot: '',
      page: 'home', proj: null, item: null,
      items: [], projects: [], activity: [], history: [], skillRepos: [], jobs: [], ledger: [], ledgerRollup: {},
      shots: [], library: { folders: [], items: [] }, groqReady: false, falReady: false, providers: {}, pbShot: null,
      ctxSize: 42, ctxTag: '', ctxQ: '', ctxKind: '', ctxSub: 'boards', ctxLightbox: null, ctxAnalyzing: {},
      settings: { budget: 60, showHints: true, trackedFolders: [], skillRepos: [] },
      filType: 'all', filStatus: 'all', sortIx: 0, density: 'grid',
      sel: {}, review: null, inbox: null, reviewSessions: [], batches: [], stagedTrash: [], toasts: [],
      playing: true, tc: 0, speed: 1, loop: true, audio: true, ab: 0,
      noteDraft: '', confirmEmpty: false, feedbackOpen: false,
      styleLockSaving: false, styleLockNameDraft: '',
      projTab: 'story', briefEdit: false, briefDraft: '', // Story is the landing tab (Greenlight IA: story + shots are one merged surface and lead the project)
      ctxNoteOpen: false, ctxNoteName: '', ctxNoteText: '', ctxDrag: false,
      ctxFolderOpen: false, ctxFolderName: '', ctxDelFolder: null, ctxUploadFolder: '', ctxDropTarget: null,
      skillSel: null, skillFileRel: 'SKILL.md', skillContent: '', skillLoading: false,
      skillEdit: false, skillDraft: '', enhanceOpen: false, enhanceText: '',
      browser: null, agentOpen: false,
      npOpen: false, npName: '', npSub: '', npGrad: 0, projMenu: null, archiveAsk: null,
      projEdit: false, projEditName: '', projEditSub: '',
      projSettingsOpen: false, // ⚙ project-settings modal (see renderProjSettings)
      animGen: null, animBusy: false, // ⚡ Animate — THE composer prefilled over the item view
      ctxView: 'board', ctxFav: false, ctxSel: {}, ctxRenameBoard: null, ctxRenameText: '',
      ctxNoteReplace: null,
      toolsSel: null, genShot: null, lookAsset: null, pbInsert: null, genModel: null, genPrompt: null,
      paletteOpen: false, cheatOpen: false,
      // DEV-122 — home rail + activity feed, restored from localStorage so both survive a reload.
      // railOpen defaults to true (`!== false` at the read site, so an unset value opens).
      railOpen: readPref('frfg.home.rail', v => v !== '0', true),
      actHidden: readPref('frfg.home.actHidden', v => JSON.parse(v) || {}, {}),
      actExpanded: false,
      // agentProv: undefined until the first /api/agent/providers probe; agentWaiting holds the id
      // of the provider whose browser sign-in we are polling for.
      agentTest: null, agentProv: undefined, agentWaiting: null, agentInstallBusy: null, agentAdvanced: false,
      repoName: '', repoPath: '', projDragOver: null,
      snippets: [],
      // ── integrated features ──
      refSub: 'brief',            // References sub-tab pointer (Brief · Moods · Notes · Memory)
      genView: 'compose',         // Generate tab: Compose (ProjectGenerate) | Review (triage grid)
      styleLocks: [],             // lazily fetched; see reloadStyleLocks()
      styleLockPickerOpen: false, // StyleLockPicker overlay
      activeStyleLocks: {},       // per-project active lock { pid: {id,name,fragment,model} }
      quickNoteOpen: false, quickNoteText: '', quickNoteProj: null
    };
    this.fileRef = React.createRef();
    this._undo = null;
    this._lastAction = 0;
  }

  // ── data plumbing ──
  mapItems(raw) {
    const now = Date.now();
    return raw.map(x => ({
      ...x,
      grad: gradOf(x),
      versions: x.versions ? x.versions.map(v => ({ ...v, grad: gradOf(v) })) : null,
      justArrived: now - (x.justArrivedAt || 0) < 4000
    }));
  }
  async load() {
    let st;
    // the app is often opened while the server is still coming up — a failed first fetch used
    // to leave the splash on screen forever (only load() sets loaded:true). Retry instead.
    try { st = await api.state(); }
    catch { clearTimeout(this._loadRetry); this._loadRetry = setTimeout(() => this.load(), 1200); return; }
    this._rev = st.revision || null; // baseline for sync()'s delta probe
    this.setState({
      loaded: true, storageRoot: st.storageRoot, settings: st.settings,
      // integration registry + resolved on/off map (shared/integrations.mjs, resolved server-side
      // so the UI can't drift from what the server actually enforces)
      integrations: st.integrations || [], modules: st.modules || {},
      projects: st.projects.slice().sort((a, b) => (a.order ?? 9) - (b.order ?? 9)),
      items: this.mapItems(st.items), activity: st.activity,
      history: st.history, skillRepos: st.skillRepos, chatSkills: st.chatSkills || null, jobs: st.jobs,
      shots: st.shots || [], library: st.library || { folders: [], items: [] }, ledger: st.ledger || [], ledgerRollup: st.ledgerRollup || {}, reviewSessions: st.reviewSessions || [], batches: st.batches || [], groqReady: !!st.groqReady, falReady: !!st.falReady, providers: st.providers || {}
    }, () => { if (!this._initialLocationApplied) { this._initialLocationApplied = true; this.applyInitialLocation(); } });
    this.reloadSnippets();
  }
  reloadSnippets() { api.snippets().then(snippets => this.setState({ snippets })).catch(() => { }); }
  // opts.probe — ask the server what CHANGED before pulling the whole world down. Only the periodic
  // fallback poll uses it: an SSE-driven sync already knows something changed, so probing there would
  // just add a round-trip. On an idle app the probe answers in 40 bytes instead of ~270KB, which is
  // ~200 file reads and ~46 directory scans the server no longer performs. Any answer other than a
  // clean "nothing changed" falls straight through to the full fetch below, so behaviour is identical
  // whenever there IS something to show.
  async sync(opts = {}) {
    if (document.hidden || this._unmounted) return; // no point re-rendering a hidden tab every 2s
    const seq = this._syncSeq = (this._syncSeq || 0) + 1;
    try {
      if (opts.probe && this._rev) {
        const d = await api.stateSince(this._rev);
        if (seq !== this._syncSeq || this._unmounted) return;
        // full===false is the cheap delta answer. Anything else IS the full state payload (the
        // server falls back to it on a restart or a change-log gap) — fall through and use it.
        if (d && d.full === false) {
          this._rev = d.revision;
          if (!d.changed.length) { if (this.state.offline) this.setState({ offline: false }); return; }
        } else if (d && d.revision) {
          return this.applyState(d);
        }
      }
      const st = await api.state();
      if (seq !== this._syncSeq || this._unmounted) return; // a newer poll already resolved — drop this stale snapshot
      return this.applyState(st);
    } catch {
      // backend unreachable — show the banner and probe every 3s until it's back
      if (this._unmounted) return; // never re-arm the probe loop past unmount
      if (!this.state.offline) this.setState({ offline: true });
      clearTimeout(this._offlineRetry);
      this._offlineRetry = setTimeout(() => this.sync(), 3000);
    }
  }

  // Fold a full /api/state payload into component state. Split out of sync() so the delta path can
  // reuse it verbatim when the server answers a probe with the full payload.
  applyState(st) {
    this._rev = st.revision || this._rev;
    const mapped = this.mapItems(st.items);
    const prev = new Map(this.state.items.map(x => [x.id, x]));
    mapped.forEach(n => {
      const p = prev.get(n.id);
      if (p && p.fbState === 'queued' && n.fbState === 'done') {
        const nv = n.versions ? n.versions[n.versions.length - 1].v : 'v2';
        const job = st.jobs.find(x => x.kind === 'reroll' && x.itemId === n.id && x.status === 'done');
        if (job && job.mode === 'simulated') this.showToast(nv + ' is a practice re-roll — connect Claude in Settings to make them real', 'var(--accent)');
        else this.showToast('Re-roll ready: ' + n.name + ' ' + nv + ' — from your note', 'var(--ok)');
      }
    });
    const prevJobs = new Map(this.state.jobs.map(j => [j.id, j]));
    st.jobs.forEach(j => {
      const p = prevJobs.get(j.id);
      if (j.kind === 'skill' && p && p.status !== 'done' && j.status === 'done') {
        this.showToast('Skill enhanced: ' + j.label + ' — written back with .bak backup', 'var(--ok)');
        const sel = this.state.skillSel;
        if (sel && j.skillFile === sel.dir + '/' + this.state.skillFileRel && !this.state.skillEdit) this.openSkill(sel, this.state.skillFileRel);
      }
      if (j.kind === 'skill' && p && p.status !== 'failed' && j.status === 'failed') {
        this.showToast('Skill enhancement failed — see jobs/' + j.id + '.md', 'var(--danger)');
      }
    });
    const patch = {
      loaded: true, // if the first load() failed, a later poll still clears the splash
      storageRoot: st.storageRoot, activity: st.activity, jobs: st.jobs,
      history: st.history, skillRepos: st.skillRepos, chatSkills: st.chatSkills || null,
      integrations: st.integrations || [], modules: st.modules || {},
      shots: st.shots || [], library: st.library || { folders: [], items: [] }, ledger: st.ledger || [], ledgerRollup: st.ledgerRollup || {}, reviewSessions: st.reviewSessions || [], batches: st.batches || [], groqReady: !!st.groqReady, falReady: !!st.falReady, providers: st.providers || {},
      projects: st.projects.slice().sort((a, b) => (a.order ?? 9) - (b.order ?? 9))
    };
    if (Date.now() - this._lastAction > 1500) patch.items = mapped;
    // don't clobber a just-made settings change (e.g. the AUTO toggle on the project/library
    // page) with an in-flight poll carrying the old value — the debounced PUT would then
    // persist the reverted value. Mirror the _lastAction guard used for items.
    if (this.state.page !== 'settings' && Date.now() - (this._lastSettingsAction || 0) > 1500) patch.settings = st.settings;
    if (this.state.offline) patch.offline = false;
    this.setState(patch);
  }

  // ── revision-based push (Phase 4): SSE drives updates; the old 2s blind poll is gone. A slow
  // fallback poll (45s) covers a dropped SSE connection, and sync() no-ops while the tab is hidden.
  connectEvents() {
    if (typeof EventSource === 'undefined') return; // fallback poll still covers correctness
    try {
      this._es = new EventSource('/api/events');
      this._esBackoff = 1000;
      this._es.addEventListener('revision', () => this.scheduleSync());
      this._es.onopen = () => { this._esBackoff = 1000; };
      this._es.onerror = () => {
        // the browser auto-reconnects on transient errors; only re-open ourselves on a hard close
        if (this._es && this._es.readyState === 2) {
          try { this._es.close(); } catch { /* */ } this._es = null;
          clearTimeout(this._esRetry);
          this._esBackoff = Math.min(30000, (this._esBackoff || 1000) * 1.7);
          this._esRetry = setTimeout(() => this.connectEvents(), this._esBackoff);
        }
      };
    } catch { /* no EventSource — fallback poll covers it */ }
  }
  scheduleSync() { clearTimeout(this._syncT); this._syncT = setTimeout(() => this.sync(), 150); }

  componentDidMount() {
    this._key = e => this.onKey(e);
    window.addEventListener('keydown', this._key);
    this.load();
    this.reloadStyleLocks(); // eager so the first `s` press has zero latency (lazy — not in /api/state)
    this.connectEvents();
    // browser/Electron back & forward → apply the decoded hash location (Phase 6)
    this._pop = () => { this._applyingLocation = true; try { this.applyLocation(decodeLocation(window.location.hash)); } finally { this._applyingLocation = false; } };
    window.addEventListener('popstate', this._pop);
    // slow fallback only — SSE drives normal updates, so this poll exists purely to cover a dropped
    // SSE connection and almost always finds nothing. probe:true asks that question in 40 bytes.
    this._poll = setInterval(() => this.sync({ probe: true }), 45000);
    this._tick = setInterval(() => {
      const S = this.state;
      if (S.page === 'item' && S.playing && !S.review) {
        const it = S.items.find(x => x.proj === S.proj && x.id === S.item);
        // only simulate the clock for placeholder items with no real file — a real <video>
        // reports its own currentTime via onTimeUpdate, and double-driving tc fights the seek.
        if (it && it.durS > 0 && !this.fileOf(it)) {
          let t = S.tc + 0.25 * S.speed;
          if (t >= it.durS) { if (S.loop) t = 0; else { this.setState({ tc: it.durS, playing: false }); return; } }
          this.setState({ tc: t });
        }
      }
    }, 250);
  }
  componentDidUpdate() { this.syncPrimaryVideo(); this.syncHash(); }
  componentWillUnmount() {
    window.removeEventListener('keydown', this._key);
    clearInterval(this._tick); clearInterval(this._poll);
    clearTimeout(this._animT); clearTimeout(this._toastT); clearTimeout(this._budgetT); clearTimeout(this._loadRetry);
    clearTimeout(this._syncT); clearTimeout(this._esRetry); clearTimeout(this._uiT);
    // _offlineRetry re-arms itself from sync()'s catch, so leaving it running past unmount is not
    // one stray callback but an unkillable 3s fetch→setState→reschedule loop for as long as the
    // backend stays unreachable. _ibT is the inbox debounce — one stray fire, same class of bug.
    clearTimeout(this._offlineRetry); clearTimeout(this._ibT);
    clearInterval(this._agentPoll);
    this._unmounted = true;
    try { this._es && this._es.close(); } catch { /* */ }
    window.removeEventListener('popstate', this._pop);
  }

  // ── helpers ──
  fmt$(v) { return '$' + v.toFixed(2); }
  // real spend = legacy item costs + the costs.md ledger; items born from generations
  // (id *_gen) are excluded from the item side because their charges live in the ledger
  monthSpend() {
    // month-to-date, not all-time: the ledger is the timestamped source of truth (every groq
    // call + generation). Legacy dateless item costs are only counted if they arrived this
    // month (justArrivedAt); otherwise a fresh install's seed data pinned the budget bar at
    // 100% forever. weekSpend() already uses this ledger-filter pattern.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const items = this.state.items.filter(x => !String(x.id).endsWith('_gen') && (x.justArrivedAt || 0) >= monthStart);
    const itemTotal = items.reduce((a, x) => a + (x.cost || 0) + (x.versions ? x.versions.slice(0, -1).reduce((b, v) => b + (v.cost || 0), 0) : 0), 0);
    // prefer the permanent monthly rollup (accurate past the 500-row detail cap); fall back to
    // summing the detail rows for older roots that predate the rollup.
    const mk = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const roll = this.state.ledgerRollup && this.state.ledgerRollup[mk];
    const ledgerTotal = roll ? (roll.total || 0)
      : (this.state.ledger || []).filter(e => (e.ts || 0) >= monthStart).reduce((a, e) => a + (e.cost || 0), 0);
    return itemTotal + ledgerTotal;
  }
  // real calendar pace — fraction of the current month elapsed (was hardcoded "day 7 of 31")
  monthFrac() {
    const d = new Date();
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { day: d.getDate(), days, frac: d.getDate() / days };
  }
  // last-7-days spend from the timestamped ledger (legacy items carry no dates)
  weekSpend() {
    const cut = Date.now() - 7 * 86400000;
    return (this.state.ledger || []).filter(e => (e.ts || 0) >= cut).reduce((a, e) => a + (e.cost || 0), 0);
  }
  // total spend for one project = legacy item costs (excluding *_gen, whose charges live in the
  // ledger — see monthSpend()) + every ledger row generate.mjs tagged with this pid (ref is
  // "pid" or "pid/shot", optionally suffixed " · chat:<sessionId>" for chat-attributed spend —
  // ticket 22 — which we strip before the pid match so per-project totals are unaffected).
  // Generation cost never lands in S.items, so summing items alone always read $0 for projects
  // built with the current Generate flow.
  projSpend(pid) {
    const items = this.state.items.filter(x => x.proj === pid && !String(x.id).endsWith('_gen'));
    const itemTotal = items.reduce((a, x) => a + (x.cost || 0) + (x.versions ? x.versions.slice(0, -1).reduce((b, v) => b + (v.cost || 0), 0) : 0), 0);
    const ledgerTotal = (this.state.ledger || []).filter(e => { const r = String(e.ref || '').split(' · ')[0]; return r === pid || r.startsWith(pid + '/'); }).reduce((a, e) => a + (e.cost || 0), 0);
    return itemTotal + ledgerTotal;
  }
  fmtDur(s) { if (!s) return ''; const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
  gb(it) { return it.type === 'render' ? 1.2 : it.type === 'clip' ? 0.19 : 0.01; }
  projDef(pid) { return this.state.projects.find(p => p.id === pid) || { name: pid, sub: '', scenes: '', model: '', style: '', brief: '' }; }
  // Poster frame for a project card — the picture the production already made, not a gradient.
  // Ranked on what the production itself said about each take, strongest signal first:
  //   rating → in the cut (final) → kept → not the opening plate → takes on that shot → newest
  // The opener demotion is the one that matters visually. Seeded and same-session takes carry
  // identical timestamps, so every earlier tiebreak collapsed to array order — which is shot 1,
  // which by screenplay convention is the wide establisher with nobody in it. Three of four cards
  // were showing an empty landscape. Demoting it lands on a frame with a subject; an explicit
  // rating still outranks it, because a take the user rated beats any guess made here.
  // Video is skipped — a <video> poster is blank until metadata arrives, and this is a thumbnail.
  // Returns a URL or null (the gradient shows through for a project that has generated nothing).
  projPoster(pid) {
    const p = this.projDef(pid);
    const at = g => g.ended || g.started || 0;
    const alive = (p.gens || []).filter(g =>
      g.file && g.status === 'done' && g.reviewState !== 'killed' && !/\.(mp4|mov|webm|m4v|ogv)$/i.test(g.file));
    if (alive.length) {
      const takes = {};
      for (const g of alive) takes[g.shot] = (takes[g.shot] || 0) + 1;
      const opener = alive.map(g => g.shot).filter(Boolean).sort()[0] || null;
      const score = g => [g.rating || 0, g.final ? 1 : 0, g.reviewState === 'kept' ? 1 : 0,
        (g.shot && g.shot === opener) ? 0 : 1, takes[g.shot] || 0, at(g)];
      const best = alive.reduce((a, b) => {
        const A = score(a), B = score(b);
        for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return B[i] > A[i] ? b : a;
        return a;
      });
      return api.renderUrl(pid, best.file);
    }
    const ctx = ((p.context || {}).items || []).find(c => c.type === 'image');
    return ctx ? api.contextUrl(pid, ctx.name, ctx.folder) : null;
  }
  // SCOPED identity (Phase 1B): items are addressed by { proj, id }. Item ids such as SH010_gen
  // repeat across projects, so every lookup and every mutation is keyed on BOTH the project and the
  // item id — a bare-id lookup could resolve to a same-named item in another project.
  itemKey(x) { return x.proj + '/' + x.id; }
  getItem(pid, id) { return this.state.items.find(x => x.proj === pid && x.id === id); }
  // resolve a bare id (activity refs carry no project) to its item — nav only, picks first match
  resolveItem(id) { return this.state.items.find(x => x.id === id); }
  promptOf(it) {
    if (it.prompt) return it.prompt;
    return it.label.toLowerCase() + ', 35mm anamorphic, shallow depth, film grain, amber rim light —style ' + (this.projDef(it.proj).style || '') + (it.type === 'clip' ? ' —dur ' + it.durS + 's' : '');
  }
  patchLocal(pid, id, patch) { this.setState(s => ({ items: s.items.map(x => (x.proj === pid && x.id === id) ? { ...x, ...patch } : x) })); }
  patchItem(pid, id, patch, opts = {}) {
    this._lastAction = Date.now();
    this.patchLocal(pid, id, patch);
    api.patchItem(pid, id, { patch, ...opts }).catch(() => { });
  }
  // toast queue — up to 3 stack instead of overwriting (rapid bulk ops stay readable)
  showToast(text, dot, undoFn) {
    const id = ++this._toastN || (this._toastN = 1);
    // undo lives on the toast itself — with two undoable toasts stacked, each button
    // reverts its own action instead of whichever came last
    this.setState(s => ({ toasts: [...s.toasts, { id, text, dot, canUndo: !!undoFn, undoFn: undoFn || null }].slice(-3) }));
    setTimeout(() => this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 4500);
  }
  doUndo(toastId) {
    const t = toastId != null
      ? this.state.toasts.find(x => x.id === toastId)
      : this.state.toasts.slice().reverse().find(x => x.canUndo);
    if (t && t.undoFn) {
      this.setState(s => ({ toasts: s.toasts.filter(x => x.id !== t.id) }));
      t.undoFn();
      return;
    }
    // No live toast to undo — fall back to the durable action journal so undo survives navigation
    // and restart (Phase 3D). Undo the most recent still-undoable action.
    api.actions().then(list => {
      const a = (list || []).find(x => x.undoable && x.status !== 'undone');
      if (!a) { this.showToast('Nothing to undo', 'var(--fg-faint)'); return; }
      api.undoAction(a.id)
        .then(() => { this.showToast('Undone: ' + a.command, 'var(--accent)'); this.sync(); })
        .catch(e => this.showToast('Undo failed — ' + (e.message || 'server unreachable'), 'var(--danger)'));
    }).catch(() => { });
  }

  go(page, extra) {
    // Feed the repro trail. A page name is authored by us and can contain nothing the user typed;
    // it is also the single most useful line in a bug report — "they were on the Library" answers
    // half the questions we would otherwise have to ask. See frontend/feedbackCapture.js.
    noteInteraction('route', page);
    this.setState(Object.assign({ page, sel: {}, ctxSel: {}, confirmEmpty: false, briefEdit: false, browser: null, projMenu: null, projEdit: false, genShot: null, genPrompt: null, genModel: null, lookAsset: null, pbShot: null }, extra || {}));
    // Staged trash is NOT part of /api/state, so nothing else ever fetches it. Without this the
    // page was unusable in a way that looked like data loss: `stagedTrash` starts [] and was only
    // ever refilled AFTER a restore or a purge — so the list stayed empty forever, and the only
    // actions that could fill it were the ones the empty list made unreachable. Every staged
    // deletion since the feature shipped was recoverable on disk and invisible in the UI.
    if (page === 'trash') this.loadStagedTrash();
  }

  // ── serializable location ↔ URL hash (Phase 6) ──
  // Derive the current navigable location from state. Only real navigation state — never modal
  // booleans. The item page carries {proj,item}; the Inbox carries its session id; project pages
  // carry the active tab + list filters.
  currentLocation() {
    const S = this.state;
    const loc = { page: S.page, projectId: S.proj || null, tab: null, subview: null, entity: null, filters: {}, reviewSessionId: null };
    if (S.page === 'project') { loc.tab = S.projTab; if (S.projTab === 'generate') loc.subview = S.genView; if (S.projTab === 'references') loc.subview = S.refSub; if (S.filType && S.filType !== 'all') loc.filters.type = S.filType; if (S.filStatus && S.filStatus !== 'all') loc.filters.status = S.filStatus; }
    else if (S.page === 'item') { loc.entity = { type: 'item', id: S.item }; }
    else if (S.page === 'inbox') { loc.reviewSessionId = (S.inbox && S.inbox.sessionId) || null; }
    return loc;
  }
  // Apply a decoded location by routing through the existing navigation methods.
  applyLocation(loc) {
    if (!loc || !loc.page || loc.page === 'home') { this.go('home'); return; }
    this._applyingLocation = true;
    try {
      if (loc.page === 'project' && loc.projectId) {
        this.openProj(loc.projectId, loc.tab || 'story');
        const patch = {};
        if (loc.subview && loc.tab === 'generate') patch.genView = loc.subview;
        if (loc.subview && loc.tab === 'references') patch.refSub = loc.subview;
        if (loc.filters.type) patch.filType = loc.filters.type;
        if (loc.filters.status) patch.filStatus = loc.filters.status;
        if (Object.keys(patch).length) this.setState(patch);
      } else if (loc.page === 'item' && loc.entity && loc.entity.id && loc.projectId) {
        this.openItem(loc.projectId, loc.entity.id);
      } else if (loc.page === 'inbox') {
        this.openInbox();
      } else {
        this.go(loc.page, loc.projectId ? { proj: loc.projectId } : {});
      }
    } finally { this._applyingLocation = false; }
  }
  // Reflect the current location into the URL hash (pushState) unless we're mid-apply or unchanged.
  syncHash() {
    if (this._applyingLocation) return;
    const hash = encodeLocation(this.currentLocation());
    if (hash === (window.location.hash || '#')) return;
    try { window.history.pushState(null, '', hash); this.saveUiState(); } catch { /* non-browser */ }
  }
  // On launch: a valid hash location wins; else the saved ui-state location; else Inbox or Home per
  // the launchIntoInbox preference (Phase 6).
  applyInitialLocation() {
    const hashLoc = decodeLocation(window.location.hash);
    if (hashLoc && hashLoc.page && hashLoc.page !== 'home') { this.applyLocation(hashLoc); return; }
    api.uiState().then(ui => {
      if (ui && ui.location && ui.location.page && ui.location.page !== 'home') this.applyLocation(ui.location);
      else if (this.state.settings.launchIntoInbox) this.openInbox();
    }).catch(() => { if (this.state.settings.launchIntoInbox) this.openInbox(); });
  }
  saveUiState() {
    clearTimeout(this._uiT);
    this._uiT = setTimeout(() => {
      const loc = this.currentLocation();
      api.saveUiState({ location: loc, density: this.state.density, ctxSize: this.state.ctxSize }).catch(() => { });
    }, 500);
  }
  openItem(pid, id) {
    // tolerate a single-arg (bare-id) call from legacy nav — resolve its project first
    if (id === undefined) { const r = this.resolveItem(pid); if (!r) return; pid = r.proj; id = r.id; }
    const it = this.getItem(pid, id); if (!it) return;
    this.go('item', { item: id, proj: it.proj, tc: 0, playing: it.durS > 0, ab: 0, noteDraft: it.fbState ? '' : (it.note || '') });
  }
  openProj(pid, tab) {
    // A tab id that is not in the strip renders NOTHING — every `S.projTab === …` branch misses
    // and the project page comes up blank. That is what a stale saved location or a renamed tab
    // did, and it looks like the project failed to load. Fall back to the first real tab.
    const wanted = PROJ_TAB_IDS.includes(tab) ? tab : 'story';
    this.go('project', { proj: pid, filType: 'all', filStatus: 'all', projTab: wanted, refSub: 'brief', genView: 'compose', briefEdit: false, ctxNoteOpen: false, ctxNoteReplace: null, ctxLightbox: null, ctxSub: 'boards', ctxTag: '', ctxQ: '', ctxKind: '', ctxFav: false, ctxSel: {}, ctxRenameBoard: null });
    this.seedStyleLockForProject(pid);
  }
  openPromptBuilder(shot) { this.go('tools', { toolsSel: 'builder', pbShot: shot ? { ...shot } : null }); }
  // lands on the project Generate tab — ProjectGenerate is the only composer (Phase 10A);
  // the genShot/genPrompt/genModel handoff is consumed in its componentDidMount
  openGenerate(shot) {
    const pid = (shot && shot.proj) || this.state.proj || (this.state.projects[0] && this.state.projects[0].id);
    if (!pid) return;
    this.openProj(pid, 'generate');
    this.setState({ genView: 'compose', genShot: shot ? { ...shot } : null });
  }

  // ── style locks ──
  // returns the promise so a caller can act once the list is actually refreshed — ProjectGenerate
  // needs that to select a style saved moments earlier, which is not in state.styleLocks yet.
  reloadStyleLocks() { return api.styleLocks().then(styleLocks => new Promise(r => this.setState({ styleLocks }, r))).catch(() => { /* styles/ may not exist yet */ }); }
  // `tab` (DEV-127): which StyleLab tab to land on — 'styles' (the saved library, the historical
  // default) | 'style' (the axis builder, i.e. "new style") | 'camera'. Callers that pass nothing
  // keep the old behaviour exactly.
  openStyleLockPicker(pid, tab) { this._styleLockTarget = pid || this.state.proj; this.reloadStyleLocks(); this.setState({ styleLockPickerOpen: true, styleLockTab: tab || 'styles' }); }
  // generic import-from-item save — {name, prompt, refPath} — shared by the item page and
  // ProjectGenerate's preview panel (the style-lock contract is backend/stylelocks.mjs)
  async saveStyleLockFrom({ name, prompt, refPath }) {
    try {
      await api.importStyleLock({ name, prompt, refPath });
      this.showToast('Style lock saved', 'var(--ok)');
      this.reloadStyleLocks();
    } catch (e) { this.showToast('Save style lock failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  // item page — inline name-input flow (default = item name + " style")
  startSaveStyleLock() {
    const it = this.getItem(this.state.proj, this.state.item);
    if (!it) return;
    this.setState({ styleLockSaving: true, styleLockNameDraft: (it.label || it.name || 'Style') + ' style' });
  }
  cancelSaveStyleLock() { this.setState({ styleLockSaving: false, styleLockNameDraft: '' }); }
  commitSaveStyleLock() {
    const it = this.getItem(this.state.proj, this.state.item);
    const name = this.state.styleLockNameDraft.trim();
    this.setState({ styleLockSaving: false, styleLockNameDraft: '' });
    if (!it || !name) return;
    const file = this.fileOf(it);
    const refPath = file ? (this.state.storageRoot + '/projects/' + it.proj + '/renders/' + file) : '';
    this.saveStyleLockFrom({ name, prompt: this.promptOf(it), refPath });
  }
  // consume a picked lock: a project context stores it per-project (ProjectGenerate reads it as a
  // prop and appends its fragment on generate); with no project in context, copy the fragment.
  applyStyleLock(lock) {
    const pid = this._styleLockTarget || this.state.proj;
    // The WHOLE record travels, not a {id,name,fragment} shadow of it: styleFromLock() rebuilds
    // the axis grid from `picks`, and cameraFromLock() from `camera`. Narrowing this to the
    // fragment is what made a saved style degrade into unreadable prose downstream.
    const rec = { ...lock, model: lock.model || null };
    if (pid) {
      this.setState(s => ({ activeStyleLocks: { ...s.activeStyleLocks, [pid]: rec } }));
      this.showToast('Style lock "' + lock.name + '" applied', 'var(--ok)');
    } else {
      navigator.clipboard && navigator.clipboard.writeText(lock.fragment).catch(() => { });
      this.showToast('"' + lock.name + '" copied to clipboard' + (lock.model ? ' (model: ' + lock.model + ')' : ''), 'var(--accent)');
    }
  }
  // Apply a composition from the global StyleLab overlay. It may be a saved style, a preset, or
  // something the user just built — all three become the same lock-shaped record, so everything
  // downstream (syncLock → styleFromLock) treats them identically.
  applyStyleSelection({ style, camera, aspect }) {
    const pid = this._styleLockTarget || this.state.proj;
    const payload = lockPayload(style, camera, aspect);
    if (!payload.fragment) { this.showToast('Nothing picked yet — the style is empty', 'var(--danger)'); return; }
    const name = (style && style.lockName) || styleLabel(style);
    // An unsaved composition still needs a stable identity for syncLock's change detection;
    // without one, tweaking a look and re-applying it would be a no-op downstream.
    const rec = { ...payload, id: (style && style.lockId) || 'adhoc-' + Date.now(), name, model: null };
    this.setState({ styleLockPickerOpen: false });
    if (pid) {
      this.setState(s => ({ activeStyleLocks: { ...s.activeStyleLocks, [pid]: rec } }));
      this.showToast('Style applied — ' + name, 'var(--ok)');
    } else {
      navigator.clipboard && navigator.clipboard.writeText(payload.fragment).catch(() => { });
      this.showToast('"' + name + '" copied to clipboard — open a project to apply it', 'var(--accent)');
    }
  }
  // a project can persist a *default* style lock (project.md → styleLock: <id>, set from the
  // ⚙ Project Settings modal). This seeds the per-project session lock the first time the
  // project is opened after a restart, so "I have one look per project" survives reloads without
  // forcing a re-pick every session. Fails soft — a deleted lock id just leaves no session lock.
  seedStyleLockForProject(pid) {
    const pdef = this.projDef(pid);
    if (!pdef.styleLock || this.state.activeStyleLocks[pid]) return;
    const apply = list => {
      const lock = (list || []).find(l => l.id === pdef.styleLock);
      // whole record — see applyStyleLock() on why a narrowed shadow breaks the axis grid
      if (lock) this.setState(s => ({ activeStyleLocks: { ...s.activeStyleLocks, [pid]: { ...lock, model: lock.model || null } } }));
    };
    if (this.state.styleLocks && this.state.styleLocks.length) { apply(this.state.styleLocks); return; }
    api.styleLocks().then(list => { this.setState({ styleLocks: list }); apply(list); }).catch(() => { /* styles/ may not exist yet */ });
  }

  // ── quick-note overlay (n) → prepend a dated bullet to the project's memory doc ──
  openQuickNote() {
    const pid = this.state.proj || (this.state.projects[0] && this.state.projects[0].id) || null;
    this.setState({ quickNoteOpen: true, quickNoteText: '', quickNoteProj: pid });
  }
  async submitQuickNote() {
    const S = this.state, pid = S.quickNoteProj, text = (S.quickNoteText || '').trim();
    if (!pid) { this.showToast('No project to remember into — open one first', 'var(--danger)'); return; }
    if (!text) { this.setState({ quickNoteOpen: false }); return; }
    this.setState({ quickNoteOpen: false, quickNoteText: '' });
    try { await api.appendMemory(pid, text); this.showToast('Remembered · ' + this.projDef(pid).name, 'var(--ok)'); }
    catch (e) { this.showToast('Could not save note — ' + (e.message || ''), 'var(--danger)'); }
  }

  // The always-there way in. A keyboard shortcut and a chip in the top bar were not enough —
  // the top bar is crowded and the chip lost to the INBOX pill beside it, which is exactly the
  // failure mode where a beta tester hits a bug, has nowhere obvious to put it, and says nothing.
  //
  // Tinted rather than a solid accent slab: DESIGN.md reserves a filled accent for the ONE primary
  // action on screen, and a permanently-filled button in the corner of every page would out-shout
  // whatever the user actually came here to do.
  //
  // Hidden whenever the panel is open, which is also every moment a screenshot can be taken — so
  // the button can never appear in the picture of the bug it was used to report.
  renderFeedbackFab() {
    const S = this.state;
    if (!isEnabled(S.settings, 'feedback') || S.feedbackOpen) return null;
    return (
      <div style={sx('position:fixed;right:18px;bottom:18px;z-index:69')}>
        <Btn onClick={() => this.openFeedback()} data-ff="report-fab"
          title="Send feedback — a bug, a confusion, or something you want (f)"
          className="hBdAccent"
          style={{
            gap: 9, padding: '10px 16px', borderRadius: 999,
            background: 'var(--accent-12)', border: '1px solid var(--accent-35)',
            color: 'var(--accent)', fontWeight: 700, fontSize: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,.45)'
          }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.6 3.4h10.8v7.2H8.2L5 13.2v-2.6H2.6V3.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M8 5.6v2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="9.4" r=".85" fill="currentColor" />
          </svg>
          Feedback
        </Btn>
      </div>
    );
  }

  // ── beta feedback (f) — docs/specs/beta-feedback/spec.md ──
  // `where` is the only context the panel cannot work out for itself: which page and tab the user
  // was on, and how big the project is. Names are deliberately NOT included — a project called
  // "Nestlé Q4 pitch" is the user's business, and the shot count answers the same question.
  openFeedback() {
    const S = this.state;
    this.setState({
      feedbackOpen: true,
      where: {
        page: S.page, tab: S.page === 'project' ? S.projTab : null,
        hasProject: !!S.proj, shots: (S.shots || []).length, items: (S.items || []).length,
        reviewing: !!S.review
      }
    });
  }

  // ── m → References → Memory ; g → Generate tab (compose) ──
  openMemoryTab() {
    const pid = this.state.proj || (this.state.projects[0] && this.state.projects[0].id);
    if (!pid) return;
    this.openProj(pid, 'references');
    this.setState({ refSub: 'memory' });
  }
  jumpToGenerate() {
    const S = this.state;
    if (S.page === 'project' && S.proj) { this.setState({ projTab: 'generate', genView: 'compose' }); return; }
    const pid = S.proj || (S.projects[0] && S.projects[0].id);
    if (pid) this.openProj(pid, 'generate');
  }
  // real file behind an item (last version with a file, or none — gradient fallback)
  fileOf(it) {
    const v = (it.versions || []).slice().reverse().find(x => x.file);
    return v ? v.file : null;
  }
  fileUrlOf(it) {
    const f = this.fileOf(it);
    return f ? api.renderUrl(it.proj, f) : null;
  }
  // absolute-fill media element for an item's real file — null when only gradients exist.
  // `primary` = the big player the transport controls drive (item page / review). A primary
  // video is *controlled*: playback, speed, loop, audio and scrubbing are applied imperatively
  // in syncPrimaryVideo() so the on-screen controls actually do something (they used to only
  // move a simulated overlay clock). Non-primary uses (version thumbnails) stay decorative.
  itemMedia(it, fileOverride, primary) {
    const f = fileOverride !== undefined ? fileOverride : this.fileOf(it);
    if (!f) return null;
    const url = api.renderUrl(it.proj, f);
    const style = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };
    const isVideo = /\.(mp4|mov|webm)$/i.test(f);
    if (!isVideo) return <img src={url} alt="" loading="lazy" style={style} />;
    if (!primary) return <video src={url} muted loop playsInline preload="metadata" onMouseEnter={e => e.currentTarget.play().catch(() => {})} onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} style={style} />;
    return <video
      key={url}
      ref={el => { this._primaryVideo = el; }}
      src={url} playsInline style={style}
      onLoadedMetadata={() => this.syncPrimaryVideo()}
      onTimeUpdate={e => {
        const t = e.target.currentTime || 0;
        // the real element is the source of truth for the timecode while it plays
        if (Math.abs((this.state.tc || 0) - t) > 0.12) this.setState({ tc: t });
      }}
      onEnded={() => { if (!this.state.review) this.setState({ playing: false }); }}
    />;
  }
  // apply the current control state to the real primary <video> (no-op if it's an image or
  // a gradient placeholder). Called from componentDidUpdate + onLoadedMetadata.
  syncPrimaryVideo() {
    const el = this._primaryVideo;
    if (!el) return;
    const S = this.state;
    const inReview = !!S.review;
    const playing = inReview ? !!(S.review && S.review.playing) : !!S.playing;
    el.muted = inReview ? true : !S.audio;      // review has no audio control — keep it quiet
    el.loop = inReview ? true : !!S.loop;
    el.playbackRate = inReview ? 1 : (S.speed || 1);
    // honor an explicit scrub request without fighting the timeupdate handler
    if (this._pendingSeek != null && isFinite(this._pendingSeek)) {
      try { el.currentTime = this._pendingSeek; } catch { /* not seekable yet */ }
      this._pendingSeek = null;
    }
    if (playing && el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => { }); }
    else if (!playing && !el.paused) el.pause();
  }

  // ── triage actions (persisted) ──
  // triage decisions feed back into the linked shot's status (F2.3)
  bumpShotFor(it, status) {
    const sh = this.state.shots.find(s => s.proj === it.proj && (s.assets || []).includes(it.id));
    if (!sh) return;
    const rank = { todo: 0, generating: 1, review: 2, done: 3 };
    if ((rank[status] ?? 0) > (rank[sh.status] ?? 0)) {
      api.patchShot(it.proj, sh.id, { status }, 'status → ' + status + ' via triage of ' + it.id).catch(() => { });
    }
  }
  keepIt(pid, id, silent) {
    const it = this.getItem(pid, id); if (!it) return;
    const prev = { st: it.st, trashed: it.trashed };
    this.patchItem(pid, id, { st: 'kept', trashed: false }, { history: 'triage', log: 'kept' });
    this.bumpShotFor(it, 'review');
    if (!silent) this.showToast('Kept ' + it.name, 'var(--ok)', () => this.patchItem(pid, id, prev));
  }
  killIt(pid, id, silent) {
    const it = this.getItem(pid, id); if (!it) return;
    const prev = { st: it.st, rating: it.rating, fin: it.fin };
    this.patchItem(pid, id, { st: 'killed', rating: 0, fin: false }, { history: 'triage', log: 'killed' });
    if (!silent) this.showToast('Killed ' + it.name + ' — staged in Trash', 'var(--danger)', () => this.patchItem(pid, id, prev));
  }
  rateIt(pid, id, r) {
    const it = this.getItem(pid, id); if (!it) return;
    const prev = { rating: it.rating, st: it.st };
    this.patchItem(pid, id, { rating: r, st: (it.st === 'new' || it.st === 'killed') ? 'kept' : it.st }, { history: 'triage', log: 'rated ' + r + '/5' });
    this.showToast('Rated ' + r + '/5 — ' + it.name, 'var(--accent)', () => this.patchItem(pid, id, prev));
  }
  // ids scoped to a single project (pid) — bulk actions run within one project grid
  trashIds(pid, ids) {
    const snap = this.state.items.filter(x => x.proj === pid && ids.includes(x.id)).map(x => ({ id: x.id, trashed: x.trashed }));
    ids.forEach(id => this.patchItem(pid, id, { trashed: true }, { log: 'moved to trash' }));
    this.setState({ sel: {} });
    this.showToast(ids.length + (ids.length > 1 ? ' items' : ' item') + ' → Trash', 'var(--danger)',
      () => snap.forEach(sn => this.patchItem(pid, sn.id, { trashed: sn.trashed })));
  }
  toggleFinal() {
    const it = this.getItem(this.state.proj, this.state.item); if (!it) return;
    const prev = { fin: it.fin, st: it.st };
    this.patchItem(it.proj, it.id, { fin: !it.fin, st: !it.fin ? 'kept' : it.st }, { history: 'triage', log: !it.fin ? 'marked final' : 'final mark removed' });
    if (!it.fin) this.bumpShotFor(it, 'done');
    this.showToast(!it.fin ? 'Marked final — locked for the edit' : 'Final mark removed', 'var(--ok)', () => this.patchItem(it.proj, it.id, prev));
  }
  copyPrompt() {
    const it = this.getItem(this.state.proj, this.state.item);
    if (it && navigator.clipboard) navigator.clipboard.writeText(this.promptOf(it)).catch(() => { });
    this.showToast('Prompt copied to clipboard', 'var(--accent)');
  }
  toggleAB() {
    const it = this.getItem(this.state.proj, this.state.item);
    if (!it || !it.versions || it.versions.length < 2) return;
    this.setState(s => ({ ab: s.ab ? 0 : 1 }));
  }
  queueNoteFor(pid, id, text) {
    if (!text || !text.trim()) return;
    this._lastAction = Date.now();
    this.patchLocal(pid, id, { fb: true, fbState: 'queued', note: text.trim() });
    api.note(pid, id, text.trim())
      .then(() => this.showToast('Note queued — background agent spinning up claude-code', 'var(--accent)'))
      .catch(e => {
        this.patchLocal(pid, id, { fbState: null, note: '' });
        this.setState({ noteDraft: text }); // give the text back — nothing was queued
        this.showToast('Note failed to queue — ' + (e.message || 'server unreachable'), 'var(--danger)');
      });
  }
  loadStagedTrash() { api.stagedTrash().then(stagedTrash => this.setState({ stagedTrash })).catch(() => { }); }
  restoreStaged(id, label) {
    api.restoreStaged(id)
      .then(() => { this.showToast('Restored ' + (label || 'files'), 'var(--ok)'); this.loadStagedTrash(); this.sync(); })
      .catch(e => this.showToast('Restore failed — ' + (e.message || ''), 'var(--danger)'));
  }
  purgeStaged(id) {
    api.purgeStaged(id).then(() => { this.showToast('Permanently deleted', 'var(--fg-faint)'); this.loadStagedTrash(); }).catch(() => { });
  }
  emptyTrash() {
    const trash = this.state.items.filter(x => x.trashed || (x.st === 'killed' && !x.trashed));
    const n = trash.length;
    this._lastAction = Date.now(); // keep an in-flight poll from resurrecting the deleted rows
    this.setState(s => ({ items: s.items.filter(x => !trash.some(t => t.id === x.id)), confirmEmpty: false }));
    api.emptyTrash()
      .then(() => this.showToast(n + ' items permanently deleted from disk', 'var(--ok)'))
      .catch(e => this.showToast('Empty trash failed — ' + (e.message || 'server unreachable'), 'var(--danger)'));
  }
  saveBrief() {
    const pid = this.state.proj;
    const content = this.state.briefDraft;
    this.setState(s => ({ briefEdit: false, projects: s.projects.map(p => p.id === pid ? { ...p, brief: content.trim() } : p) }));
    api.saveBrief(pid, content)
      .then(() => this.showToast('Brief saved to brief.md — every re-roll reads it from now on', 'var(--accent)'))
      .catch(e => {
        this.setState({ briefEdit: true, briefDraft: content }); // reopen the editor — the save didn't land
        this.showToast('Brief save failed — ' + (e.message || 'server unreachable'), 'var(--danger)');
      });
  }
  saveSettings(patch) {
    this._lastSettingsAction = Date.now(); // shield this change from the 2s poll (see sync())
    this.setState(s => ({ settings: { ...s.settings, ...patch } }));
    clearTimeout(this._budgetT);
    this._budgetT = setTimeout(() => {
      this._lastSettingsAction = Date.now(); // keep the shield alive until the write lands
      api.saveSettings(this.state.settings).catch(() => { });
    }, 400);
  }
  // Settings → Test buttons: one live authenticated round-trip per service
  async testKey(service) {
    this.setState(s => ({ keyTest: { ...s.keyTest, [service]: 'busy' } }));
    try {
      const r = await api.testKey(service);
      this.setState(s => ({ keyTest: { ...s.keyTest, [service]: r } }));
      this.showToast(service.toUpperCase() + (r.ok ? ' key works' + (r.detail ? ' — ' + r.detail : '') : ' test failed — ' + (r.error || '')), r.ok ? 'var(--ok)' : 'var(--danger)');
    } catch (e) {
      this.setState(s => ({ keyTest: { ...s.keyTest, [service]: { ok: false, error: e.message } } }));
      this.showToast(service.toUpperCase() + ' test failed — ' + e.message, 'var(--danger)');
    }
  }
  // shared Test button for the key rows
  keyTestBtn(service) {
    const t = (this.state.keyTest || {})[service];
    const busy = t === 'busy';
    return (
      <span onClick={() => !busy && this.testKey(service)} className="hBd"
        style={{ ...sx('font-size:10.5px;font-weight:700;border:1px solid var(--border-2);border-radius:8px;padding:6px 12px;cursor:pointer;flex:none'), color: busy ? 'var(--fg-faint)' : (t && t !== 'busy' ? (t.ok ? 'var(--ok)' : 'var(--danger)') : 'var(--fg-soft)') }}>
        {busy ? 'Testing…' : (t && t !== 'busy' ? (t.ok ? '✓ Key works' : '✕ Failed — retest') : 'Test key')}
      </span>
    );
  }

  // ── project CRUD (F1.1) ──
  // DEV-136 — the base setup a new project starts from. Falls back through: the last setup the
  // user actually created with (settings.projectDefaults) → the app-wide settings.modelDefaults →
  // the catalog's own default. So the dialog opens on what you used last, and a first-run user
  // still gets sensible models rather than empty selects.
  projectDefaults() {
    const s = this.state.settings || {};
    const md = s.modelDefaults || {};
    const pd = s.projectDefaults || {};
    return {
      model: pd.model || md.render || md.preview || DEFAULT_PREVIEW_MODEL,
      videoModel: pd.videoModel || md.video || '',
      audioModel: pd.audioModel || md.music || '',
      styleLock: pd.styleLock || ''
    };
  }
  // One opener, so the Home card and the ⌘K action can never seed the dialog differently
  // (they already did: one randomised the gradient, the other pinned it to 0).
  openNewProject() {
    const d = this.projectDefaults();
    this.setState({
      npOpen: true, npMode: 'manual', npName: '', npSub: '', npIdea: '', npProposal: null, npBusy: false,
      npGrad: Math.floor(Math.random() * G.length),
      npModel: d.model, npVideoModel: d.videoModel, npAudioModel: d.audioModel, npStyleLock: d.styleLock
    });
  }
  async createProject(extra = {}) {
    const S = this.state;
    if (!S.npName.trim()) return;
    const d = { model: S.npModel, videoModel: S.npVideoModel, audioModel: S.npAudioModel, styleLock: S.npStyleLock };
    try {
      const p = await api.createProject(S.npName.trim(), S.npSub.trim(), S.npGrad);
      // The base setup rides in as a PATCH rather than widening the create route: patchProject is
      // the one allow-listed writer for project frontmatter and already round-trips these fields.
      const patch = {};
      if (d.model) patch.model = d.model;
      if (d.videoModel) patch.videoModel = d.videoModel;
      if (d.audioModel) patch.audioModel = d.audioModel;
      if (d.styleLock) patch.styleLock = d.styleLock;
      if (Object.keys(patch).length) await api.patchProject(p.id, patch).catch(() => { /* project still exists */ });
      // an agent proposal carries an opening story — write it so the project opens with something
      if (extra.story) await api.saveStory(p.id, extra.story).catch(() => { /* best effort */ });
      // remember this setup as the next dialog's starting point
      this.saveSettings({ projectDefaults: d });
      this.setState({ npOpen: false, npName: '', npSub: '', npGrad: 0, npIdea: '', npProposal: null, npBusy: false });
      await this.sync();
      this.showToast('Project "' + p.name + '" created — projects/' + p.id + '/', 'var(--ok)');
      // 'context' was removed as a tab; brief + context assets live under References now.
      // Navigating to a dead id left the project page rendering nothing at all.
      this.openProj(p.id, extra.story ? 'story' : 'references');
    } catch (e) { this.showToast('Could not create project — ' + (e.message || ''), 'var(--danger)'); }
  }
  // AGENT MODE — ask, review, then create. The proposal is never written on its own.
  async proposeProject() {
    const idea = String(this.state.npIdea || '').trim();
    if (!idea || this.state.npBusy) return;
    this.setState({ npBusy: true });
    try {
      const p = await api.proposeProject(idea);
      this.setState({
        npBusy: false, npProposal: p,
        npName: p.name || '', npSub: p.sub || '',
        npGrad: Number.isInteger(p.gradIx) ? Math.max(0, Math.min(G.length - 1, p.gradIx)) : this.state.npGrad
      });
    } catch (e) {
      this.setState({ npBusy: false });
      this.showToast('Agent could not draft this — ' + (e.message || ''), 'var(--danger)');
    }
  }
  async archiveProject(pid) {
    const p = this.projDef(pid);
    this.setState({ archiveAsk: null, projMenu: null });
    try {
      const r = await api.archiveProject(pid);
      if (this.state.proj === pid) this.go('home');
      await this.sync();
      this.showToast('Archived "' + p.name + '" — nothing deleted', 'var(--accent)', async () => {
        await api.restoreProject(r.archived).catch(() => { });
        this.sync();
      });
    } catch (e) { this.showToast('Archive failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async saveProjEdit() {
    const S = this.state;
    const pid = S.proj;
    const patch = { name: S.projEditName.trim() || this.projDef(pid).name, sub: S.projEditSub };
    this.setState({ projEdit: false, projects: S.projects.map(p => p.id === pid ? { ...p, ...patch } : p) });
    await api.patchProject(pid, patch).catch(() => this.showToast('Rename failed', 'var(--danger)'));
    this.sync();
  }
  // ── ⚙ project settings modal (F1.1 extension — "the project's identity in one place") ──
  openProjSettings() {
    const pdef = this.projDef(this.state.proj);
    this.reloadStyleLocks();
    // identity fields reuse the header's inline-rename plumbing (projEdit*/saveProjEdit) — seed
    // them here so the modal's inputs start populated without needing the header's click-to-edit gate.
    this.setState({ projSettingsOpen: true, projEditName: pdef.name, projEditSub: pdef.sub || '' });
  }
  async patchProjMeta(pid, patch, okToast) {
    this.setState(s => ({ projects: s.projects.map(p => p.id === pid ? { ...p, ...patch } : p) }));
    try {
      await api.patchProject(pid, patch);
      if (okToast) this.showToast(okToast, 'var(--ok)');
    } catch (e) { this.showToast('Save failed — ' + (e.message || ''), 'var(--danger)'); }
    this.sync();
  }
  setDefaultStyleLock(pid, lockId) {
    if (lockId) {
      const lock = (this.state.styleLocks || []).find(l => l.id === lockId);
      // whole record — see applyStyleLock() on why a narrowed shadow breaks the axis grid
      if (lock) this.setState(s => ({ activeStyleLocks: { ...s.activeStyleLocks, [pid]: { ...lock, model: lock.model || null } } }));
    }
    this.patchProjMeta(pid, { styleLock: lockId || '' }, lockId ? 'Default style lock saved — applied to this session too' : 'Default style lock cleared');
  }
  setDefaultModel(pid, modelId) { this.patchProjMeta(pid, { model: modelId || '' }, modelId ? 'Default model saved' : 'Default model cleared — using global default'); }
  setProjectGrad(pid, ix) { this.patchProjMeta(pid, { gradIx: ix }); }
  // card drag on Home rewrites `order` on every project (ids stable — 04 rule 4)
  async dropProjReorder(targetId) {
    const dragId = this._projDrag;
    this._projDrag = null;
    this.setState({ projDragOver: null });
    if (!dragId || dragId === targetId) return;
    const ids = this.state.projects.map(p => p.id).filter(x => x !== dragId);
    const ix = ids.indexOf(targetId);
    ids.splice(ix < 0 ? ids.length : ix, 0, dragId);
    this.setState(s => ({ projects: ids.map(id => s.projects.find(p => p.id === id)) }));
    for (let i = 0; i < ids.length; i++) await api.patchProject(ids[i], { order: i }).catch(() => { });
    this.showToast('Project order saved', 'var(--accent)');
    this.sync();
  }
  // shared favorite toggle for any asset with a meta sidecar
  async toggleAssetFav(scope, c) {
    const fav = !c.meta?.fav;
    try {
      await api.saveMeta(scope, c.name, c.folder, { fav });
      this.sync();
    } catch { this.showToast('Could not save favorite', 'var(--danger)'); }
  }

  // ── review mode ──
  startReview() {
    const pid = this.state.proj || this.state.projects[0]?.id;
    if (!pid) return;
    const all = this.state.items.filter(x => x.proj === pid && !x.trashed);
    let list = all.filter(x => x.st === 'new');
    if (!list.length) list = all.filter(x => x.type === 'clip');
    if (!list.length) list = all;
    if (!list.length) {
      // the legacy triage grid is empty — projects built with the current Generate flow never
      // populate S.items, their candidates live in pdef.gens instead. Route to the project-scoped
      // Inbox (which already knows how to review gens) rather than reporting a false "nothing here".
      const gens = (this.projDef(pid).gens || []).filter(g => g.status === 'done' && g.reviewState === 'new');
      if (gens.length) { this.openInbox(pid); return; }
      // nothing to review — bail before entering review mode, otherwise S.review is truthy with
      // an empty id list: nothing renders but every key is swallowed (invisible keyboard trap).
      this.showToast('Nothing to review in this project yet', 'var(--accent)'); return;
    }
    list = list.slice().sort((a, b) => a.tl - b.tl);
    this.setState({ proj: pid, review: { pid, ids: list.map(x => x.id), ix: 0, dec: {}, anim: null, noteOpen: false, noteText: '', done: false, last: null, playing: true } });
  }
  rvPatch(p) { this.setState(s => ({ review: s.review ? Object.assign({}, s.review, p) : null })); }
  rvDecide(kind) {
    const R = this.state.review;
    if (!R || R.done || R.anim || R.noteOpen) return;
    const id = R.ids[R.ix];
    const it = this.getItem(R.pid, id);
    if (!it) return; // vanished mid-review (deleted elsewhere) — don't crash the key handler
    const prev = it.st;
    if (kind === 'keep') this.keepIt(R.pid, id, true); else this.killIt(R.pid, id, true);
    this.rvPatch({ anim: kind, dec: Object.assign({}, R.dec, { [id]: { kind, prev } }), last: id });
    this.showToast((kind === 'keep' ? 'Kept ' : 'Killed ') + it.name, kind === 'keep' ? 'var(--ok)' : 'var(--danger)');
    clearTimeout(this._animT);
    this._animT = setTimeout(() => {
      const R2 = this.state.review; if (!R2) return;
      const nx = R2.ix + 1;
      if (nx >= R2.ids.length) this.rvPatch({ anim: null, done: true });
      else this.rvPatch({ ix: nx, anim: null });
    }, 230);
  }
  rvUndo() {
    const R = this.state.review; if (!R || R.last == null) return;
    const e = R.dec[R.last]; if (!e) return;
    this.patchItem(R.pid, R.last, { st: e.prev });
    const dec = Object.assign({}, R.dec); delete dec[R.last];
    const ix = R.ids.indexOf(R.last);
    this.rvPatch({ dec, ix: ix >= 0 ? ix : R.ix, done: false, anim: null, last: null });
    this.showToast('Restored ' + (this.getItem(R.pid, R.last)?.name || R.last), 'var(--accent)');
  }
  exitReview() { this.setState({ review: null }); }

  // ══════ REVIEW INBOX (Phase 5) — one global, trustworthy queue of actually-unreviewed candidates ══════
  // A candidate key is { pid, kind:'gen'|'item', id }. Generations (schema 2) are the canonical
  // candidates; legacy `st:new` items ride alongside as `item` candidates. No "review-all" fallback:
  // if nothing is genuinely new, the Inbox shows a real zero state.
  allGens() {
    const out = [];
    for (const p of this.state.projects) for (const g of (p.gens || [])) out.push({ ...g, proj: p.id });
    return out;
  }
  inboxSections() {
    const gens = this.allGens();
    const items = this.state.items;
    const newGens = gens.filter(g => g.status === 'done' && g.reviewState === 'new');
    const newItems = items.filter(x => x.st === 'new' && !x.trashed);
    const failed = gens.filter(g => g.status === 'failed');
    const keptUnassigned = gens.filter(g => g.reviewState === 'kept' && !g.shot && (!g.promotedAssets || !g.promotedAssets.length));
    const readyForEdit = [];
    for (const p of this.state.projects)
      for (const s of this.state.shots.filter(sh => sh.proj === p.id))
        if (s.selectedCandidate) readyForEdit.push({ proj: p.id, shot: s.id, gen: s.selectedCandidate });
    const pausedSessions = (this.state.reviewSessions || []).filter(s => s.status === 'paused');
    return { newGens, newItems, failed, keptUnassigned, readyForEdit, pausedSessions };
  }
  // primary queue keys — oldest first, variants of the same shot grouped together, project kept intact
  buildInboxKeys() {
    const { newGens, newItems } = this.inboxSections();
    const keys = [
      ...newGens.map(g => ({ pid: g.proj, kind: 'gen', id: g.id, shot: g.shot || '', ord: g.started || 0 })),
      ...newItems.map(x => ({ pid: x.proj, kind: 'item', id: x.id, shot: '', ord: x.justArrivedAt || x.tl || 0 }))
    ];
    keys.sort((a, b) => (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0) || (a.shot < b.shot ? -1 : a.shot > b.shot ? 1 : 0) || (a.ord - b.ord));
    return keys.map(k => ({ pid: k.pid, kind: k.kind, id: k.id }));
  }
  keyStr(k) { return k.pid + '/' + k.kind + '/' + k.id; }
  inboxCandidate(key) {
    if (!key) return null;
    if (key.kind === 'gen') { const g = this.allGens().find(x => x.proj === key.pid && x.id === key.id); return g ? { ...g, kind: 'gen' } : null; }
    const it = this.getItem(key.pid, key.id); return it ? { ...it, kind: 'item' } : null;
  }
  inboxCurrent() { const IB = this.state.inbox; return IB ? this.inboxCandidate(IB.keys[IB.ix]) : null; }

  // pid scopes the queue to one project (used by the project header's "Review all" / R shortcut);
  // omitted, it's the global cross-project Inbox.
  async openInbox(pid, opts = {}) {
    // opts.keys — an explicit candidate-key list (ticket 21: "Review these" scopes the inbox to one
    // batch). When given, it IS the queue verbatim; otherwise fall back to the project-scoped / global
    // build. Either way the queue is just candidate keys the inbox already knows how to review.
    const explicit = Array.isArray(opts.keys) ? opts.keys : null;
    const keys = explicit ? explicit : (pid ? this.buildInboxKeys().filter(k => k.pid === pid) : this.buildInboxKeys());
    // resume the most recent paused/active session when its queue still overlaps, else start fresh
    // — skipped for any scoped call (a project or an explicit batch), since a resumed global session
    // could pull in other projects' candidates instead of just this one.
    const sessions = (pid || explicit) ? [] : (this.state.reviewSessions || []);
    const resumable = sessions.filter(s => s.status !== 'completed').sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
    let sessionId = null, ix = 0, decisions = {}, spend = 0, sessionKeys = keys;
    if (resumable && Array.isArray(resumable.candidateKeys) && resumable.candidateKeys.length) {
      sessionId = resumable.id;
      sessionKeys = resumable.candidateKeys;
      ix = Math.min(resumable.cursor || 0, Math.max(0, sessionKeys.length - 1));
      decisions = resumable.decisions || {};
      spend = resumable.reviewedSpend || 0;
    }
    this.setState({ page: 'inbox', inbox: { sessionId, keys: sessionKeys, ix, decisions, spend, selected: {}, lastCmd: null, noteOpen: false, noteText: '', routeOpen: false, last: null, playing: true } });
    // create the session record if new so the cursor is durable from the first keystroke
    if (!sessionId) {
      try {
        const s = await api.saveSession({ query: '', candidateKeys: sessionKeys, cursor: ix, status: 'active', decisions: {}, reviewedSpend: 0 });
        this.setState(st => ({ inbox: st.inbox ? { ...st.inbox, sessionId: s.id } : null }));
      } catch { /* the Inbox still works in-memory if the save fails */ }
    }
  }
  ibPatch(p) { this.setState(s => ({ inbox: s.inbox ? { ...s.inbox, ...p } : null })); }
  ibPersist() {
    // Read the state INSIDE the timer. Callers do ibPatch(...) then ibPersist(), and setState is
    // async — so closing over this.state.inbox captured the value from BEFORE the update and the
    // durable review cursor, decisions and spend were always one action behind. Resuming a review
    // put you back on the clip you had already judged, and the last decision before a quit was
    // never written at all.
    clearTimeout(this._ibT);
    this._ibT = setTimeout(() => {
      const IB = this.state.inbox;
      if (!IB || !IB.sessionId) return;
      api.patchSession(IB.sessionId, { cursor: IB.ix, candidateKeys: IB.keys, decisions: IB.decisions, reviewedSpend: IB.spend, status: 'active' }).catch(() => { });
    }, 250);
  }
  ibAdvance() {
    const IB = this.state.inbox; if (!IB) return;
    const nx = IB.ix + 1;
    this.ibPatch({ ix: Math.min(nx, IB.keys.length), playing: true });
    this.ibPersist();
  }
  ibNav(delta) {
    const IB = this.state.inbox; if (!IB) return;
    this.ibPatch({ ix: Math.max(0, Math.min(IB.keys.length - 1, IB.ix + delta)), noteOpen: false, routeOpen: false });
    this.ibPersist();
  }
  // ── selection + repeat (Phase 8) ──
  // Actions apply to the selection when one exists, else to the current candidate. Selection-based
  // actions don't auto-advance (you're acting on a set); single-candidate actions advance.
  ibKeyAt(ix) { const IB = this.state.inbox; return IB && IB.keys[ix]; }
  ibToggleSelect() {
    const IB = this.state.inbox; if (!IB) return;
    const ks = this.keyStr(IB.keys[IB.ix]); const sel = { ...IB.selected };
    if (sel[ks]) delete sel[ks]; else sel[ks] = IB.ix;
    this.ibPatch({ selected: sel });
  }
  ibExtendSelect(delta) {
    const IB = this.state.inbox; if (!IB) return;
    const nx = Math.max(0, Math.min(IB.keys.length - 1, IB.ix + delta));
    const sel = { ...IB.selected }; sel[this.keyStr(IB.keys[IB.ix])] = IB.ix; sel[this.keyStr(IB.keys[nx])] = nx;
    this.ibPatch({ ix: nx, selected: sel });
  }
  ibTargets() {
    const IB = this.state.inbox; if (!IB) return [];
    const selKeys = Object.keys(IB.selected || {});
    if (selKeys.length) return IB.keys.filter(k => selKeys.includes(this.keyStr(k))).map(k => ({ key: k, cand: this.inboxCandidate(k) })).filter(t => t.cand);
    const cur = this.inboxCurrent(); return cur ? [{ key: IB.keys[IB.ix], cand: cur }] : [];
  }
  applyDecisionTo(cand, kind) {
    if (cand.kind === 'gen') {
      const patch = kind === 'keep' ? { reviewState: 'kept' } : kind === 'kill' ? { reviewState: 'killed' } : kind === 'final' ? { reviewState: 'kept', final: true } : {};
      return api.reviewCandidate(cand.proj, cand.id, { patch }).catch(() => this.showToast('Decision failed to save — retry', 'var(--danger)'));
    }
    if (kind === 'keep') this.keepIt(cand.proj, cand.id, true);
    else if (kind === 'kill') this.killIt(cand.proj, cand.id, true);
    else if (kind === 'final') this.patchItem(cand.proj, cand.id, { fin: true, st: 'kept' }, { log: 'marked final' });
  }
  ibDecide(kind, advance = true) {
    const IB = this.state.inbox; if (!IB) return;
    const targets = this.ibTargets(); if (!targets.length) return;
    const bulk = Object.keys(IB.selected || {}).length > 0;
    const decisions = { ...IB.decisions };
    let spend = IB.spend;
    for (const { key, cand } of targets) {
      const prev = cand.kind === 'gen' ? { reviewState: cand.reviewState, rating: cand.rating, final: cand.final } : { st: cand.st };
      decisions[this.keyStr(key)] = { kind, prev, key };
      if (kind === 'keep' || kind === 'final') spend += (cand.cost || 0);
      this.applyDecisionTo(cand, kind);
    }
    this.ibPatch({ decisions, spend, last: targets[targets.length - 1].key, lastCmd: { type: 'decide', kind }, selected: {} });
    this.showToast((kind === 'keep' ? 'Kept ' : kind === 'kill' ? 'Killed ' : 'Final · ') + (bulk ? targets.length + ' candidates' : (targets[0].cand.label || targets[0].cand.name || targets[0].cand.id)), kind === 'kill' ? 'var(--danger)' : 'var(--ok)');
    if (advance && !bulk) this.ibAdvance();
  }
  ibRate(r) {
    const targets = this.ibTargets(); const bulk = targets.length > 1;
    for (const { cand } of targets) {
      if (cand.kind === 'gen') api.reviewCandidate(cand.proj, cand.id, { patch: { rating: r, reviewState: cand.reviewState === 'new' ? 'kept' : cand.reviewState } }).catch(() => { });
      else this.rateIt(cand.proj, cand.id, r);
    }
    this.ibPatch({ lastCmd: { type: 'rate', r }, selected: {} });
    this.showToast('Rated ' + r + '/5' + (bulk ? ' · ' + targets.length : ''), 'var(--accent)');
    if (!bulk) this.ibAdvance();
  }
  repeatLast() {
    const IB = this.state.inbox; if (!IB || !IB.lastCmd) { this.showToast('Nothing to repeat', 'var(--fg-faint)'); return; }
    const c = IB.lastCmd;
    if (c.type === 'decide') this.ibDecide(c.kind);
    else if (c.type === 'rate') this.ibRate(c.r);
    else if (c.type === 'route') this.ibRoute(c.target);
    else if (c.type === 'reroll') this.ibReroll(true);
  }
  ibReroll(freshSeed) {
    const cand = this.inboxCurrent(); if (!cand) return;
    this.ibPatch({ lastCmd: { type: 'reroll' } });
    if (cand.kind === 'gen') api.rerollCandidate(cand.proj, cand.id, { freshSeed: !!freshSeed }).then(() => this.showToast('Reroll queued', 'var(--accent)')).catch(e => this.showToast('Reroll failed — ' + (e.message || ''), 'var(--danger)'));
    else this.showToast('Legacy item — use note (n) to queue an agent re-roll', 'var(--accent)');
  }
  ibNote(text) {
    const cand = this.inboxCurrent(); if (!cand || !text || !text.trim()) return;
    if (cand.kind === 'gen') {
      api.reviewCandidate(cand.proj, cand.id, { patch: { note: text.trim() } })
        .then(() => api.rerollCandidate(cand.proj, cand.id, { note: text.trim() }))
        .then(() => this.showToast('Note saved → reroll queued', 'var(--accent)')).catch(() => this.showToast('Note failed', 'var(--danger)'));
    } else this.queueNoteFor(cand.proj, cand.id, text.trim());
    this.ibPatch({ noteOpen: false, noteText: '' });
    this.ibAdvance();
  }
  ibRoute(target) {
    const targets = this.ibTargets().filter(t => t.cand.kind === 'gen');
    this.ibPatch({ routeOpen: false, lastCmd: { type: 'route', target }, selected: {} });
    if (!targets.length) { this.showToast('Routing applies to generation candidates', 'var(--accent)'); return; }
    for (const { cand } of targets) {
      if (target === 'shot' && cand.shot) api.saveGenToShot(cand.proj, cand.id, cand.shot).catch(e => this.showToast('Route failed — ' + (e.message || ''), 'var(--danger)'));
      else if (target === 'board') api.promoteCandidate(cand.proj, cand.id, { scope: 'board', folder: 'selects' }).catch(e => this.showToast('Route failed — ' + (e.message || ''), 'var(--danger)'));
      else if (target === 'library') api.promoteCandidate(cand.proj, cand.id, { scope: 'library', folder: '' }).catch(e => this.showToast('Route failed — ' + (e.message || ''), 'var(--danger)'));
    }
    this.showToast((target === 'shot' ? 'Kept for shot' : target === 'board' ? 'Sent to board / selects' : 'Promoted to library') + (targets.length > 1 ? ' · ' + targets.length : ''), 'var(--ok)');
  }
  // I / O set the in / out trim points on the current candidate's shot in the edit manifest. Uses the
  // playing video's currentTime when available, else 0 / shot duration (the smallest useful bridge).
  ibSetInOut(which) {
    const cand = this.inboxCurrent(); if (!cand || !cand.shot) { this.showToast('Set a shot selection first — I/O trim the selects manifest', 'var(--accent)'); return; }
    const vid = document.querySelector('video');
    const t = vid && Number.isFinite(vid.currentTime) ? Math.round(vid.currentTime * 100) / 100 : (which === 'in' ? 0 : null);
    const body = which === 'in' ? { in: t, out: undefined } : { in: undefined, out: t };
    api.setInOut(cand.proj, cand.shot, body.in, body.out)
      .then(() => this.showToast((which === 'in' ? 'In' : 'Out') + ' point set on ' + cand.shot + (t != null ? ' @ ' + t + 's' : ''), 'var(--ok)'))
      .catch(e => this.showToast('Manifest update failed — ' + (e.message || ''), 'var(--danger)'));
  }
  ibReveal() {
    const cand = this.inboxCurrent(); if (!cand) return;
    if (cand.kind === 'gen') api.reveal(cand.proj, cand.savedTo || cand.id).catch(() => { });
    else api.reveal(cand.proj, cand.id).catch(() => { });
    this.showToast('Revealed in Finder', 'var(--fg-soft)');
  }
  ibCopyPrompt() {
    const cand = this.inboxCurrent(); if (!cand) return;
    const text = cand.kind === 'gen' ? (cand.prompt || '') : this.promptOf(cand);
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { });
    this.showToast('Prompt copied', 'var(--accent)');
  }
  ibOpenDetails() {
    const cand = this.inboxCurrent(); if (!cand) return;
    if (cand.kind === 'item') this.openItem(cand.proj, cand.id);
    else this.openProj(cand.proj, 'generate');
  }
  async exitInbox(status) {
    const IB = this.state.inbox;
    if (IB && IB.sessionId) { try { await api.patchSession(IB.sessionId, { cursor: IB.ix, status: status || 'paused', decisions: IB.decisions, reviewedSpend: IB.spend }); } catch { /* */ } }
    this.setState({ inbox: null, page: 'home' });
  }

  // ── keyboard ──
  onKey(e) {
    if (e.target.isContentEditable) return; // the composer's contenteditable prompt — same bail as INPUT/TEXTAREA
    const tag = (e.target.tagName || '').toUpperCase();
    // SELECT included: single-letter shortcuts firing while a native dropdown is focused stole
    // the keystroke (typing "h" to jump options navigated Home and closed the dropdown).
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
    const S = this.state;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.setState(s => ({ paletteOpen: !s.paletteOpen, cheatOpen: false })); return; }
    // ⌘⇧V voice toggle — must sit ABOVE the modifier early-return, since it intentionally needs a modifier.
    if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); window.dispatchEvent(new CustomEvent('frameforge:voice-toggle')); return; }
    // ⌘/⌃ + [ or ] → browser/Electron back / forward through the location history (Phase 6)
    if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']')) { e.preventDefault(); if (e.key === '[') window.history.back(); else window.history.forward(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // never hijack OS/browser shortcuts (⌘R, ⌘X, ⌘S…)
    if (S.paletteOpen) return; // the palette owns the keyboard while open
    if (S.styleLockPickerOpen) return; // the style-lock picker owns the keyboard while open
    const K = resolveKeys(S.settings);
    const kk = e.key === ' ' ? ' ' : e.key.toLowerCase();
    if (S.cheatOpen) { if (e.key === 'Escape' || kk === K.help) this.setState({ cheatOpen: false }); return; }
    if (kk === K.help && !typing) { e.preventDefault(); this.setState({ cheatOpen: true }); return; }
    // DEV-123 — `/` is now an ALIAS for ⌘K rather than a second search surface. Kept (rather than
    // retired) because it is muscle memory and costs nothing once both open the same thing.
    if (kk === K.search && !typing) { e.preventDefault(); this.setState({ paletteOpen: true, cheatOpen: false }); return; }
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
    if (S.quickNoteOpen) { if (e.key === 'Escape') this.setState({ quickNoteOpen: false }); return; }
    if (S.browser) { if (e.key === 'Escape') this.setState({ browser: null }); return; }
    if (S.confirmEmpty) { if (e.key === 'Escape') this.setState({ confirmEmpty: false }); return; }
    if (S.ctxDelFolder) { if (e.key === 'Escape') this.setState({ ctxDelFolder: null }); return; }
    if (S.npOpen) { if (e.key === 'Escape') this.setState({ npOpen: false }); return; }
    if (S.archiveAsk) { if (e.key === 'Escape') this.setState({ archiveAsk: null }); return; }
    if (S.projSettingsOpen) { if (e.key === 'Escape') this.setState({ projSettingsOpen: false }); return; }
    if (S.projMenu) { if (e.key === 'Escape') this.setState({ projMenu: null }); return; }
    // ── rebindable globals: style-lock picker (s), quick-note (n), Memory (m), Generate tab (g) ──
    // Gated BELOW every blocking overlay: palette/style-lock picker returned early up top, and each
    // App-owned modal (quick-note, new-project, archive, project-settings, project menu) returns just
    // above — so a global can't fire behind an open modal (e.g. the ⚙ Project Settings modal, whose
    // trigger leaves focus on a non-input). Story/ProjectGenerate own `s` in their own capture-phase
    // handlers + stopPropagation, so this never double-fires there; n/m/g stay inert during review and
    // on the item page so they can't clobber those contexts' own keys.
    // Report a problem. Placed with the other globals but ABOVE the context-sensitive ones on
    // purpose: the moment you most need to file a bug is the moment the app is misbehaving, and a
    // shortcut that only works on the right page is no use then. It works during review too.
    if (kk === K.feedback && !S.feedbackOpen && isEnabled(S.settings, 'feedback')) { e.preventDefault(); this.openFeedback(); return; }
    if (kk === K.styleLocks) { e.preventDefault(); this.openStyleLockPicker(S.proj); return; }
    // `i` opens/resumes the Inbox from anywhere (not while reviewing, on the item page, or already in it)
    if (kk === K.inbox && !S.review && S.page !== 'item' && S.page !== 'inbox') { e.preventDefault(); this.openInbox(); return; }
    if (kk === K.queue && !S.review && S.page !== 'item' && S.page !== 'inbox') { e.preventDefault(); this.go('queue'); return; }
    if (kk === K.quickNote && !S.review && S.page !== 'item' && S.page !== 'inbox') { e.preventDefault(); this.openQuickNote(); return; }
    if (kk === K.openMemory && !S.review && S.page !== 'item' && S.page !== 'inbox') { e.preventDefault(); this.openMemoryTab(); return; }
    if (kk === K.projGenerate && !S.review && S.page !== 'item' && S.page !== 'inbox') { e.preventDefault(); this.jumpToGenerate(); return; }
    const k = e.key.toLowerCase();
    if (S.review) {
      const R = S.review;
      // note popover open: let Escape close it even after the textarea loses focus (otherwise
      // clicking outside the textarea left every key — Esc included — dead but for the ✕).
      if (R.noteOpen) { if (k === 'escape') { e.preventDefault(); this.rvPatch({ noteOpen: false }); } return; }
      if (k === 'escape') { e.preventDefault(); this.exitReview(); }
      else if (kk === K.keep) { e.preventDefault(); this.rvDecide('keep'); }
      else if (kk === K.kill) { e.preventDefault(); this.rvDecide('kill'); }
      else if (kk === K.note && !R.done) { e.preventDefault(); const id = R.ids[R.ix]; const cur = this.getItem(R.pid, id); this.rvPatch({ noteOpen: true, noteText: cur && cur.fbState ? '' : (cur ? cur.note || '' : '') }); }
      else if (kk === K.undo) { e.preventDefault(); this.rvUndo(); }
      else if (k === 'arrowright' && !R.done) { e.preventDefault(); this.rvPatch({ ix: Math.min(R.ids.length - 1, R.ix + 1), anim: null }); }
      else if (k === 'arrowleft') { e.preventDefault(); this.rvPatch({ ix: Math.max(0, R.ix - 1), anim: null, done: false }); }
      else if (kk === K.play) { e.preventDefault(); this.rvPatch({ playing: !R.playing }); }
      return;
    }
    if (S.page === 'inbox') {
      // holding a decision key (k/x/…) auto-repeats and would queue one network write per
      // repeat — swallow repeats for everything except arrow/j navigation, which is local
      if (e.repeat && !(k === 'arrowright' || k === 'arrowleft' || kk === 'j')) return;
      const IB = S.inbox;
      if (!IB) { if (k === 'escape') this.go('home'); return; }
      if (IB.noteOpen) { if (k === 'escape') { e.preventDefault(); this.ibPatch({ noteOpen: false }); } return; }
      if (IB.routeOpen) {
        if (k === 'escape') { e.preventDefault(); this.ibPatch({ routeOpen: false }); }
        else if (k === 's') { e.preventDefault(); this.ibRoute('shot'); }
        else if (k === 'b') { e.preventDefault(); this.ibRoute('board'); }
        else if (k === 'l') { e.preventDefault(); this.ibRoute('library'); }
        return;
      }
      const done = IB.ix >= IB.keys.length;
      if (k === 'escape') { e.preventDefault(); if (Object.keys(IB.selected || {}).length) this.ibPatch({ selected: {} }); else this.exitInbox('paused'); }
      else if (k === 'arrowright' && e.shiftKey) { e.preventDefault(); this.ibExtendSelect(1); }
      else if (k === 'arrowleft' && e.shiftKey) { e.preventDefault(); this.ibExtendSelect(-1); }
      else if (k === 'arrowright' || kk === 'j') { e.preventDefault(); this.ibNav(1); }
      else if (k === 'arrowleft') { e.preventDefault(); this.ibNav(-1); }
      else if (kk === 'v') { e.preventDefault(); this.ibToggleSelect(); }
      else if (e.key === 'I') { e.preventDefault(); this.ibSetInOut('in'); }
      else if (e.key === 'O') { e.preventDefault(); this.ibSetInOut('out'); }
      else if (k === '.') { e.preventDefault(); this.repeatLast(); }
      else if (done) { /* zero/summary state — only navigation + escape above */ }
      else if (kk === K.keep) { e.preventDefault(); this.ibDecide('keep'); }
      else if (kk === K.kill) { e.preventDefault(); this.ibDecide('kill'); }
      else if (k >= '1' && k <= '5') { e.preventDefault(); this.ibRate(+k); }
      else if (kk === K.final) { e.preventDefault(); this.ibDecide('final'); }
      else if (kk === K.note) { e.preventDefault(); const c = this.inboxCurrent(); this.ibPatch({ noteOpen: true, noteText: (c && c.note) || '' }); }
      else if (k === 'r') { e.preventDefault(); this.ibReroll(true); }
      else if (k === 'a') { e.preventDefault(); this.ibPatch({ routeOpen: true }); }
      else if (kk === K.copyPrompt) { e.preventDefault(); this.ibCopyPrompt(); }
      else if (kk === K.reveal) { e.preventDefault(); this.ibReveal(); }
      else if (kk === K.play) { e.preventDefault(); this.ibPatch({ playing: !IB.playing }); }
      else if (k === 'enter') { e.preventDefault(); this.ibOpenDetails(); }
      else if (kk === K.undo) { e.preventDefault(); this.doUndo(); }
      return;
    }
    if (S.page === 'project') {
      // digits 1–6 switch project tabs (typing already returned above; item-page 1–5 rating is a
      // separate branch below, so this can't shadow it).
      // The range is 1–9, not 1–6: PROJ_TAB_IDS holds eight tabs, so a hard '6' cap left the last
      // two unreachable — the same class of bug as the drift it replaced, one layer further out.
      // `tabs[+k - 1]` is already undefined past the end, so the cap only has to not truncate.
      if (k >= '1' && k <= '9') {
        // ONE list, shared with the rendered strip (see PROJ_TAB_IDS). Keeping a second copy here
        // is what put the digits out of step: the strip gained a Timeline tab and this list did
        // not, so 4 selected Assets while the 4th tab on screen was Timeline, everything after it
        // was off by one, and the last tab could not be reached by keyboard at all.
        const tabs = projTabIds(S);
        const t = tabs[+k - 1];
        if (t) { e.preventDefault(); this.setState({ projTab: t, briefEdit: false, ctxNoteOpen: false }); }
        return;
      }
      if (kk === K.review) { e.preventDefault(); this.startReview(); }
      else if (k === 'escape') { if (Object.keys(S.sel).length || Object.keys(S.ctxSel).length) this.setState({ sel: {}, ctxSel: {} }); else this.go('home'); }
      return;
    }
    if (S.page === 'item') {
      const id = S.item, pid = S.proj;
      if (kk === K.keep) { e.preventDefault(); this.keepIt(pid, id); }
      else if (kk === K.kill) { e.preventDefault(); this.killIt(pid, id); }
      else if (k >= '1' && k <= '5') { e.preventDefault(); this.rateIt(pid, id, +k); }
      else if (kk === K.play) { e.preventDefault(); this.setState({ playing: !S.playing }); }
      else if (kk === K.final) { e.preventDefault(); this.toggleFinal(); }
      else if (kk === K.copyPrompt) { e.preventDefault(); this.copyPrompt(); }
      else if (kk === K.compare) { e.preventDefault(); this.toggleAB(); }
      else if (kk === K.reveal) { e.preventDefault(); api.reveal(pid, id).then(() => this.showToast('Revealed in Finder', 'var(--fg-soft)')).catch(() => { }); }
      else if (kk === K.undo) { e.preventDefault(); this.doUndo(); }
      else if (k === 'arrowleft') { e.preventDefault(); this.setState({ tc: Math.max(0, S.tc - 0.5), playing: false }); }
      else if (k === 'arrowright') { e.preventDefault(); const it = this.getItem(pid, id); if (it) this.setState({ tc: Math.min(it.durS, S.tc + 0.5), playing: false }); }
      else if (k === 'escape') { this.openProj(S.proj); }
      return;
    }
    if (k === 'escape' && S.page === 'skills' && S.skillSel) this.setState({ skillSel: null, skillEdit: false, enhanceOpen: false });
    else if (k === 'escape' && S.page === 'tools' && S.toolsSel) this.setState({ toolsSel: null, genShot: null, pbShot: null, lookAsset: null, pbInsert: null, genModel: null, genPrompt: null });
    else if (k === 'escape' && S.page !== 'home') this.go('home');
    else if (kk === K.undo) this.doUndo();
    else if (kk === K.goHome && S.page !== 'home') this.go('home');
    else if (kk === K.goTools && S.page !== 'tools') this.go('tools');
    else if (kk === K.goLibrary && S.page !== 'library') this.go('library');
  }

  // ════════ RENDER ════════
  render() {
    const S = this.state;
    if (!S.loaded) return <div style={sx('height:100vh;display:flex;align-items:center;justify-content:center;color:var(--fg-faint);font-size:12px;letter-spacing:.2em')}>FRAMEFORGE</div>;
    // The Agent surface is a LOCKED shell: its rails and the floating composer are positioned against
    // this box, so the PAGE must not scroll behind them — only the transcript column scrolls, inside.
    // (It used to be a normal document-scroll page with the chat sized `calc(100vh - 196px)`, which
    // overflowed by exactly the project chrome + the wrapper's 90px tail — scrolling then dragged the
    // rails and the composer out of frame.) Every other page keeps the normal document scroll.
    const agentLocked = (S.modules || {}).chat !== false
      && (S.page === 'chat' || (S.page === 'project' && S.projTab === 'chat'));
    // The Board is the same shape of surface as the Agent tab — a locked column that fills the
    // window and scrolls nothing at the page level, because its own canvas owns the scrolling.
    const boardTab = S.page === 'project' && S.projTab === 'board';
    // Full screen drops the app bar as well as the project chrome. It is a MODE, not a browser
    // API: real Fullscreen would take the whole display and break ⌘-tab and the Electron menu,
    // and what a filmmaker wants here is "give the canvas the window", not "take over my screen".
    const boardFull = boardTab && !!S.boardFull;
    const locked = agentLocked || boardTab;
    return (
      <div style={sx('height:100vh;display:flex;flex-direction:column;background:var(--ink);overflow:hidden')}>
        {S.offline && (
          <div style={{ ...sx('flex:none;display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 12px;background:rgba(240,91,84,.15);border-bottom:1px solid var(--danger);color:var(--danger);font-size:10.5px;font-weight:700;letter-spacing:.08em'), fontFamily: MONO }}>
            <span style={sx('width:7px;height:7px;border-radius:99px;background:var(--danger)')} />
            BACKEND UNREACHABLE — RETRYING · CHANGES WON'T SAVE UNTIL IT'S BACK
          </div>
        )}
        {!boardFull && this.renderTop()}
        <div style={{ ...sx('flex:1;position:relative;min-height:0'),
          overflowY: locked ? 'hidden' : 'auto',
          ...(locked ? sx('display:flex;flex-direction:column') : null) }}>
          {S.page === 'home' && this.renderHome()}
          {S.page === 'project' && this.renderProject()}
          {S.page === 'item' && this.renderItem()}
          {S.page === 'costs' && this.renderCosts()}
          {S.page === 'trash' && this.renderTrash()}
          {S.page === 'queue' && this.renderQueue()}
          {S.page === 'skills' && this.renderSkills()}
          {S.page === 'library' && <LibraryPage app={this} />}
          {/* ticket 24 — standalone Filmmaker Chat: same component, no project. pid null hides the
              Production Panel, disables attachments + manual generate, and offers promote-to-project. */}
          {S.page === 'chat' && (S.modules || {}).chat !== false && <Chat app={this} pid={null} pdef={null} key="standalone-chat" />}
          {S.page === 'tools' && <Tools app={this} />}
          {S.page === 'toolsmith' && (S.modules || {}).chat !== false && <ToolsmithChat app={this} />}
          {S.page === 'remotion' && <RemotionLibrary app={this} />}
          {S.page === 'settings' && this.renderSettings()}
        </div>
        {S.review && this.renderReview()}
        {S.page === 'inbox' && <ReviewInbox app={this} />}
        {this.renderAgentDock()}
        {S.toasts.length > 0 && this.renderToast()}
        {S.confirmEmpty && this.renderConfirmEmpty()}
        {S.ctxDelFolder && this.renderConfirmDelFolder()}
        {S.browser && this.renderBrowser()}
        {S.npOpen && this.renderNewProject()}
        {S.archiveAsk && this.renderArchiveAsk()}
        {S.projSettingsOpen && this.renderProjSettings()}
        {S.quickNoteOpen && this.renderQuickNote()}
        {S.animGen && this.renderAnimateComposer()}
        {/* The global `s` overlay. Inside the composer, ProjectGenerate opens its OWN StyleLab
            (capture-phase `s` + stopPropagation) so Apply lands directly on its style/camera
            state; this mount is the fallback everywhere else. Same component either way — there
            is no separate "picker" any more, so building a new style is always one click from
            picking an old one. */}
        {S.styleLockPickerOpen && (
          <StyleLab app={this} page={false} tab={S.styleLockTab || 'styles'} locks={S.styleLocks || []}
            style={(S.activeStyleLocks[this._styleLockTarget || S.proj] && styleFromLock(S.activeStyleLocks[this._styleLockTarget || S.proj])) || null}
            onClose={() => this.setState({ styleLockPickerOpen: false })}
            onApply={({ style, camera, aspect }) => this.applyStyleSelection({ style, camera, aspect })} />
        )}
        {this.renderFeedbackFab()}
        {S.paletteOpen && <Palette app={this} onClose={() => this.setState({ paletteOpen: false })} />}
        {S.cheatOpen && this.renderCheatSheet()}
        {/* Rendered last and over everything, including review mode and the item page: the moment
            you most need to file a bug is the moment the app is misbehaving. */}
        {S.feedbackOpen && (
          <Feedback
            where={S.where}
            email={(S.settings && S.settings.contactEmail) || ''}
            snippets={S.snippets || []}
            onClose={() => this.setState({ feedbackOpen: false })}
            onSent={r => this.showToast(
              r.queued ? 'Report ' + r.code + ' saved — it will send when you are back online' : 'Report ' + r.code + ' received — thank you',
              r.queued ? 'var(--warn)' : 'var(--ok)')} />
        )}
        {/* one global voice-input instance — ⌘⇧V dispatches frameforge:voice-toggle; hidden button */}
        <div style={{ display: 'none' }}><VoiceInput app={this} global /></div>
      </div>
    );
  }

  // quick-note overlay (n) — a frictionless capture that prepends a dated bullet to the current
  // project's memory doc (the same doc References → Memory edits). Includes a mic for dictation.
  renderQuickNote() {
    const S = this.state;
    const pdef = S.quickNoteProj ? this.projDef(S.quickNoteProj) : null;
    return (
      <div onClick={() => this.setState({ quickNoteOpen: false })} style={sx('position:fixed;inset:0;z-index:92;background:rgba(5,6,8,.7);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding-top:20vh')}>
        <div onClick={e => e.stopPropagation()} style={sx('width:520px;padding:18px 20px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
          <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:12px')}>
            <span style={sx('font-size:10px;font-weight:700;letter-spacing:.16em;color:var(--fg-muted)')}>REMEMBER</span>
            <span style={sx('font-size:11px;color:var(--fg-muted)')}>{pdef ? 'for ' + pdef.name : 'no project open'}</span>
            <span style={sx('margin-left:auto;font-size:10px;color:var(--fg-faint)')}>⏎ save · Esc cancel</span>
          </div>
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <input value={S.quickNoteText} autoFocus onChange={e => this.setState({ quickNoteText: e.target.value })}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.submitQuickNote(); else if (e.key === 'Escape') this.setState({ quickNoteOpen: false }); }}
              placeholder="remember this…"
              style={sx('flex:1;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:13px;padding:10px 12px')} />
            <VoiceInput app={this} size={26} onText={t => this.setState(s => ({ quickNoteText: (s.quickNoteText ? s.quickNoteText.trim() + ' ' : '') + t }))} />
            <Btn variant="primary" disabled={!S.quickNoteText.trim()} onClick={() => this.submitQuickNote()} style={{ padding: '9px 16px' }}>Remember</Btn>
          </div>
        </div>
      </div>
    );
  }

  renderTop() {
    const S = this.state;
    const items = S.items;
    const monthTotal = this.monthSpend();
    const pace = (monthTotal / S.settings.budget) / this.monthFrac().frac;
    const paceHot = pace > 1.25;
    // INBOX count = candidates that are genuinely unreviewed (new completed gens + legacy new items)
    const inboxN = items.filter(x => x.st === 'new' && !x.trashed).length +
      S.projects.reduce((a, p) => a + (p.gens || []).filter(g => g.status === 'done' && g.reviewState === 'new').length, 0);
    const pdef = S.proj ? this.projDef(S.proj) : null;
    const crumb = S.page === 'project' || S.page === 'item' ? (pdef && pdef.name) : S.page === 'costs' ? 'Costs' : S.page === 'trash' ? 'Trash' : S.page === 'settings' ? 'Settings' : S.page === 'library' ? 'Library' : S.page === 'chat' ? 'Chat' : S.page === 'tools' ? 'Tools' : S.page === 'toolsmith' ? 'Tools' : S.page === 'remotion' ? 'Remotion' : '';
    const crumb2 = S.page === 'item' && this.getItem(S.proj, S.item) ? this.getItem(S.proj, S.item).name : '';
    // DEV-123 — the topbar's own result builder (PROJ / SHOT / LIB / item-by-prompt) is gone; every
    // one of those groups now lives in Palette.items(), which already had the first three and gained
    // ITEMS. Deleting it here is the point of the ticket: one matcher, not two that drift.
    const mon = new Date().toLocaleString('en-US', { month: 'short' }).toUpperCase();
    return (
      <div style={sx('display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;min-height:54px;padding:6px 22px;border-bottom:1px solid var(--border);flex:none;position:relative;z-index:40')}>
        <div onClick={() => this.go('home')} className="hAccent" style={sx('flex:none;font-weight:800;font-size:15px;letter-spacing:.22em;cursor:pointer')}>FRAMEFORGE</div>
        {crumb && (
          <div style={sx('display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--fg-faint);min-width:0;max-width:260px')}>
            <span>/</span>
            <span onClick={() => S.proj && (S.page === 'item' || S.page === 'project') ? this.openProj(S.proj) : this.go('home')} className="hFg" style={sx('color:var(--fg-soft);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{crumb}</span>
            {crumb2 && <><span>/</span><span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: '11.5px', color: 'var(--fg-muted)' }}>{crumb2}</span></>}
          </div>
        )}
        {/* DEV-123 — ONE search surface. This used to be a second, independent search input with
            its own matcher, its own results dropdown and its own ↑↓/Enter handling, sitting next
            to a ⌘K palette that did all of the same things better (typed filters, server search,
            actions). Two divergent search UIs is the thing the ticket asked to end, so the input
            is now a BUTTON that opens the palette. The affordance stays — a filmmaker who reaches
            for the search box still finds one — but there is only one implementation behind it. */}
        <div onClick={() => this.setState({ paletteOpen: true, cheatOpen: false })}
          title="Search and jump — projects, shots, assets, prompts, actions"
          className="hBd"
          style={sx('display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border:1px solid var(--border-2);border-radius:8px;background:var(--surface-2);cursor:pointer;flex:1 1 220px;min-width:150px;max-width:360px')}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="var(--fg-faint)" strokeWidth="1.5" /><path d="M9.5 9.5L13 13" stroke="var(--fg-faint)" strokeWidth="1.5" /></svg>
          <span style={sx('flex:1;color:var(--fg-faint);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>Search projects, prompts, filenames…</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '1px 5px' }}>⌘K</span>
        </div>
        <div style={sx('margin-left:auto;display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;white-space:nowrap')}>
          {/* Beta report. Sits in the chrome rather than as a floating FAB: a FAB covers content,
              and the thing it covers is disproportionately the thing being reported. */}
          {isEnabled(S.settings, 'feedback') && (
            <Btn onClick={() => this.openFeedback()} data-ff="report-top" title="Send feedback (f)"
              style={{ padding: '5px 11px', borderRadius: 999 }}>
              <span style={sx('font-size:11.5px;color:var(--fg-faint)')}>Feedback</span>
            </Btn>
          )}
          <Btn onClick={() => this.openInbox()} className="hBdAccent" title="Review Inbox (i)" style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid ' + (inboxN ? 'var(--accent-60)' : 'var(--border-2)'), background: inboxN ? 'var(--accent-05)' : 'transparent' }}>
            <span style={{ ...sx('font-size:10.5px;font-weight:800;letter-spacing:.14em'), color: inboxN ? 'var(--accent)' : 'var(--fg-muted)' }}>INBOX</span>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: inboxN ? 'var(--accent)' : 'var(--fg-faint)' }}>{inboxN}</span>
          </Btn>
          {/* Budget state is carried by the stripe, not by the numeral's colour — readable
              without parsing the figure or the word next to it. */}
          <Btn onClick={() => this.go('costs')} title={paceHot ? 'Ahead of even pace for the month' : 'On track for the month'}
            style={{ padding: '5px 12px', borderRadius: 999, gap: 8 }}>
            <span style={{ ...sx('width:3px;height:14px;border-radius:2px;flex:none'), background: paceHot ? 'var(--warn)' : 'var(--ok)' }} />
            <span style={sx('font-size:10.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-muted)')}>{mon}</span>
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--fg-soft)' }}>{this.fmt$(monthTotal)}</span>
          </Btn>
          {/* status ends · destinations begin */}
          <span style={sx('width:1px;height:18px;background:var(--border);flex:none')} />
          {/* destinations — real buttons (ticket 02B); the active page carries the same inset
              accent underline the project tab row uses, so "where am I" is form, not color alone */}
          {[
            ['library', 'Library', () => this.go('library'), S.page === 'library'],
            ...((S.modules || {}).chat !== false ? [['chat', 'Chat', () => this.go('chat'), S.page === 'chat']] : []),
            ['tools', 'Tools', () => this.go('tools'), S.page === 'tools' || S.page === 'toolsmith'],
            ['skills', 'Skills', () => this.go('skills'), S.page === 'skills'],
            /* Remotion lives under Tools, Trash under Settings — the top bar stays to five destinations.
               Both pages still route directly (command palette), they just aren't peers up here. */
            ['settings', 'Settings', () => this.go('settings'), S.page === 'settings' || S.page === 'trash']
          ].map(([id, label, go, on]) => (
            <Btn key={id} onClick={go} className="hFg"
              style={{ border: 'none', borderRadius: 0, padding: '2px 0', fontSize: 12, fontWeight: on ? 600 : 400, color: on ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: on ? 'inset 0 -2px 0 var(--accent)' : 'none' }}>{label}</Btn>
          ))}
          {/* DEV-123 — the cheat sheet has existed since Phase 1 and was reachable ONLY by pressing
              `?`, which you cannot discover by pressing `?`. A visible control makes the whole
              keyboard layer findable; it is also listed in the palette under ACTIONS. */}
          <Btn onClick={() => this.setState({ cheatOpen: true, paletteOpen: false })} className="hFg"
            title="Keyboard shortcuts (?)"
            style={{ padding: '2px 7px', borderRadius: 6, border: '1px solid var(--border-2)', fontFamily: MONO, fontSize: 11, color: 'var(--fg-muted)' }}>?</Btn>
        </div>
      </div>
    );
  }

  // DEV-122 — rail + feed preferences. localStorage, not settings.md: this is per-screen furniture
  // for THIS machine, and routing it through the settings PUT would put a network round-trip behind
  // a chevron (and race the poll's settings write-back, which is a bug this app has already had).
  setRail(open) {
    this.setState({ railOpen: open });
    try { localStorage.setItem('frfg.home.rail', open ? '1' : '0'); } catch { /* private mode */ }
  }
  toggleActType(id) {
    this.setState(s => {
      const next = { ...(s.actHidden || {}) };
      if (next[id]) delete next[id]; else next[id] = true;
      try { localStorage.setItem('frfg.home.actHidden', JSON.stringify(next)); } catch { /* private mode */ }
      return { actHidden: next };
    });
  }

  renderHome() {
    const S = this.state;
    const items = S.items;
    const live = items.filter(x => !x.trashed);
    const monthTotal = this.monthSpend();
    const weekTotal = this.weekSpend();
    const mf = this.monthFrac();
    const keptItems = live.filter(x => x.st === 'kept');
    // DEV-122 — the feed was `S.activity.slice(0, 8)`: no day boundaries, no way to mute a noisy
    // type, and a hard 8 that silently hid everything else. Now: filtered by type, grouped by day,
    // capped PER DAY with an explicit "show more" so nothing is dropped without saying so.
    const hidden = S.actHidden || {};
    const visible = S.activity.filter(e => !hidden[activityType(e)]);
    const days = groupByDay(visible).map(g => ({
      ...g,
      events: g.events.map(e => ({
        dot: DOTC[e.dot] || 'var(--fg-faint)', t: e.t, t2: e.t2, s: e.s,
        bg: e.hl ? 'rgba(63,207,142,.03)' : 'transparent',
        go: () => { if (e.kind === 'proj') this.openProj(e.ref); else if (e.kind === 'item' && this.resolveItem(e.ref)) this.openItem(e.ref); }
      }))
    }));
    const perDay = S.actExpanded ? Infinity : ACT_PER_DAY;
    const railOpen = S.railOpen !== false;
    const projCards = S.projects.map(p => {
      const mine = live.filter(x => x.proj === p.id);
      const clips = mine.filter(x => x.type === 'clip').length;
      const imgs = mine.filter(x => x.type === 'img' || x.type === 'style').length;
      const total = mine.length;
      const reviewed = mine.filter(x => x.st !== 'new').length;
      const newN = total - reviewed;
      const cost = this.projSpend(p.id);
      return {
        id: p.id, name: p.name, grad: gradOf(p), poster: this.projPoster(p.id), when: p.when,
        sub: p.sub + ' · ' + clips + ' clips · ' + imgs + ' images', cost: this.fmt$(cost),
        badge: newN > 0 ? newN + ' NEW' : (total && reviewed === total ? 'CLEARED' : ''),
        badgeFg: newN > 0 ? 'var(--accent)' : 'var(--ok)',
        badgeBd: newN > 0 ? 'var(--accent-35)' : 'rgba(63,207,142,.4)',
        pct: total ? Math.round(reviewed / total * 100) : 0, prog: reviewed + '/' + total
      };
    });
    return (
      <div style={{ ...sx('display:grid;min-height:100%'), gridTemplateColumns: railOpen ? 'minmax(300px,400px) 1fr' : '42px 1fr' }}>
        <div style={sx('border-right:1px solid var(--border);padding:20px 0 24px;min-width:0;overflow:hidden')}>
          {/* header — the caret is the collapse toggle. Collapsed, the rail keeps a 42px gutter so
              the control that re-opens it is always exactly where it was. */}
          <div style={{ ...sx('display:flex;align-items:center;gap:9px;margin-bottom:10px'), padding: railOpen ? '0 24px' : '0 13px' }}>
            <span onClick={() => this.setRail(!railOpen)} className="hFg"
              title={railOpen ? 'Collapse this rail' : 'Show recent activity'}
              style={{ ...sx('cursor:pointer;flex:none'), fontFamily: MONO, fontSize: 11, color: 'var(--fg-faint)' }}>{railOpen ? '‹' : '›'}</span>
            {railOpen && <span style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted)')}>WHAT HAPPENED LAST</span>}
          </div>
          {railOpen && (
            <>
              {/* per-type filter chips — click to mute a type. Persisted, so a filmmaker who never
                  wants to see 3D exports again does not re-mute them every morning. */}
              <div style={sx('display:flex;flex-wrap:wrap;gap:5px;padding:0 24px 12px')}>
                {ACTIVITY_TYPES.map(t => {
                  const off = !!hidden[t.id];
                  const n = S.activity.filter(e => activityType(e) === t.id).length;
                  if (!n) return null;
                  return (
                    <span key={t.id} onClick={() => this.toggleActType(t.id)} className="hBd"
                      title={(off ? 'Show ' : 'Hide ') + t.label.toLowerCase() + ' · ' + n + ' event' + (n === 1 ? '' : 's')}
                      style={{
                        ...sx('border-radius:999px;padding:2px 9px;cursor:pointer'), fontFamily: MONO, fontSize: 9,
                        color: off ? 'var(--fg-faint)' : 'var(--fg-soft)',
                        border: '1px solid ' + (off ? 'var(--border)' : 'var(--border-3)'),
                        background: off ? 'transparent' : 'var(--raise)',
                        textDecoration: off ? 'line-through' : 'none'
                      }}>{t.label} {n}</span>
                  );
                })}
              </div>
              {!days.length && (
                <div style={{ ...sx('padding:14px 24px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10 }}>
                  {S.activity.length ? 'Every type is hidden — un-mute one above.' : 'Nothing yet.'}
                </div>
              )}
              {days.map(g => (
                <div key={g.key}>
                  <div style={{ ...sx('padding:12px 24px 5px;letter-spacing:.16em;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 8.5 }}>{g.label}</div>
                  {g.events.slice(0, perDay).map((a, i) => (
                    <div key={i} onClick={a.go} className="hBg" style={{ ...sx('display:flex;gap:12px;padding:11px 24px;border-bottom:1px solid var(--line);align-items:flex-start;cursor:pointer'), background: a.bg }}>
                      <div style={{ ...sx('width:8px;height:8px;border-radius:99px;margin-top:5px;flex:none'), background: a.dot }} />
                      <div style={sx('flex:1;min-width:0')}>
                        <div style={sx('font-size:12.5px;line-height:1.45')}><span style={sx('font-weight:600')}>{a.t}</span> <span style={sx('color:var(--fg-muted)')}>{a.t2}</span></div>
                        <div style={sx('font-size:11px;color:var(--fg-faint);margin-top:2px')}>{a.s}</div>
                      </div>
                    </div>
                  ))}
                  {g.events.length > perDay && (
                    <div onClick={() => this.setState({ actExpanded: true })} className="hFg"
                      style={{ ...sx('padding:8px 24px;cursor:pointer;color:var(--accent)'), fontFamily: MONO, fontSize: 9.5 }}>
                      + {g.events.length - perDay} more on this day
                    </div>
                  )}
                </div>
              ))}
              {S.actExpanded && (
                <div onClick={() => this.setState({ actExpanded: false })} className="hFg"
                  style={{ ...sx('padding:8px 24px;cursor:pointer;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>collapse</div>
              )}
            </>
          )}
        </div>
        <div style={sx('padding:20px 24px 32px;min-width:0')}>
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:22px')}>
            {[
              ['THIS MONTH', this.fmt$(monthTotal), 'of $' + S.settings.budget + ' budget · day ' + mf.day + ' of ' + mf.days, 'var(--sand)', 'var(--fg-faint)'],
              ['THIS WEEK', this.fmt$(weekTotal), 'ledger spend, last 7 days', 'var(--fg)', 'var(--fg-faint)'],
              ['COST / KEPT ITEM', keptItems.length ? this.fmt$(monthTotal / keptItems.length) : '—', 'across ' + keptItems.length + ' kept items', 'var(--fg)', 'var(--fg-faint)']
            ].map(([label, big, sub, bigC, subC], i) => (
              <div key={i} onClick={() => this.go('costs')} className="hBd" style={sx('padding:14px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);cursor:pointer')}>
                <div style={sx('font-size:10.5px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted)')}>{label}</div>
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, marginTop: 6, fontVariantNumeric: 'tabular-nums', color: bigC }}>{big}</div>
                <div style={{ fontSize: 11, marginTop: 2, color: subC }}>{sub}</div>
              </div>
            ))}
          </div>
          <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px')}>
            <div style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted)')}>PROJECTS</div>
            <div style={sx('font-size:11px;color:var(--fg-faint)')}>drag cards to reorder</div>
          </div>
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px')}>
            {projCards.map(p => (
              <div key={p.id} onClick={() => this.openProj(p.id)} className="hCard"
                draggable
                onDragStart={e => { this._projDrag = p.id; e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={e => { if (this._projDrag && this._projDrag !== p.id) { e.preventDefault(); if (S.projDragOver !== p.id) this.setState({ projDragOver: p.id }); } }}
                onDrop={e => { e.preventDefault(); this.dropProjReorder(p.id); }}
                onDragEnd={() => { this._projDrag = null; this.setState({ projDragOver: null }); }}
                style={{ ...sx('position:relative;border-radius:12px;background:var(--surface);padding:14px;display:flex;gap:14px;cursor:pointer'), border: '1px solid ' + (S.projDragOver === p.id ? 'var(--accent)' : 'var(--border-2)'), opacity: this._projDrag === p.id ? .5 : 1 }}>
                {/* the gradient stays as the bed — it shows through while the poster decodes and
                    is the whole thumbnail for a project that has generated nothing yet */}
                <div style={{ ...sx('position:relative;width:118px;height:74px;border-radius:8px;flex:none;overflow:hidden'), background: p.grad }}>
                  {p.poster && <RenderMedia src={p.poster} fit="cover" hoverPlay={false} alt=""
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                    style={sx('width:100%;height:100%;display:block')} />}
                </div>
                <div style={sx('flex:1;min-width:0')}>
                  <div style={sx('display:flex;align-items:center;gap:8px')}>
                    <span style={sx('font-weight:700;font-size:13.5px')}>{p.name}</span>
                    {p.badge && <span style={{ ...sx('font-size:10px;font-weight:700;border-radius:99px;padding:1px 7px'), color: p.badgeFg, border: '1px solid ' + p.badgeBd }}>{p.badge}</span>}
                    <span onClick={e => { e.stopPropagation(); this.setState(s => ({ projMenu: s.projMenu === p.id ? null : p.id })); }}
                      className="hBg" style={sx('margin-left:auto;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--fg-faint);font-weight:700;font-size:13px;flex:none')}>⋯</span>
                  </div>
                  <div style={sx('font-size:11.5px;color:var(--fg-muted);margin-top:3px')}>{p.sub} · <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--sand)' }}>{p.cost}</span></div>
                  <div style={sx('display:flex;align-items:center;gap:8px;margin-top:9px')}>
                    <div style={sx('flex:1;height:4px;border-radius:99px;background:var(--border);overflow:hidden')}><div style={{ ...sx('height:100%;background:var(--ok);border-radius:99px'), width: p.pct + '%' }} /></div>
                    <span style={{ fontFamily: MONO, fontSize: '10.5px', fontVariantNumeric: 'tabular-nums', color: 'var(--fg-muted)' }}>{p.prog}</span>
                  </div>
                  <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:6px')}>{p.when}</div>
                </div>
                {S.projMenu === p.id && (
                  <div onClick={e => e.stopPropagation()} style={sx('position:absolute;top:38px;right:12px;min-width:160px;border:1px solid var(--border-3);border-radius:10px;background:var(--surface-2);box-shadow:0 16px 48px rgba(0,0,0,.7);z-index:10;animation:dl-in .12s ease-out;overflow:hidden')}>
                    <div onClick={() => { this.setState({ projMenu: null }); this.openProj(p.id); }} className="hRow" style={sx('padding:8px 13px;font-size:11.5px;color:var(--fg-soft);cursor:pointer;border-bottom:1px solid var(--line)')}>Open</div>
                    <div onClick={() => this.setState({ projMenu: null, archiveAsk: p.id })} className="hRow" style={sx('padding:8px 13px;font-size:11.5px;color:var(--danger);cursor:pointer')}>Archive project…</div>
                  </div>
                )}
              </div>
            ))}
            <div onClick={() => this.openNewProject()} className="hBdAccent"
              style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--fg-faint);font-size:12px;min-height:104px;text-align:center;cursor:pointer')}>
              <span style={sx('font-size:20px;color:var(--accent);line-height:1')}>+</span>
              <span style={sx('font-weight:600;color:var(--fg-soft)')}>New project</span>
              <span style={sx('font-size:10.5px')}>scaffolds project.md · brief · story · mood boards on disk</span>
            </div>
          </div>
          {this.renderFavStrip()}
          {this.renderSkillHistory()}
        </div>
      </div>
    );
  }

  renderSkillHistory() {
    const S = this.state;
    const byDate = new Map(S.history.map(h => [h.date, h]));
    const total = h => (h.triage || 0) + (h.rerolls || 0) + (h.briefs || 0) + (h.prompts || 0) + (h.skills || 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - start.getDay() - 25 * 7);
    const weeks = [];
    for (let w = 0; w < 26; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
        if (dt > today) { col.push(null); continue; }
        const iso = dt.toISOString().slice(0, 10);
        const h = byDate.get(iso);
        col.push({ iso, n: h ? total(h) : 0, h });
      }
      weeks.push(col);
    }
    const lvl = n => n === 0 ? 'var(--surface-2)' : n <= 3 ? 'var(--accent-12)' : n <= 8 ? 'var(--accent-35)' : n <= 15 ? 'var(--accent-60)' : 'var(--accent)';
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 30);
    const last30 = S.history.filter(h => new Date(h.date) >= cutoff);
    const sum = k => last30.reduce((a, h) => a + (h[k] || 0), 0);
    const monthLabels = [];
    let lastMon = -1;
    weeks.forEach((col, w) => {
      const first = col.find(Boolean);
      if (!first) return;
      const m = new Date(first.iso).getMonth();
      if (m !== lastMon) { monthLabels.push({ w, label: new Date(first.iso).toLocaleString('en-US', { month: 'short' }) }); lastMon = m; }
    });
    const nSkills = S.skillRepos.reduce((a, r) => a + r.skills.length, 0);
    return (
      <div style={sx('margin-top:24px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px')}>
          <div style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted)')}>SKILL HISTORY</div>
          <div style={sx('font-size:11px;color:var(--fg-faint)')}>how your prompting &amp; curation sharpen · <span style={{ fontFamily: MONO, fontSize: 10 }}>skills/history/*.md</span></div>
        </div>
        <div style={sx('border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:16px 18px')}>
          <div style={sx('display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap')}>
            <div style={sx('max-width:100%;overflow-x:auto')}>
              <div style={{ ...sx('position:relative;height:13px;margin-bottom:4px'), width: 26 * 14 }}>
                {monthLabels.map((m, i) => <span key={i} style={{ ...sx('position:absolute;top:0;font-size:9px;color:var(--fg-faint)'), left: m.w * 14 }}>{m.label}</span>)}
              </div>
              <div style={sx('display:flex;gap:3px')}>
                {weeks.map((col, w) => (
                  <div key={w} style={sx('display:flex;flex-direction:column;gap:3px')}>
                    {col.map((c, d) => c === null
                      ? <div key={d} style={sx('width:11px;height:11px')} />
                      : <div key={d} title={c.iso + ' — ' + c.n + ' actions' + (c.h ? ' (' + (c.h.triage || 0) + ' triage, ' + (c.h.rerolls || 0) + ' re-rolls, ' + (c.h.prompts || 0) + ' prompts, ' + (c.h.briefs || 0) + ' briefs)' : '')}
                        style={{ ...sx('width:11px;height:11px;border-radius:2px'), background: lvl(c.n) }} />)}
                  </div>
                ))}
              </div>
              <div style={sx('display:flex;align-items:center;gap:4px;margin-top:8px;font-size:9.5px;color:var(--fg-faint)')}>
                Less {[0, 2, 6, 12, 20].map(n => <span key={n} style={{ ...sx('width:11px;height:11px;border-radius:2px;display:inline-block'), background: lvl(n) }} />)} More
              </div>
            </div>
            <div style={sx('flex:1;display:flex;flex-direction:column;gap:8px;border-left:1px solid var(--line);padding-left:18px;min-width:170px')}>
              <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted)')}>LAST 30 DAYS</div>
              {[['triage decisions', sum('triage'), 'var(--ok)'], ['re-rolls shipped', sum('rerolls'), 'var(--accent)'], ['prompts written', sum('prompts'), 'var(--fg-soft)'], ['context edits', sum('briefs'), 'var(--fg-muted)'], ['skill edits', sum('skills'), 'var(--fg-muted)']].map(([l, n, c], i) => (
                <div key={i} style={sx('display:flex;align-items:baseline;gap:8px')}>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: c, width: 38 }}>{n}</span>
                  <span style={sx('font-size:11px;color:var(--fg-faint)')}>{l}</span>
                </div>
              ))}
              <div onClick={() => this.go('skills')} className="hFg" style={sx('font-size:10.5px;color:var(--fg-faint);cursor:pointer;margin-top:4px')}>{nSkills} skills loaded across {S.skillRepos.length} repos →</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // FAVORITES strip — first 8 ⭐ assets across projects + library (F1.3)
  renderFavStrip() {
    const S = this.state;
    const favs = [];
    S.projects.forEach(p => ((p.context || {}).items || []).forEach(c => {
      if (c.meta && c.meta.fav && (c.type === 'image' || c.type === 'video')) favs.push({ ...c, scope: p.id, from: p.name });
    }));
    (S.library.items || []).forEach(c => {
      if (c.meta && c.meta.fav && (c.type === 'image' || c.type === 'video')) favs.push({ ...c, scope: 'library', from: 'Library' });
    });
    if (!favs.length) return null;
    return (
      <div style={sx('margin-top:24px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px')}>
          <div style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted)')}>FAVORITES</div>
          <div style={sx('font-size:11px;color:var(--fg-faint)')}>{favs.length} starred asset{favs.length === 1 ? '' : 's'} across the production</div>
        </div>
        <div style={sx('display:flex;gap:10px;overflow-x:auto;padding-bottom:4px')}>
          {favs.slice(0, 8).map(c => (
            <div key={c.scope + '/' + c.folder + '/' + c.name}
              onClick={() => { if (c.scope === 'library') { this.go('library'); return; } const asset = folderKind(c.folder) === 'asset'; this.openProj(c.scope, asset ? 'assets' : 'references'); if (!asset) this.setState({ refSub: 'moods' }); }}
              className="hBd" style={sx('position:relative;flex:none;width:132px;height:84px;border-radius:10px;overflow:hidden;border:1px solid var(--border);cursor:pointer;background:var(--surface)')}>
              <RenderMedia src={c.scope === 'library' ? api.libraryUrl(c.name, c.folder) : api.contextUrl(c.scope, c.name, c.folder)}
                kind={c.type} fit="cover" hoverPlay={false} alt="" style={sx('width:100%;height:100%')} />

              <span style={sx('position:absolute;top:5px;right:6px;color:var(--accent);font-size:11px;text-shadow:0 1px 3px rgba(0,0,0,.7)')}>★</span>
              <span style={{ ...sx('position:absolute;left:6px;bottom:5px;font-size:8.5px;color:rgba(255,255,255,.85);background:rgba(6,7,10,.7);border-radius:4px;padding:1px 6px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO }}>{c.from}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  renderCheatSheet() {
    const S = this.state;
    const K = resolveKeys(S.settings), kl = id => keyLabel(K[id]);
    // DEV-123 — the description text comes from KEY_ACTIONS, not from a second copy typed out here.
    // This sheet used to restate every label, so keymap.js (which CLAUDE.md names as THE source for
    // keyboard bindings) and the sheet the user reads could disagree — and did: `/` was retitled to
    // "search & jump (same as ⌘K)" and the sheet went on saying "focus search". `row` falls back to
    // an explicit override for the entries that have no single action id (⌘K, Esc, the h/t/b trio).
    const kd = id => (KEY_ACTIONS.find(a => a.id === id) || {}).label || id;
    const row = id => [kl(id), kd(id)];
    // DEV-126 — composer-local shortcuts. They only fire while the prompt field has focus, so they
    // live beside the global list rather than in the rebindable map (which is single-letter only).
    const COMPOSER = [['⌘J', 'composer: model & settings'], ['⌘L', 'composer: look & camera'],
      ['⌘U', 'composer: attach a reference'], ['/', 'composer: snippets & /model /look /camera /angle']];
    const GLOBAL = [['⌘K', 'command palette'], ['⌘⇧V', 'voice dictation'],
      row('search'), row('help'), row('undo'), row('styleLocks'), row('projGenerate'),
      row('quickNote'), row('openMemory'),
      // Listed only when the integration is on — the binding at onKey() is gated the same way, and
      // a sheet that advertises a dead key is exactly the drift DEV-123 removed.
      ...(isEnabled(S.settings, 'feedback') ? [row('feedback')] : []),
      [kl('goHome') + ' / ' + kl('goTools') + ' / ' + kl('goLibrary'), 'home / tools / library'],
      ['Esc', 'back / close']];
    const projRows = {
      generate: S.genView === 'review'
        ? [[kl('review'), 'review mode'], ['1–8', 'switch tabs'], ['Esc', 'clear selection, then home']]
        : [['⌘⏎', 'generate (composer)'], ['←/→ · j', 'move results cursor'], ['↵', 'open preview'], ['f', 'fullscreen (this tab owns f)'], ['k / x', 'keep / discard'], ['r', 're-roll'], ['e', 'rename'], ['a', 'send to…'], ['p', 'copy prompt'], [kl('styleLocks'), 'style lock'], ['u', 'undo enhance'], ['1–8', 'switch tabs']],
      board: [['space / ⌥ drag', 'pan'], ['⌘ scroll', 'zoom'], ['0', 'fit to content'], ['V', 'selected plan ↔ all takes'], ['G', 'run the current align'], ['F', 'full screen'], ['⌘A / ⌘D', 'select all / duplicate'], ['⌫', 'delete'], ['arrows', 'nudge (⇧ = 1px)'], ['1–8', 'switch tabs']],
      story: [['J/K ↑↓', 'walk shots'], ['Enter', 'open shot'], ['S', 'cycle status'], ['.', 'favorite shot'], ['drag ⠿', 'reorder'], ['1–8', 'switch tabs']],
      assets: [['arrows', 'walk boards'], ['Enter', 'open'], ['.', 'favorite'], ['e', 'rename'], ['✦', 'quick-generate into a board'], ['1–8', 'switch tabs']],
      references: [[kl('openMemory'), 'jump to Memory'], ['arrows', 'walk boards'], ['Enter', 'open'], ['.', 'favorite'], ['e', 'rename'], ['1–8', 'switch tabs']],
      activity: [['1–8', 'switch tabs']],
      chat: [['Enter', 'send'], ['Shift+Enter', 'newline'], ['1–8', 'switch tabs']]
    };
    const PAGES = {
      home: [],
      project: projRows[S.projTab] || [['1–8', 'switch tabs']],
      item: [[kl('keep') + ' / ' + kl('kill'), 'keep / kill'], ['1–5', 'rate'], [kl('note'), 'note → re-roll'], [kl('final'), 'mark final'], [kl('copyPrompt'), 'copy prompt'], [kl('compare'), 'A/B versions'], [kl('reveal'), 'reveal in Finder'], ['← →', 'scrub'], [kl('play'), 'play']],
      library: [['J/K', 'walk list view'], ['Enter', 'open'], ['.', 'favorite'], ['shift-click', 'range-select']],
      tools: [['⌘⏎', 'generate (composer)'], ['@', 'mention a reference'], ['Esc', 'back to tools index']],
      remotion: [['click', 'open a composition'], ['Esc', 'back']]
    };
    const rows = [...(PAGES[S.page] || []), ...COMPOSER, ...GLOBAL];
    return (
      <div onClick={() => this.setState({ cheatOpen: false })} style={sx('position:fixed;inset:0;z-index:95;background:rgba(5,6,8,.65);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center')}>
        <div onClick={e => e.stopPropagation()} style={sx('width:420px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8);padding:18px 22px;animation:dl-in .12s ease-out')}>
          <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:14px')}>
            <span style={sx('font-size:11px;font-weight:700;letter-spacing:.16em;color:var(--fg-muted)')}>KEYBOARD</span>
            <span style={sx('font-size:10.5px;color:var(--fg-faint)')}>{S.page === 'project' ? S.projTab + ' tab' : S.page}</span>
            <span onClick={() => this.setState({ cheatOpen: false })} className="hFgL" style={sx('margin-left:auto;font-size:11px;color:var(--fg-faint);cursor:pointer')}>✕ Esc</span>
          </div>
          <div style={sx('display:grid;grid-template-columns:88px 1fr;gap:8px 14px;font-size:12px;color:var(--fg-muted)')}>
            {rows.map(([k, d], i) => (
              <React.Fragment key={i}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--fg)' }}>{k}</span><span>{d}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  }

  renderNewProject() {
    const S = this.state;
    return (
      <div onClick={() => this.setState({ npOpen: false })} style={sx('position:fixed;inset:0;z-index:90;background:rgba(5,6,8,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center')}>
        <div onClick={e => e.stopPropagation()} style={sx('width:440px;padding:22px 24px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
          <div style={sx('font-weight:700;font-size:15px')}>New project</div>
          <div style={sx('font-size:11.5px;color:var(--fg-muted);margin-top:4px')}>Scaffolds <span style={{ fontFamily: MONO, fontSize: 10.5 }}>projects/&lt;id&gt;/</span> with project.md, brief, story and a moodboard folder.</div>

          {/* DEV-136 — MANUAL ⇄ AGENT. Agent mode only PROPOSES: it fills the same fields below,
              which the user then reviews and creates with. Nothing is written until Create. */}
          <div style={sx('display:flex;gap:6px;margin-top:14px')}>
            {[['manual', 'MANUAL'], ['agent', 'AGENT']].map(([id, label]) => {
              const on = (S.npMode || 'manual') === id;
              return (
                <span key={id} onClick={() => this.setState({ npMode: id })} className={on ? '' : 'hBd'}
                  style={{
                    ...sx('border-radius:7px;padding:4px 12px;cursor:pointer'), fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em',
                    color: on ? 'var(--fg)' : 'var(--fg-muted)', background: on ? 'var(--raise)' : 'transparent',
                    border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'), fontWeight: on ? 700 : 400
                  }}>{label}</span>
              );
            })}
          </div>

          {(S.npMode || 'manual') === 'agent' && (
            <div style={sx('margin-top:14px;padding:12px;border:1px solid var(--border-2);border-radius:10px;background:var(--ink)')}>
              <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-bottom:6px')}>WHAT IS THIS PROJECT?</div>
              <textarea value={S.npIdea || ''} onChange={e => this.setState({ npIdea: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.proposeProject(); }}
                placeholder={'A 3-minute short about a lighthouse keeper who stops sleeping.\nThe agent drafts a name, subtitle, card gradient and an opening story — you review it before anything is created.'}
                style={sx('width:100%;box-sizing:border-box;height:78px;resize:vertical;background:var(--sunk);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12.5px;line-height:1.6;padding:9px 11px')} />
              <div style={sx('display:flex;align-items:center;gap:10px;margin-top:8px')}>
                <Btn size="sm" busy={S.npBusy} disabled={!String(S.npIdea || '').trim()} onClick={() => this.proposeProject()}>
                  {S.npBusy ? 'Drafting…' : (S.npProposal ? 'Draft again' : 'Draft it')}
                </Btn>
                <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>⌘⏎</span>
                {S.npProposal && <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--ok)' }}>filled below — review, then create</span>}
              </div>
              {S.npProposal && S.npProposal.story && (
                <div style={{ ...sx('margin-top:9px;padding:8px 10px;border-radius:7px;background:var(--sunk);max-height:110px;overflow-y:auto;line-height:1.55'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', whiteSpace: 'pre-wrap' }}>
                  {S.npProposal.story}
                </div>
              )}
            </div>
          )}

          <div style={sx('margin-top:16px')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-bottom:6px')}>NAME — required</div>
            <input value={S.npName} autoFocus onChange={e => this.setState({ npName: e.target.value })}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.createProject(); else if (e.key === 'Escape') this.setState({ npOpen: false }); }}
              placeholder="Neon Harvest"
              style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:13px;padding:9px 12px')} />
          </div>
          <div style={sx('margin-top:12px')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:6px')}>SUBTITLE — optional</div>
            <input value={S.npSub} onChange={e => this.setState({ npSub: e.target.value })}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.createProject(); }}
              placeholder="3-min short · solar-punk"
              style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12.5px;padding:9px 12px')} />
          </div>
          <div style={sx('margin-top:12px')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:6px')}>CARD GRADIENT</div>
            <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
              {G.map((g, i) => (
                <div key={i} onClick={() => this.setState({ npGrad: i })}
                  style={{ ...sx('width:38px;height:26px;border-radius:6px;cursor:pointer'), background: g, border: '2px solid ' + (S.npGrad === i ? 'var(--accent)' : 'transparent') }} />
              ))}
            </div>
          </div>
          {/* DEV-136 — BASE SETUP. Written into project.md on create, so every generating surface in
              the project starts on these instead of the app-wide fallback. Prefilled from the last
              setup actually used (settings.projectDefaults), then settings.modelDefaults. */}
          <div style={sx('margin-top:14px;padding-top:12px;border-top:1px solid var(--line)')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:8px')}>BASE SETUP — remembered for next time</div>
            {[
              ['npModel', 'Image model', m => m.kind !== 'video' && !['music', 'voice', 'sfx'].includes(m.kind)],
              ['npVideoModel', 'Video model', m => m.kind === 'video'],
              ['npAudioModel', 'Audio model', m => ['music', 'voice', 'sfx'].includes(m.kind)]
            ].map(([key, label, filter]) => (
              <div key={key} style={sx('display:flex;align-items:center;gap:10px;margin-bottom:6px')}>
                <span style={{ ...sx('flex:none;width:88px'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)' }}>{label}</span>
                <select value={S[key] || ''} onChange={e => this.setState({ [key]: e.target.value })}
                  onKeyDown={e => e.stopPropagation()}
                  style={sx('flex:1;min-width:0;background:var(--ink);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);font-size:11.5px;padding:6px 8px')}>
                  <option value="">— app default —</option>
                  {enabledCatalog(S.settings || {}).flatMap(g => g.models).filter(filter)
                    .map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            ))}
            <div style={sx('display:flex;align-items:center;gap:10px')}>
              <span style={{ ...sx('flex:none;width:88px'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)' }}>Style lock</span>
              <select value={S.npStyleLock || ''} onChange={e => this.setState({ npStyleLock: e.target.value })}
                onKeyDown={e => e.stopPropagation()}
                style={sx('flex:1;min-width:0;background:var(--ink);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);font-size:11.5px;padding:6px 8px')}>
                <option value="">— none —</option>
                {(S.styleLocks || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div style={sx('display:flex;gap:10px;justify-content:flex-end;margin-top:20px')}>
            <Btn onClick={() => this.setState({ npOpen: false })}>Cancel</Btn>
            <Btn variant="primary" disabled={!S.npName.trim()}
              onClick={() => this.createProject(S.npProposal ? { story: S.npProposal.story } : {})}
              style={{ padding: '8px 18px' }}>Create project</Btn>
          </div>
        </div>
      </div>
    );
  }

  renderArchiveAsk() {
    const pid = this.state.archiveAsk;
    const p = this.projDef(pid);
    return (
      <div style={sx('position:fixed;inset:0;z-index:90;background:rgba(5,6,8,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center')}>
        <div style={sx('width:400px;padding:22px 24px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
          <div style={sx('font-weight:700;font-size:15px')}>Archive “{p.name}”?</div>
          <div style={sx('font-size:12.5px;color:var(--fg-muted);line-height:1.6;margin-top:8px')}>The folder is renamed to <span style={{ fontFamily: MONO, fontSize: 11 }}>projects/_archive-…</span> — nothing is deleted, and Undo restores it instantly.</div>
          <div style={sx('display:flex;gap:10px;justify-content:flex-end;margin-top:20px')}>
            <Btn onClick={() => this.setState({ archiveAsk: null })}>Cancel</Btn>
            <Btn variant="danger" onClick={() => this.archiveProject(pid)}>Archive project</Btn>
          </div>
        </div>
      </div>
    );
  }

  // ⚙ Project settings — "the project's identity in one place": rename, default style lock,
  // default model, card gradient, and read-only project facts. Every control saves immediately
  // (PATCH /api/projects/:pid) — there is no separate Save button, matching the rest of the app.
  renderProjSettings() {
    const S = this.state;
    const pid = S.proj;
    const pdef = this.projDef(pid);
    const modelGroups = enabledCatalog(S.settings).filter(g => g.kind === 'preview' || g.kind === 'render');
    const globalModel = ((S.settings.modelDefaults || {}).preview) || DEFAULT_PREVIEW_MODEL;
    const escClose = e => { e.stopPropagation(); if (e.key === 'Escape') this.setState({ projSettingsOpen: false }); };
    return (
      <div onClick={() => this.setState({ projSettingsOpen: false })} style={sx('position:fixed;inset:0;z-index:90;background:rgba(5,6,8,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center')}>
        <div onClick={e => e.stopPropagation()} style={sx('width:480px;max-height:84vh;overflow-y:auto;padding:22px 24px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
          <div style={sx('display:flex;align-items:center;gap:8px')}>
            <div style={sx('font-weight:700;font-size:15px')}>Project settings</div>
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '1px 6px', marginLeft: 'auto' }}>{pid}</span>
          </div>
          <div style={sx('font-size:11.5px;color:var(--fg-muted);margin-top:4px')}>the project's identity in one place — every change saves immediately.</div>

          <div style={sx('margin-top:18px')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-bottom:6px')}>NAME</div>
            <input value={S.projEditName} onChange={e => this.setState({ projEditName: e.target.value })}
              onBlur={() => this.saveProjEdit()} onKeyDown={e => { escClose(e); if (e.key === 'Enter') e.currentTarget.blur(); }}
              style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:13px;padding:9px 12px')} />
          </div>
          <div style={sx('margin-top:12px')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:6px')}>SUBTITLE</div>
            <input value={S.projEditSub} onChange={e => this.setState({ projEditSub: e.target.value })}
              onBlur={() => this.saveProjEdit()} onKeyDown={e => { escClose(e); if (e.key === 'Enter') e.currentTarget.blur(); }}
              placeholder="3-min short · solar-punk"
              style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12.5px;padding:9px 12px')} />
          </div>

          <div style={sx('margin-top:16px')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:6px')}>DEFAULT STYLE LOCK</div>
            <select value={pdef.styleLock || ''} onChange={e => this.setDefaultStyleLock(pid, e.target.value)} onKeyDown={escClose}
              style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12.5px;padding:9px 12px')}>
              <option value="">— none —</option>
              {(S.styleLocks || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:5px')}>{(S.styleLocks || []).length ? 'auto-applied to Generate every time this project is opened' : 'no style locks saved yet — create one from Tools → Style Locks'}</div>
          </div>

          <div style={sx('margin-top:16px')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:6px')}>DEFAULT MODEL</div>
            <select value={pdef.model || ''} onChange={e => this.setDefaultModel(pid, e.target.value)} onKeyDown={escClose}
              style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12.5px;padding:9px 12px')}>
              <option value="">use global default ({globalModel})</option>
              {modelGroups.map(g => (
                <optgroup key={g.kind} label={g.group}>
                  {g.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <div style={sx('margin-top:16px')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:6px')}>CARD GRADIENT</div>
            <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
              {G.map((g, i) => (
                <div key={i} onClick={() => this.setProjectGrad(pid, i)}
                  style={{ ...sx('width:38px;height:26px;border-radius:6px;cursor:pointer'), background: g, border: '2px solid ' + ((pdef.gradIx ?? 0) === i ? 'var(--accent)' : 'transparent') }} />
              ))}
            </div>
          </div>

          <div style={sx('margin-top:18px;border-top:1px solid var(--border);padding-top:14px;display:grid;grid-template-columns:80px 1fr;row-gap:7px;font-size:11px')}>
            <span style={sx('color:var(--fg-faint)')}>ID</span><span style={{ fontFamily: MONO, color: 'var(--fg-muted)' }}>{pid}</span>
            <span style={sx('color:var(--fg-faint)')}>Created</span><span style={sx('color:var(--fg-muted)')}>{pdef.when || '—'}</span>
            {S.storageRoot && <><span style={sx('color:var(--fg-faint)')}>Storage</span><span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{S.storageRoot + '/projects/' + pid}</span></>}
          </div>

          <div style={sx('display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:20px')}>
            <Btn variant="danger" onClick={() => this.setState({ projSettingsOpen: false, archiveAsk: pid })} style={sx('font-size:11.5px')}>Archive project…</Btn>
            <Btn variant="primary" onClick={() => this.setState({ projSettingsOpen: false })} style={{ padding: '8px 18px' }}>Done</Btn>
          </div>
        </div>
      </div>
    );
  }

  async uploadFiles(pid, files, folder = '') {
    for (const f of files) {
      try { await api.uploadContext(pid, f, folder); } catch { this.showToast('Upload failed: ' + f.name, 'var(--danger)'); }
    }
    if (files.length) this.showToast(files.length + (files.length > 1 ? ' assets' : ' asset') + ' added to ' + (folder ? '“' + folder + '”' : 'project context'), 'var(--accent)');
    this.sync();
  }
  pickFiles(folder) {
    this.setState({ ctxUploadFolder: folder || '' });
    if (this.fileRef.current) this.fileRef.current.click();
  }

  renderProjActivity(pid) {
    const S = this.state;
    const mine = new Set(S.items.filter(x => x.proj === pid).map(x => x.id));
    const rows = S.activity.filter(e => e.ref === pid || (e.ref && mine.has(e.ref)));
    return (
      <div style={sx('padding:14px 24px 60px')}>
        {rows.map((e, i) => (
          <div key={i} onClick={() => { if (e.kind === 'item' && this.resolveItem(e.ref)) this.openItem(e.ref); }} className="hBg"
            style={sx('display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line);align-items:flex-start;cursor:pointer')}>
            <div style={{ ...sx('width:8px;height:8px;border-radius:99px;margin-top:5px;flex:none'), background: DOTC[e.dot] || 'var(--fg-faint)' }} />
            <div style={sx('flex:1;min-width:0')}>
              <div style={sx('font-size:12.5px;line-height:1.45')}><span style={sx('font-weight:600')}>{e.t}</span> <span style={sx('color:var(--fg-muted)')}>{e.t2}</span></div>
              <div style={sx('font-size:11px;color:var(--fg-faint);margin-top:2px')}>{e.s}</div>
            </div>
          </div>
        ))}
        {!rows.length && <div style={{ ...sx('padding:50px 0;text-align:center;color:var(--fg-faint);font-size:10.5px;letter-spacing:.08em'), fontFamily: MONO }}>NO ACTIVITY YET — TRIAGE SOMETHING</div>}
      </div>
    );
  }

  // Generate tab — ONE surface. The Compose|Review sub-tabs are gone: ProjectGenerate's own
  // review filters (Needs review / Kept / Killed) cover triage in place, and the header's
  // Review button (R) is the one entry into fullscreen review mode. Three doors into "review"
  // on one screen was the clutter, not a feature.
  renderGenerateTab(pid, pdef) {
    const S = this.state;
    return (
      <ProjectGenerate app={this} proj={pdef}
        activeStyleLock={S.activeStyleLocks[pid] || null}
        onRequestStyleLock={() => this.openStyleLockPicker(pid)} key={pid} />
    );
  }

  renderProject() {
    const S = this.state;
    const pid = S.proj || (S.projects[0] && S.projects[0].id);
    const pdef = this.projDef(pid);
    const live = S.items.filter(x => !x.trashed);
    const mine = live.filter(x => x.proj === pid);
    const stMap = {
      new: { st: '●', stBg: 'rgba(6,7,10,.72)', stFg: 'var(--accent)', row: 'new', rowFg: 'var(--accent)' },
      kept: { st: '✓', stBg: 'var(--ok)', stFg: 'var(--void)', row: 'kept', rowFg: 'var(--ok)' },
      killed: { st: '✕', stBg: 'rgba(240,91,84,.9)', stFg: 'var(--void)', row: 'killed', rowFg: 'var(--danger)' }
    };
    let filtered = mine.filter(x => {
      if (S.filType !== 'all' && x.type !== S.filType) return false;
      if (S.filStatus === 'new' && x.st !== 'new') return false;
      if (S.filStatus === 'kept' && x.st !== 'kept') return false;
      if (S.filStatus === 'killed' && x.st !== 'killed') return false;
      if (S.filStatus === 'flag' && !x.flag) return false;
      if (S.filStatus === 'fb' && !x.fb) return false;
      if (S.filStatus === 'fin' && !x.fin) return false;
      return true;
    });
    const sorts = ['Timeline order', 'Newest', 'Cost', 'Rating'];
    filtered = filtered.slice().sort((a, b) => S.sortIx === 0 ? a.tl - b.tl : S.sortIx === 1 ? b.tl - a.tl : S.sortIx === 2 ? b.cost - a.cost : b.rating - a.rating);
    const typeDefs = [['all', 'All'], ['clip', 'Clips'], ['img', 'Images'], ['style', 'Styles'], ['render', 'Renders']];
    const statusDefs = [['all', 'Any status', mine.length], ['new', 'New', mine.filter(x => x.st === 'new').length], ['kept', 'Kept', mine.filter(x => x.st === 'kept').length], ['killed', 'Killed', mine.filter(x => x.st === 'killed').length], ['flag', 'Flagged', mine.filter(x => x.flag).length], ['fb', 'Has feedback', mine.filter(x => x.fb).length], ['fin', 'Final', mine.filter(x => x.fin).length]];
    const newCount = mine.filter(x => x.st === 'new').length;
    const selIds = Object.keys(S.sel);
    // the generation-triage grid (keep/kill/rate, review mode) now lives under Generate → Review;
    // "Assets" is production boards (AssetBoards). `triage` gates the old grid/table/bulk blocks.
    const triage = S.projTab === 'generate' && S.genView === 'review';
    const genCount = (pdef.gens || []).filter(g => g.status !== 'failed').length;
    // The Assets badge must count what the Assets TAB can actually show, and that tab renders
    // production folders only (AssetBoards.sections()). Counting every context image made it
    // claim 133 on a project whose media all sat at the context root — i.e. references — so the
    // tab read "133" and then rendered an empty page. Same split as everywhere else:
    // shared/assetKinds.mjs decides, nobody re-derives it. A root-level file has no folder, and
    // folderKind('') is 'reference', which is the rule: a mood import lands at the root.
    const ctxAll = ((pdef.context || {}).items) || [];
    const isMedia = c => c.type === 'image' || c.type === 'video';
    const ctxMedia = ctxAll.filter(c => isMedia(c) && folderKind(c.folder || '') === 'asset').length;
    const ctxRefs = ctxAll.filter(c => isMedia(c) && folderKind(c.folder || '') !== 'asset').length;
    const chipOf = x => x.fbState === 'queued' ? 're-roll queued' : x.fbState === 'done' ? 're-rolled' : '';
    const cell = it => {
      const sm = stMap[it.st] || stMap.new;
      const killed = it.st === 'killed';
      const sel = !!S.sel[it.id];
      return { sm, killed, sel };
    };
    // On the Agent tab the project page is a locked column (see render()'s `agentLocked`): the title
    // row and the tab row keep their natural height, the chat takes the rest and scrolls internally.
    // The 90px tail is page-scroll breathing room and would push that column past the viewport.
    const agentTab = S.projTab === 'chat' && (S.modules || {}).chat !== false;
    // The Board gets the Agent tab's locked-column treatment: no 90px page tail, no document
    // scroll, so the canvas gets every remaining pixel of height.
    const boardTab = S.projTab === 'board';
    const boardFull = boardTab && !!S.boardFull;
    if (boardFull) {
      // Full screen: the canvas and nothing else. Escape and F both come back (see Board.onKey),
      // and the Board's own toolbar carries the exit control, so this cannot strand anyone.
      return (
        <div style={sx('height:100%;min-height:0;display:flex;flex-direction:column;position:relative')}>
          <Board app={this} pid={pid} pdef={pdef} key={pid} />
        </div>
      );
    }
    return (
      <div style={agentTab || boardTab
        ? sx('height:100%;min-height:0;display:flex;flex-direction:column;position:relative')
        : sx('min-height:100%;padding-bottom:90px;position:relative')}>
        <div style={sx('flex:none;display:flex;align-items:center;gap:16px;padding:16px 24px 0')}>
          {S.projEdit ? (
            <div style={sx('display:flex;align-items:center;gap:8px')}>
              <input value={S.projEditName} autoFocus onChange={e => this.setState({ projEditName: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.saveProjEdit(); else if (e.key === 'Escape') this.setState({ projEdit: false }); }}
                style={sx('width:220px;background:var(--ink);border:1px solid var(--accent-60);border-radius:7px;color:var(--fg);font-size:14px;font-weight:700;padding:6px 10px')} />
              <input value={S.projEditSub} placeholder="subtitle" onChange={e => this.setState({ projEditSub: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.saveProjEdit(); else if (e.key === 'Escape') this.setState({ projEdit: false }); }}
                style={sx('width:220px;background:var(--ink);border:1px solid var(--border-2);border-radius:7px;color:var(--fg-muted);font-size:12px;padding:6px 10px')} />
              <Btn variant="primary" size="sm" onClick={() => this.saveProjEdit()} style={{ padding: '5px 13px' }}>Save</Btn>
              <span onClick={() => this.setState({ projEdit: false })} className="hFgL" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>Esc</span>
            </div>
          ) : (
            <div onClick={() => this.setState({ projEdit: true, projEditName: pdef.name, projEditSub: pdef.sub || '' })} title="Click to rename"
              className="hBg" style={sx('font-weight:700;font-size:16px;cursor:text;border-radius:7px;padding:2px 8px;margin-left:-8px')}>
              {pdef.name} <span style={sx('font-weight:400;color:var(--fg-faint);font-size:12px')}>· {(pdef.sub || '').toLowerCase()}{pdef.scenes ? ' · ' + pdef.scenes : ''}</span> <span style={sx('font-size:10px;color:var(--fg-faint)')}>✎</span>
            </div>
          )}
          <span onClick={() => this.openProjSettings()} title="Project settings" className="hBg"
            style={sx('width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;color:var(--fg-faint);font-size:13px;cursor:pointer;flex:none')}>⚙</span>
          <div style={sx('margin-left:auto;display:flex;align-items:center;gap:12px')}>
            {/* The project cost pill lived here and looked identical to the global spend pill
                in the bar above — same border, same radius, same numeral — but carried no
                onClick, so one of the two navigated and one was dead. renderCosts' BY PROJECT
                breakdown is one click away and is the better surface. Removed, not moved. */}
            {triage && <div style={sx('display:flex;border:1px solid var(--border-2);border-radius:7px;overflow:hidden')}>
              {['grid', 'table'].map(d => (
                <div key={d} onClick={() => this.setState({ density: d })}
                  style={{ ...sx('padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer'), background: S.density === d ? 'var(--border)' : 'transparent', color: S.density === d ? 'var(--fg)' : 'var(--fg-faint)' }}>
                  {d === 'grid' ? 'Grid' : 'Table'}
                </div>
              ))}
            </div>}
            {/* quiet by design — the page's one solid accent belongs to Generate. Outlined,
                tab-height; the new-count keeps the accent as a text tint only. */}
            <div onClick={() => this.startReview()} className="hBd"
              style={{ ...sx('display:flex;align-items:center;gap:7px;padding:4px 12px;border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:600'), border: '1px solid var(--border-2)', color: newCount ? 'var(--accent)' : 'var(--fg-soft)', background: 'transparent' }}>
              <svg width="8" height="10" viewBox="0 0 10 12" fill="none"><path d="M0 0L10 6L0 12V0Z" fill="currentColor" /></svg>
              {newCount ? 'Review ' + newCount + ' new' : 'Review all'} <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '0 4px' }}>R</span>
            </div>
          </div>
        </div>
        <div style={sx('flex:none;display:flex;align-items:flex-end;gap:26px;padding:14px 24px 0;border-bottom:1px solid var(--border)')}>
          {/* STORY leads and is the project's landing tab (Greenlight IA): story and shots are
              one merged block, so the single Story entry carries the shot count. Agent sits
              second. The tab ID stays 'chat' so saved locations, keymaps and the module
              toggle keep working. */}
          {(() => { const LABEL = { story: 'Story', board: 'Board', chat: 'Agent', generate: 'Generate', timeline: 'Timeline', assets: 'Assets', references: 'References', activity: 'Activity' }; const COUNT = { story: S.shots.filter(s => s.proj === pid).length || null, generate: genCount || null, assets: ctxMedia || null, references: ctxRefs || null }; return projTabIds(S).map(id => [id, LABEL[id], COUNT[id] ?? null]); })().map(([id, label, n]) => {
            const on = S.projTab === id;
            return (
              <div key={id} onClick={() => this.setState({ projTab: id, briefEdit: false, ctxNoteOpen: false })} className={on ? '' : 'hFg'}
                style={{ ...sx('display:flex;align-items:baseline;gap:7px;padding:2px 1px 11px;cursor:pointer;font-size:12.5px'), color: on ? 'var(--fg)' : 'var(--fg-faint)', fontWeight: on ? 700 : 500, boxShadow: on ? 'inset 0 -2px 0 var(--accent)' : 'none' }}>
                {label}
                {n != null && <span style={{ fontFamily: MONO, fontSize: 10, color: on ? 'var(--fg-muted)' : 'var(--fg-faint)' }}>{n}</span>}
              </div>
            );
          })}
          {/* The tab row's prime slot (margin-left:auto) held a sentence that never changed.
              The hint now lives in the Assets tab body, where it is actually about something.
              Leaving this slot empty is what tells the eye the row is navigation, not a toolbar. */}
        </div>
        {S.projTab === 'story' && <StoryTab app={this} pid={pid} pdef={pdef} key={pid} />}
        {S.projTab === 'board' && <Board app={this} pid={pid} pdef={pdef} key={pid} />}
        {S.projTab === 'generate' && this.renderGenerateTab(pid, pdef)}
        {S.projTab === 'timeline' && <Timeline app={this} pid={pid} pdef={pdef} key={pid} />}
        {/* If the chat tab is somehow selected while the chat module is off (stale saved
            location), degrade to the asset boards instead of a blank page */}
        {(S.projTab === 'assets' || (S.projTab === 'chat' && (S.modules || {}).chat === false)) && <AssetBoards app={this} proj={pdef} key={pid} />}
        {S.projTab === 'references' && <References app={this} proj={pdef} key={pid} />}
        {S.projTab === 'activity' && this.renderProjActivity(pid)}
        {S.projTab === 'chat' && (S.modules || {}).chat !== false && <Chat app={this} pid={pid} pdef={pdef} key={pid} />}
        {triage && <div style={sx('display:flex;align-items:center;gap:8px;padding:14px 24px;border-bottom:1px solid var(--border);font-size:11.5px;flex-wrap:wrap')}>
          <div style={sx('display:flex;gap:4px')}>
            {typeDefs.map(([v, l]) => {
              const n = v === 'all' ? mine.length : mine.filter(x => x.type === v).length;
              const on = S.filType === v;
              return <div key={v} onClick={() => this.setState({ filType: v })} style={{ ...sx('padding:4px 11px;border-radius:99px;cursor:pointer'), background: on ? 'var(--fg)' : 'transparent', color: on ? 'var(--on-accent)' : 'var(--fg-muted)', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border-2)'), fontWeight: on ? 600 : 400 }}>{l} {n}</div>;
            })}
          </div>
          <div style={sx('width:1px;height:18px;background:var(--border-2);margin:0 4px')} />
          <div style={sx('display:flex;gap:4px')}>
            {statusDefs.map(([v, l, n]) => {
              const on = S.filStatus === v;
              const amber = v === 'new' && !on;
              return <div key={v} onClick={() => this.setState({ filStatus: v })} style={{ ...sx('padding:4px 11px;border-radius:99px;cursor:pointer'), background: on ? 'var(--fg)' : 'transparent', color: on ? 'var(--on-accent)' : amber ? 'var(--accent)' : 'var(--fg-muted)', border: '1px solid ' + (on ? 'var(--fg)' : amber ? 'var(--accent-35)' : 'var(--border-2)'), fontWeight: on || amber ? 600 : 400 }}>{l} {n}</div>;
            })}
          </div>
          <div onClick={() => this.setState(s => ({ sortIx: (s.sortIx + 1) % 4 }))} className="hBd" style={sx('margin-left:auto;display:flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-muted);cursor:pointer')}>
            <span style={sx('color:var(--fg-faint)')}>Sort</span> {sorts[S.sortIx]} ▾
          </div>
        </div>}

        {triage && S.density === 'grid' && (
          <>
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;padding:18px 24px')}>
              {filtered.map(it => {
                const { sm, killed, sel } = cell(it);
                return (
                  <div key={this.itemKey(it)} onClick={() => this.openItem(it.proj, it.id)} className="hBd" style={{ ...sx('border-radius:10px;overflow:hidden;background:var(--surface);cursor:pointer'), border: '1.5px solid ' + (sel ? 'var(--accent)' : 'transparent'), opacity: killed ? 0.38 : 1 }}>
                    <div style={{ ...sx('position:relative;aspect-ratio:16/9'), background: it.grad }}>
                      {this.itemMedia(it)}
                      <div style={sx('position:absolute;top:8px;left:8px;display:flex;gap:5px;align-items:center')}>
                        <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '.08em', background: 'rgba(6,7,10,.72)', borderRadius: 4, padding: '2px 6px', color: 'var(--fg-soft)' }}>{it.type.toUpperCase()}</span>
                        {it.st === 'new' && <span style={sx('font-size:9px;font-weight:700;letter-spacing:.06em;background:var(--border);color:var(--fg-soft);border-radius:4px;padding:2px 6px')}>NEW</span>}
                        {it.prio && <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, background: 'rgba(6,7,10,.72)', border: '1px solid var(--border-3)', borderRadius: 4, padding: '1.5px 5px', color: 'var(--fg-soft)' }}>{it.prio}</span>}
                      </div>
                      <div style={{ ...sx('position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;line-height:1'), background: it.flag ? 'rgba(6,7,10,.72)' : sm.stBg, color: it.flag ? 'var(--accent)' : sm.stFg }}>{it.flag ? '⚑' : sm.st}</div>
                      <div onClick={e => { e.stopPropagation(); this.setState(s => { const n = { ...s.sel }; if (n[it.id]) delete n[it.id]; else n[it.id] = 1; return { sel: n }; }); }}
                        className="hBdAccentChip"
                        style={{ ...sx('position:absolute;bottom:8px;left:8px;width:18px;height:18px;border-radius:5px;display:flex;align-items:center;justify-content:center'), background: sel ? 'var(--accent)' : 'rgba(6,7,10,.5)', border: '1.5px solid ' + (sel ? 'var(--accent)' : 'var(--border-3)') }}>
                        {sel && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.8 6.8L9 1" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" /></svg>}
                      </div>
                      {it.durS > 0 && <span style={{ ...sx('position:absolute;bottom:8px;right:8px;border-radius:4px;padding:1.5px 6px'), fontFamily: MONO, fontSize: 10, background: 'rgba(6,7,10,.72)', color: 'var(--fg-soft)' }}>{this.fmtDur(it.durS)}</span>}
                    </div>
                    <div style={sx('padding:9px 11px 11px')}>
                      <div style={sx('display:flex;align-items:center;gap:6px')}>
                        <span style={{ fontFamily: MONO, fontSize: '10.5px', color: 'var(--fg-soft)', textDecoration: killed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                        {it.fb && <svg style={{ flex: 'none' }} width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 2.5C1 1.7 1.7 1 2.5 1H9.5C10.3 1 11 1.7 11 2.5V7C11 7.8 10.3 8.5 9.5 8.5H5L2.2 11V8.5H2.5C1.7 8.5 1 7.8 1 7V2.5Z" fill="var(--accent)" /></svg>}
                        {it.fin && <svg style={{ flex: 'none' }} width="10" height="12" viewBox="0 0 10 12" fill="none"><rect x="0.5" y="5" width="9" height="6.5" rx="1.5" fill="var(--ok)" /><path d="M2.5 5V3.5C2.5 2.1 3.6 1 5 1C6.4 1 7.5 2.1 7.5 3.5V5" stroke="var(--ok)" strokeWidth="1.5" fill="none" /></svg>}
                      </div>
                      <div style={sx('display:flex;align-items:center;gap:8px;margin-top:5px')}>
                        <span style={{ fontFamily: MONO, fontSize: '10.5px', color: 'var(--fg-soft)' }}>{this.fmt$(it.cost)}</span>
                        <span style={sx('font-size:9px;letter-spacing:2.5px')}>{it.rating ? <><span style={sx('color:var(--accent)')}>{'●'.repeat(it.rating)}</span><span style={sx('color:var(--border-2)')}>{'○'.repeat(5 - it.rating)}</span></> : ''}</span>
                        <span style={sx('margin-left:auto;font-size:10px;color:var(--fg-faint)')}>{chipOf(it)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!filtered.length && <div style={{ ...sx('padding:60px 24px;text-align:center;color:var(--fg-faint);font-size:10.5px;letter-spacing:.08em'), fontFamily: MONO }}>NOTHING MATCHES THESE FILTERS — CLEAR ONE</div>}
          </>
        )}

        {triage && S.density === 'table' && (
          <div style={sx('padding:10px 24px 0')}>
            <div style={sx('display:grid;grid-template-columns:28px 64px 1fr 60px 56px 70px 90px 110px 70px;gap:10px;padding:8px 10px;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);border-bottom:1px solid var(--border)')}>
              <span /><span /><span>NAME</span><span>TYPE</span><span>DUR</span><span>COST</span><span>RATING</span><span>STATUS</span><span>SCENE</span>
            </div>
            {filtered.map(it => {
              const { sm, killed, sel } = cell(it);
              return (
                <div key={this.itemKey(it)} onClick={() => this.openItem(it.proj, it.id)} className="hBg" style={{ ...sx('display:grid;grid-template-columns:28px 64px 1fr 60px 56px 70px 90px 110px 70px;gap:10px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--line);cursor:pointer'), opacity: killed ? 0.38 : 1 }}>
                  <div onClick={e => { e.stopPropagation(); this.setState(s => { const n = { ...s.sel }; if (n[it.id]) delete n[it.id]; else n[it.id] = 1; return { sel: n }; }); }}
                    style={{ ...sx('width:15px;height:15px;border-radius:4px;display:flex;align-items:center;justify-content:center'), background: sel ? 'var(--accent)' : 'rgba(6,7,10,.5)', border: '1.5px solid ' + (sel ? 'var(--accent)' : 'var(--border-3)') }}>
                    {sel && <svg width="9" height="7" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.8 6.8L9 1" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" /></svg>}
                  </div>
                  <div style={{ ...sx('position:relative;width:58px;height:34px;border-radius:5px;overflow:hidden'), background: it.grad }}>{this.itemMedia(it)}</div>
                  <div style={sx('display:flex;align-items:center;gap:6px;min-width:0')}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--fg-soft)', textDecoration: killed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                    {it.fb && <svg style={{ flex: 'none' }} width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M1 2.5C1 1.7 1.7 1 2.5 1H9.5C10.3 1 11 1.7 11 2.5V7C11 7.8 10.3 8.5 9.5 8.5H5L2.2 11V8.5H2.5C1.7 8.5 1 7.8 1 7V2.5Z" fill="var(--accent)" /></svg>}
                  </div>
                  <span style={sx('font-size:10px;color:var(--fg-muted)')}>{it.type.toUpperCase()}</span>
                  <span style={{ fontFamily: MONO, fontSize: '10.5px', color: 'var(--fg-muted)' }}>{this.fmtDur(it.durS)}</span>
                  <span style={{ fontFamily: MONO, fontSize: '10.5px', fontVariantNumeric: 'tabular-nums', color: 'var(--fg-soft)' }}>{this.fmt$(it.cost)}</span>
                  <span style={sx('font-size:9px;letter-spacing:2.5px')}>{it.rating ? <><span style={sx('color:var(--accent)')}>{'●'.repeat(it.rating)}</span><span style={sx('color:var(--border-2)')}>{'○'.repeat(5 - it.rating)}</span></> : ''}</span>
                  <span style={{ fontSize: '10.5px', color: it.flag ? 'var(--accent)' : sm.rowFg }}>{it.flag ? 'flagged' : sm.row}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>{it.scene}</span>
                </div>
              );
            })}
          </div>
        )}

        {triage && selIds.length > 0 && (
          <div style={sx('position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:8px 10px 8px 16px;border-radius:12px;background:var(--raise);border:1px solid var(--border-3);box-shadow:0 12px 32px rgba(0,0,0,.6);font-size:12px;z-index:45;animation:dl-in .15s ease-out')}>
            <span style={sx('font-weight:700;color:var(--accent);margin-right:8px')}>{selIds.length} selected</span>
            <div onClick={() => { selIds.forEach(id => this.keepIt(S.proj, id, true)); this.setState({ sel: {} }); this.showToast('Kept ' + selIds.length + ' items', 'var(--ok)'); }} className="hBgGreen" style={sx('padding:5px 11px;border-radius:7px;color:var(--ok);cursor:pointer')}>✓ Keep</div>
            <div onClick={() => { selIds.forEach(id => this.killIt(S.proj, id, true)); this.setState({ sel: {} }); this.showToast('Killed ' + selIds.length + ' items — staged in Trash', 'var(--danger)'); }} className="hBgRed" style={sx('padding:5px 11px;border-radius:7px;color:var(--danger);cursor:pointer')}>✕ Kill</div>
            <div onClick={() => this.trashIds(S.proj, selIds)} className="hBgRed12" style={sx('padding:5px 11px;border-radius:7px;color:var(--danger);cursor:pointer')}>Trash</div>
            <div style={sx('width:1px;height:16px;background:var(--border-2);margin:0 4px')} />
            <div onClick={() => this.setState({ sel: {} })} className="hBgEsc" style={sx('padding:5px 9px;border-radius:7px;color:var(--fg-faint);cursor:pointer')}>Esc</div>
          </div>
        )}
      </div>
    );
  }

  // ⚡ Animate — the item header's video-from-still, through THE composer (frontend/Composer.jsx)
  // instead of a blind one-click spend. The frame rides as refUrls[0]; N takes fire as N separate
  // /api/generate calls (Story.batchGenerate's repeat pattern — variantCount is not a field on
  // /api/generate, and /api/batches has no refUrls seam).
  renderAnimateComposer() {
    const G = this.state.animGen;
    const close = () => this.setState({ animGen: null });
    const submit = async () => {
      if (this.state.animBusy) return;
      this.setState({ animBusy: true });
      const clean = {};
      for (const [k, v] of Object.entries(G.params || {})) {
        if (v === undefined || v === null || v === '' || v === '-') continue;
        clean[k] = v;
      }
      const paramsField = Object.keys(clean).length ? { params: clean } : {};
      const n = Math.max(1, Number(G.variantCount) || 1);
      try {
        for (let i = 0; i < n; i++) {
          await api.generate({
            pid: G.pid, shot: G.shot, prompt: G.prompt, model: G.model,
            aspect: G.aspect, resolution: G.resolution,
            seed: G.seed === '' ? null : Number(G.seed),
            refUrls: [G.refUrl], ...paramsField
          });
        }
        this.showToast('Animating this frame — ' + modelName(G.model) + (n > 1 ? ' × ' + n : '') + ' (watch the QUEUE)', 'var(--accent)');
        this.sync();
        this.setState({ animGen: null, animBusy: false });
      } catch (e) {
        this.showToast('Animate failed — ' + (e.message || ''), 'var(--danger)');
        this.setState({ animBusy: false });
      }
    };
    return (
      <div onClick={close} style={sx('position:fixed;inset:0;z-index:70;background:rgba(5,6,8,.55);display:flex;align-items:flex-end;justify-content:center;padding-bottom:40px')}>
        <div onClick={e => e.stopPropagation()} style={{ ...sx('width:100%'), maxWidth: 680 }}>
          <Composer
            app={this}
            value={G}
            onChange={v => this.setState({ animGen: { ...G, ...v } })}
            mentions={[{ id: 'start', label: '▶ start frame', thumb: G.refUrl }]}
            busy={this.state.animBusy}
            onSubmit={submit}
            submitLabel={G.variantCount > 1 ? 'Queue ' + G.variantCount + '×' : 'Animate'}
            placeholder="Describe the motion — the still frame is attached as the start image."
          />
        </div>
      </div>
    );
  }

  renderItem() {
    const S = this.state;
    const it = this.getItem(S.proj, S.item);
    // the open item vanished (emptied trash / deleted elsewhere, picked up by the poll). Don't
    // silently render items[0] from a possibly-different project — keep/kill would hit the wrong
    // item. Bounce back to the project (or home) on the next tick.
    if (!it) { if (!this._bounced) { this._bounced = true; setTimeout(() => { this._bounced = false; this.state.proj ? this.openProj(this.state.proj) : this.go('home'); }, 0); } return null; }
    const pdef = this.projDef(it.proj);
    const itSt = it.st === 'kept' ? { l: '✓ KEPT', fg: 'var(--ok)', bd: 'rgba(63,207,142,.4)' } : it.st === 'killed' ? { l: '✕ KILLED', fg: 'var(--danger)', bd: 'rgba(240,91,84,.4)' } : { l: '● NEW', fg: 'var(--accent)', bd: 'var(--accent-35)' };
    const abOn = S.ab === 1 && it.versions && it.versions.length >= 2;
    const abVersion = abOn ? it.versions[it.versions.length - 2] : null;
    const tcPct = it.durS ? Math.min(100, S.tc / it.durS * 100) : 0;
    const playing = S.playing && it.durS > 0;
    const grad = abOn ? abVersion.grad : (it.versions ? it.versions[it.versions.length - 1].grad : it.grad);
    const briefLine = (pdef.brief || '').split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ');
    return (
      <div style={sx('min-height:100%')}>
        <div style={sx('display:flex;align-items:center;gap:14px;padding:12px 24px;border-bottom:1px solid var(--border)')}>
          <span onClick={() => this.openProj(it.proj)} className="hFgL" style={sx('color:var(--fg-faint);font-size:13px;cursor:pointer')}>← {pdef.name}</span>
          <span style={{ fontFamily: MONO, fontSize: '12.5px' }}>{it.name}</span>
          <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;border-radius:99px;padding:2px 9px'), color: itSt.fg, border: '1px solid ' + itSt.bd }}>{itSt.l}</span>
          <div style={sx('margin-left:auto;display:flex;gap:8px;font-size:11.5px')}>
            <div onClick={() => this.copyPrompt()} className="hBd" style={sx('padding:6px 12px;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);cursor:pointer')}>Copy prompt <span style={{ fontFamily: MONO, fontSize: '9.5px', color: 'var(--fg-faint)' }}>P</span></div>
            {this.promptOf(it) && (S.styleLockSaving ? (
              <div style={sx('display:flex;align-items:center;gap:6px')}>
                <input value={S.styleLockNameDraft} autoFocus onChange={e => this.setState({ styleLockNameDraft: e.target.value })}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.commitSaveStyleLock(); else if (e.key === 'Escape') this.cancelSaveStyleLock(); }}
                  style={sx('width:160px;background:var(--ink);border:1px solid var(--accent-60);border-radius:7px;color:var(--fg);font-size:11.5px;padding:6px 9px')} />
                <span onClick={() => this.commitSaveStyleLock()} className="hAccent" style={sx('font-size:11px;color:var(--accent);font-weight:600;cursor:pointer')}>Save</span>
                <span onClick={() => this.cancelSaveStyleLock()} className="hFgL" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>Cancel</span>
              </div>
            ) : (
              <div onClick={() => this.startSaveStyleLock()} className="hBd" style={sx('padding:6px 12px;border:1px solid var(--accent-35);border-radius:8px;color:var(--accent);cursor:pointer')}>✦ Save as style lock</div>
            ))}
            <div onClick={() => { api.reveal(it.proj, it.id).catch(() => { }); this.showToast('Revealed in Finder', 'var(--fg-faint)'); }} className="hBd" style={sx('padding:6px 12px;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);cursor:pointer')}>Reveal in Finder</div>
            {(() => {
              const f = this.fileOf(it);
              if (!f || /\.mp4$/.test(f) || !S.falReady) return null;
              const gen = (S.projects.find(p => p.id === it.proj)?.gens || []).find(g => g.file === f && g.resultUrl);
              if (!gen) return null;
              const sh = S.shots.find(s => s.proj === it.proj && (s.assets || []).includes(it.id));
              const vModel = S.settings.modelDefaults?.video || 'fal-ai/bytedance/seedance-2.0/image-to-video';
              return (
                // ⚡ Animate opens THE composer prefilled (video model, prompt, this frame as the
                // start image) rather than firing a blind one-click generation — the user sees and
                // can edit exactly what will ship before spending. See renderAnimateComposer().
                <div onClick={() => this.setState({
                  animGen: {
                    pid: it.proj, shot: sh ? sh.id : null, refUrl: gen.resultUrl,
                    prompt: (sh?.videoPrompt || it.prompt || it.label.toLowerCase()),
                    model: vModel, aspect: '16:9', resolution: undefined, seed: '', variantCount: 1, params: {},
                  }
                })} className="hBdAccent" style={sx('padding:6px 12px;border:1px solid var(--accent-35);border-radius:8px;color:var(--accent);font-weight:600;cursor:pointer')}>⚡ Animate</div>
              );
            })()}
            <div onClick={() => this.toggleFinal()} className="hBdGreen" style={{ ...sx('padding:6px 12px;border-radius:8px;color:var(--ok);cursor:pointer'), border: '1px solid ' + (it.fin ? 'var(--ok)' : 'rgba(63,207,142,.4)'), background: it.fin ? 'rgba(63,207,142,.1)' : 'transparent' }}>{it.fin ? '✓ Final' : 'Mark final'} <span style={{ fontFamily: MONO, fontSize: '9.5px', opacity: .7 }}>L</span></div>
            <div onClick={() => { this.trashIds(it.proj, [it.id]); this.openProj(it.proj); }} className="hBdRed5" style={sx('padding:6px 12px;border:1px solid var(--border-2);border-radius:8px;color:var(--danger);cursor:pointer')}>Trash</div>
          </div>
        </div>
        <div style={sx('display:grid;grid-template-columns:1fr 420px')}>
          <div style={sx('padding:20px 24px 32px;border-right:1px solid var(--border)')}>
            <div onClick={() => it.durS > 0 && this.setState(s => ({ playing: !s.playing }))} style={{ ...sx('position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;cursor:pointer'), background: grad }}>
              {this.itemMedia(it, abOn ? (abVersion.file || '') : undefined, true)}
              <span style={sx('position:absolute;top:12px;left:14px;font-size:11px;font-weight:600;letter-spacing:.1em;color:rgba(255,255,255,.85);text-shadow:0 1px 4px rgba(0,0,0,.5)')}>{it.scene} · {it.label}</span>
              {!playing && <div style={sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center')}><div style={sx('width:58px;height:58px;border-radius:99px;background:rgba(6,7,10,.6);display:flex;align-items:center;justify-content:center')}><svg width="18" height="20" viewBox="0 0 10 12" fill="none"><path d="M0 0L10 6L0 12V0Z" fill="var(--fg)" /></svg></div></div>}
              {playing && <span style={sx('position:absolute;top:14px;right:14px;width:9px;height:9px;border-radius:99px;background:var(--fg);animation:dl-pulse 1.2s infinite')} />}
              {abOn && <span style={sx('position:absolute;bottom:12px;left:14px;font-size:10px;font-weight:700;background:var(--border);color:var(--fg-soft);border-radius:4px;padding:2px 8px')}>SHOWING {abVersion.v.toUpperCase()}</span>}
              <span style={{ ...sx('position:absolute;bottom:12px;right:14px;border-radius:5px;padding:2px 8px'), fontFamily: MONO, fontSize: '11.5px', background: 'rgba(6,7,10,.7)' }}>{'00:00:' + String(Math.floor(S.tc)).padStart(2, '0') + ':' + String(Math.floor((S.tc % 1) * 24)).padStart(2, '0')}</span>
            </div>
            <div style={sx('margin-top:14px')}>
              <div style={sx('position:relative;height:5px;border-radius:99px;background:var(--border)')}>
                <div style={{ ...sx('position:absolute;left:0;top:0;bottom:0;background:var(--fg);border-radius:99px'), width: tcPct + '%' }} />
                <div style={{ ...sx('position:absolute;top:50%;width:13px;height:13px;border-radius:99px;background:var(--fg);transform:translate(-50%,-50%);box-shadow:0 2px 8px rgba(0,0,0,.6)'), left: tcPct + '%' }} />
              </div>
              <div style={{ ...sx('display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--fg-faint)'), fontFamily: MONO }}><span>{S.tc.toFixed(1)}s</span><span>{it.durS ? this.fmtDur(it.durS) + '.0' : 'still'}</span></div>
            </div>
            <div style={sx('display:flex;align-items:center;gap:6px;margin-top:10px')}>
              <div onClick={() => this.setState(s => { const t = Math.max(0, s.tc - 1 / 24); this._pendingSeek = t; return { tc: t, playing: false }; })} className="hBd" style={{ ...sx('width:32px;height:30px;border:1px solid var(--border-2);border-radius:7px;display:flex;align-items:center;justify-content:center;color:var(--fg-soft);font-size:11px;cursor:pointer'), fontFamily: MONO }}>⇤</div>
              <div onClick={() => it.durS > 0 && this.setState(s => ({ playing: !s.playing }))} style={sx('width:42px;height:30px;border-radius:7px;background:var(--fg);display:flex;align-items:center;justify-content:center;cursor:pointer')}>
                {!playing ? <svg width="11" height="13" viewBox="0 0 10 12" fill="none"><path d="M0 0L10 6L0 12V0Z" fill="var(--on-accent)" /></svg>
                  : <svg width="10" height="12" viewBox="0 0 10 12" fill="none"><rect x="1" y="1" width="3" height="10" fill="var(--on-accent)" /><rect x="6" y="1" width="3" height="10" fill="var(--on-accent)" /></svg>}
              </div>
              <div onClick={() => this.setState(s => { const t = Math.min(it.durS, s.tc + 1 / 24); this._pendingSeek = t; return { tc: t, playing: false }; })} className="hBd" style={{ ...sx('width:32px;height:30px;border:1px solid var(--border-2);border-radius:7px;display:flex;align-items:center;justify-content:center;color:var(--fg-soft);font-size:11px;cursor:pointer'), fontFamily: MONO }}>⇥</div>
              <div onClick={() => this.setState(s => ({ loop: !s.loop }))} style={{ ...sx('padding:6px 11px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer'), border: '1px solid ' + (S.loop ? 'var(--accent-35)' : 'var(--border-2)'), color: S.loop ? 'var(--accent)' : 'var(--fg-faint)' }}>{S.loop ? 'Loop on' : 'Loop off'}</div>
              <div style={{ ...sx('display:flex;border:1px solid var(--border-2);border-radius:7px;overflow:hidden'), fontFamily: MONO, fontSize: '10.5px' }}>
                {[0.5, 1, 2].map(sp => (
                  <div key={sp} onClick={() => this.setState({ speed: sp })} style={{ ...sx('padding:6px 9px;cursor:pointer'), background: S.speed === sp ? 'var(--border)' : 'transparent', color: S.speed === sp ? 'var(--fg)' : 'var(--fg-faint)', fontWeight: S.speed === sp ? 600 : 400 }}>{sp === 0.5 ? '.5×' : sp + '×'}</div>
                ))}
              </div>
              <div onClick={() => this.setState(s => ({ audio: !s.audio }))} className="hBd" style={{ ...sx('padding:6px 11px;border:1px solid var(--border-2);border-radius:7px;font-size:11px;cursor:pointer'), color: S.audio ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>{S.audio ? 'Audio on' : 'Audio off'}</div>
            </div>
            {(it.versions || it.fbState === 'queued') && (
              <div style={sx('margin-top:20px')}>
                <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:9px')}>
                  <span style={sx('font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint)')}>VERSIONS</span>
                  <div onClick={() => this.toggleAB()} className="hBd" style={{ ...sx('margin-left:auto;padding:4px 10px;border-radius:7px;cursor:pointer;font-size:11px'), border: '1px solid ' + (abOn ? 'var(--accent-35)' : 'var(--border-2)'), color: abOn ? 'var(--accent)' : 'var(--fg-soft)' }}>A/B toggle <span style={{ fontFamily: MONO, fontSize: '9.5px', opacity: .7 }}>C</span></div>
                </div>
                <div style={sx('display:flex;gap:10px')}>
                  {(it.versions || []).map((v, ix, arr) => (
                    <div key={ix} style={sx('width:150px')}>
                      <div style={{ ...sx('position:relative;aspect-ratio:16/9;border-radius:7px;overflow:hidden'), background: v.grad, opacity: ix === arr.length - 1 ? 1 : 0.45, border: '1.5px solid ' + (ix === arr.length - 1 ? 'var(--accent)' : 'transparent'), animation: (ix === arr.length - 1 && it.justArrived) ? 'dl-ring 1.2s ease-out 2' : 'none' }}>
                        {v.file && this.itemMedia(it, v.file)}
                        {ix === arr.length - 1 && <span style={sx('position:absolute;top:5px;right:5px;font-size:8.5px;font-weight:800;background:var(--border);color:var(--fg-soft);border-radius:3px;padding:1px 5px')}>CURRENT</span>}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)', marginTop: 4 }}>{v.v} · {this.fmt$(v.cost)} · {v.date}</div>
                    </div>
                  ))}
                  {it.fbState === 'queued' && (
                    <div style={sx('width:150px')}>
                      <div style={sx('aspect-ratio:16/9;border-radius:7px;border:1.5px dashed var(--accent-60);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--accent);animation:dl-pulse 1.6s infinite')}>re-rolling…</div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)', marginTop: 4 }}>from your note</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div style={sx('padding:20px 24px 32px;display:flex;flex-direction:column;gap:18px')}>
            <div>
              <div style={sx('display:flex;gap:8px')}>
                <div onClick={() => this.keepIt(it.proj, it.id)} className="hBdGreen" style={{ ...sx('flex:1;display:flex;align-items:center;justify-content:center;gap:8px;height:44px;border-radius:9px;cursor:pointer;font-weight:700;font-size:13px'), background: it.st === 'kept' ? 'rgba(63,207,142,.14)' : 'transparent', border: '1.5px solid ' + (it.st === 'kept' ? 'var(--ok)' : 'var(--border-2)'), color: it.st === 'kept' ? 'var(--ok)' : 'var(--fg-faint)' }}>✓ Keep <span style={{ fontFamily: MONO, fontSize: 10, border: '1px solid var(--border-2)', borderRadius: 4, padding: '1px 5px' }}>K</span></div>
                <div onClick={() => this.killIt(it.proj, it.id)} className="hBdRed" style={{ ...sx('flex:1;display:flex;align-items:center;justify-content:center;gap:8px;height:44px;border-radius:9px;cursor:pointer;font-weight:700;font-size:13px'), background: it.st === 'killed' ? 'rgba(240,91,84,.12)' : 'transparent', border: '1.5px solid ' + (it.st === 'killed' ? 'var(--danger)' : 'var(--border-2)'), color: it.st === 'killed' ? 'var(--danger)' : 'var(--fg-faint)' }}>✕ Kill <span style={{ fontFamily: MONO, fontSize: 10, border: '1px solid var(--border-2)', borderRadius: 4, padding: '1px 5px' }}>X</span></div>
              </div>
              <div style={sx('display:flex;align-items:center;gap:10px;margin-top:10px')}>
                <span style={sx('font-size:11px;color:var(--fg-faint)')}>Rating</span>
                <div style={sx('display:flex;gap:2px')}>
                  {[1, 2, 3, 4, 5].map(r => <span key={r} onClick={() => this.rateIt(it.proj, it.id, r)} className="hAccent" style={{ ...sx('font-size:16px;cursor:pointer;padding:0 2px'), color: r <= it.rating ? 'var(--accent)' : 'var(--border-2)' }}>●</span>)}
                </div>
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)', marginLeft: 'auto' }}>keys 1–5</span>
              </div>
            </div>
            <div>
              <div style={sx('font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:7px')}>FEEDBACK → RE-ROLL</div>
              {!it.fbState && (
                <div style={sx('border:1px solid var(--border-3);border-radius:10px;background:var(--surface);overflow:hidden')}>
                  <textarea value={S.noteDraft} onChange={e => this.setState({ noteDraft: e.target.value })}
                    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.queueNoteFor(it.proj, it.id, S.noteDraft); this.setState({ noteDraft: '' }); } }}
                    placeholder="What should change? The AI reads this verbatim — be concrete."
                    style={sx('width:100%;box-sizing:border-box;height:66px;resize:none;background:transparent;border:none;color:var(--fg);font-size:12.5px;line-height:1.5;padding:11px 13px')} />
                  <div style={sx('display:flex;align-items:center;gap:10px;padding:7px 10px;border-top:1px solid var(--border)')}>
                    <span style={sx('font-size:10.5px;color:var(--fg-faint)')}>⌘/Ctrl-Enter to queue</span>
                    <VoiceInput app={this} size={22} onText={t => this.setState(s => ({ noteDraft: (s.noteDraft ? s.noteDraft.trim() + ' ' : '') + t }))} />
                    <div onClick={() => { this.queueNoteFor(it.proj, it.id, S.noteDraft); this.setState({ noteDraft: '' }); }} className="hBdAccent" style={sx('margin-left:auto;padding:5px 13px;border-radius:7px;border:1px solid var(--accent-35);background:transparent;color:var(--accent);font-weight:700;font-size:11px;cursor:pointer')}>Queue re-roll · {this.fmt$(it.cost)}</div>
                  </div>
                </div>
              )}
              {it.fbState === 'queued' && (
                <div style={sx('border:1px solid var(--accent-35);border-radius:10px;background:var(--surface);overflow:hidden')}>
                  <div style={sx('padding:11px 13px;font-size:12.5px;line-height:1.55;color:var(--fg)')}>{it.note}</div>
                  <div style={sx('display:flex;align-items:center;gap:7px;padding:8px 13px;border-top:1px solid var(--border);background:var(--accent-05)')}>
                    <span style={sx('width:7px;height:7px;border-radius:99px;background:var(--accent);animation:dl-pulse 1.6s infinite')} />
                    <span style={sx('font-size:11px;color:var(--accent);font-weight:600')}>Queued for re-roll</span>
                    <span style={sx('font-size:10.5px;color:var(--fg-faint)')}>· claude-code session running in the background</span>
                    <span onClick={() => { this.setState({ noteDraft: it.note }); this.patchItem(it.proj, it.id, { fbState: null }); }} className="hFgL" style={sx('margin-left:auto;font-size:10.5px;color:var(--fg-faint);cursor:pointer')}>Edit</span>
                  </div>
                </div>
              )}
              {it.fbState === 'done' && (
                <div style={sx('border:1px solid rgba(63,207,142,.45);border-radius:10px;background:rgba(63,207,142,.04);overflow:hidden')}>
                  <div style={sx('padding:11px 13px;font-size:12.5px;line-height:1.55;color:var(--fg)')}>{it.note}</div>
                  <div style={sx('display:flex;align-items:center;gap:7px;padding:8px 13px;border-top:1px solid rgba(63,207,142,.2)')}>
                    <span style={sx('font-size:11px;color:var(--ok);font-weight:600')}>✓ {it.versions ? it.versions[it.versions.length - 1].v : 'v2'} created from this note</span>
                    <span onClick={() => { this.setState({ noteDraft: '' }); this.patchItem(it.proj, it.id, { fbState: null }); }} className="hFgL" style={sx('margin-left:auto;font-size:10.5px;color:var(--fg-faint);cursor:pointer')}>New note</span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <div style={sx('display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px')}>
                <span style={sx('font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint)')}>GENERATION PROMPT</span>
                <span onClick={() => this.copyPrompt()} className="hAccent" style={sx('font-size:10.5px;color:var(--accent);cursor:pointer')}>Copy</span>
              </div>
              <div style={{ ...sx('padding:11px 13px;border:1px solid var(--border);border-radius:10px;background:var(--surface);line-height:1.7;color:var(--fg-muted)'), fontFamily: MONO, fontSize: '10.5px' }}>{this.promptOf(it)}</div>
              <div onClick={() => this.openProj(it.proj, 'references')} className="hBd" style={sx('margin-top:8px;padding:8px 13px;border:1px dashed var(--border);border-radius:10px;cursor:pointer')}>
                <span style={sx('font-size:9.5px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted)')}>PROJECT CONTEXT</span>
                <span style={sx('font-size:10.5px;color:var(--fg-faint);margin-left:8px')}>brief + {(((pdef.context || {}).items) || []).length} assets · injected into every re-roll</span>
                <div style={sx('font-size:11px;color:var(--fg-muted);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{briefLine || 'Open the project to add context.'}</div>
              </div>
            </div>
            <div style={sx('border-top:1px solid var(--border);padding-top:14px;display:grid;grid-template-columns:96px 1fr;row-gap:9px;font-size:11.5px')}>
              <span style={sx('color:var(--fg-faint)')}>Model</span><span>{pdef.model}</span>
              <span style={sx('color:var(--fg-faint)')}>Cost</span><span style={{ fontFamily: MONO, color: 'var(--accent)' }}>{this.fmt$(it.cost)} <span style={sx('color:var(--fg-faint)')}>{it.versions ? '(' + it.versions.length + ' versions · ' + this.fmt$(it.versions.reduce((a, v) => a + v.cost, 0)) + ' total)' : ''}</span></span>
              <span style={sx('color:var(--fg-faint)')}>Created</span><span>{it.created}</span>
              <span style={sx('color:var(--fg-faint)')}>Scene</span><span>{it.scene} — {it.label.toLowerCase()}</span>
              {(() => {
                const sh = S.shots.find(s => s.proj === it.proj && (s.assets || []).includes(it.id));
                return sh ? <><span style={sx('color:var(--fg-faint)')}>Shot</span><span onClick={() => this.openProj(it.proj, 'story')} className="hAccent" style={{ fontFamily: MONO, fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}>{sh.id} · {sh.title} →</span></> : null;
              })()}
              {this.fileOf(it) && <><span style={sx('color:var(--fg-faint)')}>File</span><span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{'projects/' + it.proj + '/renders/' + this.fileOf(it)}</span></>}
              <span style={sx('color:var(--fg-faint)')}>Sidecar</span><span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{'projects/' + it.proj + '/items/' + it.id.replace(/[^\w.\-]+/g, '_') + '.md'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  renderCosts() {
    const S = this.state;
    const items = S.items;
    const monthTotal = this.monthSpend();
    const mf = this.monthFrac();
    const pace = (monthTotal / S.settings.budget) / mf.frac;
    const paceHot = pace > 1.25;
    const projTotals = S.projects.map(p => ({ p, v: items.filter(x => x.proj === p.id).reduce((a, x) => a + x.cost, 0) }));
    const maxP = Math.max(...projTotals.map(x => x.v), 0.01);
    const byType = t => this.fmt$(items.filter(x => x.type === t).reduce((a, x) => a + x.cost, 0));
    const sorted = items.slice().sort((a, b) => b.cost - a.cost);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)].cost : 0;
    const top = sorted.slice(0, 6);
    return (
      <div style={sx('padding:24px 32px')}>
        <div style={sx('font-weight:700;font-size:16px;margin-bottom:18px')}>Costs</div>
        <div style={sx('padding:16px 18px;border:1px solid var(--border);border-radius:12px;background:var(--surface);margin-bottom:16px')}>
          <div style={sx('display:flex;align-items:baseline;gap:12px')}>
            <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, color: 'var(--accent)' }}>{this.fmt$(monthTotal)}</span>
            <span style={sx('font-size:12px;color:var(--fg-muted)')}>of ${S.settings.budget} monthly budget</span>
            <span style={{ ...sx('margin-left:auto;font-size:11.5px;font-weight:600'), color: paceHot ? 'var(--warn)' : 'var(--ok)' }}>{paceHot ? 'Ahead of even pace for the month' : 'On track for the month'}</span>
          </div>
          <div style={sx('position:relative;height:8px;border-radius:99px;background:var(--border);margin-top:12px;overflow:hidden')}>
            <div style={{ ...sx('height:100%;background:var(--accent);border-radius:99px'), width: Math.min(100, Math.round(monthTotal / S.settings.budget * 100)) + '%' }} />
          </div>
          <div style={sx('display:flex;justify-content:space-between;margin-top:6px;font-size:10.5px;color:var(--fg-faint)')}>
            <span>{new Date().toLocaleString('en-US', { month: 'short' })} 1</span>
            <span>day {mf.day} — even pace would be {Math.round(mf.frac * 100)}%</span>
            <span>{new Date().toLocaleString('en-US', { month: 'short' })} {mf.days}</span>
          </div>
        </div>
        <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:16px')}>
          <div style={sx('border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:16px 18px')}>
            <div style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:12px')}>BY PROJECT</div>
            {projTotals.map(({ p, v }) => (
              <div key={p.id} onClick={() => this.openProj(p.id)} className="hBg" style={sx('display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer')}>
                <span style={sx('font-size:12.5px;font-weight:600;width:130px')}>{p.name}</span>
                <div style={sx('flex:1;height:6px;border-radius:99px;background:var(--line);overflow:hidden')}><div style={{ ...sx('height:100%;background:var(--border-3);border-radius:99px'), width: Math.round(v / maxP * 100) + '%' }} /></div>
                <span style={{ fontFamily: MONO, fontSize: '11.5px', color: 'var(--accent)', width: 56, textAlign: 'right' }}>{this.fmt$(v)}</span>
              </div>
            ))}
            <div style={sx('display:flex;gap:14px;margin-top:12px;font-size:11px;color:var(--fg-faint)')}>
              <span>Clips <span style={{ color: 'var(--fg-muted)', fontFamily: MONO }}>{byType('clip')}</span></span>
              <span>Images <span style={{ color: 'var(--fg-muted)', fontFamily: MONO }}>{byType('img')}</span></span>
              <span>Renders <span style={{ color: 'var(--fg-muted)', fontFamily: MONO }}>{byType('render')}</span></span>
            </div>
          </div>
          <div style={sx('border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:16px 18px')}>
            <div style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:12px')}>MOST EXPENSIVE ITEMS</div>
            {top.map(x => (
              <div key={this.itemKey(x)} onClick={() => this.openItem(x.proj, x.id)} className="hBg" style={sx('display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);cursor:pointer')}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--fg-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{x.name}</span>
                {x.cost > 2 * med && x.type === 'clip' && <span style={sx('font-size:9.5px;font-weight:700;color:var(--accent);border:1px solid var(--accent-35);border-radius:99px;padding:1px 7px;flex:none')}>⚑ outlier</span>}
                <span style={{ fontFamily: MONO, fontSize: '11.5px', color: 'var(--accent)', flex: 'none' }}>{this.fmt$(x.cost)}</span>
              </div>
            ))}
            <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:10px')}>Outlier = more than 2× the median item cost</div>
          </div>
        </div>
        {S.ledger.length > 0 && (
          <div style={sx('border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:16px 18px;margin-top:16px')}>
            <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap')}>
              <span style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint)')}>REAL LEDGER</span>
              <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10 }}>costs.md · {S.ledger.length} entries · total <span style={{ color: 'var(--accent)' }}>{this.fmt$(S.ledger.reduce((a, e) => a + (e.cost || 0), 0))}</span></span>
              {['fal', 'groq'].map(sv => {
                const t = S.ledger.filter(e => e.service === sv).reduce((a, e) => a + (e.cost || 0), 0);
                return <span key={sv} style={{ ...sx('color:var(--fg-muted)'), fontFamily: MONO, fontSize: 10 }}>{sv} <span style={{ color: sv === 'fal' ? 'var(--accent)' : 'var(--fg-soft)' }}>{this.fmt$(t)}</span></span>;
              })}
              {(() => { // last-30-days daily sparkline (F6)
                const day = 86400000, now = Date.now();
                const days = Array.from({ length: 30 }, (_, i) => {
                  const d0 = now - (29 - i) * day;
                  return S.ledger.filter(e => e.ts >= d0 - (d0 % day) && e.ts < d0 - (d0 % day) + day).reduce((a, e) => a + (e.cost || 0), 0);
                });
                const mx = Math.max(0.001, ...days);
                return (
                  <svg width="150" height="22" style={{ marginLeft: 'auto', flex: 'none' }} title="last 30 days">
                    {days.map((v, i) => (
                      <rect key={i} x={i * 5} y={22 - Math.max(1, (v / mx) * 20)} width="3.5" height={Math.max(1, (v / mx) * 20)} rx="1"
                        fill={v > 0 ? 'var(--accent)' : 'var(--border)'} opacity={v > 0 ? 0.9 : 1} />
                    ))}
                  </svg>
                );
              })()}
            </div>
            {S.ledger.slice(0, 12).map((e, i) => (
              <div key={i} style={sx('display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--line);font-size:11px')}>
                <span style={{ ...sx('width:34px;font-weight:700;letter-spacing:.06em;text-transform:uppercase'), fontFamily: MONO, fontSize: 9, color: e.service === 'fal' ? 'var(--accent)' : 'var(--fg-muted)' }}>{e.service}</span>
                <span style={sx('width:52px;color:var(--fg-muted);font-size:10.5px')}>{e.op}</span>
                <span style={{ ...sx('flex:1;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10 }}>{e.model} {e.ref ? '· ' + e.ref : ''}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)', flex: 'none' }}>{e.at}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--accent)', width: 60, textAlign: 'right', flex: 'none' }}>${(e.cost || 0).toFixed(3)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── generation Queue (Phase 7) ──
  batchAct(fn, id, ...args) { fn(id, ...args).then(() => this.sync()).catch(e => this.showToast('Batch action failed — ' + (e.message || ''), 'var(--danger)')); }
  renderQueue() {
    const S = this.state;
    const batches = (S.batches || []).slice().sort((a, b) => (b.created || 0) - (a.created || 0));
    const stC = { draft: 'var(--fg-faint)', queued: 'var(--accent)', running: 'var(--accent)', paused: 'var(--warn)', done: 'var(--ok)', failed: 'var(--danger)', cancelled: 'var(--fg-faint)' };
    const active = batches.filter(b => b.status === 'queued' || b.status === 'running' || b.status === 'paused');
    return (
      <div style={sx('padding:24px 32px;max-width:900px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:6px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Generation Queue</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>{active.length ? active.length + ' active · ' + batches.length + ' total' : batches.length + ' batches'}</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:18px')}>Each batch snapshots its settings and creates one immutable candidate per variant. Concurrency is 2. maxSpend is a hard server ceiling.</div>
        {!batches.length && <div style={sx('padding:60px 0;text-align:center;color:var(--fg-faint);font-size:13px')}>No batches yet. Queue one from a project's Generate tab (variant buttons → Queue batch).</div>}
        {batches.map(b => {
          const n = (b.entries || []).length || 1;
          const doneN = (b.completedCount || 0) + (b.failedCount || 0) + (b.cancelledCount || 0);
          const frac = Math.min(1, doneN / n);
          return (
            <div key={b.id} style={sx('border:1px solid var(--line);border-radius:12px;margin-bottom:12px;background:var(--surface);overflow:hidden')}>
              <div style={sx('display:flex;align-items:center;gap:12px;padding:12px 14px')}>
                <span style={{ ...sx('font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;border-radius:5px;padding:2px 8px'), color: 'var(--void)', background: stC[b.status] || 'var(--fg-faint)' }}>{b.status}</span>
                <div style={sx('flex:1;min-width:0')}>
                  <div style={{ fontFamily: MONO, fontSize: '12px', color: 'var(--fg-soft)' }}>{this.projDef(b.project).name} · {b.variantCount}× · {(b.shotIds || []).filter(Boolean).join(', ') || 'no shot'}</div>
                  <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:2px')}>{b.completedCount || 0}/{n} done{b.failedCount ? ' · ' + b.failedCount + ' failed' : ''}{b.cancelledCount ? ' · ' + b.cancelledCount + ' cancelled' : ''} · ${Number(b.actualSpend || 0).toFixed(3)} / est ${Number(b.estimatedCost || 0).toFixed(2)}{b.maxSpend != null ? ' · max $' + Number(b.maxSpend).toFixed(2) : ''}{b.pauseReason ? ' · ' + b.pauseReason : ''}</div>
                </div>
                <div style={sx('display:flex;gap:7px;flex:none')}>
                  {(b.status === 'running' || b.status === 'queued') && <span onClick={() => this.batchAct(api.pauseBatch, b.id)} className="hBd" style={sx('font-size:10.5px;border:1px solid var(--border-2);border-radius:7px;padding:5px 11px;color:var(--warn);cursor:pointer')}>Pause</span>}
                  {b.status === 'paused' && <span onClick={() => this.batchAct(api.resumeBatch, b.id)} className="hBd" style={sx('font-size:10.5px;border:1px solid var(--border-2);border-radius:7px;padding:5px 11px;color:var(--ok);cursor:pointer')}>Resume</span>}
                  {b.failedCount > 0 && <span onClick={() => this.batchAct(api.retryBatch, b.id, false)} className="hBd" style={sx('font-size:10.5px;border:1px solid var(--border-2);border-radius:7px;padding:5px 11px;color:var(--accent);cursor:pointer')}>Retry</span>}
                  {(b.status === 'running' || b.status === 'queued' || b.status === 'paused') && <span onClick={() => this.batchAct(api.cancelBatch, b.id)} className="hBd" style={sx('font-size:10.5px;border:1px solid var(--border-2);border-radius:7px;padding:5px 11px;color:var(--danger);cursor:pointer')}>Cancel</span>}
                </div>
              </div>
              <div style={sx('height:3px;background:var(--line)')}><div style={{ height: '100%', width: (frac * 100) + '%', background: stC[b.status] || 'var(--fg-faint)' }} /></div>
            </div>
          );
        })}
      </div>
    );
  }

  // `embed` = rendered inside Settings → Trash, which supplies its own page padding and heading.
  // Same renderer either way, so the standalone /trash route and the Settings section can never drift.
  renderTrash(embed) {
    const S = this.state;
    const trashItems = S.items.filter(x => x.trashed || (x.st === 'killed' && !x.trashed));
    const gb = trashItems.reduce((a, x) => a + this.gb(x), 0);
    const summary = trashItems.length ? trashItems.length + ' items · ' + gb.toFixed(1) + ' GB' : 'empty';
    return (
      <div style={sx(embed ? 'padding:0' : 'padding:24px 32px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:6px')}>
          {!embed && <div style={sx('font-weight:700;font-size:16px')}>Trash</div>}
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>{summary}</span>
          {trashItems.length > 0 && <Btn variant="danger" onClick={() => this.setState({ confirmEmpty: true })} style={sx('margin-left:auto')}>Empty trash…</Btn>}
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Killed and deleted items stage here. Nothing is gone until you empty it.</div>
        {trashItems.map(x => (
          <div key={x.id} style={sx('display:flex;align-items:center;gap:12px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;background:var(--surface)')}>
            <div style={{ ...sx('position:relative;width:58px;height:34px;border-radius:5px;overflow:hidden;opacity:.45;flex:none'), background: x.grad }}>{this.itemMedia(x)}</div>
            <div style={sx('flex:1;min-width:0')}>
              <div style={{ fontFamily: MONO, fontSize: '11.5px', color: 'var(--fg-soft)', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</div>
              <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:2px')}>{this.projDef(x.proj).name} · {x.trashed ? 'deleted' : 'killed'} · {x.created}</div>
            </div>
            <span style={{ fontFamily: MONO, fontSize: '10.5px', color: 'var(--fg-faint)', flex: 'none' }}>{this.gb(x).toFixed(2)} GB</span>
            <div onClick={() => { this.patchItem(x.proj, x.id, { trashed: false, st: 'new' }, { log: 'restored from trash' }); this.showToast('Restored ' + x.name, 'var(--ok)'); }} className="hBdGreen5" style={sx('padding:5px 13px;border:1px solid var(--border-2);border-radius:7px;font-size:11px;color:var(--ok);font-weight:600;cursor:pointer;flex:none')}>Restore</div>
          </div>
        ))}
        {!trashItems.length && <div style={sx('padding:40px 0;text-align:center;color:var(--fg-faint);font-size:13px')}>No killed items. Killed clips land here first — nothing is ever silently lost.</div>}

        {/* Staged file/folder deletions (Phase 3D) — assets, boards, generation media, prompts… */}
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin:26px 0 6px')}>
          <div style={sx('font-weight:700;font-size:14px')}>Staged deletions</div>
          <span style={sx('font-size:11.5px;color:var(--fg-faint)')}>{(S.stagedTrash || []).length ? (S.stagedTrash.length + ' recoverable') : 'none'}</span>
          {(S.stagedTrash || []).length > 0 && <div onClick={() => { if (window.confirm('Permanently delete all ' + S.stagedTrash.length + ' staged entries? This cannot be undone.')) api.purgeAllStaged().then(() => { this.showToast('Staged trash purged', 'var(--fg-faint)'); this.loadStagedTrash(); }); }} className="hBgRedSoft" style={sx('margin-left:auto;padding:6px 14px;border:1px solid rgba(240,91,84,.5);border-radius:8px;color:var(--danger);font-weight:600;font-size:12px;cursor:pointer')}>Purge all…</div>}
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:14px')}>Deleted files & folders are moved here (not erased). Restore brings back the whole tree.</div>
        {(S.stagedTrash || []).map(e => (
          <div key={e.id} style={sx('display:flex;align-items:center;gap:12px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;background:var(--surface)')}>
            <div style={sx('flex:1;min-width:0')}>
              <div style={{ fontFamily: MONO, fontSize: '11.5px', color: 'var(--fg-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
              <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:2px')}>{(e.itemKind || 'file')} · {(e.paths || []).length} path{(e.paths || []).length === 1 ? '' : 's'} · {e.at}</div>
            </div>
            <div onClick={() => this.restoreStaged(e.id, e.label)} className="hBdGreen5" style={sx('padding:5px 13px;border:1px solid var(--border-2);border-radius:7px;font-size:11px;color:var(--ok);font-weight:600;cursor:pointer;flex:none')}>Restore</div>
            <div onClick={() => { if (window.confirm('Permanently delete "' + e.label + '"?')) this.purgeStaged(e.id); }} className="hBd" style={sx('padding:5px 11px;border:1px solid var(--border-2);border-radius:7px;font-size:11px;color:var(--fg-faint);cursor:pointer;flex:none')}>Purge</div>
          </div>
        ))}
        {!(S.stagedTrash || []).length && <div style={sx('padding:20px 0;text-align:center;color:var(--fg-faint);font-size:12px')}>No staged file deletions.</div>}
      </div>
    );
  }

  async openSkill(skill, rel = 'SKILL.md') {
    this.setState({ skillSel: skill, skillFileRel: rel, skillLoading: true, skillEdit: false, enhanceOpen: false, skillContent: '' });
    try {
      const r = await api.skillFile(skill.dir + '/' + rel);
      this.setState({ skillContent: r.content, skillLoading: false });
    } catch { this.setState({ skillContent: '*Could not read file.*', skillLoading: false }); }
  }

  // The chat agent's system surface (backend/agentHome.mjs chatSkillsSurface): the router opens
  // read-only — its canonical source ships with the app and session copies are tamper-reset — and
  // house-rules opens editable, saving through its own route (not the generic skill-file route).
  async openSystemSkill(kind) {
    const cs = this.state.chatSkills;
    if (!cs) return;
    if (kind === 'router') {
      const files = (cs.router.files && cs.router.files.length) ? cs.router.files : [{ rel: 'SKILL.md', size: (cs.router.content || '').length }];
      const sk = { name: cs.router.name, dir: '(system)', system: true, files, description: cs.router.description };
      this.setState({ skillSel: sk, skillFileRel: 'SKILL.md', skillLoading: true, skillEdit: false, enhanceOpen: false, skillContent: '' });
      try {
        const r = await api.routerFile('SKILL.md');
        this.setState({ skillContent: r.content, skillLoading: false });
      } catch { this.setState({ skillContent: cs.router.content || '*Could not read file.*', skillLoading: false }); }
      return;
    }
    const sk = { name: 'house-rules', dir: '(chat)', houseRules: true, files: [{ rel: 'SKILL.md', size: (cs.houseRules.content || '').length }], description: 'Your standing preferences for the chat agent — extends the router, never overrides it.' };
    this.setState({ skillSel: sk, skillFileRel: 'SKILL.md', skillLoading: true, skillEdit: false, enhanceOpen: false, skillContent: '' });
    try {
      const r = await api.houseRules();
      this.setState({ skillContent: r.content || '', skillLoading: false });
    } catch { this.setState({ skillContent: '*Could not read file.*', skillLoading: false }); }
  }

  renderSkills() {
    const S = this.state;
    if (S.skillSel) return this.renderSkillViewer();
    return (
      <div style={sx('padding:24px 32px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Skills</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>{S.skillRepos.reduce((a, r) => a + r.skills.length, 0)} skills across {S.skillRepos.length} repositories — loaded at startup, injected into every agent run</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:18px')}>Click a skill to read it, edit it, or hand it to the background agent for enhancement. Edits keep a <span style={{ fontFamily: MONO, fontSize: 10.5 }}>.bak</span> backup next to the file.</div>
        {S.chatSkills && (
          <div style={sx('margin-bottom:22px')}>
            <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:9px')}>
              <span style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint)')}>CHAT AGENT</span>
              <span style={sx('font-size:10px;color:var(--fg-faint)')}>loaded into every chat session — the orchestrator that routes to your skill packs and tools</span>
            </div>
            <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
              <div onClick={() => this.openSystemSkill('router')} className="hCard" style={sx('border:1px solid var(--accent-35);border-radius:12px;background:var(--surface);padding:14px 16px;cursor:pointer')}>
                <div style={sx('display:flex;align-items:center;gap:9px')}>
                  <span style={{ ...sx('font-size:13px;font-weight:700;color:var(--fg)'), fontFamily: MONO }}>{S.chatSkills.router.name}</span>
                  <span style={sx('font-size:9.5px;font-weight:700;color:var(--accent);border:1px solid var(--accent-35);border-radius:99px;padding:1px 7px;flex:none')}>SYSTEM</span>
                  <span style={sx('font-size:9.5px;font-weight:700;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:99px;padding:1px 7px;flex:none')}>READ-ONLY</span>
                </div>
                <div style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.55;margin-top:7px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden')}>{S.chatSkills.router.description}</div>
                <div style={sx('display:flex;gap:10px;margin-top:10px;font-size:10.5px')}>
                  <span className="hAccent" style={sx('color:var(--accent);font-weight:600')}>Read →</span>
                  <span style={sx('color:var(--fg-faint)')}>Ships with the app · session copies are reset on every start</span>
                </div>
              </div>
              <div onClick={() => this.openSystemSkill('house-rules')} className="hCard" style={sx('border:1px solid var(--border-2);border-radius:12px;background:var(--surface);padding:14px 16px;cursor:pointer')}>
                <div style={sx('display:flex;align-items:center;gap:9px')}>
                  <span style={{ ...sx('font-size:13px;font-weight:700;color:var(--fg)'), fontFamily: MONO }}>house-rules</span>
                  {S.chatSkills.houseRules.active
                    ? <span style={sx('font-size:9.5px;font-weight:700;color:var(--ok);border:1px solid rgba(63,207,142,.4);border-radius:99px;padding:1px 7px;flex:none')}>ACTIVE</span>
                    : <span style={sx('font-size:9.5px;font-weight:700;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:99px;padding:1px 7px;flex:none')}>EMPTY</span>}
                </div>
                <div style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.55;margin-top:7px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden')}>Your standing preferences for the chat agent — favorite packs, default models, phrasing. Extends the router; can never override it.</div>
                <div style={sx('display:flex;gap:10px;margin-top:10px;font-size:10.5px')}>
                  <span className="hAccent" style={sx('color:var(--accent);font-weight:600')}>Edit →</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {S.skillRepos.map((r, i) => (
          <div key={i} style={sx('margin-bottom:22px')}>
            <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:9px')}>
              <span style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint)')}>{r.name.toUpperCase()}</span>
              {!r.exists && <span style={sx('font-size:9.5px;font-weight:700;color:var(--danger);border:1px solid rgba(240,91,84,.4);border-radius:99px;padding:1px 7px')}>MISSING</span>}
              <span style={{ ...sx('font-size:10px;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO }}>{r.paths.join(' · ')}</span>
            </div>
            <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
              {r.skills.map((sk, j) => (
                <div key={j} onClick={() => this.openSkill(sk)} className="hCard" style={sx('border:1px solid var(--border-2);border-radius:12px;background:var(--surface);padding:14px 16px;cursor:pointer')}>
                  <div style={sx('display:flex;align-items:center;gap:9px')}>
                    <span style={{ ...sx('font-size:13px;font-weight:700;color:var(--fg)'), fontFamily: MONO }}>{sk.name}</span>
                    <span style={sx('font-size:9.5px;font-weight:700;color:var(--ok);border:1px solid rgba(63,207,142,.4);border-radius:99px;padding:1px 7px;flex:none')}>LOADED</span>
                    <span style={{ ...sx('margin-left:auto;font-size:10px;color:var(--fg-faint)'), fontFamily: MONO }}>{sk.files.length} file{sk.files.length === 1 ? '' : 's'}</span>
                  </div>
                  <div style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.55;margin-top:7px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden')}>{sk.description || 'No description in SKILL.md frontmatter.'}</div>
                  <div style={sx('display:flex;gap:10px;margin-top:10px;font-size:10.5px')}>
                    <span className="hAccent" style={sx('color:var(--accent);font-weight:600')}>Open →</span>
                    <span onClick={e => { e.stopPropagation(); this.openSkill(sk); this.setState({ enhanceOpen: true }); }} className="hFg" style={sx('color:var(--fg-faint)')}>Enhance with agent</span>
                  </div>
                </div>
              ))}
              {!r.skills.length && <div style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:18px;font-size:11.5px;color:var(--fg-faint)')}>No SKILL.md found under this path — point it at a skill folder in Settings.</div>}
            </div>
          </div>
        ))}
        {this.renderSkillHistory()}
      </div>
    );
  }

  renderSkillViewer() {
    const S = this.state;
    const sk = S.skillSel;
    const file = sk.dir + '/' + S.skillFileRel;
    return (
      <div style={sx('min-height:100%;display:flex;flex-direction:column')}>
        <div style={sx('display:flex;align-items:center;gap:14px;padding:12px 24px;border-bottom:1px solid var(--border);flex:none')}>
          <span onClick={() => this.setState({ skillSel: null, skillEdit: false, enhanceOpen: false })} className="hFgL" style={sx('color:var(--fg-faint);font-size:13px;cursor:pointer')}>← Skills</span>
          <span style={{ fontFamily: MONO, fontSize: '12.5px' }}>{sk.name}</span>
          <span style={{ ...sx('font-size:10px;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px'), fontFamily: MONO }}>{file}</span>
          <div style={sx('margin-left:auto;display:flex;gap:8px;font-size:11.5px')}>
            {sk.system && <span style={sx('font-size:9.5px;font-weight:700;color:var(--accent);border:1px solid var(--accent-35);border-radius:99px;padding:2px 8px;align-self:center')}>SYSTEM · READ-ONLY</span>}
            {!sk.system && !S.skillEdit && <div onClick={() => this.setState({ skillEdit: true, skillDraft: S.skillContent })} className="hBd" style={sx('padding:6px 12px;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);cursor:pointer')}>Edit</div>}
            {S.skillEdit && <div onClick={() => this.setState({ skillEdit: false })} className="hBd" style={sx('padding:6px 12px;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-faint);cursor:pointer')}>Cancel</div>}
            {S.skillEdit && <div onClick={async () => {
              if (sk.houseRules) {
                const out = await api.saveHouseRules(S.skillDraft).catch(() => null);
                if (!out) { this.showToast('Save failed', 'var(--danger)'); return; }
                this.setState({ skillEdit: false, skillContent: S.skillDraft, chatSkills: { ...S.chatSkills, houseRules: { ...S.chatSkills.houseRules, content: S.skillDraft, active: out.active } } });
                this.showToast(out.active ? 'House rules saved — next session loads them' : 'House rules saved (empty — inactive)', 'var(--ok)');
                return;
              }
              await api.saveSkillFile(file, S.skillDraft).catch(() => this.showToast('Save failed', 'var(--danger)'));
              this.setState({ skillEdit: false, skillContent: S.skillDraft });
              this.showToast('Skill saved — backup kept at .bak', 'var(--ok)');
            }} className="hBtnAccent" style={sx('padding:6px 14px;border-radius:8px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer')}>Save</div>}
            {!sk.system && !sk.houseRules && !S.skillEdit && <div onClick={() => this.setState(s => ({ enhanceOpen: !s.enhanceOpen }))} className="hBdAccent" style={{ ...sx('padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:600'), border: '1px solid var(--accent-35)', color: 'var(--accent)', background: S.enhanceOpen ? 'var(--accent-05)' : 'transparent' }}>⚡ Enhance with agent</div>}
          </div>
        </div>
        {S.enhanceOpen && (
          <div style={sx('padding:12px 24px;border-bottom:1px solid var(--border);background:var(--accent-05);flex:none')}>
            <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-bottom:6px')}>ENHANCE INSTRUCTION <span style={sx('font-weight:400;color:var(--fg-faint);letter-spacing:0')}>— the agent rewrites this file, validates it, and writes it back with a .bak backup</span></div>
            <div style={sx('display:flex;gap:10px')}>
              <input value={S.enhanceText} onChange={e => this.setState({ enhanceText: e.target.value })} autoFocus
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.queueEnhance(file); }}
                placeholder='e.g. "add a section on 9:16 vertical framing defaults" or "tighten the trigger list"'
                style={sx('flex:1;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12.5px;padding:9px 12px')} />
              <div onClick={() => this.queueEnhance(file)} className="hBtnAccent" style={sx('padding:9px 16px;border-radius:8px;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:12px;cursor:pointer;flex:none')}>Queue job</div>
            </div>
          </div>
        )}
        <div style={sx('flex:1;display:grid;grid-template-columns:230px 1fr;min-height:0')}>
          <div style={sx('border-right:1px solid var(--border);padding:14px 0;overflow-y:auto')}>
            <div style={sx('padding:0 16px;font-size:9.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:8px')}>FILES</div>
            {sk.files.map(f => (
              <div key={f.rel} onClick={async () => {
                if (sk.houseRules) return; // single editable file — nothing else to browse
                if (sk.system) { // router pack files are browsable read-only via their own route
                  this.setState({ skillFileRel: f.rel, skillLoading: true, skillEdit: false, skillContent: '' });
                  try { const r = await api.routerFile(f.rel); this.setState({ skillContent: r.content, skillLoading: false }); }
                  catch { this.setState({ skillContent: '*Could not read file.*', skillLoading: false }); }
                  return;
                }
                this.openSkill(sk, f.rel);
              }} className="hBg"
                style={{ ...sx('display:flex;align-items:center;gap:8px;padding:6px 16px;cursor:pointer;font-size:10.5px'), fontFamily: MONO, color: f.rel === S.skillFileRel ? 'var(--fg)' : 'var(--fg-muted)', background: f.rel === S.skillFileRel ? 'var(--surface-2)' : 'transparent', borderLeft: f.rel === S.skillFileRel ? '2px solid var(--accent)' : '2px solid transparent' }}>
                <span style={sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1')}>{f.rel}</span>
                <span style={sx('color:var(--fg-faint);font-size:9px;flex:none')}>{fmtKB(f.size)}</span>
              </div>
            ))}
          </div>
          <div style={sx('overflow-y:auto;padding:20px 28px 40px')}>
            {S.skillLoading && <div style={sx('color:var(--fg-faint);font-size:12px')}>Loading…</div>}
            {!S.skillLoading && S.skillEdit && (
              <textarea value={S.skillDraft} onChange={e => this.setState({ skillDraft: e.target.value })}
                onKeyDown={e => e.stopPropagation()}
                style={{ ...sx('width:100%;box-sizing:border-box;height:calc(100vh - 220px);resize:none;background:var(--sunk);border:1px solid var(--border-2);border-radius:10px;color:var(--fg-soft);font-size:11px;line-height:1.65;padding:14px 16px'), fontFamily: MONO }} />
            )}
            {!S.skillLoading && !S.skillEdit && <div><Md src={S.skillContent} /></div>}
          </div>
        </div>
      </div>
    );
  }

  queueEnhance(file) {
    const text = this.state.enhanceText.trim();
    if (!text) return;
    api.enhanceSkill(file, text).catch(() => this.showToast('Could not queue job', 'var(--danger)'));
    this.setState({ enhanceOpen: false, enhanceText: '' });
    this.showToast('Enhancement queued — claude-code is rewriting ' + this.state.skillFileRel, 'var(--accent)');
  }

  // ── CONNECT AN AGENT — one card per provider (Claude Code, Codex), two clicks each ──
  //
  // Sign-in is: click "Sign in", approve in the browser tab the CLI opens itself, done. The card
  // finishes the old step 3 on your behalf — no copying a URL out of a terminal, no pasting a code
  // back, no "now click Test".
  //
  // Two-stage on purpose. The free auth probe (`claude auth status`) is fast but NOT sufficient:
  // it reports loggedIn:true against a stored OAuth token that has since expired, and only a real
  // call 401s. So the probe gates the sign-in step, and a single round-trip run confirms it — the
  // app runs that itself and only then calls the card connected.
  //
  // Subscription only, by design. Neither card ever offers an API-key path.
  refreshAgentStatus() {
    this.setState(s => ({ agentProv: { ...(s.agentProv || {}), busy: true } }));
    return api.agentProviders()
      .then(r => {
        this.setState({ agentProv: { ...r, busy: false } });
        // Anything the probe calls signed-in gets confirmed with one real round trip, once per
        // app session, so an expired token can't masquerade as a connected card.
        (r.providers || []).forEach(p => { if (p.signedIn) this.verifyAgent(p.id); });
        return r;
      })
      .catch(() => { this.setState({ agentProv: { providers: [], busy: false, error: true } }); return null; });
  }
  // Idempotent per provider: only the first call actually spends a round trip.
  verifyAgent(id) {
    this._verified = this._verified || {};
    if (this._verified[id]) return;
    this._verified[id] = true;
    this.runAgentTest(id, true);
  }
  // Poll while a sign-in browser tab is open. Stops the moment the provider reports signedIn,
  // and gives up after 5 minutes so an abandoned sign-in can't poll forever.
  startAgentPoll(id) {
    clearInterval(this._agentPoll);
    const until = Date.now() + 300_000;
    this.setState({ agentWaiting: id });
    const stop = () => { clearInterval(this._agentPoll); this._agentPoll = null; this.setState({ agentWaiting: null }); };
    this._agentPoll = setInterval(async () => {
      if (Date.now() > until) return stop();
      const r = await this.refreshAgentStatus();
      const p = r && (r.providers || []).find(x => x.id === id);
      if (p && p.signedIn) {
        stop();
        this._verified = { ...(this._verified || {}), [id]: false }; // a fresh sign-in re-verifies
        this.verifyAgent(id);
        if ((r.active || '') !== id) this.saveSettings({ agentCommand: id });
      } else if (p && p.error) {
        // The CLI couldn't even start the login (e.g. a broken config it parses first). No browser
        // tab is coming — stop pretending to wait and show why.
        stop();
        this.showToast((p.label || id) + ' couldn\'t start sign-in — ' + p.error, 'var(--danger)');
      }
    }, 3000);
  }
  renderAgentWizard() {
    const S = this.state;
    if (S.agentProv === undefined) setTimeout(() => this.refreshAgentStatus(), 0);
    const prov = S.agentProv || { busy: true, providers: [] };
    const list = prov.providers || [];
    const active = prov.active || 'claude';
    const stepDot = (done, active) => (
      <span style={{ ...sx('width:22px;height:22px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex:none'), background: done ? 'var(--ok)' : active ? 'var(--accent-12)' : 'var(--surface-2)', color: done ? 'var(--void)' : active ? 'var(--accent)' : 'var(--fg-faint)', border: done ? 'none' : '1px solid ' + (active ? 'var(--accent-60)' : 'var(--border-2)') }}>
        {done ? '✓' : null}
      </span>
    );
    const row = (n, done, active, title, sub, action) => (
      <div style={{ ...sx('display:flex;align-items:center;gap:13px;padding:13px 16px;border-bottom:1px solid var(--line)'), opacity: done || active ? 1 : .55 }}>
        <span style={sx('position:relative')}>{stepDot(done, active)}{!done && <span style={{ ...sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800'), color: active ? 'var(--accent)' : 'var(--fg-faint)' }}>{n}</span>}</span>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-size:12.5px;font-weight:700')}>{title}</div>
          <div style={sx('font-size:10.5px;color:var(--fg-muted);margin-top:2px;line-height:1.5')}>{sub}</div>
        </div>
        {action}
      </div>
    );
    const btn = (labelText, onClick, primary, busy) => (
      <div onClick={() => !busy && onClick()} className={busy ? '' : (primary ? 'hBtnAccent' : 'hBd')}
        style={{ ...sx('padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;flex:none;white-space:nowrap'), background: primary ? (busy ? 'var(--accent-12)' : 'var(--accent)') : 'transparent', color: primary ? (busy ? 'var(--accent)' : 'var(--on-accent)') : 'var(--fg-soft)', border: primary ? 'none' : '1px solid var(--border-2)', cursor: busy ? 'not-allowed' : 'pointer' }}>
        {busy ? <span style={sx('animation:dl-pulse 1.1s infinite')}>Working…</span> : labelText}
      </div>
    );
    // One provider card. Two steps, and step 2 completes itself: the CLI opens the browser, the
    // card polls the CLI's own auth status and flips to green on its own.
    const card = p => {
      const installed = !!p.installed;
      const t = (S.agentTest && S.agentTest.provider === p.id) ? S.agentTest : null;
      // An expired token still probes as signed-in — the round trip is what decides.
      const stale = !!(t && !t.busy && !t.ok && (t.expired || t.needsLogin));
      const connected = installed && p.signedIn && !stale;
      const waiting = S.agentWaiting === p.id;
      const isActive = active === p.id || active === p.path;
      const busyInstall = S.agentInstallBusy === p.id;
      const test = t;
      return (
        <div key={p.id} style={{ ...sx('border-radius:12px;background:var(--surface);overflow:hidden;flex:1;min-width:320px'), border: connected ? '1px solid rgba(63,207,142,.45)' : '1px solid var(--border)' }}>
          <div style={sx('display:flex;align-items:center;gap:9px;padding:11px 16px;border-bottom:1px solid var(--line)')}>
            <span style={sx('font-size:12px;font-weight:800;letter-spacing:.04em')}>{p.label}</span>
            {connected && <span style={sx('font-size:9px;font-weight:700;color:var(--ok);border:1px solid rgba(63,207,142,.4);border-radius:99px;padding:2px 8px')}>CONNECTED</span>}
            {connected && (isActive
              ? <span style={sx('font-size:9px;font-weight:700;color:var(--accent);border:1px solid var(--accent-35);border-radius:99px;padding:2px 8px')}>IN USE</span>
              : <span onClick={() => { this.saveSettings({ agentCommand: p.id }); this.refreshAgentStatus(); }} className="hFgL" style={sx('font-size:9.5px;color:var(--fg-muted);cursor:pointer;text-decoration:underline')}>use this one</span>)}
          </div>
          {connected ? (
            <div style={sx('display:flex;align-items:center;gap:13px;padding:15px 16px')}>
              <span style={sx('width:30px;height:30px;border-radius:99px;background:var(--ok);display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--void);font-weight:800;flex:none')}>✓</span>
              <div style={sx('flex:1;min-width:0')}>
                <div style={sx('font-size:12.5px;font-weight:800;color:var(--ok)')}>Signed in{p.detail ? ' · ' + p.detail : ''}</div>
                <div style={{ ...sx('font-size:9.5px;color:var(--fg-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO }}>
                  {p.version} · {test && test.busy ? 'verifying…' : test && test.ok ? 'round-trip verified' : 'not verified yet'}
                </div>
              </div>
              {btn(test && test.busy ? 'Testing…' : 'Test', () => this.runAgentTest(p.id), false, test && test.busy)}
            </div>
          ) : (<>
            {row(1, installed, !installed, 'Install ' + p.label,
              installed
                ? <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ok)' }}>{p.version || 'installed'}{p.path ? ' · ' + p.path : ''}</span>
                : prov.busy ? 'checking your computer…' : 'One click — the app installs it for you (needs internet, ~1 minute).',
              installed
                ? <span style={sx('font-size:9.5px;font-weight:700;color:var(--ok);border:1px solid rgba(63,207,142,.4);border-radius:99px;padding:2px 9px;flex:none')}>INSTALLED</span>
                : btn('Install for me', async () => {
                  this.setState({ agentInstallBusy: p.id });
                  try {
                    const r = await api.installAgent(p.id);
                    this.showToast(r.ok ? p.label + ' installed — ' + r.version : r.error, r.ok ? 'var(--ok)' : 'var(--danger)');
                  } catch { this.showToast('Install failed — check your internet and try again', 'var(--danger)'); }
                  this.setState({ agentInstallBusy: null });
                  this.refreshAgentStatus();
                }, true, busyInstall))}
            {row(2, false, installed, stale ? 'Sign in again' : 'Sign in',
              waiting
                ? <span style={sx('color:var(--accent)')}>Waiting for you to approve it in the browser — this card turns green by itself.</span>
                : stale
                  ? <span style={sx('color:var(--danger)')}>{test.error}</span>
                  : p.error
                    ? <span style={sx('color:var(--danger)')}>{p.error}</span>
                    : p.signInHint || 'Opens your account sign-in page in the browser.',
              waiting
                ? btn('Cancel', () => { clearInterval(this._agentPoll); this.setState({ agentWaiting: null }); }, false)
                : btn(stale ? 'Sign in again' : 'Sign in', async () => {
                  try {
                    const r = await api.openLogin(p.id);
                    if (r.ok) { this.startAgentPoll(p.id); this.showToast('Approve the sign-in in your browser — the card updates itself', 'var(--accent)'); }
                    else this.showToast(r.error, 'var(--danger)');
                  } catch { this.showToast('Could not start the sign-in', 'var(--danger)'); }
                }, installed))}
          </>)}
        </div>
      );
    };
    return (
      <div>
        {(() => { const l = t => <div style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:10px')}>{t}</div>; return l('CONNECT AN AGENT — powers re-rolls & skill enhancement · subscription sign-in, 2 clicks'); })()}
        <div style={sx('display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start')}>
          {list.length ? list.map(card) : <div style={sx('font-size:11px;color:var(--fg-faint);padding:14px')}>checking your computer…</div>}
        </div>
        <div style={{ ...sx('border-radius:12px;background:var(--surface);overflow:hidden;margin-top:12px'), border: '1px solid var(--border)' }}>
          {(() => {
            // Model + reasoning effort for the ACTIVE provider. Options come from the provider
            // status payload, so claude and codex each offer only what their own CLI accepts.
            const act = list.find(p => p.id === active || p.path === active) || list[0];
            if (!act || !(act.models || []).length) return null;
            const sel = extra => ({ ...sx('background:var(--surface);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:6px 9px;cursor:pointer'), fontSize: 11, ...extra });
            return (
              <div style={sx('display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line)')}>
                <span style={sx('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);flex:none')}>MODEL</span>
                <select value={S.settings.agentModel || ''} onChange={e => this.saveSettings({ agentModel: e.target.value })} style={sel()}>
                  {act.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <span style={sx('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);flex:none;margin-left:6px')}>EFFORT</span>
                <select value={S.settings.agentEffort || ''} onChange={e => this.saveSettings({ agentEffort: e.target.value })} style={sel()}>
                  {(act.efforts || []).map(x => <option key={x} value={x}>{x}</option>)}
                </select>
                <span style={sx('font-size:9.5px;color:var(--fg-faint);margin-left:auto;text-align:right')}>applies to chat & re-rolls · {act.label}</span>
              </div>
            );
          })()}
          <div style={sx('display:flex;align-items:center;gap:14px;padding:9px 16px;background:var(--ink)')}>
            <div onClick={() => this.saveSettings({ agentSimulateFallback: !S.settings.agentSimulateFallback })} style={sx('display:flex;align-items:center;gap:8px;cursor:pointer')}>
              <div style={{ ...sx('width:30px;height:17px;border-radius:99px;position:relative;transition:background .15s'), background: S.settings.agentSimulateFallback ? 'var(--ok)' : 'var(--border-2)' }}>
                <div style={{ ...sx('position:absolute;top:2px;width:13px;height:13px;border-radius:99px;background:var(--fg);transition:left .15s'), left: S.settings.agentSimulateFallback ? 15 : 2 }} />
              </div>
              <span style={sx('font-size:10.5px;color:var(--fg-muted)')}>Practice mode while not connected <span style={sx('color:var(--fg-faint)')}>(re-rolls are pretend, nothing is charged)</span></span>
            </div>
            <span onClick={() => this.setState(s => ({ agentAdvanced: !s.agentAdvanced }))} className="hFgL" style={sx('margin-left:auto;font-size:10px;color:var(--fg-faint);cursor:pointer')}>advanced {S.agentAdvanced ? '▴' : '▾'}</span>
          </div>
          {S.agentAdvanced && (
            <div style={sx('display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--line);background:var(--ink)')}>
              <span style={sx('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);flex:none')}>COMMAND</span>
              <input value={S.settings.agentCommand || ''} onChange={e => this.saveSettings({ agentCommand: e.target.value.trim() || 'claude' })}
                placeholder="claude" onKeyDown={e => e.stopPropagation()}
                style={{ ...sx('flex:1;background:var(--surface);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:6px 10px'), fontFamily: MONO, fontSize: 10.5 }} />
              <span style={sx('font-size:9.5px;color:var(--fg-faint);flex:none')}><span style={{ fontFamily: MONO, fontSize: 9 }}>claude</span>, <span style={{ fontFamily: MONO, fontSize: 9 }}>codex</span>, or any CLI that accepts <span style={{ fontFamily: MONO, fontSize: 9 }}>-p &lt;prompt&gt;</span></span>
            </div>
          )}
        </div>
      </div>
    );
  }
  // Round-trip check for ONE provider: proves the CLI actually answers, which the auth probe alone
  // cannot (an expired token still probes as signed-in). `quiet` is the automatic verification the
  // cards run for themselves — it updates the card but does not toast, and does not re-enter
  // refreshAgentStatus (which is what schedules it).
  async runAgentTest(provider, quiet) {
    this.setState({ agentTest: { busy: true, provider } });
    try {
      const r = await api.testAgent(provider);
      this.setState({ agentTest: { ...r, provider } });
      if (!quiet) this.showToast(r.ok ? (r.command || 'The agent') + ' answered — you\'re all set' : r.error, r.ok ? 'var(--ok)' : 'var(--danger)');
      else if (!r.ok && (r.expired || r.needsLogin)) this.showToast(r.error, 'var(--danger)');
    } catch { this.setState({ agentTest: { ok: false, provider, error: 'test request failed — is the app server running?' } }); }
    if (!quiet) this.refreshAgentStatus();
  }

  renderSettings() {
    // sectioned settings page — extracted to frontend/Settings.jsx (provider cards + model managers)
    return <SettingsPage app={this} />;
  }

  renderReview() {
    const S = this.state;
    const R = S.review;
    const pdef = this.projDef(S.proj);
    const ids = R.ids;
    const cid = ids[Math.min(R.ix, ids.length - 1)];
    const cit = this.getItem(R.pid, cid);
    if (!cit) return null;
    const decN = Object.keys(R.dec).length;
    let rvKept = 0, rvKilled = 0, rvSpent = 0, rvNotesN = 0;
    Object.entries(R.dec).forEach(([id, e]) => { if (e.kind === 'keep') rvKept++; else rvKilled++; const x = this.getItem(R.pid, id); if (x) rvSpent += x.cost; });
    ids.forEach(id => { const x = this.getItem(R.pid, id); if (x && x.fbState === 'queued') rvNotesN++; });
    const hint = (k, kc, l) => (
      <span style={sx('display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--fg-muted);border:1px solid var(--border);border-radius:99px;padding:4px 12px;background:rgba(13,14,17,.8)')}>
        <span style={{ fontFamily: MONO, fontWeight: 600, color: kc }}>{k}</span> {l}
      </span>
    );
    return (
      <div style={sx('position:fixed;inset:0;z-index:60;background:#050608;display:flex;flex-direction:column;animation:dl-in .24s cubic-bezier(.2,.8,.2,1)')}>
        <div style={sx('height:3px;background:var(--surface-2);flex:none')}><div style={{ ...sx('height:100%;background:var(--accent);transition:width .25s ease'), width: Math.round(decN / ids.length * 100) + '%' }} /></div>
        <div style={sx('display:flex;align-items:baseline;gap:14px;padding:14px 24px 0;flex:none')}>
          <span onClick={() => this.exitReview()} className="hFgL" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>✕ Esc</span>
          <span style={sx('font-size:10.5px;font-weight:700;letter-spacing:.18em;color:var(--fg-faint)')}>{pdef.name.toUpperCase()} · REVIEW</span>
          <span style={{ fontFamily: MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--fg-soft)' }}>{R.done ? ids.length : R.ix + 1}<span style={{ color: 'var(--fg-faint)' }}> / {ids.length}</span></span>
          <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--fg-faint)' }}>this clip <span style={{ color: 'var(--fg-soft)' }}>{this.fmt$(cit.cost)}</span></span>
          <span style={{ fontFamily: MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--fg-faint)' }}>session <span style={{ color: 'var(--sand)' }}>{this.fmt$(rvSpent)}</span></span>
        </div>
        <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding:18px 48px')}>
          <div style={sx('position:relative;aspect-ratio:16/9;width:min(1100px,100%,calc((100vh - 250px)*1.7777))')}>
            <div style={{
              ...sx('position:absolute;inset:0;border-radius:10px;overflow:hidden'), background: cit.grad,
              transform: R.anim === 'keep' ? 'translateX(60px) scale(.97)' : R.anim === 'kill' ? 'translateY(46px) scale(.96) rotate(-0.8deg)' : 'none',
              opacity: R.anim ? 0 : 1,
              transition: R.anim ? 'transform .22s cubic-bezier(.4,0,.8,.4), opacity .22s ease' : 'none'
            }}>
              {this.itemMedia(cit, undefined, true)}
              <span style={sx('position:absolute;top:16px;left:18px;font-size:13px;font-weight:600;letter-spacing:.14em;color:rgba(255,255,255,.9);text-shadow:0 1px 6px rgba(0,0,0,.6)')}>{cit.scene} · {cit.label}</span>
              {R.playing && !R.done && <span style={sx('position:absolute;top:18px;right:18px;width:9px;height:9px;border-radius:99px;background:var(--fg);animation:dl-pulse 1.2s infinite')} />}
              {!R.playing && !R.done && <div style={sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center')}><div style={sx('width:64px;height:64px;border-radius:99px;background:rgba(6,7,10,.55);display:flex;align-items:center;justify-content:center')}><svg width="20" height="22" viewBox="0 0 10 12" fill="none"><path d="M0 0L10 6L0 12V0Z" fill="var(--fg)" /></svg></div></div>}
              {cit.fbState === 'queued' && !R.noteOpen && <span style={sx('position:absolute;bottom:14px;left:18px;display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:600;color:var(--accent);background:rgba(6,7,10,.7);border-radius:99px;padding:3px 10px')}>● note queued for re-roll</span>}
            </div>
            <div style={{ ...sx('position:absolute;inset:0;border-radius:10px;pointer-events:none;transition:opacity .12s ease'), background: R.anim === 'kill' ? 'var(--danger)' : 'var(--ok)', opacity: R.anim ? 0.22 : 0 }} />
          </div>
        </div>
        <div style={sx('flex:none;padding:0 24px 8px;display:flex;align-items:baseline;gap:12px')}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--fg-soft)' }}>{cit.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--fg-faint)' }}>{this.fmtDur(cit.durS)}</span>
          <span style={{ fontSize: 11, color: R.dec[cid] && R.dec[cid].kind === 'keep' ? 'var(--ok)' : 'var(--danger)' }}>{R.dec[cid] ? (R.dec[cid].kind === 'keep' ? '✓ kept' : '✕ killed') : ''}</span>
          <div style={sx('margin-left:auto;display:flex;gap:3px;align-items:center')}>
            {ids.map(id => {
              const e = R.dec[id]; const active = id === cid && !R.done;
              const x = this.getItem(R.pid, id);
              return <div key={id} style={{ ...sx('width:11px;height:11px;border-radius:3px'), background: e ? (e.kind === 'keep' ? 'var(--ok)' : 'var(--danger)') : (x && x.fbState === 'queued') ? 'var(--accent-60)' : active ? 'var(--fg)' : 'var(--raise)', border: '1px solid ' + (active ? 'var(--fg)' : 'var(--border-2)') }} />;
            })}
          </div>
        </div>
        {S.settings.showHints && !R.done && (
          <div style={sx('flex:none;display:flex;justify-content:center;gap:8px;padding-bottom:20px')}>
            {(() => { const K = resolveKeys(S.settings); return <>{hint(keyLabel(K.keep), 'var(--ok)', 'keep')}{hint(keyLabel(K.kill), 'var(--danger)', 'kill')}{hint(keyLabel(K.note), 'var(--accent)', 'note')}{hint('←→', 'var(--fg-soft)', 'skip')}{hint(keyLabel(K.play), 'var(--fg-soft)', 'play')}{hint(keyLabel(K.undo), 'var(--fg-soft)', 'undo')}</>; })()}
          </div>
        )}
        {R.noteOpen && (
          <div style={sx('position:absolute;left:50%;bottom:120px;transform:translateX(-50%);width:560px;padding:14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--accent-60);box-shadow:0 20px 60px rgba(0,0,0,.7);z-index:5')}>
            <div style={sx('font-size:10.5px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-bottom:8px')}>NOTE → RE-ROLL <span style={sx('font-weight:400;color:var(--fg-faint);letter-spacing:0;margin-left:6px')}>the AI reads this verbatim</span></div>
            <SnippetText value={R.noteText} autoFocus snippets={S.snippets}
              onChange={e => this.rvPatch({ noteText: e.target.value })}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = this.state.review.noteText; this.rvPatch({ noteOpen: false, noteText: '' }); this.queueNoteFor(R.pid, cid, t); }
                else if (e.key === 'Escape') this.rvPatch({ noteOpen: false });
              }}
              placeholder="What should change? e.g. camera drifts left — lock it off · / for snippets"
              style={sx('width:100%;box-sizing:border-box;height:64px;resize:none;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:13px;padding:10px 12px')} />
            <div style={sx('display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;color:var(--fg-faint)')}><span>Enter to queue · Esc to cancel · / inserts a snippet</span><span style={{ fontFamily: MONO }}>re-roll ≈ {this.fmt$(cit.cost)}</span></div>
          </div>
        )}
        {R.done && (
          <div style={sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,6,8,.9);backdrop-filter:blur(6px);z-index:6;animation:dl-in .3s ease-out')}>
            <div style={sx('width:520px;text-align:center')}>
              <div style={sx('font-size:34px;font-weight:800;letter-spacing:-.01em')}>Queue cleared.</div>
              <div style={sx('font-size:13px;color:var(--fg-muted);margin-top:6px')}>{pdef.name.toUpperCase()} · REVIEW — reviewed in one sitting</div>
              <div style={sx('display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:26px 0 22px')}>
                {[[rvKept, 'kept', 'var(--ok)'], [rvKilled, 'killed', 'var(--danger)'], [rvNotesN, 're-rolls queued', 'var(--accent)'], [this.fmt$(rvSpent), 'reviewed spend', 'var(--sand)']].map(([n, l, c], i) => (
                  <div key={i} style={sx('padding:14px 8px;border:1px solid var(--border);border-radius:10px')}>
                    <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: c }}>{n}</div>
                    <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:3px')}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={sx('font-size:12px;color:var(--fg-muted)')}>Killed clips staged in Trash · <span style={{ color: 'var(--ok)', fontFamily: MONO, fontSize: '11.5px' }}>{(rvKilled * 0.19).toFixed(1)} GB</span> reclaimable</div>
              <div style={sx('display:flex;gap:10px;justify-content:center;margin-top:22px')}>
                <Btn variant="primary" size="lg" onClick={() => this.exitReview()} style={{ padding: '9px 18px' }}>Back to project (Esc)</Btn>
                <Btn size="lg" onClick={() => this.rvUndo()} style={{ padding: '9px 18px' }}>Undo last (U)</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  renderAgentDock() {
    const S = this.state;
    // QUEUE dock — agent jobs + FAL generations share one surface
    const gens = S.projects.flatMap(p => (p.gens || []).map(g => ({
      id: g.id, kind: 'gen', label: (g.shot || g.id), note: (g.model || '').split('/').pop() + ' · ' + (g.prompt || '').slice(0, 60),
      status: g.status === 'done' ? 'done' : g.status, endedAt: g.ended, pid: p.id, shot: g.shot
    })));
    const all = [...S.jobs, ...gens];
    const active = all.filter(j => j.status === 'queued' || j.status === 'running');
    const recent = all.filter(j => j.status !== 'queued' && j.status !== 'running' && j.endedAt && Date.now() - j.endedAt < 60_000);
    if (!active.length && !recent.length) return null;
    const stC = { queued: 'var(--fg-faint)', running: 'var(--accent)', done: 'var(--ok)', failed: 'var(--danger)' };
    const openRow = j => {
      if (j.kind === 'skill') this.go('skills');
      else if (j.kind === 'gen') this.openGenerate(j.shot ? { id: j.shot, proj: j.pid } : null);
      else if (this.getItem(j.proj, j.itemId)) this.openItem(j.proj, j.itemId);
    };
    // Sits ABOVE the feedback FAB when that is on — the two share this corner, and the FAB is the
    // one that must never move, because a report button that wanders is one nobody finds twice.
    return (
      <div style={{ ...sx('position:fixed;right:18px;z-index:70;display:flex;flex-direction:column;align-items:flex-end;gap:8px'),
        bottom: isEnabled(S.settings, 'feedback') ? 74 : 18 }}>
        {S.agentOpen && (
          <div style={sx('width:340px;border:1px solid var(--border-3);border-radius:12px;background:var(--surface-2);box-shadow:0 16px 48px rgba(0,0,0,.7);overflow:hidden;animation:dl-in .15s ease-out')}>
            <div style={sx('display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border)')}>
              <span style={sx('font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted)')}>QUEUE</span>
              <span style={sx('font-size:10px;color:var(--fg-faint)')}>generations · re-rolls · skill jobs</span>
              <span onClick={() => this.setState({ agentOpen: false })} className="hFgL" style={sx('margin-left:auto;font-size:11px;color:var(--fg-faint);cursor:pointer')}>✕</span>
            </div>
            {[...active, ...recent].slice(0, 6).map(j => (
              <div key={j.id} onClick={() => openRow(j)} className="hRow" style={sx('display:flex;gap:10px;padding:9px 14px;border-bottom:1px solid var(--line);cursor:pointer;align-items:flex-start')}>
                <span style={{ ...sx('width:8px;height:8px;border-radius:99px;margin-top:4px;flex:none'), background: stC[j.status] || 'var(--fg-faint)', animation: j.status === 'running' || j.status === 'queued' ? 'dl-pulse 1.2s infinite' : 'none' }} />
                <div style={sx('flex:1;min-width:0')}>
                  <div style={sx('display:flex;align-items:center;gap:6px')}>
                    <span style={sx('font-size:8.5px;font-weight:700;letter-spacing:.08em;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:4px;padding:0px 4px;flex:none')}>{j.kind === 'skill' ? 'SKILL' : j.kind === 'gen' ? 'GEN' : 'RE-ROLL'}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--fg-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.label || j.itemId}</span>
                  </div>
                  <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{j.kind === 'gen' ? j.note : '“' + j.note + '”'}</div>
                </div>
                <span style={{ ...sx('flex:none;font-size:9.5px;font-weight:700;letter-spacing:.06em;margin-top:2px'), color: stC[j.status] || 'var(--fg-faint)' }}>{j.status.toUpperCase()}{j.mode === 'simulated' ? ' · SIM' : ''}</span>
              </div>
            ))}
            <div style={sx('padding:8px 14px;font-size:10px;color:var(--fg-faint)')}>Generations poll FAL every 1.5s · files land in renders/ · every charge hits costs.md</div>
          </div>
        )}
        <div onClick={() => this.setState(s => ({ agentOpen: !s.agentOpen }))}
          style={sx('display:flex;align-items:center;gap:9px;padding:8px 16px;border-radius:999px;background:var(--raise);border:1px solid var(--border-3);box-shadow:0 12px 32px rgba(0,0,0,.6);cursor:pointer;font-size:11.5px')}>
          <span style={{ ...sx('width:8px;height:8px;border-radius:99px'), background: active.length ? 'var(--accent)' : 'var(--ok)', animation: active.length ? 'dl-pulse 1.2s infinite' : 'none' }} />
          <span style={sx('font-weight:700;letter-spacing:.08em;color:var(--fg-soft)')}>QUEUE</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: 'var(--fg-faint)' }}>
            {active.filter(j => j.status === 'running').length} running · {active.filter(j => j.status === 'queued').length} queued
          </span>
        </div>
      </div>
    );
  }

  renderToast() {
    return (
      <div style={sx('position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:80')}>
        {this.state.toasts.map(t => (
          <div key={t.id} style={sx('display:flex;align-items:center;gap:12px;padding:9px 10px 9px 16px;border-radius:10px;background:var(--raise);border:1px solid var(--border-3);box-shadow:0 12px 32px rgba(0,0,0,.6);animation:dl-in .16s ease-out')}>
            <span style={{ ...sx('width:8px;height:8px;border-radius:99px;flex:none'), background: t.dot }} />
            <span style={sx('font-size:12px;color:var(--fg-soft)')}>{t.text}</span>
            {t.canUndo && <span onClick={() => this.doUndo(t.id)} className="hBgAccent" style={sx('font-size:11.5px;font-weight:700;color:var(--accent);padding:4px 10px;border-radius:6px;cursor:pointer')}>Undo (U)</span>}
          </div>
        ))}
      </div>
    );
  }

  renderConfirmEmpty() {
    const trashItems = this.state.items.filter(x => x.trashed || (x.st === 'killed' && !x.trashed));
    const gb = trashItems.reduce((a, x) => a + this.gb(x), 0).toFixed(1) + ' GB';
    return (
      <div style={sx('position:fixed;inset:0;z-index:90;background:rgba(5,6,8,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center')}>
        <div style={sx('width:400px;padding:22px 24px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
          <div style={sx('font-weight:700;font-size:15px')}>Empty trash?</div>
          <div style={sx('font-size:12.5px;color:var(--fg-muted);line-height:1.6;margin-top:8px')}>{trashItems.length} items · {gb} will be permanently deleted from disk. This frees <span style={{ color: 'var(--ok)', fontFamily: MONO, fontSize: 12 }}>{gb}</span>. This can't be undone.</div>
          <div style={sx('display:flex;gap:10px;justify-content:flex-end;margin-top:20px')}>
            <Btn onClick={() => this.setState({ confirmEmpty: false })}>Cancel</Btn>
            <Btn variant="danger" onClick={() => this.emptyTrash()}>Delete · free {gb}</Btn>
          </div>
        </div>
      </div>
    );
  }

  renderConfirmDelFolder() {
    const S = this.state;
    const ctx = (this.projDef(S.proj).context || { items: [] });
    const n = (ctx.items || []).filter(i => (i.folder || '') === S.ctxDelFolder).length;
    return (
      <div style={sx('position:fixed;inset:0;z-index:90;background:rgba(5,6,8,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center')}>
        <div style={sx('width:400px;padding:22px 24px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
          <div style={sx('font-weight:700;font-size:15px')}>Delete board “{S.ctxDelFolder}”?</div>
          <div style={sx('font-size:12.5px;color:var(--fg-muted);line-height:1.6;margin-top:8px')}>The folder and its {n} asset{n === 1 ? '' : 's'} will be deleted from disk. This can't be undone.</div>
          <div style={sx('display:flex;gap:10px;justify-content:flex-end;margin-top:20px')}>
            <Btn onClick={() => this.setState({ ctxDelFolder: null })}>Cancel</Btn>
            <Btn variant="danger" onClick={async () => {
              await api.deleteFolder(S.proj, S.ctxDelFolder).catch(() => { });
              this.setState({ ctxDelFolder: null }); this.sync();
              this.showToast('Board deleted', 'var(--danger)');
            }}>Delete board</Btn>
          </div>
        </div>
      </div>
    );
  }

  renderBrowser() {
    const B = this.state.browser;
    const nav = async p => { const b = await api.browse(p); this.setState({ browser: b }); };
    return (
      <div style={sx('position:fixed;inset:0;z-index:90;background:rgba(5,6,8,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center')}>
        <div style={sx('width:520px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8);overflow:hidden')}>
          <div style={sx('padding:16px 20px 10px')}>
            <div style={sx('font-weight:700;font-size:15px')}>Choose storage root</div>
            <div style={sx('font-size:11.5px;color:var(--fg-muted);margin-top:4px')}>Local files, renders and all .md metadata will be saved here.</div>
            <div style={{ ...sx('margin-top:10px;padding:8px 12px;border:1px solid var(--border-2);border-radius:8px;background:var(--surface);color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 11 }}>{B.path}</div>
          </div>
          <div style={sx('max-height:260px;overflow-y:auto;border-top:1px solid var(--border);border-bottom:1px solid var(--border)')}>
            <div onClick={() => nav(B.parent)} className="hRow" style={{ ...sx('padding:8px 20px;font-size:12px;color:var(--fg-muted);cursor:pointer;border-bottom:1px solid var(--line)'), fontFamily: MONO }}>← ..</div>
            {B.dirs.map(d => (
              <div key={d} onClick={() => nav(B.path + '/' + d)} className="hRow" style={{ ...sx('padding:8px 20px;font-size:12px;color:var(--fg-soft);cursor:pointer;border-bottom:1px solid var(--line)'), fontFamily: MONO }}>{d}/</div>
            ))}
            {!B.dirs.length && <div style={{ ...sx('padding:16px 20px;font-size:10.5px;letter-spacing:.08em;color:var(--fg-faint)'), fontFamily: MONO }}>NO SUB-FOLDERS HERE</div>}
          </div>
          <div style={sx('display:flex;gap:10px;justify-content:flex-end;padding:14px 20px')}>
            <Btn onClick={() => this.setState({ browser: null })}>Cancel</Btn>
            <Btn variant="primary" onClick={async () => {
              // `.catch(() => {})` then an unconditional success toast meant a refused move — a
              // path that does not exist, no permission, a disk that is full — was reported as
              // "Storage root moved". The user then believed their whole database had moved and
              // went looking for it somewhere it had never been written.
              let res;
              try {
                res = await api.setStorageRoot(B.path);
              } catch (e) {
                this.showToast('Could not move the storage root — ' + (e?.message || 'the server refused it'), 'var(--danger)');
                return;                                   // leave the browser open on the failure
              }
              this.setState({ browser: null });
              await this.load();
              // Report the path the SERVER settled on, not the one we asked for.
              this.showToast('Storage root moved — .md database now lives in ' + (res?.storageRoot || B.path), 'var(--ok)');
            }}>Use this folder</Btn>
          </div>
        </div>
      </div>
    );
  }
}
