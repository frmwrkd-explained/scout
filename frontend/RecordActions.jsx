// RecordActions — the buttons plugins add to a record, and the dialog a button opens.
//
//   <RecordActions collection="deals" path="data/deals/….md" actor={actor} onOpenPath={fn} onChanged={fn} />
//
// renders one quiet button per installed plugin action for that collection ("Create invoice" on a
// deal) and nothing at all when there is none — so it can sit in any record's toolbar.
//
//   <PluginRun plugin action path … />
//
// is the dialog: the plugin's form on the left, the document it makes on the right, redrawn as the
// form changes. Nothing is written until the person presses the button that says what will be
// written. The same dialog is opened from the Plugins screen ("Try it on a record").
//
// THE PREVIEW FRAME. The document is drawn by the server from the plugin's template and shown in
// an <iframe sandbox> with NO `allow-scripts`: nothing in it can run. `allow-same-origin` is there
// only so this window may ask the frame to print itself, and `allow-modals` so the print sheet may
// open. The page inside carries its own policy forbidding scripts and every network request
// (shared/pluginTemplate.mjs `PAGE_POLICY`), and the template was checked when the plugin was
// installed. Three layers, any one of which is enough.

import React from 'react';
import { Btn } from './ui';
import { pluginsApi } from './pluginsApi';
import './plugins.css';

export default function RecordActions({ collection, path, actor, onOpenPath, onChanged, className = '' }) {
  const [actions, setActions] = React.useState([]);
  const [open, setOpen] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    setActions([]);
    if (!collection) return undefined;
    pluginsApi.actionsFor(collection).then(r => { if (alive) setActions(r.actions || []); }).catch(() => { /* no buttons is the honest fallback */ });
    return () => { alive = false; };
  }, [collection]);
  if (!actions.length || !path) return null;
  return (
    <span className={('pgRecordActions ' + className).trim()}>
      {actions.map(a => (
        <Btn key={a.plugin + '/' + a.action} size="sm" variant="ghost" title={'From the ' + a.plugin_name + ' plugin'} onClick={() => setOpen(a)}>{a.label}</Btn>
      ))}
      {open ? (
        <PluginRun plugin={open.plugin} action={open.action} path={path} actor={actor} onOpenPath={onOpenPath}
          onDone={onChanged} onClose={() => setOpen(null)} />
      ) : null}
    </span>
  );
}

const INPUT_KIND = { number: 'number', date: 'date', text: 'text' };

export function PluginRun({ plugin, action, path, actor, onOpenPath, onDone, onClose, previewOnly = false }) {
  const [form, setForm] = React.useState(null);
  const [input, setInput] = React.useState({});
  const [shown, setShown] = React.useState({ html: '', creates: null, problems: [] });
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [made, setMade] = React.useState(null);
  const frame = React.useRef(null);

  React.useEffect(() => {
    let alive = true;
    pluginsApi.prepare(plugin, action, path)
      .then(f => { if (!alive) return; setForm(f); setInput(Object.fromEntries(f.inputs.map(i => [i.key, i.value ?? '']))); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [plugin, action, path]);

  // Redraw shortly after the form stops changing. A stale answer never replaces a newer one.
  const turn = React.useRef(0);
  React.useEffect(() => {
    if (!form || made) return undefined;
    const mine = ++turn.current;
    const timer = setTimeout(() => {
      pluginsApi.preview(plugin, action, path, input)
        .then(r => { if (mine === turn.current) { setShown(r); setError(null); } })
        .catch(e => { if (mine === turn.current) setError(e.message); });
    }, 220);
    return () => clearTimeout(timer);
  }, [form, input, plugin, action, path, made]);

  React.useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await pluginsApi.run(plugin, action, path, input, actor);
      setShown(s => ({ ...s, html: r.html, problems: [] }));
      setMade(r.record);
      if (onDone) onDone(r.record);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const print = () => {
    const win = frame.current && frame.current.contentWindow;
    try { if (win) { win.focus(); win.print(); } } catch { setError('This window could not open the print sheet.'); }
  };

  const creates = form && form.creates;
  const problem = error || (shown.problems && shown.problems[0]) || null;
  return (
    <div className="pgCatch" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pgDialog" role="dialog" aria-modal="true" aria-label={form ? form.label : 'Plugin'}>
        <header className="pgDialogHead">
          <div className="pgDialogTitle">
            <span className="pgDialogName">{form ? form.label : 'Opening…'}</span>
            {form ? <span className="pgDialogFor">{form.record.title}</span> : null}
          </div>
          <span className="pgDialogBy">{form ? form.plugin_name + ' plugin' : ''}</span>
          <button type="button" className="pgClose hFg" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="pgDialogBody">
          <div className="pgForm">
            {form && form.inputs.length ? form.inputs.map(i => (
              <label key={i.key} className="pgField">
                <span className="pgLabel">{i.label}</span>
                {i.type === 'longtext'
                  ? <textarea className="pgInput pgArea" rows={3} value={input[i.key] ?? ''} disabled={!!made} onChange={e => setInput(v => ({ ...v, [i.key]: e.target.value }))} />
                  : <input className="pgInput" type={INPUT_KIND[i.type] || 'text'} value={input[i.key] ?? ''} disabled={!!made} onChange={e => setInput(v => ({ ...v, [i.key]: e.target.value }))} />}
                {i.help ? <span className="pgHelp">{i.help}</span> : null}
              </label>
            )) : form ? <p className="pgQuiet">Nothing to fill in. This draws the document from the record as it is.</p> : null}

            {made ? (
              <div className="pgMade" role="status">
                <span className="pgMadeTitle">{made.title} is filed under {made.label}.</span>
                <span className="pgHelp">It is a draft record, linked to this one. Change its status when you send it.</span>
                {onOpenPath ? <Btn size="sm" variant="ghost" onClick={() => { onClose(); onOpenPath(made.path); }}>Open {made.title}</Btn> : null}
              </div>
            ) : creates && !previewOnly ? (
              <p className="pgQuiet">Pressing <b>{form.label}</b> files one new record under <b>{creates.label}</b>. Nothing is sent anywhere.</p>
            ) : previewOnly ? (
              <p className="pgQuiet">This plugin is a draft, so this is a preview only. Approve it to use it.</p>
            ) : null}
          </div>

          <div className="pgPaper">
            {shown.html
              ? <iframe ref={frame} className="pgFrame" title="Preview" sandbox="allow-same-origin allow-modals" srcDoc={shown.html} />
              : <span className="pgQuiet">{error ? '' : 'Drawing the preview…'}</span>}
          </div>
        </div>

        <footer className="pgDialogFoot">
          <span className={'pgProblem' + (problem ? ' on' : '')} role={problem ? 'alert' : undefined}>{problem || 'The preview is drawn from the record. It runs no code and loads nothing from the internet.'}</span>
          <Btn variant="ghost" onClick={print} disabled={!shown.html}>Print or save as PDF</Btn>
          {creates && !made && !previewOnly ? <Btn variant="primary" onClick={run} busy={busy} disabled={!form || !!(shown.problems && shown.problems.length)}>{form.label}</Btn> : null}
          {made || !creates || previewOnly ? <Btn variant="ghost" onClick={onClose}>Close</Btn> : null}
        </footer>
      </div>
    </div>
  );
}
