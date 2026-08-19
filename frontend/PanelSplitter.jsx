// PanelSplitter (ticket 07) — a thin draggable divider between two flex panels.
//
// NOT `GridSplitter` — `frontend/GridSplitter.jsx` is an unrelated tool that cuts contact
// sheets into frames; this is a plain layout resizer with keyboard parity.
//
// Drag: onPointerDown + setPointerCapture + onPointerMove — the same pattern already working
// at ThreeDStage.jsx:725-728. No library, no `window` listeners. `onChange` fires per move so
// the caller can re-render live; `onCommit` fires once on pointerup so the caller can persist
// without spamming the backend on every frame (mirrors how ProductionPanel already persists
// prodPanelCollapsed on toggle, not on every intermediate state).
//
// Keyboard parity is not optional: role="separator", tabIndex, aria-orientation, aria-label,
// live aria-valuenow/valuemin/valuemax. ArrowLeft/ArrowRight move the boundary ±8px (±32px with
// Shift), Home resets to defaultValue, Enter/Space toggles collapse when onToggleCollapse is
// given. Keyboard changes commit immediately (there is no "drag" to wait out).
//
// No local `outline:none` here — ticket 02's global :focus-visible ring (styles.css) covers
// this element same as everything else; suppressing it locally was the exact anti-pattern that
// ticket removed everywhere else.
import React from 'react';
import { sx } from './sx';

const STEP = 8;
const BIG_STEP = 32;

export default class PanelSplitter extends React.Component {
  constructor(props) {
    super(props);
    this.state = { dragging: false, hover: false, focused: false };
    this.drag = null; // { x, value } while a pointer drag is in progress
  }

  clamp(v) {
    const { min, max } = this.props;
    return Math.min(max, Math.max(min, v));
  }

  onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, value: this.props.value };
    if (typeof document !== 'undefined' && document.body) document.body.style.userSelect = 'none';
    this.setState({ dragging: true });
  }

  onPointerMove(e) {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const signed = this.props.side === 'right' ? -dx : dx; // right-side panel grows as the splitter moves left
    this.props.onChange(this.clamp(this.drag.value + signed));
  }

  endDrag() {
    if (!this.drag) return;
    this.drag = null;
    if (typeof document !== 'undefined' && document.body) document.body.style.userSelect = '';
    this.setState({ dragging: false });
    this.props.onCommit(this.clamp(this.props.value));
  }

  onKeyDown(e) {
    const { value, defaultValue, onToggleCollapse, onChange, onCommit } = this.props;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey ? BIG_STEP : STEP;
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = this.clamp(value + dir * step);
      onChange(next);
      onCommit(next);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const next = this.clamp(defaultValue);
      onChange(next);
      onCommit(next);
    } else if ((e.key === 'Enter' || e.key === ' ') && onToggleCollapse) {
      e.preventDefault();
      onToggleCollapse();
    }
  }

  render() {
    const { value, min, max, label } = this.props;
    const { dragging, hover, focused } = this.state;
    const lineColor = dragging || focused ? 'var(--accent)' : hover ? 'var(--border-3)' : 'var(--line)';
    return (
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        onPointerDown={e => this.onPointerDown(e)}
        onPointerMove={e => this.onPointerMove(e)}
        onPointerUp={() => this.endDrag()}
        onPointerCancel={() => this.endDrag()}
        onMouseEnter={() => this.setState({ hover: true })}
        onMouseLeave={() => this.setState({ hover: false })}
        onFocus={() => this.setState({ focused: true })}
        onBlur={() => this.setState({ focused: false })}
        onKeyDown={e => this.onKeyDown(e)}
        style={sx('flex:none;width:5px;height:100%;cursor:col-resize;background:transparent;touch-action:none;position:relative')}>
        <span style={{ position: 'absolute', top: 0, bottom: 0, left: 2, width: 1, background: lineColor }} />
      </div>
    );
  }
}
