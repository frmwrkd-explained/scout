import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { install as installCapture, recordBoundaryError, stashForReport } from './feedbackCapture.js';
import './styles.css';

// Before anything else, including App's own imports having run their side effects: the rings must
// already be listening when the first boot error happens, or the one crash a user is guaranteed
// to notice is the one we have no record of. Nothing is transmitted — see feedbackCapture.js.
installCapture();

// Last-resort guard: a render crash anywhere in the tree shows a reload card
// instead of a blank window (the backend keeps running either way).
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  // The card below is all the user ever saw of this crash, and the stack died with it. Hand it to
  // the capture ring so "Report this" has the component stack rather than the user's paraphrase.
  componentDidCatch(error, info) { recordBoundaryError(error, info); }
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
              Reload FrameForge
            </div>
            {/* React is gone, so the panel cannot open here. Stash the rings, reload, and let the
                app open the report on the way back with the crash already attached. */}
            <div onClick={() => { stashForReport({ openReport: true }); window.location.reload(); }}
              style={{ flex: 1, textAlign: 'center', padding: '9px 16px', borderRadius: 8, background: 'transparent', color: 'var(--fg-soft)', border: '1px solid var(--border-3)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              Reload &amp; report this
            </div>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
