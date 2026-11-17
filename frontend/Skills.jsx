// SKILLS — what the assistants know how to do.
//
// docs/10_SKILLS_AND_PLUGINS.md §1. A skill is a folder (SKILL.md, plus any scripts and reference
// files it carries); this screen is the way to look through the ones on disk without opening a
// file browser: what each is for, which collections it looks in and writes to, whether anything
// runs it on a schedule, the files it carries, and its instructions as an assistant reads them.
//
// It is read-only on purpose. A skill is changed by editing its folder (or by an assistant
// proposing a change), and the folder stays the one copy.
//
// Props
//   collections          the workspace's collections, for names and colours
//   onPickCollection(id) open a collection a skill names
//   onNavigate(screen, arg)

import React from 'react';
import RichEditor from './RichEditor';
import { colourOf } from './collectionColour';
import { MONO } from './tokens';
import { skillsApi } from './pluginsApi';
import './plugins.css';

// ── pieces shared with the Plugins screen ────────────────────────────────────────────────────
export function Screen({ title, lead, right, list, children }) {
  return (
    <div className="pgScreen">
      <header className="pgHead">
        <div className="pgHeadText">
          <h1 className="pgTitle">{title}</h1>
          <p className="pgLead">{lead}</p>
        </div>
        {right ? <div className="pgHeadRight">{right}</div> : null}
      </header>
      <div className="pgCols">
        <nav className="pgList" aria-label={title}>{list}</nav>
        <section className="pgDetail">{children}</section>
      </div>
    </div>
  );
}

export function ListGroup({ label, count, children }) {
  return (
    <div className="pgGroup">
      <div className="pgGroupHead"><span>{label}</span>{count != null ? <span style={{ fontFamily: MONO }}>{count}</span> : null}</div>
      {children}
    </div>
  );
}

export function ListRow({ on, title, text, meta, onClick }) {
  return (
    <button type="button" className={'pgRow' + (on ? ' on' : '')} aria-current={on ? 'true' : undefined} onClick={onClick}>
      <span className="pgRowTitle">{title}</span>
      {text ? <span className="pgRowText">{text}</span> : null}
      {meta && meta.length ? <span className="pgRowMeta">{meta.map((m, i) => <span key={i}>{m}</span>)}</span> : null}
    </button>
  );
}

// A collection, named and coloured the way the sidebar does it. A button when it exists here.
export function CollectionChip({ id, label, exists = true, collections = [], onPick }) {
  const found = collections.find(c => c.id === id);
  const dot = <span className="pgDot" style={{ background: found ? colourOf(found) : 'var(--border-3)' }} />;
  const text = (found && (found.label || found.id)) || label || id;
  if (!exists || !found || !onPick) return <span className="pgChip off" title={exists ? undefined : 'This workspace has no collection called ' + id}>{dot}{text}</span>;
  return <button type="button" className="pgChip" onClick={() => onPick(id)} title={'Open ' + text}>{dot}{text}</button>;
}

export function Fact({ label, children }) {
  return (
    <div className="pgFact">
      <div className="pgFactLabel">{label}</div>
      <div className="pgFactValue">{children}</div>
    </div>
  );
}

const size = n => (n == null ? '' : n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const KIND = { script: 'Script', doc: 'Notes', data: 'Data', other: 'File' };

// ── the screen ───────────────────────────────────────────────────────────────────────────────
const SCHEDULE_WORD = { daily: 'every day', weekly: 'every week', continuous: 'continuously', manual: 'when asked' };

function runsLine(schedule) {
  if (schedule.assistant) {
    const when = SCHEDULE_WORD[schedule.assistant.kind] || SCHEDULE_WORD[schedule.declared] || 'when asked';
    return {
      main: 'Runs ' + when + ', as the ' + schedule.assistant.name + ' assistant.',
      note: schedule.assistant.kind && schedule.assistant.kind !== 'manual' && !schedule.automatic_runs_on
        ? 'Automatic runs are switched off in Settings, so today it runs when you send the assistant out.' : null,
    };
  }
  if (schedule.assistant_missing) return { main: 'Asks to be run by an assistant called "' + schedule.assistant_missing + '", which does not exist here.', note: 'Hire one with that name, or it only runs when an assistant picks it up.' };
  if (schedule.declared && schedule.declared !== 'manual') return { main: 'Asks to run ' + SCHEDULE_WORD[schedule.declared] + ', but names no assistant to run it.', note: 'A schedule belongs to an assistant. Until one is named, it runs when an assistant needs it.' };
  return { main: 'Runs when an assistant needs it.', note: 'It has no schedule of its own.' };
}

export default function Skills({ collections = [], onPickCollection, onNavigate }) {
  const [skills, setSkills] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [active, setActive] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [file, setFile] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    skillsApi.list().then(r => {
      if (!alive) return;
      const list = r.skills || [];
      setSkills(list);
      // Open on the workspace's own skill when there is one: it is the one the person wrote.
      const first = list.find(s => s.source === 'workspace') || list[0];
      if (first) setActive(first.id);
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  React.useEffect(() => {
    let alive = true;
    setDetail(null); setFile(null);
    if (!active) return undefined;
    skillsApi.read(active).then(d => { if (alive) setDetail(d); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [active]);

  const openFile = async f => {
    if (file && file.path === f.path) return setFile(null);
    if (f.kind === 'other') return setFile({ path: f.path, error: 'This is not a text file. Open the folder in Files to see it.' });
    try { setFile(await skillsApi.text(active, f.path)); } catch (e) { setFile({ path: f.path, error: e.message }); }
  };

  const groups = [['workspace', 'This workspace'], ['app', 'Built in']];
  const rowMeta = s => [
    s.reads.length + s.writes.length ? new Set([...s.reads, ...s.writes].map(c => c.id)).size + ' collections' : null,
    s.scripts ? s.scripts + (s.scripts === 1 ? ' script' : ' scripts') : null,
    s.schedule.assistant && s.schedule.assistant.kind && s.schedule.assistant.kind !== 'manual' ? s.schedule.assistant.kind : null,
  ].filter(Boolean);

  const list = skills ? groups.map(([source, label]) => {
    const mine = skills.filter(s => s.source === source);
    return (
      <ListGroup key={source} label={label} count={mine.length}>
        {mine.length
          ? mine.map(s => <ListRow key={s.id} on={s.id === active} title={s.name} text={s.description} meta={rowMeta(s)} onClick={() => setActive(s.id)} />)
          : <p className="pgNone">{source === 'workspace' ? 'None yet. A folder with a SKILL.md under skills/ in this workspace appears here.' : 'None.'}</p>}
      </ListGroup>
    );
  }) : <p className="pgNone">{error || 'Reading the skills folder…'}</p>;

  const runs = detail ? runsLine(detail.schedule) : null;
  const folder = detail ? 'skills/' + detail.folder : '';
  return (
    <Screen title="Skills"
      lead="What your assistants know how to do. A skill is a folder: instructions an assistant reads, plus any scripts and reference files it carries."
      list={list}>
      {!detail ? (
        <p className="pgNone pgPad">{error || (skills && !skills.length ? 'No skills on disk.' : 'Opening…')}</p>
      ) : (
        <article className="pgDoc">
          <div className="pgDocHead">
            <div className="pgKicker">{detail.source_label} skill</div>
            <h2 className="pgDocTitle">{detail.name}</h2>
            <p className="pgDocLead">{detail.description}</p>
          </div>

          <div className="pgFacts">
            <Fact label="Looks in">
              {detail.reads.length
                ? <span className="pgChips">{detail.reads.map(c => <CollectionChip key={c.id} {...c} collections={collections} onPick={onPickCollection} />)}</span>
                : detail.mentions.length
                  ? <><span className="pgChips">{detail.mentions.map(c => <CollectionChip key={c.id} {...c} collections={collections} onPick={onPickCollection} />)}</span><span className="pgNote">Not declared — these are the collections its instructions mention.</span></>
                  : <span className="pgMuted">It does not name a collection.</span>}
            </Fact>
            <Fact label="Writes to">
              {detail.writes.length
                ? <><span className="pgChips">{detail.writes.map(c => <CollectionChip key={c.id} {...c} collections={collections} onPick={onPickCollection} />)}</span><span className="pgNote">Through the record pipeline: an assistant's records arrive as proposals for you to accept.</span></>
                : <span className="pgMuted">Nothing declared.</span>}
            </Fact>
            <Fact label="Runs">
              <span>{runs.main}</span>
              {runs.note ? <span className="pgNote">{runs.note}</span> : null}
            </Fact>
            <Fact label="Folder">
              {detail.source === 'workspace' && onNavigate
                ? <button type="button" className="pgPath hAccent" style={{ fontFamily: MONO }} onClick={() => onNavigate('files', folder)}>{folder}/</button>
                : <span className="pgPath" style={{ fontFamily: MONO }}>{folder}/ <span className="pgMuted">in the app</span></span>}
            </Fact>
          </div>

          <section className="pgSection">
            <h3 className="pgSectionTitle">Files it carries <span style={{ fontFamily: MONO }}>{detail.files.length}</span></h3>
            {detail.files.length ? (
              <div className="pgFiles">
                {detail.files.map(f => (
                  <button key={f.path} type="button" className={'pgFile' + (file && file.path === f.path ? ' on' : '')} onClick={() => openFile(f)} aria-expanded={!!(file && file.path === f.path)}>
                    <span className={'pgFileKind ' + f.kind}>{KIND[f.kind]}</span>
                    <span className="pgFileName" style={{ fontFamily: MONO }}>{f.path}</span>
                    <span className="pgFileSize" style={{ fontFamily: MONO }}>{size(f.size)}</span>
                  </button>
                ))}
              </div>
            ) : <p className="pgMuted">Only its instructions. No scripts, no reference files.</p>}
            {file ? (file.error
              ? <p className="pgNote">{file.error}</p>
              : <pre className="pgSource" style={{ fontFamily: MONO }}>{file.content}</pre>) : null}
          </section>

          <section className="pgSection">
            <h3 className="pgSectionTitle">Instructions</h3>
            <div className="pgProse">
              <RichEditor key={detail.id} value={detail.body} readOnly toolbar={false} minHeight={0} />
            </div>
          </section>
        </article>
      )}
    </Screen>
  );
}
