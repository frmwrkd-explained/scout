// TERRITORY — the ground your assistants work, and the ground they must never touch again.
//
// T11 / docs/03_MEMORY.md §3. `design/Territory.dc.html` is the visual truth and its style strings
// are ported verbatim through `sx()` (design/EXTRACT.md §4.1): banded sections, one tile per place,
// the 5-segment freshness meter, a continuous yield bar, a rule pill, and a dashed edge wherever
// you cannot work yet.
//
// Sorted by staleness × hit_rate — docs/03_MEMORY.md §4: "Territory sorted by staleness × hit_rate
// gives 'what should I sweep next' for free." The top tile of WORKING GROUND is the answer.
//
// `finds`, `wins` and `hit_rate` are ROLLUPS. backend/territory.mjs is their sole writer and it
// strips them from any patch (docs/08_MODULE_CONTRACTS.md §4), so they render read-only here and
// the screen says why. Only `access`, `sweep_interval_days` and `rules` are editable.
//
// Props
//   onOpenPath(path)   Law 8 — every tile prints its `.md` path and it is clickable.
//   onWrote()          optional. Fired after a territory write and its cache regeneration.

import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Btn, Empty, InlineEdit } from './ui';
import { freshnessOf } from './Freshness';
import {
  mono, listOf, fm, pathOf, idOf, checkedAt, stalenessOf,
  PathLink, Bar, Age, useResource, useMemoryWriter, SaveNote, Loading, Failed, ScreenHead,
} from './Memory';

// ── the five access states, in the person's words ────────────────────────────────────────────
// The state is a fact about the world, not a status label, so it is written the way she would say
// it. `rejected` carries the sentence that makes it worth as much as a win (docs/03 §3).
export const ACCESS = {
  joined:    { word: "You're in",        band: 'working', dot: 'var(--ok)',      dotBd: 'var(--ok)',      dash: false },
  requested: { word: 'Waiting on them',  band: 'waiting', dot: 'var(--marked)',  dotBd: 'var(--marked)',  dash: true },
  untried:   { word: 'Never tried',      band: 'untried', dot: 'transparent',    dotBd: 'var(--border-3)', dash: true },
  rejected:  { word: 'They said no',     band: 'locked',  dot: 'transparent',    dotBd: 'var(--border-3)', dash: false },
  banned:    { word: 'You were removed', band: 'locked',  dot: 'var(--danger)',  dotBd: 'var(--danger)',  dash: false },
};
const ACCESS_ORDER = ['untried', 'requested', 'joined', 'rejected', 'banned'];

const BANDS = [
  { key: 'working', name: 'WORKING GROUND',     fg: 'var(--fg-soft)',  note: 'SWEPT ON A SCHEDULE' },
  { key: 'waiting', name: 'WAITING ON SOMEONE', fg: 'var(--marked)',   note: "YOU CAN'T WORK HERE YET" },
  { key: 'untried', name: 'NEVER TRIED',        fg: 'var(--fg-muted)', note: 'NOTHING SPENT HERE' },
  { key: 'locked',  name: 'LOCKED OUT',         fg: 'var(--fg-faint)', note: 'KEPT SO NOTHING IS RETRIED BY MISTAKE' },
];

function accessOf(t) {
  const a = String(fm(t).access || 'untried').toLowerCase();
  return ACCESS[a] ? a : 'untried';
}

// The rollups, exactly as backend/territory.mjs shapes them: `stats` sits ALONGSIDE the
// frontmatter so a number someone typed into the file can never be mistaken for the rollup.
// `hit_rate` is a PERCENTAGE with one decimal there (`rate()` — 8.5 means 8.5%), so it is read as
// one here rather than guessed at from its magnitude.
function statsOf(t) {
  const f = fm(t);
  const s = t && t.stats ? t.stats : null;
  const finds = Number(s ? s.finds : f.finds) || 0;
  const wins = Number(s ? s.wins : f.wins) || 0;
  const rate = s && s.hit_rate != null ? Number(s.hit_rate) : (finds ? (wins / finds) * 100 : 0);
  return { finds, wins, pct: Math.max(0, Math.min(100, rate || 0)) };
}

// The sweep-next score. `staleness` is the API's number when it has one — this file never computes
// a staleness (docs/08 §2). When it has none, the ORDERING falls back to the coarse scale the one
// freshness renderer already draws, which is enough to rank tiles and is never used to call
// anything stale on screen.
function sweepScore(t) {
  const s = stalenessOf(t);
  const age = s != null ? Math.min(1, s) : (5 - freshnessOf(sweptAt(t)).filled) / 5;
  return age * statsOf(t).pct;
}

// The age line says what actually happened, not one word for five different situations: a place
// you have never worked has not been "swept 1d ago" just because its file was written then, and a
// place that turned you down is dated from the day it turned you down.
const AGE_WORD = {
  joined:    t => ['SWEPT', fm(t).last_swept || null],
  untried:   t => ['SEEN', fm(t).last_swept || null],
  requested: t => ['ASKED', fm(t).access_changed || fm(t).updated || null],
  rejected:  t => ['SAID NO', fm(t).access_changed || fm(t).updated || null],
  banned:    t => ['REMOVED', fm(t).access_changed || fm(t).updated || null],
};
function ageLine(t) { return AGE_WORD[accessOf(t)](t); }

// The freshness ORDERING still keys off the last visit, whatever the access state.
function sweptAt(t) { return checkedAt(t, 'last_swept'); }

// The rule pill is a tag, not a paragraph: first line, cut on a word boundary, with an ellipsis so
// a cut is visible as a cut.
function ruleTag(rules) {
  const first = String(rules || '').split('\n').map(s2 => s2.trim()).find(Boolean) || '';
  if (first.length <= 30) return first.toUpperCase();
  const cut = first.slice(0, 30);
  const at = cut.lastIndexOf(' ');
  return (at > 12 ? cut.slice(0, at) : cut).replace(/[,.;:]$/, '').toUpperCase() + '…';
}

function pct(n) { return Math.round(n); }

// ── one tile ─────────────────────────────────────────────────────────────────────────────────

function Tile({ t, open, onToggle, onOpenPath, onSave }) {
  const f = fm(t);
  const id = idOf(t);
  const access = accessOf(t);
  const meta = ACCESS[access];
  const st = statsOf(t);
  const stale = stalenessOf(t) >= 1;
  // Faded ground: locked out, or gone cold, or spending finds and booking nobody.
  const dead = st.finds >= 10 && st.wins === 0;
  const fade = access === 'rejected' || access === 'banned' || stale || dead;
  const best = access === 'joined' && st.wins > 0 && !stale && !dead;

  const save = (label, patch) => onSave(label, () => api.saveTerritory(id, patch));

  const label = f.label || f.name || id;
  const kindLine = [String(f.kind || 'ground').replace(/-/g, ' ').toUpperCase(), f.size ? String(f.size) : null]
    .filter(Boolean).join(' / ');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onToggle(open ? null : id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(open ? null : id); } }}
      className="hBd"
      style={{
        ...sx('grid-column:' + (open ? 'span 2' : 'span 1') + ';display:flex;flex-direction:column;gap:10px;padding:12px 13px 13px;border-radius:8px;cursor:pointer;transition:border-color 130ms ease,background 130ms ease'),
        background: best ? 'var(--raise)' : fade ? 'var(--surface)' : 'var(--surface-2)',
        border: '1px ' + (meta.dash ? 'dashed' : 'solid') + ' '
          + (best ? 'var(--border-3)' : meta.dash ? 'var(--border-2)' : fade ? 'var(--line)' : 'var(--border)'),
      }}>
      <div style={sx('display:flex;align-items:flex-start;justify-content:space-between;gap:8px')}>
        <span style={{ ...sx('font-size:12.5px;font-weight:600;line-height:1.3'), color: best ? 'var(--fg)' : fade ? 'var(--fg-muted)' : 'var(--fg-soft)' }}>{label}</span>
        <span style={{ ...sx('flex:none;margin-top:3px;width:6px;height:6px;border-radius:9999px'), background: meta.dot, border: '1px solid ' + meta.dotBd }} />
      </div>

      <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.06em'), color: 'var(--fg-faint)' }}>{kindLine}</span>

      <Age word={ageLine(t)[0]} value={ageLine(t)[1]} />

      <div style={sx('display:flex;flex-direction:column;gap:6px')}>
        {/* Yield is a CONTINUOUS bar and freshness is a segmented meter. design/EXTRACT.md §4.3:
            staleness and productivity must not read alike. */}
        <Bar pct={Math.min(100, st.pct * 6)} tone={st.wins > 0 ? (fade ? 'var(--fg-faint)' : 'var(--fg-soft)') : 'transparent'} />
        <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.06em;font-variant-numeric:tabular-nums'), color: fade ? 'var(--fg-faint)' : 'var(--fg-muted)' }}>
          {st.finds ? st.finds + ' FOUND / ' + st.wins + ' BOOKED' : 'NOTHING FOUND YET'}
        </span>
      </div>

      {access === 'rejected' || access === 'banned' ? (
        <span style={{
          ...mono('align-self:flex-start;font-size:8.5px;font-weight:700;letter-spacing:.12em;white-space:nowrap;border-radius:9999px;padding:2px 7px'),
          color: access === 'banned' ? 'var(--danger)' : 'var(--fg-faint)',
          border: '1px solid ' + (access === 'banned' ? 'var(--danger)' : 'var(--border-2)'),
        }}>DO NOT RE-REQUEST</span>
      ) : f.rules ? (
        <span style={{
          ...mono('align-self:flex-start;font-size:8.5px;font-weight:700;letter-spacing:.12em;white-space:nowrap;border-radius:9999px;padding:2px 7px;max-width:100%;overflow:hidden;text-overflow:ellipsis'),
          color: 'var(--fg-muted)', border: '1px solid var(--border-2)',
        }}>{ruleTag(f.rules)}</span>
      ) : null}

      {open ? (
        <div onClick={e => e.stopPropagation()} style={sx('display:flex;flex-direction:column;gap:13px;padding-top:11px;border-top:1px solid var(--border);cursor:default')}>

          {access === 'rejected' || access === 'banned' ? (
            <div style={{ ...sx('display:flex;flex-direction:column;gap:3px;padding:9px 11px;border-radius:8px'), background: 'var(--sunk)', border: '1px solid var(--border)' }}>
              <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.14em'), color: access === 'banned' ? 'var(--danger)' : 'var(--fg-muted)' }}>DO NOT RE-REQUEST</span>
              <span style={sx('font-size:11.5px;line-height:1.55;color:var(--fg-soft)')}>
                {access === 'banned'
                  ? 'You were removed from here. Your assistants will not go back, and they will not ask again on your behalf.'
                  : 'They turned the request down. Your assistants will not ask again — that is worth as much as a win, because otherwise they would try forever.'}
              </span>
            </div>
          ) : null}

          <div style={sx('display:flex;flex-direction:column;gap:7px')}>
            <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>WHERE YOU STAND</span>
            <div style={sx('display:flex;flex-wrap:wrap;gap:6px')}>
              {ACCESS_ORDER.map(k => {
                const on = k === access;
                return (
                  <button key={k} type="button" className={on ? '' : 'hBd'}
                    onClick={() => save('SAVED', { access: k })}
                    style={{
                      ...sx('font-size:10.5px;border-radius:6px;padding:5px 11px;cursor:pointer;transition:border-color 130ms ease,color 130ms ease'),
                      background: on ? 'var(--raise)' : 'transparent',
                      border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'),
                      color: on ? 'var(--fg)' : 'var(--fg-muted)',
                      fontWeight: on ? 600 : 500,
                    }}>{ACCESS[k].word}</button>
                );
              })}
            </div>
          </div>

          <div style={sx('display:flex;flex-direction:column;gap:6px')}>
            <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>THE RULE HERE</span>
            <InlineEdit
              multiline
              value={f.rules || ''}
              onCommit={v => save('SAVED', { rules: v })}
              placeholder="What are you not allowed to do here? Write it the way you would tell a person."
              style={sx('white-space:pre-wrap;overflow:visible;text-overflow:clip;font-size:11.5px;line-height:1.55;color:var(--fg-soft)')}
              inputStyle={sx('font-size:11.5px;line-height:1.55;min-height:66px')}
            />
          </div>

          <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
            <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>COME BACK EVERY</span>
            <InlineEdit
              value={f.sweep_interval_days ?? ''}
              onCommit={v => save('SAVED', { sweep_interval_days: Number(v) || null })}
              placeholder="7"
              style={{ ...mono('font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;display:inline-block;min-width:24px'), color: 'var(--fg-soft)' }}
            />
            <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>DAYS</span>
          </div>

          <div style={sx('display:flex;flex-direction:column;gap:5px')}>
            <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>WHAT IT HAS GIVEN YOU</span>
            <span style={{ ...mono('font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-soft)' }}>
              {st.finds} found · {st.wins} booked · {pct(st.pct)}% of them worked out
            </span>
            <span style={sx('font-size:10.5px;line-height:1.55;color:var(--fg-faint)')}>
              Counted from your own records. Nobody types these three — not you, and not your assistants.
            </span>
          </div>

          <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:2px')}>
            <PathLink path={pathOf(t)} onOpenPath={onOpenPath} />
            <Btn size="sm" variant="ghost" onClick={() => onToggle(null)}>Close</Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────

export default function Territory({ onOpenPath, onWrote }) {
  const { data, error, loading, reload } = useResource(() => api.territory(), []);
  const writer = useMemoryWriter(() => { reload(); onWrote && onWrote(); });
  const [open, setOpen] = React.useState(null);

  if (loading && !data) return <Loading what="THE GROUND" />;

  const all = listOf(data, 'territory', 'territories', 'items');
  if (!all.length) {
    return (
      <Failed
        error={error}
        title="NO GROUND YET"
        body={error ? String(error.message || error) : 'A place is a group, a hashtag, a subreddit or an account your assistants work. They will propose the first ones; you say yes.'}
      />
    );
  }

  // Every band is sorted by staleness × hit_rate, highest first, so the top-left tile of WORKING
  // GROUND is literally the answer to "what should I sweep next".
  const bands = BANDS.map(b => ({
    ...b,
    tiles: all
      .filter(t => ACCESS[accessOf(t)].band === b.key)
      // staleness × hit_rate is the rule (docs/03_MEMORY.md §4). Ground that has never paid off
      // scores zero against ground that has never paid off, so the tie is broken by age — which is
      // the same question asked with the only information left: who has waited longest.
      .sort((x, y) => sweepScore(y) - sweepScore(x)
        || (stalenessOf(y) ?? 0) - (stalenessOf(x) ?? 0)
        || statsOf(y).pct - statsOf(x).pct),
  })).filter(b => b.tiles.length);

  const joined = all.filter(t => accessOf(t) === 'joined').length;
  const waiting = all.filter(t => accessOf(t) === 'requested').length;
  const locked = all.filter(t => ['rejected', 'banned'].includes(accessOf(t))).length;
  // The sort IS the answer to "what should I sweep next" (docs/03_MEMORY.md §4), so the sentence
  // names the tile the person is already looking at first. When nothing has paid off yet the score
  // is zero everywhere and the honest answer is the one that has waited longest — which is exactly
  // what the tiebreak has already put on top.
  const working = bands.find(b => b.key === 'working');
  const next = working ? working.tiles[0] : null;
  const nextPays = next ? sweepScore(next) > 0 : false;
  const totals = all.reduce((a, t) => { const s = statsOf(t); a.finds += s.finds; a.wins += s.wins; return a; }, { finds: 0, wins: 0 });

  return (
    <div style={sx('flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden')}>
      <ScreenHead
        eyebrow="WHERE YOUR ASSISTANTS WORK"
        line={[
          joined + (joined === 1 ? ' place you can work' : ' places you can work'),
          waiting ? waiting + ' waiting on someone' : null,
          locked ? locked + ' closed to you' : null,
        ].filter(Boolean).join(', ') + '.'
          + (next
            ? ' ' + (fm(next).label || fm(next).name || idOf(next))
              + (nextPays ? ' is where the next sweep pays off most.' : ' has waited longest and nothing here has paid off yet.')
            : '')}
        right={<SaveNote state={writer.note} />}>
        <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
          {totals.finds} FOUND ACROSS {all.length} PLACES / {totals.wins} BOOKED · CLICK ANY GROUND FOR ITS RULES
        </span>
      </ScreenHead>

      <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:18px 20px 28px;display:flex;flex-direction:column;gap:20px')}>
        {bands.map(b => (
          <section key={b.key} style={sx('display:flex;flex-direction:column;gap:10px')}>
            <div style={sx('display:flex;align-items:center;gap:10px')}>
              <span style={{ ...sx('font-size:9.5px;font-weight:800;letter-spacing:.18em'), color: b.fg }}>{b.name}</span>
              <span style={{ ...mono('font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>{b.tiles.length}</span>
              <span style={sx('flex:1;height:1px;background:var(--line)')} />
              <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>{b.note}</span>
            </div>
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;align-items:start')}>
              {b.tiles.map(t => (
                <Tile key={idOf(t) || pathOf(t)} t={t} open={open === idOf(t)} onToggle={setOpen}
                  onOpenPath={onOpenPath} onSave={writer.save} />
              ))}
            </div>
          </section>
        ))}

        {bands.length ? null : <Empty title="NO GROUND YET" />}

        <div style={sx('display:flex;flex-direction:column;gap:5px;padding-top:4px')}>
          <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>HOW TO READ THIS</span>
          <span style={sx('font-size:11px;line-height:1.55;color:var(--fg-faint);max-width:74ch')}>
            Bright ground is working. Faded ground is old or empty. A dashed edge means you cannot
            work there yet. Within every band, the ground that has paid off and has gone longest
            without a visit sits first.
          </span>
        </div>
      </div>
    </div>
  );
}
