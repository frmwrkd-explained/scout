// Loads the repo-root .env into process.env. Zero dependencies on purpose — Node 20's
// --env-file flag throws when the file is missing (--env-file-if-exists is Node 22+), and
// a missing .env must never stop the app from booting.
//
// Import this FIRST in any entry point, before ./store.mjs: store captures FRFG_CONFIG /
// FRFG_DATA at module-load time, so a .env that sets those has to land before it evaluates.
//
// Precedence: a variable already present in process.env always wins. A real shell export
// beats the file, and tests/_env.mjs keeps control of the hermetic FRFG_* roots.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = process.env.FRFG_ENV_FILE
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

export function loadEnv(file = ENV_FILE) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return { loaded: false, keys: [] }; }

  const keys = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const key = s.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = s.slice(eq + 1).trim();
    // strip one matching pair of surrounding quotes
    if (val.length > 1 && ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) { process.env[key] = val; keys.push(key); }
  }
  return { loaded: true, keys };
}

loadEnv();
