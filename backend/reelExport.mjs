// Reel → NLE interchange. Pure functions: (model) → string. Zero fs, zero express, so the golden
// tests need neither a server nor a temp storage root.
//
// Multi-track. xmeml maps cleanly: <video> holds one <track> per video lane (BOTTOM FIRST — V1
// then V2, because xmeml stacks later tracks above earlier ones), <audio> holds the audio lanes,
// and gaps need no representation at all because every clipitem carries an absolute start/end.
//
// The rules below are not style. Each is a specific way the import fails, usually SILENTLY —
// Premiere reports a malformed document as an empty sequence with no message.
import { rateOf, tcStr, rationalStr } from '../shared/timecode.mjs';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

// Percent-encode PER PATH SEGMENT. Never encodeURI() over the whole path: it leaves # and ?
// unescaped and the URL truncates, so the clip imports Media Missing rather than erroring.
const seg = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// A Windows path had to be normalised BEFORE encoding, and was not. Splitting `C:\pack\media\a.mov`
// on '/' yields one segment, so the backslashes were percent-encoded into the filename itself and
// every clip in the pack imported offline:
//     file://localhostC%3A%5Cpack%5Cmedia%5Ca.mov      (was)
//     file://localhost/C:/pack/media/a.mov             (now, encoded per segment)
// The round-trip guard in preflight compared decodeURIComponent(pathUrl(f)) against f and passed,
// because that comparison is symmetric under the same wrong encoding — a check that cannot fail
// the way the thing it checks fails. A drive-absolute path also needs the leading slash; without
// it the drive letter reads as the URL host.
export const toPosixAbs = abs => {
  const p = String(abs).replace(/\\/g, '/');
  return /^[A-Za-z]:/.test(p) ? '/' + p : p;
};
export function pathUrl(abs, { style = 'localhost' } = {}) {
  // The drive-letter colon stays literal. encodeURIComponent would emit `C%3A`, and while some
  // readers accept it, `file:///C:/…` is the spelling every NLE is actually tested against.
  const encoded = toPosixAbs(abs).split('/')
    .map(p => (p === '' ? '' : /^[A-Za-z]:$/.test(p) ? p : seg(p)))
    .join('/');
  return style === 'localhost' ? 'file://localhost' + encoded : 'file://' + encoded;
}

const basename = p => String(p || 'slate').replace(/\\/g, '/').split('/').pop();

// Video lanes bottom-first (xmeml stacking order), then audio lanes.
const VIDEO_ORDER = ['V1', 'V2'];
const AUDIO_ORDER = ['A1', 'A2'];

export function reelToTimeline(reel, { mediaFor } = {}) {
  const rate = rateOf({ fpsNum: reel.fpsNum, fpsDen: reel.fpsDen });
  const map = c => ({
    id: c.id,
    track: c.track,
    shot: c.shot || '',
    name: (c.shot || c.title || c.id) + (c.state === 'slate' ? ' — MISSING' : ''),
    title: c.title || c.shot || c.id,
    prompt: c.prompt || '',
    model: c.model || '',
    start: c.startFrame,
    frames: c.frames,
    in: c.in || 0,
    kind: c.kind,
    still: c.kind === 'image' || c.kind === 'slate',
    audio: c.kind === 'audio',
    file: mediaFor ? mediaFor(c) : c.file,
    w: c.srcW || reel.width || 1920,
    h: c.srcH || reel.height || 1080,
    // srcFrames is measured at the SOURCE's rate; everything else on this model is in TIMELINE
    // frames. Carrying it across unconverted meant preflight compared the two directly, so a 24fps
    // clip in a 30fps reel looked like it was being over-read — "reads 90 frames from a 72-frame
    // source" — and one slow source blocked the whole export. Convert once, here at the boundary,
    // so every consumer downstream is in one unit. `map` used to drop srcFps entirely.
    // A resolved rate carries num/den (e.g. 30000/1001), never a `.fps` — reading one gives NaN
    // and every over-read check then silently passes, which is the opposite of the bug being
    // fixed. shared/timecode.mjs is the only place a rate is described; use its fields.
    srcFrames: c.srcFrames
      ? (c.srcFps ? Math.round(c.srcFrames * ((rate.num / rate.den) / c.srcFps)) : c.srcFrames)
      : null
  });
  const all = (reel.clips || []).map(map);
  return {
    name: reel.project + ' — animatic',
    rate,
    width: reel.width || 1920,
    height: reel.height || 1080,
    tcStart: reel.tcStart || 0,
    drop: !!reel.drop && rate.dfLegal,
    totalFrames: reel.totalFrames || 0,
    clips: all,
    videoTracks: VIDEO_ORDER.map(id => all.filter(c => c.track === id)).filter(t => t.length),
    audioTracks: AUDIO_ORDER.map(id => all.filter(c => c.track === id)).filter(t => t.length)
  };
}

// ── FCP7 xmeml v5 ────────────────────────────────────────────────────────────────────────────
export function toXmeml(tl) {
  const r = tl.rate;
  const rateXml = ind => `${ind}<rate><timebase>${r.nominal}</timebase><ntsc>${r.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;

  // File ids are reused across the WHOLE document: the first clipitem referencing a path carries
  // the full <file>, every later reference is a bare <file id="…"/>. Repeat it and Premiere mints
  // a duplicate, unlinked master clip per occurrence.
  const fileIds = new Map();
  let nextFile = 0, nextItem = 0;

  const clipXml = (c, isAudio) => {
    const id = 'ci-' + (++nextItem);
    const out = c.in + c.frames;
    let fileXml;
    if (c.file && fileIds.has(c.file)) {
      fileXml = `          <file id="${fileIds.get(c.file)}"/>`;
    } else {
      const fid = 'file-' + (++nextFile);
      if (c.file) fileIds.set(c.file, fid);
      fileXml = [
        `          <file id="${fid}">`,
        `            <name>${esc(basename(c.file))}</name>`,
        c.file ? `            <pathurl>${esc(pathUrl(c.file))}</pathurl>` : '',
        rateXml('            '),
        `            <duration>${c.still ? c.frames : (c.srcFrames || c.frames)}</duration>`,
        isAudio
          ? `            <media><audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media>`
          : [`            <media><video><samplecharacteristics>`,
             rateXml('              '),
             `              <width>${c.w}</width><height>${c.h}</height>`,
             `            </samplecharacteristics></video></media>`].join('\n'),
        `          </file>`
      ].filter(Boolean).join('\n');
    }

    return [
      `        <clipitem id="${id}">`,
      `          <name>${esc(c.name)}</name>`,
      `          <enabled>TRUE</enabled>`,
      `          <duration>${c.frames}</duration>`,
      rateXml('          '),
      // start/end are RECORD time, in/out are SOURCE time, both exclusive.
      // out - in === end - start, always. Gaps between clipitems are legal and need no element.
      `          <start>${c.start}</start><end>${c.start + c.frames}</end>`,
      `          <in>${c.in}</in><out>${out}</out>`,
      // A still gets <stillframe>TRUE</stillframe> and NO timecode, NO audio block, NO link —
      // an audio block on a still makes Premiere mint one empty phantom audio clip per image.
      (!isAudio && c.still) ? `          <stillframe>TRUE</stillframe>` : '',
      !isAudio ? [
        `          <logginginfo>`,
        `            <description>${esc(c.title)}</description>`,
        `            <shottake>${esc(c.shot || c.id)}</shottake>`,
        `            <lognote>${esc(c.model)}</lognote>`,
        `            <good>TRUE</good>`,
        `          </logginginfo>`,
        `          <comments>`,
        `            <mastercomment1>${esc(c.shot || c.title)}</mastercomment1>`,
        `            <mastercomment2>${esc(c.prompt)}</mastercomment2>`,
        `          </comments>`
      ].join('\n') : '',
      fileXml,
      isAudio
        ? `          <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>`
        : `          <sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>`,
      `        </clipitem>`
    ].filter(Boolean).join('\n');
  };

  const videoTracks = tl.videoTracks.map(t => [
    `        <track>`,
    t.map(c => clipXml(c, false)).join('\n'),
    `          <enabled>TRUE</enabled><locked>FALSE</locked>`,
    `        </track>`
  ].join('\n'));

  const audioTracks = tl.audioTracks.map(t => [
    `        <track>`,
    t.map(c => clipXml(c, true)).join('\n'),
    `          <enabled>TRUE</enabled><locked>FALSE</locked>`,
    `        </track>`
  ].join('\n'));

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="5">`,
    `  <sequence id="frameforge-reel">`,
    `    <name>${esc(tl.name)}</name>`,
    `    <duration>${tl.totalFrames}</duration>`,
    rateXml('    '),
    `    <timecode>`,
    rateXml('      '),
    `      <string>${tcStr(tl.tcStart, r, { drop: tl.drop })}</string>`,
    `      <frame>${tl.tcStart}</frame>`,
    `      <displayformat>${tl.drop ? 'DF' : 'NDF'}</displayformat>`,
    `    </timecode>`,
    `    <media>`,
    `      <video>`,
    `        <format><samplecharacteristics>`,
    rateXml('          '),
    `          <width>${tl.width}</width><height>${tl.height}</height>`,
    `          <anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio>`,
    `          <fielddominance>none</fielddominance><colordepth>24</colordepth>`,
    `        </samplecharacteristics></format>`,
    videoTracks.join('\n') || '        <track><enabled>TRUE</enabled><locked>FALSE</locked></track>',
    `      </video>`,
    audioTracks.length ? [
      `      <audio>`,
      `        <format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>`,
      audioTracks.join('\n'),
      `      </audio>`
    ].join('\n') : '',
    `    </media>`,
    `  </sequence>`,
    `</xmeml>`,
    ``
  ].filter(l => l !== '').join('\n');
}

// ── FCPXML 1.10 ──────────────────────────────────────────────────────────────────────────────
// V1 is the spine (gaps become real <gap> elements — FCP's spine is contiguous by definition).
// V2 and audio ride as CONNECTED clips with a `lane`: positive lanes sit above the spine, negative
// below. offset on a connected clip is timeline-absolute here because we attach them to the spine.
export function toFcpxml(tl) {
  const r = tl.rate;
  const rat = f => rationalStr(f, r);
  const uidOf = s => {
    let h = 5381;
    for (const ch of String(s)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    const hex = h.toString(16).toUpperCase().padStart(8, '0');
    return hex + '-' + hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex;
  };

  const assets = [];
  const idFor = new Map();
  for (const c of tl.clips) {
    const key = c.file || ('slate:' + c.id);
    if (idFor.has(key)) continue;
    const id = 'a' + (assets.length + 1);
    idFor.set(key, id);
    assets.push({ id, c });
  }

  const seqFormat = `    <format id="r1" name="FFVideoFormat${tl.height}p${r.nominal}" frameDuration="${r.frameDuration}" width="${tl.width}" height="${tl.height}" colorSpace="1-1-1 (Rec. 709)"/>`;
  // rate-undefined format for stills — NO frameDuration. Give a still a rate and FCP conforms it.
  const stillFormat = `    <format id="r2" name="FFVideoFormatRateUndefined" width="${tl.width}" height="${tl.height}" colorSpace="1-13-1"/>`;

  const assetXml = assets.map(({ id, c }) => [
    `    <asset id="${id}" name="${esc(basename(c.file))}" uid="${uidOf(c.file || c.id)}" start="0s"`
      + ` duration="${c.still ? '0s' : rat(c.srcFrames || c.frames)}"`
      + ` hasVideo="${c.audio ? '0' : '1'}"${c.audio ? ' hasAudio="1" audioSources="1" audioChannels="2"' : ' videoSources="1"'}`
      + ` format="${c.still ? 'r2' : 'r1'}">`,
    // the file goes in <media-rep>, NEVER an src attribute on <asset> — that makes FCP reject
    // the entire document, and it is the single most expensive mistake in the format
    c.file ? `      <media-rep kind="original-media" src="${esc(pathUrl(c.file, { style: 'plain' }))}"/>` : '',
    `    </asset>`
  ].filter(Boolean).join('\n'));

  const el = (c, lane) => {
    const tag = c.audio ? 'audio' : (c.still ? 'video' : 'asset-clip');
    const note = [c.shot, c.prompt].filter(Boolean).join(' — ');
    return [
      `            <${tag} ref="${idFor.get(c.file || ('slate:' + c.id))}"${lane != null ? ` lane="${lane}"` : ''}`
        + ` offset="${rat(c.start)}" name="${esc(c.name)}" start="${rat(c.in)}" duration="${rat(c.frames)}">`,
      note ? `              <note>${esc(note)}</note>` : '',
      `            </${tag}>`
    ].filter(Boolean).join('\n');
  };

  // spine = V1 with explicit gaps
  const v1 = tl.videoTracks.find(t => t.length && t[0].track === 'V1') || [];
  const spine = [];
  let cursor = 0;
  for (const c of v1) {
    if (c.start > cursor) spine.push(`            <gap offset="${rat(cursor)}" duration="${rat(c.start - cursor)}"/>`);
    spine.push(el(c, null));
    cursor = c.start + c.frames;
  }
  // everything else connects with a lane
  const connected = [];
  for (const t of tl.videoTracks) if (t.length && t[0].track !== 'V1') for (const c of t) connected.push(el(c, 1));
  for (let i = 0; i < tl.audioTracks.length; i++) for (const c of tl.audioTracks[i]) connected.push(el(c, -(i + 1)));
  // a timeline with no V1 still needs a spine element to hang connected clips on
  if (!spine.length && connected.length) spine.push(`            <gap offset="0s" duration="${rat(tl.totalFrames)}"/>`);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<fcpxml version="1.10">`,
    `  <resources>`,
    seqFormat,
    stillFormat,
    ...assetXml,
    `  </resources>`,
    `  <library>`,
    `    <event name="FrameForge">`,
    `      <project name="${esc(tl.name)}">`,
    `        <sequence format="r1" duration="${rat(tl.totalFrames)}" tcStart="${rat(tl.tcStart)}" tcFormat="${tl.drop ? 'DF' : 'NDF'}" audioLayout="stereo" audioRate="48k">`,
    `          <spine>`,
    ...spine,
    ...connected,
    `          </spine>`,
    `        </sequence>`,
    `      </project>`,
    `    </event>`,
    `  </library>`,
    `</fcpxml>`,
    ``
  ].join('\n');
}

// ── preflight ────────────────────────────────────────────────────────────────────────────────
// Runs BEFORE any write. Premiere fails a malformed import with no usable message, so a check
// that runs first is worth more than one that runs after.
export function preflight(tl) {
  const errors = [], warnings = [];
  const r = tl.rate;

  if (!tl.clips.length) errors.push('The timeline is empty — nothing to export.');
  if (tl.drop && !r.dfLegal) errors.push(`Drop-frame is not legal at ${r.label}fps.`);
  if (tl.width % 2 || tl.height % 2) errors.push(`Sequence size ${tl.width}×${tl.height} must be even.`);

  for (const c of tl.clips) {
    if (c.frames < 2) errors.push(`${c.name}: ${c.frames} frame(s) — Resolve rejects stills under 2 frames.`);
    if (!c.audio && (!c.w || !c.h)) errors.push(`${c.name}: unknown source dimensions — it would import offline.`);
    if (!c.still && !c.audio && c.srcFrames && c.in + c.frames > c.srcFrames) {
      errors.push(`${c.name}: reads ${c.in + c.frames} frames from a ${c.srcFrames}-frame source.`);
    }
    if (c.file) {
      // Compare against the NORMALISED path, not the raw one. On Windows the raw path is
      // backslashed and the URL is not, so a raw comparison flags every clip on that platform
      // while still being unable to detect the encoding bug it exists for — the old version was
      // symmetric under its own mistake, which is why it passed while every pack imported offline.
      const round = decodeURIComponent(pathUrl(c.file).replace(/^file:\/\/localhost/, ''));
      if (round !== toPosixAbs(c.file)) errors.push(`${c.name}: path does not survive URL encoding.`);
    }
    if (c.kind === 'slate') warnings.push(`${c.name}: no approved take — exporting a slate.`);
  }

  // overlaps WITHIN one track are the real corruption; gaps between clips are legal now
  for (const t of [...tl.videoTracks, ...tl.audioTracks]) {
    const sorted = [...t].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      if (cur.start < prev.start + prev.frames) {
        errors.push(`${cur.track}: ${cur.name} overlaps ${prev.name} on the same track.`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
