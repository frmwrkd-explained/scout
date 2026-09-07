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

export default function ScoutSettings({ onToast }) {
  const [theme, setTheme] = React.useState(getTheme());
  React.useEffect(() => onThemeChange(({ pref }) => setTheme(pref)), []);

  const [storageRoot, setStorageRoot] = React.useState('');
  const [rootDraft, setRootDraft] = React.useState('');
  const [rootBusy, setRootBusy] = React.useState(false);
  const [rootError, setRootError] = React.useState(null);

  const [autoRun, setAutoRun] = React.useState(false);
  const [autoRunBusy, setAutoRunBusy] = React.useState(false);

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
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const changeRoot = async () => {
    const p = rootDraft.trim();
    if (!p || p === storageRoot) return;
    setRootBusy(true); setRootError(null);
    try {
      const r = await api.setStorageRoot(p);
      setStorageRoot(r.storageRoot); setRootDraft(r.storageRoot);
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
