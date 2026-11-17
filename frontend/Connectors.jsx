// Connectors — which agents can work in this workspace, in both directions.
//
// Two lists, and they are different things, so they are never one list:
//   · AGENTS THAT CAN COME IN   another app (Claude Desktop, Codex, Antigravity…) starts Scout's
//                               connector and works here through Scout's own rules.
//   · AGENTS SCOUT CAN SEND OUT the assistants Scout starts itself, for Ask AI and scheduled runs.
//
// Connecting an agent means adding a few lines to THAT app's own settings file. So every card
// shows the exact lines and the exact file BEFORE the button — the click is the consent — and
// afterwards says where the backup of the old file is. Nothing here builds the text: it comes
// from the server (`GET /api/connectors`, backend/connectors.mjs), and the server writes only
// what this screen was showing (the `hash`).
//
// Lives inside Settings (ScoutSettings.jsx), above Integrations. Props: onToast(message, tone).

import React from 'react';
import { Btn } from './ui';
import { api } from './api';
import { connectorsApi } from './connectorsApi';
import './connectors.css';

export const STATE_LABEL = {
  'not-installed': 'Not installed',
  installed: 'Installed',
  connected: 'Connected in config',
  outdated: 'Connected, older settings',
  unreadable: 'Settings file needs a look',
  manual: 'One command to run',
  'needs-public-address': 'Needs a public address',
};
const STATE_TONE = { connected: 'ok', outdated: 'warn', unreadable: 'warn' };

// What the card says above the text it shows. One sentence, naming the file.
export function whereLine(c) {
  if (c.format === 'command') return 'Run this once in a terminal:';
  if (c.state === 'connected') return 'This is in';
  if (c.state === 'outdated') return 'Scout will replace its entry in';
  if (c.format === 'toml') return 'Scout will add these lines to the end of';
  return c.exists ? 'Scout will add this entry to' : 'Scout will create';
}

function State({ state }) {
  return (
    <span className={'cnxState ' + (STATE_TONE[state] || '')}>
      <span aria-hidden="true" className="cnxDot" />{STATE_LABEL[state] || state}
    </span>
  );
}

// The text and, above it, what it is and where it goes — with Copy beside that line, never on top
// of the text.
function Snippet({ text, label, wrap, children }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setCopied(false); }
  };
  return (
    <div className="cnxSnippet">
      <div className="cnxSnippetBar">
        <div className="cnxWhere">{children}</div>
        <button type="button" className="cnxCopy" onClick={copy} aria-label={'Copy ' + label}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre className={'cnxPre' + (wrap ? ' wrap' : '')} tabIndex={0} aria-label={label}>{text}</pre>
    </div>
  );
}

function ConnectorCard({ c, runtimeOk, onDone }) {
  const [busy, setBusy] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState('');
  const act = async (verb, fn) => {
    setBusy(verb); setError(''); setResult(null);
    try { const r = await fn(); setResult(r); await onDone(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };
  const command = c.format === 'command';
  const canWrite = !command && runtimeOk && (c.state === 'installed' || c.state === 'outdated');

  return (
    <article className="cnxCard" aria-label={c.label}>
      <div className="cnxHead">
        <span className="cnxName">{c.label}</span>
        <State state={c.state} />
      </div>
      <p className="cnxNote">{c.note}</p>
      {c.problem ? <p className="cnxProblem" role="status">{c.problem}. Nothing will be changed — you can paste the text below into the file yourself.</p> : null}
      {c.state === 'not-installed' ? <p className="cnxNote">Scout did not find {c.label} on this computer. Open it once and come back, or keep the text below for later.</p> : null}

      <Snippet text={c.snippet} label={command ? 'the command for ' + c.label : 'what Scout writes for ' + c.label} wrap={command}>
        <span>{whereLine(c)}</span>
        {command ? null : <span className="cnxPath">{c.file}</span>}
      </Snippet>
      {c.alt ? (
        <details className="cnxAlt">
          <summary>{c.alt.label}</summary>
          <Snippet text={c.alt.snippet} label={'the ' + c.alt.file + ' file for ' + c.label}><span className="cnxPath">{c.alt.file}</span></Snippet>
        </details>
      ) : null}
      {!command && c.others ? <p className="cnxMeta">This file also holds {c.others} other server{c.others === 1 ? '' : 's'}. Scout does not read, show or change {c.others === 1 ? 'it' : 'them'}.</p> : null}
      {command && c.undo ? <p className="cnxMeta">To undo: <span className="cnxPath">{c.undo}</span></p> : null}

      <div className="cnxActions">
        {canWrite ? (
          <Btn size="sm" variant="secondary" busy={busy === 'install'} disabled={!!busy}
            onClick={() => act('install', () => connectorsApi.install(c.id, c.hash))}>{c.state === 'outdated' ? 'Update' : 'Connect'}</Btn>
        ) : null}
        {!command && (c.state === 'connected' || c.state === 'outdated') ? (
          <Btn size="sm" variant="ghost" busy={busy === 'remove'} disabled={!!busy}
            onClick={() => act('remove', () => connectorsApi.remove(c.id))}>Disconnect</Btn>
        ) : null}
        <a className="cnxLink" href={c.docs} target="_blank" rel="noreferrer">How {c.label} loads this</a>
      </div>

      {result ? (
        <div className="cnxResult" role="status">
          {(result.summary || []).map((line, i) => <span key={i}>{line}</span>)}
          {result.changed ? <span><b>{result.restart}</b></span> : null}
        </div>
      ) : null}
      {error ? <p className="cnxError" role="alert">{error}</p> : null}
    </article>
  );
}

const outState = p => (p.installed === undefined ? '…' : !p.installed ? 'Not installed' : p.signedIn ? 'Signed in' : 'Not signed in');

export default function Connectors({ onToast }) {
  const [status, setStatus] = React.useState(null);
  const [error, setError] = React.useState('');
  const [providers, setProviders] = React.useState(null);

  const load = React.useCallback(async () => {
    try { setStatus(await connectorsApi.list()); setError(''); }
    catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => {
    let live = true;
    load();
    api.agentProviders().then(r => { if (live) setProviders(r.providers || []); }).catch(() => { if (live) setProviders([]); });
    return () => { live = false; };
  }, [load]);
  const done = async () => { await load(); onToast?.('Connector settings updated.'); };

  return (
    <section className="cnx" aria-label="Connectors">
      <span className="cnxEyebrow">Connectors</span>
      <h2 className="cnxTitle">Agents in this workspace</h2>
      <p className="cnxLead">
        A connected agent works here through Scout&rsquo;s own rules. It <b>can</b> read your records, add what it finds and put suggestions
        in front of you. It <b>cannot</b> delete anything, move a record past the shortlist, change your goals or your profile, or send a
        message to anyone — those stay yours, and everything it does shows up in Activity under its name.
      </p>

      <div className="cnxGroup">
        <h3 className="cnxGroupTitle">Agents that can come in</h3>
        {status ? <p className="cnxMeta">They will work in <span className="cnxPath">{status.workspace}</span>. {status.runtime.note}</p> : null}
        {error ? <p className="cnxError" role="alert">{error}</p> : null}
        {!status && !error ? <p className="cnxMeta">Looking for agent apps on this computer…</p> : null}
        {status ? status.connectors.map(c => <ConnectorCard key={c.id} c={c} runtimeOk={status.runtime.ok} onDone={done} />) : null}
        {status ? status.remote.map(r => (
          <article key={r.id} className="cnxCard quiet" aria-label={r.label}>
            <div className="cnxHead"><span className="cnxName">{r.label}</span><State state={r.state} /></div>
            <p className="cnxNote">{r.note}</p>
          </article>
        )) : null}
      </div>

      <div className="cnxGroup">
        <h3 className="cnxGroupTitle">Agents Scout can send out</h3>
        <p className="cnxMeta">These are the assistants Scout starts itself — for Ask AI on a record, the Today plan and scheduled runs. They use the sign-in you already have in each tool; Scout holds no key for them.</p>
        <div className="cnxOut">
          {(providers || []).map(p => (
            <div key={p.id} className="cnxOutRow">
              <span aria-hidden="true" className="cnxDot" style={{ background: !p.installed ? 'var(--border-3)' : p.signedIn ? 'var(--ok)' : 'var(--warn)' }} />
              <span className="cnxName">{p.label || p.id}</span>
              <span className="cnxOutState">{outState(p)}</span>
            </div>
          ))}
          {providers && !providers.length ? <div className="cnxOutRow">No assistant tools were found on this computer.</div> : null}
          {!providers ? <div className="cnxOutRow">Checking…</div> : null}
        </div>
      </div>
    </section>
  );
}
