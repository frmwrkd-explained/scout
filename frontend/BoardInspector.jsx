// The Board's shot inspector — the side card that opens when you press OPEN on a shot card.
//
// It exists because the board is where a project gets decided, and every decision it invites used
// to require leaving it: to read the prompt, to fire another take, to change a duration, to see
// what the last note said. Bouncing to the Story tab and back loses your place on the canvas, which
// is the one thing a board is for.
//
// ── WHAT IT IS ALLOWED TO OWN ──────────────────────────────────────────────────────────────────
// Nothing. Every write goes through the routes that already own it — `api.patchShot` for the
// record, `shotGenerateBody` + `api.generate` for a fresh take, `api.rerollCandidate` for the same
// take again. There is deliberately no board-specific shot mutation: a shot edited here and a shot
// edited in Story must be the same edit, or the board becomes a second opinion about the project.
//
// ── IT RENDERS THE COMPOSER, NOT A PROMPT BOX ──────────────────────────────────────────────────
// The prompt field and the Generate button here ARE `frontend/Composer.jsx` — the same bar as chat,
// the project generate console, the shot workspace, Story and the asset boards. The first version
// of this panel hand-rolled a textarea and a button, which is precisely the thing CLAUDE.md's
// "Shared UI" section says has been violated more than any other rule in this repo: it would have
// been a sixth prompt UI with its own model picker story, its own per-model params story, and its
// own idea of what a reference chip looks like. Composer is controlled and presentational, so the
// only thing this panel owns is the submit — which is correct, because the route fork
// (variantCount 1 → /api/generate, >1 → /api/batches) is real logic that belongs to the surface.
//
// ── GENERATE vs RE-ROLL ────────────────────────────────────────────────────────────────────────
// Two buttons, because they are genuinely two things and Story learned this the hard way (see its
// DEV-134 comment). RE-ROLL replays the last take's STORED request — same model, same params, same
// references — which is what "one more take" has to mean. GENERATE composes a fresh request from
// the shot's current prompt and look, which is what you want after editing either. Offering only
// one of them is how "one more take" silently produced something else.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';
import { Btn } from './ui';
import { RenderMedia } from './RenderMedia';
import { SHOT_STATUS, SHOT_TYPES, DEFAULT_RESOLUTION } from './models';
import Composer, { ComposerDock } from './Composer';
import { shotGenerateBody, defaultShotModel, lookForShot } from './shotGenerate';
import { takesForShot, heroTake } from './shotTakes';

// The panel is a BOTTOM DOCK, not a side rail. Two reasons, both learned the hard way:
//   · Composer is a horizontal bar and `ComposerDock` already declares where it belongs — floating
//     near the bottom, centred, DOCK_WIDTH max. CLAUDE.md: "never hand-roll a wrapper around
//     <Composer> — placement is part of zero variants." A 380px rail wrapped a 60-word prompt into
//     a forty-line column and made the model/format chips wrap under the send button.
//   · A canvas is read horizontally. A right rail eats the width you were panning across; a bottom
//     dock eats height you were not using, and leaves the selected card visible above it.
export const INSPECTOR_H = 340;

const STATUSES = ['todo', 'generating', 'review', 'done'];

// The shot log is the comment thread. It is append-only markdown on the shot record and it is
// already where every automated event lands ("generation … queued", "selected … from the board"),
// so a human note goes in the same stream rather than into a parallel comments field that would
// have to be merged with it to read the history.
function parseLog(log) {
  return String(log || '').split('\n').map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => {
      const body = l.slice(2);
      const m = body.match(/^(.+?)\s+—\s+([\s\S]*)$/);
      return m ? { when: m[1], text: m[2] } : { when: '', text: body };
    })
    .reverse();                                   // newest first — a log you scroll to read is not read
}

export default class BoardInspector extends React.Component {
  constructor(props) {
    super(props);
    // `tab` is null by default: the dock opens as one compact row — still, title, setup and
    // the composer. Takes and Notes EXPAND it, rather than being panes you must choose between.
    this.state = { gen: null, note: '', busy: '', err: '', tab: null };
  }
  componentDidUpdate(prev) {
    // A different shot means the draft belongs to the previous one — drop it rather than carrying
    // a half-typed prompt onto someone else's shot.
    if (prev.shot && this.props.shot && prev.shot.id !== this.props.shot.id) {
      this.setState({ gen: null, note: '', err: '', tab: null });
    }
  }

  // The Composer's controlled value. Seeded from the SHOT — its own prompt, the project's default
  // model — so opening the panel shows what this shot would actually generate, not an empty bar.
  genValue() {
    const { app, pid, shot } = this.props;
    if (this.state.gen) return this.state.gen;
    return {
      prompt: shot.prompt || shot.desc || '',
      model: defaultShotModel(app, pid),
      aspect: '16:9', resolution: DEFAULT_RESOLUTION,
      seed: null, variantCount: 1, params: {}
    };
  }

  patch(patch, log) {
    const { app, pid, shot } = this.props;
    return api.patchShot(pid, shot.id, patch, log)
      .then(() => app.sync && app.sync())
      .catch(e => this.setState({ err: e.message }));
  }

  // The surface owns the submit, and the route fork with it — see the note at the top. Composer
  // deliberately does not post, because `variantCount` is not a field on /api/generate at all and a
  // composer that "just posted" would silently collapse every batch to 1×.
  async generate() {
    const { app, pid, shot } = this.props;
    const v = this.genValue();
    const prompt = String(v.prompt || '').trim();
    if (!prompt) return this.setState({ err: 'Write a prompt first.' });
    this.setState({ busy: 'generate', err: '' });
    try {
      // shotGenerateBody stays THE composer of a shot → a request: it resolves the look, joins the
      // fragment and attaches cast/location refs. The bar's own edits ride on top of it.
      const base = shotGenerateBody(app, pid, shot, {
        model: v.model, aspect: v.aspect, resolution: v.resolution, seed: v.seed, params: v.params
      }) || { pid, shot: shot.id, model: v.model, aspect: v.aspect, resolution: v.resolution, seed: v.seed, refs: [] };
      const body = { ...base, prompt };
      if (Number(v.variantCount) > 1) await api.createBatch({ ...body, variantCount: Number(v.variantCount) });
      else await api.generate(body);
      // the prompt the user just committed becomes the shot's, so the next open shows it
      if (prompt !== (shot.prompt || '')) await this.patch({ prompt }, 'prompt set from the board composer');
      app.showToast((Number(v.variantCount) > 1 ? v.variantCount + ' takes queued · ' : 'Take queued · ') + (shot.title || shot.id), 'green');
      app.sync && app.sync();
    } catch (e) { this.setState({ err: e.message }); }
    this.setState({ busy: '' });
  }

  async reroll() {
    const { app, pid, shot, pdef } = this.props;
    const last = takesForShot(pdef, shot).filter(t => t.file).pop();
    if (!last) return this.generate();            // nothing to replay — deriving IS the honest answer
    this.setState({ busy: 'reroll', err: '' });
    try {
      await api.rerollCandidate(pid, last.id, { freshSeed: true });
      app.showToast('Re-rolling the last take · ' + (shot.title || shot.id), 'green');
      app.sync && app.sync();
    } catch (e) { this.setState({ err: e.message }); }
    this.setState({ busy: '' });
  }

  async addNote() {
    const text = this.state.note.trim();
    if (!text) return;
    this.setState({ note: '', busy: 'note' });
    await this.patch({}, text);                   // an empty patch with a log line IS a comment
    this.setState({ busy: '' });
  }

  field(label, children, w) {
    return (
      <div style={{ ...sx('display:flex;flex-direction:column;gap:4px'), width: w || 'auto' }}>
        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--fg-faint)' }}>{label.toUpperCase()}</span>
        {children}
      </div>
    );
  }

  render() {
    const { shot, pdef, pid, app, onClose, onPickTake, entities = [] } = this.props;
    if (!shot) return null;
    const { busy, err, tab } = this.state;
    let look = null;
    try { look = lookForShot(app, pid, shot); } catch { /* no locks loaded */ }
    const takes = takesForShot(pdef, shot);
    const hero = heroTake(pdef, shot);
    const heroUrl = hero && hero.file ? api.renderUrl(pid, hero.file) : null;
    const log = parseLog(shot.log);

    const input = extra => ({
      ...sx('box-sizing:border-box;border-radius:6px;padding:5px 8px;outline:none;font-size:11.5px'),
      background: 'var(--sunk)', border: '1px solid var(--border-2)', color: 'var(--fg)', ...extra
    });

    return (
      <ComposerDock position="absolute" bottom={16} maxWidth={1180}>
        <div onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
          style={{
            ...sx('display:flex;flex-direction:column;border-radius:14px;overflow:hidden'),
            maxHeight: INSPECTOR_H,
            background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
            backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid var(--border-2)', boxShadow: '0 22px 60px rgba(0,0,0,.55)',
            animation: 'dl-in .16s ease-out'
          }}>

          {/* ── one horizontal header: the still, who it is, the setup, the tabs ── */}
          <div style={sx('flex:none;display:flex;align-items:stretch;gap:14px;padding:10px 12px;border-bottom:1px solid var(--border)')}>
            <div style={{ ...sx('flex:none;position:relative;border-radius:8px;overflow:hidden;background:var(--sunk)'), width: 132, aspectRatio: '16 / 9', border: '1px solid var(--border)' }}>
              {heroUrl
                ? <RenderMedia src={heroUrl} kind={hero.video ? 'video' : 'image'} fit="cover" hoverPlay style={sx('width:100%;height:100%;display:block')} />
                : <div style={sx('width:100%;height:100%;display:flex;align-items:center;justify-content:center')}>
                  <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)', letterSpacing: '.08em' }}>NO TAKE</span>
                </div>}
              {hero && !hero.approved && (
                <span style={{ ...sx('position:absolute;top:4px;left:4px;border-radius:3px;padding:1px 5px'), fontFamily: MONO, fontSize: 7.5, fontWeight: 800, color: 'var(--warn)', background: 'rgba(6,7,10,.82)' }}>UNAPPROVED</span>
              )}
            </div>

            <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:7px')}>
              <div style={sx('display:flex;align-items:center;gap:10px')}>
                <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--fg-faint)', flex: 'none' }}>
                  {shot.id} {shot.scene ? '· SCENE ' + shot.scene : '· UNASSIGNED'}
                </span>
                <input defaultValue={shot.title || ''} key={shot.id} placeholder="Untitled shot"
                  onBlur={e => { if (e.target.value !== (shot.title || '')) this.patch({ title: e.target.value }, 'renamed from the board'); }}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }}
                  style={{ ...sx('flex:1;min-width:0;background:transparent;border:none;outline:none;padding:1px 0'), fontSize: 13.5, fontWeight: 700, color: 'var(--fg)' }} />
              </div>

              {/* the setup lives in the header as a row — four short fields, always visible, never
                  a tab you have to go and find */}
              <div style={sx('display:flex;align-items:flex-end;gap:9px;flex-wrap:wrap')}>
                {this.field('type', (
                  <select defaultValue={shot.type || 'Medium'} key={shot.id + 'type'}
                    onChange={e => this.patch({ type: e.target.value }, 'type → ' + e.target.value)} style={input({ width: 104 })}>
                    {SHOT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                ))}
                {this.field('status', (
                  <select defaultValue={shot.status || 'todo'} key={shot.id + 'st'}
                    onChange={e => this.patch({ status: e.target.value }, 'status → ' + e.target.value)} style={input({ width: 108 })}>
                    {STATUSES.map(x => <option key={x} value={x}>{(SHOT_STATUS[x] || {}).label || x}</option>)}
                  </select>
                ))}
                {this.field('dur (s)', (
                  <input type="number" min="0" step="0.5" defaultValue={shot.dur ?? 4} key={shot.id + 'dur'}
                    onKeyDown={e => e.stopPropagation()}
                    onBlur={e => { const v = Number(e.target.value); if (v !== Number(shot.dur)) this.patch({ dur: v }, 'duration → ' + v + 's'); }}
                    style={input({ width: 64 })} />
                ))}
                {this.field('scene', (
                  <input type="number" min="0" step="1" defaultValue={shot.scene ?? ''} key={shot.id + 'sc'} placeholder="—"
                    onKeyDown={e => e.stopPropagation()}
                    onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (shot.scene ?? null)) this.patch({ scene: v }, 'scene → ' + (v ?? 'unassigned')); }}
                    style={input({ width: 64 })} />
                ))}
                <div style={sx('flex:1')} />
                <div style={sx('display:flex;gap:2px;align-items:center')}>
                  {[['takes', 'Takes' + (takes.length ? ' ' + takes.length : '')], ['log', 'Notes' + (log.length ? ' ' + log.length : '')]].map(([id, label]) => (
                    <span key={id} onClick={() => this.setState({ tab: tab === id ? null : id })} className={tab === id ? '' : 'hFg'}
                      style={{ ...sx('padding:4px 10px;border-radius:6px;cursor:pointer;font-size:10.5px;font-weight:600'), color: tab === id ? 'var(--fg)' : 'var(--fg-faint)', background: tab === id ? 'var(--raise)' : 'transparent', border: '1px solid ' + (tab === id ? 'var(--border-2)' : 'transparent') }}>{label}</span>
                  ))}
                  <span onClick={() => app.setState({ projTab: 'story', storyOpenShot: shot.id })} className="hFg" title="open the full editor"
                    style={sx('padding:4px 10px;border-radius:6px;cursor:pointer;font-size:10.5px;color:var(--fg-faint)')}>Story ↗</span>
                </div>
              </div>
            </div>

            <span onClick={onClose} className="hFg" title="Esc"
              style={sx('flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--fg-faint);font-size:13px')}>✕</span>
          </div>

          {err && <div style={{ ...sx('flex:none;padding:7px 12px;font-size:11px'), color: 'var(--danger)', background: 'rgba(240,91,84,.08)' }}>{err}</div>}

          {/* ── the expandable strip: takes run HORIZONTALLY, which is the shape a filmstrip wants
                and the thing a side rail could never give them ── */}
          {tab === 'takes' && (
            <div style={sx('flex:none;display:flex;gap:8px;overflow-x:auto;padding:10px 12px;border-bottom:1px solid var(--border)')}>
              {takes.length
                ? takes.slice().reverse().map(t => (
                  <div key={t.key} onClick={() => t.file && onPickTake && onPickTake(shot, t)}
                    title={t.hero ? 'the selected take' : 'click to select this take'}
                    style={{ ...sx('flex:none;border-radius:7px;overflow:hidden;cursor:pointer;background:var(--sunk);position:relative'), width: 150, aspectRatio: '16 / 9', border: '1.5px solid ' + (t.hero ? 'var(--accent)' : t.kept ? 'var(--ok)' : 'var(--border-2)') }}>
                    {t.file
                      ? <RenderMedia src={api.renderUrl(pid, t.file)} kind={t.video ? 'video' : 'image'} fit="cover" hoverPlay style={sx('width:100%;height:100%;display:block')} />
                      : <div style={sx('width:100%;height:100%;display:flex;align-items:center;justify-content:center')}>
                        <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--marked)', animation: 'dl-pulse 1.1s infinite' }}>{String(t.status || '').toUpperCase()}</span>
                      </div>}
                    {t.hero && <span style={{ ...sx('position:absolute;top:4px;left:4px;border-radius:3px;padding:1px 5px'), fontFamily: MONO, fontSize: 7.5, fontWeight: 800, color: 'var(--on-accent)', background: 'var(--accent)' }}>SELECTED</span>}
                  </div>
                ))
                : <span style={sx('font-size:11px;color:var(--fg-faint);padding:14px 2px')}>No takes yet — write a prompt below and hit Generate.</span>}
            </div>
          )}

          {tab === 'log' && (
            <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:10px 12px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px')}>
              <div style={sx('display:flex;gap:6px')}>
                <input value={this.state.note} placeholder="Add a note…"
                  onChange={e => this.setState({ note: e.target.value })}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.addNote(); }}
                  style={input({ flex: 1 })} />
                <Btn variant="secondary" size="sm" busy={busy === 'note'} onClick={() => this.addNote()}>Add</Btn>
              </div>
              {log.length
                ? log.map((e, i) => (
                  <div key={i} style={sx('display:flex;gap:10px;align-items:baseline;padding-bottom:6px;border-bottom:1px solid var(--line)')}>
                    <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)', flex: 'none', width: 84 }}>{e.when}</span>
                    <span style={sx('flex:1;font-size:11.5px;color:var(--fg-soft);line-height:1.5;word-break:break-word')}>{e.text}</span>
                  </div>
                ))
                : <div style={sx('font-size:11px;color:var(--fg-faint)')}>Nothing logged yet.</div>}
            </div>
          )}

          {/* ── THE composer, full width, exactly the bar it is everywhere else ── */}
          <div style={sx('flex:none;padding:10px 12px;display:flex;align-items:flex-end;gap:9px')}>
            <div style={sx('flex:1;min-width:0')}>
              <Composer
                app={app} pid={pid}
                value={this.genValue()}
                onChange={v => this.setState({ gen: v })}
                entities={entities}
                busy={busy === 'generate'}
                onSubmit={() => this.generate()}
                submitLabel="Generate"
                placeholder="What happens in this shot — @ for cast & locations"
                fragments={{ label: look ? 'look · ' + (look.name || 'set') : 'no look' }}
              />
            </div>
            <Btn variant="ghost" size="sm" busy={busy === 'reroll'} onClick={() => this.reroll()}
              style={{ flex: 'none', marginBottom: 2 }}
              title="run the last take's exact stored request again with a new seed — same model, same params, same refs">
              Re-roll
            </Btn>
          </div>
        </div>
      </ComposerDock>
    );
  }
}
