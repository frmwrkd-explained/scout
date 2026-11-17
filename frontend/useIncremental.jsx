// useIncremental — draw a long list a screenful at a time.
//
// A collection of a thousand records used to put a thousand rows (or cards, with a thousand
// <img>s) into the page at once, and React re-drew all of them whenever anything on the screen
// changed — selecting a row, ticking a property, typing in a filter. That is the lag you feel
// AFTER the data has arrived. A layout now draws the first `step` records and adds another `step`
// each time the end of what is drawn comes within reach of the viewport, so the work is
// proportional to what somebody has actually scrolled through.
//
// Nothing is hidden: the count in the view bar is the whole view, the scrollbar grows as rows are
// added, and a line at the end says how many are drawn while there are more to come.
//
//   const win = useIncremental(rows.length, { step: 150, resetKey: collection.id + '/' + view.id });
//   rows.slice(0, win.count) … <More win={win} total={rows.length} />

import React from 'react';

export function useIncremental(total, { step = 150, resetKey = '' } = {}) {
  const [count, setCount] = React.useState(step);
  // A different collection or view starts again from the top; the same one re-sorted does not.
  React.useEffect(() => { setCount(step); }, [resetKey, step]);

  const sentinel = React.useRef(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= total || typeof IntersectionObserver === 'undefined') return undefined;
    // 1200px of lead, so the next batch is in place before the end scrolls into view.
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setCount(c => Math.min(total, c + step));
    }, { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [count, total, step]);

  return { count: Math.min(count, total), more: count < total, sentinel };
}

// The first `n` records of a grouped list, keeping the groups and each group's TRUE size (the
// header prints how many it holds, not how many are drawn so far).
export function takeGroups(groups, n) {
  const out = [];
  let left = n;
  for (const g of groups || []) {
    if (left <= 0) break;
    out.push({ ...g, size: g.items.length, items: g.items.slice(0, left) });
    left -= g.items.length;
  }
  return out;
}

// The end marker: the element the observer watches, and the line that says more is coming.
export function More({ win, total, noun = 'records' }) {
  if (!win.more) return null;
  return (
    <div ref={win.sentinel} className="moreRows" role="status">
      {win.count.toLocaleString('en-US')} of {Number(total).toLocaleString('en-US')} {noun} shown — scroll for more
    </div>
  );
}
