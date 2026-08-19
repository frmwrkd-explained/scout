// Manual Inbox — the IN half of the round-trip (backend/manual.mjs).
//
// The user rendered somewhere else and dropped the downloads into projects/<pid>/inbox/. This
// screen is one job: turn a pile of `Flow_20260730_1a2b3c.mp4` into candidates attached to the
// right shots, with the user in the loop for anything the machine isn't sure about.
//
// Design decisions worth not undoing:
//
// · NOTHING is filed without a click. The scan proposes; Import applies. A cheap model quietly
//   moving someone's hero shot onto the wrong scene is the one failure this feature can't afford,
//   so the AI tier is a *suggestion channel*, never an actor. This is also why every row shows
//   `matchedBy` and a confidence — a proposal you can't audit is a proposal you can't trust.
// · Low-confidence rows are PRE-DESELECTED, not hidden. Hiding them would make "Import all" quietly
//   incomplete; deselecting makes the residue visible and one click away.
// · Unmatched files can still be imported (shot = —). They land as shot-less candidates in the
//   review inbox rather than rotting in a folder nobody opens again.
// · The review chips are MediaAction, the tiles are RenderTile, the buttons are Btn — this screen
//   introduces no new visual language (CLAUDE.md "Shared UI").
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Btn, Empty } from './ui';
import { RenderTile, RenderLightbox, MediaAction } from './RenderMedia';
import { MONO } from './tokens';

// Below this, a proposal arrives unchecked. 0.5 is the agent prompt's own stated "someone must
// check this" line — keep the two in step if either moves (backend/manual.mjs sortPrompt).
const TRUST = 0.5;

const pct = c => Math.round((Number(c) || 0) * 100) + '%';
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
// how a match was made, in the two words a director needs — not the enum name
const SOURCE = {
  filename: ['filename', 'var(--ok)'],
  order: ['handoff order', 'var(--accent)'],
  agent: ['AI sort', '#5B9DFF'],
  manual: ['you', 'var(--fg-soft)'],
  none: ['unmatched', 'var(--fg-faint)']
};

export default class ManualInbox extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true, scanning: false, sorting: false, importing: false,
      files: [], counts: null, handoff: null, dir: '',
      rows: [],          // [{ file, shot, confidence, matchedBy, why, prompt, ... , take:bool }]
      err: '', drag: false, zoom: null
    };
  }
  componentDidMount() { this.scan(); }

  shots() { return (this.props.app.state.shots || []).filter(s => s.proj === this.props.pid); }

  // rows carry a `take` flag — the user's accept/reject — seeded from confidence and preserved
  // across a re-scan so a manual correction isn't wiped by clicking Scan again.
  merge(proposals) {
    const prev = new Map(this.state.rows.map(r => [r.file, r]));
    return proposals.map(p => {
      const old = prev.get(p.file);
      // a row the user has already touched keeps THEIR decision — the scan is advisory
      if (old && old.touched) return { ...p, shot: old.shot, take: old.take, touched: true, matchedBy: old.matchedBy, why: old.why };
      return { ...p, take: !!p.shot && p.confidence >= TRUST, touched: false };
    });
  }

  async scan() {
    const { pid, app } = this.props;
    this.setState({ scanning: true, err: '' });
    try {
      const r = await api.manualScan(pid, this.state.handoff ? this.state.handoff.id : null);
      this.setState({
        loading: false, scanning: false, files: r.files, counts: r.counts,
        handoff: r.handoff, rows: this.merge(r.proposals)
      });
    } catch (e) {
      this.setState({ loading: false, scanning: false, err: e.message });
      app.showToast(e.message, 'var(--danger)');
    }
  }

  // The AI tier, deliberately scoped to the residue by default: paying a model to re-confirm what
  // the filename already proved is the exact waste this workflow exists to avoid.
  async sort(all = false) {
    const { pid, app } = this.props;
    const target = this.state.rows.filter(r => all || !r.shot).map(r => r.file);
    if (!target.length) return app.showToast('Nothing left for the AI to sort — every file already matched', 'var(--ok)');
    this.setState({ sorting: true, err: '' });
    try {
      const r = await api.manualSort(pid, { files: target });
      const by = new Map(r.proposals.map(p => [p.file, p]));
      this.setState(s => ({
        sorting: false,
        rows: s.rows.map(row => {
          const p = by.get(row.file);
          if (!p || row.touched) return row;
          return { ...row, ...p, take: !!p.shot && p.confidence >= TRUST };
        })
      }));
      const hit = r.proposals.filter(p => p.shot).length;
      app.showToast(
        hit + ' of ' + target.length + ' matched by ' + r.model +
        (r.skipped ? ' · ' + r.skipped + ' skipped (over the per-run cap)' : ''),
        hit ? 'var(--ok)' : 'var(--danger)'
      );
    } catch (e) {
      this.setState({ sorting: false, err: e.message });
      app.showToast(e.message, 'var(--danger)');
    }
  }

  async importSelected() {
    const { pid, app } = this.props;
    const take = this.state.rows.filter(r => r.take);
    if (!take.length) return app.showToast('Nothing selected to import', 'var(--fg-faint)');
    this.setState({ importing: true });
    try {
      const r = await api.manualApply(pid, take.map(t => ({
        file: t.file, shot: t.shot || null, prompt: t.prompt || '',
        intendedModel: t.intendedModel || '', matchedBy: t.matchedBy || 'manual',
        confidence: t.confidence || 0, handoff: t.handoff || null
      })));
      await app.sync();
      this.setState({ importing: false, rows: [] });
      this.scan();
      const msg = r.applied.length + ' imported → review inbox' +
        (r.skipped.length ? ' · ' + r.skipped.length + ' skipped (' + r.skipped[0].reason + ')' : '');
      app.showToast(msg, r.applied.length ? 'var(--ok)' : 'var(--danger)');
    } catch (e) {
      this.setState({ importing: false });
      app.showToast(e.message, 'var(--danger)');
    }
  }

  async onDrop(e) {
    e.preventDefault();
    this.setState({ drag: false });
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    const { pid, app } = this.props;
    let ok = 0;
    for (const f of files) { try { await api.manualUpload(pid, f); ok++; } catch { /* reported below */ } }
    app.showToast(ok + ' of ' + files.length + ' added to the inbox', ok ? 'var(--ok)' : 'var(--danger)');
    this.scan();
  }

  setRow(file, patch) {
    this.setState(s => ({ rows: s.rows.map(r => r.file === file ? { ...r, ...patch, touched: true } : r) }));
  }

  header() {
    const { app, pid, onClose } = this.props;
    const S = this.state;
    const c = S.counts || {};
    const take = S.rows.filter(r => r.take).length;
    return (
      <div style={sx('flex:none;display:flex;align-items:center;gap:14px;padding:13px 22px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <span style={{ ...sx('font-weight:700;color:var(--accent)'), fontFamily: MONO, fontSize: 11 }}>INBOX</span>
        <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>
          {c.ready || 0} ready · {c.matched || 0} matched · {c.unmatched || 0} unmatched
          {c.settling ? ' · ' + c.settling + ' still downloading' : ''}
          {c.partial ? ' · ' + c.partial + ' part-files' : ''}
        </span>
        {S.handoff && (
          <span title={'matching order against ' + S.handoff.id}
            style={{ ...sx('padding:3px 9px;border-radius:999px;border:1px solid var(--accent-35);color:var(--accent)'), fontFamily: MONO, fontSize: 9.5 }}>
            {S.handoff.id} · {S.handoff.shots.length} shots{S.handoff.perShot > 1 ? ' × ' + S.handoff.perShot : ''}
          </span>
        )}
        <div style={sx('margin-left:auto;display:flex;align-items:center;gap:8px')}>
          <Btn size="sm" onClick={() => api.manualReveal(pid).then(r => app.showToast('Opened ' + r.dir, 'var(--accent)'))}>Reveal folder</Btn>
          <Btn size="sm" busy={S.scanning} onClick={() => this.scan()}>{S.scanning ? 'Scanning…' : 'Scan'}</Btn>
          <Btn size="sm" variant="secondary" busy={S.sorting} onClick={() => this.sort(false)}
            title="Ask your agent CLI to look at the unmatched files and match them to shots">
            {S.sorting ? 'Sorting…' : 'AI sort unmatched'}
          </Btn>
          <Btn size="sm" variant="primary" busy={S.importing} disabled={!take}
            onClick={() => this.importSelected()}>
            {S.importing ? 'Importing…' : 'Import ' + take}
          </Btn>
          <span onClick={onClose} className="hFg" style={{ ...sx('cursor:pointer;padding-left:6px'), fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-faint)' }}>✕ Esc</span>
        </div>
      </div>
    );
  }

  row(r) {
    const { pid } = this.props;
    const [srcLabel, srcColor] = SOURCE[r.matchedBy] || SOURCE.none;
    const shots = this.shots();
    const low = r.shot && r.confidence < TRUST;
    return (
      <div key={r.file} style={{
        ...sx('display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:var(--surface)'),
        borderColor: r.take ? 'var(--accent-35)' : 'var(--line)'
      }}>
        <input type="checkbox" checked={!!r.take} onChange={e => this.setRow(r.file, { take: e.target.checked })}
          style={sx('accent-color:var(--accent);width:15px;height:15px;flex:none;cursor:pointer')} />
        <RenderTile src={api.manualFileUrl(pid, r.file)} kind={r.kind} aspect="16/9" fit="cover"
          onClick={() => this.setState({ zoom: r })} style={sx('width:104px;flex:none')} idleColor="var(--border)" />
        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:3px')}>
          <span title={r.file} style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 11 }}>{r.file}</span>
          <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
            <span style={{ color: srcColor }}>{srcLabel}</span>
            {r.shot ? ' · ' + pct(r.confidence) + ' confident' : ''} · {r.why}
            {r.existingTakes ? ' · shot already has ' + r.existingTakes + ' take' + (r.existingTakes === 1 ? '' : 's') : ''}
          </span>
        </div>
        {/* the correction control. A <select> because "which of my 40 shots" is a list problem,
            and because a wrong AI match must be one interaction from right, not a drag. */}
        <select value={r.shot || ''} onChange={e => this.setRow(r.file, {
          shot: e.target.value || null, matchedBy: 'manual', confidence: e.target.value ? 1 : 0,
          why: e.target.value ? 'you assigned it' : 'you cleared it', take: !!e.target.value,
          prompt: (shots.find(s => s.id === e.target.value) || {}).prompt || r.prompt
        })}
          style={{
            ...sx('flex:none;width:210px;padding:6px 9px;border-radius:7px;background:var(--sunk);color:var(--fg-soft);border:1px solid var(--border-2);cursor:pointer'),
            fontFamily: MONO, fontSize: 10.5, borderColor: low ? 'var(--danger)' : 'var(--border-2)'
          }}>
          <option value="">— no shot (import loose) —</option>
          {shots.map(s => <option key={s.id} value={s.id}>{s.id} · {s.title || 'untitled'}</option>)}
        </select>
        <span style={{ ...sx('flex:none;color:var(--fg-faint);width:60px;text-align:right'), fontFamily: MONO, fontSize: 9.5 }}>{kb(r.size)}</span>
        <MediaAction label="Discard" tone="danger"
          onClick={() => api.manualDiscard(this.props.pid, r.file).then(() => this.scan())} />
      </div>
    );
  }

  render() {
    const S = this.state;
    const { app, pid } = this.props;
    const matched = S.rows.filter(r => r.shot);
    const loose = S.rows.filter(r => !r.shot);
    return (
      <div style={sx('position:fixed;inset:0;z-index:70;background:var(--void);display:flex;flex-direction:column')}
        onDragOver={e => { e.preventDefault(); if (!S.drag) this.setState({ drag: true }); }}
        onDragLeave={() => this.setState({ drag: false })}
        onDrop={e => this.onDrop(e)}>
        {this.header()}
        <div style={sx('flex:1;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:8px')}>
          {S.drag && (
            <div style={sx('padding:26px;border:1.5px dashed var(--accent-35);border-radius:12px;text-align:center;color:var(--accent);font-size:12px')}>
              Drop to add to the inbox
            </div>
          )}
          {S.loading && <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 11 }}>Reading the inbox…</span>}
          {!S.loading && !S.rows.length && (
            <Empty size="page"
              title="Nothing in the inbox — drop files here"
              body={'Drag your downloads onto this window, or click to open projects/' + pid + '/inbox/ in Finder. Hand prompts out from Story → Handoff first and FrameForge can match them back by download order alone — no renaming needed.'}
              action={{
                label: 'Open the inbox folder',
                onClick: () => api.manualReveal(pid).then(r => app.showToast('Opened ' + r.dir, 'var(--accent)'))
              }} />
          )}
          {matched.length > 0 && <>
            <span style={{ ...sx('color:var(--fg-faint);padding-top:4px'), fontFamily: MONO, fontSize: 9.5 }}>
              MATCHED — {matched.length}. Anything under {Math.round(TRUST * 100)}% arrives unchecked; look at it before importing.
            </span>
            {matched.map(r => this.row(r))}
          </>}
          {loose.length > 0 && <>
            <span style={{ ...sx('color:var(--fg-faint);padding-top:10px'), fontFamily: MONO, fontSize: 9.5 }}>
              UNMATCHED — {loose.length}. Assign a shot, run the AI sort, or import them loose into the review inbox.
            </span>
            {loose.map(r => this.row(r))}
          </>}
          {S.err && <span style={{ ...sx('color:var(--danger)'), fontFamily: MONO, fontSize: 10.5 }}>{S.err}</span>}
        </div>
        {S.zoom && (
          <RenderLightbox src={api.manualFileUrl(pid, S.zoom.file)} kind={S.zoom.kind} keyboard
            onClose={() => this.setState({ zoom: null })}
            title={S.zoom.file}
            meta={[S.zoom.shot ? S.zoom.shot + ' · ' + pct(S.zoom.confidence) : 'unmatched', kb(S.zoom.size)]}
            // the prompt this file was probably rendered from — the whole point of the zoom is
            // judging "is this that shot?", which you cannot do without the prompt in frame
            caption={S.zoom.prompt || ''} />
        )}
      </div>
    );
  }
}
