// Tools hub (F3.0) — launcher card grid. Each card is a real, working tool; nothing
// "coming soon" (anti-pattern 3/4 in the design law). More tools land in Phase 3.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import PromptBuilder from './PromptBuilder';
import { LookExtractor, ShotTypes, Transcriber, ModelCatalog } from './ToolsSuite';
import CameraMoves from './CameraMoves';
import FilmEmulation from './FilmEmulation';
import GridSplitter from './GridSplitter';
import LutApplier from './LutApplier';
import StyleLab from './StyleLab';
import ControlMaps from './ControlMaps';
import SheetComposer from './SheetComposer';
import Screenplay from './Screenplay';
import CallSheet from './CallSheet';
import { MONO } from './tokens';
// Lazy: ThreeDStage statically pulls in three + OrbitControls/TransformControls/GLTFLoader
// (~168 KB gzip). Loading it only when the 3D Stage card is opened keeps it out of the eager
// chunk — and means users who turned the module off never parse it at all.
const ThreeDStage = React.lazy(() => import('./ThreeDStage'));


const TOOLS = [
  {
    id: 'generate', name: 'Generate', icon: '⚡', accent: 'var(--accent)', flagship: true,
    line: 'Shots → FAL → real frames. References from boards & library ride along.',
    reads: 'shots · mood boards · library', writes: 'renders/ · generations/*.md · costs.md',
    key: 'G'
  },
  {
    id: 'stage3d', name: '3D Stage', icon: '◮', accent: 'var(--accent)', flagship: true,
    line: 'Block out scenes in real 3D, keyframe camera + objects, export the move as a video reference.',
    reads: 'stills (image→3D) · saved scenes', writes: 'threed/*.md · library/3d-renders · fal CDN refs',
    key: 'D'
  },
  {
    id: 'builder', name: 'Prompt Builder', icon: '◈', accent: 'var(--fg-muted)',
    line: '8-axis cinematic composer — formula assembly, zero AI drift.',
    reads: 'presets · axes · looks · shot types', writes: 'prompts/*.md · shot prompts',
    key: 'P'
  },
  {
    id: 'look', name: 'Look Extractor', icon: '✦', accent: 'var(--fg-muted)',
    line: 'Any reference still → a reusable two-tier LOOK: grade, light, lens feel.',
    reads: 'boards · library · canvas measurements', writes: 'looks/*.md · shot prompts',
    key: 'L'
  },
  {
    id: 'shottypes', name: 'Shot Types', icon: '▭', accent: 'var(--fg-muted)',
    line: '60 camera-grammar framings — single & multi subject, paste-ready fragments.',
    reads: 'frontend/shotTypes.js', writes: 'shot prompts · prompt builder framing',
    key: 'S'
  },
  {
    id: 'moves', name: 'Camera Moves', icon: '⟳', accent: 'var(--fg-muted)',
    line: 'Camera-motion grammar for video gen — pan, dolly, arc, boom, dolly-zoom.',
    reads: 'frontend/cameraMovements.js', writes: 'video prompts · prompt builder',
    key: 'C'
  },
  {
    id: 'grade', name: 'Film Emulation', icon: '▦', accent: 'var(--fg-muted)',
    line: '9 film stocks on canvas — grade any render in-browser, nothing uploaded.',
    reads: 'any image (local)', writes: 'graded .jpg downloads',
    key: 'F'
  },
  {
    id: 'gridsplit', name: 'Grid Splitter', icon: '⊞', accent: 'var(--fg-muted)',
    line: 'Cut AI contact sheets & turnarounds into single frames — auto-detects the grid, trims gutters, zips the keepers.',
    reads: 'any grid image (local)', writes: 'single-frame .jpg · frames .zip',
    key: 'X'
  },
  {
    id: 'lut', name: 'LUT Applier', icon: '◧', accent: 'var(--fg-muted)',
    line: '.cube LUTs, 6 procedural looks, and reference matching — derive a grade from any frame and export it as .cube.',
    reads: '.cube files · any image · reference frames', writes: 'graded .jpg · derived .cube',
    key: 'U'
  },
  {
    id: 'transcribe', name: 'Transcriber', icon: '🎙', accent: 'var(--ok)',
    line: 'Voice memo → editable transcript → a project note or straight into a story.',
    reads: 'audio/video files', writes: 'context notes · story.md',
    key: 'T'
  },
  {
    id: 'models', name: 'Model Catalog', icon: '≡', accent: 'var(--fg-muted)',
    line: 'Every FAL model in the stack, with prices — set the Generate defaults here.',
    reads: 'MODEL_CATALOG', writes: 'settings.md · modelDefaults',
    key: 'M'
  },
  {
    id: 'stylelocks', name: 'Styles', icon: '◈', accent: 'var(--accent)', flagship: true,
    line: 'Build a look on the axes, render it a preview frame, save it. Re-apply anywhere with s.',
    reads: 'styles/*.md · axis catalog · presets', writes: 'styles/*.md · applied to prompts',
    key: 'Y'
  },
  {
    id: 'control', name: 'Control Maps', icon: '◱', accent: 'var(--accent)', flagship: true,
    line: 'Any still → depth, edges, pose skeleton or cutout matte. Reuse exact geometry instead of re-rolling composition.',
    reads: 'boards · library · fal preprocessors', writes: 'library/control/ · .meta.md · fal CDN urls',
    key: 'K'
  },
  {
    id: 'sheets', name: 'Sheet Composer', icon: '⊟', accent: 'var(--fg-muted)',
    line: 'Axis × subject × layout — turnaround, location plate, contact sheet and model-sheet prompts in one pass.',
    reads: 'cinematicOptions · shotTypes · boards', writes: 'prompt text → builder · generate',
    key: 'A'
  },
  {
    id: 'screenplay', name: 'Screenplay', icon: '▤', accent: 'var(--fg-muted)',
    line: 'Fountain in, industry-standard 12pt Courier out — page count, scene count, runtime, scenes into story.md.',
    reads: 'fountain text (local) · story.md', writes: '.fountain downloads · story.md · print',
    key: 'W'
  },
  {
    id: 'callsheet', name: 'Call Sheet', icon: '▥', accent: 'var(--fg-muted)',
    line: 'Printable call sheet with a live page preview — pulls its scene rows straight from the shot list.',
    reads: 'current project · shots · local draft', writes: 'printed sheet · .json draft',
    key: 'H'
  }
];

export default class Tools extends React.Component {
  // Ticket 25 — the filmmaker's own tools, discovered from the workspace. Loaded once on mount
  // rather than folded into the 2s /api/state poll: a card appearing mid-scroll is the same jank
  // class as the modules-poll card-vanish, and this list only changes when the user acts.
  state = { userTools: [], loadingUser: true };
  componentDidMount() { this.loadUserTools(); }
  loadUserTools() {
    api.userTools()
      .then(r => this.setState({ userTools: (r && r.tools) || [], loadingUser: false }))
      .catch(() => this.setState({ loadingUser: false }));
  }
  toggleUserTool(t) {
    const { app } = this.props;
    const cur = (app.state.settings && app.state.settings.enabledChatTools) || {};
    const next = !t.enabled;
    // optimistic — the toggle is the whole interaction, so it must not wait on a round-trip
    this.setState(st => ({ userTools: st.userTools.map(x => x.id === t.id ? { ...x, enabled: next } : x) }));
    app.saveSettings({ enabledChatTools: { ...cur, [t.id]: next } });
  }
  deleteUserTool(t) {
    const { app } = this.props;
    api.deleteUserTool(t.id)
      .then(() => {
        this.setState(st => ({ userTools: st.userTools.filter(x => x.id !== t.id) }));
        app.setState({ toolsSel: null });
        app.showToast('“' + t.name + '” deleted', 'var(--fg-muted)');
      })
      .catch(e => app.showToast('Could not delete — ' + e.message, 'var(--danger)'));
  }

  render() {
    const { app } = this.props;
    const sel = app.state.toolsSel;
    // user tools are selected through the SAME toolsSel field (namespaced), so App.jsx's existing
    // Escape-clears-selection handler works on them for free
    if (String(sel || '').startsWith('user:')) return this.renderUserTool(String(sel).slice(5));
    if (sel === 'stage3d') return this.wrap('3D Stage', (
      <React.Suspense fallback={<div style={sx('padding:40px 28px;color:var(--fg-faint);font-size:12.5px')}>Loading the 3D engine…</div>}>
        <ThreeDStage app={app} />
      </React.Suspense>
    ));
    if (sel === 'builder') return this.wrap('Prompt Builder', <PromptBuilder app={app} key={app.state.pbShot ? app.state.pbShot.id : 'pb'} />);
    if (sel === 'look') return this.wrap('Look Extractor', <LookExtractor app={app} key={app.state.lookAsset ? app.state.lookAsset.name : 'look'} />);
    if (sel === 'shottypes') return this.wrap('Shot Types', <ShotTypes app={app} />);
    if (sel === 'moves') return this.wrap('Camera Moves', <CameraMoves app={app} />);
    if (sel === 'grade') return this.wrap('Film Emulation', <FilmEmulation app={app} />);
    if (sel === 'gridsplit') return this.wrap('Grid Splitter', <GridSplitter app={app} />);
    if (sel === 'lut') return this.wrap('LUT Applier', <LutApplier app={app} />);
    if (sel === 'transcribe') return this.wrap('Transcriber', <Transcriber app={app} />);
    if (sel === 'models') return this.wrap('Model Catalog', <ModelCatalog app={app} />);
    // Same component the composer opens as an overlay — a page mount just drops the modal chrome
    // and the Apply button (there is no composer here to apply to).
    if (sel === 'stylelocks') return this.wrap('Styles', <StyleLab app={app} page />);
    if (sel === 'control') return this.wrap('Control Maps', <ControlMaps app={app} />);
    if (sel === 'sheets') return this.wrap('Sheet Composer', <SheetComposer app={app} />);
    if (sel === 'screenplay') return this.wrap('Screenplay', <Screenplay app={app} />);
    if (sel === 'callsheet') return this.wrap('Call Sheet', <CallSheet app={app} />);
    // Phase 10C — the local-canvas film/utility tools are frozen; they move under a secondary "Labs"
    // section instead of sitting beside the core pipeline. Phase 10A — the Generate card redirects to
    // the canonical per-project composer (ProjectGenerate) rather than the retired Generate.jsx.
    const LABS = new Set(['moves', 'grade', 'gridsplit', 'lut']);
    // Cards whose id matches a disabled integration disappear entirely rather than showing a
    // dead card — same contract as disabledModels hiding models from the generation pickers.
    // Ids not present in the registry (grade, lut, …) are always shown.
    const mods = app.state.modules || {};
    const live = TOOLS.filter(t => !(t.id in mods) || mods[t.id]);
    const primary = live.filter(t => !LABS.has(t.id));
    const labs = live.filter(t => LABS.has(t.id));
    const cardClick = t => t.id === 'generate' ? app.jumpToGenerate() : app.setState({ toolsSel: t.id });
    const card = t => (
            <div key={t.id} onClick={() => cardClick(t)} className="hCard"
              style={{ ...sx('border-radius:12px;background:var(--surface);padding:18px;cursor:pointer;display:flex;flex-direction:column;gap:10px'), border: '1px solid ' + (t.flagship ? 'var(--accent-35)' : 'var(--border-2)') }}>
              <div style={sx('display:flex;align-items:center;gap:11px')}>
                {/* t.accent is a var() — string-concatenated alpha ('…55') is invalid CSS, so use tokens */}
                <span style={{ ...sx('width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex:none;background:var(--surface-2)'), border: '1px solid ' + (t.flagship ? 'var(--accent-35)' : 'var(--border-2)'), color: t.accent }}>{t.icon}</span>
                <span style={sx('font-size:14.5px;font-weight:800')}>{t.name}</span>
                {t.flagship && <span style={sx('font-size:9px;font-weight:800;letter-spacing:.08em;color:var(--fg-muted);border:1px solid var(--accent-35);border-radius:99px;padding:1.5px 8px')}>PIPELINE</span>}
                <span style={{ ...sx('margin-left:auto;font-size:10px;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:6px;padding:1px 6px;flex:none'), fontFamily: MONO }}>{t.key}</span>
              </div>
              <div style={sx('font-size:12px;color:var(--fg-muted);line-height:1.55')}>{t.line}</div>
              <div style={{ ...sx('display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line);padding-top:9px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>
                <span>reads&nbsp;&nbsp;{t.reads}</span>
                <span>writes&nbsp;{t.writes}</span>
              </div>
            </div>
    );
    // The builder needs the chat surface to run in — with Filmmaker Chat off there is nothing to
    // interview you, so the card disappears rather than opening a dead page.
    const canBuild = mods.chat !== false;
    const userTools = this.state.userTools;
    return (
      <div style={sx('padding:22px 28px 90px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Tools</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>the production toolbox — every card is live, everything writes portable markdown</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:20px')}>Generation is the pipeline flagship (opens the project composer); looks, shot types and prompt tools feed it.</div>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px')}>
          {canBuild && this.renderNewToolCard()}
          {primary.map(card)}
        </div>
        {userTools.length ? (
          <>
            <div style={sx('display:flex;align-items:baseline;gap:12px;margin:28px 0 12px')}>
              <div style={sx('font-weight:700;font-size:13px;color:var(--fg-muted)')}>Your tools</div>
              <span style={sx('font-size:11px;color:var(--fg-faint)')}>built by conversation — each one is off until you switch it on</span>
            </div>
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px')}>
              {userTools.map(t => this.renderUserCard(t))}
            </div>
          </>
        ) : null}
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin:28px 0 12px')}>
          <div style={sx('font-weight:700;font-size:13px;color:var(--fg-muted)')}>Labs</div>
          <span style={sx('font-size:11px;color:var(--fg-faint)')}>frozen local-canvas utilities — kept working, not part of the core loop</span>
        </div>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;opacity:.72')}>
          {labs.map(card)}
        </div>
      </div>
    );
  }
  // ── "+ New tool" ── the first cell of the grid, not a button above it: the first cell IS the top
  // of the library, and putting it inline keeps the grid rhythm instead of interrupting it. Dashed
  // border marks it as the one card that makes something rather than opening something.
  renderNewToolCard() {
    const { app } = this.props;
    return (
      <div key="__new" onClick={() => app.go('toolsmith')} className="hCard"
        style={{ ...sx('border-radius:12px;background:var(--surface);padding:18px;cursor:pointer;display:flex;flex-direction:column;gap:10px'), border: '1px dashed var(--accent-35)' }}>
        <div style={sx('display:flex;align-items:center;gap:11px')}>
          <span style={{ ...sx('width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:19px;flex:none;background:var(--surface-2)'), border: '1px solid var(--accent-35)', color: 'var(--accent)' }}>+</span>
          <span style={sx('font-size:14.5px;font-weight:800')}>New tool</span>
          <span style={sx('font-size:9px;font-weight:800;letter-spacing:.08em;color:var(--accent);border:1px solid var(--accent-35);border-radius:99px;padding:1.5px 8px')}>BUILD</span>
        </div>
        <div style={sx('font-size:12px;color:var(--fg-muted);line-height:1.55')}>Describe what you need. Claude interviews you and writes the tool.</div>
        <div style={{ ...sx('display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line);padding-top:9px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>
          <span>built&nbsp;&nbsp;by conversation</span>
          <span>saved&nbsp;tools/&lt;id&gt;/SKILL.md</span>
        </div>
      </div>
    );
  }

  // A user tool's card. Same geometry as the built-ins so the grid reads as one surface — the only
  // differences are the toggle where the keyboard chip sits, and dimming when off.
  renderUserCard(t) {
    const { app } = this.props;
    return (
      <div key={t.id} onClick={() => app.setState({ toolsSel: 'user:' + t.id })} className="hCard"
        style={{ ...sx('border-radius:12px;background:var(--surface);padding:18px;cursor:pointer;display:flex;flex-direction:column;gap:10px'), border: '1px solid var(--border-2)', opacity: t.enabled ? 1 : .72 }}>
        <div style={sx('display:flex;align-items:center;gap:11px')}>
          <span style={{ ...sx('width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none;background:var(--surface-2)'), border: '1px solid var(--border-2)', color: 'var(--fg-muted)' }}>◇</span>
          <span style={sx('font-size:14.5px;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{t.name}</span>
          <span onClick={e => { e.stopPropagation(); this.toggleUserTool(t); }} title={t.enabled ? 'Turn off' : 'Turn on'}
            style={{ ...sx('margin-left:auto;width:38px;height:21px;border-radius:99px;cursor:pointer;flex:none;position:relative;transition:background .15s'), background: t.enabled ? 'var(--accent)' : 'var(--border-2)' }}>
            <span style={{ ...sx('position:absolute;top:3px;width:15px;height:15px;border-radius:99px;background:var(--on-accent);transition:left .15s'), left: t.enabled ? 20 : 3 }} />
          </span>
        </div>
        <div style={sx('font-size:12px;color:var(--fg-muted);line-height:1.55')}>{t.capability}</div>
        <div style={{ ...sx('display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line);padding-top:9px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>
          <span>yours&nbsp;&nbsp;{t.enabled ? 'on · in the agent’s index' : 'off · invisible to the agent'}</span>
          <span>saved&nbsp;tools/{t.id}/SKILL.md</span>
        </div>
      </div>
    );
  }

  // Read-only detail. Editing a tool is delete-and-rebuild in v1 — the interview is fast, and a
  // real editor is a dirty-state model and a save-conflict story for a file the agent authored.
  renderUserTool(id) {
    const { app } = this.props;
    const t = this.state.userTools.find(x => x.id === id);
    // toolsSel survives navigation but this component's state does not, so returning to Tools with a
    // tool open re-renders BEFORE the fetch resolves. Without the loading guard that renders a false
    // "deleted" dead-end for the length of a round-trip.
    if (!t && this.state.loadingUser) return this.wrap('Tool', <div style={sx('padding:40px 28px;color:var(--fg-faint);font-size:12.5px')}>Loading…</div>);
    if (!t) return this.wrap('Tool', <div style={sx('padding:40px 28px;color:var(--fg-faint);font-size:12.5px')}>That tool is no longer in your workspace.</div>);
    return this.wrap(t.name, (
      <div style={sx('padding:22px 28px 90px;max-width:760px')}>
        <div style={sx('display:flex;align-items:center;gap:11px;margin-bottom:12px')}>
          <span style={{ ...sx('font-size:10px;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:6px;padding:2px 8px'), fontFamily: MONO }}>{t.id}</span>
          <span style={{ ...sx('font-size:10px;border-radius:99px;padding:2px 8px'), fontFamily: MONO, color: t.enabled ? 'var(--ok)' : 'var(--fg-faint)', border: '1px solid ' + (t.enabled ? 'rgba(63,207,142,.4)' : 'var(--border-2)') }}>
            {t.enabled ? 'enabled' : 'off'}
          </span>
          <span onClick={() => this.toggleUserTool(t)} className="hBd"
            style={sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer;border:1px solid var(--border-2);color:var(--fg-soft)')}>
            {t.enabled ? 'Turn off' : 'Turn on'}
          </span>
          <span onClick={() => this.deleteUserTool(t)} className="hBdRed"
            style={sx('margin-left:auto;font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer;border:1px solid var(--border-2);color:var(--danger)')}>Delete</span>
        </div>
        <div style={sx('font-size:12.5px;color:var(--fg-soft);line-height:1.6;margin-bottom:18px')}>{t.capability}</div>
        <div style={{ ...sx('color:var(--fg-faint);letter-spacing:.08em;text-transform:uppercase;margin-bottom:7px'), fontFamily: MONO, fontSize: 9 }}>instructions</div>
        <pre style={{ ...sx('margin:0;padding:14px 16px;background:var(--void);border:1px solid var(--line);border-radius:10px;overflow:auto;font-size:11.5px;line-height:1.7;color:var(--fg-soft);white-space:pre-wrap;word-break:break-word'), fontFamily: MONO }}>{t.instructions || '(empty)'}</pre>
        <div style={{ ...sx('color:var(--fg-faint);margin-top:12px'), fontFamily: MONO, fontSize: 9 }}>
          mounts as skills/tool-{t.id}/SKILL.md when enabled{t.updated ? ' · saved ' + t.updated : ''}
        </div>
      </div>
    ));
  }

  wrap(title, el) {
    const { app } = this.props;
    return (
      <div>
        <div style={sx('display:flex;align-items:center;gap:12px;padding:11px 28px;border-bottom:1px solid var(--line)')}>
          <span onClick={() => app.setState({ toolsSel: null, genShot: null, pbShot: null, lookAsset: null, pbInsert: null, genModel: null, genPrompt: null })} className="hFgL" style={sx('font-size:12px;color:var(--fg-faint);cursor:pointer')}>← Tools</span>
          <span style={sx('font-size:12px;font-weight:700')}>{title}</span>
        </div>
        {el}
      </div>
    );
  }
}
