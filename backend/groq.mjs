// Groq credential resolver.
//
// This file used to be Scout's whole Groq bridge — whisper transcription, vision analysis and
// story→shotlist breakdown. All three were film and are gone. What survives is the key resolver,
// because `distill.mjs` (session-end learnings, and a real part of Scout's memory story) still
// makes one cheap JSON call and needs a key.
//
// It stays in this file rather than moving into env.mjs to keep the resolver convention the parent
// repo documents: a provider's key resolver lives beside that provider's code. When M3 decides what
// Scout actually distils with, this is the one place to repoint.

import { getSettings } from './store.mjs';

export function groqKey() {
  return process.env.GROQ_API_KEY || getSettings().groqApiKey || '';
}
