// Shared media primitives — the ONE place image-vs-video (later + audio) rendering lives.
//
// Before this module the "render a generated image or video" branch was hand-rolled in at
// least six spots (moodboard mosaic + list + lightbox, generate console tiles + preview +
// zoom), each with its own hover-play / object-fit / controls quirks that drifted apart. Now
// every surface composes these three:
//
//   · RenderMedia     — the atom. Decides the media KIND and renders the right element with the
//                       right behaviour (hover-to-play video, object-fit, controls, poster,
//                       drag-out). Renders a bare <video>/<img> with no wrapper so existing
//                       descendant CSS (e.g. `.mTile video`) keeps matching.
//   · RenderTile      — a selectable thumbnail card: fixed-aspect media area + selection border
//                       + named overlay/footer slots the caller fills with status/rating chrome.
//   · RenderLightbox  — a fullscreen viewer: backdrop, header/actions/caption slots, controls
//                       video / zoomable image, optional built-in keyboard nav, drag-out payload.
//
// Ticket 07 adds an audio branch to RenderMedia — the kind branching below is written as a
// single decision point precisely so audio is one more `if`, not a new fork per consumer.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';

// Extension → media kind. Explicit kind (the backend already tags assets 'image'|'video') always
// wins; otherwise infer from the src. Keep this the SINGLE kind oracle — ticket 07 extends it with
// the audio extensions rather than adding a second `/\.mp4$/` test somewhere else.
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
export function mediaKind(src, explicit) {
  if (explicit) return explicit;
  const s = String(src || '');
  if (AUDIO_RE.test(s)) return 'audio';
  return VIDEO_RE.test(s) ? 'video' : 'image';
}

// The atom. `fit` maps to object-fit (pass null to leave it to CSS, e.g. the masonry mosaic where
// height is auto). `hoverPlay` is the tile behaviour: play on mouse-enter, rewind on leave.
// `controls`/`autoPlay` are the lightbox behaviour. Anything else (onClick, className, extra style)
// rides through `rest` onto the element.
export function RenderMedia({
  src, kind, poster, fit = 'cover', hoverPlay = false,
  controls = false, autoPlay = false, loop = true, muted = true, playsInline = true,
  draggable, onDragStart, onLoad, alt = '', style, className, ...rest
}) {
  const k = mediaKind(src, kind);
  const fitStyle = fit ? { objectFit: fit } : null;
  const merged = { ...(fitStyle || {}), ...(style || {}) };

  if (k === 'video') {
    // Hover-play is opt-in so a controls/autoPlay lightbox video doesn't also rewind on mouse-out.
    const hover = hoverPlay ? {
      onMouseEnter: e => { const p = e.currentTarget.play(); if (p && p.catch) p.catch(() => {}); },
      onMouseLeave: e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }
    } : null;
    return (
      <video src={src} poster={poster} muted={muted} loop={loop} playsInline={playsInline}
        preload="metadata" controls={controls} autoPlay={autoPlay}
        draggable={draggable} onDragStart={onDragStart}
        className={className} {...rest} {...hover} style={merged} />
    );
  }

  if (k === 'audio') {
    // ── audio ── a compact always-controls player. Fills the tile/lightbox width; the surrounding
    // box supplies height. No hover-play / object-fit / poster (those are visual-media concerns).
    // controls is forced on — a bare <audio> is invisible and useless in a tile or lightbox.
    return (
      <audio src={src} controls preload="metadata"
        autoPlay={autoPlay} loop={loop}
        className={className} {...rest}
        style={{ ...(style || {}), width: '100%', maxWidth: '420px' }} />
    );
  }

  // ── image ──
  return (
    <img src={src} alt={alt} loading="lazy"
      draggable={draggable} onDragStart={onDragStart} onLoad={onLoad}
      className={className} {...rest} style={merged} />
  );
}

// ── MediaAction ── THE review-action chip. Every surface that shows an image with keep/kill/
// re-roll/etc. next to it renders THIS chip — the shot workspace's lowercase pills and the
// gallery zoom's boxed buttons were the same control drawn in two visual languages, which is
// exactly the "different app" feel being unified away. One form: glass pill, capitalized label,
// hotkey in parens, tone as border+text tint (fill reserved for the one primary state action).
//   tone: 'ok' | 'danger' | 'accent' | 'neutral'    fill: solid tone bed (e.g. Keep on the stage)
const TONE = { ok: 'var(--ok)', danger: 'var(--danger)', accent: 'var(--accent)', neutral: null };
export function MediaAction({ label, hotkey, tone = 'neutral', fill = false, onClick, title, style }) {
  const c = TONE[tone];
  return (
    <span onClick={onClick} className={tone === 'accent' ? 'hBdAccent' : 'hBd'}
      title={title || (hotkey ? label + ' (' + hotkey + ')' : label)}
      style={{
        ...sx('display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:6px 14px;cursor:pointer;font-size:11px;font-weight:700'),
        border: '1px solid ' + (fill ? 'transparent' : c ? 'color-mix(in srgb, ' + c + ' 45%, transparent)' : 'var(--border-2)'),
        background: fill && c ? c : 'rgba(13,14,17,.6)',
        color: fill && c ? 'var(--on-accent)' : c || 'var(--fg-soft)',
        ...(style || {}),
      }}>
      {label}{hotkey ? <span style={{ ...sx('font-weight:400;opacity:.65'), fontSize: 9.5 }}>{hotkey}</span> : null}
    </span>
  );
}

// A selectable thumbnail card. The caller supplies the media source and drops its own status /
// rating / action chrome into the `overlay` (absolutely-positioned inside the media box) and
// `footer` (below the media) slots — RenderTile owns only the shell: fixed-aspect media area,
// selection/marked border, and the RenderMedia hand-off. `placeholder` renders in place of the
// media when there is no src yet (a queued/running generation).
export function RenderTile({
  src, kind, poster, fit = 'cover', hoverPlay = true, aspect = '16/9',
  selected = false, marked = false,
  selectedColor = 'var(--accent)', markedColor = 'var(--marked)', idleColor = 'var(--border)',
  draggable, onDragStart, onClick, onDoubleClick, title,
  onMediaLoad, placeholder, overlay, footer,
  className = 'hBd rvH', style, mediaStyle
}) {
  const border = marked ? markedColor : selected ? selectedColor : idleColor;
  return (
    <div onClick={onClick} onDoubleClick={onDoubleClick} draggable={draggable}
      onDragStart={onDragStart} title={title} className={className}
      style={{ ...sx('border-radius:10px;overflow:hidden;background:var(--surface);cursor:pointer'), border: '1.5px solid ' + border, ...(style || {}) }}>
      <div style={{ ...sx('position:relative;background:var(--sunk);display:flex;align-items:center;justify-content:center'), aspectRatio: aspect }}>
        {src
          ? <RenderMedia src={src} kind={kind} poster={poster} fit={fit} hoverPlay={hoverPlay}
              onLoad={onMediaLoad} style={{ ...sx('width:100%;height:100%'), ...(mediaStyle || {}) }} />
          : placeholder}
        {overlay}
      </div>
      {footer}
    </div>
  );
}

// Fullscreen viewer. Renders backdrop → header → media → actions → caption, each an optional slot,
// so a caller styles the frame it needs while the media branch stays shared. Clicking the backdrop
// closes; clicking the media does not (stopPropagation, matching every existing lightbox).
//
// Keyboard nav is OPT-IN (`keyboard`): a host that already runs its own capture-phase keymap (the
// generate console) keeps ownership and passes it off; a fresh host (chat, later) turns it on and
// gets Esc/←/→ for free. Drag-out is gated to images — the payload well never wants a video drag.
// ── DEV-132 ──
// Two changes, both HERE and therefore inherited by every surface that opens a viewer (compose,
// shot stage, gallery, moodboard): the media gets the whole viewport, and the chrome gets out of
// the way until you ask for it.
//
//   · CHROME IS IDLE-HIDDEN. The top bar, the action chips and the caption fade out after a beat of
//     no pointer movement and come back on the next move. They are absolutely positioned OVER the
//     media rather than laid out beside it, which is what lets the image fill the frame instead of
//     sharing it with three rows of furniture.
//   · ZOOM + PAN, images only. Wheel/pinch zooms toward the cursor, drag pans once zoomed past fit,
//     double-click toggles fit ⇄ 1:1 pixels. Video keeps its native controls untouched — a scroll
//     gesture over a <video> that also has a scrubber is a fight nobody wins.
//
// Zoom state resets whenever `src` changes, so ←/→ through a result set never inherits the previous
// image's magnification.
const ZOOM_MIN = 1, ZOOM_MAX = 8, IDLE_MS = 2000;

export class RenderLightbox extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      capOpen: false,      // caption: clamped one-liner ⇄ full text
      chrome: true,        // furniture visible — hidden after IDLE_MS of no pointer movement
      zoom: 1, x: 0, y: 0, // 1 = fit; x/y are pan offsets in px, applied before scale
      dragging: false
    };
    this._wrap = React.createRef();
    this._key = e => {
      if ((e.target.isContentEditable || (e.target.tagName || '').match(/INPUT|TEXTAREA|SELECT/i))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { onClose, onNav } = this.props;
      // Esc steps OUT of zoom first, then closes — otherwise the only way back to fit is a
      // double-click the user has no reason to know about.
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.state.zoom > 1) { this.resetZoom(); return; }
        onClose && onClose();
      } else if (e.key === 'ArrowRight') { e.preventDefault(); onNav && onNav(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onNav && onNav(-1); }
    };
    // Non-passive so preventDefault actually stops the page/trackpad from scrolling behind us.
    // React's onWheel is passive in modern React, so this is attached by hand.
    this._wheel = e => {
      if (mediaKind(this.props.src, this.props.kind) !== 'image') return;
      e.preventDefault();
      this.wake();
      const box = this._wrap.current && this._wrap.current.getBoundingClientRect();
      if (!box) return;
      // ctrlKey on a wheel event IS a trackpad pinch — same gesture, finer delta
      const factor = Math.exp(-(e.deltaY) * (e.ctrlKey ? 0.01 : 0.0022));
      this.zoomAt(e.clientX - box.left - box.width / 2, e.clientY - box.top - box.height / 2, factor);
    };
  }
  componentDidMount() {
    if (this.props.keyboard) window.addEventListener('keydown', this._key, true);
    if (this._wrap.current) this._wrap.current.addEventListener('wheel', this._wheel, { passive: false });
    this.wake();
  }
  componentDidUpdate(prev) {
    // a new image is a new frame — never inherit the last one's zoom/pan
    if (prev.src !== this.props.src) this.resetZoom();
  }
  componentWillUnmount() {
    if (this.props.keyboard) window.removeEventListener('keydown', this._key, true);
    if (this._wrap.current) this._wrap.current.removeEventListener('wheel', this._wheel);
    clearTimeout(this._idle);
  }

  resetZoom() { this.setState({ zoom: 1, x: 0, y: 0, dragging: false }); }

  // Zoom about a point (cx, cy given relative to the frame centre) so the pixel under the cursor
  // stays under the cursor — the difference between "zoom" and "zoom that feels broken".
  zoomAt(cx, cy, factor) {
    this.setState(s => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s.zoom * factor));
      if (z === s.zoom) return null;
      const k = z / s.zoom;
      // translate is applied before scale, so the offset correction is in pre-scale units
      return z === ZOOM_MIN
        ? { zoom: 1, x: 0, y: 0 }   // snapping back to fit always re-centres
        : { zoom: z, x: cx - (cx - s.x) * k, y: cy - (cy - s.y) * k };
    });
  }

  // Fit ⇄ 1:1. "100%" is the image's natural pixels over its rendered pixels, so it is a real
  // pixel-peep rather than an arbitrary multiplier.
  toggleActual(e) {
    if (mediaKind(this.props.src, this.props.kind) !== 'image') return;
    if (this.state.zoom > 1) return this.resetZoom();
    // RenderMedia is a function component (no ref forwarding), so reach the <img> through the frame.
    // The element BOX is the whole frame (width/height 100%); the painted picture is letterboxed
    // inside it by object-fit:contain, so 1:1 must be measured against the painted width, not
    // clientWidth — otherwise a wide image in a tall frame reports a far too small zoom target.
    const img = this._wrap.current && this._wrap.current.querySelector('img');
    const nat = img && img.naturalWidth;
    const painted = img && nat && img.naturalHeight
      ? Math.min(img.clientWidth, img.clientHeight * (nat / img.naturalHeight))
      : 0;
    const target = nat && painted ? Math.min(ZOOM_MAX, Math.max(1.01, nat / painted)) : 2;
    const box = this._wrap.current && this._wrap.current.getBoundingClientRect();
    const cx = box ? e.clientX - box.left - box.width / 2 : 0;
    const cy = box ? e.clientY - box.top - box.height / 2 : 0;
    this.zoomAt(cx, cy, target);
  }

  // Any pointer movement un-hides the chrome and restarts the idle countdown.
  //
  // …unless the chrome is HELD. ProjectGenerate mounts the whole composer inside this viewer as
  // `children`, so a blind idle-fade would make the prompt field disappear mid-sentence. The hold
  // is set while the pointer is over the chrome layer, and focus inside the viewer pins it open
  // regardless of the pointer — you can be typing without moving the mouse at all.
  chromeHeld() {
    if (this._hold) return true;
    const a = document.activeElement;
    return !!(a && this._chrome && this._chrome.contains(a));
  }
  wake() {
    clearTimeout(this._idle);
    if (!this.state.chrome) this.setState({ chrome: true });
    this._idle = setTimeout(() => {
      if (this.chromeHeld()) return this.wake();   // re-arm rather than hide out from under them
      this.setState({ chrome: false });
    }, IDLE_MS);
  }
  render() {
    const {
      src, kind, poster, onClose, header, actions, caption, children, title, meta = [],
      controls = true, autoPlay = true, muted = true, loop = true, fit = 'contain',
      draggable, onDragStart, onMediaLoad, mediaStyle, backdropStyle
    } = this.props;
    const k = mediaKind(src, kind);
    // ── standardized chrome ── every "open an image" in the app reads the same: a top strip
    // (title left · meta · ✕ Esc right), the media, one MediaAction row, and the prompt as a
    // CLAMPED one-liner that expands on click. Callers pass title/meta/caption-as-string and
    // get this for free; the raw header/actions/caption slots remain only for surfaces that
    // legitimately are not a viewer (none should hand-roll a second look — that is the exact
    // "different app per surface" drift this bar exists to end).
    const k2 = k; // (kept for readability below — the media branch decides what can zoom)
    const zoomable = k2 === 'image';
    const { chrome, zoom, x, y, dragging } = this.state;
    // one fade rule for every piece of furniture, so the chrome moves as a single layer
    const fade = {
      opacity: chrome ? 1 : 0,
      transform: chrome ? 'none' : 'translateY(-6px)',
      transition: 'opacity .22s ease, transform .22s ease',
      pointerEvents: chrome ? 'auto' : 'none'
    };
    const bar = (title || meta.length) ? (
      <div onClick={e => e.stopPropagation()}
        style={{ ...sx('position:absolute;top:0;left:0;right:0;z-index:3;display:flex;align-items:center;gap:14px;padding:13px 18px'), background: 'linear-gradient(180deg, color-mix(in srgb, var(--void) 88%, transparent), transparent)', ...fade }}>
        {title ? <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>{title}</span> : null}
        {meta.filter(Boolean).map((m, i) => (
          <span key={i} style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>{m}</span>
        ))}
        {/* the live zoom readout doubles as the "you are zoomed" cue and a click-to-reset */}
        {zoom > 1 && (
          <span onClick={() => this.resetZoom()} className="hFg" title="Reset to fit (Esc)"
            style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--accent)' }}>
            {Math.round(zoom * 100)}% · reset
          </span>
        )}
        <span onClick={onClose} className="hFg" style={{ ...sx('cursor:pointer'), marginLeft: zoom > 1 ? 14 : 'auto', fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-faint)' }}>✕ Esc</span>
      </div>
    ) : header;
    // a string caption gets the standard treatment: one dim clamped line, click to read whole
    const cap = typeof caption === 'string' && caption
      ? (
        <div onClick={e => { e.stopPropagation(); this.setState(s => ({ capOpen: !s.capOpen })); }}
          title={this.state.capOpen ? 'Collapse' : 'Show full prompt'}
          style={{
            ...sx('max-width:min(860px,90vw);text-align:center;cursor:pointer;line-height:1.6'),
            ...(this.state.capOpen ? sx('max-height:26vh;overflow-y:auto') : sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')),
            fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)',
          }}>{caption}</div>
      )
      : caption;
    return (
      <div onClick={onClose}
        onMouseMove={() => this.wake()}
        style={{
          ...sx('position:fixed;inset:0;z-index:120;overflow:hidden'),
          // backdrop derives from the palette's deepest recess, not a stray gray-blue literal —
          // every neutral is tinted toward the accent hue (DESIGN.md)
          background: 'color-mix(in srgb, var(--void) 94%, transparent)',
          cursor: chrome ? 'default' : 'none',   // idle = get out of the way completely
          ...(backdropStyle || {})
        }}>
        {bar}
        {/* THE FRAME. Absolute-fills the backdrop instead of being a flex row that shares height
            with the action chips and the caption — that sharing is why the image used to read as
            "small". At fit the media is now bounded only by this box, i.e. the whole viewport
            minus a hair of padding. */}
        <div ref={this._wrap}
          style={{ ...sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:12px'), touchAction: 'none' }}
          onMouseDown={e => {
            if (!zoomable || zoom <= 1 || e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const sx0 = e.clientX, sy0 = e.clientY, ox = x, oy = y;
            this.setState({ dragging: true });
            const move = ev => this.setState({ x: ox + (ev.clientX - sx0), y: oy + (ev.clientY - sy0) });
            const up = () => {
              this.setState({ dragging: false });
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }}>
          <div
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => { e.stopPropagation(); this.toggleActual(e); }}
            style={{
              // width/height 100%, NOT max-*: as a shrink-to-fit flex box this collapsed to the
              // image's natural size, and the image's own `width:100%` then resolved back against
              // that collapsed box — circular, so the media never actually filled the frame.
              ...sx('display:flex;align-items:center;justify-content:center;width:100%;height:100%'),
              transform: 'translate(' + x + 'px,' + y + 'px) scale(' + zoom + ')',
              // no transition while dragging — a lagging image under the cursor feels broken
              transition: dragging ? 'none' : 'transform .12s ease-out',
              cursor: !zoomable ? 'default' : dragging ? 'grabbing' : zoom > 1 ? 'grab' : 'zoom-in',
              willChange: 'transform'
            }}>
            <RenderMedia src={src} kind={kind} poster={poster} fit={fit} hoverPlay={false}
              controls={controls} autoPlay={autoPlay} muted={muted} loop={loop}
              draggable={k === 'image' ? draggable : undefined}
              onDragStart={k === 'image' ? onDragStart : undefined}
              onLoad={k === 'image' ? onMediaLoad : undefined}
              onClick={e => e.stopPropagation()}
              // width/height 100% + object-fit:contain (not max-width) so the media fills the frame
              // in BOTH directions — a 1024px still used to sit at ~58% of a 1770px viewport because
              // max-width caps but never scales up, which is the "image is small" in the report.
              // Aspect is preserved by object-fit; the painted rect is recomputed in paintedBox().
              style={{ ...sx('width:100%;height:100%;display:block'), ...(mediaStyle || {}) }} />
          </div>
        </div>
        {/* actions + caption ride at the bottom, over the media, and fade with the rest */}
        {(actions || cap || children) && (
          <div onClick={e => e.stopPropagation()}
            ref={el => { this._chrome = el; }}
            onMouseEnter={() => { this._hold = true; this.wake(); }}
            onMouseLeave={() => { this._hold = false; this.wake(); }}
            style={{
              ...sx('position:absolute;left:0;right:0;bottom:0;z-index:3;display:flex;flex-direction:column;align-items:center;gap:12px;padding:18px 24px 22px'),
              background: 'linear-gradient(0deg, color-mix(in srgb, var(--void) 88%, transparent), transparent)',
              ...fade
            }}>
            {actions}
            {cap}
            {children}
          </div>
        )}
      </div>
    );
  }
}

export default RenderMedia;
