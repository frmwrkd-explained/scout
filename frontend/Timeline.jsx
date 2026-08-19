// The Timeline — the project's editing tab. A real multi-track cut, not a strip.
//
// x-axis IS time here (px = frames × zoom), because free positioning demands it: a clip has to be
// able to sit anywhere, gaps have to be visible, and a V2 overlay has to line up with the picture
// underneath it. That buys back zoom, which is the price of the model.
//
// Three regions: SOURCES on the left (every shot with every take, plus renders, footage, audio),
// the PROGRAM monitor top-right, and the TRACKS below it. Nothing is derived behind your back —
// "Lay down shots" is a button you press.
import React from 'react';
import { api } from './api';
import { Btn, Empty } from './ui';
import { MONO } from './tokens';
import { sx } from './sx';
import { createEngine, createBitmapCache } from './reelClock';

const ZOOMS = [0.5, 1, 2, 4, 8, 16];          // px per frame
const TRACK_H = { video: 56, audio: 34 };
const HEAD_W = 46;
const pad2 = n => String(n).padStart(2, '0');

export default class Timeline extends React.Component {
  constructor(p) {
    super(p);
    this.state = {
      reel: null, sources: null, loading: true, err: '',
      frame: 0, playing: false, zoom: 2, sel: null, srcTab: 'shots',
      openShot: null, busy: false, rendering: false, renderPct: 0, drag: null, entry: null,
      filter: 'all'
    };
    this.stage = React.createRef();
    this.lanes = React.createRef();
    this.cache = createBitmapCache();
    this.eng = null;
    this.drawn = null;
  }

  componentDidMount() {
    this._key = e => this.onKey(e);
    window.addEventListener('keydown', this._key, true);
    this._vis = () => this.eng && this.eng.resync();
    document.addEventListener('visibilitychange', this._vis);
    this.load();
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this._key, true);
    document.removeEventListener('visibilitychange', this._vis);
    this.eng && this.eng.destroy();
    this.cache.clear();
  }

  async load(keep = true) {
    try {
      const [reel, sources] = await Promise.all([api.reel(this.props.pid), api.reelSources(this.props.pid)]);
      const at = keep && this.eng ? this.eng.frame : 0;
      this.setState({ reel, sources, loading: false, err: '' }, () => {
        this.rebuild(reel, at);
        this.paint(this.eng ? this.eng.frame : 0, true);
      });
    } catch (e) { this.setState({ err: e.message || 'Could not load the timeline', loading: false }); }
  }

  // The engine plays a flattened V1+V2 lane: whatever is topmost at a given frame is what shows.
  flatten(reel) {
    const total = reel.totalFrames || 0;
    return [{ frames: Math.max(1, total) }];
  }

  rebuild(reel, at = 0) {
    const clips = this.flatten(reel);
    if (this.eng) { this.eng.setClips(clips); this.eng.seek(at); return; }
    this.eng = createEngine({
      clips, fps: reel.fps,
      onFrame: (f, ended) => {
        this.paint(f);
        if (f !== this.state.frame) this.setState({ frame: f });
        if (ended) this.setState({ playing: false });
      }
    });
    this.eng.seek(at);
  }

  clips() { return (this.state.reel && this.state.reel.clips) || []; }
  // Every take for the selected clip's shot — the alternates strip reads this.
  takesOf(c) {
    if (!c || !c.shot || !this.state.sources) return [];
    return (this.state.sources.shots.find(s => s.id === c.shot) || {}).takes || [];
  }
  // Step through takes by offset (+1/-1) or jump to an index. Wraps, so , and . cycle forever.
  stepTake(c, d) {
    const t = this.takesOf(c);
    if (t.length < 2) return;
    const i = t.findIndex(x => x.generation === c.generation);
    const n = ((i < 0 ? 0 : i) + d + t.length) % t.length;
    this.setTake(c.id, t[n].generation);
  }
  pickTake(c, i) {
    const t = this.takesOf(c);
    if (t[i]) this.setTake(c.id, t[i].generation);
  }
  urlFor(c) {
    if (!c || !c.file) return null;
    return api.renderUrl(this.props.pid, c.file.split('/').pop());
  }
  // topmost visible clip at a frame: V2 wins over V1
  atFrame(f) {
    const hit = this.clips().filter(c => c.track !== 'A1' && c.track !== 'A2' && f >= c.startFrame && f < c.endFrame);
    return hit.find(c => c.track === 'V2') || hit.find(c => c.track === 'V1') || null;
  }

  paint(frame, force = false) {
    const cv = this.stage.current;
    if (!cv) return;
    const c = this.atFrame(frame);
    const key = c ? c.id + ':' + (c.generation || '') : 'empty';
    if (!force && this.drawn === key) return;
    this.drawn = key;
    const ctx = cv.getContext('2d');
    const { width: W, height: H } = cv;
    ctx.fillStyle = '#08090B';
    ctx.fillRect(0, 0, W, H);
    if (!c) return;                                     // a gap is black, which is what it is
    if (c.kind === 'image' || c.kind === 'video') {
      const u = this.urlFor(c);
      const bmp = this.cache.get(u);
      if (bmp) {
        const s = Math.min(W / bmp.width, H / bmp.height);
        ctx.drawImage(bmp, (W - bmp.width * s) / 2, (H - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
      } else {
        this.cache.load(u).then(() => { this.drawn = null; this.paint(frame, true); }).catch(() => { });
        this.label(ctx, W, H, c, 'loading…');
      }
    } else this.label(ctx, W, H, c, c.kind === 'audio' ? 'audio' : 'NO APPROVED TAKE');
  }

  label(ctx, W, H, c, sub) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#E3FF32';
    ctx.font = '700 ' + Math.round(H / 13) + "px 'Spline Sans Mono', monospace";
    ctx.fillText(c.shot || c.title || c.id, W / 2, H / 2 - 6);
    ctx.fillStyle = '#626B78';
    ctx.font = Math.round(H / 34) + "px 'Spline Sans Mono', monospace";
    ctx.fillText(sub, W / 2, H / 2 + Math.round(H / 16));
  }

  tc(f) {
    const r = this.state.reel;
    if (!r) return '00:00:00:00';
    const fps = Math.round(r.fps);
    const n = Math.max(0, f + (r.tcStart || 0));
    return pad2(Math.floor(n / (fps * 3600)) % 24) + ':' + pad2(Math.floor(n / (fps * 60)) % 60) + ':'
      + pad2(Math.floor(n / fps) % 60) + (r.drop ? ';' : ':') + pad2(n % fps);
  }

  // ── mutations ──────────────────────────────────────────────────────────────────────────────
  async op(fn, log) {
    const at = this.eng ? this.eng.frame : 0;
    try {
      const reel = await fn();
      this.setState({ reel }, () => { this.rebuild(reel, at); this.drawn = null; this.paint(this.eng.frame, true); });
      if (log) this.props.app.showToast(log, 'var(--ok)');
      return reel;
    } catch (e) { this.props.app.showToast(e.message || 'Failed', 'var(--danger)'); }
  }

  layDown(replace) {
    return this.op(() => api.layDownShots(this.props.pid, { replace }),
      replace ? 'Shots laid down on V1' : 'Shots appended to V1');
  }
  addClip(spec) { return this.op(() => api.addReelClip(this.props.pid, spec)); }
  magnetic() { return this.state.reel ? this.state.reel.magnetic !== false : true; }
  patchClip(id, patch, ripple) { return this.op(() => api.patchReelClip(this.props.pid, id, { ...patch, ripple })); }
  delClip(id, ripple) { return this.op(() => api.deleteReelClip(this.props.pid, id, ripple), ripple ? 'Closed the gap' : 'Deleted, gap left'); }
  toggleMagnetic() {
    return this.op(() => api.patchReel(this.props.pid, { magnetic: !this.magnetic() }, 'magnetic toggled'),
      this.magnetic() ? 'Magnetic off — trims leave a gap' : 'Magnetic on — trims close the gap');
  }
  setTake(id, generation) { return this.op(() => api.setClipTake(this.props.pid, id, generation)).then(() => this.load()); }

  async exportPack() {
    if (this.state.busy) return;
    this.setState({ busy: true });
    try {
      const r = await api.exportReel(this.props.pid);
      this.props.app.showToast(r.clips + ' clips · ' + r.totalTc + ' → animatic.xml + .fcpxml', 'var(--ok)');
    } catch (e) { this.props.app.showToast(e.message || 'Export failed', 'var(--danger)'); }
    finally { this.setState({ busy: false }); }
  }

  async renderMp4() {
    if (this.state.rendering) return;
    this.setState({ rendering: true, renderPct: 0 });
    try {
      await this.exportPack();
      const job = await api.renderReel(this.props.pid);
      const poll = async () => {
        const j = await api.renderReelJob(this.props.pid, job.id);
        this.setState({ renderPct: j.progress || 0 });
        if (j.status === 'running') return setTimeout(poll, 500);
        this.setState({ rendering: false });
        if (j.status === 'done') {
          const r = j.result || {};
          this.props.app.showToast('animatic.mp4 · ' + ((r.bytes || 0) / 1048576).toFixed(1) + ' MB', r.ok ? 'var(--ok)' : 'var(--danger)');
        } else this.props.app.showToast(j.error || 'Render failed', 'var(--danger)');
      };
      poll();
    } catch (e) { this.setState({ rendering: false }); this.props.app.showToast(e.message || 'Render failed', 'var(--danger)'); }
  }

  seek(f) { if (this.eng) { this.eng.seek(f); this.setState({ frame: this.eng.frame }); } }

  // Scrub: press anywhere on the ruler (or empty timeline space) and DRAG. Pointer capture keeps
  // it tracking when the cursor leaves the element, which is the whole difference between a
  // scrubber that feels right and one that drops the moment you move fast.
  scrubFrom(el, clientX) {
    const rect = el.getBoundingClientRect();
    this.seek(Math.max(0, Math.round((clientX - rect.left) / this.state.zoom)));
  }
  scrubDown = e => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    this._scrub = el;
    this.scrubFrom(el, e.clientX);
  };
  scrubMove = e => {
    if (!this._scrub) return;
    if (!(e.buttons & 1)) { this.scrubUp(e); return; }
    this.scrubFrom(this._scrub, e.clientX);
  };
  scrubUp = e => {
    if (!this._scrub) return;
    e.currentTarget?.releasePointerCapture?.(e.pointerId);
    this._scrub = null;
  };
  selected() { return this.clips().find(c => c.id === this.state.sel) || null; }

  // ── drag: move a clip, or trim from either edge ────────────────────────────────────────────
  startDrag(e, clip, mode) {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    this.setState({
      sel: clip.id,
      drag: { id: clip.id, mode, x0: e.clientX, y0: e.clientY, offset0: clip.startFrame, frames0: clip.frames, in0: clip.in || 0, track0: clip.track, offset: clip.startFrame, frames: clip.frames, track: clip.track }
    });
  }
  moveDrag(e) {
    const d = this.state.drag;
    if (!d) return;
    // A lost pointerup (released off-window, a synthetic click, a focus steal) would otherwise
    // leave the capture live, so every later mouse move keeps dragging the clip and the next
    // click drops it somewhere the user never intended — including onto an audio track.
    // The button state is the authority, not the event sequence.
    if (!(e.buttons & 1)) { this.cancelDrag(); return; }
    // ignore sub-threshold jitter so a plain click never nudges a clip
    if (!d.armed && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
    if (!d.armed) d.armed = true;
    const dz = Math.round((e.clientX - d.x0) / this.state.zoom);
    const next = { ...d };
    if (d.mode === 'move') {
      next.offset = Math.max(0, d.offset0 + dz);
      // vertical drag changes track — the lane under the pointer wins
      const lanes = this.lanes.current;
      if (lanes) {
        const r = lanes.getBoundingClientRect();
        const y = e.clientY - r.top + lanes.scrollTop;
        let acc = 0, hit = d.track0;
        for (const t of this.state.reel.tracks) {
          const h = TRACK_H[t.kind];
          if (y >= acc && y < acc + h) { hit = t.id; break; }
          acc += h;
        }
        next.track = hit;
      }
    } else if (d.mode === 'end') {
      next.frames = Math.max(2, d.frames0 + dz);
    } else if (d.mode === 'start') {
      // Head trim moves the SOURCE in-point, so the picture holds rather than sliding.
      // Magnetic: the clip stays anchored and the ripple closes the gap behind it (Final Cut).
      // Free: the clip's start moves right and leaves the hole exactly where it was.
      const delta = Math.min(dz, d.frames0 - 2);
      next.frames = Math.max(2, d.frames0 - delta);
      next.in = Math.max(0, d.in0 + delta);
      next.offset = this.magnetic() ? d.offset0 : Math.max(0, d.offset0 + delta);
    }
    this.setState({ drag: next });
  }
  // Abandon a drag without committing anything — the clip snaps back to where it was.
  cancelDrag() { if (this.state.drag) this.setState({ drag: null }); }

  endDrag(e) {
    const d = this.state.drag;
    if (!d) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    this.setState({ drag: null });
    const patch = {};
    if (d.offset !== d.offset0) patch.offset = d.offset;
    if (d.frames !== d.frames0) patch.frames = d.frames;
    if (d.in != null && d.in !== d.in0) patch.in = d.in;
    if (d.track && d.track !== d.track0) patch.track = d.track;
    if (!Object.keys(patch).length) return;
    // Only a length change ripples. Dragging a clip to a new position is deliberate placement and
    // must never shove its neighbours.
    const trimmed = patch.frames !== undefined && d.mode !== 'move';
    this.patchClip(d.id, patch, trimmed ? this.magnetic() : false);
  }

  // ── keyboard ───────────────────────────────────────────────────────────────────────────────
  onKey(e) {
    if (e.target.isContentEditable) return;
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (this.props.app.state.paletteOpen) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!this.state.reel) return;

    const S = this.state, k = e.key, kl = k.toLowerCase();
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const sel = this.selected();
    const fps = Math.round(this.state.reel.fps);

    if (S.entry != null) {
      if (/^[0-9.]$/.test(k)) { stop(); this.setState({ entry: (S.entry + k).slice(0, 6) }); return; }
      if (k === 'Backspace') { stop(); this.setState({ entry: S.entry.slice(0, -1) }); return; }
      if (k === 'Enter') {
        stop();
        const v = parseFloat(S.entry);
        this.setState({ entry: null });
        if (sel && Number.isFinite(v) && v > 0) this.patchClip(sel.id, { frames: Math.round(v * this.state.reel.fps) });
        return;
      }
      if (k === 'Escape') { stop(); this.setState({ entry: null }); return; }
      return;
    }

    if (k === ' ') { stop(); this.eng.toggle(); this.setState({ playing: this.eng.playing }); return; }
    if (k === 'ArrowLeft') { stop(); this.seek(this.eng.frame - (e.shiftKey ? fps : 1)); return; }
    if (k === 'ArrowRight') { stop(); this.seek(this.eng.frame + (e.shiftKey ? fps : 1)); return; }
    if (k === 'Home') { stop(); this.seek(0); return; }
    if (k === 'End') { stop(); this.seek(this.eng.total - 1); return; }
    // ↑/↓ walk the cut points on the picture track
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      stop();
      const edges = [...new Set(this.clips().filter(c => c.track === 'V1').flatMap(c => [c.startFrame, c.endFrame]))].sort((a, b) => a - b);
      const f = this.eng.frame;
      const t = k === 'ArrowUp' ? [...edges].reverse().find(x => x < f) : edges.find(x => x > f);
      if (t != null) this.seek(t);
      return;
    }
    // ←/→ through a clip's takes — the alternates, without leaving the timeline
    if (sel && (k === ',' || k === '.')) { stop(); this.stepTake(sel, k === '.' ? 1 : -1); return; }
    // 1-9 pick a take directly — the numbers match the badges on the alternates strip.
    if (/^[1-9]$/.test(k) && sel && this.takesOf(sel).length > 1) { stop(); this.pickTake(sel, Number(k) - 1); return; }
    // D types an exact duration (digits are spent on takes, which is the more common move)
    if (kl === 'd' && sel) { stop(); this.setState({ entry: '' }); return; }
    if ((k === 'Delete' || k === 'Backspace') && sel) { stop(); this.delClip(sel.id, e.shiftKey ? !this.magnetic() : this.magnetic()); return; }
    if (kl === 'z') { stop(); this.setState({ zoom: ZOOMS[Math.max(0, ZOOMS.indexOf(S.zoom) - 1)] }); return; }
    if (kl === 'x' && !e.shiftKey) { stop(); this.setState({ zoom: ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(S.zoom) + 1)] }); return; }
    if (kl === 'e') { stop(); e.shiftKey ? this.renderMp4() : this.exportPack(); return; }
    if (kl === 'l') { stop(); this.layDown(true); return; }
    if (kl === 'm') { stop(); this.toggleMagnetic(); return; }
    if (k === 'Enter' && sel && sel.shot) { stop(); this.setState({ openShot: sel.shot }); return; }
  }

  // ── render ─────────────────────────────────────────────────────────────────────────────────
  render() {
    const S = this.state;
    if (S.loading) return <div style={sx('padding:60px;text-align:center;color:var(--fg-faint);font-size:12px')}>Loading the timeline…</div>;
    if (S.err) return <div style={sx('padding:40px')}><Empty title="The timeline could not load" body={S.err} /></div>;

    const r = S.reel;
    return (
      <div style={sx('display:flex;height:calc(100vh - 210px);min-height:460px;border-top:1px solid var(--line)')}>
        {this.renderSources()}
        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column')}>
          {this.renderBar()}
          <div style={sx('flex:none;display:flex;align-items:center;justify-content:center;background:var(--void);padding:10px 14px')}>
            <canvas ref={this.stage} width={880} height={Math.round(880 * (r.height / r.width))}
              style={sx('max-height:36vh;max-width:100%;border-radius:8px;display:block;background:#08090B')} />
          </div>
          {this.renderTakes()}
          {this.renderTracks()}
        </div>
      </div>
    );
  }

  // ── alternates: every take for the selected clip, one click to swap ──────────────────────────
  // This is the thing a generic editor cannot do. A shot here has 3-13 renders; the cut should let
  // you audition them in place, at the right length, next to the shots either side of it.
  renderTakes() {
    const sel = this.selected();
    const takes = this.takesOf(sel);
    if (!sel) return null;
    if (!sel.shot) {
      return (
        <div style={sx('flex:none;display:flex;align-items:center;gap:10px;padding:6px 14px;border-top:1px solid var(--line);min-height:34px')}>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{sel.title} — imported footage, no takes</span>
        </div>
      );
    }
    return (
      <div style={sx('flex:none;display:flex;align-items:center;gap:8px;padding:6px 14px;border-top:1px solid var(--line);overflow-x:auto;min-height:52px')}>
        <span style={{ ...sx('flex:none'), fontFamily: MONO, fontSize: 9.5, color: 'var(--accent)' }}>
          {sel.shot}
          <span style={sx('color:var(--fg-faint)')}> · {takes.length} take{takes.length === 1 ? '' : 's'}</span>
        </span>
        {!takes.length && <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>nothing rendered for this shot yet</span>}
        {takes.map((t, i) => {
          const on = t.generation === sel.generation;
          return (
            <span key={t.generation} onClick={() => this.setTake(sel.id, t.generation)}
              title={(i + 1) + ' · ' + t.model + ' · ' + (t.final ? 'final' : t.reviewState) + (i < 9 ? '  (press ' + (i + 1) + ')' : '')}
              style={{ ...sx('flex:none;position:relative;width:62px;height:38px;border-radius:5px;overflow:hidden;cursor:pointer'),
                border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
                boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : 'none', opacity: on ? 1 : 0.72 }}>
              <img src={api.renderUrl(this.props.pid, t.name)} alt="" style={sx('width:100%;height:100%;object-fit:cover')} />
              <span style={{ ...sx('position:absolute;left:0;top:0;padding:0 3px;border-bottom-right-radius:4px'),
                fontFamily: MONO, fontSize: 8, background: 'var(--void)',
                color: t.final ? 'var(--ok)' : t.reviewState === 'kept' ? 'var(--fg)' : 'var(--fg-faint)' }}>{i + 1}</span>
            </span>
          );
        })}
        {takes.length > 1 && (
          <span style={{ ...sx('flex:none;margin-left:4px'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>
            , . cycle · 1-9 pick
          </span>
        )}
      </div>
    );
  }

  renderBar() {
    const S = this.state, r = S.reel;
    const sel = this.selected();
    return (
      <div style={sx('flex:none;display:flex;align-items:center;gap:12px;padding:9px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap')}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
          {this.tc(S.frame)} <span style={sx('color:var(--fg-faint)')}>/ {r.totalTc}</span>
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>
          {r.rate} fps · {r.width}×{r.height} · {r.clips.length} clips{r.slates ? ' · ' + r.slates + ' slate' : ''}
        </span>
        {S.entry != null && (
          <span style={{ ...sx('padding:2px 9px;border-radius:5px'), fontFamily: MONO, fontSize: 11, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700 }}>{S.entry}s ⏎</span>
        )}
        {sel && sel.takeCount > 1 && (
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--accent)' }}>
            take {sel.takeIndex + 1}/{sel.takeCount} — , . to swap
          </span>
        )}
        <span style={sx('margin-left:auto;display:inline-flex;align-items:center;gap:7px')}>
          <span onClick={() => this.toggleMagnetic()} title="Magnetic timeline — trimming and deleting close the gap automatically (M)"
            style={{ ...sx('padding:3px 9px;border-radius:99px;cursor:pointer'), fontFamily: MONO, fontSize: 9.5,
              border: '1px solid ' + (this.magnetic() ? 'var(--accent-35)' : 'var(--border)'),
              color: this.magnetic() ? 'var(--accent)' : 'var(--fg-faint)' }}>
            {this.magnetic() ? '🧲 magnetic' : 'free'}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>Space · ↑↓ cut · ,. 1-9 takes · D duration · Z X zoom · ⌫ delete · M magnetic</span>
          <Btn size="sm" variant="secondary" onClick={() => this.layDown(true)} style={{ padding: '4px 10px' }}>Lay down shots</Btn>
          <Btn size="sm" variant="secondary" busy={S.busy} onClick={() => this.exportPack()} style={{ padding: '4px 10px' }}>{S.busy ? '…' : 'Export XML'}</Btn>
          <Btn size="sm" variant="secondary" busy={S.rendering} onClick={() => this.renderMp4()} style={{ padding: '4px 10px' }}>
            {S.rendering ? Math.round(S.renderPct * 100) + '%' : 'mp4'}
          </Btn>
        </span>
      </div>
    );
  }

  // ── sources: every shot with every take, plus renders / footage / audio ─────────────────────
  renderSources() {
    const S = this.state, src = S.sources;
    if (!src) return null;
    // Filter applies across every source tab, so "video only" answers the same question whether
    // you are looking at shots, takes, renders or imported footage.
    const F = S.filter;
    const isVid = x => x.kind === 'video' || /\.(mp4|mov|webm|mkv|m4v)$/i.test(x.name || x.file || '');
    const isAud = x => x.kind === 'audio' || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(x.name || x.file || '');
    const keepTake = t => F === 'all' ? true
      : F === 'video' ? isVid(t)
      : F === 'stills' ? (!isVid(t) && !isAud(t))
      : F === 'audio' ? isAud(t)
      : /* approved */ (t.final || t.reviewState === 'kept');
    const shotsF = src.shots
      .map(sh => ({ ...sh, takes: sh.takes.filter(keepTake) }))
      .filter(sh => F === 'all' ? true : sh.takes.length > 0);
    const rendersF = src.renders.filter(keepTake);
    const assetsF = src.assets.filter(a => F === 'all' ? true
      : F === 'video' ? isVid(a) : F === 'stills' ? (!isVid(a) && !isAud(a))
      : F === 'audio' ? isAud(a) : false);

    const tabs = [['shots', 'Shots', shotsF.length], ['takes', 'All takes', shotsF.reduce((n, x) => n + x.takes.length, 0)],
                  ['renders', 'Renders', rendersF.length], ['assets', 'Footage', assetsF.length]];
    const filters = [['all', 'All'], ['stills', 'Stills'], ['video', 'Video'], ['audio', 'Audio'], ['approved', 'Approved']];
    return (
      <div style={sx('flex:none;width:236px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--sunk)')}>
        <div style={sx('flex:none;display:flex;gap:2px;padding:8px 8px 0;flex-wrap:wrap')}>
          {tabs.map(([id, label, n]) => (
            <span key={id} onClick={() => this.setState({ srcTab: id })}
              style={{ ...sx('padding:3px 8px;border-radius:6px;cursor:pointer;font-size:10px'),
                background: S.srcTab === id ? 'var(--raise)' : 'transparent',
                color: S.srcTab === id ? 'var(--fg)' : 'var(--fg-faint)', fontWeight: S.srcTab === id ? 700 : 400 }}>
              {label} <span style={{ fontFamily: MONO, fontSize: 9 }}>{n}</span>
            </span>
          ))}
        </div>
        <div style={sx('flex:none;display:flex;gap:3px;padding:6px 8px 4px;flex-wrap:wrap;border-bottom:1px solid var(--line)')}>
          {filters.map(([id, label]) => (
            <span key={id} onClick={() => this.setState({ filter: id })}
              style={{ ...sx('padding:2px 7px;border-radius:99px;cursor:pointer;font-size:9px'),
                border: '1px solid ' + (F === id ? 'var(--accent-35)' : 'var(--border)'),
                color: F === id ? 'var(--accent)' : 'var(--fg-faint)' }}>{label}</span>
          ))}
        </div>
        <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:8px')}>
          {S.srcTab === 'shots' && (shotsF.length
            ? shotsF.map(x => this.srcShot(x))
            : <div style={sx('padding:16px 4px;font-size:10.5px;color:var(--fg-faint)')}>No shot matches this filter.</div>)}
          {S.srcTab === 'takes' && shotsF.flatMap(x => x.takes.map(t => this.srcTake(x, t)))}
          {S.srcTab === 'renders' && (rendersF.length
            ? rendersF.map(g => this.srcFile(g.name, g.file, g.kind, g.model))
            : <div style={sx('padding:16px 4px;font-size:10.5px;color:var(--fg-faint)')}>No unattached renders match.</div>)}
          {S.srcTab === 'assets' && (assetsF.length
            ? assetsF.map(a => this.srcFile(a.name, a.file, a.kind, a.folder))
            : <div style={sx('padding:16px 4px;font-size:10.5px;color:var(--fg-faint)')}>No footage matches. Drop files into the project's Assets boards or use Video import.</div>)}
        </div>
      </div>
    );
  }

  srcShot(s) {
    const thumb = s.takes.find(t => t.generation === s.selected) || s.takes[0];
    return (
      <div key={s.id} onClick={() => this.addClip({ track: 'V1', shot: s.id })}
        title={'Add ' + s.id + ' to V1' + (s.takes.length ? ' · ' + s.takes.length + ' takes' : ' · no takes yet')}
        className="hBd"
        style={sx('display:flex;align-items:center;gap:8px;padding:5px;border-radius:7px;cursor:pointer;border:1px solid transparent;margin-bottom:2px')}>
        <span style={{ ...sx('flex:none;width:40px;height:24px;border-radius:4px;overflow:hidden;background:var(--raise)'), border: '1px solid var(--border)' }}>
          {thumb && <img src={api.renderUrl(this.props.pid, thumb.name)} alt="" style={sx('width:100%;height:100%;object-fit:cover')} />}
        </span>
        <span style={sx('flex:1;min-width:0')}>
          <span style={{ ...sx('display:block'), fontFamily: MONO, fontSize: 9.5, color: 'var(--accent)' }}>{s.id}</span>
          <span style={sx('display:block;font-size:10px;color:var(--fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{s.title}</span>
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: s.takes.length ? 'var(--fg-muted)' : 'var(--fg-faint)' }}>
          {s.takes.length || '—'}
        </span>
      </div>
    );
  }

  srcTake(s, t) {
    return (
      <div key={t.generation} onClick={() => this.addClip({ track: 'V1', shot: s.id, gen: t.generation })}
        title={s.id + ' · ' + t.model + ' · ' + t.reviewState}
        className="hBd"
        style={sx('display:flex;align-items:center;gap:8px;padding:4px;border-radius:7px;cursor:pointer;border:1px solid transparent;margin-bottom:2px')}>
        <img src={api.renderUrl(this.props.pid, t.name)} alt=""
          style={{ ...sx('flex:none;width:40px;height:24px;border-radius:4px;object-fit:cover'), border: '1px solid var(--border)' }} />
        <span style={sx('flex:1;min-width:0')}>
          <span style={{ ...sx('display:block'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-muted)' }}>{s.id}</span>
          <span style={{ ...sx('display:block'), fontSize: 9.5, color: t.final ? 'var(--ok)' : t.reviewState === 'kept' ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>
            {t.final ? 'final' : t.reviewState}
          </span>
        </span>
      </div>
    );
  }

  srcFile(name, file, kind, sub) {
    const track = kind === 'audio' ? 'A1' : 'V2';
    return (
      <div key={file} onClick={() => this.addClip({ track, src: file, label: name })}
        title={'Add to ' + track + ' — ' + file} className="hBd"
        style={sx('display:flex;align-items:center;gap:8px;padding:5px;border-radius:7px;cursor:pointer;border:1px solid transparent;margin-bottom:2px')}>
        <span style={{ ...sx('flex:none;width:40px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:var(--raise)'), border: '1px solid var(--border)', fontFamily: MONO, fontSize: 9, color: 'var(--fg-muted)' }}>
          {kind === 'audio' ? '♪' : kind === 'video' ? '▶' : '▣'}
        </span>
        <span style={sx('flex:1;min-width:0')}>
          <span style={sx('display:block;font-size:10px;color:var(--fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{name}</span>
          {sub && <span style={{ ...sx('display:block'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>{sub}</span>}
        </span>
      </div>
    );
  }

  // ── tracks ─────────────────────────────────────────────────────────────────────────────────
  renderTracks() {
    const S = this.state, r = S.reel, z = S.zoom;
    const width = Math.max(600, (r.totalFrames + Math.round(r.fps * 4)) * z);
    const fps = Math.round(r.fps);
    const secStep = z < 1 ? 10 : z < 2 ? 5 : z < 4 ? 2 : 1;
    const ticks = [];
    for (let s = 0; s * fps <= r.totalFrames + fps * 4; s += secStep) ticks.push(s);

    return (
      <div style={sx('flex:1;min-height:0;display:flex;flex-direction:column;border-top:1px solid var(--line)')}>
        {r.empty && (
          <div style={sx('padding:22px 16px;text-align:center')}>
            <div style={sx('font-size:12px;color:var(--fg-soft);margin-bottom:10px')}>
              The timeline is empty. Lay down your {r.shotCount} shots, or drop anything from the left onto a track.
            </div>
            <Btn size="sm" onClick={() => this.layDown(true)}>Lay down {r.shotCount} shots on V1</Btn>
          </div>
        )}
        <div ref={this.lanes} style={sx('flex:1;min-height:0;overflow:auto;position:relative')}>
          <div style={{ width, position: 'relative' }}>
            {/* ruler */}
            <div style={{ ...sx('position:sticky;top:0;z-index:3;height:22px;background:var(--surface);border-bottom:1px solid var(--line);cursor:col-resize;touch-action:none'), marginLeft: HEAD_W }}
              onPointerDown={this.scrubDown} onPointerMove={this.scrubMove}
              onPointerUp={this.scrubUp} onPointerCancel={this.scrubUp}>
              {ticks.map(s => (
                <span key={s} style={{ ...sx('position:absolute;top:0;bottom:0;border-left:1px solid var(--line)'), left: s * fps * z }}>
                  <span style={{ ...sx('padding-left:3px'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>{s}s</span>
                </span>
              ))}
            </div>
            {/* lanes */}
            {r.tracks.map(t => (
              <div key={t.id} style={{ ...sx('position:relative;border-bottom:1px solid var(--line)'), height: TRACK_H[t.kind] }}>
                <div style={{ ...sx('position:sticky;left:0;z-index:2;display:flex;align-items:center;justify-content:center;height:100%;background:var(--sunk);border-right:1px solid var(--line)'), width: HEAD_W, float: 'left', fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)' }}>{t.label}</div>
                <div style={{ ...sx('position:relative;height:100%;touch-action:none'), marginLeft: HEAD_W }}
                  onPointerDown={this.scrubDown} onPointerMove={this.scrubMove}
                  onPointerUp={this.scrubUp} onPointerCancel={this.scrubUp}>
                  {r.clips.filter(c => c.track === t.id).map(c => this.clipEl(c, t))}
                </div>
              </div>
            ))}
            {/* playhead */}
            <div style={{ ...sx('position:absolute;top:0;bottom:0;width:2px;background:var(--accent);pointer-events:none;z-index:4'), left: HEAD_W + S.frame * z }} />
          </div>
        </div>
      </div>
    );
  }

  clipEl(c, t) {
    const S = this.state, z = S.zoom;
    const d = S.drag && S.drag.id === c.id ? S.drag : null;
    const off = d ? d.offset : c.startFrame;
    const len = d ? d.frames : c.frames;
    const on = S.sel === c.id;
    const url = this.urlFor(c);
    const w = Math.max(6, len * z);
    const slate = c.state === 'slate';

    return (
      <div key={c.id}
        onPointerDown={e => this.startDrag(e, c, 'move')}
        onPointerMove={e => this.moveDrag(e)}
        onPointerUp={e => this.endDrag(e)}
        onPointerCancel={() => this.cancelDrag()}
        onLostPointerCapture={() => this.cancelDrag()}
        onDoubleClick={() => c.shot && this.setState({ openShot: c.shot })}
        title={(c.shot || c.title) + ' · ' + c.secs.toFixed(2) + 's' + (c.takeCount > 1 ? ' · ' + c.takeCount + ' takes' : '')}
        style={{
          ...sx('position:absolute;top:2px;bottom:2px;border-radius:5px;overflow:hidden;cursor:grab;touch-action:none;user-select:none'),
          left: off * z, width: w,
          background: t.kind === 'audio' ? 'color-mix(in srgb, var(--accent) 16%, var(--raise))' : slate ? 'var(--raise)' : 'var(--surface)',
          border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
          boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : 'none',
          opacity: d ? 0.75 : 1, zIndex: on ? 2 : 1
        }}>
        {url && t.kind !== 'audio' && (
          <img src={url} alt="" style={{ ...sx('position:absolute;inset:0;width:100%;height:100%;object-fit:cover'), filter: 'saturate(.4) brightness(.45)' }} />
        )}
        {url && t.kind !== 'audio' && w > 40 && (
          <img src={url} alt="" style={{ ...sx('position:absolute;left:0;top:0;height:100%'), width: Math.min(w, 54), objectFit: 'cover' }} />
        )}
        <span style={{ ...sx('position:absolute;left:0;right:0;top:0;padding:2px 4px;display:flex;justify-content:space-between;gap:4px'),
          background: url ? 'linear-gradient(180deg,color-mix(in srgb,var(--void) 62%,transparent),transparent)' : 'none' }}>
          <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, color: slate ? 'var(--accent)' : 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {c.shot || c.title || c.id}
          </span>
          {w > 62 && <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-muted)' }}>{c.secs.toFixed(1)}s</span>}
        </span>
        {c.takeCount > 1 && w > 30 && (
          <span style={{ ...sx('position:absolute;bottom:2px;left:4px;padding:0 3px;border-radius:3px'), fontFamily: MONO, fontSize: 8, background: 'var(--void)', color: 'var(--accent)' }}>
            {c.takeIndex + 1}/{c.takeCount}
          </span>
        )}
        {/* trim handles — head and tail */}
        {['start', 'end'].map(side => (
          <span key={side}
            onPointerDown={e => this.startDrag(e, c, side)}
            onPointerMove={e => this.moveDrag(e)}
            onPointerUp={e => this.endDrag(e)}
            style={{ ...sx('position:absolute;top:0;bottom:0;width:7px;cursor:ew-resize;touch-action:none'), [side === 'start' ? 'left' : 'right']: 0,
              background: on ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'transparent' }} />
        ))}
      </div>
    );
  }
}
