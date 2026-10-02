// Paperclip owns its board, agents and run history. Embed that application at its own origin;
// never proxy its API with Scout's board token or place a credential in a frame URL.
import React from 'react';
import { api } from './api';
import { sx } from './sx';
import { Btn, Empty } from './ui';

export default function Paperclip({ onGo }) {
  const [connection, setConnection] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [revision, reload] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => {
    let current = true;
    setError(null);
    setConnection(null);
    api.integration('paperclip/ui').then(value => {
      if (current) setConnection(value);
    }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [revision]);

  const problem = error || connection?.error;
  return (
    <section aria-label="Paperclip workspace" style={sx('flex:1;min-height:0;display:flex;flex-direction:column')}>
      <header style={sx('flex:none;display:flex;align-items:center;gap:16px;padding:10px 18px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <Btn size="sm" onClick={() => onGo('today')}>← Back to Scout</Btn>
        <div style={sx('flex:1;min-width:0')}>
          <h1 style={sx('margin:0;font-size:14px;font-weight:600')}>Paperclip board</h1>
          <div style={sx('font-size:11px;color:var(--fg-muted);margin-top:3px')}>Handed-off work · agents · run history</div>
        </div>
        <Btn size="sm" onClick={() => reload()}>Reload board</Btn>
        {connection?.appUrl ? <a href={connection.boardUrl || connection.appUrl} target="_blank" rel="noopener noreferrer"
          style={sx('font-size:12px;color:var(--fg-soft);white-space:nowrap')}>Open Paperclip ↗</a> : null}
      </header>
      {connection?.boardUrl && !problem ? (
        <iframe key={revision} title="Paperclip live task board" src={connection.boardUrl}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
          referrerPolicy="no-referrer" style={sx('flex:1;min-height:0;width:100%;border:0;background:var(--surface)')} />
      ) : (
        <div style={sx('flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px;gap:14px')}>
          <Empty size="page" style={sx('max-width:460px')} title={problem ? 'Paperclip is unavailable' : connection ? 'Connect Paperclip' : 'Opening Paperclip'}
            body={problem || (connection ? 'Choose your Paperclip server and company in Settings to open its native task board here.' : 'Loading the connected company’s task board.')} />
          {connection || problem ? <div style={sx('display:flex;gap:8px')}>
            {problem ? <Btn onClick={() => reload()}>Retry</Btn> : null}
            <Btn onClick={() => onGo('settings')}>Paperclip settings</Btn>
          </div> : null}
        </div>
      )}
    </section>
  );
}
