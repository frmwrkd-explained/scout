// PLUGINS — buttons on a record that make something from it.
//
// docs/10_SKILLS_AND_PLUGINS.md §3. A plugin is a folder holding a form, formulas and a template —
// no code — so what one reads and writes can be stated exactly, and this screen states it: for
// every installed plugin, the buttons it adds, what each button reads, what it writes, and what it
// has made so far (read back from the event log).
//
// "Create a plugin" is honest about what exists: a model writes a DRAFT from a description when
// one is connected; a draft does nothing until it is approved here; and without a model the way in
// is to copy an installed plugin and edit its folder. There is no community catalogue yet, and the
// screen says so.
//
// Props
//   collections, actor
//   onOpenPath(path)      open a record a plugin made
//   onPickCollection(id)  open a collection a plugin names
//   onNavigate(screen, arg)

import React from 'react';
import RichEditor from './RichEditor';
import { Btn } from './ui';
import { api } from './api';
import { MONO } from './tokens';
import { pluginsApi } from './pluginsApi';
import { PluginRun } from './RecordActions';
import { Screen, ListGroup, ListRow, CollectionChip } from './Skills';
import { useRecordNames } from './recordNames';
import { nameFromSlug } from './relationNames';
import { colourOf } from './collectionColour';
import { folderOf } from '../shared/collectionShape.mjs';
import './plugins.css';

const EXAMPLES = [
  'A one-page quote for a deal: the line items, a total, valid for 30 days. File it under Invoices as a draft.',
  'A call sheet for a person: their name, role, company and the last three messages.',
  'A statement for a company listing every unpaid invoice with a total.',
];
const SOURCE = { 'built-in': 'Built in', workspace: 'This workspace', draft: 'Draft' };
const when = ts => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };

// THE PAGE, AND WHY IT IS SHAPED THIS WAY. A person opening a plugin wants three answers, in this
// order: what does it make (so the page SHOWS one, drawn from a real record), how do I use it
// (three steps and a button), and can I trust it (one line, with the full list one click away).
// The first version answered the third question first and at length — safety, folder, reads,
// writes, files, readme — and read as a spec sheet.

// The document a button makes, drawn small from a real record with the plugin's default answers.
// It is the same HTML the run dialog shows, in a frame that can run nothing (`sandbox=""`), scaled
// down; the whole sheet is one button that opens the real dialog on that record.
function Sample({ plugin, action, path, onOpen }) {
  const [state, setState] = React.useState({ html: null, failed: false });
  React.useEffect(() => {
    let alive = true;
    setState({ html: null, failed: false });
    if (!path) return undefined;
    pluginsApi.prepare(plugin, action, path)
      .then(f => pluginsApi.preview(plugin, action, path, Object.fromEntries(f.inputs.map(i => [i.key, i.value ?? '']))))
      .then(r => { if (alive) setState({ html: r.html || '', failed: !r.html }); })
      .catch(() => { if (alive) setState({ html: null, failed: true }); });
    return () => { alive = false; };
  }, [plugin, action, path]);
  return (
    <div className="ppSheet">
      {state.html
        ? <iframe className="ppSheetFrame" title="A sample of what it makes" tabIndex={-1} sandbox="" srcDoc={state.html} />
        : <span className="ppSheetBlank">{state.failed ? 'No sample for this record.' : ''}</span>}
      {state.html ? <button type="button" className="ppSheetOpen" onClick={onOpen} aria-label="Open this sample full size" title="Open it full size" /> : null}
    </div>
  );
}

// Pick a record of the action's collection and press the button on it.
function TryIt({ action, names, path, onPath, onRun, previewOnly, primary }) {
  if (names.list && !names.list.length) return <span className="pgNote">There is no record in {action.on_label} to try it on yet.</span>;
  return (
    <div className="ppTry">
      <select className="pgInput ppTrySelect" aria-label={'A record in ' + action.on_label} value={path} onChange={e => onPath(e.target.value)} disabled={!names.list}>
        {(names.list || []).slice(0, 400).map(r => <option key={r.path} value={r.path}>{r.title}</option>)}
      </select>
      <Btn size="sm" variant={primary ? 'primary' : 'ghost'} disabled={!path} onClick={() => onRun(path)}>{previewOnly ? 'Preview it' : 'Try it'}</Btn>
    </div>
  );
}

// One action's records and the one currently picked — shared by the sample, the steps and the row.
function usePicked(action) {
  const names = useRecordNames(action ? action.on : null);
  const [path, setPath] = React.useState('');
  const first = names.list && names.list[0] ? names.list[0].path : '';
  React.useEffect(() => { setPath(p => (p && names.list && names.list.some(r => r.path === p) ? p : first)); }, [first, names.list]);
  return { names, path, setPath };
}

const listed = (labels, max = 4) => (labels.length <= max ? labels.join(' · ') : labels.slice(0, max).join(' · ') + ' · and ' + (labels.length - max) + ' more');

// What it makes, how to use it — and the thing itself beside it.
function Hero({ plugin, action, collections, onPickCollection, onRun, previewOnly }) {
  const { names, path, setPath } = usePicked(action);
  const picked = (names.list || []).find(r => r.path === path);
  const steps = [
    <><span className="pgButtonLook">{action.label}</span> appears on every record in <CollectionChip id={action.on} label={action.on_label} exists collections={collections} onPick={onPickCollection} /></>,
    action.inputs.length
      ? <>You check a short form, already filled in from the record<span className="ppStepNote">{listed(action.inputs.map(i => i.label))}</span></>
      : <>Nothing to fill in. It reads the record as it is</>,
    action.creates
      ? <>It files one new record in <CollectionChip id={action.creates.collection} label={action.creates.label} exists collections={collections} onPick={onPickCollection} /> that you can print or save as a PDF</>
      : <>It shows a document you can print or save as a PDF. Nothing is saved</>,
  ];
  return (
    <section className="ppHero">
      <div className="ppHow">
        <div className="pgFactLabel">How it works</div>
        <ol className="ppSteps">
          {steps.map((step, i) => (
            <li key={i} className="ppStep"><span className="ppStepN" aria-hidden="true">{i + 1}</span><span className="ppStepText">{step}</span></li>
          ))}
        </ol>
        <div className="ppHowTry">
          <span className="pgLabel">Try it on a record from {action.on_label}</span>
          <TryIt action={action} names={names} path={path} onPath={setPath} onRun={p => onRun(action, p)} previewOnly={previewOnly} primary />
          <span className="pgHelp">You see the result first. Nothing is saved until you press the button in the window that opens.</span>
        </div>
      </div>
      <figure className="ppSample">
        <Sample plugin={plugin.id} action={action.id} path={path} onOpen={() => onRun(action, path)} />
        <figcaption className="ppSampleCap">{picked ? <>A sample, drawn from <b>{picked.title}</b></> : 'A sample of what it makes'}</figcaption>
      </figure>
    </section>
  );
}

// One button the plugin adds: where it sits, what comes out, who else presses it — on one line.
// What it reads and writes is exact and one click away, not the first thing on the page.
function ActionRow({ action, collections, onPickCollection, onRun, isDraft, onNavigate }) {
  const { names, path, setPath } = usePicked(action);
  return (
    <div className="ppAction">
      <div className="ppActionTop">
        <div className="ppActionWhat">
          <span className="pgButtonLook">{action.label}</span>
          <span className="pgMuted">on</span>
          <CollectionChip id={action.on} label={action.on_label} exists collections={collections} onPick={onPickCollection} />
          <span className="ppArrow" aria-hidden="true">→</span>
          {action.creates
            ? <><span className="pgMuted">makes a record in</span><CollectionChip id={action.creates.collection} label={action.creates.label} exists collections={collections} onPick={onPickCollection} /></>
            : <span className="pgMuted">a document to print. Saves nothing</span>}
        </div>
        <TryIt action={action} names={names} path={path} onPath={setPath} onRun={p => onRun(action, p)} previewOnly={isDraft} />
      </div>
      {/* The automations that press this button for you (backend/automations.mjs). */}
      {(action.automations || []).map(a => (
        <button key={a.id} type="button" className="ppAuto" onClick={() => onNavigate && onNavigate('automations')} title="Open Automations">
          <span className="ppAutoMark" aria-hidden="true">↻</span>
          <span className="ppAutoText"><b>Also runs by itself.</b> {a.sentence ? a.sentence.when + ' — ' + a.sentence.mode : a.name}</span>
          <span className={'ppAutoState' + (a.enabled && !a.broken ? ' on' : '')}>{a.broken ? 'Cannot run' : a.enabled ? 'On' : 'Off'}</span>
        </button>
      ))}
      <details className="ppExact">
        <summary>Exactly what it reads and writes</summary>
        <div className="pgRW">
          <div>
            <div className="pgFactLabel">Reads</div>
            <ul className="pgPlain">{action.reads.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
          <div>
            <div className="pgFactLabel">Writes</div>
            {action.writes.length
              ? <ul className="pgPlain">{action.writes.map((r, i) => <li key={i}>{r}</li>)}</ul>
              : <p className="pgMuted pgPlainNone">Nothing. It shows a document you can print.</p>}
            {action.inputs.length ? <><div className="pgFactLabel ppAsks">Asks you for</div><p className="pgMuted pgPlainNone">{action.inputs.map(i => i.label).join(' · ')}</p></> : null}
          </div>
        </div>
      </details>
    </div>
  );
}

// A record a plugin filed, by its name.
function MadeRow({ run, collections, onOpenPath }) {
  const home = collections.find(c => { const f = folderOf(c); return f && String(run.target).startsWith(f + '/'); });
  const names = useRecordNames(home ? home.id : null);
  const hit = (names.list || []).find(r => r.path === run.target);
  const title = hit ? hit.title : nameFromSlug(String(run.target).split('/').pop().replace(/\.md$/, ''));
  return (
    <button type="button" className="ppMade" onClick={() => onOpenPath && onOpenPath(run.target)}>
      {home ? <span className="pgDot" style={{ background: colourOf(home) }} aria-hidden="true" /> : null}
      <span className="ppMadeTitle">{title}</span>
      <span className="ppMadeMeta">{home ? (home.label || home.id) + ' · ' : ''}{run.actor} · {when(run.ts)}</span>
    </button>
  );
}

function Create({ ai, plugins, actor, onMade }) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [from, setFrom] = React.useState(plugins[0] ? plugins[0].id : '');
  const [name, setName] = React.useState('');
  const make = async (what, kind) => {
    setBusy(kind); setError(null);
    try { onMade(await pluginsApi.draft(what, actor)); }
    catch (e) { setError({ message: e.message, problems: e.problems }); }
    finally { setBusy(null); }
  };
  return (
    <article className="pgDoc">
      <div className="pgDocHead">
        <div className="pgKicker">New plugin</div>
        <h2 className="pgDocTitle">Create a plugin</h2>
        <p className="pgDocLead">Say what it should make and from which records. A model writes the plugin as a draft. You read what it will read and write, preview it on a real record, and approve it. Until then it does nothing.</p>
      </div>

      <section className="pgSection">
        <label className="pgField">
          <span className="pgLabel">What should it make?</span>
          <textarea className="pgInput pgArea" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="A one-page quote for a deal: the line items, a total, valid for 30 days…" />
        </label>
        <div className="pgExamples">
          {EXAMPLES.map(x => <button key={x} type="button" className="pgExample" onClick={() => setText(x)}>{x}</button>)}
        </div>
        <div className="pgCreateRow">
          <Btn variant="primary" busy={busy === 'ai'} disabled={!ai.available || text.trim().length < 12 || !!busy} onClick={() => make({ description: text }, 'ai')}>
            {busy === 'ai' ? 'Writing the draft…' : 'Write a draft'}
          </Btn>
          <span className="pgNote">
            {ai.available
              ? 'This uses one call to the model you have connected. It can take a minute.'
              : 'No model is connected, so Scout cannot write one for you yet. Connect one in Settings, or start from a copy below.'}
          </span>
        </div>
        {error ? (
          <div className="pgError" role="alert">
            <span>{error.message}</span>
            {error.problems ? <ul className="pgPlain">{error.problems.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
          </div>
        ) : null}
      </section>

      <section className="pgSection">
        <h3 className="pgSectionTitle">Or start from a copy</h3>
        <p className="pgMuted">Copies an installed plugin into a draft folder you can edit by hand: <span style={{ fontFamily: MONO }}>plugin.md</span> holds the form and the formulas, the <span style={{ fontFamily: MONO }}>.html</span> file is the document.</p>
        <div className="pgCreateRow">
          <select className="pgInput pgSelect" aria-label="Plugin to copy" value={from} onChange={e => setFrom(e.target.value)}>
            {plugins.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="pgInput" aria-label="Name of the new plugin" placeholder="Name it — Quote, Packing slip…" value={name} onChange={e => setName(e.target.value)} />
          <Btn variant="ghost" busy={busy === 'copy'} disabled={!from || !!busy} onClick={() => make({ from, name }, 'copy')}>Start from a copy</Btn>
        </div>
      </section>

      <section className="pgSection">
        <h3 className="pgSectionTitle">What a plugin can and cannot do</h3>
        <ul className="pgPlain">
          <li>It adds a button to the records of one collection, asks a few questions, and draws a document from a template.</li>
          <li>It may file one new record, through the same pipeline as everything else, so it shows in History.</li>
          <li>It contains no code. It cannot open other files, change existing records, or reach the internet.</li>
        </ul>
      </section>
    </article>
  );
}

export default function Plugins({ collections = [], actor, onOpenPath, onPickCollection, onNavigate }) {
  const [data, setData] = React.useState(null);
  const [runs, setRuns] = React.useState([]);
  const [error, setError] = React.useState(null);
  const [active, setActive] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [file, setFile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState(null);
  const [reason, setReason] = React.useState(null);
  // The run dialog, opened from the sample, the steps or a button's row — { action, path }.
  const [run, setRun] = React.useState(null);

  const load = React.useCallback(async pick => {
    try {
      const [list, history] = await Promise.all([pluginsApi.list(), pluginsApi.history()]);
      setData(list); setRuns(history.runs || []); setError(null);
      // Stay where the person is when that still exists; otherwise the first thing worth reading.
      setActive(current => {
        const ids = [...list.drafts, ...list.plugins].map(p => p.id);
        const want = pick || current;
        if (want === 'new' || ids.includes(want)) return want;
        return (list.drafts[0] || list.plugins[0] || { id: 'new' }).id;
      });
    } catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  // Opening another plugin clears the page; a refresh of the same one (after a run, an approval)
  // replaces it in place, so a dialog open over it stays open.
  const shownFor = React.useRef(null);
  React.useEffect(() => {
    let alive = true;
    if (shownFor.current !== active) { setDetail(null); setFile(null); setNote(null); setReason(null); setRun(null); }
    shownFor.current = active;
    if (!active || active === 'new') return undefined;
    pluginsApi.get(active).then(d => { if (alive) setDetail(d); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [active, data]);

  const act = async (fn, pick) => {
    setBusy(true); setNote(null);
    try { const r = await fn(); await load(typeof pick === 'function' ? pick(r) : pick); }
    catch (e) { setNote(e.message); }
    finally { setBusy(false); }
  };

  const plugins = data ? data.plugins : [];
  const drafts = data ? data.drafts : [];
  const row = p => (
    <ListRow key={p.source + p.id} on={p.id === active} title={p.name} text={p.description}
      meta={[SOURCE[p.source], p.problems.length ? 'needs attention' : p.needs.length ? 'not usable here yet' : p.actions.map(a => a.on_label).filter((x, i, a) => a.indexOf(x) === i).join(' · ')].filter(Boolean)}
      onClick={() => setActive(p.id)} />
  );
  const list = !data ? <p className="pgNone">{error || 'Reading the plugins folders…'}</p> : (
    <>
      {drafts.length ? <ListGroup label="Waiting for your approval" count={drafts.length}>{drafts.map(row)}</ListGroup> : null}
      <ListGroup label="Installed" count={plugins.length}>
        {plugins.length ? plugins.map(row) : <p className="pgNone">None installed.</p>}
      </ListGroup>
      <div className="pgAside">
        <div className="pgGroupHead"><span>Sharing</span></div>
        <p>A plugin is one folder. To share one, send the folder. To install one, put it in <span style={{ fontFamily: MONO }}>plugins/</span> in a workspace and it appears here with what it reads and writes.</p>
        <p>A community catalogue to browse and install from is not built yet.</p>
      </div>
    </>
  );

  const isDraft = detail && detail.source === 'draft';
  const mine = detail ? runs.filter(r => r.plugin === detail.id) : [];
  const folder = detail ? (isDraft ? 'plugins/_drafts/' : 'plugins/') + detail.id : '';
  // The button the page leads with: the first one that files something, else the first.
  const hero = detail && detail.actions.length ? (detail.actions.find(a => a.creates) || detail.actions[0]) : null;
  return (
    <Screen title="Plugins"
      lead="A plugin adds a button to a record that makes something from it: an invoice, a quote, a summary. Plugins contain no code, so what each one reads and writes is listed here exactly."
      right={<Btn variant={active === 'new' ? 'ghost' : 'secondary'} onClick={() => setActive('new')}>Create a plugin</Btn>}
      list={list}>
      {active === 'new' && data ? (
        <Create ai={data.ai} plugins={plugins.filter(p => !p.problems.length)} actor={actor} onMade={made => load(made.id)} />
      ) : !detail ? (
        <p className="pgNone pgPad">{error || 'Opening…'}</p>
      ) : (
        <article className="pgDoc">
          <div className="pgDocHead">
            <div className="pgKicker">{SOURCE[detail.source]}{detail.author ? ' · by ' + detail.author : ''} · version {detail.version}</div>
            <h2 className="pgDocTitle">{detail.name}</h2>
            <p className="pgDocLead">{detail.description}</p>
          </div>

          {isDraft ? (
            <div className="pgBanner">
              <div>
                <b>This is a draft. It adds no button and writes nothing until you approve it.</b>
                <span>{detail.drafted_by ? 'Written by ' + detail.drafted_by + (detail.request ? ' from your request: “' + detail.request + '”' : '') + '.' : 'Copied from an installed plugin. Edit the files in its folder, then approve it.'}</span>
                <span>Read what it reads and writes below, and preview it on a record first.</span>
              </div>
              <div className="pgBannerActions">
                <Btn variant="primary" busy={busy} disabled={!!detail.problems.length} onClick={() => act(() => pluginsApi.approve(detail.id, actor), detail.id)}>Approve and install</Btn>
                <Btn variant="ghost" disabled={busy} onClick={() => act(() => pluginsApi.discard(detail.id, actor), () => null)}>Discard</Btn>
              </div>
            </div>
          ) : null}
          {detail.problems.length ? (
            <div className="pgError" role="alert">
              <span>This plugin cannot be used as it is:</span>
              <ul className="pgPlain">{detail.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          ) : detail.needs.length ? (
            <div className="pgError soft">
              <span>Not usable in this workspace yet. It needs {detail.needs.join(' and ')}.</span>
            </div>
          ) : null}
          {note ? <div className="pgError" role="alert"><span>{note}</span></div> : null}

          <p className="ppSafe"><span className="ppSafeMark" aria-hidden="true">✓</span>Runs no code. It cannot change or delete existing records, open other files, or reach the internet.</p>

          {hero ? (
            <Hero plugin={detail} action={hero} collections={collections} onPickCollection={onPickCollection}
              onRun={(action, path) => setRun({ action: action.id, path })} previewOnly={isDraft || !detail.ready} />
          ) : null}

          <section className="pgSection">
            <h3 className="pgSectionTitle">{detail.actions.length === 1 ? 'The button it adds' : 'The buttons it adds'}</h3>
            <div className="ppActions">
              {detail.actions.map(a => (
                <ActionRow key={a.id} action={a} collections={collections} onPickCollection={onPickCollection}
                  onRun={(action, path) => setRun({ action: action.id, path })} isDraft={isDraft || !detail.ready} onNavigate={onNavigate} />
              ))}
            </div>
          </section>

          {mine.length ? (
            <section className="pgSection">
              <h3 className="pgSectionTitle">What it has made <span style={{ fontFamily: MONO }}>{mine.length}</span></h3>
              <div className="ppMadeList">
                {mine.slice(0, 12).map((r, i) => <MadeRow key={i} run={r} collections={collections} onOpenPath={onOpenPath} />)}
              </div>
              {mine.length > 12 ? <p className="pgMuted">And {mine.length - 12} earlier ones, in Activity.</p> : null}
            </section>
          ) : null}

          <details className="ppHood">
            <summary>Under the hood<span>its folder, its {detail.files.length} files{detail.readme ? ' and the author\'s notes' : ''}</span></summary>
            <div className="ppHoodBody">
              <div className="ppHoodLine">
                <span className="pgFactLabel">Folder</span>
                {detail.source !== 'built-in' && onNavigate
                  ? <button type="button" className="pgPath hAccent" style={{ fontFamily: MONO }} onClick={() => onNavigate('files', folder)}>{folder}/</button>
                  : <span className="pgPath" style={{ fontFamily: MONO }}>{folder}/ <span className="pgMuted">inside the app</span></span>}
              </div>
              <div className="pgFiles">
                {detail.files.map(f => {
                  const source = detail.templates[f.name];
                  const on = file === f.name;
                  return (
                    <button key={f.name} type="button" className={'pgFile' + (on ? ' on' : '')} disabled={source === undefined} aria-expanded={on} onClick={() => setFile(on ? null : f.name)}>
                      <span className={'pgFileKind ' + (f.name === 'plugin.md' ? 'data' : 'doc')}>{f.name === 'plugin.md' ? 'Manifest' : f.name.endsWith('.html') ? 'Template' : 'Note'}</span>
                      <span className="pgFileName" style={{ fontFamily: MONO }}>{f.name}</span>
                      <span className="pgFileSize">{f.name === 'plugin.md' ? 'the form, the formulas, what it creates' : on ? 'hide source' : 'show source'}</span>
                    </button>
                  );
                })}
              </div>
              {file && detail.templates[file] !== undefined ? <pre className="pgSource" style={{ fontFamily: MONO }}>{detail.templates[file]}</pre> : null}
              {detail.readme ? <div className="pgProse"><RichEditor key={detail.id} value={detail.readme} readOnly toolbar={false} minHeight={0} /></div> : null}
            </div>
          </details>

          {detail.source === 'workspace' ? (
            <section className="pgSection">
              {reason === null ? (
                <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setReason('')}>Remove this plugin…</Btn>
              ) : (
                <div className="pgCreateRow">
                  <input className="pgInput" autoFocus aria-label="Why it is being removed" placeholder="Why? The folder is moved to plugins/_archive, not deleted." value={reason} onChange={e => setReason(e.target.value)} />
                  <Btn size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={() => act(() => pluginsApi.remove(detail.id, reason.trim(), actor), () => null)}>Remove</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setReason(null)}>Keep it</Btn>
                </div>
              )}
            </section>
          ) : null}
          {run ? (
            <PluginRun plugin={detail.id} action={run.action} path={run.path} actor={actor} onOpenPath={onOpenPath}
              onDone={() => load(detail.id)} previewOnly={isDraft || !detail.ready} onClose={() => setRun(null)} />
          ) : null}
        </article>
      )}
    </Screen>
  );
}
