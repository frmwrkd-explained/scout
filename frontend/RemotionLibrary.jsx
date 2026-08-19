// Remotion Library — a component library + re-render console. Browse the compositions in the user's
// external Remotion project (real defaultProps read via the project's own bundler), open one, tweak
// props with a generated form ⇄ JSON editor, save prop sets as presets, and re-render (still or
// video) into a project's review flow — all without opening the Remotion repo in an editor.
//
// Playback: FrameForge can't embed a live player for an EXTERNAL project — Remotion does not support
// iframing the Studio, and @remotion/player needs the composition compiled into our own bundle, which
// is the exact coupling this feature avoids. So "playing" here means a cached half-scale MP4 loop
// rendered on open (backend `preview` lane), with the project's real Studio one click away.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';


const safeComp = c => String(c).replace(/[^\w.\-]+/g, '_');
const isColor = v => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
const isFormKey = v => v === null || ['string', 'number', 'boolean'].includes(typeof v);

// Mirrors backend/remotion.mjs stableJson — used only to tell whether the props on screen have
// drifted from the ones the current preview was rendered at.
function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

const secs = (frames, fps) => (frames && fps ? (frames / fps).toFixed(1) + 's' : '');

// Section header with a rule — gives the inspector real structure instead of a flat stack of rows.
function head(title, right) {
  return (
    <div style={sx('display:flex;align-items:center;gap:10px;margin:0 0 11px')}>
      <div style={{ ...sx('color:var(--fg-muted);font-weight:700;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5, letterSpacing: '.16em' }}>{title}</div>
      <div style={sx('flex:1;height:1px;background:var(--raise)')} />
      {right || null}
    </div>
  );
}

export default class RemotionLibrary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true, error: null, code: null, data: null,   // compositions payload
      sel: 0, open: null,                                    // detail = the open composition object
      busyScan: false, busyThumbs: false,
      presets: [], presetName: '',
      propsObj: {}, propsText: '{}', propsError: null,
      targetPid: '', rendering: false,
      jobs: [], allPresets: [],
      preview: null,                                         // { url, ready, jobId, key, error, v }
      showJson: false,
      studio: { running: false }, studioBusy: false
    };
  }

  componentDidMount() {
    this.load();
    this.loadAllPresets();
    this.loadStudio();
    this._key = e => this.onKey(e);
    window.addEventListener('keydown', this._key, true);
    this._poll = setInterval(() => this.pollJobs(), 2000);
    this.pollJobs();
  }
  async loadAllPresets() { try { this.setState({ allPresets: await api.remotionPresets('') }); } catch { /* none */ } }
  async loadStudio() { try { this.setState({ studio: await api.remotionStudio() }); } catch { /* offline */ } }
  componentWillUnmount() {
    window.removeEventListener('keydown', this._key, true);
    clearInterval(this._poll);
  }

  comps() { return (this.state.data && this.state.data.compositions) || []; }

  async load(refresh) {
    this.setState({ loading: !this.state.data, busyScan: !!refresh, error: null });
    try {
      const data = await api.remotionCompositions(refresh);
      this.setState({ data, loading: false, busyScan: false, code: null, sel: Math.min(this.state.sel, Math.max(0, data.compositions.length - 1)) });
    } catch (e) {
      this.setState({ error: e.message || 'Could not load compositions', code: e.code || null, loading: false, busyScan: false, data: null });
    }
  }
  async pollJobs() {
    try {
      const jobs = await api.remotionJobs();
      this.setState({ jobs }, () => this.syncPreview(jobs));
    } catch { /* transient */ }
  }
  // Promote the preview to playable the moment its render lands.
  syncPreview(jobs) {
    const P = this.state.preview;
    if (!P || P.ready || !P.jobId) return;
    const job = jobs.find(x => x.id === P.jobId);
    if (!job) return;
    if (job.status === 'done') this.setState({ preview: { ...P, ready: true, v: Date.now() } });
    else if (job.status === 'failed') this.setState({ preview: { ...P, error: job.error || 'preview render failed' } });
  }

  async thumbs() {
    const { app } = this.props;
    this.setState({ busyThumbs: true });
    try { const r = await api.remotionThumbs(); app.showToast('Queued ' + r.queued + ' thumbnail render' + (r.queued === 1 ? '' : 's') + ' — they drain after any user renders', 'var(--accent)'); }
    catch (e) { app.showToast('Thumbnails failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ busyThumbs: false });
  }

  // ── Studio — the OG interactive player, spawned against the user's own project ─────────
  async openStudio() {
    const { app } = this.props;
    const S = this.state;
    if (S.studio && S.studio.running) { window.open(S.studio.url, '_blank', 'noopener'); return; }
    this.setState({ studioBusy: true });
    try {
      const r = await api.remotionStudioStart();
      if (r.error) throw new Error(r.error);
      this.setState({ studio: r });
      app.showToast('Remotion Studio starting on ' + r.url + ' — first bundle takes a few seconds', 'var(--accent)');
      setTimeout(() => window.open(r.url, '_blank', 'noopener'), 2500);
    } catch (e) { app.showToast('Could not start Studio — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ studioBusy: false });
  }
  async killStudio() {
    try { this.setState({ studio: await api.remotionStudioStop() }); this.props.app.showToast('Remotion Studio stopped', 'var(--fg-muted)'); }
    catch (e) { this.props.app.showToast('Could not stop Studio — ' + (e.message || ''), 'var(--danger)'); }
  }

  // ── detail ────────────────────────────────────────────────────────────
  async openDetail(comp) {
    if (!comp) return;
    const obj = comp.defaultProps && typeof comp.defaultProps === 'object' ? comp.defaultProps : {};
    this.setState({
      open: comp, propsObj: obj, propsText: JSON.stringify(obj, null, 2), propsError: null,
      presets: [], presetName: '', preview: null, showJson: false,
      targetPid: this.props.app.state.proj || ''
    });
    this.requestPreview(comp, obj);
    try { this.setState({ presets: await api.remotionPresets(comp.id) }); } catch { /* none */ }
  }
  back() { this.setState({ open: null, preview: null }); }

  async requestPreview(comp, props) {
    const key = stableJson(props || {});
    const mine = () => this.state.open && this.state.open.id === comp.id;
    this.setState({ preview: { url: null, ready: false, jobId: null, key, error: null, pending: true } });
    try {
      const r = await api.remotionPreview(comp.id, props || {});
      if (!mine()) return;                       // user moved on mid-flight
      if (r.error) throw new Error(r.error);
      this.setState({ preview: { url: r.url, ready: !!r.ready, jobId: r.jobId || null, key, error: null, truncated: !!r.truncated, v: Date.now(), pending: false } });
    } catch (e) {
      if (!mine()) return;
      this.setState({ preview: { url: null, ready: false, jobId: null, key, error: e.message || 'preview failed', pending: false } });
    }
  }
  // Props edits do NOT auto-render — a keystroke per render would queue a job a second. The
  // refresh control lights up instead.
  previewStale() {
    const P = this.state.preview;
    return !!(P && !P.pending && P.key !== stableJson(this.state.propsObj));
  }

  setProp(key, val) {
    const obj = { ...this.state.propsObj, [key]: val };
    this.setState({ propsObj: obj, propsText: JSON.stringify(obj, null, 2), propsError: null });
  }
  onText(text) {
    let obj = null, err = null;
    try { obj = JSON.parse(text); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { err = 'props must be a JSON object'; obj = null; } }
    catch (e) { err = e.message; }
    this.setState(obj ? { propsText: text, propsObj: obj, propsError: null } : { propsText: text, propsError: err });
  }
  applyPreset(file) {
    const p = this.state.presets.find(x => x.file === file);
    if (!p) return;
    const obj = p.props || {};
    this.setState({ propsObj: obj, propsText: JSON.stringify(obj, null, 2), propsError: null });
    if (this.state.open) this.requestPreview(this.state.open, obj);
  }
  async savePreset() {
    const { app } = this.props;
    const name = (this.state.presetName || '').trim();
    if (!name) { app.showToast('Name the preset first', 'var(--danger)'); return; }
    if (this.state.propsError) { app.showToast('Fix the props JSON before saving', 'var(--danger)'); return; }
    try {
      await api.remotionSavePreset(this.state.open.id, name, this.state.propsObj);
      this.setState({ presets: await api.remotionPresets(this.state.open.id), presetName: '' });
      this.loadAllPresets();
      app.showToast('Preset "' + name + '" saved', 'var(--ok)');
    } catch (e) { app.showToast('Save failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async delPreset(file) {
    try { await api.remotionDeletePreset(file); this.setState({ presets: await api.remotionPresets(this.state.open.id) }); this.loadAllPresets(); }
    catch (e) { this.props.app.showToast('Delete failed — ' + (e.message || ''), 'var(--danger)'); }
  }

  async startRender(kind) {
    const { app } = this.props;
    const comp = this.state.open;
    if (!comp) return;
    if (this.state.propsError) { app.showToast('Fix the props JSON before rendering', 'var(--danger)'); return; }
    this.setState({ rendering: true });
    try {
      await api.remotionRender({ comp: comp.id, props: this.state.propsObj, kind, pid: this.state.targetPid || undefined });
      app.showToast((kind === 'video' ? 'Video' : 'Still') + ' render queued — ' + comp.id, 'var(--accent)');
      this.pollJobs();
    } catch (e) { app.showToast('Render failed to queue — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ rendering: false });
  }

  onKey(e) {
    if (this.props.app.state.paletteOpen) return;
    if (e.target.isContentEditable) return; // the composer's contenteditable prompt — same bail as INPUT/TEXTAREA
    const tag = (e.target.tagName || '').toUpperCase();
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
    const k = (e.key || '').toLowerCase();
    const S = this.state;
    if (S.open) {
      if ((e.metaKey || e.ctrlKey) && k === 'enter') { e.preventDefault(); e.stopPropagation(); this.startRender('still'); return; }
      if (typing) return;
      if (k === 'escape') { e.preventDefault(); e.stopPropagation(); this.back(); }
      if (k === 'r') { e.preventDefault(); e.stopPropagation(); this.requestPreview(S.open, S.propsObj); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const list = this.comps();
    if (!list.length) return;
    if (k === 'arrowright' || k === 'arrowdown' || k === 'j') { e.preventDefault(); e.stopPropagation(); this.setState({ sel: Math.min(list.length - 1, S.sel + 1) }); }
    else if (k === 'arrowleft' || k === 'arrowup' || k === 'k') { e.preventDefault(); e.stopPropagation(); this.setState({ sel: Math.max(0, S.sel - 1) }); }
    else if (k === 'enter') { e.preventDefault(); e.stopPropagation(); this.openDetail(list[Math.min(S.sel, list.length - 1)]); }
  }

  // latest finished user render for a comp (thumbs/previews are other lanes and excluded)
  latestRender(compId) {
    return this.state.jobs.filter(j => j.comp === compId && j.lane === 'user' && j.status === 'done' && j.outUrl)
      .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0] || null;
  }
  thumbTs(compId) {
    const t = this.state.jobs.filter(j => j.comp === compId && j.lane === 'thumb' && j.status === 'done').sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
    return t ? t.endedAt : 0;
  }
  presetCount(compId) { return this.state.allPresets.filter(p => p.comp === compId).length; }

  studioBtn(compact) {
    const S = this.state;
    const on = S.studio && S.studio.running;
    return (
      <div style={sx('display:flex;align-items:center;gap:6px')}>
        <div onClick={() => !S.studioBusy && this.openStudio()} className={on ? 'hBd' : 'hBd'}
          title={on ? 'Studio running on ' + S.studio.url : "Launch your project's own Remotion Studio — full playback and scrubbing"}
          style={{ ...sx('display:flex;align-items:center;gap:7px;padding:5px 13px;border:1px solid ' + (on ? 'var(--ok)' : 'var(--border-2)') + ';border-radius:7px;color:' + (on ? 'var(--ok)' : 'var(--fg-soft)') + ';cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap'), opacity: S.studioBusy ? 0.6 : 1 }}>
          {on ? <span style={sx('width:6px;height:6px;border-radius:50%;background:var(--ok);flex:none')} /> : null}
          {S.studioBusy ? 'starting…' : on ? 'Studio ↗' : (compact ? 'Studio ↗' : 'Open Remotion Studio ↗')}
        </div>
        {on ? <div onClick={() => this.killStudio()} className="hDanger" title="Stop the Studio process"
          style={{ ...sx('padding:5px 8px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-faint);cursor:pointer'), fontSize: 11, lineHeight: 1 }}>■</div> : null}
      </div>
    );
  }

  render() {
    const S = this.state;
    if (S.open) return this.renderDetail();
    return (
      <div style={sx('padding:22px 28px 80px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px;flex-wrap:wrap')}>
          <div style={sx('font-weight:700;font-size:16px')}>Remotion Library</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>code-driven components from your own Remotion project — open one, tweak props, re-render</span>
          <div style={sx('margin-left:auto;display:flex;gap:8px;align-items:center')}>
            {this.studioBtn(false)}
            <div onClick={() => !S.busyScan && this.load(true)} className="hBd" style={{ ...sx('padding:5px 13px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer;font-size:11px;font-weight:600'), opacity: S.busyScan ? 0.6 : 1 }}>{S.busyScan ? '↻ scanning…' : '↻ scan'}</div>
            {this.comps().length ? <div onClick={() => !S.busyThumbs && this.thumbs()} className="hBd" style={{ ...sx('padding:5px 13px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer;font-size:11px;font-weight:600'), opacity: S.busyThumbs ? 0.6 : 1 }}>🖼 thumbs</div> : null}
          </div>
        </div>
        {S.data && <div style={{ ...sx('color:var(--fg-faint);margin:6px 0 4px'), fontFamily: MONO, fontSize: 10.5 }}>{S.data.project}{S.data.entry ? ' · ' + S.data.entry : ''}{S.data.scannedAt ? ' · scanned ' + S.data.scannedAt : ''}</div>}
        {S.data && S.data.scanMode === 'cli' && (
          <div style={{ ...sx('display:inline-block;margin:4px 0 2px;padding:4px 10px;border:1px solid var(--border-3);border-radius:6px;color:var(--accent);background:var(--raise)'), fontFamily: MONO, fontSize: 10 }}>
            cli scan (ids only) — defaultProps unavailable{S.data.warning ? ' · ' + S.data.warning : ''}
          </div>
        )}
        {this.renderJobStrip(null)}

        {S.loading && <div style={sx('padding:40px 0;text-align:center;color:var(--fg-faint);font-size:12.5px')}>Scanning compositions… (first bundler scan can take a minute)</div>}

        {!S.loading && S.error && this.renderEmpty()}

        {!S.loading && !S.error && (
          this.comps().length ? (
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-top:16px')}>
              {this.comps().map((c, i) => this.renderCard(c, i))}
            </div>
          ) : (
            <div style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:44px 22px;text-align:center;margin-top:16px')}>
              <div style={{ ...sx('font-weight:700;color:var(--fg-muted);letter-spacing:.1em'), fontFamily: MONO, fontSize: 11 }}>PROJECT CONNECTED — NO COMPOSITIONS FOUND</div>
              <div style={sx('font-size:12px;color:var(--fg-faint);margin-top:6px')}>Declare a &lt;Composition&gt; in the project's Root, then ↻ scan.</div>
            </div>
          )
        )}
      </div>
    );
  }

  // Three genuinely different failures used to share one headline ("No Remotion project connected"),
  // which was actively wrong for two of them — in `no-entry` and a failed scan the project IS
  // connected. Branch on the server's discriminator so the CTA matches the actual problem.
  renderEmpty() {
    const { app } = this.props;
    const S = this.state;
    const code = S.code || 'error';
    const openSettings = <div onClick={() => app.go('settings')} className="hBtnAccent" style={sx('padding:8px 16px;border-radius:8px;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:12px;cursor:pointer')}>Open Settings</div>;
    const rescan = <div onClick={() => this.load(true)} className="hBd" style={sx('padding:8px 16px;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);font-weight:600;font-size:12px;cursor:pointer')}>↻ Scan again</div>;
    const starter = <div onClick={() => this.writeStarter()} className="hBd" style={sx('padding:8px 16px;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);font-weight:600;font-size:12px;cursor:pointer')}>Write starter comp</div>;

    let title, body, actions;
    if (code === 'not-configured') {
      title = 'No Remotion project connected';
      body = <>FrameForge renders through your own Remotion project — it never bundles one.<br />Pick a project folder in <span onClick={() => app.go('settings')} className="hAccent" style={sx('color:var(--accent);cursor:pointer')}>Settings → Integrations</span>, then scan.</>;
      actions = <>{openSettings}</>;
    } else if (code === 'no-entry') {
      title = 'Project connected — no entry point found';
      body = <>{S.error}<br />The entry is the file that calls <span style={{ fontFamily: MONO }}>registerRoot()</span> — commonly <span style={{ fontFamily: MONO }}>src/index.ts</span> or <span style={{ fontFamily: MONO }}>src/remotion/index.ts</span>. Set one explicitly in Settings if yours lives elsewhere.</>;
      actions = <>{openSettings}{starter}{rescan}</>;
    } else {
      title = 'Composition scan failed';
      body = <>{S.error}<br />The project is connected but its compositions could not be read. Most often the project's own dependencies aren't installed — run <span style={{ fontFamily: MONO }}>npm install</span> inside it.</>;
      actions = <>{rescan}{openSettings}</>;
    }
    return (
      <div style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:44px 22px;text-align:center;margin-top:16px')}>
        <div style={{ ...sx('font-weight:700;color:var(--fg-muted);letter-spacing:.1em;text-transform:uppercase'), fontFamily: MONO, fontSize: 11 }}>{title}</div>
        <div style={sx('font-size:12px;color:var(--fg-faint);margin-top:6px;line-height:1.6')}>{body}</div>
        <div style={sx('margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap')}>{actions}</div>
      </div>
    );
  }
  async writeStarter() {
    const { app } = this.props;
    try {
      const r = await api.remotionTemplate(false);
      app.showToast(r.error ? r.error : 'Starter comp written — FrameForgeShots.tsx', r.error ? 'var(--danger)' : 'var(--ok)');
      if (!r.error) this.load(true);
    } catch (e) { app.showToast('Could not write starter — ' + (e.message || ''), 'var(--danger)'); }
  }

  renderCard(c, i) {
    const S = this.state;
    const selected = i === S.sel;
    const ts = this.thumbTs(c.id);
    const thumb = '/api/remotion/file?name=' + encodeURIComponent('thumbs/' + safeComp(c.id) + '.png') + (ts ? '&v=' + ts : '');
    const active = S.jobs.some(j => j.comp === c.id && (j.status === 'running' || j.status === 'queued'));
    const n = this.presetCount(c.id);
    return (
      <div key={c.id} onClick={() => this.setState({ sel: i }, () => this.openDetail(c))} className="hCard"
        style={sx('border:1px solid ' + (selected ? 'var(--border-3)' : 'var(--border)') + ';border-radius:12px;background:var(--surface);cursor:pointer;overflow:hidden')}>
        <div style={sx('position:relative;aspect-ratio:16/9;background:var(--ink);display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--raise)')}>
          <img src={thumb} alt="" style={sx('width:100%;height:100%;object-fit:cover')} onError={e => { e.target.style.display = 'none'; }} />
          <div style={{ ...sx('position:absolute;color:var(--border-3);pointer-events:none'), fontFamily: MONO, fontSize: 11 }}>no still yet</div>
          {active && <div style={{ ...sx('position:absolute;top:8px;left:8px;padding:2px 7px;border-radius:5px;background:var(--accent);color:var(--on-accent)'), fontFamily: MONO, fontSize: 9, fontWeight: 700 }}>rendering</div>}
          {n > 0 && <div style={{ ...sx('position:absolute;top:8px;right:8px;padding:2px 7px;border-radius:5px;background:var(--raise);border:1px solid var(--border-2);color:var(--fg-muted)'), fontFamily: MONO, fontSize: 9, fontWeight: 700 }}>{n} preset{n === 1 ? '' : 's'}</div>}
        </div>
        <div style={sx('padding:12px 14px 13px')}>
          <div style={{ ...sx('font-size:12.5px;font-weight:700;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO }}>{c.id}</div>
          <div style={{ ...sx('display:flex;gap:9px;margin-top:8px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
            {c.width && c.height ? <span>{c.width}×{c.height}</span> : <span>dims ?</span>}
            {c.fps ? <span>{c.fps}fps</span> : null}
            {c.durationInFrames ? <span>{secs(c.durationInFrames, c.fps) || c.durationInFrames + 'f'}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  // ── detail view ───────────────────────────────────────────────────────
  renderDetail() {
    const S = this.state;
    const c = S.open;
    const keys = Object.keys(S.propsObj).filter(k => isFormKey(S.propsObj[k]));
    const colorKeys = keys.filter(k => isColor(S.propsObj[k]));
    const dialKeys = keys.filter(k => !isColor(S.propsObj[k]) && (typeof S.propsObj[k] === 'number' || typeof S.propsObj[k] === 'boolean'));
    const textKeys = keys.filter(k => !isColor(S.propsObj[k]) && (typeof S.propsObj[k] === 'string' || S.propsObj[k] === null));

    return (
      <div style={sx('padding:22px 28px 40px')}>
        {/* header */}
        <div style={sx('display:flex;align-items:center;gap:14px;margin-bottom:18px')}>
          <div onClick={() => this.back()} className="hBd" style={sx('padding:5px 12px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap')}>← back</div>
          <div>
            <div style={{ ...sx('font-weight:700;font-size:16px;color:var(--fg);line-height:1.2'), fontFamily: MONO }}>{c.id}</div>
            <div style={{ ...sx('color:var(--fg-faint);margin-top:3px'), fontFamily: MONO, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>
              {[c.width && c.height ? c.width + '×' + c.height : null, c.fps ? c.fps + 'fps' : null,
              c.durationInFrames ? c.durationInFrames + 'f' + (secs(c.durationInFrames, c.fps) ? ' · ' + secs(c.durationInFrames, c.fps) : '') : null]
                .filter(Boolean).join('  ·  ')}
            </div>
          </div>
          <div style={sx('margin-left:auto')}>{this.studioBtn(true)}</div>
        </div>

        <div style={sx('display:grid;grid-template-columns:minmax(0,1.35fr) minmax(340px,.85fr);gap:26px;align-items:start')}>
          <div style={sx('min-width:0')}>{this.renderStage(c)}</div>
          <div style={sx('min-width:0')}>{this.renderInspector(colorKeys, dialKeys, textKeys)}</div>
        </div>
      </div>
    );
  }

  // The stage: a looping preview if we have one, else the last real render, else the still.
  renderStage(c) {
    const S = this.state;
    const P = S.preview;
    const latest = this.latestRender(c.id);
    const ratio = c.width && c.height ? c.width + '/' + c.height : '16/9';
    const job = P && P.jobId ? S.jobs.find(x => x.id === P.jobId) : null;
    const pct = job && job.status === 'running' ? Math.round((job.progress || 0) * 100) : null;
    const stale = this.previewStale();

    let body;
    if (P && P.ready && P.url) {
      body = <video key={P.url + P.v} src={P.url + '&v=' + P.v} autoPlay loop muted playsInline controls
        style={sx('width:100%;height:100%;object-fit:contain;background:var(--ink)')} />;
    } else if (P && P.error) {
      body = (
        <div style={sx('text-align:center;padding:0 24px')}>
          <div style={{ ...sx('color:var(--danger)'), fontFamily: MONO, fontSize: 11.5 }}>preview failed</div>
          <div style={{ ...sx('color:var(--fg-faint);margin-top:6px;max-width:460px;line-height:1.55'), fontFamily: MONO, fontSize: 10 }}>{P.error}</div>
        </div>
      );
    } else if (P) {
      body = (
        <div style={sx('text-align:center')}>
          <div style={{ ...sx('color:var(--accent)'), fontFamily: MONO, fontSize: 11.5 }}>
            {pct !== null ? 'rendering preview · ' + pct + '%' : job && job.status === 'queued' ? 'preview queued…' : 'building preview…'}
          </div>
          <div style={{ ...sx('color:var(--fg-faint);margin-top:7px'), fontFamily: MONO, fontSize: 10 }}>half scale · first 10s · cached after this</div>
        </div>
      );
    } else if (latest) {
      body = latest.kind === 'video'
        ? <video src={latest.outUrl} controls loop style={sx('width:100%;height:100%;object-fit:contain;background:var(--ink)')} />
        : <img src={latest.outUrl} alt="" style={sx('width:100%;height:100%;object-fit:contain')} />;
    } else {
      body = <ThumbOrPlaceholder compId={c.id} ts={this.thumbTs(c.id)} />;
    }

    return (
      <div>
        <div style={{ ...sx('background:var(--void);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center'), aspectRatio: ratio }}>
          {body}
        </div>

        {/* transport / status strip */}
        <div style={sx('display:flex;align-items:center;gap:10px;margin-top:11px;flex-wrap:wrap')}>
          {P && P.ready
            ? <span style={{ ...sx('display:flex;align-items:center;gap:7px;color:var(--ok)'), fontFamily: MONO, fontSize: 10 }}>
              <span style={sx('width:6px;height:6px;border-radius:50%;background:var(--ok)')} />looping preview{P.truncated ? ' · first 10s' : ''}
            </span>
            : <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10 }}>preview</span>}

          <div onClick={() => this.requestPreview(this.state.open, this.state.propsObj)}
            className={stale ? 'hBdAccent' : 'hBd'}
            title="Re-render the looping preview at the current props (R)"
            style={stale
              ? sx('padding:4px 12px;border:1px solid var(--accent-35);border-radius:7px;color:var(--accent);cursor:pointer;font-size:10.5px;font-weight:700')
              : sx('padding:4px 12px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-muted);cursor:pointer;font-size:10.5px;font-weight:600')}>
            {stale ? '↻ props changed — update preview' : '↻ update preview'}
          </div>

          {latest && P && P.ready ? (
            <span style={{ ...sx('color:var(--fg-faint);margin-left:auto'), fontFamily: MONO, fontSize: 10 }}>
              last full render · {latest.file}
              {latest.pid ? <span onClick={() => this.props.app.openProj(latest.pid)} className="hAccent" style={{ ...sx('color:var(--accent);cursor:pointer;margin-left:8px') }}>open in {latest.pid} →</span> : null}
            </span>
          ) : null}
        </div>

        {this.renderJobStrip(c.id)}
      </div>
    );
  }

  renderInspector(colorKeys, dialKeys, textKeys) {
    const S = this.state;
    const projects = this.props.app.state.projects || [];
    const none = !colorKeys.length && !dialKeys.length && !textKeys.length;

    return (
      <div style={sx('border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden')}>
        <div style={sx('padding:16px 16px 4px')}>
          {none ? (
            <div style={sx('color:var(--fg-faint);font-size:11.5px;line-height:1.6;padding-bottom:10px')}>
              No scalar props to edit inline — use the JSON below.{S.data && S.data.scanMode === 'cli' ? ' (cli scan read no defaultProps)' : ''}
            </div>
          ) : null}

          {colorKeys.length ? (
            <div style={sx('margin-bottom:20px')}>
              {head('Colors')}
              <div style={sx('display:flex;flex-wrap:wrap;gap:12px')}>
                {colorKeys.map(k => this.renderSwatch(k, S.propsObj[k]))}
              </div>
            </div>
          ) : null}

          {dialKeys.length ? (
            <div style={sx('margin-bottom:20px')}>
              {head('Values')}
              <div style={sx('display:flex;flex-direction:column;gap:8px')}>
                {dialKeys.map(k => this.renderDial(k, S.propsObj[k]))}
              </div>
            </div>
          ) : null}

          {textKeys.length ? (
            <div style={sx('margin-bottom:20px')}>
              {head('Content')}
              <div style={sx('display:flex;flex-direction:column;gap:11px')}>
                {textKeys.map(k => this.renderText(k, S.propsObj[k]))}
              </div>
            </div>
          ) : null}

          {/* JSON is a disclosure — showing it alongside the form doubled the noise for no gain */}
          <div style={sx('margin-bottom:18px')}>
            {head('Raw props', (
              <div onClick={() => this.setState({ showJson: !S.showJson })} className="hFg"
                style={{ ...sx('color:var(--fg-muted);cursor:pointer;white-space:nowrap'), fontFamily: MONO, fontSize: 10 }}>
                {S.showJson ? '− hide JSON' : '+ edit JSON'}
              </div>
            ))}
            {S.propsError && !S.showJson ? <div style={{ ...sx('color:var(--danger);margin-bottom:8px'), fontFamily: MONO, fontSize: 10 }}>JSON error · {S.propsError}</div> : null}
            {S.showJson ? (
              <>
                {S.propsError ? <div style={{ ...sx('color:var(--danger);margin-bottom:6px'), fontFamily: MONO, fontSize: 10 }}>{S.propsError}</div> : null}
                <textarea value={S.propsText} onChange={e => this.onText(e.target.value)} spellCheck={false}
                  style={{ ...sx('width:100%;min-height:190px;padding:11px;border:1px solid ' + (S.propsError ? 'var(--danger)' : 'var(--border-2)') + ';border-radius:9px;background:var(--void);color:var(--fg);resize:vertical;box-sizing:border-box'), fontFamily: MONO, fontSize: 11, lineHeight: 1.55 }} />
              </>
            ) : null}
          </div>

          {/* presets as chips */}
          <div style={sx('margin-bottom:18px')}>
            {head('Presets')}
            {S.presets.length ? (
              <div style={sx('display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px')}>
                {S.presets.map(p => (
                  <div key={p.file} className="hBd" style={sx('display:flex;align-items:center;gap:7px;padding:5px 9px 5px 11px;border:1px solid var(--border-2);border-radius:20px;background:var(--surface-2)')}>
                    <span onClick={() => this.applyPreset(p.file)} className="hFg" style={{ ...sx('color:var(--fg-soft);cursor:pointer'), fontFamily: MONO, fontSize: 10.5 }}>{p.name}</span>
                    <span onClick={() => this.delPreset(p.file)} className="hDanger" style={sx('color:var(--fg-faint);cursor:pointer;font-size:13px;line-height:1')}>×</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ ...sx('color:var(--fg-faint);margin-bottom:10px;letter-spacing:.06em'), fontFamily: MONO, fontSize: 10 }}>NO PRESETS YET FOR THIS COMPOSITION</div>}
            <div style={sx('display:flex;gap:7px')}>
              <input value={S.presetName} onChange={e => this.setState({ presetName: e.target.value })} placeholder="save current props as…"
                style={{ ...sx('flex:1;min-width:0;padding:7px 11px;border:1px solid var(--border-2);border-radius:8px;background:var(--void);color:var(--fg)'), fontFamily: MONO, fontSize: 11 }} />
              <div onClick={() => this.savePreset()} className="hBd" style={sx('padding:7px 14px;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap')}>save</div>
            </div>
          </div>
        </div>

        {/* render bar — anchored, visually separate from the editing surface above */}
        <div style={sx('padding:15px 16px 16px;border-top:1px solid var(--raise);background:var(--void)')}>
          {head('Render into')}
          <select value={S.targetPid} onChange={e => this.setState({ targetPid: e.target.value })}
            style={{ ...sx('width:100%;padding:8px 11px;border:1px solid var(--border-2);border-radius:8px;background:var(--surface-2);color:var(--fg);margin-bottom:11px;box-sizing:border-box'), fontFamily: MONO, fontSize: 11 }}>
            <option value="">Scratch (remotion/out/)</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name} → its review flow</option>)}
          </select>
          <div style={sx('display:flex;gap:9px')}>
            <div onClick={() => !S.rendering && this.startRender('video')} className={S.rendering ? '' : 'hBtnAccent'} style={{ ...sx('flex:1;text-align:center;padding:10px 16px;border-radius:9px;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:12px;cursor:pointer'), opacity: S.rendering ? 0.6 : 1, cursor: S.rendering ? 'not-allowed' : 'pointer' }}>Render video</div>
            <div onClick={() => !S.rendering && this.startRender('still')} className={S.rendering ? '' : 'hBd'} style={{ ...sx('flex:1;text-align:center;padding:10px 16px;border:1px solid var(--border-2);border-radius:9px;color:var(--fg-soft);font-weight:600;font-size:12px;cursor:pointer'), opacity: S.rendering ? 0.6 : 1, cursor: S.rendering ? 'not-allowed' : 'pointer' }}>Still ⌘↵</div>
          </div>
          <div style={{ ...sx('color:var(--fg-faint);margin-top:9px;text-align:center'), fontFamily: MONO, fontSize: 9.5 }}>full resolution · queued behind one render worker</div>
        </div>
      </div>
    );
  }

  // A colour is a colour — show the swatch, not a hex string in a row of eight identical rows.
  renderSwatch(k, v) {
    return (
      <label key={k} title={k + ' · ' + v} style={sx('display:flex;flex-direction:column;gap:6px;cursor:pointer;width:62px')}>
        <div style={sx('position:relative;width:62px;height:46px;border-radius:9px;border:1px solid var(--border-2);background:' + v + ';overflow:hidden')}>
          <input type="color" value={String(v).slice(0, 7)} onChange={e => this.setProp(k, e.target.value)}
            style={sx('position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0')} />
        </div>
        <div style={{ ...sx('color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5 }}>{k}</div>
        <input value={v} onChange={e => this.setProp(k, e.target.value)} spellCheck={false}
          style={{ ...sx('width:100%;padding:3px 5px;border:1px solid var(--border);border-radius:5px;background:var(--void);color:var(--fg-faint);box-sizing:border-box'), fontFamily: MONO, fontSize: 9 }} />
      </label>
    );
  }

  // numbers + booleans — short, so they read best as label-left rows
  renderDial(k, v) {
    const label = <div style={{ ...sx('flex:1;min-width:0;color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 11 }}>{k}</div>;
    if (typeof v === 'boolean') {
      return (
        <div key={k} style={sx('display:flex;align-items:center;gap:10px')}>
          {label}
          <div onClick={() => this.setProp(k, !v)} style={sx('width:38px;height:20px;border-radius:11px;background:' + (v ? 'var(--accent)' : 'var(--border-2)') + ';position:relative;cursor:pointer;transition:background .15s;flex:none')}>
            <div style={sx('position:absolute;top:2px;left:' + (v ? '20px' : '2px') + ';width:16px;height:16px;border-radius:50%;background:var(--ink);transition:left .15s')} />
          </div>
        </div>
      );
    }
    return (
      <div key={k} style={sx('display:flex;align-items:center;gap:10px')}>
        {label}
        <input type="number" value={v} onChange={e => this.setProp(k, e.target.value === '' ? 0 : Number(e.target.value))}
          style={{ ...sx('width:104px;flex:none;padding:6px 9px;border:1px solid var(--border-2);border-radius:7px;background:var(--void);color:var(--fg);text-align:right'), fontFamily: MONO, fontSize: 11 }} />
      </div>
    );
  }

  // strings are long (titles, comma-separated data) — they need the full width, so label above
  renderText(k, v) {
    return (
      <div key={k}>
        <div style={{ ...sx('color:var(--fg-muted);margin-bottom:5px'), fontFamily: MONO, fontSize: 10 }}>{k}</div>
        <input value={v == null ? '' : v} onChange={e => this.setProp(k, e.target.value)} spellCheck={false}
          style={{ ...sx('width:100%;padding:7px 10px;border:1px solid var(--border-2);border-radius:7px;background:var(--void);color:var(--fg);box-sizing:border-box'), fontFamily: MONO, fontSize: 11 }} />
      </div>
    );
  }

  renderJobStrip(compId) {
    const jobs = this.state.jobs.filter(j => (compId ? j.comp === compId : true) && j.lane === 'user').slice(0, compId ? 4 : 3);
    const active = this.state.jobs.filter(j => j.lane === 'user' && (j.status === 'running' || j.status === 'queued'));
    if (!jobs.length && !active.length) return null;
    return (
      <div style={sx('margin-top:12px;display:flex;flex-direction:column;gap:5px')}>
        {jobs.map(j => {
          const color = j.status === 'done' ? 'var(--ok)' : j.status === 'failed' ? 'var(--danger)' : 'var(--accent)';
          const pct = j.status === 'running' ? ' · ' + Math.round((j.progress || 0) * 100) + '%' : '';
          return (
            <div key={j.id} style={sx('display:flex;align-items:center;gap:9px;padding:6px 11px;border:1px solid var(--raise);border-radius:7px;background:var(--surface)')}>
              <span style={sx('width:7px;height:7px;border-radius:50%;background:' + color + ';flex:none')} />
              <span style={{ ...sx('color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10.5 }}>{j.comp}</span>
              <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10 }}>{j.kind}{j.pid ? ' → ' + j.pid : ''}</span>
              <span style={{ ...sx('margin-left:auto;color:' + color), fontFamily: MONO, fontSize: 10 }}>{j.status}{pct}</span>
              {j.status === 'failed' && j.error ? <span title={j.error} style={{ ...sx('color:var(--fg-faint);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5 }}>{j.error}</span> : null}
            </div>
          );
        })}
      </div>
    );
  }
}

// Preview fallback when nothing has been rendered yet — the thumb still (if any) or a placeholder.
class ThumbOrPlaceholder extends React.Component {
  constructor(p) { super(p); this.state = { err: false }; }
  render() {
    const { compId, ts } = this.props;
    if (this.state.err) return <div style={{ ...sx('color:var(--border-3)'), fontFamily: MONO, fontSize: 12 }}>no preview yet</div>;
    const src = '/api/remotion/file?name=' + encodeURIComponent('thumbs/' + safeComp(compId) + '.png') + (ts ? '&v=' + ts : '');
    return <img src={src} alt="" style={sx('width:100%;height:100%;object-fit:contain')} onError={() => this.setState({ err: true })} />;
  }
}
