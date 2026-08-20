// MEMORY — what your assistants run on: `me.md`, the playbook, the learnings, on ONE surface.
//
// T11 / docs/03_MEMORY.md §7.1. This screen is the app's trust contract made editable: the person
// reads, in their own words, what their assistants believe about them, and fixes it in place. No
// modal, no YAML, no field key on screen. "Last checked 4 days ago", never `verified_at:`.
//
// Props
//   onOpenPath(path)   Law 8 — every object prints its `.md` path and it is clickable. Required
//                      for the path chips to do anything; the chip renders read-only without it.
//   onWrote()          optional. Fired AFTER a memory write and its cache regeneration, so a host
//                      can refresh WHAT THEY KNOW. Not needed for correctness — the write and the
//                      regenerate both already happened.
//   actor              optional. Defaults to undefined, which makes the route default to the
//                      human. The UI never claims to be an agent (Law 4: the gate reads the actor).
//
// This file also owns the small shared pieces the other three memory screens import — `mono`,
// `fm`, `PathLink`, `Bar`, `stalenessOf`, `useResource`. They live here rather than in four copies
// because Law 10 says a second implementation is a bug, and rather than in `ui.jsx` because that
// file is owned by someone else this milestone.
//
// DECAY IS NOT COMPUTED HERE. docs/08_MODULE_CONTRACTS.md §2: "Never inline a second staleness
// rule anywhere. The frontend gets staleness from the API." `stalenessOf` reads the number the API
// sends and returns null when it has not sent one. `Freshness.jsx` remains the ONE renderer of age.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Card, Eyebrow, Empty, InlineEdit } from './ui';
import { Freshness } from './Freshness';
import { Markdown } from './Markdown';

// ── shared, imported by Goals / Territory / WhatTheyKnow ─────────────────────────────────────

export const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// The routes are not all landed yet and the ones that are do not agree on a wrapper key, so every
// list read goes through one normaliser instead of four hopeful destructures.
export function listOf(res, ...keys) {
  if (Array.isArray(res)) return res;
  for (const k of keys) if (Array.isArray(res?.[k])) return res[k];
  for (const v of Object.values(res || {})) if (Array.isArray(v)) return v;
  return [];
}

// Frontmatter, wherever the route decided to put it.
export function fm(item) {
  if (!item || typeof item !== 'object') return {};
  return item.data || item.fields || item.frontmatter || item;
}
export function bodyOf(item) { return String(item?.content ?? item?.body ?? ''); }
export function pathOf(item) { return item?.path || fm(item).path || ''; }
export function idOf(item) {
  const f = fm(item);
  if (item?.id) return String(item.id);
  if (f.id) return String(f.id);
  const p = pathOf(item);
  return p ? p.split('/').pop().replace(/\.md$/, '') : '';
}

// The date the age meter is drawn from. `verified_at` first, exactly as decay.mjs reads it.
export function checkedAt(item, ...extra) {
  const f = fm(item);
  for (const k of [...extra, 'verified_at', 'updated', 'created']) if (f[k]) return f[k];
  return null;
}

// The API's staleness, or null for "not told". Never derived — see the header note.
export function stalenessOf(item) {
  const f = fm(item);
  const n = item?.staleness ?? f.staleness;
  if (typeof n === 'number') return n;
  if (item?.stale === true || f.stale === true) return 1;
  return null;
}
export function isStale(item) { return stalenessOf(item) >= 1; }

// Law 3 — a stale thing RECEDES. One place decides how far, so a stale playbook claim and a stale
// territory tile fade by the same amount.
export function fadeFg(item, live = 'var(--fg-soft)') { return isStale(item) ? 'var(--fg-faint)' : live; }

// The path chip. Law 8: two clicks to the raw file, from anywhere.
export function PathLink({ path, onOpenPath, style }) {
  if (!path) return null;
  const base = { ...mono('font-size:9.5px;font-weight:500;letter-spacing:.02em;padding:2px 7px;border-radius:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), background: 'var(--sunk)', border: '1px solid var(--border)', color: 'var(--fg-faint)', ...style };
  if (!onOpenPath) return <span title={path} style={base}>{path}</span>;
  return (
    <button type="button" className="hBd" title={'Open ' + path} onClick={e => { e.stopPropagation(); onOpenPath(path); }}
      style={{ ...base, cursor: 'pointer' }}>{path}</button>
  );
}

// The continuous bar — yield, progress, budget. Deliberately NOT the freshness meter's shape
// (design/EXTRACT.md §4.3): staleness and productivity must not read alike.
export function Bar({ pct = 0, tone = 'var(--fg-soft)', height = 4 }) {
  const w = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <span style={{ ...sx('display:block;width:100%;border-radius:2px;background:var(--line);overflow:hidden'), height }}>
      <span style={{ ...sx('display:block;border-radius:2px'), height, width: w + '%', background: w > 0 ? tone : 'transparent' }} />
    </span>
  );
}

// SWEPT ▮▮▮▯▯ 4D AGO — the word, then the one meter, then its own label.
export function Age({ word, value }) {
  return (
    <span style={sx('display:inline-flex;align-items:center;gap:7px')}>
      <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>{word}</span>
      <Freshness value={value} />
    </span>
  );
}

// One loader for every memory screen: pending / failed / loaded, with a reload that does not blank
// the surface while it is in flight.
export function useResource(load, deps = []) {
  const [state, setState] = React.useState({ data: null, error: null, loading: true });
  const alive = React.useRef(true);
  const run = React.useCallback(async () => {
    try {
      const data = await load();
      if (alive.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (alive.current) setState(s => ({ data: s.data, error: e, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  React.useEffect(() => { alive.current = true; run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: run };
}

export function Loading({ what = 'MEMORY' }) {
  return (
    <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
      <span style={{ ...mono('font-size:10px;font-weight:700;letter-spacing:.14em'), color: 'var(--fg-faint)' }}>READING {what}…</span>
    </div>
  );
}

export function Failed({ error, title = 'NOTHING HERE YET', body }) {
  return (
    <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
      <Empty size="page" style={sx('max-width:460px')} title={title} body={body || (error ? String(error.message || error) : null)} />
    </div>
  );
}

// The screen banner. Every memory screen states the causal link in the same voice: this is what
// they read, and changing it changes what they do.
export function ScreenHead({ eyebrow, line, right, children }) {
  return (
    <section style={sx('flex:none;padding:18px 20px;background:var(--surface);border-bottom:1px solid var(--line);display:flex;align-items:flex-start;justify-content:space-between;gap:24px')}>
      <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:8px')}>
        <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{eyebrow}</Eyebrow>
        <p style={sx('margin:0;font-size:16px;font-weight:400;line-height:1.45;color:var(--fg-soft);max-width:74ch')}>{line}</p>
        {children}
      </div>
      {right ? <div style={sx('flex:none;display:flex;align-items:center;gap:10px')}>{right}</div> : null}
    </section>
  );
}

// The one sentence that makes the causal link true instead of implied. It is shown on every memory
// screen after a write lands, because "I changed something and nothing visibly happened" is how a
// person stops believing the memory is real.
export function SaveNote({ state }) {
  if (!state) return null;
  const tone = state.kind === 'error' ? 'var(--danger)' : state.kind === 'saving' ? 'var(--marked)' : 'var(--ok)';
  return (
    <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.1em;white-space:nowrap'), color: tone }}>{state.text}</span>
  );
}

// Every memory write goes through here so the regenerate can never be forgotten: the cache IS what
// the assistants read (Law 7), and a memory edit that does not reach it did not happen.
export function useMemoryWriter(onWrote) {
  const [note, setNote] = React.useState(null);
  const save = React.useCallback(async (label, fn) => {
    setNote({ kind: 'saving', text: 'SAVING…' });
    try {
      await fn();
      try { await api.regenerate(); } catch { /* the file is written; the cache catches up on its own debounce */ }
      setNote({ kind: 'ok', text: (label || 'SAVED') + ' · YOUR ASSISTANTS READ THE NEW VERSION' });
      onWrote && onWrote();
      return true;
    } catch (e) {
      setNote({ kind: 'error', text: 'NOT SAVED — ' + String(e.message || e).toUpperCase() });
      return false;
    }
  }, [onWrote]);
  return { note, save };
}

// ── me.md, as blocks a person can edit ───────────────────────────────────────────────────────
// The body is split into headings and paragraphs and rejoined on every commit. Nothing else in the
// file is touched, and the frontmatter is passed straight back — provenance stamping belongs to
// backend/memory.mjs, not to this screen.

export function splitBlocks(body) {
  const out = [];
  let buf = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) out.push({ kind: 'para', text: t }); buf = []; };
  for (const ln of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) { flush(); out.push({ kind: 'heading', level: h[1].length, text: h[2].trim() }); continue; }
    if (!ln.trim()) { flush(); continue; }
    buf.push(ln);
  }
  flush();
  return out;
}

export function joinBlocks(blocks) {
  const text = blocks
    .filter(b => String(b.text || '').trim())
    .map(b => (b.kind === 'heading' ? '#'.repeat(b.level || 2) + ' ' + b.text : b.text))
    .join('\n\n');
  return text ? text + '\n' : '';
}

const PARA_READ = sx('white-space:normal;overflow:visible;text-overflow:clip;font-size:13.5px;line-height:1.7;color:var(--fg-soft);padding:2px 0');
const PARA_EDIT = sx('font-size:13.5px;line-height:1.7;min-height:96px');

function AboutYou({ me, onOpenPath, onSave }) {
  const [confirm, setConfirm] = React.useState(null);
  const blocks = splitBlocks(bodyOf(me));
  const data = fm(me);
  const path = pathOf(me) || 'me.md';

  const commit = next => onSave('SAVED', () => api.saveMe(joinBlocks(next), data));
  const setAt = (i, text) => { const next = blocks.map((b, j) => (j === i ? { ...b, text } : b)); return commit(next); };
  const removeAt = i => commit(blocks.filter((_, j) => j !== i));
  const add = () => commit([...blocks, { kind: 'para', text: 'Write the new line here.' }]);

  return (
    <Card style={sx('background:var(--surface);border-color:var(--border)')}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px')}>
        <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
          <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.16em;color:var(--fg-muted)')}>ABOUT YOU</Eyebrow>
          <Age word="CHECKED" value={checkedAt(me)} />
        </div>
        <PathLink path={path} onOpenPath={onOpenPath} />
      </div>
      <p style={sx('margin:0 0 14px;font-size:11.5px;line-height:1.6;color:var(--fg-faint);max-width:70ch')}>
        Every assistant reads this in full before it starts. Click any line to change it.
      </p>

      <div style={sx('display:flex;flex-direction:column;gap:12px')}>
        {blocks.length === 0 ? (
          <Empty title="YOU HAVE NOT TOLD THEM ANYTHING YET" body="Write one line about what you are looking for and what a win looks like. That one line is what they work from." />
        ) : blocks.map((b, i) => (
          b.kind === 'heading' ? (
            <div key={'h' + i} style={sx('display:flex;align-items:center;gap:10px;padding-top:6px')}>
              <InlineEdit
                value={b.text}
                onCommit={v => setAt(i, v)}
                placeholder="A heading"
                style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase'), color: 'var(--fg-muted)', display: 'inline-block' }}
              />
              <span style={sx('flex:1;height:1px;background:var(--line)')} />
            </div>
          ) : (
            <div key={'p' + i} className="rvH" style={sx('display:flex;flex-direction:column;gap:5px')}>
              <InlineEdit
                multiline
                value={b.text}
                onCommit={v => setAt(i, v)}
                placeholder="Click to write"
                style={PARA_READ}
                inputStyle={PARA_EDIT}
              />
              <span style={sx('display:flex;align-items:center;gap:10px')}>
                <button type="button" className="rv hFgL"
                  onClick={() => (confirm === i ? removeAt(i) : setConfirm(i))}
                  onBlur={() => setConfirm(c => (c === i ? null : c))}
                  style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.1em;background:none;border:none;padding:0;cursor:pointer'), color: confirm === i ? 'var(--danger)' : 'var(--fg-faint)' }}>
                  {confirm === i ? 'CLICK AGAIN TO REMOVE' : 'REMOVE THIS LINE'}
                </button>
              </span>
            </div>
          )
        ))}
      </div>

      <div style={sx('display:flex;align-items:center;gap:10px;margin-top:14px')}>
        <Btn size="sm" variant="secondary" onClick={add}>+ Add a line</Btn>
      </div>
    </Card>
  );
}

// ── the playbook ─────────────────────────────────────────────────────────────────────────────
// A claim, its evidence, and its age. A claim past its window is excluded from what the assistants
// read — and it says so, on the card, while its file stays exactly where it is (Law 5).

function EvidenceLinks({ evidence, onOpenPath }) {
  const links = [].concat(evidence || []).filter(Boolean).map(String);
  if (!links.length) {
    return <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.1em'), color: 'var(--warn)' }}>NOTHING BACKS THIS UP YET</span>;
  }
  return (
    <span style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:6px')}>
      <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>
        {links.length === 1 ? '1 THING PROVES IT' : links.length + ' THINGS PROVE IT'}
      </span>
      {links.map((l, i) => {
        // Evidence arrives as a wikilink (`[[data/guests/maria-santos]]`) or as a bare path.
        const inner = l.replace(/^\[\[|\]\]$/g, '');
        const p = /\.md$/.test(inner) ? inner : inner + '.md';
        return <PathLink key={i} path={p} onOpenPath={onOpenPath} style={{ maxWidth: 260 }} />;
      })}
    </span>
  );
}

function ClaimCard({ item, kind, onOpenPath, onSave }) {
  const f = fm(item);
  const id = idOf(item);
  const stale = isStale(item);

  const save = (label, patch) => onSave(label, () =>
    (kind === 'playbook' ? api.savePlaybook(id, patch) : api.saveLearning(id, patch)));
  const today = new Date().toISOString().slice(0, 10);

  // The SHAPED fields first (backend/memory.mjs `shapePlaybook` / `shapeLearning`): they already
  // fall back from `claim` to the body's first real line, which is the sentence the cache shows.
  // Reading only the frontmatter would leave a claim written in the body looking blank here.
  const headline = item.title || item.claim || f.claim || f.title || f.label || id;
  const oneLine = (kind === 'playbook' ? (item.line || f.summary) : (f.summary || item.line)) || f.one_line || f.note || '';
  const evidence = item.evidence || f.evidence;
  const wins = item.wins != null ? item.wins : f.wins;
  const status = String(item.status || f.status || '').toLowerCase();
  const retiredBecause = String(item.retiredBecause || f.retired_because || '').trim();
  const retired = status === 'retired';
  const proposed = status === 'proposed';

  return (
    <Card
      style={{
        ...sx('background:var(--surface-2);border-color:var(--border)'),
        ...(stale || retired ? { background: 'var(--surface)', borderColor: 'var(--line)' } : null),
      }}>
      <div style={sx('display:flex;align-items:flex-start;justify-content:space-between;gap:12px')}>
        <InlineEdit
          value={headline}
          // A playbook entry has BOTH a title and a claim and they are different things — the
          // title is what the cache lists, the claim is the sentence it proves. Writing one into
          // the other would silently destroy the second (backend/memory.mjs shapePlaybook).
          onCommit={v => save('SAVED', kind === 'playbook' ? { title: v } : { claim: v })}
          placeholder={kind === 'playbook' ? 'Name what works' : 'What did they learn?'}
          style={{ ...sx('white-space:normal;overflow:visible;text-overflow:clip;font-size:13.5px;font-weight:600;line-height:1.4'), color: fadeFg(item, 'var(--fg)') }}
        />
        <span style={sx('flex:none;display:flex;align-items:center;gap:10px')}>
          {typeof wins === 'number' && wins > 0 ? (
            <span style={{ ...mono('font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-muted)' }}>
              {wins} {wins === 1 ? 'WIN' : 'WINS'}
            </span>
          ) : null}
          <Age word="CHECKED" value={checkedAt(item)} />
        </span>
      </div>

      <div style={sx('margin-top:8px')}>
        <InlineEdit
          multiline
          value={oneLine}
          onCommit={v => save('SAVED', kind === 'playbook' ? { claim: v } : { summary: v })}
          placeholder="Add the one line they should remember"
          style={{ ...sx('white-space:normal;overflow:visible;text-overflow:clip;font-size:12px;line-height:1.6'), color: fadeFg(item, 'var(--fg-soft)') }}
          inputStyle={sx('font-size:12px;line-height:1.6;min-height:56px')}
        />
      </div>

      {bodyOf(item).trim() ? (
        <div className="mdBody" style={sx('margin-top:10px;font-size:12px;color:var(--fg-muted)')}>
          <Markdown text={bodyOf(item)} />
        </div>
      ) : null}

      <div style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:11px')}>
        <EvidenceLinks evidence={evidence} onOpenPath={onOpenPath} />
      </div>

      {stale ? (
        <div style={{ ...sx('display:flex;flex-direction:column;gap:4px;margin-top:11px;padding:9px 11px;border-radius:8px'), background: 'var(--sunk)', border: '1px solid var(--border)' }}>
          <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.14em'), color: 'var(--warn)' }}>YOUR ASSISTANTS ARE NOT READING THIS</span>
          <span style={sx('font-size:11.5px;line-height:1.55;color:var(--fg-faint)')}>
            Nobody has checked it for a while, so it has dropped out of what they read on waking. The note itself is untouched — say it still works and it goes straight back in.
          </span>
        </div>
      ) : null}

      {retired ? (
        <div style={sx('margin-top:11px')}>
          <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.14em'), color: 'var(--fg-faint)' }}>RETIRED — KEPT SO NOBODY TRIES IT AGAIN</span>
          {retiredBecause ? <div style={sx('font-size:11.5px;line-height:1.55;color:var(--fg-faint);margin-top:4px')}>{retiredBecause}</div> : null}
        </div>
      ) : null}

      <div style={sx('display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding-top:11px;border-top:1px solid var(--line)')}>
        <span style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:7px')}>
          <Btn size="sm" variant={stale ? 'secondary' : 'ghost'} onClick={() => save('CONFIRMED', { verified_at: today, status: 'active' })}>
            {stale ? 'It still works' : 'Still true today'}
          </Btn>
          {retired
            ? <Btn size="sm" variant="ghost" onClick={() => save('BACK IN', { status: 'active', verified_at: today })}>Use it again</Btn>
            : <Btn size="sm" variant="ghost" onClick={() => save('RETIRED', { status: 'retired' })}>Stop using this</Btn>}
          {proposed ? <Btn size="sm" variant="secondary" onClick={() => save('KEPT', { status: 'active', verified_at: today })}>Keep it</Btn> : null}
        </span>
        <PathLink path={pathOf(item)} onOpenPath={onOpenPath} />
      </div>
    </Card>
  );
}

// Law 2 — the surface opens at the thing that needs a decision. A claim waiting for your yes comes
// first, then one that has gone stale and wants re-confirming, then the ones doing their job, and
// last the retired ones, which are kept only so nobody tries them again.
function byAttention(a, b) {
  const rank = x => {
    const st = String(x.status || fm(x).status || '').toLowerCase();
    if (st === 'proposed') return 0;
    if (st === 'retired') return 3;
    return isStale(x) ? 1 : 2;
  };
  const d = rank(a) - rank(b);
  if (d) return d;
  return (stalenessOf(b) ?? 0) - (stalenessOf(a) ?? 0);
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────

export default function Memory({ onOpenPath, onWrote }) {
  const { data, error, loading, reload } = useResource(
    () => Promise.all([
      api.me().catch(e => ({ __error: e })),
      api.playbook().catch(e => ({ __error: e })),
      api.learnings().catch(e => ({ __error: e })),
    ]).then(([me, playbook, learnings]) => ({ me, playbook, learnings })),
    []
  );
  const writer = useMemoryWriter(() => { reload(); onWrote && onWrote(); });
  const save = (label, fn) => writer.save(label, fn);

  if (loading && !data) return <Loading what="MEMORY" />;

  const meRes = data?.me;
  const me = meRes && !meRes.__error ? (meRes.me || meRes) : null;
  const playbook = (data?.playbook?.__error ? [] : listOf(data?.playbook, 'playbook', 'claims', 'items')).slice().sort(byAttention);
  const learnings = (data?.learnings?.__error ? [] : listOf(data?.learnings, 'learnings', 'items')).slice().sort(byAttention);
  const firstError = meRes?.__error || data?.playbook?.__error || data?.learnings?.__error || error;

  if (!me && !playbook.length && !learnings.length) {
    return <Failed error={firstError} title="MEMORY IS EMPTY" body={firstError ? String(firstError.message || firstError) : 'Nothing has been written to me.md, the playbook or the learnings yet.'} />;
  }

  return (
    <div style={sx('flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden')}>
      <ScreenHead
        eyebrow="WHAT YOUR ASSISTANTS RUN ON"
        line="This page is what they read before they start. Change a line here and they work differently tomorrow — you do not have to explain it again."
        right={<SaveNote state={writer.note} />}
      />

      <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:18px 20px 32px;display:flex;flex-direction:column;gap:22px')}>
        {me ? <AboutYou me={me} onOpenPath={onOpenPath} onSave={save} /> : null}

        <section style={sx('display:flex;flex-direction:column;gap:10px')}>
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-soft)')}>WHAT WORKS</Eyebrow>
            <span style={{ ...mono('font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>{playbook.length}</span>
            <span style={sx('flex:1;height:1px;background:var(--line)')} />
            <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>PROVEN, WITH THE PROOF ATTACHED</span>
          </div>
          {playbook.length
            ? playbook.map(p => <ClaimCard key={idOf(p) || pathOf(p)} item={p} kind="playbook" onOpenPath={onOpenPath} onSave={save} />)
            : <Empty title="NOTHING PROVEN YET" body="When something works twice, your assistants will propose it here with the evidence. You decide whether it stays." />}
        </section>

        <section style={sx('display:flex;flex-direction:column;gap:10px')}>
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-soft)')}>WHAT THEY HAVE LEARNED</Eyebrow>
            <span style={{ ...mono('font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>{learnings.length}</span>
            <span style={sx('flex:1;height:1px;background:var(--line)')} />
            <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>THEY PROPOSE · YOU KEEP OR DROP</span>
          </div>
          {learnings.length
            ? learnings.map(l => <ClaimCard key={idOf(l) || pathOf(l)} item={l} kind="learning" onOpenPath={onOpenPath} onSave={save} />)
            : <Empty title="NOTHING LEARNED YET" body="Every time you reject something with a reason, they get one step closer to a rule worth keeping." />}
        </section>

        <p style={sx('margin:0;font-size:11px;line-height:1.6;color:var(--fg-faint);max-width:70ch')}>
          Nothing here is hidden: every card above is one plain markdown file on your disk, and the
          path on it opens the file itself.
        </p>
      </div>
    </div>
  );
}
