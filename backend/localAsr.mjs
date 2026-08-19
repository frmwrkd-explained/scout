// Local (on-device) transcription — NVIDIA Parakeet TDT 0.6B via the `parakeet-mlx` CLI
// (Apple Silicon only; github.com/senstella/parakeet-mlx). No API key, no per-minute cost,
// but it's a real install step the user has to do themselves: `uv tool install parakeet-mlx`
// (also needs ffmpeg on PATH). Same shell-out pattern as jobs.mjs (runOnce/resolveBin) — the
// codebase's one established way to call a CLI, chosen over execa/etc for consistency.
//
// The CLI has no stdout mode — it always writes a file — so this writes the incoming audio
// buffer to a temp file, invokes the CLI with --output-dir pointed at the same temp dir, reads
// the resulting .txt back, and always cleans the temp dir up (success or failure).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runOnce, resolveBin } from './jobs.mjs';

const TIMEOUT_MS = 120_000; // 2 min — generous for a short dictation clip once the model is warm
const INSTALL_HINT = 'parakeet-mlx not found — install with: uv tool install parakeet-mlx (also requires ffmpeg on PATH)';

function extFromName(filename) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(filename || ''));
  return m ? m[1].toLowerCase() : 'm4a';
}

// (buf, filename, settings) -> Promise<string> — same shape as groq.mjs's transcribe(), so
// backend/index.mjs can call either interchangeably as a fallback pair.
export async function transcribeLocal(buf, filename, settings) {
  const cmd = (settings && settings.localTranscriberCommand) || 'parakeet-mlx';
  const bin = resolveBin(cmd);
  if (!bin) throw new Error(INSTALL_HINT);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frameforge-asr-'));
  const base = 'audio';
  const inFile = path.join(dir, base + '.' + extFromName(filename));
  try {
    fs.writeFileSync(inFile, buf);
    const r = await runOnce(bin, [inFile, '--output-format', 'txt', '--output-dir', dir], TIMEOUT_MS);
    if (r.enoent) throw new Error(INSTALL_HINT);
    if (r.code !== 0) {
      const detail = (r.err || r.out || '').trim().slice(0, 300);
      throw new Error('parakeet-mlx failed (exit ' + r.code + ')' + (detail ? ' — ' + detail : ''));
    }
    const outFile = path.join(dir, base + '.txt');
    if (!fs.existsSync(outFile)) throw new Error('parakeet-mlx ran but produced no transcript file');
    const text = fs.readFileSync(outFile, 'utf8').trim();
    if (!text) throw new Error('parakeet-mlx produced an empty transcript');
    return text;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
  }
}

// Cheap status probe for the Settings status row (and the /api/test/local-asr route): resolve
// the binary and confirm it actually runs, rather than just existing on disk.
export async function localAsrStatus(settings) {
  const cmd = (settings && settings.localTranscriberCommand) || 'parakeet-mlx';
  const bin = resolveBin(cmd);
  if (!bin) return { installed: false, command: cmd };
  const r = await runOnce(bin, ['--help'], 8_000);
  // ran at all (regardless of --help's own exit code) → the binary is real and executable
  // `!r.enoent` reported an unrunnable binary as installed:true — on Windows a .cmd fails with
  // EINVAL, not ENOENT, so the probe inverted its own answer. launchFailed covers every reason
  // the process never started.
  return { installed: !r.enoent && !r.launchFailed, command: cmd, path: bin };
}
