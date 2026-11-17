// shared/recordPage.mjs — how a collection wants its records' pages to look. PURE, used by the
// server (to refuse a wrong value) and by the page (to draw it).
//
// A record's page is the same everywhere a record opens, and how it is laid out is a property of
// the COLLECTION, not of each record: every reference looks like a reference, every company like a
// company. A person sets it once from "Customize page" on any record and all the others follow; an
// agent can read or set the same keys in `.scout/collections/<id>.md`:
//
//   page:
//     layout: stack | side | compact     where the picture sits
//     media:  lead | grid | strip        one large picture · an even gallery · a filmstrip
//     mediaSize: s | m | l               how tall the picture may be when it sits on top
//     text:   folded | open              long text blocks start folded, or fully open
//     width:  narrow | normal | wide | full
//     sections: [properties, media, text, note, children]   which parts show, in this order
//   header: [field keys]                 the properties under the title (see RecordHeader.jsx)
//
// Everything is optional. Missing keys fall back to the defaults below, so a collection that has
// never been customized — and every collection file written before this existed — opens exactly
// as the default page.

// stack    the picture across the page, above the text        (default)
// side     the picture in its own column that stays in view while the text scrolls beside it
// compact  a small picture beside the title; the page is about the text
export const PAGE_LAYOUTS = ['stack', 'side', 'compact'];
export const PAGE_WIDTHS = ['narrow', 'normal', 'wide', 'full'];
// A record can carry several pictures (a `file` field with `many: true`, or several file fields).
// lead   the first one large, the rest small beneath it
// grid   every picture the same size, as a gallery
// strip  one picture large, the rest as a filmstrip you click through
export const PAGE_MEDIA = ['lead', 'grid', 'strip'];
export const PAGE_MEDIA_SIZES = ['s', 'm', 'l'];
export const PAGE_MEDIA_PX = { s: 280, m: 560, l: 820 };
export const PAGE_TEXT = ['folded', 'open'];
// The parts of a page under its title. `text` is the collection's long text fields (a prompt, a
// brief), each as its own block; `note` is the Markdown body; `children` is its sub-collections.
export const PAGE_SECTIONS = ['properties', 'media', 'text', 'note', 'children'];

export const PAGE_LABELS = {
  layout: { stack: 'Picture on top', side: 'Picture beside', compact: 'Small picture' },
  width: { narrow: 'Narrow', normal: 'Normal', wide: 'Wide', full: 'Full width' },
  media: { lead: 'One large', grid: 'Gallery', strip: 'Filmstrip' },
  mediaSize: { s: 'Small', m: 'Medium', l: 'Large' },
  text: { folded: 'Folded', open: 'Open' },
  sections: { properties: 'Properties', media: 'Picture and files', text: 'Long text', note: 'Note', children: 'Sub-collections' },
};

// Max width of the reading column, in px (`full` has none).
export const PAGE_WIDTH_PX = { narrow: 680, normal: 860, wide: 1180, full: null };

// → { layout, width, sections, hidden, media, mediaSize, text }. `sections` is the visible ones in order; `hidden` is the
// rest, so a control can offer to bring one back.
export function pageOf(collection) {
  const page = (collection && collection.page && typeof collection.page === 'object') ? collection.page : {};
  const layout = PAGE_LAYOUTS.includes(page.layout) ? page.layout : 'stack';
  const width = PAGE_WIDTHS.includes(page.width) ? page.width : (layout === 'side' ? 'wide' : 'normal');
  const listed = Array.isArray(page.sections) ? page.sections.filter((s, i, a) => PAGE_SECTIONS.includes(s) && a.indexOf(s) === i) : null;
  const sections = listed || [...PAGE_SECTIONS];
  return {
    layout, width, sections, hidden: PAGE_SECTIONS.filter(s => !sections.includes(s)),
    media: PAGE_MEDIA.includes(page.media) ? page.media : 'lead',
    mediaSize: PAGE_MEDIA_SIZES.includes(page.mediaSize) ? page.mediaSize : 'm',
    text: PAGE_TEXT.includes(page.text) ? page.text : 'folded',
  };
}

// Returns the cleaned `page` object to store, or throws an Error naming what is wrong.
// `null` clears the customization.
export function cleanPage(page) {
  if (page === null) return null;
  if (!page || typeof page !== 'object' || Array.isArray(page)) throw new Error('page must be an object');
  const out = {};
  if (page.layout !== undefined && page.layout !== null) {
    if (!PAGE_LAYOUTS.includes(page.layout)) throw new Error('page layout "' + page.layout + '" is not one of ' + PAGE_LAYOUTS.join(' · '));
    out.layout = page.layout;
  }
  if (page.width !== undefined && page.width !== null) {
    if (!PAGE_WIDTHS.includes(page.width)) throw new Error('page width "' + page.width + '" is not one of ' + PAGE_WIDTHS.join(' · '));
    out.width = page.width;
  }
  for (const [key, allowed] of [['media', PAGE_MEDIA], ['mediaSize', PAGE_MEDIA_SIZES], ['text', PAGE_TEXT]]) {
    if (page[key] === undefined || page[key] === null) continue;
    if (!allowed.includes(page[key])) throw new Error('page ' + key + ' "' + page[key] + '" is not one of ' + allowed.join(' · '));
    out[key] = page[key];
  }
  if (page.sections !== undefined && page.sections !== null) {
    if (!Array.isArray(page.sections)) throw new Error('page sections must be a list');
    for (const s of page.sections) {
      if (!PAGE_SECTIONS.includes(s)) throw new Error('page section "' + s + '" is not one of ' + PAGE_SECTIONS.join(' · '));
    }
    out.sections = page.sections.filter((s, i, a) => a.indexOf(s) === i);
  }
  return Object.keys(out).length ? out : null;
}
