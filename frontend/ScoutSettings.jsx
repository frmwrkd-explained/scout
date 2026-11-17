// frontend/ScoutSettings.jsx — the settings screen, item 12.
//
// Small on purpose: theme (the only thing that had a control before this — ⌥⌘L with no visible
// affordance), the storage root with Reveal, the transcription key VoiceInput needs, and a
// keyboard cheat sheet of the app's REAL keys. NOT frontend/Settings.jsx — that is FrameForge's
// (model catalog, agent providers, Remotion paths, feedback capture…) and is deleted (item D)
// after this screen takes the two controls worth keeping: the theme radio and the key input.
//
// It also carries `autoRun`, which came across when frontend/Settings.jsx was deleted. That is
// not cosmetic: `backend/dispatch.mjs` reads the flag to decide whether a schedule actually sends
// an assistant out, so without a control here the app would read a setting nobody could reach —
// a capability with no affordance, which is the failure HANDOVER §3 names.
//
// Props
//   onToast(message)   optional. Confirms a save the way every other screen in the app does.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Card, Chip, Eyebrow, Field, Input } from './ui';
import { THEMES, getTheme, applyTheme, onThemeChange } from './theme';
import { KEYS } from './keymap';
import { IntegrationSettings } from './Integrations';
import Connectors from './Connectors';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });
const THEME_LABEL = { system: 'System', dark: 'Dark', light: 'Light' };

function Section({ eyebrow, title, body, children }) {
  return (
    <section style={sx('display:flex;flex-direction:column;gap:14px;max-width:560px')}>
      <div style={sx('display:flex;flex-direction:column;gap:6px')}>
        <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{eyebrow}</Eyebrow>
        <h2 style={sx('margin:0;font-size:15.5px;font-weight:500;color:var(--fg)')}>{title}</h2>
        {body ? <p style={sx('margin:0;font-size:12.5px;line-height:1.6;color:var(--fg-muted)')}>{body}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function ScoutSettings({ onToast, onRootChanged }) {
  const [theme, setTheme] = React.useState(getTheme());
  React.useEffect(() => onThemeChange(({ pref }) => setTheme(pref)), []);

  const [storageRoot, setStorageRoot] = React.useState('');
  const [rootDraft, setRootDraft] = React.useState('');
  const [rootBusy, setRootBusy] = React.useState(false);
  const [rootError, setRootError] = React.useState(null);

  const [autoRun, setAutoRun] = React.useState(false);
  const [autoRunBusy, setAutoRunBusy] = React.useState(false);

  // Today loop — the day bounds and the cheap-agent bench (docs/09_TODAY_LOOP.md).
  const [dayStart, setDayStart] = React.useState('08:30');
  const [dayEnd, setDayEnd] = React.useState('17:30');
  const [dayMinutes, setDayMinutes] = React.useState(360);
  const [lightLimit, setLightLimit] = React.useState(40);
  const [heavyLimit, setHeavyLimit] = React.useState(4);
  const [heavy, setHeavy] = React.useState(false);
  const [todayBusy, setTodayBusy] = React.useState(false);
  const [providers, setProviders] = React.useState(null);

  const [hasKey, setHasKey] = React.useState(false);
  const [keyDraft, setKeyDraft] = React.useState('');
  const [keyBusy, setKeyBusy] = React.useState(false);
  const [keyError, setKeyError] = React.useState(null);

  // GET /api/state is the one read that already carries both: `storageRoot` and
  // `settings.groqApiKey`, redacted to a fixed string when set (backend/store.mjs
  // `publicSettings`) — its PRESENCE is the signal this screen needs, never its value.
  React.useEffect(() => {
    let alive = true;
    api.state().then(s => {
      if (!alive) return;
      setStorageRoot(s.storageRoot || '');
      setRootDraft(s.storageRoot || '');
      setHasKey(!!(s.settings && s.settings.groqApiKey));
      setAutoRun(!!(s.settings && s.settings.autoRun));
      if (s.settings) {
        if (s.settings.dayStart) setDayStart(String(s.settings.dayStart));
        if (s.settings.dayEnd) setDayEnd(String(s.settings.dayEnd));
        if (Number.isFinite(Number(s.settings.dayMinutes))) setDayMinutes(Number(s.settings.dayMinutes));
        if (Number.isFinite(Number(s.settings.brainDailyLimits?.light))) setLightLimit(Number(s.settings.brainDailyLimits.light));
        if (Number.isFinite(Number(s.settings.brainDailyLimits?.heavy))) setHeavyLimit(Number(s.settings.brainDailyLimits.heavy));
        setHeavy(!!s.settings.allowHeavyFallback);
      }
    }).catch(() => {});
    api.agentProviders().then(r => { if (alive) setProviders(r.providers || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const changeRoot = async () => {
    const p = rootDraft.trim();
    if (!p || p === storageRoot) return;
    setRootBusy(true); setRootError(null);
    try {
      const r = await api.setStorageRoot(p);
      setStorageRoot(r.storageRoot); setRootDraft(r.storageRoot);
      onRootChanged?.(r.storageRoot);
      onToast && onToast('Storage root changed. Reopen anything you had open — it was reading the old one.');
    } catch (e) { setRootError(e.message); } finally { setRootBusy(false); }
  };

  const reveal = async () => {
    try { await api.revealPath(''); onToast && onToast('Opened the workspace folder.'); }
    catch (e) { onToast && onToast('Could not reveal it — ' + e.message, 'danger'); }
  };

  // Optimistic would be wrong here. This flag decides whether the app spends the person's money
  // unattended, so the chip does not move until the server has said it saved.
  const changeAutoRun = async next => {
    if (next === autoRun || autoRunBusy) return;
    setAutoRunBusy(true);
    try {
      await api.saveSettings({ autoRun: next });
      setAutoRun(next);
      onToast && onToast(next
        ? 'Assistants will go out on their own schedule. That spawns your agent CLI unattended, and it costs money.'
        : 'Schedules are a note on the card again. Assistants go out when you press Send them out.');
    } catch (e) { onToast && onToast(e.message, 'danger'); } finally { setAutoRunBusy(false); }
  };

  const saveToday = async patch => {
    if (todayBusy) return;
    setTodayBusy(true);
    try { await api.saveSettings(patch); } catch (e) { onToast && onToast(e.message, 'danger'); }
    finally { setTodayBusy(false); }
  };
  const changeHeavy = async next => {
    if (next === heavy) return;
    setHeavy(next);
    try {
      await api.saveSettings({ allowHeavyFallback: next });
      onToast && onToast(next
        ? 'Light tasks may use Claude/Codex when Gemini and Devin are both out — that spends the subscription plans.'
        : 'Light tasks stick to Gemini and Devin; the Max plans stay reserved for heavy work.');
    } catch (e) { setHeavy(!next); onToast && onToast(e.message, 'danger'); }
  };

  const saveKey = async () => {
    const v = keyDraft.trim();
    if (!v) return;
    setKeyBusy(true); setKeyError(null);
    try {
      await api.saveSettings({ groqApiKey: v });
      setHasKey(true); setKeyDraft('');
      onToast && onToast('Transcription key saved. Voice input works everywhere it appears.');
    } catch (e) { setKeyError(e.message); } finally { setKeyBusy(false); }
  };
  const clearKey = async () => {
    setKeyBusy(true); setKeyError(null);
    try {
      await api.saveSettings({ groqApiKey: '' });
      setHasKey(false); setKeyDraft('');
      onToast && onToast('Transcription key removed. Voice input disables itself until you add another.');
    } catch (e) { setKeyError(e.message); } finally { setKeyBusy(false); }
  };

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow-y:auto')}>
      <header style={sx('flex:none;padding:20px 24px 18px;border-bottom:1px solid var(--line)')}>
        <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>SETTINGS</Eyebrow>
        <h1 style={sx('margin:8px 0 0;font-size:22px;font-weight:500;color:var(--fg)')}>How Scout runs on this machine</h1>
      </header>

      <div style={sx('flex:1;padding:26px 24px 60px;display:flex;flex-direction:column;gap:34px')}>

        <Section eyebrow="APPEARANCE" title="Theme"
          body="Follows the OS by default. ⌥⌘L also toggles it, anywhere in the app.">
          <div style={sx('display:flex;gap:8px')}>
            {THEMES.map(t => (
              <Chip key={t} label={THEME_LABEL[t]} on={theme === t}
                onClick={() => { applyTheme(t); setTheme(t); }} />
            ))}
          </div>
        </Section>

        <Section eyebrow="LAW 8" title="Where your workspace lives"
          body="Every file the app reads and writes is under this folder — plain markdown, open it in anything.">
          <Field label="STORAGE ROOT">
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
              <Input value={rootDraft} onChange={e => setRootDraft(e.target.value)}
                placeholder={storageRoot || '/path/to/workspace'}
                style={sx('flex:1;min-width:260px')} />
              <Btn size="sm" variant="secondary" busy={rootBusy} disabled={!rootDraft.trim() || rootDraft.trim() === storageRoot} onClick={changeRoot}>Change</Btn>
              <Btn size="sm" variant="primary" onClick={reveal}>Reveal</Btn>
            </div>
          </Field>
          {rootError ? <span style={{ ...mono('font-size:10.5px;font-weight:600'), color: 'var(--danger)' }}>{rootError}</span> : null}
        </Section>

        <Section eyebrow="ASSISTANTS" title="Sending them out on a schedule"
          body="Off by default. Every assistant carries a schedule — all day, every morning, once a week — and with this off it is a note on its card rather than something that happens: they go out when you press Send them out. Turning it on spawns your agent CLI unattended, which costs money.">
          <div style={sx('display:flex;gap:8px')}>
            <Chip label="Off" on={!autoRun} onClick={() => changeAutoRun(false)} />
            <Chip label="On" on={autoRun} onClick={() => changeAutoRun(true)} />
          </div>
        </Section>

        <Section eyebrow="TODAY" title="The day loop"
          body="GPT-6 Luna backs up Gemini and Devin using your Codex subscription. It uses the light call budget. Set the day, planned time and daily model-call budgets; failed attempts count too. Heavy fallback is an explicit choice.">
          <div style={sx('display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end')}>
            <Field label="DAY STARTS">
              <Input value={dayStart} type="time" style={mono('font-size:12px;width:110px')}
                onChange={e => setDayStart(e.target.value)}
                onBlur={() => saveToday({ dayStart })} />
            </Field>
            <Field label="DAY ENDS">
              <Input value={dayEnd} type="time" style={mono('font-size:12px;width:110px')}
                onChange={e => setDayEnd(e.target.value)}
                onBlur={() => saveToday({ dayEnd })} />
            </Field>
            <Field label="PLANNED MINUTES CAP">
              <Input value={dayMinutes} type="number" min="30" step="30" style={mono('font-size:12px;width:90px')}
                onChange={e => setDayMinutes(e.target.value)}
                onBlur={() => saveToday({ dayMinutes: Number(dayMinutes) || 360 })} />
            </Field>
            <Field label="LIGHT CALLS / DAY">
              <Input aria-label="Light calls per day" value={lightLimit} type="number" min="0" max="1000" style={mono('font-size:12px;width:90px')}
                onChange={e => setLightLimit(e.target.value)}
                onBlur={() => saveToday({ brainDailyLimits: { light: Number(lightLimit), heavy: Number(heavyLimit) } })} />
            </Field>
            <Field label="HEAVY CALLS / DAY">
              <Input aria-label="Heavy calls per day" value={heavyLimit} type="number" min="0" max="1000" style={mono('font-size:12px;width:90px')}
                onChange={e => setHeavyLimit(e.target.value)}
                onBlur={() => saveToday({ brainDailyLimits: { light: Number(lightLimit), heavy: Number(heavyLimit) } })} />
            </Field>
          </div>
          <div style={sx('display:flex;gap:8px;align-items:center')}>
            <Chip label="Heavy fallback off" on={!heavy} onClick={() => changeHeavy(false)} />
            <Chip label="Heavy fallback on" on={heavy} onClick={() => changeHeavy(true)} />
            <span style={sx('font-size:11px;color:var(--fg-faint)')}>{todayBusy ? 'saving…' : ''}</span>
          </div>
          <Card style={sx('padding:4px 0;background:var(--surface-2);border-color:var(--border)')}>
            {(providers === null ? [{ id: 'gemini' }, { id: 'devin' }, { id: 'gpt', label: 'GPT-6 Luna' }, { id: 'claude' }, { id: 'codex' }] : providers)
              .filter(p => ['gemini', 'devin', 'gpt', 'claude', 'codex'].includes(p.id))
              .map((p, i) => (
                <div key={p.id} style={{ ...sx('display:flex;align-items:center;gap:10px;padding:7px 14px'), borderTop: i ? '1px solid var(--line)' : 'none' }}>
                  <span style={{ ...sx('flex:none;width:7px;height:7px;border-radius:9999px'), background: !p.installed ? 'var(--border-3)' : p.signedIn ? 'var(--ok)' : 'var(--warn)' }} />
                  <span style={{ ...mono('flex:1;font-size:11px;font-weight:600;color:var(--fg-soft)') }}>{p.label || p.id}</span>
                  <span style={{ ...mono('flex:none;font-size:9.5px;letter-spacing:.08em'), color: !p.installed ? 'var(--fg-faint)' : p.signedIn ? 'var(--ok)' : 'var(--warn)' }}>
                    {p.installed === undefined ? '…' : !p.installed ? 'NOT INSTALLED' : p.signedIn ? 'SIGNED IN' : 'NOT SIGNED IN'}
                  </span>
                </div>
              ))}
          </Card>
        </Section>

        {/* Which outside agents may work in this workspace, and which assistants Scout itself drives
            (Connectors.jsx). Above Integrations: it is the first thing somebody setting up an agent looks for. */}
        <Connectors onToast={onToast} />

        <IntegrationSettings onToast={onToast} />

        <Section eyebrow="VOICE" title="Transcription key"
          body="Groq speech-to-text — every microphone button in the app (the first-run interview, and anywhere else VoiceInput appears) goes through this one key. No key, no mic: the button disables itself with a reason rather than recording into a failure.">
          <Field label={hasKey ? 'A KEY IS CONFIGURED' : 'NO KEY CONFIGURED'}>
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
              <Input type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
                placeholder={hasKey ? '•••••••• — paste a new one to replace it' : 'paste your Groq API key'}
                style={sx('flex:1;min-width:260px')} />
              <Btn size="sm" variant="primary" busy={keyBusy} disabled={!keyDraft.trim()} onClick={saveKey}>Save</Btn>
              {hasKey ? <Btn size="sm" variant="ghost" disabled={keyBusy} onClick={clearKey}>Remove</Btn> : null}
            </div>
          </Field>
          {keyError ? <span style={{ ...mono('font-size:10.5px;font-weight:600'), color: 'var(--danger)' }}>{keyError}</span> : null}
        </Section>

        <Section eyebrow="?" title="Keyboard">
          <Card style={sx('padding:6px 0;background:var(--surface-2);border-color:var(--border)')}>
            {KEYS.map((k, i) => (
              <div key={i} style={{ ...sx('display:flex;align-items:center;gap:12px;padding:7px 16px'), borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <span style={{ ...mono('flex:none;min-width:52px;font-size:10.5px;font-weight:700;border-radius:5px;padding:2px 7px;text-align:center'), color: 'var(--fg-soft)', background: 'var(--sunk)', border: '1px solid var(--border-2)' }}>{k.key}</span>
                <span style={sx('flex:1;min-width:0;font-size:12px;color:var(--fg-soft)')}>{k.label}</span>
                <span style={{ ...mono('flex:none;font-size:9px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>{k.ctx.toUpperCase()}</span>
              </div>
            ))}
          </Card>
        </Section>
      </div>
    </div>
  );
}
