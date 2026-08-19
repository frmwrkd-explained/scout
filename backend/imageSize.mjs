// Zero-dependency intrinsic-size sniffer. Generations record the pixel dimensions the provider
// actually returned (gen.width/gen.height) so the UI can show a real resolution badge instead of
// guessing from the requested aspect — providers round, crop and clamp, and the request is a wish.
// Only the header bytes are read; unknown/failed formats return null and the UI falls back to '—'.

export function imageSize(buf) {
  if (!buf || buf.length < 16) return null;
  try {
    // PNG — IHDR is always the first chunk: 8b signature, 4b length, 'IHDR', w, h (big-endian u32)
    if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // GIF87a / GIF89a — little-endian u16 at 6/8
    if (buf.toString('ascii', 0, 3) === 'GIF') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    // WebP — RIFF container, three sub-formats
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (fmt === 'VP8X') {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { width: w, height: h };
      }
      return null;
    }
    // JPEG — walk the marker segments to the SOFn frame header that carries the size
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        // SOF0-SOF15 minus the non-frame markers (DHT c4, JPGA c8, DAC cc)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch { /* truncated or malformed header — fall through */ }
  return null;
}

// MP4 dimensions live deep in the box tree (moov → trak → tkhd); not worth parsing here. Video
// generations keep width/height null and the UI shows the model's advertised shape instead.
export default imageSize;
