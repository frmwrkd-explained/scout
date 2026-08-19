// A scrubbable track. Pointer-capture based, so a drag that leaves the element keeps tracking —
// the thing every hand-rolled mousedown/mousemove scrubber in this app gets wrong.
//
// Two-callback contract, copied from PanelSplitter.jsx:38-58: `onSeek` fires live during the drag
// (cheap — move a playhead), `onCommit` fires once on pointerup (expensive — persist, resume
// playback). Callers that only need one can pass only onSeek.
//
// Exported rather than inlined so ThreeDStage.jsx's lane and App.jsx's transport rail can migrate
// onto it: three scrubbers become one. Adds what those lack — real slider semantics and arrow keys.
import React from 'react';
import { sx } from './sx';

export default class Scrub extends React.Component {
  constructor(p) {
    super(p);
    this.ref = React.createRef();
    this.state = { dragging: false };
  }

  frac(e) {
    const el = this.ref.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return 0;
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  valueAt(e) {
    const { max } = this.props;
    return Math.round(this.frac(e) * (max || 0));
  }

  down = e => {
    if (e.button != null && e.button !== 0) return;   // left button only
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    this.setState({ dragging: true });
    this.props.onSeek?.(this.valueAt(e));
  };

  move = e => {
    if (!this.state.dragging) return;
    this.props.onSeek?.(this.valueAt(e));
  };

  up = e => {
    if (!this.state.dragging) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    this.setState({ dragging: false });
    const v = this.valueAt(e);
    this.props.onSeek?.(v);
    this.props.onCommit?.(v);
  };

  key = e => {
    const { max, value, step = 1, bigStep } = this.props;
    const big = bigStep || Math.max(1, Math.round((max || 0) / 20));
    let v = null;
    if (e.key === 'ArrowRight') v = value + (e.shiftKey ? big : step);
    else if (e.key === 'ArrowLeft') v = value - (e.shiftKey ? big : step);
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = max;
    if (v == null) return;
    e.preventDefault(); e.stopPropagation();
    v = Math.max(0, Math.min(max || 0, v));
    this.props.onSeek?.(v);
    this.props.onCommit?.(v);
  };

  render() {
    const { value = 0, max = 0, height = 22, label = 'position', children, style } = this.props;
    const pct = max > 0 ? (value / max) * 100 : 0;
    return (
      <div
        ref={this.ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={this.down}
        onPointerMove={this.move}
        onPointerUp={this.up}
        onPointerCancel={this.up}
        onKeyDown={this.key}
        style={{
          ...sx('position:relative;width:100%;cursor:pointer;outline:none;border-radius:4px'),
          height,
          // touch-action is what stops the browser from claiming the gesture as a scroll/zoom
          touchAction: 'none',
          // a drag that starts on the track must not select the text around it
          userSelect: this.state.dragging ? 'none' : undefined,
          ...style
        }}>
        {children}
        {/* playhead — 2px, full height, drawn above whatever the caller rendered */}
        <div style={{
          ...sx('position:absolute;top:0;bottom:0;pointer-events:none'),
          left: `calc(${pct}% - 1px)`, width: 2, background: 'var(--accent)',
          boxShadow: '0 0 0 1px color-mix(in srgb, var(--void) 55%, transparent)'
        }} />
      </div>
    );
  }
}
