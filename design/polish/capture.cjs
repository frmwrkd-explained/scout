// Headless capture rig: boots Scout's backend against a throwaway workspace, drives the real UI in
// an offscreen Electron window, and writes one PNG per screen per theme plus type measurements.
//   electron capture.cjs <appDir> <workspace> <outDir> [only=a,b] [themes=dark,light]
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const [appDir, workspace, outDir, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map(s => s.split('=')));
const only = opt.only ? opt.only.split(',') : null;
const themes = (opt.themes || 'dark,light').split(',');
const PORT = Number(opt.port || 5391);
const W = 1920, H = 1080;
fs.mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ping = () => new Promise(res => { const q = http.get({ host: '127.0.0.1', port: PORT, path: '/api/index', timeout: 800 }, r => { r.resume(); res(true); }); q.on('error', () => res(false)); q.on('timeout', () => { q.destroy(); res(false); }); });

// Click the element whose own text is exactly `label`. `where` narrows to the rail (x < 260) or the
// centre pane so a word that appears twice resolves to the right one.
const clickJs = (label, where = 'any', dbl = false) => `(() => {
  const want = ${JSON.stringify(label)};
  const els = [...document.querySelectorAll('button,[role=button],a,div,span')].filter(e => {
    const t = (e.innerText || '').trim(); if (t !== want && !(t.startsWith(want) && t.length <= want.length + 6)) return false;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    if (${JSON.stringify(where)} === 'rail' && r.left > 250) return false;
    if (${JSON.stringify(where)} === 'centre' && r.left < 250) return false;
    return true;
  });
  els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
  const el = els[0]; if (!el) return 'MISS ' + want;
  const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); el.dispatchEvent(new MouseEvent('click', o));
  if (${dbl}) el.dispatchEvent(new MouseEvent('dblclick', o));
  return 'ok';
})()`;

const shapeJs = (target) => `(() => {
  const names = ['Table','Board','List','Gallery'];
  const btn = [...document.querySelectorAll('button')].find(b => { const t = (b.innerText||'').replace(/[^A-Za-z]/g,''); const r = b.getBoundingClientRect(); return names.includes(t) && r.top < 60 && r.left > 900; });
  if (!btn) return 'MISS shape button';
  const cur = btn.innerText.replace(/[^A-Za-z]/g,'');
  if (cur === ${JSON.stringify(target)}) return 'ok';
  btn.click(); return 'open';
})()`;
const shapePickJs = (target) => `(() => {
  const el = [...document.querySelectorAll('button,[role=menuitem],div')].filter(e => { const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect(); return t.startsWith(${JSON.stringify(target)}) && r.top > 40 && r.width && r.left > 900 && t.length < 90; }).sort((a,b)=>a.innerText.length-b.innerText.length)[0];
  if (!el) return 'MISS shape option'; el.click(); return 'ok';
})()`;
// First tile / row in the centre pane.
const firstItemJs = (dbl) => `(() => {
  const el = document.querySelector('[data-capture-item]') || [...document.querySelectorAll('.rvH')].find(e => e.getBoundingClientRect().left > 250) || [...document.querySelectorAll('.hRow')].find(e => e.getBoundingClientRect().left > 250);
  if (!el) return 'MISS item';
  const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 40, view: window };
  el.dispatchEvent(new MouseEvent('click', o)); if (${dbl}) el.dispatchEvent(new MouseEvent('dblclick', o));
  return 'ok';
})()`;

// Visible text, by computed size: [{px, chars}] and the count of elements under 14px.
const measureJs = `(() => {
  const sizes = {}; let nodes = 0;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.nodeValue.trim(); if (!t) continue;
    const el = n.parentElement; const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const px = Math.round(parseFloat(cs.fontSize) * 10) / 10; nodes++;
    sizes[px] = (sizes[px] || 0) + t.length;
  }
  const radii = {}; const gaps = {};
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.borderTopLeftRadius !== '0px') radii[cs.borderTopLeftRadius] = (radii[cs.borderTopLeftRadius] || 0) + 1;
    if (cs.display.includes('flex') || cs.display.includes('grid')) { const g = cs.columnGap; if (g && g !== 'normal' && g !== '0px') gaps[g] = (gaps[g] || 0) + 1; }
  }
  return { nodes, sizes, radii, gaps };
})()`;

const SCREENS = [
  { id: '01-today', steps: [['click', 'Today', 'rail']] },
  { id: '02-needs-you', steps: [['click', 'Needs you', 'rail']] },
  { id: '03-project', steps: [['click', 'Project', 'rail']] },
  { id: '04-collection-table', steps: [['click', '#guest', 'rail'], ['shape', 'Table']] },
  { id: '05-collection-board', steps: [['click', '#guest', 'rail'], ['shape', 'Board']] },
  { id: '06-gallery', steps: [['click', '#references', 'rail']] },
  { id: '07-gallery-selected', steps: [['click', '#references', 'rail'], ['first', false]] },
  { id: '08-document-reference', steps: [['click', '#references', 'rail'], ['first', true]] },
  { id: '09-document-guest', steps: [['click', '#guest', 'rail'], ['shape', 'Table'], ['first', true]] },
  { id: '10-goals', steps: [['click', 'Goals', 'rail']] },
  { id: '11-territory', steps: [['click', 'Territory', 'rail']] },
  { id: '12-playbook', steps: [['click', 'Playbook', 'rail']] },
  { id: '13-what-they-know', steps: [['click', 'What they know', 'rail']] },
  { id: '14-whiteboard', steps: [['click', 'Whiteboard', 'rail']] },
  { id: '15-files', steps: [['click', 'FILES ON DISK', 'rail']] },
  { id: '16-settings', steps: [['click', 'SETTINGS', 'rail']] },
];

app.commandLine.appendSwitch('force-device-scale-factor', String(opt.dsf || 1));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const server = spawn('node', ['backend/index.mjs', String(PORT)], {
    cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SCOUT_DATA: workspace, SCOUT_CONFIG: path.join(os.tmpdir(), 'scout-capture-no-pointer.md'), SCOUT_TEST: '1', PORT: '' },
  });
  let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  const quit = code => { try { server.kill(); } catch {} app.exit(code); };
  try {
    for (let i = 0; i < 60 && !(await ping()); i++) await sleep(250);
    if (!(await ping())) throw new Error('backend did not start:\n' + log.slice(-800));

    const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
    win.webContents.setFrameRate(30);
    const url = 'http://127.0.0.1:' + PORT + '/';
    const measures = {};
    for (const theme of themes) {
      await win.loadURL(url);
      await win.webContents.executeJavaScript(`localStorage.setItem('scout.theme', ${JSON.stringify(theme)}); 'ok'`);
      for (const screen of SCREENS) {
        if (only && !only.some(o => screen.id.includes(o))) continue;
        await win.loadURL(url); await sleep(2600);
        const notes = [];
        for (const [kind, a, b] of screen.steps) {
          let r;
          if (kind === 'shape') {
            r = await win.webContents.executeJavaScript(shapeJs(a));
            if (r === 'open') { await sleep(500); r = await win.webContents.executeJavaScript(shapePickJs(a)); await sleep(1200); }
          } else if (kind === 'first') {
            for (let i = 0; i < 40; i++) { r = await win.webContents.executeJavaScript(firstItemJs(a)); if (r === 'ok') break; await sleep(400); }
          } else r = await win.webContents.executeJavaScript(clickJs(a, b));
          if (r !== 'ok') notes.push(r);
          await sleep(kind === 'first' ? 1400 : 900);
        }
        await sleep(/gallery|reference/.test(screen.id) ? Math.max(8000, Number(opt.settle || 1200)) : Number(opt.settle || 1200));
        const img = await win.webContents.capturePage();
        const file = path.join(outDir, screen.id + '-' + theme + '.png');
        fs.writeFileSync(file, img.toPNG());
        measures[screen.id + '-' + theme] = { size: img.getSize(), notes, ...(await win.webContents.executeJavaScript(measureJs)) };
        console.log(path.basename(file), JSON.stringify(img.getSize()), notes.join(' '));
      }
    }
    fs.writeFileSync(path.join(outDir, 'measures.json'), JSON.stringify(measures, null, 1));
    quit(0);
  } catch (e) { console.error(String(e && e.stack || e)); quit(1); }
});
