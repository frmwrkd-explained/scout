// Video → reference frames importer. Paste a YouTube/Vimeo link (downloaded locally with
// yt-dlp) or pick a video file from disk; ffmpeg splits it at shot cuts and this modal shows
// one frame per shot to keep or drop. Kept frames land in the target board like any upload,
// where vision analysis tags them automatically. Everything runs on this machine.
//
// Opening a scene reveals the two things a bare frame grid cannot do:
//   · TRIM — the detector cuts on a luma delta, so it lands early on a whip pan and late
//     through a dissolve. The in/out handles nudge by a real frame (off the probed fps) and
//     snap to neighbouring detected cuts; the poster re-cuts as you go.
//   · CONTACT SHEET — one JPEG of the whole scene, panels numbered and time-stamped in
//     reading order. A single still cannot show a move and loose stills cannot be ordered;
//     the sheet is what makes a start→end motion prompt writable from a reference.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';
import { Btn, Chip } from './ui';

const QUALITIES = [
  { id: 'strict', label: 'Strict', hint: '≤12 frames' },
  { id: 'medium', label: 'Medium', hint: '≤24 frames' },
  { id: 'high', label: 'High', hint: '≤40 frames' }
];
// Sampling density, in frames. An editor thinks in frames, not in "how many panels" — and a
// fixed panel count meant a 0.8s whip and a 12s drive were both sampled nine times, which is
// far too coarse for one and pointless for the other. The backend coarsens the step if the
// shot is long enough that it would blow the panel cap.
const FRAME_STEPS = [2, 3, 5, 10, 25];
// Mirrors backend/video.mjs `clock`: a scene stamp is read against the source video, not a reel.
const clock = sec => {
  const t = Math.max(0, Number(sec) || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t - h * 3600) / 60), s = t - h * 3600 - m * 60;
  const ss = (s < 10 ? '0' : '') + s.toFixed(2);
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
};

export class VideoImport extends React.Component {
  // props: app, scope(pid), folder, onClose, onSaved
  constructor(props) {
    super(props);
    this.state = { url: '', quality: 'medium', job: null, sel: {}, saving: false, error: null, tools: null,
      // scene editor: which scene is open, its uncommitted in/out, and the sheet density
      open: null, pending: null, step: 5, building: false, trimming: false };
    this.fileRef = React.createRef();
    this._poll = null;
    this._trim = null;
  }
  componentDidMount() { api.videoTools().then(t => this.setState({ tools: t })).catch(() => {}); }
  componentWillUnmount() { this.stopPoll(); clearTimeout(this._trim); }
  stopPoll() { if (this._poll) { clearInterval(this._poll); this._poll = null; } }

  // ── scene editor ──
  shot(ix) { return (this.state.job?.shots || [])[ix] || null; }
  frameStep() { const fps = this.state.job?.fps; return fps > 0 ? 1 / fps : 0.04; }
  openScene(ix) {
    const shot = this.shot(ix);
    if (!shot) return;
    clearTimeout(this._trim);
    this.setState({ open: ix, pending: { s: shot.s, e: shot.e }, error: null });
  }
  closeScene() { clearTimeout(this._trim); this.commitTrim(); this.setState({ open: null, pending: null }); }

  // Nudge is optimistic: the in/out previews redraw off the pending value immediately and the
  // POST that re-cuts the poster is debounced, so holding a key doesn't queue an ffmpeg per press.
  nudge(edge, delta) {
    this.setState(s => {
      if (!s.pending) return null;
      const dur = s.job?.duration || 0;
      const p = { ...s.pending };
      p[edge] = Math.max(0, Math.min(dur, p[edge] + delta));
      if (p.e < p.s + 0.35) { if (edge === 's') p.s = p.e - 0.35; else p.e = p.s + 0.35; }
      return { pending: { s: Math.max(0, p.s), e: Math.min(dur, p.e) } };
    }, () => this.queueTrim());
  }
  setEdge(edge, value) { this.setState(s => ({ pending: { ...s.pending, [edge]: value } }), () => this.queueTrim()); }
  queueTrim() { clearTimeout(this._trim); this._trim = setTimeout(() => this.commitTrim(), 420); }

  // Writes the pending range through and re-reads the job: the server drops any contact sheet on
  // a re-cut scene, so the client must not keep rendering one it no longer has.
  async commitTrim() {
    const { job, open, pending } = this.state;
    if (job == null || open == null || !pending) return;
    const shot = this.shot(open);
    if (!shot || (Math.abs(shot.s - pending.s) < 0.001 && Math.abs(shot.e - pending.e) < 0.001)) return;
    this.setState({ trimming: true });
    try {
      await api.videoImportTrim(job.id, open, pending.s, pending.e);
      const j = await api.videoImportJob(job.id);
      this.setState({ job: j, trimming: false });
    } catch (e) { this.setState({ trimming: false, error: e.error || e.message || 'Trim failed' }); }
  }
  resetScene() {
    const shot = this.shot(this.state.open);
    if (shot) this.setState({ pending: { s: shot.s0, e: shot.e0 } }, () => this.queueTrim());
  }

  async buildSheet() {
    const { job, open, step } = this.state;
    if (job == null || open == null) return;
    clearTimeout(this._trim);
    this.setState({ building: true, error: null });
    try {
      await this.commitTrim();                       // a sheet must describe the range you can see
      await api.videoImportSheet(job.id, open, step);
      const j = await api.videoImportJob(job.id);
      this.setState({ job: j, building: false });
    } catch (e) { this.setState({ building: false, error: e.error || e.message || 'Could not build the contact sheet' }); }
  }
  async removeSheet(sid) {
    const { job } = this.state;
    try { await api.videoImportSheetDiscard(job.id, sid); this.setState({ job: await api.videoImportJob(job.id) }); }
    catch { /* the sheet list re-reads on the next action anyway */ }
  }

  track(job) {
    this.setState({ job, error: null });
    this.stopPoll();
    this._poll = setInterval(async () => {
      try {
        const j = await api.videoImportJob(job.id);
        if (j.status === 'ready') {
          this.stopPoll();
          const sel = {}; for (let i = 0; i < j.frames; i++) sel[i] = 1; // keep everything by default
          this.setState({ job: j, sel });
        } else if (j.status === 'failed') {
          this.stopPoll();
          this.setState({ job: null, error: j.error || 'Import failed' });
        } else this.setState({ job: j });
      } catch { /* transient poll error — keep trying */ }
    }, 1000);
  }

  async startUrl() {
    const url = this.state.url.trim();
    if (!url) return;
    try { this.track(await api.videoImportUrl(this.props.scope, url, this.props.folder, this.state.quality)); }
    catch (e) { this.setState({ error: e.error || e.message || 'Could not start import' }); }
  }
  async startFile(file) {
    if (!file) return;
    this.setState({ job: { status: 'working', stage: 'Uploading', progress: 1, frames: 0 }, error: null });
    try { this.track(await api.videoImportFile(this.props.scope, file, this.props.folder, this.state.quality)); }
    catch (e) { this.setState({ job: null, error: e.error || e.message || 'Could not start import' }); }
  }
  async save() {
    const { job, sel } = this.state;
    const indices = Object.keys(sel).filter(k => sel[k]).map(Number).sort((a, b) => a - b);
    // Every built sheet is saved: building one is already a deliberate act with its own Remove.
    const sheets = (job.sheets || []).map(x => x.id);
    if (!indices.length && !sheets.length) return;
    clearTimeout(this._trim);
    this.setState({ saving: true });
    try {
      await this.commitTrim();
      const r = await api.videoImportSave(job.id, indices, sheets);
      this.props.app.showToast((r.saved?.length || 0) + ' files → ' + (this.props.folder || 'unsorted'), 'var(--ok)');
      this.props.onSaved && this.props.onSaved();
      this.close(false);
    } catch (e) { this.setState({ saving: false, error: e.error || e.message || 'Save failed' }); }
  }
  close(discard = true) {
    this.stopPoll();
    if (discard && this.state.job?.id) api.videoImportDiscard(this.state.job.id).catch(() => {});
    this.props.onClose();
  }

  // One in/out handle: the frame it currently lands on, its stamp, and the nudge ladder.
  // The OUT preview shows the last frame INSIDE the scene, not the first frame after it —
  // an out point that previews the next shot is what makes a trim feel wrong in every NLE.
  handle(edge, label) {
    const S = this.state, step = this.frameStep(), cuts = S.job.cuts || [];
    const at = edge === 's' ? S.pending.s : Math.max(S.pending.s, S.pending.e - step);
    const snapTo = edge === 's'
      ? [...cuts].filter(c => c < S.pending.s - 0.05).pop() ?? 0
      : [...cuts].find(c => c > S.pending.e + 0.05) ?? S.job.duration;
    return (
      <div style={sx('flex:1;min-width:0')}>
        <div style={sx('display:flex;align-items:baseline;gap:8px;margin-bottom:6px')}>
          <span style={{ ...sx('font-weight:700;letter-spacing:.14em;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 9 }}>{label}</span>
          <span style={{ ...sx('color:var(--accent)'), fontFamily: MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{clock(at)}</span>
        </div>
        <img src={api.videoImportAtUrl(S.job.id, at)} alt={label}
          style={sx('width:100%;display:block;border-radius:8px;background:var(--ink);border:1px solid var(--border-2)')} />
        <div style={sx('display:flex;flex-wrap:wrap;gap:4px;margin-top:7px')}>
          <Chip label="−1s" onClick={() => this.nudge(edge, -1)} title="one second earlier" />
          <Chip label="−10f" onClick={() => this.nudge(edge, -10 * step)} title="ten frames earlier" />
          <Chip label="−1f" onClick={() => this.nudge(edge, -step)} title="one frame earlier" />
          <Chip label="+1f" onClick={() => this.nudge(edge, step)} title="one frame later" />
          <Chip label="+10f" onClick={() => this.nudge(edge, 10 * step)} title="ten frames later" />
          <Chip label="+1s" onClick={() => this.nudge(edge, 1)} title="one second later" />
          <Chip label={edge === 's' ? '⇤ cut' : 'cut ⇥'} onClick={() => this.setEdge(edge, snapTo)}
            title={'snap to the ' + (edge === 's' ? 'previous' : 'next') + ' detected cut · ' + clock(snapTo)} />
        </div>
      </div>
    );
  }

  sceneEditor() {
    const S = this.state, ix = S.open, shot = this.shot(ix);
    if (!shot || !S.pending) return null;
    const span = S.pending.e - S.pending.s;
    const detected = Math.abs(shot.s0 - S.pending.s) > 0.001 || Math.abs(shot.e0 - S.pending.e) > 0.001;
    const sheets = (S.job.sheets || []).filter(x => x.shot === ix);
    const fps = S.job.fps || 0;
    // mirrors stepTimes' count so the chip row can say what you are about to get
    const estPanels = Math.max(1, Math.min(60, Math.floor((span * (fps || 25)) / S.step) + 1));
    return (
      <>
        <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:12px')}>
          <span onClick={() => this.closeScene()} className="hFg" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>‹ All scenes</span>
          <span style={{ ...sx('font-weight:700;letter-spacing:.14em;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10 }}>SCENE {ix + 1} / {S.job.shots.length}</span>
          <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
            {clock(S.pending.s)} → {clock(S.pending.e)} · {span.toFixed(2)}s{S.job.fps ? ' · ' + S.job.fps + 'fps' : ''}
          </span>
          {S.trimming && <span style={{ ...sx('color:var(--accent)'), fontFamily: MONO, fontSize: 9.5 }}>re-cutting…</span>}
          {detected && <span onClick={() => this.resetScene()} className="hFg" style={sx('margin-left:auto;font-size:10.5px;color:var(--fg-faint);cursor:pointer')}>Reset to detected cut</span>}
        </div>

        <div style={sx('display:flex;gap:12px;align-items:flex-start')}>
          {this.handle('s', 'IN')}
          {this.handle('e', 'OUT')}
        </div>

        <div style={sx('display:flex;align-items:center;gap:6px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)')}>
          <span style={{ ...sx('font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-right:2px'), fontFamily: MONO, fontSize: 9 }}>EVERY</span>
          {FRAME_STEPS.map(n => (
            <Chip key={n} label={n + 'f'} on={S.step === n} onClick={() => this.setState({ step: n })}
              title={'one panel every ' + n + ' frames' + (fps ? ' — ' + (fps / n).toFixed(1) + ' panels per second' : '')} />
          ))}
          <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
            ≈{estPanels} panel{estPanels === 1 ? '' : 's'}{estPanels >= 60 ? ' · capped, step widens' : ''}
          </span>
          <Btn variant="primary" size="sm" busy={S.building} onClick={() => this.buildSheet()} style={{ marginLeft: 'auto' }}>
            {S.building ? 'Building…' : sheets.length ? 'Rebuild sheet' : 'Build sheet'}
          </Btn>
        </div>
        <div style={sx('font-size:10px;color:var(--fg-faint);margin-top:7px')}>
          One JPEG of the whole scene, panels numbered and time-stamped in reading order — hand it to an agent to write a start→end motion prompt. Re-cutting the scene drops its sheet.
        </div>

        {sheets.map(sheet => (
          <div key={sheet.id} style={sx('margin-top:12px')}>
            <div style={sx('display:flex;align-items:baseline;gap:8px;margin-bottom:6px')}>
              <span style={{ ...sx('color:var(--ok)'), fontFamily: MONO, fontSize: 10 }}>✓ {sheet.panels} panels · every {sheet.step}f · {sheet.cols}×{sheet.rows}</span>
              {!sheet.labelled && <span style={{ ...sx('color:var(--warn)'), fontSize: 10 }}>no font found — panels are unlabelled, the sidecar still carries the times</span>}
              <span style={sx('margin-left:auto;font-size:10px;color:var(--fg-faint)')}>saved with your frames</span>
              <span onClick={() => this.removeSheet(sheet.id)} className="hFg" style={sx('font-size:10px;color:var(--fg-faint);cursor:pointer')}>Remove</span>
            </div>
            <img src={api.videoImportSheetUrl(S.job.id, sheet.id)} alt="contact sheet"
              style={sx('width:100%;display:block;border-radius:8px;border:1px solid var(--border-2)')} />
          </div>
        ))}
      </>
    );
  }

  render() {
    const S = this.state;
    const ready = S.job && S.job.status === 'ready';
    const working = S.job && S.job.status === 'working';
    const nSel = Object.values(S.sel).filter(Boolean).length;
    const nSheets = (S.job?.sheets || []).length;
    const missingTools = S.tools && (!S.tools.ffmpeg || !S.tools.ytdlp);
    const width = S.open != null ? '980px' : ready ? '860px' : '460px';
    return (
      <div onClick={() => this.close()} style={sx('position:fixed;inset:0;z-index:80;background:rgba(5,6,8,.72);display:flex;align-items:flex-start;justify-content:center;padding-top:8vh;overflow:auto')}>
        <div onClick={e => e.stopPropagation()} style={sx('width:' + width + ';max-width:94vw;margin-bottom:8vh;padding:18px 20px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
          <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:12px')}>
            <span style={{ ...sx('font-weight:700;letter-spacing:.14em;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 10 }}>IMPORT VIDEO → FRAMES</span>
            <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>context/{this.props.folder ? this.props.folder + '/' : ''}</span>
            <span onClick={() => this.close()} className="hFgL" style={sx('margin-left:auto;font-size:11px;color:var(--fg-faint);cursor:pointer')}>Esc / Close</span>
          </div>

          {!S.job && (
            <>
              <input autoFocus value={S.url} onChange={e => this.setState({ url: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.startUrl(); else if (e.key === 'Escape') this.close(); }}
                placeholder="YouTube or Vimeo link… ⏎"
                style={{ ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:9px 12px'), fontFamily: MONO, fontSize: 12 }} />
              <div onClick={() => this.fileRef.current && this.fileRef.current.click()}
                style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:14px;text-align:center;cursor:pointer;color:var(--fg-faint);font-size:11.5px;margin-top:10px')}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); this.startFile(e.dataTransfer.files?.[0]); }}>
                …or drop / pick a video file from disk (mp4, mov, webm, mkv)
              </div>
              <input ref={this.fileRef} type="file" accept=".mp4,.mov,.webm,.mkv,.m4v,.avi" style={{ display: 'none' }}
                onChange={e => { this.startFile(e.target.files?.[0]); e.target.value = ''; }} />
              <div style={sx('display:flex;align-items:center;gap:6px;margin-top:12px')}>
                <span style={{ ...sx('font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-right:2px'), fontFamily: MONO, fontSize: 9 }}>CUT DETECTION</span>
                {QUALITIES.map(q => (
                  <span key={q.id} onClick={() => this.setState({ quality: q.id })} title={q.hint}
                    style={{ ...sx('font-size:10px;font-weight:700;letter-spacing:.04em;border-radius:99px;padding:3px 10px;cursor:pointer'), color: S.quality === q.id ? 'var(--on-accent)' : 'var(--fg-muted)', background: S.quality === q.id ? 'var(--accent)' : 'transparent', border: '1px solid ' + (S.quality === q.id ? 'var(--accent)' : 'var(--border-2)') }}>{q.label}</span>
                ))}
                <span onClick={() => this.startUrl()} className="hBtnAccent"
                  style={{ ...sx('margin-left:auto;padding:5px 14px;border-radius:7px;font-weight:700;font-size:11px;cursor:pointer'), background: S.url.trim() ? 'var(--accent)' : 'var(--border-2)', color: S.url.trim() ? 'var(--on-accent)' : 'var(--fg-faint)' }}>Import</span>
              </div>
              <div style={sx('font-size:10px;color:var(--fg-faint);margin-top:10px')}>
                Downloads and splits the film on this machine (yt-dlp + ffmpeg) — one frame per shot cut, you pick what stays.
              </div>
              {missingTools && (
                <div style={sx('font-size:10.5px;color:var(--warn);margin-top:8px')}>
                  Missing tools: {!S.tools.ffmpeg && 'ffmpeg '}{!S.tools.ytdlp && 'yt-dlp'} — install with <span style={{ fontFamily: MONO }}>brew install ffmpeg yt-dlp</span>
                </div>
              )}
            </>
          )}

          {working && (
            <div style={sx('padding:18px 4px')}>
              <div style={sx('display:flex;align-items:baseline;gap:10px')}>
                <span style={sx('font-size:12px;font-weight:700;color:var(--fg-soft)')}>{S.job.stage}…</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--accent)' }}>{Math.round(S.job.progress || 0)}%</span>
              </div>
              <div style={sx('height:4px;background:var(--line);border-radius:99px;margin-top:10px;overflow:hidden')}>
                <div style={{ ...sx('height:100%;background:var(--accent);border-radius:99px'), width: Math.round(S.job.progress || 0) + '%', transition: 'width .4s ease' }} />
              </div>
            </div>
          )}

          {ready && S.open != null && this.sceneEditor()}

          {ready && S.open == null && (
            <>
              <div style={sx('font-size:11px;color:var(--fg-muted);margin-bottom:10px')}>
                {S.job.frames} scenes detected — click a frame to keep / drop it, or <span style={{ color: 'var(--fg-soft)' }}>Open</span> a scene to move its cut points and pull a contact sheet.
                <span style={{ color: 'var(--fg-faint)' }}> Dropped frames are deleted, nothing else is stored.</span>
              </div>
              <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;max-height:52vh;overflow:auto;padding-right:4px')}>
                {Array.from({ length: S.job.frames }, (_, i) => {
                  const on = !!S.sel[i];
                  const shot = this.shot(i);
                  const sheeted = (S.job.sheets || []).some(x => x.shot === i);
                  return (
                    <div key={i} onClick={() => this.setState(s => ({ sel: { ...s.sel, [i]: s.sel[i] ? 0 : 1 } }))}
                      style={{ ...sx('position:relative;border-radius:8px;overflow:hidden;cursor:pointer;background:var(--ink)'), border: on ? '2px solid var(--accent)' : '2px solid transparent', opacity: on ? 1 : 0.35 }}>
                      <img src={api.videoImportFrameUrl(S.job.id, i, shot?.v)} alt={'scene ' + (i + 1)} style={sx('width:100%;display:block')} loading="lazy" />
                      <span style={{ ...sx('position:absolute;top:5px;left:6px;font-size:9px;font-weight:700;border-radius:99px;padding:2px 7px'), fontFamily: MONO, background: on ? 'var(--accent)' : 'rgba(13,14,17,.8)', color: on ? 'var(--on-accent)' : 'var(--fg-muted)' }}>{on ? '✓ ' : ''}{i + 1}</span>
                      {sheeted && <span style={{ ...sx('position:absolute;top:5px;right:6px;font-size:8.5px;font-weight:700;border-radius:99px;padding:2px 7px;background:rgba(13,14,17,.85)'), fontFamily: MONO, color: 'var(--ok)' }}>SHEET</span>}
                      <span onClick={e => { e.stopPropagation(); this.openScene(i); }} className="hFgL"
                        style={{ ...sx('position:absolute;right:6px;bottom:6px;font-size:8.5px;font-weight:700;letter-spacing:.1em;border-radius:99px;padding:3px 9px;background:rgba(13,14,17,.85);border:1px solid var(--border-2)'), fontFamily: MONO, color: 'var(--fg-soft)' }}>OPEN</span>
                      {shot && <span style={{ ...sx('position:absolute;left:6px;bottom:6px;font-size:8.5px;border-radius:99px;padding:3px 8px;background:rgba(13,14,17,.8)'), fontFamily: MONO, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>{(shot.e - shot.s).toFixed(1)}s</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {ready && (
            <div style={sx('display:flex;align-items:center;gap:12px;margin-top:14px')}>
              {S.open == null && <>
                <span onClick={() => { const sel = {}; for (let i = 0; i < S.job.frames; i++) sel[i] = 1; this.setState({ sel }); }} className="hFg" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>All</span>
                <span onClick={() => this.setState({ sel: {} })} className="hFg" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>None</span>
              </>}
              <span onClick={() => !S.saving && this.save()} className="hBtnAccent"
                style={{ ...sx('margin-left:auto;padding:6px 18px;border-radius:7px;font-weight:700;font-size:11.5px;cursor:pointer'), background: (nSel || nSheets) && !S.saving ? 'var(--accent)' : 'var(--border-2)', color: (nSel || nSheets) && !S.saving ? 'var(--on-accent)' : 'var(--fg-faint)' }}>
                {S.saving ? 'Saving…' : 'Keep ' + nSel + ' frame' + (nSel === 1 ? '' : 's') + (nSheets ? ' + ' + nSheets + ' sheet' + (nSheets === 1 ? '' : 's') : '')}
              </span>
            </div>
          )}

          {S.error && <div style={sx('font-size:11px;color:var(--danger);margin-top:10px')}>{S.error}</div>}
        </div>
      </div>
    );
  }
}
