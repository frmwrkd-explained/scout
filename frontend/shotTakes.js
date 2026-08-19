// "Every take of a shot, and which one is the pick." PURE module — no React, no fetch.
//
// The rule is the client-side mirror of backend/reel.mjs `resolveShotMedia`: the SELECTED candidate
// is the picture, and when there is no selection the newest surviving take stands in, flagged as
// unapproved rather than hidden. An unreviewed render is a picture you have not judged yet, not an
// absence — the reel learned that the hard way (30 of 34 shots in a real project had images and no
// review, and treating them as holes drew a black slate over a shot that plainly had pictures).
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────────────────────────
// `ShotWorkspace.takes()` and `Story.jsx` each carry a private copy of this walk, and they already
// differ in what they include. The Board needed a third, so it got this instead. Those two are NOT
// migrated here — that is a separate change to surfaces this feature does not otherwise touch —
// but nothing new should re-derive it. Import from here.

export const isVideoFile = f => /\.(mp4|mov|webm|m4v)$/i.test(String(f || ''));

// Oldest → newest, which is the order a filmstrip reads. Killed takes are dropped; in-flight ones
// are kept (with no file) so a card can show that something is rendering rather than looking empty.
export function takesForShot(pdef, shot) {
  if (!shot) return [];
  const out = [];
  for (const g of ((pdef && pdef.gens) || [])) {
    if (g.shot !== shot.id || g.reviewState === 'killed') continue;
    out.push({
      key: 'g' + g.id, id: g.id, file: g.file || null, status: g.status,
      ts: g.started || 0, kept: g.reviewState === 'kept', hero: shot.selectedCandidate === g.id,
      rating: g.rating || 0, cost: g.cost, model: g.model, video: isVideoFile(g.file)
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// The one take a card shows. `approved:false` means "this is a stand-in, nobody has picked yet" and
// the UI is expected to say so — a provisional picture presented as the plan is how a board lies.
export function heroTake(pdef, shot) {
  const ts = takesForShot(pdef, shot).filter(t => t.file);
  if (!ts.length) return null;
  const hero = ts.find(t => t.hero);
  if (hero) return { ...hero, approved: true };
  const kept = ts.filter(t => t.kept).pop();
  return { ...(kept || ts[ts.length - 1]), approved: false };
}
