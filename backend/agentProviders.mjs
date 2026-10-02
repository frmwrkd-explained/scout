// Agent CLI provider registry — the single source of truth for "which agent CLIs can Scout
// drive, and what do you type at each one".
//
// Everything that shells out to an agent binary (jobs.mjs's setup wizard, agentRunner.mjs's chat
// executor, threed.mjs) resolves its argv through here rather than hardcoding flags, so adding a
// third CLI is one entry in PROVIDERS and nothing else.
//
// SUBSCRIPTION / ACCOUNT ONLY. Claude and Codex ship API-key login paths (`claude auth login
// --console`, `codex login --api-key`); Scout deliberately does not expose either. loginArgs
// always selects the subscription flow, and no code in this repo ever writes an agent API key.
// The same rule covers the newer entries: Gemini signs in with a Google account, Devin with a
// Devin account — a provider without an account login does not belong here.
//
// Each CLI exposes a FREE auth probe — `claude auth status --json`, `codex login status`,
// `devin auth status`, or (when no probe command exists) an `authProbe()` filesystem check like
// Gemini's `~/.gemini/oauth_creds.json` — which is why the setup wizard no longer needs to burn a
// paid round-trip prompt to know whether you are connected. promptArgs is still used for the real work.

// A provider descriptor:
//   id            stable key, also the settings.agentCommand value when the bin is on PATH
//   label         user-facing name
//   bin           default binary name (settings.agentCommand may override with a path)
//   npm           package installAgent() installs globally
//   runner        which agentRunner.mjs shape drives it ('claude' streams, others are one-shot)
//   versionArgs   argv that prints a version and exits 0
//   loginArgs     argv that starts the interactive SUBSCRIPTION sign-in
//   authStatusArgs argv for the free "am I signed in?" probe — null when the CLI has none
//   authProbe     async () => boolean — used INSTEAD of authStatusArgs (e.g. a creds-file check)
//   parseAuth     ({ code, out, err }) => { signedIn, detail }
//   promptArgs    (prompt, { allowedTools }) => argv for one non-interactive prompt
//   textOnly      separately verified Today invocation; normal assistant argv is independent
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROVIDERS = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    npm: '@anthropic-ai/claude-code',
    runner: 'claude',
    signInHint: 'Opens the Claude sign-in page in your browser. Use your Claude subscription account.',
    versionArgs: ['--version'],
    loginArgs: ['auth', 'login', '--claudeai'],
    authStatusArgs: ['auth', 'status', '--json'],
    // What the Settings dropdowns offer for THIS cli. Not a second model catalog —
    // frontend/modelCatalog.js is the catalog of GENERATION models (image/video/audio providers).
    // These are agent-CLI session flags, a different axis entirely, and they are provider-specific
    // (codex takes different names), so they belong on the provider descriptor.
    models: [
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
    ],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    sessionArgs: ({ model, effort } = {}) => [
      ...(model ? ['--model', String(model)] : []),
      ...(effort ? ['--effort', String(effort)] : [])
    ],
    parseAuth: ({ code, out }) => {
      let j = null;
      try { j = JSON.parse(String(out || '').trim()); } catch { /* not json — fall through */ }
      if (!j) return { signedIn: code === 0 && /logged ?in/i.test(out || ''), detail: '' };
      const plan = j.subscriptionType ? String(j.subscriptionType) : '';
      return {
        signedIn: !!j.loggedIn,
        detail: [j.email, plan && plan.toLowerCase() !== 'unknown' ? plan.toUpperCase() : '']
          .filter(Boolean).join(' · ')
      };
    },
    promptArgs: (prompt, { allowedTools = '' } = {}) =>
      ['--output-format', 'text', '--allowedTools', allowedTools, '-p', String(prompt ?? '')],
    // --allowedTools changes approvals, not availability. Today disables the built-in tools,
    // denies every tool (including MCP), and suppresses ambient context/customizations. Keep
    // auth in the normal home: --bare would require API-key auth on current Claude versions.
    // Administrator-managed policy is still enforced by Claude; this is not an OS sandbox.
    // https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/hooks
    textOnly: {
      available: true,
      requiredFlags: ['--safe-mode', '--tools', '--disallowedTools', '--strict-mcp-config',
        '--mcp-config', '--setting-sources', '--settings', '--disable-slash-commands',
        '--no-session-persistence', '--no-chrome'],
      promptArgs: prompt => [
        '--safe-mode', '--tools', '', '--disallowedTools', '*',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
        '--settings', '{"disableAllHooks":true,"disableClaudeAiConnectors":true}',
        '--disable-slash-commands', '--no-session-persistence', '--no-chrome',
        '--output-format', 'text', '-p', String(prompt ?? '')
      ],
    }
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    npm: '@openai/codex',
    runner: 'codex',
    signInHint: 'Opens the ChatGPT sign-in page in your browser. Use your ChatGPT Plus/Pro subscription.',
    versionArgs: ['--version'],
    loginArgs: ['login'],
    authStatusArgs: ['login', 'status'],
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-codex', label: 'GPT-5.6 Codex' }
    ],
    // codex has no --effort flag; reasoning effort is a config value it reads from config.toml,
    // so we set it with the -c override rather than inventing a flag that does not exist.
    efforts: ['low', 'medium', 'high'],
    sessionArgs: ({ model, effort } = {}) => [
      ...(model ? ['-m', String(model)] : []),
      ...(effort ? ['-c', 'model_reasoning_effort="' + String(effort) + '"'] : [])
    ],
    parseAuth: ({ code, out, err }) => {
      const all = String(out || '') + String(err || '');
      if (/not logged ?in|no (stored )?credential/i.test(all)) return { signedIn: false, detail: '' };
      // A broken ~/.codex/config.toml makes EVERY codex subcommand fail before it reads
      // credentials. Say so instead of reporting a bogus "not signed in".
      if (/error loading configuration/i.test(all)) {
        return { signedIn: false, detail: '', configError: all.split('\n').slice(0, 3).join(' ').trim() };
      }
      if (code !== 0) return { signedIn: false, detail: '' };
      const m = all.match(/logged in using ([^\n]+)/i);
      return { signedIn: /logged ?in/i.test(all), detail: m ? m[1].trim() : '' };
    },
    // `-p` is codex's --profile flag, NOT a prompt flag; non-interactive runs go through `exec`.
    // read-only sandbox + skip-git-repo-check keep it safe to run from the app's storage root.
    promptArgs: prompt =>
      ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', String(prompt ?? '')],
    textOnly: { available: false, reason: 'Read-only sandbox permits tools and ambient context; a prompt-only Codex invocation has not been verified.' }
  },
  {
    // The Today loop's light tier (backend/brain.mjs). `gemini` is a Google-account login, not a
    // subscription CLI — a bare `gemini` run opens the OAuth flow, so loginArgs stays empty and the
    // free "am I signed in?" probe is the creds file OAuth leaves behind.
    id: 'gemini',
    label: 'Gemini CLI',
    bin: 'gemini',
    npm: '@google/gemini-cli',
    runner: 'generic',
    signInHint: 'Run `gemini` in a terminal once and sign in with your Google account.',
    versionArgs: ['--version'],
    loginArgs: [],
    authStatusArgs: null,
    authProbe: () => {
      try { return fs.existsSync(path.join(os.homedir(), '.gemini', 'oauth_creds.json')); }
      catch { return false; }
    },
    parseAuth: () => ({ signedIn: false, detail: '' }),
    models: [],
    efforts: [],
    sessionArgs: ({ model } = {}) => (model ? ['-m', String(model)] : []),
    // Plan mode still permits reading/search tools; it is for normal assistants, not Today.
    promptArgs: prompt => ['-p', String(prompt ?? ''), '-o', 'text', '--approval-mode', 'plan'],
    textOnly: { available: false, reason: 'Gemini plan mode permits tools. Gemini 0.46 cannot suppress global GEMINI.md with context.fileName=[] while retaining existing OAuth without copying credentials.' }
  },
  {
    id: 'devin',
    label: 'Devin CLI',
    bin: 'devin',
    npm: '',
    runner: 'generic',
    signInHint: 'Run `devin auth login` and sign in with your Devin account.',
    versionArgs: ['--version'],
    loginArgs: ['auth', 'login'],
    authStatusArgs: ['auth', 'status'],
    parseAuth: ({ code, out, err }) => {
      const all = String(out || '') + String(err || '');
      if (/not logged in/i.test(all) || code !== 0) return { signedIn: false, detail: '' };
      return { signedIn: true, detail: '' };
    },
    models: [
      { id: 'swe', label: 'SWE (fast/cheap)' }
    ],
    efforts: [],
    sessionArgs: ({ model } = {}) => (model ? ['--model', String(model)] : []),
    // auto is an alias for normal permissions, not a tools-off mode.
    promptArgs: prompt => ['-p', String(prompt ?? ''), '--permission-mode', 'auto'],
    textOnly: { available: false, reason: 'Devin auto uses normal permissions; disabling every tool, MCP server, hook and ambient context has not been verified.' }
  }
];

export const DEFAULT_PROVIDER_ID = 'claude';

// Lowest-common-denominator descriptor for a CLI the user pointed `agentCommand` at that we have
// never heard of. No login/status story — it just has to accept `-p <prompt>`.
const GENERIC = {
  id: 'generic',
  label: 'Custom CLI',
  bin: '',
  npm: '',
  runner: 'generic',
  signInHint: 'Sign this CLI in yourself, however it expects.',
  versionArgs: ['--version'],
  loginArgs: null,
  authStatusArgs: null,
  parseAuth: () => ({ signedIn: false, detail: '' }),
  promptArgs: prompt => ['-p', String(prompt ?? '')],
  // An unknown CLI gets no model/effort flags — we cannot guess its surface, and guessing wrong
  // means every run dies on an unrecognised argument.
  models: [],
  efforts: [],
  sessionArgs: () => []
};

// The model/effort a run should use: explicit per-session override wins, else the global setting,
// else the provider's first listed model. Kept here so backend and UI agree on the fallback chain.
export function resolveSessionModel(provider, { model, effort } = {}) {
  const p = provider || providerFor('');
  const list = p.models || [];
  const wanted = model || null;
  const valid = wanted && list.some(m => m.id === wanted) ? wanted : (list[0]?.id || null);
  const eff = effort && (p.efforts || []).includes(effort) ? effort : null;
  return { model: valid, effort: eff };
}

export function providerById(id) {
  return PROVIDERS.find(p => p.id === id) || null;
}

// Classify an arbitrary `agentCommand` (a bare name or an absolute path) onto a descriptor by
// basename, so `/opt/homebrew/bin/codex` and a `/tmp/fixtures/stub-claude.mjs` test stub both land
// on the right one. Unknown commands get GENERIC rather than throwing.
export function providerFor(command) {
  const base = String(command || '').split('/').pop().toLowerCase();
  for (const p of PROVIDERS) if (base.includes(p.id)) return p;
  return { ...GENERIC, bin: String(command || '') };
}
