// Redaction — the gate every byte of a bug report passes through before it leaves the machine.
//
// Imported by backend/feedback.mjs (the only egress point) and by the review step of the
// feedback panel, which renders exactly what this produced. It is deliberately PURE: no
// store.mjs import, no fs, no env reads, no Date, no Math.random. The caller passes the exact
// secrets to kill; this module never goes looking for them. That keeps it testable without a
// datastore and keeps the same output for the same input, which the dedupe signature depends on.
//
// The rules are ORDERED and the order is load-bearing:
//   exact secrets first  — a real key may contain characters a later rule would rewrite, and a
//                          half-rewritten key is a key.
//   shapes next          — keys we did not know about.
//   paths last           — rewriting /Users/<name> earlier would corrupt an in-flight match.
//
// Bias: over-redact. An elided string costs one follow-up question. A leaked one cannot be undone.

import { createHash } from 'node:crypto';

// ── helpers ─────────────────────────────────────────────────────────────────────────────────

// Escape a literal for use inside a RegExp. Secrets are arbitrary strings and one containing a
// '+' or '/' (base64 does) would otherwise compile into a different pattern than intended.
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const bytes = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

// Shapes that are long and high-entropy but carry nothing secret. The entropy sweep (rule 7) is
// the bluntest rule in the file, so it needs an explicit list of things it must not eat — a git
// sha in a stack trace and a uuid in a route are both load-bearing evidence.
const SAFE_SHAPES = [
  /^[0-9a-f]{7}$|^[0-9a-f]{40}$/i,                                          // git sha (short + full)
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,        // uuid
  /^(?:sha1|sha256|sha512|md5):[0-9a-f]{16,}$/i,                            // our signature, and any digest
];

// ── the rules ───────────────────────────────────────────────────────────────────────────────
//
// Each rule is { name, apply(str, ctx) -> str }, and reports a hit by calling ctx.hit(name).
// Exported so the test enumerates the real table rather than restating it — a rule added here
// without a test case is a test failure, which is the point.

export const RULES = [
  {
    // 1 ── Exact known secrets. The strongest rule in the file precisely because it makes no
    // guess about key format: it catches a provider that changes its key shape tomorrow, and it
    // catches the user's own key appearing somewhere no pattern would look (a filename, a prompt).
    name: 'exact-secret',
    apply(s, ctx) {
      for (const secret of ctx.secrets) {
        // Short values are not secrets, they are words. A 6-character "key" left in settings
        // would otherwise redact half the English in the report.
        if (!secret || secret.length < 8) continue;
        const re = new RegExp(esc(secret), 'g');
        s = s.replace(re, () => { ctx.hit('exact-secret'); return '<redacted:key>'; });
      }
      return s;
    }
  },
  {
    // 2 ── Key shapes. For keys that are not the user's own: a third-party token in a log line,
    // someone else's key pasted into a prompt, an Authorization header echoed by an error.
    name: 'key-shape',
    apply(s, ctx) {
      const pats = [
        /\bsk-ant-[A-Za-z0-9_-]{16,}/g,                    // Anthropic
        /\bgsk_[A-Za-z0-9]{20,}/g,                         // Groq
        /\bsk-[A-Za-z0-9]{20,}/g,                          // OpenAI-shaped
        /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                   // GitHub PAT
        /\bAKIA[0-9A-Z]{16}\b/g,                           // AWS access key id
        /\bfal_[A-Za-z0-9_-]{16,}/g,                       // FAL, current form
        // FAL's other form is <uuid>:<hex32>. The uuid half alone is safe (rule 7 exempts it);
        // the pair is a credential, so match the pair and nothing else.
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/gi,
        /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,   // JWT
        // Header forms. Capture the scheme so the line still reads as an auth header — that it
        // WAS an Authorization header is evidence; the token is not.
        /\b(Bearer|Key|Token)\s+[A-Za-z0-9._\-:]{16,}/gi,
      ];
      for (const re of pats) {
        s = s.replace(re, m => {
          ctx.hit('key-shape');
          const scheme = /^(Bearer|Key|Token)\s/i.exec(m);
          return scheme ? scheme[1] + ' <redacted:key>' : '<redacted:key>';
        });
      }
      return s;
    }
  },
  {
    // 3 ── Signed URLs. A signed provider URL is a bearer credential for the user's own media —
    // no less sensitive than a key, and far easier to overlook because it looks like a link.
    // Origin and path survive (that is the evidence: WHICH file, from WHICH host, failed).
    name: 'signed-url',
    apply(s, ctx) {
      return s.replace(/https?:\/\/[^\s"'<>()\]]+/g, url => {
        const q = url.indexOf('?');
        if (q < 0) return url;
        const query = url.slice(q + 1);
        if (!/(^|&)(X-Amz-[A-Za-z-]+|Signature|signature|sig|token|access_token|key|Policy|Expires|se|sp|sv|st|sr)=/.test(query)) return url;
        ctx.hit('signed-url');
        return url.slice(0, q) + '?<redacted:signed>';
      });
    }
  },
  {
    // 4 ── Base64 blobs. Not optional: styleLockPreview returns a dataUrl, so these WILL be in
    // the console ring, and one of them can be several megabytes. Keep the mime and the size —
    // "a 2 MB PNG came back" is the evidence; the pixels are not.
    name: 'data-url',
    apply(s, ctx) {
      return s.replace(/data:([\w.+-]+\/[\w.+-]+)?;base64,[A-Za-z0-9+/=]{256,}/g, (m, mime) => {
        ctx.hit('data-url');
        // 4 base64 chars ≈ 3 bytes; close enough to report, and it costs nothing to be honest
        // that it is an estimate rather than pretending to a decoded length.
        const b64 = m.slice(m.indexOf('base64,') + 7);
        return `data:${mime || 'application/octet-stream'};base64,<${bytes(Math.floor(b64.length * 3 / 4))} elided>`;
      });
    }
  },
  {
    // 5 ── Home directory. Removes the tester's real name from every stack trace, every log line
    // and every path at once — the most common piece of personal data in this app's output, and
    // the one nobody thinks of as personal data.
    name: 'home-path',
    apply(s, ctx) {
      let out = s.replace(/(^|[\s"'(:=[])\/(?:Users|home)\/[^/\s"')\]:]+/g, (m, pre) => { ctx.hit('home-path'); return pre + '~'; });
      out = out.replace(/([A-Za-z]:)?\\Users\\[^\\\s"')\]]+/g, () => { ctx.hit('home-path'); return '~'; });
      return out;
    }
  },
  {
    // 6 ── Third-party emails. The reporter's own address rides in its own envelope field and is
    // never seen by this module, so anything matching here belongs to someone who did not consent.
    name: 'email',
    apply(s, ctx) {
      return s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => { ctx.hit('email'); return '<email>'; });
    }
  },
  {
    // 7 ── Entropy sweep. Belt and braces for the credential shape nobody has thought of. It
    // over-redacts occasionally and that is the correct trade — see the header.
    name: 'high-entropy',
    apply(s, ctx) {
      // The digest prefix is part of the match, not context: ':' is a word boundary, so matching
      // the bare hex would hand SAFE_SHAPES a 64-char blob with no way to tell a signature from a
      // secret. Alternation order matters — the prefixed form must win.
      return s.replace(/\b(?:sha1|sha256|sha512|md5):[0-9a-f]{16,}\b|\b[A-Za-z0-9_-]{32,}\b/gi, m => {
        if (SAFE_SHAPES.some(re => re.test(m))) return m;
        // Words are not secrets. Real tokens mix cases/digits; a 32-char lowercase run is far
        // more likely to be an identifier, a css class or a long German noun than a credential.
        const classes = (/[a-z]/.test(m) ? 1 : 0) + (/[A-Z]/.test(m) ? 1 : 0) + (/[0-9]/.test(m) ? 1 : 0) + (/[_-]/.test(m) ? 1 : 0);
        const isHex = /^[0-9a-f]+$/i.test(m);
        if (!isHex && classes < 3) return m;
        ctx.hit('high-entropy');
        return '<redacted:high-entropy>';
      });
    }
  },
];

// ── the walk ────────────────────────────────────────────────────────────────────────────────

const MAX_STRING = 200_000; // a single string longer than this is a payload, not a message
const HARD_CAP = 4_000_000; // absurd input: cut before the rules so seven regex passes stay cheap

function redactString(s, ctx) {
  if (s.length > HARD_CAP) {
    ctx.hit('oversize');
    s = s.slice(0, HARD_CAP);
  }
  // Rules run BEFORE the length cap, not after. The single biggest string this app produces is a
  // multi-megabyte dataUrl from styleLockPreview, and truncating it first would leave a truncation
  // marker glued to an elision marker — a payload we no longer send, described twice.
  for (const rule of RULES) s = rule.apply(s, ctx);
  if (s.length > MAX_STRING) {
    ctx.hit('oversize');
    s = s.slice(0, MAX_STRING) + `\n<${bytes(s.length - MAX_STRING)} truncated>`;
  }
  return s;
}

/**
 * Walk any JSON-serialisable value applying every rule to every string — values AND object keys.
 * Keys matter: a settings dump keyed by an id, or an object whose key is a path, leaks exactly as
 * readily as a value, and every redactor that has ever missed something missed it in a key.
 *
 * @param {*} value            anything JSON-serialisable
 * @param {{secrets?: string[]}} opts  exact values to kill (rule 1)
 * @returns {{ value: *, hits: Record<string, number> }}
 */
export function redact(value, opts = {}) {
  const hits = Object.create(null);
  const ctx = {
    secrets: (opts.secrets || []).filter(Boolean),
    hit(rule) { hits[rule] = (hits[rule] || 0) + 1; }
  };
  const seen = new WeakSet(); // a cycle in a captured object must not hang the send

  const walk = (v, depth) => {
    if (v == null) return v;
    if (depth > 24) return '<redacted:too-deep>';
    const t = typeof v;
    if (t === 'string') return redactString(v, ctx);
    if (t === 'number' || t === 'boolean') return v;
    // Functions, symbols and bigints do not survive JSON anyway; dropping them here means the
    // envelope we redact is the envelope we send, with no surprise re-shaping at stringify time.
    if (t !== 'object') return undefined;
    if (seen.has(v)) return '<redacted:cycle>';
    seen.add(v);
    if (Array.isArray(v)) return v.map(x => walk(x, depth + 1));
    const out = {};
    for (const [k, val] of Object.entries(v)) out[redactString(k, ctx)] = walk(val, depth + 1);
    return out;
  };

  return { value: walk(value, 0), hits };
}

// ── dedupe signature ────────────────────────────────────────────────────────────────────────

// Strip everything that varies between two runs of the SAME bug: ids, digits, hex, paths, quoted
// fragments. What survives is the shape of the failure, which is what "is this the same bug"
// actually means. Twenty testers hitting one crash must produce one issue, not twenty.
function normalise(s) {
  return String(s || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '·')
    .replace(/\b[0-9a-f]{16,}\b/gi, '·')
    .replace(/(['"`])(?:[^'"`\\]|\\.)*\1/g, '·')
    // Paths before digits, and the :line:col suffix is part of the path. Line numbers move with
    // every edit; a signature that changed when a file grew by one line would never match twice.
    .replace(/[~/][\w./-]+(?::\d+)*/g, '·')
    .replace(/\d+/g, '·')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

/**
 * The dedupe key. Deterministic, free, and computed BEFORE any model call — the AI is never asked
 * to answer a question that has an exact answer.
 * @param {{frame?: string, message?: string, route?: string, version?: string}} parts
 */
export function signature(parts = {}) {
  const basis = [
    normalise(parts.frame),
    normalise(parts.message),
    normalise(parts.route),
    String(parts.version || '')
  ].join('\0');
  return 'sha256:' + createHash('sha256').update(basis).digest('hex');
}

// Exported for the test, and for the panel's "why is this a duplicate?" line.
export { normalise };
