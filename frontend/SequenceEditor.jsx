// DEV-133 — the shot list's UI. Mounted by Composer.jsx in place of the prompt field.
//
// WHAT THIS IS FOR. Not "set the model's duration" — the clock here is prompt text (see the header
// of frontend/sequence.js). This surface exists so a long segmented video prompt can be WRITTEN and,
// far more often, READ BACK: find the beat, see how long it runs against the ones either side of it,
// change the one line that is wrong, and leave the rest alone.
//
// ── THE RULE THAT KEEPS IT USABLE ───────────────────────────────────────────────────────────────
// Opening a shot shows ONE big field — what happens — plus its label, the camera wording, and a row
// of chips. Everything else stays folded until you click the chip for it, and opening one chip
// closes the last.
//
// An earlier version showed action, angle thumbnails, camera options, camera wording, sound,
// dialogue and the cut all at once, and it was a wall: eight stacked blocks for one shot. Every one
// of those fields is useful; all of them at once is not. The chips carry what is CURRENTLY SET, so
// the shot reads at a glance and you only open the part you actually want to change — and the
// collapsed row carries the same summary, so you can read the whole sequence without opening
// anything.
//
// Two more things carry the design:
//
//   THE STRIP IS A STORYBOARD. Proportional blocks wearing their angle plates, so relative length is
//   something you SEE rather than a number you compare. Drag a boundary to trade time between two
//   neighbours — a roll edit, so the total does not move under the cursor.
//
//   NO NATIVE RANGE INPUTS. `<input type="range">` renders as the platform's blue, which is not a
//   colour in this app's palette, and it cannot show frames and seconds at once. `Dial` below is
//   drag-to-scrub with three other ways in — see its own header.
//
// WHAT IT DELIBERATELY DOES NOT HAVE: any style, look, film stock, grade, lens or light control. The
// composer's ✦ picker owns all of that for the whole clip and composes it in at generate time.
// Repeating it per shot would be a second source of truth AND a fiction — nobody changes stock
// between two shots of the same scene.
//
// Presentational and controlled, exactly like Composer itself: it owns no fetching, no submit path,
// and every change goes out through `onChange(scene)`.
import React, { useRef, useState } from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { rateOf, fpsOf, framesFor, secs } from '../shared/timecode.mjs';
import { CAMERA_MOVEMENTS } from './cameraMovements';
import {
  ANGLES, angleToken, moveById, QUICK_ANGLES, QUICK_MOVES, CUT_OPTIONS, composeLens, lensOf,
  blankShot, spreadFrames, totalFrames, marks, stamp, setFrames, roll, fitTo, reorder, removeShot,
  minFrames, maxFrames, wordsIn, wordBudget, comfortableBudget, advisories, nearestChoice
} from './sequence';

const EYEBROW = { fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em', color: 'var(--fg-faint)' };
const NUM = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const f = flat(s); return f.length > n ? f.slice(0, n - 1) + '…' : f; };

// ── Dial ────────────────────────────────────────────────────────────────────────────────────────
// The duration control. This is the tool: everything else exists so that changing a shot's length is
// free, because every downstream timecode and the shot/cut counts written into FORMAT follow from
// this one number.
//
// FOUR ways to set it, because drag alone is not enough — it is imprecise, and it fails on touch and
// for keyboard users:
//   · DRAG sideways to scrub. Hold shift for frame-by-frame.
//   · CLICK without dragging to type an exact value in seconds.
//   · ▲ ▼ step one frame.
//   · Arrow keys step a quarter second; shift-arrow steps one frame.
//
// Two details are load-bearing and easy to undo by accident:
//
//   THE NUMBER IS A SPAN, NOT AN INPUT. Pointer-down on a text input places a caret and starts a
//   selection, so grabbing the digits — the obvious thing to grab — would never scrub. The input
//   only appears once you have clicked without dragging.
//
//   THE DRAG TAKES POINTER CAPTURE. Without it the browser can hand the pointer stream to whatever
//   is underneath mid-gesture, so one drag gets read by this dial AND by the strip's boundary
//   handler — a shot snapping to its floor while its neighbour balloons.
//
// SENSITIVITY IS 4px PER FRAME. At 1px/frame a casual 40px flick moved a shot by 1.7 seconds, which
// felt broken even when it was working correctly. Shift makes it FINER at 14px/frame — a precision
// modifier, not a turbo.
const PX_PER_FRAME = 4;
const PX_PER_FRAME_FINE = 14;
const CLICK_SLOP = 3;      // under this much travel the gesture was a click, not a drag

function Dial({ frames, min, max, fps, rate, fillPct = 100, locked, onChange }) {
  const [drag, setDrag] = useState(false);
  const [draft, setDraft] = useState(null);
  const from = useRef({ x: 0, v: 0, moved: 0 });
  const clamp = n => Math.max(min, Math.min(max, Math.round(n)));
  const step = Math.max(1, Math.round(fps / 4));

  const down = e => {
    if (locked || draft !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    from.current = { x: e.clientX, v: frames, moved: 0 };
    setDrag(true);
  };
  const move = e => {
    if (!drag) return;
    e.preventDefault(); e.stopPropagation();
    const dx = e.clientX - from.current.x;
    from.current.moved = Math.max(from.current.moved, Math.abs(dx));
    // absolute from the grab point, never incremental, so a dropped event cannot compound into drift
    const next = clamp(from.current.v + dx / (e.shiftKey ? PX_PER_FRAME_FINE : PX_PER_FRAME));
    if (next !== frames) onChange(next);
  };
  const up = e => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(false);
    // it was a click, not a drag: hand over to the typed path. The draft seeds with the CURRENT
    // value so you can see what you are replacing, and the input selects itself on focus so typing
    // REPLACES rather than appends — without that, clicking a 4.0s dial and typing "2.4" gives
    // "4.02.4", which is the kind of bug that makes a control feel broken.
    if (from.current.moved <= CLICK_SLOP && !locked) setDraft(stamp(frames, rate));
  };
  const commit = () => {
    const n = parseFloat(String(draft).replace(',', '.'));
    if (Number.isFinite(n) && n > 0) onChange(clamp(n * fps));
    setDraft(null);
  };
  const key = e => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    onChange(clamp(frames + d * (e.shiftKey ? 1 : step)));
  };

  return (
    <div style={sx('flex:none;display:flex;align-items:stretch;gap:3px')}>
      <div
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onKeyDown={key} tabIndex={locked ? -1 : 0} role="slider"
        aria-valuenow={Number(stamp(frames, rate))} aria-label="Shot duration in seconds"
        title={locked ? 'Locked — unlock to change' : 'Drag to scrub · shift for frame-by-frame · click to type · ↑↓ to step'}
        className="hBd"
        style={{
          ...sx('position:relative;overflow:hidden;border-radius:7px;padding:4px 8px;user-select:none;touch-action:none'),
          width: 78, textAlign: 'right', cursor: locked ? 'default' : 'ew-resize',
          background: drag ? 'var(--accent-12)' : 'var(--sunk)',
          border: '1px solid ' + (drag ? 'var(--accent-60)' : 'var(--border-2)'),
          opacity: locked ? .65 : 1
        }}>
        {/* the fill IS the track — no separate rail, so the control is one object rather than two.
            It reads against the LONGEST shot, so the row of dials is itself a bar chart of pacing. */}
        <div style={{
          ...sx('position:absolute;left:0;top:0;bottom:0;pointer-events:none'),
          width: Math.max(0, Math.min(100, fillPct)).toFixed(1) + '%',
          background: drag ? 'var(--accent-35)' : 'var(--accent-05)'
        }} />
        {draft !== null ? (
          <input autoFocus value={draft} onFocus={e => e.target.select()}
            onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(null); }}
            aria-label="Duration in seconds"
            style={{ ...NUM, ...sx('position:relative;width:100%;background:transparent;border:0;outline:none;padding:0;text-align:right'), fontSize: 10.5, color: 'var(--fg)' }} />
        ) : (
          <span style={{ ...NUM, position: 'relative', display: 'block', fontSize: 10.5, color: drag ? 'var(--fg)' : 'var(--fg-soft)', lineHeight: '13px' }}>{stamp(frames, rate)}s</span>
        )}
        <span style={{ ...NUM, position: 'relative', display: 'block', fontSize: 8, color: 'var(--fg-faint)', lineHeight: '10px' }}>{frames}f</span>
      </div>
      {/* the steppers. Small, but they are the whole accessibility and touch story for this control. */}
      <div style={sx('display:flex;flex-direction:column;gap:1px')}>
        {[['▲', 1], ['▼', -1]].map(([glyph, d]) => (
          <span key={glyph} onClick={() => !locked && onChange(clamp(frames + d))} className="hFg"
            title={(d > 0 ? 'One frame longer' : 'One frame shorter') + ' (' + (1 / fps).toFixed(2) + 's)'}
            style={{
              ...sx('flex:1;display:flex;align-items:center;justify-content:center;border-radius:3px;padding:0 3px;cursor:pointer;user-select:none'),
              fontFamily: MONO, fontSize: 6.5, color: 'var(--fg-faint)', border: '1px solid var(--border-2)'
            }}>{glyph}</span>
        ))}
      </div>
    </div>
  );
}

// The angle plate, at whatever size the caller needs. One helper so the strip, the collapsed row and
// the picker cannot drift into three treatments of the same twelve images.
function Plate({ angle, w, h, dim = false }) {
  const tok = angleToken(angle);
  if (tok && tok.img) {
    return <img src={tok.img} alt="" loading="lazy"
      style={{ ...sx('object-fit:cover;border-radius:4px;display:block;flex:none'), width: w, height: h, opacity: dim ? .55 : 1 }} />;
  }
  return <span style={{ ...sx('flex:none;border-radius:4px;background:var(--sunk);border:1px dashed var(--border-2)'), width: w, height: h }} />;
}

// ── the strip ───────────────────────────────────────────────────────────────────────────────────
function Strip({ segments, rate, focus, onFocus, onRoll }) {
  const box = useRef(null);
  const grab = useRef(null);
  const total = totalFrames(segments) || 1;
  const at = marks(segments);
  const [live, setLive] = useState(-1);

  const down = (i, e) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const w = box.current ? box.current.getBoundingClientRect().width : 1;
    grab.current = { i, x: e.clientX, perPx: total / Math.max(1, w) };
    setLive(i);
  };
  const move = e => {
    if (!grab.current) return;
    const { i, x, perPx } = grab.current;
    const d = Math.round((e.clientX - x) * perPx);
    if (d) { onRoll(i, d); grab.current.x = e.clientX; }
  };
  const up = e => {
    grab.current = null; setLive(-1);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div ref={box} style={sx('position:relative;height:46px;width:100%;margin-bottom:4px')}>
      {segments.map((s, i) => {
        const on = i === focus;
        const tok = angleToken(s.angle);
        return (
          <div key={i} onClick={() => onFocus(i)}
            title={(s.angle || 'no angle yet') + ' · ' + stamp(s.frames, rate) + 's'}
            style={{
              ...sx('position:absolute;top:0;bottom:0;overflow:hidden;cursor:pointer;border-radius:5px'),
              left: ((at[i].from / total) * 100) + '%', width: 'calc(' + ((s.frames / total) * 100) + '% - 3px)',
              border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-2)'),
              background: on ? 'var(--accent-12)' : 'var(--raise)'
            }}>
            {tok && tok.img && (
              <img src={tok.img} alt="" loading="lazy"
                style={{ ...sx('position:absolute;inset:0;width:100%;height:100%;object-fit:cover'), opacity: on ? .5 : .32 }} />
            )}
            <div style={{
              ...sx('position:absolute;inset:0;padding:3px 5px;display:flex;flex-direction:column;justify-content:space-between'),
              background: 'linear-gradient(180deg,rgba(10,11,14,.55),rgba(10,11,14,.8))'
            }}>
              <span style={{ ...NUM, fontSize: 8.5, color: on ? 'var(--accent)' : 'var(--fg-muted)', lineHeight: '10px' }}>{i + 1}</span>
              <span style={{
                ...sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis'),
                fontFamily: MONO, fontSize: 8, letterSpacing: '.06em',
                color: on ? 'var(--fg)' : 'var(--fg-muted)', lineHeight: '10px'
              }}>{(s.label || s.angle || '').toUpperCase() || stamp(s.frames, rate) + 'S'}</span>
            </div>
          </div>
        );
      })}
      {segments.slice(0, -1).map((_, i) => (
        <div key={'h' + i} onPointerDown={e => down(i, e)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          title="Drag to move the cut — the two shots either side trade time"
          style={{
            ...sx('position:absolute;top:-2px;bottom:-2px;width:11px;cursor:col-resize;touch-action:none;z-index:2'),
            left: 'calc(' + ((at[i].to / total) * 100) + '% - 7px)'
          }}>
          <div style={{
            ...sx('position:absolute;left:4px;top:0;bottom:0;width:3px;border-radius:2px'),
            background: live === i ? 'var(--accent)' : 'transparent'
          }} />
        </div>
      ))}
    </div>
  );
}

// One chip in the open shot's row. It is a summary AND a door: the value it shows is what is
// currently set, so the shot reads without opening any of them.
function Chip({ label, value, set, active, onClick }) {
  return (
    <span onClick={onClick} className={active ? '' : 'hBd'}
      style={{
        ...sx('display:inline-flex;align-items:baseline;gap:6px;border-radius:6px;padding:3px 9px;cursor:pointer;max-width:230px'),
        border: '1px solid ' + (active ? 'var(--accent)' : set ? 'var(--border-3)' : 'var(--border-2)'),
        background: active ? 'var(--accent-05)' : 'transparent'
      }}>
      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '.1em', color: active ? 'var(--accent)' : 'var(--fg-faint)', flex: 'none' }}>{label}</span>
      <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontSize: 10, color: set ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>
        {set ? value : '—'}
      </span>
    </span>
  );
}

// ── the editor ──────────────────────────────────────────────────────────────────────────────────
export default function SequenceEditor({ scene, onChange, onExit, rate, durationChoices = [] }) {
  const r = rateOf(rate);
  const fps = fpsOf(r);
  const min = minFrames(r);
  const max = maxFrames(r);
  const [focus, setFocus] = useState(0);
  const [panel, setPanel] = useState(null);          // which chip is open on the focused shot
  const [allAngles, setAllAngles] = useState(false);
  const [allMoves, setAllMoves] = useState(false);

  const segs = scene.segments || [];
  const total = totalFrames(segs);
  const at = marks(segs);
  const notes = advisories(scene, r);
  const legal = nearestChoice(durationChoices, secs(total, r));
  const longest = segs.reduce((a, s) => Math.max(a, s.frames), 1);

  const set = patch => onChange({ ...scene, ...patch });
  const setSeg = (i, patch) => set({ segments: segs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const open = (i, p) => { setFocus(i); setPanel(cur => (cur === p ? null : p)); };

  // Picking an angle or a move REWRITES the camera wording — unless the user has taken it over.
  const pickCamera = (i, patch) => {
    const s = segs[i];
    const next = { ...patch };
    if (!s.lensEdited) next.lens = composeLens(patch.angle !== undefined ? patch.angle : s.angle, patch.move !== undefined ? patch.move : s.move);
    setSeg(i, next);
  };

  const link = (label, onClick) => (
    <span onClick={onClick} className="hAccent"
      style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 8.5, color: 'var(--accent)' }}>{label}</span>
  );
  const mini = t => <div style={{ ...EYEBROW, marginBottom: 4 }}>{t}</div>;

  return (
    <div style={sx('margin-bottom:11px')}>
      {/* ── one line at the top: what the scene is ──────────────────────────────────────────── */}
      <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:7px')}>
        <span style={{ ...EYEBROW, flex: 'none' }}>SHOT LIST</span>
        <input value={scene.context || ''} onChange={e => set({ context: e.target.value })} onKeyDown={e => e.stopPropagation()}
          placeholder="What happens in this scene? One line."
          style={sx('flex:1;min-width:0;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);font-size:12px;padding:6px 10px')} />
        <span onClick={onExit} className="hFg"
          style={{ ...sx('flex:none;cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>exit</span>
      </div>

      <Strip segments={segs} rate={r} focus={focus} onFocus={i => { setFocus(i); setPanel(null); }}
        onRoll={(i, d) => set({ segments: roll(segs, i, d, r) })} />

      <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:9px')}>
        <span style={{ ...NUM, fontSize: 9, color: 'var(--fg-muted)' }}>{stamp(total, r)}s</span>
        <span style={{ ...NUM, fontSize: 9, color: 'var(--fg-faint)' }}>{total}f</span>
        {legal != null && Math.abs(legal - secs(total, r)) > 0.05 && (
          <span onClick={() => set({ segments: fitTo(segs, framesFor(legal, r), r) })} className="hAccent"
            title={'This model renders ' + legal + 's. Scale every unlocked shot to fit.'}
            style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--warn)' }}>⤢ fit to {legal}s</span>
        )}
        <span style={sx('flex:1')} />
        {[['dialogue', 'SPEAKING', 'Someone talks — adds a line and a speaker per shot, with the words-that-fit count'],
        ['hasActing', 'ACTING', 'The performance is the point — adds two plain questions, and a per-shot performance note']].map(([key, label, tip]) => (
          <span key={key} onClick={() => set({ [key]: !scene[key] })} title={tip} className={scene[key] ? '' : 'hBd'}
            style={{
              ...sx('border-radius:6px;padding:2px 8px;cursor:pointer'), fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em',
              color: scene[key] ? 'var(--accent)' : 'var(--fg-faint)',
              border: '1px solid ' + (scene[key] ? 'var(--accent-35)' : 'var(--border-2)'),
              background: scene[key] ? 'var(--accent-05)' : 'transparent'
            }}>{scene[key] ? '● ' : '○ '}{label}</span>
        ))}
      </div>

      {/* ── acting: two questions, in plain words ───────────────────────────────────────────── */}
      {scene.hasActing && (
        <div style={sx('border-left:1px solid var(--accent-35);padding-left:9px;margin-bottom:9px')}>
          {[['event', 'What is really going on that nobody says out loud?', 'e.g. they both know he is leaving tomorrow'],
          ['acting', 'Who wants what, and what is stopping them?', 'e.g. she wants him to stay and keeps it light. He wants to get out without saying it.']].map(([key, q, ph]) => (
            <div key={key} style={sx('margin-bottom:5px')}>
              <div style={sx('font-size:10px;color:var(--fg-muted);margin-bottom:3px')}>{q}</div>
              <textarea value={scene[key] || ''} onChange={e => set({ [key]: e.target.value })} onKeyDown={e => e.stopPropagation()}
                rows={2} placeholder={ph}
                style={sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);font-size:11.5px;line-height:1.5;padding:6px 9px')} />
            </div>
          ))}
        </div>
      )}

      {/* ── the shots ───────────────────────────────────────────────────────────────────────── */}
      {segs.map((s, i) => {
        const on = i === focus;
        const isLast = i === segs.length - 1;
        const lens = lensOf(s);
        const mv = moveById(s.move);
        const sfxCount = Math.min((String(s.sfx || '').match(/</g) || []).length, (String(s.sfx || '').match(/>/g) || []).length)
          || (String(s.sfx || '').trim() ? String(s.sfx).split(',').filter(x => x.trim()).length : 0);
        const words = wordsIn(s.line);
        const ceiling = wordBudget(s.frames, r);
        const comfy = comfortableBudget(s.frames, r);
        const mine = notes.filter(n => n.shot === i);
        const worst = mine.some(n => n.tone === 'danger') ? 'danger' : mine.length ? 'warn' : null;

        // the summary line — what is set on this shot, readable WITHOUT opening it
        const meta = [
          s.angle, mv && mv.name,
          sfxCount ? sfxCount + ' sfx' : null,
          scene.dialogue && s.line ? 'dialogue' : null,
          scene.hasActing && s.face ? 'performance' : null,
          !isLast && s.cutAfter ? flat(s.cutAfter).replace(/\.$/, '') : null
        ].filter(Boolean).join('  ·  ');

        return (
          <div key={i} style={{
            ...sx('border-radius:8px;margin-bottom:4px;overflow:hidden'),
            border: '1px solid ' + (on ? 'var(--border-3)' : 'transparent'),
            background: on ? 'var(--surface-2)' : 'transparent',
            boxShadow: worst ? 'inset 2px 0 0 var(--' + worst + ')' : 'none'
          }}>
            <div style={sx('display:flex;align-items:center;gap:8px;padding:5px 6px')}>
              <span onClick={() => { setFocus(on ? -1 : i); setPanel(null); }} className="hFg"
                style={{ ...sx('flex:1;min-width:0;display:flex;align-items:center;gap:8px;cursor:pointer') }}>
                <span style={{ ...NUM, ...sx('flex:none;width:14px;text-align:right'), fontSize: 9, color: on ? 'var(--accent)' : 'var(--fg-faint)' }}>{i + 1}</span>
                <Plate angle={s.angle} w={38} h={24} dim={!on} />
                <span style={{ ...NUM, ...sx('flex:none;width:32px'), fontSize: 8.5, color: 'var(--fg-faint)' }}>{stamp(at[i].from, r)}s</span>
                <span style={sx('flex:1;min-width:0;overflow:hidden')}>
                  <span style={{ ...sx('display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontSize: 11, color: s.action ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>
                    {s.label && <b style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.06em', color: 'var(--fg-muted)', fontWeight: 600 }}>{s.label.toUpperCase()} </b>}
                    {flat(s.action) || (s.angle ? '' : 'click to describe this shot')}
                  </span>
                  {meta && (
                    <span style={{ ...sx('display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 8, letterSpacing: '.06em', color: 'var(--fg-faint)' }}>{meta}</span>
                  )}
                </span>
              </span>
              <Dial frames={s.frames} min={min} max={max} fps={fps} rate={r} locked={s.locked}
                fillPct={(s.frames / longest) * 100}
                onChange={v => set({ segments: setFrames(segs, i, v, r) })} />
              <span onClick={() => setSeg(i, { locked: !s.locked })} className="hFg"
                title={s.locked ? 'Locked — a fit leaves this shot alone' : 'Lock this length against a fit'}
                style={{ ...sx('flex:none;cursor:pointer;width:12px'), fontFamily: MONO, fontSize: 10, color: s.locked ? 'var(--accent)' : 'var(--fg-faint)' }}>{s.locked ? '▣' : '▢'}</span>
              {segs.length > 1 && (
                <span onClick={() => { set({ segments: removeShot(segs, i) }); setFocus(Math.max(0, i - 1)); setPanel(null); }}
                  className="hFgL" title="Remove this shot"
                  style={{ ...sx('flex:none;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>✕</span>
              )}
            </div>

            {on && (
              <div style={sx('padding:2px 8px 9px 26px')}>
                {/* ONE big field, plus the label. Everything else is behind a chip. */}
                <div style={sx('display:flex;gap:8px;align-items:flex-start;margin-bottom:7px')}>
                  <div style={sx('flex:1;min-width:0')}>
                    {mini('WHAT HAPPENS')}
                    <textarea value={s.action} onChange={e => setSeg(i, { action: e.target.value })} onKeyDown={e => e.stopPropagation()}
                      rows={3} placeholder="Plain words — who does what, and what it does to them."
                      style={sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);font-size:11.5px;line-height:1.55;padding:7px 9px')} />
                  </div>
                  <div style={sx('flex:none;width:216px')}>
                    {mini('LABEL')}
                    <input value={s.label} onChange={e => setSeg(i, { label: e.target.value })} onKeyDown={e => e.stopPropagation()}
                      placeholder="e.g. HER, BIG CLOSE"
                      style={{ ...sx('width:100%;box-sizing:border-box;background:var(--sunk);border:1px solid var(--border-2);border-radius:6px;color:var(--fg);padding:5px 8px;margin-bottom:6px'), fontFamily: MONO, fontSize: 10, letterSpacing: '.06em' }} />
                    {/* the camera wording. DERIVED — it is shown so you can check it, not so you
                        have to fill it in. Labelling it as a field made people think it was a third
                        thing they owed the form. */}
                    <div style={sx('border:1px solid var(--border-2);border-radius:6px;padding:6px 8px;background:var(--sunk)')}>
                      <div style={{ fontSize: 10, lineHeight: 1.45, color: lens ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>
                        {lens || 'No camera wording yet — pick an angle and a move.'}
                      </div>
                      <div style={sx('display:flex;align-items:center;gap:8px;margin-top:5px')}>
                        <span style={{ fontFamily: MONO, fontSize: 7, letterSpacing: '.1em', color: s.lensEdited ? 'var(--accent)' : 'var(--fg-faint)' }}>
                          {s.lensEdited ? 'YOUR WORDING — PICKERS WON’T OVERWRITE' : 'WRITTEN FROM ANGLE + MOVE'}
                        </span>
                        <span style={sx('flex:1')} />
                        {link(panel === 'camera' ? 'done' : 'edit', () => open(i, 'camera'))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* the chips: a summary and a door in one */}
                <div style={sx('display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px')}>
                  <Chip label="CAMERA" set={!!(s.angle || s.move || lens)} active={panel === 'camera'}
                    value={[s.angle, mv && mv.name].filter(Boolean).join(' · ') || clip(lens, 34)}
                    onClick={() => open(i, 'camera')} />
                  <Chip label="SOUND" set={!!String(s.sfx || '').trim()} active={panel === 'sfx'}
                    value={sfxCount ? sfxCount + (sfxCount === 1 ? ' event' : ' events') : clip(s.sfx, 26)}
                    onClick={() => open(i, 'sfx')} />
                  {scene.dialogue && (
                    <Chip label="SAYS" set={!!String(s.line || '').trim()} active={panel === 'says'}
                      value={s.line ? '“' + clip(s.line, 24) + '”' : ''} onClick={() => open(i, 'says')} />
                  )}
                  {scene.hasActing && (
                    <Chip label="PERFORMANCE" set={!!String(s.face || '').trim()} active={panel === 'face'}
                      value={clip(s.face, 26)} onClick={() => open(i, 'face')} />
                  )}
                  {!isLast && (
                    <Chip label="CUT" set={!!s.cutAfter} active={panel === 'cut'}
                      value={flat(s.cutAfter).replace(/\.$/, '')} onClick={() => open(i, 'cut')} />
                  )}
                  <span style={sx('flex:1')} />
                  <span onClick={() => { set({ segments: reorder(segs, i, -1) }); setFocus(Math.max(0, i - 1)); }}
                    className="hFg" title="Move this shot earlier"
                    style={{ ...sx('cursor:pointer;padding:3px 6px'), fontFamily: MONO, fontSize: 8.5, color: i === 0 ? 'var(--border-3)' : 'var(--fg-faint)', pointerEvents: i === 0 ? 'none' : 'auto' }}>↑ earlier</span>
                  <span onClick={() => { set({ segments: reorder(segs, i, 1) }); setFocus(Math.min(segs.length - 1, i + 1)); }}
                    className="hFg" title="Move this shot later"
                    style={{ ...sx('cursor:pointer;padding:3px 6px'), fontFamily: MONO, fontSize: 8.5, color: isLast ? 'var(--border-3)' : 'var(--fg-faint)', pointerEvents: isLast ? 'none' : 'auto' }}>↓ later</span>
                </div>

                {/* exactly one panel, ever */}
                {panel === 'camera' && (
                  <div style={sx('border-left:1px solid var(--border-2);padding-left:9px;margin-bottom:4px')}>
                    {mini('SHOT SIZE / ANGLE')}
                    {/* picked collapses: one plate and a change link, not a grid left lying around */}
                    {s.angle ? (
                      <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:7px')}>
                        <Plate angle={s.angle} w={44} h={28} />
                        <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--accent)' }}>{s.angle.toUpperCase()}</span>
                        {link('change', () => pickCamera(i, { angle: null }))}
                      </div>
                    ) : (
                      <>
                        <div style={sx('display:flex;gap:5px;flex-wrap:wrap;margin-bottom:5px')}>
                          {(allAngles ? ANGLES() : ANGLES().filter(t => QUICK_ANGLES.includes(t.t))).map(t => (
                            <span key={t.t} onClick={() => pickCamera(i, { angle: t.t })} title={t.d || t.f} className="hBd"
                              style={{
                                ...sx('display:flex;flex-direction:column;gap:2px;border-radius:6px;padding:3px;cursor:pointer;width:58px'),
                                border: '1px solid var(--border-2)'
                              }}>
                              <Plate angle={t.t} w="100%" h={30} />
                              <span style={{ fontFamily: MONO, fontSize: 7, lineHeight: 1.25, color: 'var(--fg-muted)', textAlign: 'center' }}>{t.t}</span>
                            </span>
                          ))}
                        </div>
                        <div style={sx('display:flex;gap:12px;margin-bottom:7px')}>
                          {!allAngles && link('all ' + ANGLES().length + ' →', () => setAllAngles(true))}
                          {allAngles && link('← the usual six', () => setAllAngles(false))}
                        </div>
                      </>
                    )}

                    {mini('CAMERA MOVE')}
                    {/* moves get names, not pictures: a move is a verb, and the diagrams read as noise */}
                    {s.move ? (
                      <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:7px')}>
                        <span style={{ ...sx('border-radius:6px;padding:3px 9px'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg)', background: 'var(--raise)', border: '1px solid var(--border-3)', fontWeight: 700 }}>{mv ? mv.name : s.move}</span>
                        {link('change', () => pickCamera(i, { move: null }))}
                      </div>
                    ) : (
                      <>
                        <div style={sx('display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px')}>
                          {(allMoves ? CAMERA_MOVEMENTS : CAMERA_MOVEMENTS.filter(m => QUICK_MOVES.includes(m.id))).map(m => (
                            <span key={m.id} onClick={() => pickCamera(i, { move: m.id })} title={m.description} className="hBd"
                              style={{
                                ...sx('border-radius:6px;padding:3px 9px;cursor:pointer'), fontFamily: MONO, fontSize: 9.5,
                                color: 'var(--fg-muted)', border: '1px solid var(--border-2)'
                              }}>{m.name}</span>
                          ))}
                        </div>
                        <div style={sx('display:flex;gap:12px;margin-bottom:7px')}>
                          {!allMoves && link('all ' + CAMERA_MOVEMENTS.length + ' →', () => setAllMoves(true))}
                          {allMoves && link('← the usual seven', () => setAllMoves(false))}
                        </div>
                      </>
                    )}

                    {mini('WORDING')}
                    <textarea value={lens} onChange={e => setSeg(i, { lens: e.target.value, lensEdited: true })} onKeyDown={e => e.stopPropagation()}
                      rows={2} placeholder="Nothing here is fixed — type any framing the catalogue does not carry."
                      style={sx('width:100%;box-sizing:border-box;resize:vertical;background:transparent;border:1px solid var(--border-2);border-radius:6px;color:var(--fg-soft);font-size:10.5px;line-height:1.5;padding:6px 9px')} />
                    {s.lensEdited && (
                      <div style={sx('margin-top:4px')}>
                        {link('↺ rewrite from the pickers', () => setSeg(i, { lensEdited: false, lens: composeLens(s.angle, s.move) }))}
                      </div>
                    )}
                  </div>
                )}

                {panel === 'sfx' && (
                  <div style={sx('border-left:1px solid var(--border-2);padding-left:9px;margin-bottom:4px')}>
                    {mini('SOUND')}
                    <input value={s.sfx} onChange={e => setSeg(i, { sfx: e.target.value })} onKeyDown={e => e.stopPropagation()}
                      placeholder="what you hear, in order — wind, a door, footsteps on gravel"
                      style={sx('width:100%;box-sizing:border-box;background:transparent;border:1px solid var(--border-2);border-radius:6px;color:var(--fg-soft);font-size:11px;padding:6px 9px')} />
                    <div style={{ ...EYEBROW, marginTop: 4 }}>COMMA-SEPARATED · SHIPS AS &lt;ONE EVENT&gt; &lt;PER PAIR&gt;</div>
                  </div>
                )}

                {panel === 'says' && (
                  <div style={sx('border-left:1px solid var(--border-2);padding-left:9px;margin-bottom:4px')}>
                    {mini('SPOKEN LINE')}
                    <div style={sx('display:flex;align-items:center;gap:5px')}>
                      <input value={s.speaker} onChange={e => setSeg(i, { speaker: e.target.value })} onKeyDown={e => e.stopPropagation()}
                        placeholder="who" style={{ ...sx('flex:none;width:86px;background:transparent;border:1px solid var(--border-2);border-radius:6px;color:var(--fg-soft);padding:6px 8px'), fontFamily: MONO, fontSize: 9.5 }} />
                      <input value={s.line} onChange={e => setSeg(i, { line: e.target.value })} onKeyDown={e => e.stopPropagation()}
                        placeholder="the line, as spoken"
                        style={sx('flex:1;min-width:0;background:transparent;border:1px solid var(--border-2);border-radius:6px;color:var(--fg);font-size:11px;padding:6px 9px')} />
                    </div>
                    {/* the budget MOVES when the duration does, so it lives next to the line */}
                    <div style={{ ...EYEBROW, marginTop: 4, color: words > ceiling ? 'var(--danger)' : words > comfy ? 'var(--warn)' : 'var(--fg-faint)' }}>
                      {words}/{ceiling} WORDS · {comfy} SITS COMFORTABLY IN {stamp(s.frames, r)}S
                    </div>
                  </div>
                )}

                {panel === 'face' && (
                  <div style={sx('border-left:1px solid var(--border-2);padding-left:9px;margin-bottom:4px')}>
                    {mini('WHAT THE FACE IS DOING')}
                    <textarea value={s.face} onChange={e => setSeg(i, { face: e.target.value })} onKeyDown={e => e.stopPropagation()}
                      rows={2} placeholder="What they are DOING to the other person — not how they feel. The eyes are the doing."
                      style={sx('width:100%;box-sizing:border-box;resize:vertical;background:transparent;border:1px solid var(--border-2);border-radius:6px;color:var(--fg-soft);font-size:11px;line-height:1.5;padding:6px 9px')} />
                  </div>
                )}

                {panel === 'cut' && !isLast && (
                  <div style={sx('border-left:1px solid var(--border-2);padding-left:9px;margin-bottom:4px')}>
                    {mini('HOW THIS SHOT HANDS TO THE NEXT')}
                    <div style={sx('display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px')}>
                      {CUT_OPTIONS.map(c => (
                        <span key={c} onClick={() => setSeg(i, { cutAfter: c })} className={s.cutAfter === c ? '' : 'hBd'}
                          style={{
                            ...sx('border-radius:6px;padding:3px 9px;cursor:pointer'), fontFamily: MONO, fontSize: 9,
                            color: s.cutAfter === c ? 'var(--fg)' : 'var(--fg-muted)',
                            background: s.cutAfter === c ? 'var(--raise)' : 'transparent',
                            border: '1px solid ' + (s.cutAfter === c ? 'var(--border-3)' : 'var(--border-2)')
                          }}>{c.replace(/\.$/, '')}</span>
                      ))}
                    </div>
                    <input value={s.cutAfter} onChange={e => setSeg(i, { cutAfter: e.target.value })} onKeyDown={e => e.stopPropagation()}
                      placeholder="or write it — e.g. HARD CUT on the shoulder drop."
                      style={sx('width:100%;box-sizing:border-box;background:transparent;border:1px solid var(--border-2);border-radius:6px;color:var(--fg-soft);font-size:10.5px;padding:6px 9px')} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── add, and the advisories ─────────────────────────────────────────────────────────── */}
      <div style={sx('display:flex;align-items:center;gap:12px;margin:7px 0 2px')}>
        <span onClick={() => { set({ segments: [...segs.map((x, j) => (j === segs.length - 1 ? { ...x, cutAfter: x.cutAfter || CUT_OPTIONS[0] } : x)), blankShot(framesFor(2, r))].map((x, j, a) => (j === a.length - 1 ? { ...x, cutAfter: '' } : x)) }); setFocus(segs.length); setPanel(null); }}
          className="hAccent" style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--accent)' }}>＋ SHOT</span>
        <span onClick={() => set({ segments: spreadFrames(segs.length, total, r).map((n, j) => ({ ...segs[j], frames: n.frames })) })}
          className="hFg" title="Give every shot the same length inside the same total"
          style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>⇹ EVEN</span>
        <span style={{ ...NUM, fontSize: 9, color: 'var(--fg-faint)' }}>
          {segs.length} shot{segs.length === 1 ? '' : 's'} · {Math.max(0, segs.length - 1)} cut{segs.length === 2 ? '' : 's'} · {stamp(total, r)}s
        </span>
      </div>
      {/* advisory, never a block. Each one says what goes wrong and what to do instead. */}
      {notes.map((n, k) => (
        <div key={k} onClick={() => n.shot != null && (setFocus(n.shot), setPanel(null))}
          style={{
            ...sx('margin-top:3px'), fontFamily: MONO, fontSize: 8.5, lineHeight: '13px',
            color: n.tone === 'danger' ? 'var(--danger)' : 'var(--warn)',
            cursor: n.shot != null ? 'pointer' : 'default'
          }}>{n.text}</div>
      ))}
    </div>
  );
}
