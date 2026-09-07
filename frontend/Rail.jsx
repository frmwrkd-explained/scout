// The left rail — 210px, per design/EXTRACT.md §3.2/§3.3.
//
// Order is fixed and comes from the design: project switcher → nav → COLLECTIONS → MEMORY →
// ASSISTANTS → FILES pinned at the bottom. `docs/05_UI_SPEC.md` §1 adds the MEMORY group to what
// the design drew; everything else is as measured.
//
// This is the app's ONLY navigation. Every screen is reachable from here, and every row that
// looks clickable is clickable — the previous version rendered three dead nav rows and two
// placeholder groups, which is most of why the app read as broken.
//
// Row heights are the design's: 30px nav / 29px collections / 28px assistants. Selected is a
// `--raise` fill with a `--border-3` border — never an accent fill (docs/05_UI_SPEC.md §6). Hover
// is `--surface-2` + `--fg-soft` at 130ms ease.
//
// Props:
//   screen            current screen key — 'today' 'decide' 'project' 'collection' 'document'
//                     'goals' 'territory' 'playbook' 'memory' 'knows' 'assistants' 'assistant'
//                     'files' 'board' 'settings'
//   onNavigate(key, arg)  the one navigation callback
//   onSearch()        opens the ⌘K palette (item 11) — the SEARCH row at the top of nav is the
//                     visible way in; the chord works with or without it.
//   collections[]     from GET /api/collections            counts{}  id → row count
//   activeCollection  id of the collection on screen
//   assistants[]      from GET /api/assistants             memoryCounts { goals, territory, playbook }
//   needsYou          open decision count — the number that drives her day
//   project           active project id                    projects[] for the switcher

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Eyebrow } from './ui';

export const RAIL_W = 210;
const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// One row, one behaviour. A row with no onClick renders as text rather than as a button, because
// a dead control that looks live is the thing this rail was guilty of.
function Row({ label, count, countTone, on, mono: isMono, onClick, dot, right, height }) {
  const [hover, setHover] = React.useState(false);
  const live = typeof onClick === 'function';
  const h = height || (isMono ? 29 : 30);
  return (
    <button
      type="button"
      disabled={!live}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...sx('display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 10px;border-radius:6px;width:100%;text-align:left;transition:background 130ms ease,color 130ms ease,border-color 130ms ease'),
        height: h,
        cursor: live ? 'pointer' : 'default',
        background: on ? 'var(--raise)' : hover && live ? 'var(--surface-2)' : 'transparent',
        border: '1px solid ' + (on ? 'var(--border-3)' : 'transparent'),
        color: on ? 'var(--fg)' : hover && live ? 'var(--fg-soft)' : 'var(--fg-muted)',
      }}>
      <span style={sx('display:flex;align-items:center;gap:8px;min-width:0')}>
        {dot ? <span style={{ ...sx('flex:none;width:6px;height:6px;border-radius:9999px'), background: dot }} /> : null}
        <span style={{
          ...(isMono ? mono('font-size:11.5px') : sx('font-size:12px')),
          fontWeight: on ? 600 : 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{label}</span>
      </span>
      {right ? <span style={{ ...mono('font-size:9px;font-weight:600;letter-spacing:.08em'), color: countTone || 'var(--fg-faint)' }}>{right}</span> : null}
      {count != null ? (
        <span style={{
          ...mono('font-size:' + (countTone ? '9.5px' : '10px') + ';font-weight:600;font-variant-numeric:tabular-nums'),
          color: countTone || 'var(--fg-faint)',
          ...(countTone ? sx('display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:9999px;border:1px solid ' + countTone) : {}),
        }}>{count}</span>
      ) : null}
    </button>
  );
}

function Group({ label, note, children }) {
  return (
    <div style={sx('padding:6px 12px 10px;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line)')}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 10px 6px')}>
        <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{label}</Eyebrow>
        {note ? <span style={{ ...mono('font-size:9px;font-weight:500'), color: 'var(--fg-faint)' }}>{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

// Groups render with ZERO items rather than placeholder rows. A fake count is a lie the next
// person has to disprove.
function NoneYet({ children }) {
  return (
    <span style={{ ...mono('display:flex;align-items:center;min-height:28px;padding:0 10px;font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>
      {children}
    </span>
  );
}

const DOT = { running: 'var(--marked)', blocked: 'var(--warn)', idle: 'var(--border-3)' };

export default function Rail({
  screen, onNavigate, onSearch,
  collections = [], counts = {}, activeCollection, onPickCollection,
  assistants = [], activeAssistant, memoryCounts = {}, needsYou = 0,
  project, projects = [], onPickProject,
}) {
  const [switcher, setSwitcher] = React.useState(false);
  const go = key => () => onNavigate && onNavigate(key);

  return (
    <aside style={{ ...sx('flex:none;background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width: RAIL_W }}>
      {/* project switcher */}
      <div style={sx('flex:none;padding:10px 12px;border-bottom:1px solid var(--line);position:relative')}>
        <button type="button" onClick={() => setSwitcher(v => !v)}
          style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 10px;border-radius:6px;background:var(--raise);border:1px solid var(--border-3);cursor:pointer;text-align:left')}>
          <span style={sx('display:flex;flex-direction:column;gap:3px;min-width:0')}>
            <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.16em;color:var(--fg-faint)')}>PROJECT</Eyebrow>
            <span style={sx('font-size:12.5px;font-weight:600;color:' + (project ? 'var(--fg)' : 'var(--fg-muted)') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
              {project || 'No project yet'}
            </span>
          </span>
          <span style={{ ...mono('font-size:9px'), color: 'var(--fg-muted)' }}>▾</span>
        </button>
        {switcher && projects.length ? (
          <div style={sx('position:absolute;left:12px;right:12px;top:62px;z-index:40;padding:4px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 12px 32px rgba(0,0,0,.45)')}>
            {projects.map(p => (
              <Row key={p.id} isMono label={p.label || p.id} on={p.id === project}
                onClick={() => { setSwitcher(false); onPickProject && onPickProject(p.id); }} />
            ))}
          </div>
        ) : null}
      </div>

      <div style={sx('flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column')}>
        {/* nav — the three things she does. NEEDS YOU carries the only warn-toned count in the
            rail, because it is the number that decides whether she opens the app at all. SEARCH
            is item 11's affordance — ⌘K worked with no visible way to learn it existed. */}
        <div style={sx('padding:10px 12px;display:flex;flex-direction:column;gap:2px')}>
          <Row label="Search" right="⌘K" onClick={onSearch} />
          <Row label="Needs you" count={needsYou} on={screen === 'decide'} onClick={go('decide')}
            countTone={needsYou > 0 ? 'var(--warn)' : 'var(--border-2)'} />
          <Row label="Today" on={screen === 'today'} onClick={go('today')} />
          <Row label="Project" on={screen === 'project'} onClick={go('project')} />
        </div>

        <Group label="COLLECTIONS" note="SAVED QUERIES">
          {collections.length
            ? collections.map(c => (
                <Row key={c.id} isMono label={'#' + c.id} count={counts[c.id] ?? '·'}
                  on={(screen === 'collection' || screen === 'document') && c.id === activeCollection}
                  onClick={() => onPickCollection && onPickCollection(c.id)} />
              ))
            : <NoneYet>NONE YET</NoneYet>}
          {/* A collection is a schema change, and a schema change is a proposal (04 §4). This
              opens the DECIDE queue's schema card rather than a settings form. */}
          <button type="button" onClick={go('newCollection')}
            style={{ ...mono('display:flex;align-items:center;height:29px;padding:0 10px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer'), color: 'var(--accent)', background: 'transparent', border: 'none' }}>
            + new collection
          </button>
        </Group>

        {/* docs/05_UI_SPEC.md §1 — the group the design did not draw. This is the layer the whole
            product is about: what the assistants know, and what she can correct. */}
        <Group label="MEMORY">
          <Row label="Goals" count={memoryCounts.goals ?? '·'} on={screen === 'goals'} onClick={go('goals')} />
          <Row label="Territory" count={memoryCounts.territory ?? '·'} on={screen === 'territory'} onClick={go('territory')} />
          {/* Exactly four rows — Goals · Territory · Playbook · What they know (T11 step 4). There
              was a fifth called "Memory" that opened the same screen as Playbook: two doors to one
              room, which reads as a bug to anyone who tries both. `me`, the playbook and the
              learnings share one surface on purpose (T11 step 1), and Playbook is its door. */}
          <Row label="Playbook" count={memoryCounts.playbook ?? '·'}
            on={screen === 'playbook' || screen === 'memory'} onClick={go('playbook')} />
          <Row label="What they know" on={screen === 'knows'} onClick={go('knows')} />
        </Group>

        <Group label="ASSISTANTS">
          {assistants.length
            ? assistants.map(a => (
                <Row key={a.id} isMono height={28} label={a.id}
                  dot={DOT[a.status] || DOT.idle}
                  right={String(a.status || 'idle').toUpperCase()}
                  countTone={DOT[a.status] || 'var(--fg-faint)'}
                  on={screen === 'assistants' && a.id === activeAssistant}
                  onClick={() => onNavigate && onNavigate('assistant', a.id)} />
              ))
            : <NoneYet>NONE HIRED</NoneYet>}
          {/* This goes to the HIRING screen, not the roster. It said `assistants` and therefore did
              nothing visible when you were already looking at the roster — a dead control that
              looks live, which is the exact class of bug this rail was rebuilt to remove. */}
          <button type="button" onClick={go('hire')}
            style={{ ...mono('display:flex;align-items:center;height:28px;padding:0 10px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer'), color: 'var(--accent)', background: 'transparent', border: 'none' }}>
            + hire an assistant
          </button>
        </Group>

        <Group label="BOARD">
          <Row label="Whiteboard" on={screen === 'board'} onClick={go('board')} />
        </Group>
      </div>

      {/* Law 8 — we compress hard, so the way down is pinned where it can always be found.
          SETTINGS sits beside it — item 12 — the two rows a person looks for at the bottom of any
          app, not buried in a menu that does not exist here. */}
      <div style={sx('flex:none;border-top:1px solid var(--line);padding:8px 12px;display:flex;flex-direction:column;gap:2px')}>
        <Row isMono height={28} label="FILES ON DISK" on={screen === 'files'} onClick={go('files')} />
        <Row isMono height={28} label="SETTINGS" on={screen === 'settings'} onClick={go('settings')} />
      </div>
    </aside>
  );
}
