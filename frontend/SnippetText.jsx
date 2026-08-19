// Chatwoot-style quick snippets — a drop-in <textarea> replacement.
// Type "/" at the start of a word to search saved snippets (data/snippets/*.md);
// ↑↓ walk the list, Enter/Tab inserts the snippet body at the caret, Esc dismisses.
// Props: value, onChange (receives { target: { value } }), snippets [{name,trigger,content}],
// everything else is passed through to the textarea. Keydown is stopped from bubbling
// so the app-level keymap never fires while typing.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';


export default class SnippetText extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: false, ix: 0, token: '', at: 0 };
    this.ta = React.createRef();
  }

  // while open, re-render on a short interval so the fixed-position list tracks the
  // textarea through entrance animations and scrolling
  componentDidUpdate() {
    if (this.state.open && !this._track) this._track = setInterval(() => this.forceUpdate(), 120);
    if (!this.state.open && this._track) { clearInterval(this._track); this._track = null; }
  }
  componentWillUnmount() { clearInterval(this._track); }

  // Public handle for callers holding a ref to this component. A ref lands on the INSTANCE, not on
  // the inner <textarea>, so `ref.current.focus()` was silently undefined for everyone — this is a
  // smaller change than converting to forwardRef, which the five existing call sites would all have
  // to absorb. `toEnd` parks the caret past the text, which is what a "load this prompt and let me
  // edit it" gesture wants.
  focus(opts) {
    const el = this.ta.current;
    if (!el) return;
    el.focus();
    if (opts && opts.toEnd) { const n = (el.value || '').length; el.setSelectionRange(n, n); }
  }

  matches() {
    const t = this.state.token.toLowerCase();
    return (this.props.snippets || []).filter(s =>
      (s.trigger || '').toLowerCase().startsWith(t) || (s.name || '').toLowerCase().includes(t)
    ).slice(0, 6);
  }

  onChange = e => {
    const v = e.target.value, caret = e.target.selectionStart;
    const head = v.slice(0, caret);
    const m = head.match(/(^|\s)\/([\w-]*)$/);
    if (m && (this.props.snippets || []).length) {
      this.setState({ open: true, token: m[2], at: caret - m[2].length - 1, ix: 0 });
    } else if (this.state.open) this.setState({ open: false });
    this.props.onChange({ target: { value: v } });
  };

  insert(s) {
    const v = this.props.value || '', { at } = this.state;
    const tail = v.slice(at + 1 + this.state.token.length);
    const next = v.slice(0, at) + s.content + tail;
    const caret = at + s.content.length;
    this.setState({ open: false });
    this.props.onChange({ target: { value: next } });
    setTimeout(() => { const el = this.ta.current; if (el) { el.focus(); el.setSelectionRange(caret, caret); } }, 0);
  }

  onKeyDown = e => {
    const ms = this.matches();
    if (this.state.open && ms.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); this.setState(s => ({ ix: Math.min(ms.length - 1, s.ix + 1) })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.setState(s => ({ ix: Math.max(0, s.ix - 1) })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); this.insert(ms[this.state.ix]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.setState({ open: false }); return; }
    }
    if (this.props.onKeyDown) this.props.onKeyDown(e);
    else e.stopPropagation();
  };

  render() {
    const { snippets, onChange, onKeyDown, wrapStyle, ...rest } = this.props;
    const ms = this.matches();
    // fixed positioning measured at render time — ancestors with overflow:hidden (cards)
    // can't clip the list, and the rect is fresh after any scroll/reflow
    const r = this.ta.current ? this.ta.current.getBoundingClientRect() : null;
    return (
      <div style={{ ...sx('position:relative'), ...(wrapStyle || {}) }}>
        <textarea ref={this.ta} {...rest} onChange={this.onChange} onKeyDown={this.onKeyDown}
          onBlur={e => { setTimeout(() => this.setState({ open: false }), 150); if (rest.onBlur) rest.onBlur(e); }} />
        {this.state.open && ms.length > 0 && r && (
          <div style={{
            ...sx('position:fixed;z-index:90;border-radius:10px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 16px 48px rgba(0,0,0,.7);overflow:hidden'),
            left: r.left, top: r.bottom + 4, width: r.width, minWidth: 320
          }}>
            <div style={sx('font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--fg-faint);padding:7px 12px 4px')}>QUICK SNIPPETS</div>
            {ms.map((s, i) => (
              <div key={s.file || i}
                onMouseDown={e => { e.preventDefault(); this.insert(s); }}
                onMouseEnter={() => this.setState({ ix: i })}
                style={{
                  ...sx('display:flex;align-items:baseline;gap:10px;padding:7px 12px;cursor:pointer'),
                  background: i === this.state.ix ? 'var(--accent-05)' : 'transparent'
                }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: i === this.state.ix ? 'var(--accent)' : 'var(--fg-muted)', flex: 'none' }}>/{s.trigger}</span>
                <span style={sx('font-size:11.5px;color:var(--fg);flex:none')}>{s.name}</span>
                <span style={sx('font-size:10.5px;color:var(--fg-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{(s.content || '').slice(0, 60)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
}
