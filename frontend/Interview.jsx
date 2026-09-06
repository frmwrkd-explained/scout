// frontend/Interview.jsx — the first-run interview. T16 step 3, GOAL.md gate 1, Law 9.
//
// "The workspace is built WITH the person, not shipped TO them." This is the screen where that
// happens, and it is the first thing a new person ever sees, so it is held to the strictest reading
// of every law in docs/01_CANON.md:
//
//   Law 2 — ONE QUESTION PER SCREEN. One heading, one field, one button. No screen here offers two
//           decisions. Going back lives in the progress pips, which is navigation, not a choice.
//   Law 4 — the interview PROPOSES the collection and the human approves it in DECIDE, on the same
//           card queue as everything else. This screen has no approve button and never will.
//   Law 8 — the answers are in `.scout/intake.md` from the moment they are given, and the screen
//           says so. Closing the window costs nothing.
//   Law 9 — nothing here is a template. The columns are the person's own phrases.
//   Law 10 — the questions, their examples and the derived plan all come from GET /api/intake.
//           backend/intake.mjs owns that wording; a second copy of it in this file would be the
//           duplication the law exists to stop.
//
// The tone is frontend/Hire.jsx's: real questions in the reading face, mono only for the small
// print, and one solid accent fill on the screen — the button that moves forward.
//
// PROPS
//   actor         string   who is answering. Default 'crystal', the human default every UI surface
//                          in this app sends (records.mjs DEFAULT_ACTOR). Do NOT pass the person's
//                          own name here unless the whole app starts sending it: me.md records the
//                          actor as `created_by`, and memory.mjs `isAgentActor` would then read a
//                          mismatched later actor as an agent and 403 her out of her own identity.
//   app           object   optional. Passed straight to VoiceInput for `showToast` (mic denied,
//                          transcription failed). Everything works without it.
//   onDone(result)         called once the card is proposed. `{ proposal, schema, collection, state }`.
//                          The integrator should land on DECIDE — the card is waiting there.
//   onCancel()             optional. Rendered only on the last screen, as a ghost, and only if
//                          given; a question screen never shows two ways out.
//   onOpenPath(path)       optional. Law 8 — the way down to `.scout/intake.md` while it is being
//                          filled in.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Card, Empty, Eyebrow, Input } from './ui';
import { monoStyle } from './Assistants';
import VoiceInput from './VoiceInput';

// ── small shared pieces ───────────────────────────────────────────────────────────────────────

const EYEBROW = { fontSize: '9.5px', fontWeight: 800, letterSpacing: '.18em', color: 'var(--fg-muted)' };
const SMALL = () => ({ ...monoStyle('font-size:10px;font-weight:500;letter-spacing:.06em;line-height:1.55'), color: 'var(--fg-faint)' });

const list = xs => (xs.length < 2 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const lower = s => String(s || '').replace(/\.$/, '').replace(/^[A-Z](?![A-Z])/, c => c.toLowerCase());

// The pips from design/Today.dc.html, and the only way back. Answered pips are clickable; the one
// you are on and the ones ahead are not. Deliberately not the accent — the accent on this screen
// belongs to the button that moves you forward, and nothing else.
function Pips({ total, at, onGo }) {
  return (
    <div style={sx('display:flex;gap:3px;height:3px;width:78px')}>
      {Array.from({ length: total }, (_, k) => {
        const done = k < at;
        return (
          <span key={k} onClick={done && onGo ? () => onGo(k) : undefined}
            title={done ? 'Back to question ' + (k + 1) : 'Question ' + (k + 1)}
            style={{
              ...sx('flex:1;border-radius:1px'),
              cursor: done && onGo ? 'pointer' : 'default',
              background: done ? 'var(--fg-soft)' : k === at ? 'var(--fg-muted)' : 'var(--border)',
            }} />
        );
      })}
    </div>
  );
}

// The multi-line field. `ui.jsx` has an <Input> and no textarea, and InlineEdit's textarea is
// click-to-edit, which is the wrong affordance for a question somebody is being asked right now.
// Every value below is Input's own (INPUT_STYLE in ui.jsx) so the two read as one control — if a
// Textarea primitive ever lands in ui.jsx, delete this and import it.
function Box({ style, ...rest }) {
  return (
    <textarea {...rest}
      style={{
        ...sx('width:100%;box-sizing:border-box;background:var(--sunk);border:1px solid var(--border-2);border-radius:6px;padding:12px 14px;resize:vertical;line-height:1.55'),
        color: 'var(--fg)', fontFamily: 'inherit', fontSize: 14, ...style,
      }} />
  );
}

// ── the screen ────────────────────────────────────────────────────────────────────────────────

export default function Interview({ actor = 'crystal', app = null, onDone, onCancel, onOpenPath }) {
  const [state, setState] = React.useState(null);
  const [at, setAt] = React.useState(0);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [proposal, setProposal] = React.useState(null);
  // Whether a transcription key is configured — GET /api/state's publicSettings() redacts a set
  // key rather than omitting it, so its presence (not its value) is the signal. A denied mic or a
  // missing key used to fail silently on question 1, because this screen never passed `app` to
  // VoiceInput at all; now it does (App.jsx), and the mic disables itself with a reason instead of
  // recording ten seconds of silence into a 400.
  const [micKey, setMicKey] = React.useState(true);

  // Resume where they left off. Every answer is already on disk, so this is the whole of "nothing
  // is lost" on the client side: there is no draft state to restore because there is no draft.
  React.useEffect(() => {
    let alive = true;
    api.intake()
      .then(s => { if (!alive) return; setState(s); setAt(s.step); setDraft(String((s.answers || {})[(s.questions[s.step] || {}).key] || '')); })
      .catch(e => { if (alive) setError(e.message); });
    api.state().then(s => { if (alive) setMicKey(!!(s.settings && s.settings.groqApiKey)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const questions = (state && state.questions) || [];
  const total = questions.length;
  const q = questions[at] || null;
  const plan = (state && state.plan) || null;
  const reviewing = !!state && at >= total;

  const go = k => {
    setError(null);
    setAt(k);
    setDraft(String(((state && state.answers) || {})[(questions[k] || {}).key] || ''));
  };

  async function next() {
    if (!q || busy) return;
    if (q.required && !draft.trim()) {
      setError('I do need this one before I can carry on.');
      return;
    }
    setBusy(true); setError(null);
    try {
      const s = await api.intakeAnswer(q.key, draft, actor);
      setState(s);
      const k = at + 1;
      setAt(k);
      setDraft(String((s.answers || {})[(questions[k] || {}).key] || ''));
    } catch (e) {
      setError(e.message || 'That would not save.');
    } finally { setBusy(false); }
  }

  async function build() {
    if (busy || !plan) return;
    setBusy(true); setError(null);
    try {
      // Two writes and one card: me.md and the ground need nobody's permission, the list does.
      const built = await api.intakeBuild(actor);
      const card = await api.proposeCollection(built.card);
      setProposal(card);
      setState(built.state || state);
    } catch (e) {
      // build is idempotent, so the button below simply says "try that again".
      setError(e.message || 'The workspace would not take that.');
    } finally { setBusy(false); }
  }

  // ── loading ────────────────────────────────────────────────────────────────────────────────
  if (!state) {
    return (
      <Shell>
        <Empty size="page" title={error ? 'COULD NOT REACH YOUR WORKSPACE' : 'ONE MOMENT'} body={error || null} />
      </Shell>
    );
  }

  // ── done: the card is waiting ──────────────────────────────────────────────────────────────
  if (proposal) {
    const label = (plan && plan.schema.label) || 'your list';
    return (
      <Shell>
        <Head eyebrow="ONE THING NEEDS YOU"
          title={'That is everything I need. ' + label + ' is waiting for your yes.'}
          body={'I have written down who you are and where to look — neither of those needed my asking twice. The list itself I never create on my own, so it is a card, and one press makes it real.'} />
        <Card tone="accent" label="WAITING IN DECIDE" style={sx('padding:18px 20px')}>
          <p style={sx('margin:0;font-size:14px;line-height:1.65;color:var(--fg-soft)')}>{proposal.why || proposal.title}</p>
        </Card>
        <div style={sx('display:flex;align-items:center;gap:12px')}>
          <Btn variant="primary" size="lg" style={{ height: 40 }}
            onClick={() => onDone && onDone({ proposal, schema: plan && plan.schema, collection: plan && plan.schema.id, state })}>
            Show me the card
          </Btn>
          <span style={SMALL()}>NOTHING EXISTS UNTIL YOU SAY YES</span>
        </div>
      </Shell>
    );
  }

  // ── review: the read-back, before anything is written ──────────────────────────────────────
  if (reviewing) {
    return (
      <Shell>
        <Head eyebrow="BEFORE I START"
          title="Here is what I understood. Change anything that is wrong."
          body="Nothing has been created yet. Press any mark on the right to go back to an answer." />
        <Card label="THE PLAN" style={sx('padding:20px 22px;background:var(--surface-2)')}
          right={<Pips total={total} at={total} onGo={go} />}>
          {plan ? <ReadBack plan={plan} /> : (
            <p style={sx('margin:0;font-size:14px;line-height:1.65;color:var(--warn)')}>
              {state.planError || 'I could not make sense of that yet — go back and tell me what to keep track of.'}
            </p>
          )}
        </Card>
        {error ? <Warn>{error}</Warn> : null}
        <div style={sx('display:flex;align-items:center;gap:12px')}>
          <Btn variant="primary" size="lg" style={{ height: 40 }} busy={busy} disabled={!plan} onClick={build}>
            {error ? 'Try that again' : 'Set it up'}
          </Btn>
          {onCancel ? <Btn variant="ghost" size="lg" style={{ height: 40 }} onClick={onCancel}>Not now</Btn> : null}
          <span style={SMALL()}>THE LIST STILL NEEDS YOUR YES ON A CARD</span>
        </div>
        <Filed path={state.path} onOpenPath={onOpenPath} />
      </Shell>
    );
  }

  // ── one question ───────────────────────────────────────────────────────────────────────────
  const answered = draft.trim().length > 0;
  const ahead = questions.slice(at + 1, at + 6);

  return (
    <Shell>
      <Head eyebrow="SCOUT IS AWAKE"
        title="I am going to work for you while you sleep. First I need to know what for."
        body={total + ' short questions, one at a time. Every answer is saved the moment you give it, so you can close this and come back. You can change any of them later, and I will come back and ask rather than guess.'} />

      <div style={{
        ...sx('display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:8px'),
        background: 'var(--surface-2)', border: '1px solid var(--border)',
      }}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px')}>
          <span style={{ ...monoStyle('font-size:9.5px;font-weight:600;letter-spacing:.14em'), color: 'var(--fg-faint)' }}>
            QUESTION {at + 1} OF {total}
          </span>
          <Pips total={total} at={at} onGo={go} />
        </div>

        <p style={sx('margin:0;font-size:19px;font-weight:500;line-height:1.4;color:var(--fg);text-wrap:pretty')}>{q.question}</p>

        <div style={sx('display:flex;align-items:flex-start;gap:10px')}>
          {/* `key` is the question, so the field REMOUNTS on every question and autoFocus fires
              again. ui.jsx's Input is a plain function component and cannot take a ref; remounting
              is the honest way to move the cursor rather than reaching around the primitive. */}
          <div style={sx('flex:1;min-width:0')}>
            {q.lines > 1 ? (
              <Box key={q.key} autoFocus rows={q.lines} value={draft} placeholder={q.example}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); next(); } }} />
            ) : (
              <Input key={q.key} autoFocus value={draft} placeholder={q.example}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); next(); } }}
                style={sx('width:100%;box-sizing:border-box;height:46px;padding:0 14px;background:var(--sunk);border-radius:6px;font-size:14px;font-family:inherit')} />
            )}
          </div>
          {/* the interview is voice-enabled (GOAL.md) — the same recorder every other surface uses */}
          <VoiceInput app={app} size={38}
            disabled={!micKey}
            disabledReason="No transcription key configured yet — add one in Settings"
            onText={t => setDraft(d => (d.trim() ? d.replace(/\s*$/, ' ') + t : t))} />
        </div>

        {/* The example is on screen in both states: as the placeholder while the field is empty,
            as this line once it is not. Nobody is ever left guessing what a good answer looks like. */}
        <span style={SMALL()}>{answered ? 'FOR EXAMPLE — ' + q.example : (q.hint || 'PLAIN LANGUAGE IS FINE')}</span>

        {error ? <Warn>{error}</Warn> : null}

        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:2px')}>
          <span style={SMALL()}>{q.becomes}</span>
          <Btn variant="primary" size="lg" busy={busy} onClick={next} style={{ height: 40 }}
            title={q.lines > 1 ? 'Cmd + Enter' : 'Enter'}>
            <span>{at + 1 === total ? 'That is everything' : 'Next question'}</span>
            <span style={{ opacity: .55 }}>↵</span>
          </Btn>
        </div>
      </div>

      {ahead.length ? (
        <div style={sx('display:flex;flex-direction:column;gap:8px')}>
          <Eyebrow style={EYEBROW}>WHAT I WILL ASK NEXT</Eyebrow>
          <div style={sx('display:flex;flex-direction:column;gap:6px')}>
            {ahead.map(u => <span key={u.key} style={SMALL()}>{u.question}</span>)}
          </div>
        </div>
      ) : null}

      <Filed path={state.path} onOpenPath={onOpenPath} />
    </Shell>
  );
}

// ── the pieces ────────────────────────────────────────────────────────────────────────────────

// design/EXTRACT.md §3.2: the first-run column is max-width 660px, centred.
function Shell({ children }) {
  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow-y:auto')}>
      <div style={sx('width:100%;max-width:660px;margin:0 auto;padding:44px 24px 56px;display:flex;flex-direction:column;gap:28px')}>
        {children}
      </div>
    </div>
  );
}

function Head({ eyebrow, title, body }) {
  return (
    <div style={sx('display:flex;flex-direction:column;gap:14px')}>
      <div style={sx('display:flex;align-items:center;gap:10px')}>
        <span style={{ ...sx('flex:none;border-radius:99px'), width: 7, height: 7, background: 'var(--ok)' }} />
        <Eyebrow style={EYEBROW}>{eyebrow}</Eyebrow>
      </div>
      <h1 style={sx('margin:0;font-size:24px;font-weight:500;line-height:1.35;letter-spacing:-.01em;color:var(--fg);text-wrap:pretty')}>{title}</h1>
      {body ? <p style={sx('margin:0;font-size:15px;line-height:1.6;color:var(--fg-muted);max-width:56ch;text-wrap:pretty')}>{body}</p> : null}
    </div>
  );
}

function Warn({ children }) {
  return <span style={{ ...monoStyle('font-size:11px;font-weight:600;line-height:1.5'), color: 'var(--warn)' }}>{children}</span>;
}

// Law 8, on the very first screen: the answers are a file, it is named, and it is reachable.
function Filed({ path, onOpenPath }) {
  if (!path) return null;
  const label = 'SAVED AS YOU GO — ' + path;
  return onOpenPath
    ? <button type="button" className="hFgL" onClick={() => onOpenPath(path)}
      style={{ ...SMALL(), ...sx('padding:0;margin:0;text-align:left;background:none;border:none;cursor:pointer') }}>{label}</button>
    : <span style={SMALL()}>{label}</span>;
}

// The read-back. Everything they said, as sentences they can check without decoding anything —
// the same move frontend/Hire.jsx makes with THE DEAL, for the same reason. No field types, no
// YAML, no word "collection".
function ReadBack({ plan }) {
  const columns = (plan.fields || []).filter(f => !f.gate).map(f => lower(f.label));
  const ground = (plan.territories || []).map(t => t.label);
  const home = 'data/' + plan.schema.id + '/';
  return (
    <div style={sx('display:flex;flex-direction:column;gap:11px')}>
      <Line>
        I will keep a list called <B>{plan.schema.label}</B> — one file for each one, and you can open
        any of them in Finder.
      </Line>
      <Line>
        For each one I will keep {columns.length ? list(columns) : 'a name'}, and where it has got to.
      </Line>
      <Line>
        {ground.length
          ? <>I will work {list(ground)}, and nowhere else until you say otherwise.</>
          : <>You have not told me where to look yet, so I will wait for you rather than wander.</>}
      </Line>
      <Line>
        And I will write down who you are in your own words, so I never have to ask again.
      </Line>
      <span style={SMALL()}>{home}</span>
    </div>
  );
}

const Line = ({ children }) => (
  <p style={sx('margin:0;font-size:14.5px;line-height:1.65;color:var(--fg-soft);text-wrap:pretty')}>{children}</p>
);
const B = ({ children }) => (
  <strong style={sx('font-weight:600;color:var(--fg)')}>{children}</strong>
);

export { Interview };
