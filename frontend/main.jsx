import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Last-resort guard: a render crash anywhere in the tree shows a reload card
// instead of a blank window (the backend keeps running either way).
//
// This used to also capture console/network rings and offer "Reload & report this", writing a
// stash only FrameForge's Feedback.jsx ever read. Feedback.jsx is deleted (item D, dead frontend)
// and nothing in Scout reads that stash, so the capture and the button went with it — a control
// that writes something nobody reads is not a lighter version of the feature, it is the same bug
// "capability with no affordance" runs in reverse.
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ink)', color: 'var(--fg-soft)', fontFamily: 'system-ui' }}>
        <div style={{ width: 440, padding: '22px 24px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-3)' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Something broke in the UI</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.6, marginTop: 8 }}>
            Your projects and files are safe — this is only a display crash.
          </div>
          <pre style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface)', color: 'var(--danger)', fontSize: 11, overflow: 'auto', maxHeight: 120 }}>
            {String(this.state.error && (this.state.error.message || this.state.error))}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <div onClick={() => window.location.reload()} style={{ flex: 1, textAlign: 'center', padding: '9px 16px', borderRadius: 8, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              Reload Scout
            </div>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
