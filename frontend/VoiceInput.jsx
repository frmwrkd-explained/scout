// Voice Input — reusable mic button. Records via MediaRecorder, ships the blob to the existing
// Groq transcribe route (backend/index.mjs POST /api/groq/transcribe, express.raw + ?name= query —
// same contract frontend/api.js's `transcribe(file)` already uses), then hands text back via onText.
// No new deps: MediaRecorder + Web Audio AnalyserNode only.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';

const MAX_MS = 10 * 60 * 1000; // ~10min cap keeps webm/opus well under the 25MB Groq limit
const RED = 'var(--danger)';
const ACCENT = 'var(--accent)';

// preference order — filename extension must match the codec so Groq's format sniff works
const MIME_CANDIDATES = [
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/webm', 'webm'],
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/mp4', 'm4a']
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return { mime: '', ext: 'webm' };
  for (const [mime, ext] of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return { mime: '', ext: 'webm' }; // let the browser choose; still tagged .webm for Groq
}

// programmatically set a React-controlled input/textarea's value so onChange still fires —
// direct el.value = x is invisible to React's synthetic event system.
function insertAtCursor(el, text) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const pad = before && !/\s$/.test(before) ? ' ' : '';
  const next = before + pad + text + el.value.slice(end);
  setter.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const pos = start + pad.length + text.length;
  try { el.focus(); el.setSelectionRange(pos, pos); } catch { /* not a text field type that supports it */ }
}

export class VoiceInput extends React.Component {
  constructor(props) {
    super(props);
    this.state = { recording: false, busy: false, elapsed: 0, levels: [0, 0, 0, 0, 0] };
    this._targetEl = null;
  }

  componentDidMount() {
    if (this.props.global) {
      this._onToggle = () => this.toggle();
      window.addEventListener('scout:voice-toggle', this._onToggle);
    }
  }
  componentWillUnmount() {
    if (this._onToggle) window.removeEventListener('scout:voice-toggle', this._onToggle);
    this.teardown();
  }

  toggle() { if (this.state.recording) this.stop(); else this.start(); }

  async start() {
    const { app } = this.props;
    if (this.state.recording || this.state.busy || this.props.disabled) return;
    // remember what was focused *before* the mic UI steals focus — that's the field ⌘⇧V targets
    this._targetEl = this.props.global ? document.activeElement : null;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      app?.showToast?.(e.name === 'NotAllowedError'
        ? 'Microphone access denied — check System Settings → Privacy & Security → Microphone'
        : 'Could not access the microphone — ' + e.message, RED);
      return;
    }
    const { mime, ext } = pickMime();
    this._ext = ext;
    this._stream = stream;
    let rec;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      this.releaseStream();
      app?.showToast?.('Recording is not supported in this window — ' + e.message, RED);
      return;
    }
    this._chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) this._chunks.push(e.data); };
    rec.onstop = () => this.upload();
    this._rec = rec;
    rec.start();
    this.setupMeter(stream);
    this._startedAt = Date.now();
    this._timer = setInterval(() => {
      const elapsed = Date.now() - this._startedAt;
      if (elapsed >= MAX_MS) { app?.showToast?.('Hit the 10min recording cap — stopping', 'var(--warn)'); this.stop(); return; }
      this.setState({ elapsed });
    }, 250);
    this._onEsc = e => { if (e.key === 'Escape') this.stop(); };
    window.addEventListener('keydown', this._onEsc);
    this.setState({ recording: true, elapsed: 0 });
  }

  stop() {
    if (!this.state.recording) return;
    this.setState({ recording: false, busy: true });
    clearInterval(this._timer);
    if (this._onEsc) window.removeEventListener('keydown', this._onEsc);
    this.teardownMeter();
    try { this._rec && this._rec.state !== 'inactive' && this._rec.stop(); } catch { /* already stopped */ }
    this.releaseStream();
  }

  releaseStream() {
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
    this._stream = null;
  }

  teardown() {
    clearInterval(this._timer);
    if (this._onEsc) window.removeEventListener('keydown', this._onEsc);
    this.teardownMeter();
    try { this._rec && this._rec.state !== 'inactive' && this._rec.stop(); } catch { /* noop */ }
    this.releaseStream();
  }

  setupMeter(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      this._audioCtx = ctx;
      this._analyser = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const bars = 5;
      const bucket = Math.floor(data.length / bars);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const levels = Array.from({ length: bars }, (_, i) => {
          let sum = 0;
          for (let j = i * bucket; j < i * bucket + bucket; j++) sum += data[j];
          return Math.min(1, sum / bucket / 255 * 2.2);
        });
        this.setState({ levels });
        this._raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* meter is cosmetic — recording still works without it */ }
  }
  teardownMeter() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._audioCtx) this._audioCtx.close().catch(() => {});
    this._audioCtx = null; this._analyser = null;
    this.setState({ levels: [0, 0, 0, 0, 0] });
  }

  async upload() {
    const { app, onText } = this.props;
    const blob = new Blob(this._chunks, { type: this._rec?.mimeType || 'audio/webm' });
    this._chunks = [];
    if (!blob.size) { this.setState({ busy: false }); return; }
    const file = new File([blob], 'voice.' + this._ext, { type: blob.type });
    try {
      const r = await api.transcribe(file);
      const text = (r.text || '').trim();
      if (!text) { app?.showToast?.('Heard silence — try again closer to the mic', RED); return; }
      if (this._targetEl && (this._targetEl.tagName === 'TEXTAREA' || this._targetEl.tagName === 'INPUT')) insertAtCursor(this._targetEl, text);
      onText && onText(text, this._targetEl || null);
    } catch (e) {
      app?.showToast?.('Transcription failed — ' + (e.message || 'check your Groq key in Settings'), RED);
    } finally {
      this._targetEl = null;
      this.setState({ busy: false });
    }
  }

  render() {
    const { size = 30, disabled } = this.props;
    const S = this.state;
    const mm = String(Math.floor(S.elapsed / 60000)).padStart(2, '0');
    const ss = String(Math.floor((S.elapsed % 60000) / 1000)).padStart(2, '0');
    return (
      <div style={sx('display:inline-flex;align-items:center;gap:8px')}>
        <div
          onClick={() => !disabled && !S.busy && this.toggle()}
          title={S.recording ? 'Stop recording (Esc)' : S.busy ? 'Transcribing…' : 'Record voice — click to start'}
          style={{
            ...sx('display:inline-flex;align-items:center;justify-content:center;border-radius:99px;cursor:pointer;flex:none;transition:background .15s,border-color .15s'),
            width: size, height: size,
            background: S.recording ? RED : 'var(--raise)',
            border: '1px solid ' + (S.recording ? RED : 'var(--border-2)'),
            opacity: disabled ? 0.4 : 1,
            pointerEvents: disabled ? 'none' : 'auto',
            animation: S.recording ? 'dl-pulse 1.4s infinite' : 'none'
          }}>
          {S.busy
            ? <span style={{ ...sx('display:inline-block;border-radius:99px;width:12px;height:12px;border:2px solid var(--fg-faint)'), borderTopColor: ACCENT, animation: 'dl-spin .7s linear infinite' }} />
            : <span style={{ fontSize: size * 0.46, lineHeight: 1, filter: S.recording ? 'grayscale(1) brightness(3)' : 'none' }}>🎙</span>}
        </div>
        {S.recording && (
          <div style={sx('display:inline-flex;align-items:center;gap:7px')}>
            <span style={{ ...sx('color:var(--danger);font-size:11px;font-weight:700;letter-spacing:.02em'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{mm}:{ss}</span>
            <div style={sx('display:inline-flex;align-items:flex-end;gap:2px;height:12px')}>
              {S.levels.map((l, i) => (
                <span key={i} style={{ width: 3, height: Math.max(2, l * 12), background: RED, borderRadius: 1, transition: 'height .08s' }} />
              ))}
            </div>
          </div>
        )}
        {S.busy && <span style={{ ...sx('color:var(--fg-faint);font-size:11px'), fontFamily: MONO }}>transcribing…</span>}
        <style>{'@keyframes dl-spin{to{transform:rotate(360deg)}}'}</style>
      </div>
    );
  }
}

export default VoiceInput;
