// Parse a CSS declaration string into a React style object.
// Lets the app keep the design prototype's style strings verbatim.
const cache = new Map();
export function sx(str) {
  if (cache.has(str)) return cache.get(str);
  const o = {};
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    if (!k) continue;
    o[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = decl.slice(i + 1).trim();
  }
  if (cache.size < 4000) cache.set(str, o);
  return o;
}
