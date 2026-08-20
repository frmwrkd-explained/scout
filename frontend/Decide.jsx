// frontend/Decide.jsx — the one queue. One card at a time (T13, GOAL §3).
//
// PROPS
//   actor       string    who is deciding. Defaults to 'crystal'. Sent on every accept/reject.
//   status      string    which queue to load — 'open' (default). Passed straight to api.proposals.
//   onExit      fn()      Esc, and the empty state's way out. The integrator navigates.
//   onOpenPath  fn(path)  altitude 3 — open the raw .md (Law 8). Optional; the link hides without it.
//   onDecided   fn({ id, kind, verdict, reason })  fires AFTER the server confirms, so the rail's
//                         "Needs you" count and TODAY can refresh. Optional.
//   onCount     fn(n)     open-card count, on load and after every decision. Optional.
//
// THE SCREEN IS ALTITUDE 1 AND STAYS THERE
//   card                      the kind, one headline, one line, the yes/no      (default)
//   ▸ WHY            [W]      one paragraph                                     (one click)
//   ▸ SHOW ME THE EVIDENCE [E]  counted rows + the path to the file             (two clicks)
// EVIDENCE's control is nested INSIDE the WHY panel and is unreachable until WHY opens. That
// nesting is structural (EXTRACT.md §3.5) — do not flatten it into two sibling toggles.
//
// DESIGNED FOR CARD 200, NOT CARD 1
//   · Every action has a key, and the keys never move. A person works the whole queue without
//     touching the mouse: A · R → 1–5 · S · J/K or arrows · W · E · O · Enter · Esc · ⌘Z.
//   · The action bar is PINNED to the bottom of the card (the card fills the pane) rather than
//     riding under content of varying height as in design/Decide.dc.html. Everything else is the
//     design verbatim. Deliberate deviation: at card 200 the hands are on the keys and the eyes
//     are tired, and a target that moves between cards is the thing that makes both worse.
//   · The reject reason grid replaces the action row IN PLACE, so 1–5 land where A and R were.
//   · Accepting advances immediately and reconciles after; a failed write puts the card back
//     exactly where it was and says so. A queue that stalls on the network is a queue nobody
//     finishes.
//   · S skips without deciding, and skipped cards come back at the end (G) — skipping is not
//     losing. Never a delete (Law 5).
//
// WHAT IT DOES NOT DO: it never writes a record itself. Accept and reject go to
// /api/proposals/:id/accept|reject, and backend/proposals.mjs performs the effect. The card
// renderers live in DecideCards.jsx, dispatched from a table — there is no `if (kind === …)`
// anywhere in this file, on purpose.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Empty, Eyebrow } from './ui';
import { Freshness } from './Freshness';
import { keyLabel } from './keymap';
import { ANSWER_INPUT_ID, CardBody, REJECT_REASONS, RefList, kindOf, normalizeCard, unwrap } from './DecideCards';

const mono = (extra = '') => ({ ...sx('font-variant-numeric:tabular-nums;' + extra), fontFamily: MONO });

// Keys are fixed, not rebindable: every button prints its own key, and T13 specifies them.
// keymap.js already reserves 1–5, Esc and the arrows for exactly this kind of surface.
const KEYS = { accept: 'a', reject: 'r', skip: 's', why: 'w', evidence: 'e', open: 'o', next: 'j', prev: 'k', again: 'g' };

function isTyping(e) {
  const t = (e && e.target) || (typeof document !== 'undefined' ? document.activeElement : null);
  if (!t) return false;
  const tag = String(t.tagName || '').toLowerCase();
  return !!t.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

// A key pill. Two beds: on the accent button it sits on --accent-deep (the pressed step of the
// same hue), everywhere else on --sunk. No raw colours — the pill is a token pair.
function Key({ k, on = 'dark' }) {
  const bed = on === 'accent'
    ? { background: 'var(--accent-deep)', color: 'var(--on-accent)', border: '1px solid var(--accent-deep)' }
    : { background: 'var(--sunk)', color: 'var(--fg-muted)', border: '1px solid var(--border-2)' };
  return <span style={{ ...mono('font-size:10px;font-weight:600;border-radius:4px;padding:2px 6px'), ...bed }}>{keyLabel(k)}</span>;
}

function Caret({ open }) {
  return (
    <span style={sx('display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1px solid var(--border-2);border-radius:4px;font-size:8px')}>
      {open ? '▾' : '▸'}
    </span>
  );
}

// A bare text button — the WHY / EVIDENCE toggles. Btn owns the real <button>, the focus ring and
// the disabled semantics; the chrome is stripped because these are toggles inside a card, not
// controls on it.
function TextToggle({ open, label, k, onClick }) {
  return (
    <Btn
      variant="ghost"
      size="sm"
      className="hFgL"
      onClick={onClick}
      style={{ ...mono('padding:0;border:none;border-radius:0;gap:9px;font-size:10.5px;font-weight:700;letter-spacing:.14em'), color: open ? 'var(--fg-soft)' : 'var(--fg-muted)' }}
    >
      <Caret open={open} />
      <span>{label}</span>
      <span style={{ ...mono('font-size:9px;font-weight:600;border:1px solid var(--border-2);border-radius:4px;padding:1px 5px;color:var(--fg-faint)') }}>{keyLabel(k)}</span>
    </Btn>
  );
}

export default class Decide extends React.Component {
  state = {
    queue: [], skipped: [], idx: 0,
    loading: true, error: null, busy: false, failure: null,
    mode: 'decide',      // 'decide' | 'reject'
    why: false, ev: false,
    yes: 0, no: 0, skip: 0,
    last: null,          // { text, undoable }
    answer: '', answerFor: null,   // the typed answer, and the card it belongs to
  };

  componentDidMount() {
    this.mounted = true;
    window.addEventListener('keydown', this.onKey);
    this.load();
  }

  // The listener is added once and removed here — a window binding that outlives its screen is
  // how a keyboard app starts answering keys on a page that no longer exists.
  componentWillUnmount() {
    this.mounted = false;
    window.removeEventListener('keydown', this.onKey);
  }

  async load() {
    this.setState({ loading: true, error: null });
    try {
      const payload = await api.proposals(this.props.status || 'open');
      const queue = unwrap(payload, 'proposals', 'cards')
        .map(normalizeCard)
        .filter(c => c && c.id);
      if (!this.mounted) return;
      this.setState({ queue, idx: 0, loading: false, why: false, ev: false, mode: 'decide' });
      if (this.props.onCount) this.props.onCount(queue.length);
    } catch (e) {
      if (!this.mounted) return;
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  card() { return this.state.queue[this.state.idx] || null; }

  // Derived, not stored: the box shows what she typed for THIS card, or the answer the assistant
  // proposed. No effect, no reset-on-change bug — moving to another card changes the derivation.
  currentAnswer() {
    const card = this.card();
    if (!card) return '';
    return this.state.answerFor === card.id ? this.state.answer : String(card.answer || '');
  }

  focusAnswer() {
    const el = typeof document !== 'undefined' ? document.getElementById(ANSWER_INPUT_ID) : null;
    if (el) { el.focus(); el.select && el.select(); }
  }

  move(delta) {
    this.setState(s => {
      if (!s.queue.length) return null;
      const idx = Math.max(0, Math.min(s.queue.length - 1, s.idx + delta));
      return idx === s.idx ? null : { idx, why: false, ev: false, mode: 'decide' };
    });
  }

  // Skip is local and reversible: the card leaves the run but not the queue, and comes back with
  // G at the end. Nothing is written, so nothing has to be undone on disk.
  skip() {
    const card = this.card();
    if (!card) return;
    this.setState(s => ({
      queue: s.queue.filter((_, i) => i !== s.idx),
      idx: Math.min(s.idx, Math.max(0, s.queue.length - 2)),
      skipped: s.skipped.concat([{ card, at: s.idx }]),
      skip: s.skip + 1, why: false, ev: false, mode: 'decide', failure: null,
      last: { text: 'SKIPPED / ' + shortTitle(card), undoable: true },
    }));
  }

  again() {
    this.setState(s => (s.skipped.length
      ? { queue: s.queue.concat(s.skipped.map(x => x.card)), skipped: [], idx: 0, why: false, ev: false, mode: 'decide' }
      : null));
  }

  undo() {
    // Only a skip can be taken back here. An accept or a reject is already on disk and in the
    // event log — Law 5 says the record and its reason stay, so we say so rather than pretending.
    this.setState(s => {
      if (!s.skipped.length) return { last: { text: 'NOTHING TO TAKE BACK', undoable: false } };
      const back = s.skipped[s.skipped.length - 1];
      const queue = s.queue.slice();
      const at = Math.max(0, Math.min(queue.length, back.at));
      queue.splice(at, 0, back.card);
      return {
        queue, idx: at, skipped: s.skipped.slice(0, -1), skip: Math.max(0, s.skip - 1),
        why: false, ev: false, mode: 'decide',
        last: { text: 'PUT BACK / ' + shortTitle(back.card), undoable: false },
      };
    });
  }

  // Accept and reject share one path: drop the card, fire, reconcile. `verdict` is the only
  // difference and it is data, not a branch in the UI.
  async commit(verdict, reason) {
    const card = this.card();
    if (!card || this.state.busy) return;
    const at = this.state.idx;
    // backend/proposals.mjs refuses a question card with no `answer` — the box IS the payload.
    const answer = kindOf(card).needsAnswer ? String(this.currentAnswer() || '').trim() : null;

    this.setState(s => ({
      queue: s.queue.filter((_, i) => i !== at),
      idx: Math.min(s.idx, Math.max(0, s.queue.length - 2)),
      busy: true, failure: null, mode: 'decide', why: false, ev: false,
      yes: s.yes + (verdict === 'accept' ? 1 : 0),
      no: s.no + (verdict === 'reject' ? 1 : 0),
      last: { text: (verdict === 'accept' ? 'YES' : 'NO / ' + String(reason).toUpperCase()) + ' / ' + shortTitle(card), undoable: false },
    }));

    try {
      const actor = this.props.actor || 'crystal';
      // The third argument is the answer a question card needs. `api.acceptProposal` is currently
      // `(id, actor)` and ignores it — until it becomes `(id, actor, answer) => opts({ actor,
      // answer })`, a question card's accept comes back 400 with the server's own sentence, and
      // that sentence is what the failure band prints. Nothing here guesses on her behalf.
      if (verdict === 'accept') await api.acceptProposal(card.id, actor, answer);
      else await api.rejectProposal(card.id, reason, actor);
      if (!this.mounted) return;
      this.setState({ busy: false });
      if (this.props.onDecided) this.props.onDecided({ id: card.id, kind: card.kind, verdict, reason: reason || null });
      if (this.props.onCount) this.props.onCount(this.state.queue.length);
    } catch (e) {
      if (!this.mounted) return;
      // Put it back exactly where it was. A decision that did not land must not look like one
      // that did — every card in this queue performs a real effect on accept.
      this.setState(s => {
        const queue = s.queue.slice();
        const i = Math.max(0, Math.min(queue.length, at));
        queue.splice(i, 0, card);
        return {
          queue, idx: i, busy: false,
          yes: s.yes - (verdict === 'accept' ? 1 : 0),
          no: s.no - (verdict === 'reject' ? 1 : 0),
          failure: (verdict === 'accept' ? 'ACCEPT' : 'REJECT') + ' DID NOT LAND — ' + (e.message || String(e)),
          last: null,
        };
      });
    }
  }

  onKey = e => {
    if (isTyping(e)) return;

    if (e.metaKey || e.ctrlKey) {
      if (String(e.key).toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
      return;
    }
    if (e.altKey) return;
    if (this.state.busy || this.state.loading) return;

    const k = String(e.key).toLowerCase();

    // The reason grid is a modal state on purpose: while it is open the only keys that mean
    // anything are the five reasons and Esc. Law 5 — no path out of a rejection without a reason.
    if (this.state.mode === 'reject') {
      if (k === 'escape') { e.preventDefault(); this.setState({ mode: 'decide' }); return; }
      const hit = REJECT_REASONS.find(r => r.key === e.key);
      if (hit) { e.preventDefault(); this.commit('reject', hit.id); }
      return;
    }

    if (k === 'escape') { e.preventDefault(); if (this.props.onExit) this.props.onExit(); return; }
    if (!this.state.queue.length) {
      if (k === KEYS.again && this.state.skipped.length) { e.preventDefault(); this.again(); }
      return;
    }

    // Enter puts the caret in the answer box of a card that needs one. Table-driven, so this is
    // not a branch on kind: a future kind that wants typed input gets it by adding `needsAnswer`.
    if (k === 'enter') {
      const card = this.card();
      if (card && kindOf(card).needsAnswer) { e.preventDefault(); this.focusAnswer(); return; }
    }

    if (k === KEYS.accept) { e.preventDefault(); this.commit('accept'); }
    else if (k === KEYS.reject) { e.preventDefault(); this.setState({ mode: 'reject' }); }
    else if (k === KEYS.skip) { e.preventDefault(); this.skip(); }
    else if (k === KEYS.why) { e.preventDefault(); this.setState(s => ({ why: !s.why, ev: false })); }
    else if (k === KEYS.evidence) { if (this.state.why) { e.preventDefault(); this.setState(s => ({ ev: !s.ev })); } }
    else if (k === KEYS.open) { e.preventDefault(); this.openFile(); }
    else if (k === KEYS.next || k === 'arrowdown' || k === 'arrowright') { e.preventDefault(); this.move(1); }
    else if (k === KEYS.prev || k === 'arrowup' || k === 'arrowleft') { e.preventDefault(); this.move(-1); }
  };

  // Law 8 — the way down. `subject` is the record the card is about; `file` is the card itself.
  openFile(path) {
    const card = this.card();
    const p = path || (card && (card.subject || card.file));
    if (p && this.props.onOpenPath) this.props.onOpenPath(p);
  }

  render() {
    const { queue, skipped, idx, loading, error, busy, failure, mode, why, ev, yes, no, skip, last } = this.state;
    const card = this.card();
    const total = queue.length;
    const pos = total ? idx + 1 : 0;
    const ahead = Math.max(0, total - pos);
    const decided = yes + no;
    const next = queue[idx + 1] || null;
    const kind = card ? kindOf(card) : null;
    const path = card ? (card.subject || card.file) : null;

    return (
      <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>

        {/* ── header: where she is in the queue, and how much is left ── */}
        <div style={sx('flex:none;height:40px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;background:var(--surface);border-bottom:1px solid var(--line)')}>
          <div style={sx('display:flex;align-items:center;gap:12px')}>
            <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>DECIDE</Eyebrow>
            <span style={sx('width:1px;height:14px;background:var(--border)')} />
            <span style={{ ...mono('font-size:12px;font-weight:600;color:var(--fg-soft)') }}>{pos} / {total}</span>
            <span style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-faint)') }}>{ahead} MORE WAITING</span>
          </div>
          <span style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-faint)') }}>{decided} DECIDED THIS SESSION</span>
        </div>

        <div style={sx('height:2px;flex:none;background:var(--line)')}>
          <div style={{ ...sx('height:2px;background:var(--border-3)'), width: (total ? Math.round((pos / total) * 100) : 0) + '%' }} />
        </div>

        <div style={sx('flex:1;min-height:0;display:flex;align-items:stretch;justify-content:center;padding:36px 40px 32px;overflow:hidden')}>
          <div style={sx('width:100%;max-width:800px;min-height:0;display:flex;flex-direction:column;gap:12px')}>

            {loading ? (
              <Empty size="page" title="Loading the queue" body="One read of proposals/ on disk." />
            ) : error ? (
              <Empty
                size="page"
                title="The queue did not load"
                body={error + ' — proposals live at proposals/*.md and are served by /api/proposals. Nothing has been lost.'}
              />
            ) : !card ? (
              // T13's empty state, verbatim, in short mono uppercase (05_UI_SPEC.md §6).
              <div style={sx('flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px')}>
                <Empty size="page" style={sx('width:100%')} title="NO QUESTIONS — YOUR ASSISTANTS ARE CLEAR" body={decided ? decided + ' decided this session. Every rejection carried a reason, and that is what the agent learns from.' : null} />
                {skipped.length ? (
                  <Btn variant="secondary" onClick={() => this.again()} style={sx('height:38px;padding:0 16px;border-radius:6px;gap:10px')}>
                    <span>{skipped.length} skipped — go round again</span>
                    <Key k={KEYS.again} />
                  </Btn>
                ) : null}
                {this.props.onExit ? (
                  <Btn variant="ghost" onClick={this.props.onExit} style={sx('height:34px;padding:0 14px;border-radius:6px;gap:10px')}>
                    <span>Back to today</span>
                    <Key k="Esc" />
                  </Btn>
                ) : null}
              </div>
            ) : (
              <>
                {/* ── who proposed it, and how old it is — on every card, before anything else ── */}
                <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 2px')}>
                  <div style={sx('display:flex;align-items:center;gap:10px;min-width:0')}>
                    <span style={{ ...mono('display:inline-flex;align-items:center;height:20px;padding:0 9px;border-radius:6px;border:1px solid var(--border-2);font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted)') }}>
                      {kind.label}
                    </span>
                    <span style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap') }}>
                      PROPOSED BY {String(card.proposedBy).toUpperCase()}
                    </span>
                  </div>
                  {/* Law 3 rendered as a form, one implementation, identical everywhere. */}
                  <Freshness value={card.at} />
                </div>

                <article style={sx('flex:1;min-height:0;display:flex;flex-direction:column;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;overflow:hidden')}>

                  {/* altitude 1 + altitude 2 scroll; the action bar below never moves. */}
                  <div style={sx('flex:1;min-height:0;overflow-y:auto')}>
                    <CardBody
                      card={card}
                      onOpenPath={this.props.onOpenPath}
                      answer={this.currentAnswer()}
                      onAnswer={v => this.setState({ answer: v, answerFor: card.id })}
                      onSubmit={() => this.commit('accept')}
                    />

                    {/* ── altitude 2 ── */}
                    <div style={sx('border-top:1px solid var(--line);padding:14px 40px;display:flex;align-items:center;gap:18px')}>
                      <TextToggle open={why} label="WHY" k={KEYS.why} onClick={() => this.setState(s => ({ why: !s.why, ev: false }))} />
                      {why ? (
                        <span style={{ ...mono('font-size:10px;font-weight:500;letter-spacing:.1em;color:var(--fg-faint)') }}>EVIDENCE IS ONE MORE CLICK, INSIDE</span>
                      ) : null}
                    </div>

                    {why ? (
                      <div style={sx('border-top:1px solid var(--line);padding:24px 40px 26px;display:flex;flex-direction:column;gap:18px')}>
                        {card.why ? (
                          <p style={sx('margin:0;max-width:64ch;font-size:14.5px;line-height:1.68;color:var(--fg-soft);text-wrap:pretty')}>{card.why}</p>
                        ) : (
                          <span style={{ ...mono('font-size:10.5px;font-weight:600;letter-spacing:.12em;color:var(--warn)') }}>NO REASONING WAS ATTACHED TO THIS CARD</span>
                        )}

                        {/* The card's `## Notes` — the caveat the assistant wants read before a
                            yes. Altitude 2, next to the reasoning, never on the front of the card. */}
                        {card.notes ? (
                          <div style={sx('display:flex;flex-direction:column;gap:8px')}>
                            <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint)') }}>WORTH KNOWING</span>
                            <p style={sx('margin:0;max-width:64ch;font-size:13px;line-height:1.65;color:var(--fg-muted);text-wrap:pretty')}>{card.notes}</p>
                          </div>
                        ) : null}

                        {/* altitude 3 lives INSIDE altitude 2 — unreachable until WHY is open. */}
                        <TextToggle open={ev} label={ev ? 'EVIDENCE' : 'SHOW ME THE EVIDENCE'} k={KEYS.evidence} onClick={() => this.setState(s => ({ ev: !s.ev }))} />

                        {ev ? (
                          <div style={sx('display:flex;gap:20px;padding:18px 20px;background:var(--sunk);border:1px solid var(--border);border-radius:6px')}>
                            <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:9px')}>
                              {card.evidence.map((row, i) => (
                                <div key={i} style={sx('display:flex;gap:12px;align-items:baseline')}>
                                  <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint)'), flex: 'none', width: 96 }}>{row.k}</span>
                                  <span style={{ ...mono('font-size:11px;font-weight:500;line-height:1.55;color:var(--fg-soft)'), flex: 1, minWidth: 0 }}>{row.v}</span>
                                </div>
                              ))}
                              {/* The documents the claim was built from. Each one opens (Law 8). */}
                              {card.evidenceRefs.length ? (
                                <>
                                  <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint)') }}>{card.evidenceRefs.length} DOCUMENTS BEHIND THIS</span>
                                  <RefList refs={card.evidenceRefs} onOpenPath={this.props.onOpenPath} />
                                </>
                              ) : null}
                              {!card.evidence.length && !card.evidenceRefs.length ? (
                                <span style={{ ...mono('font-size:10.5px;font-weight:600;letter-spacing:.12em;color:var(--fg-faint)') }}>NO EVIDENCE WAS ATTACHED</span>
                              ) : null}
                              {/* The raw file is always two clicks from the decision. */}
                              {path && this.props.onOpenPath ? (
                                <Btn variant="ghost" className="hAccent" onClick={() => this.openFile()} style={sx('padding:2px 0 0;border:none;border-radius:0;font-size:11.5px;font-weight:600;color:var(--accent);width:fit-content;gap:8px')}>
                                  <span>Open {path}</span>
                                  <Key k={KEYS.open} />
                                </Btn>
                              ) : path ? (
                                <span style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-faint);padding-top:2px') }}>{path}</span>
                              ) : null}
                              {card.file && card.file !== path && this.props.onOpenPath ? (
                                <Btn variant="ghost" className="hAccent" onClick={() => this.openFile(card.file)} style={sx('padding:0;border:none;border-radius:0;font-size:11.5px;font-weight:600;color:var(--accent);width:fit-content')}>
                                  <span>Open the card itself — {card.file}</span>
                                </Btn>
                              ) : null}
                              {card.sourceUrl ? (
                                <a href={card.sourceUrl} target="_blank" rel="noreferrer" style={sx('font-size:11.5px;font-weight:600;color:var(--accent);width:fit-content')}>Open the source</a>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* ── the decision. Same place on every card, all day. ── */}
                  <div style={sx('flex:none;border-top:1px solid var(--border);background:var(--surface);padding:20px 40px 22px')}>
                    {failure ? (
                      <div style={{ ...mono('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--danger);margin-bottom:12px') }}>{failure}</div>
                    ) : null}

                    {mode === 'decide' ? (
                      <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:16px')}>
                        <div style={sx('display:flex;align-items:center;gap:10px')}>
                          <Btn variant="primary" busy={busy} onClick={() => this.commit('accept')} style={sx('height:44px;padding:0 22px;border-radius:6px;font-size:13.5px;font-weight:600;gap:10px')}>
                            <span>{kind.yes}</span>
                            <Key k={KEYS.accept} on="accent" />
                          </Btn>
                          <Btn variant="ghost" disabled={busy} onClick={() => this.setState({ mode: 'reject' })} style={sx('height:44px;padding:0 18px;border-radius:6px;background:var(--raise);font-size:13.5px;font-weight:600;color:var(--fg-soft);gap:10px')}>
                            <span>{kind.no}</span>
                            <Key k={KEYS.reject} />
                          </Btn>
                          <Btn variant="ghost" disabled={busy} onClick={() => this.skip()} style={sx('height:44px;padding:0 14px;border-radius:6px;border:none;font-size:13.5px;font-weight:500;color:var(--fg-muted);gap:10px')}>
                            <span>Skip</span>
                            <Key k={KEYS.skip} />
                          </Btn>
                        </div>
                        {/* What accepting MEANS, on the card. T13's table, rendered. */}
                        <span style={{ ...mono('font-size:10px;font-weight:500;letter-spacing:.06em;color:var(--fg-faint);text-align:right') }}>
                          YES {kind.effect}
                        </span>
                      </div>
                    ) : (
                      <div style={sx('display:flex;flex-direction:column;gap:14px')}>
                        <div style={sx('display:flex;align-items:center;gap:10px')}>
                          <span style={sx('width:6px;height:6px;border-radius:9999px;background:var(--warn)')} />
                          <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--warn)')}>WHY NOT? — ONE KEY</Eyebrow>
                          <span style={{ ...mono('font-size:10px;font-weight:500;color:var(--fg-faint);margin-left:auto') }}>THIS IS THE ONLY THING THE AGENT LEARNS FROM</span>
                        </div>
                        <div style={sx('display:flex;flex-wrap:wrap;gap:8px')}>
                          {REJECT_REASONS.map(r => (
                            <Btn key={r.id} variant="ghost" disabled={busy} onClick={() => this.commit('reject', r.id)}
                              style={sx('height:38px;padding:0 14px 0 10px;border-radius:6px;background:var(--raise);color:var(--fg-soft);font-size:12.5px;font-weight:500;gap:9px')}>
                              <Key k={r.key} />
                              <span>{r.label}</span>
                            </Btn>
                          ))}
                          <Btn variant="ghost" onClick={() => this.setState({ mode: 'decide' })} style={sx('height:38px;padding:0 14px;border-radius:6px;border:none;color:var(--fg-muted);font-size:12.5px;font-weight:500;gap:9px')}>
                            <Key k="Esc" />
                            <span>Back</span>
                          </Btn>
                        </div>
                      </div>
                    )}
                  </div>
                </article>

                <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 2px 0')}>
                  <span style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap') }}>
                    {next ? 'NEXT — ' + kindOf(next).label + ' / ' + shortTitle(next) : 'LAST ONE'}
                  </span>
                  <span style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-faint)') }}>{ahead} MORE WAITING</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── the day's tally, the file this card came from, and the way back ── */}
        <footer style={sx('flex:none;height:42px;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 20px;background:var(--surface);border-top:1px solid var(--line)')}>
          <div style={sx('display:flex;align-items:center;gap:18px;min-width:0')}>
            <Tally tone="var(--ok)" label="YES" n={yes} />
            <Tally tone="var(--danger)" label="NO" n={no} />
            <Tally tone="var(--border-3)" label="SKIPPED" n={skip} />
            <span style={sx('width:1px;height:14px;background:var(--border)')} />
            <span style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap') }}>{path || 'proposals/'}</span>
          </div>
          <div style={sx('flex:none;display:flex;align-items:center;gap:14px')}>
            <span style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-faint)') }}>{last ? 'LAST — ' + last.text : 'NOTHING DECIDED YET'}</span>
            <Btn
              variant="secondary"
              disabled={!skipped.length}
              onClick={() => this.undo()}
              title={skipped.length ? 'Put the last skipped card back' : 'A decision is on disk with its reason and stays there (Law 5). Only a skip can be taken back.'}
              style={sx('height:26px;padding:0 10px;border-radius:6px;font-size:11px;font-weight:600;gap:8px')}
            >
              <span>Undo skip</span>
              <span style={{ ...mono('font-size:10px;font-weight:600') }}>&#8984;Z</span>
            </Btn>
          </div>
        </footer>
      </div>
    );
  }
}

function Tally({ tone, label, n }) {
  return (
    <div style={sx('display:flex;align-items:center;gap:7px')}>
      <span style={{ ...sx('width:5px;height:5px;border-radius:9999px'), background: tone }} />
      <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.16em;color:var(--fg-muted)')}>{label}</Eyebrow>
      <span style={{ ...mono('font-size:11.5px;font-weight:600;color:var(--fg-soft)') }}>{n}</span>
    </div>
  );
}

function shortTitle(card) {
  const t = String((card && card.title) || (card && card.id) || '').replace(/\?$/, '').trim();
  return (t.length > 46 ? t.slice(0, 45) + '…' : t).toUpperCase();
}

// Deliberately no re-export of KIND / REJECT_REASONS from here: DecideCards.jsx is the one place
// they live, and a second import path is how a second vocabulary starts.
