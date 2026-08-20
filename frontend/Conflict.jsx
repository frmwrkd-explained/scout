// Conflict — what happens when an agent writes to a file while a human is editing it.
//
// This is not an edge case in Scout, it is the normal case: assistants work all day on the same
// records the human is reading (GOAL.md §3). Tesseract ships `ConflictNotification.svelte` +
// `DiffView.svelte` and docs/06_REUSE.md marks them "take this on day one". This is that pair.
//
// The rule underneath: NEVER SILENTLY CLOBBER. `api.patchRecord` sends the `rev` the edit was built
// from; a stale rev comes back 409 instead of overwriting, and this component is the whole of what
// the human then sees. Three answers, all of them non-destructive (Law 5 — nothing is deleted):
//
//   Take disk   your edits are dropped, the file on disk wins.
//   Keep mine   every key you can see is written with your value. A key only the other writer
//               added SURVIVES — the write is a PATCH, not a replace, so "keep mine" cannot
//               delete a screenshot the agent attached while you were typing.
//   Merge both  disk is the base and only the keys you actually changed are applied on top. This
//               is the right answer almost always, so it is the accented one.
//
// Props — ConflictNotification
//   conflict   { by, at, disk:{ data, content, rev }, mine:{ data, content }, keys:[changed keys],
//                bodyChanged:bool }   — built by Document.jsx from the 409 plus a re-read of disk.
//   onTakeDisk() · onKeepMine() · onMerge()   the three answers. Exactly one will be called.
//   onDismiss() optional — leaves the conflict unresolved and the banner up next save.
//
// Props — DiffView (exported separately; the banner embeds it behind SHOW WHAT CHANGED)
//   conflict   the same object. It renders one row per key where mine and disk disagree, marks
//              which side each answer would keep, and never truncates a value silently.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Btn, Eyebrow } from './ui';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });
const BARE_BTN = sx('display:inline-flex;align-items:center;gap:8px;background:none;border:none;padding:0;margin:0;cursor:pointer');

// Values in frontmatter are scalars, lists or small objects. One printer for all three, because a
// diff that renders `[object Object]` for the one row that matters is worse than no diff.
export function printValue(v) {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  if (v === '') return '—';
  return String(v);
}

// Which keys actually disagree. Union of both sides — a key the agent ADDED is a difference the
// human must see, even though it is not one of theirs.
export function differingKeys(conflict) {
  const mine = (conflict && conflict.mine && conflict.mine.data) || {};
  const disk = (conflict && conflict.disk && conflict.disk.data) || {};
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(disk)])];
  return keys.filter(k => JSON.stringify(mine[k] ?? null) !== JSON.stringify(disk[k] ?? null)).sort();
}

function agoLabel(at) {
  if (!at) return '';
  const t = Date.parse(String(at));
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + ' SECONDS AGO';
  if (s < 3600) return Math.round(s / 60) + ' MINUTES AGO';
  return Math.round(s / 3600) + ' HOURS AGO';
}

// One row of the diff. MINE and ON DISK sit side by side; the side the merge would keep carries the
// WINS marker, so the accented button's behaviour is legible before it is pressed.
function DiffRow({ k, mine, disk, mineWins }) {
  return (
    <div style={{ ...sx('display:flex;align-items:flex-start;gap:12px;padding:7px 0'), borderTop: '1px solid var(--line)' }}>
      <span title={k} style={{ ...mono('flex:none;width:120px;font-size:9.5px;font-weight:600;letter-spacing:.06em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-top:2px'), color: 'var(--fg-muted)' }}>{k}</span>
      <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:3px')}>
        <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.14em'), color: mineWins ? 'var(--accent)' : 'var(--fg-faint)' }}>
          MINE{mineWins ? ' · WINS' : ''}
        </span>
        <span style={{ ...sx('font-size:11.5px;line-height:1.5;word-break:break-word'), color: mineWins ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>{printValue(mine)}</span>
      </span>
      <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:3px')}>
        <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.14em'), color: mineWins ? 'var(--fg-faint)' : 'var(--marked)' }}>
          ON DISK{mineWins ? '' : ' · WINS'}
        </span>
        <span style={{ ...sx('font-size:11.5px;line-height:1.5;word-break:break-word'), color: mineWins ? 'var(--fg-faint)' : 'var(--fg-soft)' }}>{printValue(disk)}</span>
      </span>
    </div>
  );
}

export function DiffView({ conflict, style }) {
  const keys = differingKeys(conflict);
  const mine = (conflict?.mine?.data) || {};
  const disk = (conflict?.disk?.data) || {};
  const changed = new Set(conflict?.keys || []);
  const bodyDiff = String(conflict?.mine?.content ?? '') !== String(conflict?.disk?.content ?? '');

  if (!keys.length && !bodyDiff) {
    return (
      <div style={{ ...sx('padding:10px 0'), ...style }}>
        <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>
          NOTHING DIFFERS — THE FILE MOVED ON BUT THE VALUES MATCH
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...sx('display:flex;flex-direction:column'), ...style }}>
      <div style={sx('display:flex;align-items:center;gap:10px;padding-bottom:6px')}>
        <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.16em')}>WHAT CHANGED</Eyebrow>
        <span style={{ ...mono('font-size:9.5px;font-weight:500;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
          {keys.length + (bodyDiff ? 1 : 0)} FIELDS
        </span>
      </div>
      {keys.map(k => (
        <DiffRow key={k} k={k} mine={mine[k]} disk={disk[k]} mineWins={changed.has(k)} />
      ))}
      {bodyDiff ? (
        <DiffRow
          k="(the note)"
          mine={String(conflict?.mine?.content ?? '').trim().slice(0, 240) || '—'}
          disk={String(conflict?.disk?.content ?? '').trim().slice(0, 240) || '—'}
          mineWins={!!conflict?.bodyChanged}
        />
      ) : null}
    </div>
  );
}

export function ConflictNotification({ conflict, onTakeDisk, onKeepMine, onMerge, onDismiss, style }) {
  const [showDiff, setShowDiff] = React.useState(false);
  if (!conflict) return null;

  const who = conflict.by || 'something else';
  const when = agoLabel(conflict.at);
  const n = differingKeys(conflict).length;
  const line = who + ' wrote to this file' + (when ? ' ' + when.toLowerCase() : '')
    + ' while you were editing it'
    + (n ? ' — ' + n + (n === 1 ? ' field differs' : ' fields differ') + ' from yours.' : '.');

  return (
    // --marked, never the accent: this is "in flight", not a call to action (docs/05_UI_SPEC.md §6).
    <div style={{
      ...sx('flex:none;display:flex;flex-direction:column;gap:10px;padding:11px 22px'),
      background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderLeft: '2px solid var(--marked)',
      ...style,
    }}>
      <div style={sx('display:flex;align-items:center;gap:14px;flex-wrap:wrap')}>
        <span style={{ ...sx('flex:1;min-width:220px;font-size:12.5px;font-weight:500;line-height:1.5'), color: 'var(--fg-soft)' }}>{line}</span>
        <div style={sx('flex:none;display:flex;align-items:center;gap:6px')}>
          <Btn variant="secondary" size="sm" onClick={onMerge} style={sx('height:28px')}>Merge both</Btn>
          <Btn variant="ghost" size="sm" onClick={onTakeDisk} style={{ ...sx('height:28px'), background: 'var(--raise)' }}>Take disk</Btn>
          <Btn variant="ghost" size="sm" onClick={onKeepMine} style={{ ...sx('height:28px'), border: '1px solid transparent' }}>Keep mine</Btn>
        </div>
      </div>

      <div style={sx('display:flex;align-items:center;gap:14px')}>
        <button type="button" onClick={() => setShowDiff(v => !v)} className="hFgL"
          style={{ ...BARE_BTN, ...mono('font-size:10px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>
          <span style={{ ...sx('display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:4px;font-size:8px'), border: '1px solid var(--border-2)' }}>
            {showDiff ? '▾' : '▸'}
          </span>
          {showDiff ? 'HIDE WHAT CHANGED' : 'SHOW WHAT CHANGED'}
        </button>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="hFgL"
            style={{ ...BARE_BTN, ...mono('font-size:10px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>
            LATER
          </button>
        ) : null}
      </div>

      {showDiff ? <DiffView conflict={conflict} style={sx('padding-top:2px;padding-bottom:4px')} /> : null}
    </div>
  );
}

export default ConflictNotification;
