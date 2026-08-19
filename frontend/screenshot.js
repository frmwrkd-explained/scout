// One screenshot API, two paths underneath. The panel never branches on which one it got.
//
//   shipped app  → window.frameforge.capture() → webContents.capturePage()
//                  Real compositor output: WebGL (the 3D stage), <video>, everything. Captures
//                  the FrameForge window only, so nothing else on the tester's screen can be
//                  caught by accident. No permission prompt.
//
//   npm run dev  → getDisplayMedia({ preferCurrentTab: true })
//                  Shows the browser's picker. Fine for a developer; it is not the path a tester
//                  takes, and it is why the desktop path exists at all.
//
// Deliberately no html2canvas fallback. It would add a dependency to a four-dependency app and
// return a picture that disagrees with what the user saw — which, for a bug report, is worse than
// no picture. If neither path works, the report sends without a screenshot and says so.

export const isDesktopCapture = () => !!(typeof window !== 'undefined' && window.frameforge && window.frameforge.capture);

/**
 * @param {{x:number,y:number,width:number,height:number}} [rect] CSS pixels, window-relative
 * @returns {Promise<{ dataUrl: string, via: 'desktop'|'display-media' } | null>}
 */
export async function capture(rect) {
  if (isDesktopCapture()) {
    const dataUrl = await window.frameforge.capture(rect || null).catch(() => null);
    if (dataUrl) return { dataUrl, via: 'desktop' };
    return null;
  }
  return captureViaDisplayMedia(rect);
}

async function captureViaDisplayMedia(rect) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return null;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: false,
      preferCurrentTab: true   // Chromium honours this; elsewhere it is ignored and the picker opens
    });

    const track = stream.getVideoTracks()[0];
    if (!track) return null;

    // One frame is all we want. ImageCapture is the direct route; where it is missing (Safari,
    // older Firefox) a <video> element decodes the same frame with more ceremony.
    const bitmap = window.ImageCapture
      ? await new window.ImageCapture(track).grabFrame()
      : await grabViaVideo(stream);
    if (!bitmap) return null;

    const canvas = document.createElement('canvas');
    // getDisplayMedia hands back device pixels while `rect` is in CSS pixels — scale, or a region
    // select on a retina display crops the wrong quarter of the screen.
    const scale = bitmap.width / Math.max(1, window.innerWidth);
    const r = rect
      ? { x: rect.x * scale, y: rect.y * scale, w: rect.width * scale, h: rect.height * scale }
      : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    canvas.width = Math.max(1, Math.round(r.w));
    canvas.height = Math.max(1, Math.round(r.h));
    canvas.getContext('2d').drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();

    return { dataUrl: canvas.toDataURL('image/png'), via: 'display-media' };
  } catch {
    return null; // includes the user cancelling the picker, which is a decision, not an error
  } finally {
    // Always stop the tracks. A live screen-capture track left running is the "why is this app
    // still recording my screen?" bug, and it would be entirely deserved.
    if (stream) for (const t of stream.getTracks()) { try { t.stop(); } catch { /* already stopped */ } }
  }
}

function grabViaVideo(stream) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    const bail = setTimeout(() => resolve(null), 3000);
    video.onloadedmetadata = () => {
      video.play().then(() => {
        // One rAF after play: the first decoded frame is not necessarily painted yet, and a
        // black screenshot is the classic symptom of not waiting for it.
        requestAnimationFrame(() => {
          clearTimeout(bail);
          const c = document.createElement('canvas');
          c.width = video.videoWidth; c.height = video.videoHeight;
          c.getContext('2d').drawImage(video, 0, 0);
          video.pause(); video.srcObject = null;
          createImageBitmap(c).then(resolve, () => resolve(null));
        });
      }, () => { clearTimeout(bail); resolve(null); });
    };
  });
}

/**
 * Flatten annotations onto the shot. Boxes and arrows are evidence; blur is the one that matters —
 * a tester who spots something private in their own screenshot needs to be able to remove it, and
 * "then don't screenshot that" is not an answer.
 *
 * @param {string} dataUrl
 * @param {Array<{kind:'box'|'arrow'|'blur', x:number, y:number, w:number, h:number}>} marks
 *        coordinates are fractions of width/height, so they survive any scaling
 */
export function flatten(dataUrl, marks) {
  if (!marks || !marks.length) return Promise.resolve(dataUrl);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = m => ({ x: m.x * c.width, y: m.y * c.height, w: m.w * c.width, h: m.h * c.height });

      // Blur first, so a box drawn to point AT redacted content is not itself smeared.
      for (const m of marks.filter(m => m.kind === 'blur')) {
        const r = px(m);
        if (r.w < 2 || r.h < 2) continue;
        // Downscale-and-back is a real destructive pixelate. A canvas filter would only *look*
        // blurred while the original pixels stayed in the PNG — which is not redaction at all.
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.round(r.w / 14));
        small.height = Math.max(1, Math.round(r.h / 14));
        small.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height);
        g.imageSmoothingEnabled = false;
        g.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.w, r.h);
        g.imageSmoothingEnabled = true;
      }

      g.lineWidth = Math.max(2, Math.round(c.width / 400));
      g.strokeStyle = '#E3FF32';   // the accent — see docs/DESIGN.md; do not swap this for red
      g.fillStyle = '#E3FF32';
      for (const m of marks.filter(m => m.kind !== 'blur')) {
        const r = px(m);
        if (m.kind === 'box') { g.strokeRect(r.x, r.y, r.w, r.h); continue; }
        const x2 = r.x + r.w, y2 = r.y + r.h;
        g.beginPath(); g.moveTo(r.x, r.y); g.lineTo(x2, y2); g.stroke();
        const a = Math.atan2(r.h, r.w), head = g.lineWidth * 5;
        g.beginPath();
        g.moveTo(x2, y2);
        g.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
        g.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
        g.closePath(); g.fill();
      }
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl); // annotations lost, screenshot kept — never the reverse
    img.src = dataUrl;
  });
}
