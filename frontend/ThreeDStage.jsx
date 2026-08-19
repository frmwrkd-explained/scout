// 3D Stage — block out a scene in real 3D, keyframe the camera and every object on a
// timeline, then export the move as a video reference for image→video models (Seedance,
// Kling motion control). Stills from the asset library can be converted to real GLB
// meshes (FAL Trellis) and staged alongside the built-in blockout props.
// Scenes save as portable markdown (threed/scenes/*.md) like everything else.
import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sx } from './sx';
import { TOKENS } from './tokens.js';
import { CAMERA_MOVEMENTS } from './cameraMovements';
import { VoiceInput } from './VoiceInput';
import { MONO } from './tokens';

// ── move builder — sequential camera-move steps compile into keyframes + prompt ──
// Geometry per move: given {pos, target, fov} return the end pose. Rolls are excluded
// (the lookAt camera can't roll); everything else maps 1:1 to the movement grammar.
const MOVE_MATH = {
  'static': p => p,
  'push-in': p => ({ ...p, pos: p.target.clone().add(p.pos.clone().sub(p.target).multiplyScalar(.45)) }),
  'pull-out': p => ({ ...p, pos: p.target.clone().add(p.pos.clone().sub(p.target).multiplyScalar(1.9)) }),
  'dolly-zoom': p => ({ ...p, pos: p.target.clone().add(p.pos.clone().sub(p.target).multiplyScalar(.5)), fov: Math.min(70, p.fov * 1.55) }),
  'boom-up': p => ({ ...p, pos: p.pos.clone().setY(p.pos.y + 2.4) }),
  'boom-down': p => ({ ...p, pos: p.pos.clone().setY(Math.max(.35, p.pos.y - 2.4)) }),
  'pedestal-up': p => ({ ...p, pos: p.pos.clone().setY(p.pos.y + 1.4), target: p.target.clone().setY(p.target.y + 1.4) }),
  'pedestal-down': p => ({ ...p, pos: p.pos.clone().setY(Math.max(.35, p.pos.y - 1.4)), target: p.target.clone().setY(Math.max(.3, p.target.y - 1.4)) }),
  'pan-left': p => ({ ...p, target: p.target.clone().sub(p.pos).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6).add(p.pos) }),
  'pan-right': p => ({ ...p, target: p.target.clone().sub(p.pos).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 6).add(p.pos) }),
  'tilt-up': p => ({ ...p, target: p.target.clone().setY(p.target.y + 1.6) }),
  'tilt-down': p => ({ ...p, target: p.target.clone().setY(p.target.y - 1.6) }),
  'tracking-left': p => { const r = new THREE.Vector3().crossVectors(p.target.clone().sub(p.pos).normalize(), new THREE.Vector3(0, 1, 0)).multiplyScalar(-2.6); return { ...p, pos: p.pos.clone().add(r), target: p.target.clone().add(r) }; },
  'tracking-right': p => { const r = new THREE.Vector3().crossVectors(p.target.clone().sub(p.pos).normalize(), new THREE.Vector3(0, 1, 0)).multiplyScalar(2.6); return { ...p, pos: p.pos.clone().add(r), target: p.target.clone().add(r) }; },
  'arc-clockwise': p => ({ ...p, pos: p.pos.clone().sub(p.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4.5).add(p.target) }),
  'arc-counterclockwise': p => ({ ...p, pos: p.pos.clone().sub(p.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4.5).add(p.target) }),
  'zoom-in': p => ({ ...p, fov: Math.max(22, p.fov * .62) }),
  'zoom-out': p => ({ ...p, fov: Math.min(65, p.fov * 1.5) })
};
const BUILDER_MOVES = CAMERA_MOVEMENTS.filter(m => MOVE_MATH[m.id]);

// Literal hex (not var(--accent)): concatenated with alpha suffixes (ACCENT + '66') and
// read by JS sinks — CSS var() would not resolve there.
const ACCENT = TOKENS.accent;

// ── blockout prop builders — parametric, no assets needed ──
const PROP_COLOR = 0x8E97A5;
function mat(color = PROP_COLOR) { return new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: .05 }); }
function figure(height = 1.75, color) {
  const g = new THREE.Group();
  const m = mat(color);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .5, 6, 12), m);
  torso.position.y = height * .55; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.11, 16, 12), m);
  head.position.y = height * .92; g.add(head);
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(.13, .6, 6, 12), m);
  legs.position.y = height * .25; g.add(legs);
  g.scale.setScalar(height / 1.75);
  return g;
}
const PROPS = {
  man: { name: 'Figure', build: () => figure(1.75) },
  woman: { name: 'Figure S', build: () => figure(1.62, 0xA5988E) },
  car: {
    name: 'Car', build: () => {
      const g = new THREE.Group(); const m = mat(0x6E7683);
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, .55, 1.85), m); body.position.y = .55; g.add(body);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, .5, 1.65), m); cabin.position.set(-.2, 1.05, 0); g.add(cabin);
      const wm = mat(0x2A2E36);
      [[-1.45, .32, .95], [1.45, .32, .95], [-1.45, .32, -.95], [1.45, .32, -.95]].forEach(p => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .22, 18), wm);
        w.rotation.x = Math.PI / 2; w.position.set(...p); g.add(w);
      });
      return g;
    }
  },
  tree: {
    name: 'Tree', build: () => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.14, .2, 1.6, 10), mat(0x7A6A55)); trunk.position.y = .8; g.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), mat(0x5E7A5E)); crown.position.y = 2.2; g.add(crown);
      return g;
    }
  },
  wall: { name: 'Wall', build: () => { const w = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, .18), mat(0x7C8494)); w.position.y = 1.3; return w; } },
  cube: { name: 'Cube', build: () => { const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat()); c.position.y = .5; return c; } },
  sphere: { name: 'Sphere', build: () => { const s = new THREE.Mesh(new THREE.SphereGeometry(.55, 24, 18), mat()); s.position.y = .55; return s; } },
  chair: {
    name: 'Chair', build: () => {
      const g = new THREE.Group(); const m = mat(0x8A7E6E);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(.5, .06, .5), m); seat.position.y = .45; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(.5, .55, .06), m); back.position.set(0, .75, -.22); g.add(back);
      [[-.21, -.21], [.21, -.21], [-.21, .21], [.21, .21]].forEach(([x, z]) => {
        const l = new THREE.Mesh(new THREE.BoxGeometry(.05, .45, .05), m); l.position.set(x, .22, z); g.add(l);
      });
      return g;
    }
  },
  light: {
    name: 'Street lamp', build: () => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, 3.4, 10), mat(0x4A505B)); pole.position.y = 1.7; g.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(.16, 14, 10), new THREE.MeshStandardMaterial({ color: 0xFFEBB0, emissive: 0xFFD870, emissiveIntensity: 1.4 }));
      lamp.position.y = 3.42; g.add(lamp);
      const pt = new THREE.PointLight(0xFFD9A0, 12, 12); pt.position.y = 3.35; g.add(pt);
      return g;
    }
  }
};

const lerp = (a, b, t) => a + (b - a) * t;
// keyframes: sorted [{t, pos:[3], quat:[4], scale, fov?}] — sample with linear pos/slerp quat
function sample(frames, t) {
  if (!frames.length) return null;
  if (t <= frames[0].t) return frames[0];
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1];
  let i = 0; while (frames[i + 1].t < t) i++;
  const a = frames[i], b = frames[i + 1];
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const qa = new THREE.Quaternion(...a.quat), qb = new THREE.Quaternion(...b.quat);
  return {
    t,
    pos: [0, 1, 2].map(j => lerp(a.pos[j], b.pos[j], k)),
    quat: qa.slerp(qb, k).toArray(),
    scale: lerp(a.scale ?? 1, b.scale ?? 1, k),
    fov: a.fov != null ? lerp(a.fov, b.fov ?? a.fov, k) : undefined,
    target: a.target ? [0, 1, 2].map(j => lerp(a.target[j], (b.target || a.target)[j], k)) : undefined
  };
}

export default class ThreeDStage extends React.Component {
  state = {
    objects: [],          // [{key, kind:'prop'|'glb', prop?, glbUrl?, name, keyframes:[]}]
    selected: null,       // object key
    camFrames: [],        // camera keyframes [{t,pos,quat,fov,target}]
    time: 0, duration: 5, playing: false, recording: false,
    mode: 'translate',
    scenes: [], sceneId: null, sceneName: 'untitled scene',
    genObjects: [], genBusy: false, genUrl: '', genName: '',
    lastRender: null,     // {falUrl, name}
    chat: [], chatInput: '', chatBusy: false, videoPrompt: null,
    moveSteps: [],        // [{key, id (CAMERA_MOVEMENTS id), dur}] — compiled in order
    movePick: 'push-in',
    showDirector: true, showRail: true,
    projects: [], embedProj: '', embedShots: [], embedShot: '', embedBusy: false,
    status: ''
  };
  nodes = {};             // key → THREE.Object3D live nodes
  raf = 0; playT0 = 0; playFrom = 0;

  componentDidMount() {
    this.initScene(); this.refreshScenes(); this.refreshGen();
    window.addEventListener('keydown', this.onKey);
    fetch('/api/state').then(r => r.json()).then(s => this.setState({ projects: (s.projects || []).map(p => ({ id: p.id, name: p.name || p.id })) })).catch(() => { });
  }
  componentDidUpdate(_p, prev) {
    if (this.chatEl && (prev.chat !== this.state.chat || prev.chatBusy !== this.state.chatBusy)) this.chatEl.scrollTop = this.chatEl.scrollHeight;
  }
  componentWillUnmount() {
    window.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.raf);
    // Everything initScene() attached has to come back off, in reverse order. Leaving the
    // ResizeObserver connected kept the whole scene graph reachable AND fired setSize/
    // updateProjectionMatrix against a renderer we had just disposed. OrbitControls and
    // TransformControls each hold their own pointer/wheel listeners on renderer.domElement,
    // so they need dispose() too — the canvas alone going out of scope does not release them.
    this.resizeObs?.disconnect(); this.resizeObs = null;
    this.renderer?.domElement?.removeEventListener('pointerdown', this.onPick);
    try { this.gizmo?.detach?.(); this.gizmo?.dispose?.(); } catch { /* already torn down */ }
    try { this.orbit?.dispose?.(); } catch { /* already torn down */ }
    this.renderer?.dispose(); this.renderer?.forceContextLoss?.();
    this.renderer?.domElement?.remove();
    this.renderer = null; this.scene = null; this.camera = null; this.orbit = null; this.gizmo = null;
  }

  // ── three.js boot ──
  // NLE-style viewport: the holder is a flex cell that owns all remaining space; the 16:9
  // canvas letterboxes inside it (both axes), so collapsing a rail immediately grows the stage.
  stageSize() {
    const w0 = this.holder?.clientWidth || 960;
    const h0 = this.holder?.clientHeight || 540;
    const scale = Math.max(20, Math.min(w0 / 16, h0 / 9));
    return { w: Math.round(scale * 16), h: Math.round(scale * 9) };
  }
  initScene() {
    const holder = this.holder; if (!holder) return;
    const { w: W, h: H } = this.stageSize();
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    holder.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(TOKENS['surface-2']);
    scene.fog = new THREE.Fog(new THREE.Color(TOKENS['surface-2']), 30, 90);
    const camera = new THREE.PerspectiveCamera(42, W / H, .1, 400);
    camera.position.set(7, 4.5, 9);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 1, 0); orbit.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xBFD0E8, 0x2A2620, 1.05));
    const sun = new THREE.DirectionalLight(0xFFF2DC, 2.2);
    sun.position.set(8, 14, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: TOKENS.line, roughness: .95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(60, 60, TOKENS['border-2'], TOKENS.border);
    grid.position.y = .001; scene.add(grid);

    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
    scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);

    renderer.domElement.addEventListener('pointerdown', this.onPick);

    Object.assign(this, { renderer, scene, camera, orbit, gizmo });
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (this.state.playing) this.stepPlayback();
      orbit.enabled = !this.state.playing;
      if (!this.state.playing) orbit.update();
      renderer.render(scene, camera);
    };
    tick();
    this.resizeObs = new ResizeObserver(() => {
      const { w, h } = this.stageSize();
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    });
    this.resizeObs.observe(holder);
  }

  onPick = e => {
    if (this.state.playing || e.button !== 0) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const roots = Object.values(this.nodes);
    const hits = rc.intersectObjects(roots, true);
    if (!hits.length) return;
    let node = hits[0].object;
    while (node.parent && !node.userData.stageKey) node = node.parent;
    if (node.userData.stageKey) this.select(node.userData.stageKey);
  };

  select(key) {
    this.setState({ selected: key });
    const node = this.nodes[key];
    if (node) { this.gizmo.attach(node); this.gizmo.setMode(this.state.mode); }
    else this.gizmo.detach();
  }

  onKey = e => {
    if (e.target.isContentEditable) return; // the composer's contenteditable prompt — same bail as INPUT/TEXTAREA
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (k === 'g') this.setMode('translate');
    else if (k === 'r') this.setMode('rotate');
    else if (k === 's') this.setMode('scale');
    else if ((k === 'backspace' || k === 'delete') && this.state.selected) { e.preventDefault(); this.removeObject(this.state.selected); }
    else if (k === ' ') { e.preventDefault(); this.togglePlay(); }
    else if (k === 'k') this.keyframeSelected();
    else if (k === 'c') this.keyframeCamera();
  };
  setMode(mode) { this.setState({ mode }); if (this.gizmo.object) this.gizmo.setMode(mode); }

  // ── objects ──
  addProp(id) {
    const key = id + '-' + Date.now().toString(36);
    const node = PROPS[id].build();
    node.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    node.userData.stageKey = key;
    node.position.set((Math.random() - .5) * 3, node.position.y, (Math.random() - .5) * 3);
    this.scene.add(node); this.nodes[key] = node;
    this.setState(s => ({ objects: [...s.objects, { key, kind: 'prop', prop: id, name: PROPS[id].name, keyframes: [] }] }), () => this.select(key));
  }
  addGlb(glbUrl, name, opts = null) {
    const key = 'glb-' + Date.now().toString(36);
    const loader = new GLTFLoader();
    this.setState({ status: 'loading mesh…' });
    loader.load('/api/threed/proxy?src=' + encodeURIComponent(glbUrl), gltf => {
      const node = gltf.scene;
      // normalize: fit to ~1.8u tall, feet on the ground
      const box = new THREE.Box3().setFromObject(node);
      const size = box.getSize(new THREE.Vector3());
      const s = 1.8 / Math.max(size.x, size.y, size.z, 1e-6);
      node.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(node);
      node.position.y -= box2.min.y;
      node.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      node.userData.stageKey = key;
      // restored/staged transform (scene load, director) — position offsets the grounded origin
      if (opts?.pos) node.position.add(new THREE.Vector3(...opts.pos));
      if (opts?.quat) node.quaternion.fromArray(opts.quat);
      this.scene.add(node); this.nodes[key] = node;
      this.setState(st => ({ status: '', objects: [...st.objects, { key, kind: 'glb', glbUrl, name: name || 'mesh', keyframes: opts?.keyframes || [] }] }), () => !opts && this.select(key));
    }, undefined, () => this.setState({ status: 'mesh failed to load' }));
  }
  removeObject(key) {
    const node = this.nodes[key];
    if (node) { if (this.gizmo.object === node) this.gizmo.detach(); this.scene.remove(node); delete this.nodes[key]; }
    this.setState(s => ({ objects: s.objects.filter(o => o.key !== key), selected: s.selected === key ? null : s.selected }));
  }

  // ── keyframes ──
  snapshotNode(node) {
    return { t: this.state.time, pos: node.position.toArray(), quat: node.quaternion.toArray(), scale: node.scale.x };
  }
  keyframeSelected() {
    const { selected } = this.state; if (!selected) return;
    const node = this.nodes[selected]; if (!node) return;
    const kf = this.snapshotNode(node);
    this.setState(s => ({
      objects: s.objects.map(o => o.key !== selected ? o :
        { ...o, keyframes: [...o.keyframes.filter(f => Math.abs(f.t - kf.t) > .011), kf].sort((a, b) => a.t - b.t) }),
      status: 'keyframe · ' + selected.split('-')[0] + ' @ ' + kf.t.toFixed(1) + 's'
    }));
  }
  keyframeCamera() {
    const kf = {
      t: this.state.time, pos: this.camera.position.toArray(), quat: this.camera.quaternion.toArray(),
      scale: 1, fov: this.camera.fov, target: this.orbit.target.toArray()
    };
    this.setState(s => ({
      camFrames: [...s.camFrames.filter(f => Math.abs(f.t - kf.t) > .011), kf].sort((a, b) => a.t - b.t),
      status: 'camera keyframe @ ' + kf.t.toFixed(1) + 's'
    }));
  }
  clearFrames() { this.setState(s => ({ camFrames: [], objects: s.objects.map(o => ({ ...o, keyframes: [] })) })); }

  applyTime(t) {
    for (const o of this.state.objects) {
      const node = this.nodes[o.key]; if (!node || !o.keyframes.length) continue;
      const f = sample(o.keyframes, t);
      node.position.fromArray(f.pos); node.quaternion.fromArray(f.quat); node.scale.setScalar(f.scale ?? 1);
    }
    if (this.state.camFrames.length) {
      const f = sample(this.state.camFrames, t);
      this.camera.position.fromArray(f.pos);
      if (f.target) { this.orbit.target.fromArray(f.target); this.camera.lookAt(this.orbit.target); }
      else this.camera.quaternion.fromArray(f.quat);
      if (f.fov) { this.camera.fov = f.fov; this.camera.updateProjectionMatrix(); }
    }
  }
  setTime(t) { this.setState({ time: t }, () => this.applyTime(t)); }
  togglePlay() {
    if (this.state.playing) return this.setState({ playing: false });
    this.gizmo.detach();
    this.playFrom = this.state.time >= this.state.duration - .01 ? 0 : this.state.time;
    this.playT0 = performance.now();
    this.setState({ playing: true });
  }
  stepPlayback() {
    const t = this.playFrom + (performance.now() - this.playT0) / 1000;
    if (t >= this.state.duration) {
      this.applyTime(this.state.duration);
      return this.setState({ playing: false, time: this.state.duration });
    }
    this.applyTime(t);
    if (Math.abs(t - this.state.time) > .04) this.setState({ time: t });
  }

  // ── export → deterministic frame render → backend ffmpeg mp4 → fal CDN + library ──
  // Not MediaRecorder: realtime capture drops frames and produces nothing at all in some
  // embedded browsers. Rendering frame-by-frame is exact and usually faster than realtime.
  async exportRender() {
    if (this.state.recording) { this.cancelExport = true; return; }
    this.cancelExport = false;
    this.gizmo.detach();
    const fps = 30, frames = Math.round(this.state.duration * fps);
    const job = Date.now().toString(36);
    const canvas = this.renderer.domElement;
    this.setState({ recording: true, playing: false, lastRender: null, status: 'rendering 0/' + frames });
    try {
      for (let i = 0; i < frames; i++) {
        if (this.cancelExport) throw new Error('export cancelled');
        const t = i / fps;
        this.applyTime(t);
        this.renderer.render(this.scene, this.camera);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', .92));
        if (!blob || !blob.size) throw new Error('frame capture failed');
        const fr = await fetch('/api/threed/render-frames?job=' + job + '&i=' + i, { method: 'POST', body: blob });
        if (!fr.ok) throw new Error('frame upload ' + fr.status);
        if (i % 5 === 0) this.setState({ time: t, status: 'rendering ' + i + '/' + frames });
      }
      this.setState({ status: 'assembling mp4 + uploading…' });
      const resp = await fetch('/api/threed/render-assemble?job=' + job + '&fps=' + fps +
        '&name=' + encodeURIComponent(this.state.sceneName.replace(/\s+/g, '-') || 'stage-render'), { method: 'POST' });
      const jr = await resp.json();
      if (!resp.ok) throw new Error(jr.error || 'assemble ' + resp.status);
      this.setState({
        recording: false, time: this.state.duration,
        lastRender: { falUrl: jr.url, name: jr.name },
        status: 'reference ready — on fal CDN + library/3d-renders'
      });
    } catch (e) {
      this.setState({ recording: false, status: 'export failed: ' + e.message });
    }
  }
  downloadRender() {
    const r = this.state.lastRender; if (!r?.name) return;
    const a = document.createElement('a');
    a.href = '/api/library/file?name=' + encodeURIComponent(r.name) + '&folder=' + encodeURIComponent('3d-renders');
    a.download = r.name;
    a.click();
  }

  // ── image→3D ──
  async generate3d() {
    const { genUrl, genName } = this.state;
    if (!genUrl.trim() || this.state.genBusy) return;
    this.setState({ genBusy: true, status: 'converting still to 3D (30–90s)…' });
    try {
      const resp = await fetch('/api/threed/image-to-3d', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: genUrl.trim(), name: genName.trim() || 'object' })
      });
      const jr = await resp.json();
      if (!resp.ok) throw new Error(jr.error || 'generate ' + resp.status);
      this.setState({ genBusy: false, genUrl: '', genName: '', status: 'mesh ready — ' + jr.name });
      this.refreshGen();
      this.addGlb(jr.glbUrl, jr.name);
    } catch (e) { this.setState({ genBusy: false, status: 'image→3D failed: ' + e.message }); }
  }
  refreshGen() { fetch('/api/threed/objects').then(r => r.json()).then(genObjects => this.setState({ genObjects })).catch(() => { }); }

  // ── scenes (persistence) ──
  refreshScenes() { fetch('/api/threed/scenes').then(r => r.json()).then(scenes => this.setState({ scenes })).catch(() => { }); }
  async saveScene() {
    const id = this.state.sceneId || this.state.sceneName.replace(/\s+/g, '-').toLowerCase().replace(/[^\w-]/g, '') || 'scene-' + Date.now().toString(36);
    const doc = this.serializeDoc();
    await fetch('/api/threed/scenes/' + encodeURIComponent(id), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.state.sceneName, doc })
    });
    this.setState({ sceneId: id, status: 'scene saved — threed/scenes/' + id + '.md' });
    this.refreshScenes();
  }
  // Apply a full scene doc to the stage — used by scene load AND the director chat.
  // Docs may carry rotY (degrees, director-speak) instead of quats; normalize here.
  applyDoc(doc, meta = {}) {
    const yQuat = deg => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Number(deg) || 0) * Math.PI / 180).toArray();
    const normKf = (kf, base) => ({
      t: Math.max(0, Number(kf.t) || 0),
      pos: Array.isArray(kf.pos) ? kf.pos.map(Number) : base.pos,
      quat: Array.isArray(kf.quat) ? kf.quat : (kf.rotY != null ? yQuat(kf.rotY) : base.quat),
      scale: kf.scale != null ? Number(kf.scale) : base.scale,
      ...(kf.fov != null ? { fov: Number(kf.fov) } : {}),
      ...(Array.isArray(kf.target) ? { target: kf.target.map(Number) } : {})
    });
    for (const k of Object.keys(this.nodes)) { this.scene.remove(this.nodes[k]); delete this.nodes[k]; }
    this.gizmo.detach();
    const duration = Math.min(60, Math.max(.5, Number(doc.duration) || 5));
    const camFrames = (doc.camFrames || [])
      .map(f => normKf({ target: [0, 1, 0], fov: 42, ...f }, { pos: [7, 4.5, 9], quat: [0, 0, 0, 1], scale: 1 }))
      .filter(f => f.t <= duration).sort((a, b) => a.t - b.t);
    this.setState({ objects: [], selected: null, camFrames, duration, time: 0, playing: false, ...meta }, () => {
      const cam = doc.camera || camFrames[0];
      if (cam) {
        this.camera.position.fromArray(cam.pos);
        this.orbit.target.fromArray(cam.target || [0, 1, 0]);
        this.camera.fov = cam.fov || 42; this.camera.updateProjectionMatrix();
      }
      for (const o of doc.objects || []) {
        const base = { pos: Array.isArray(o.pos) ? o.pos.map(Number) : [0, 0, 0], quat: Array.isArray(o.quat) ? o.quat : yQuat(o.rotY), scale: o.scale != null ? Number(o.scale) : 1 };
        const keyframes = (o.keyframes || []).map(kf => normKf(kf, base)).filter(f => f.t <= duration).sort((a, b) => a.t - b.t);
        if (o.kind === 'glb' && o.glbUrl) { this.addGlb(o.glbUrl, o.name, { pos: base.pos, quat: base.quat, keyframes }); continue; }
        if (o.kind !== 'prop' || !PROPS[o.prop]) continue;
        const key = o.prop + '-' + Math.random().toString(36).slice(2, 8);
        const node = PROPS[o.prop].build();
        node.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } });
        node.userData.stageKey = key;
        node.position.fromArray(base.pos); node.quaternion.fromArray(base.quat); node.scale.setScalar(base.scale);
        this.scene.add(node); this.nodes[key] = node;
        this.setState(st => ({ objects: [...st.objects, { key, kind: 'prop', prop: o.prop, name: o.name || PROPS[o.prop].name, keyframes }] }));
      }
    });
  }
  async loadScene(id) {
    const r = await fetch('/api/threed/scenes/' + encodeURIComponent(id));
    if (!r.ok) return;
    const s = await r.json();
    this.applyDoc(s.doc || {}, { sceneId: s.id, sceneName: s.name || s.id });
  }
  serializeDoc() {
    return {
      duration: this.state.duration,
      camFrames: this.state.camFrames,
      camera: { pos: this.camera.position.toArray(), target: this.orbit.target.toArray(), fov: this.camera.fov },
      objects: this.state.objects.map(o => {
        const node = this.nodes[o.key];
        return {
          kind: o.kind, prop: o.prop, glbUrl: o.glbUrl, name: o.name, keyframes: o.keyframes,
          pos: node?.position.toArray(), quat: node?.quaternion.toArray(), scale: node?.scale.x ?? 1
        };
      })
    };
  }

  // ── director chat — Claude stages the scene / writes the video prompt ──
  async sendChat(text) {
    const msg = String(text ?? this.state.chatInput).trim();
    if (!msg || this.state.chatBusy) return;
    const chat = [...this.state.chat, { role: 'user', content: msg }];
    this.setState({ chat, chatInput: '', chatBusy: true });
    try {
      const r = await fetch('/api/threed/director', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chat, doc: this.serializeDoc() })
      });
      const jr = await r.json();
      if (!r.ok) throw new Error(jr.error || 'director ' + r.status);
      this.setState(s => ({
        chat: [...s.chat, { role: 'assistant', content: jr.reply }],
        chatBusy: false,
        ...(jr.videoPrompt ? { videoPrompt: jr.videoPrompt } : {})
      }));
      if (jr.scene) this.applyDoc(jr.scene);
    } catch (e) {
      const msg = /failed to fetch|networkerror/i.test(e.message)
        ? 'FrameForge server is not reachable — restart the app (or `npm start`) and send again.'
        : e.message;
      this.setState(s => ({ chat: [...s.chat, { role: 'assistant', content: '⚠ ' + msg }], chatBusy: false }));
    }
  }

  // ── move builder — steps → camera keyframes + composed video prompt ──
  addMoveStep() {
    const id = this.state.movePick;
    this.setState(s => ({ moveSteps: [...s.moveSteps, { key: Date.now().toString(36) + s.moveSteps.length, id, dur: 2 }] }), () => this.compileMoves());
  }
  patchMoveStep(key, patch) {
    this.setState(s => ({ moveSteps: s.moveSteps.map(m => m.key === key ? { ...m, ...patch } : m) }), () => this.compileMoves());
  }
  removeMoveStep(key) {
    this.setState(s => ({ moveSteps: s.moveSteps.filter(m => m.key !== key) }), () => this.compileMoves());
  }
  compileMoves() {
    const steps = this.state.moveSteps;
    if (!steps.length) return;
    // start from where the camera is right now — frame your opening, then build the move
    let pose = { pos: this.camera.position.clone(), target: this.orbit.target.clone(), fov: this.camera.fov };
    const key = (t, p) => ({ t, pos: p.pos.toArray(), quat: [0, 0, 0, 1], scale: 1, fov: p.fov, target: p.target.toArray() });
    const camFrames = [key(0, pose)];
    let t = 0;
    for (const st of steps) {
      const dur = Math.max(.5, Number(st.dur) || 2);
      pose = (MOVE_MATH[st.id] || MOVE_MATH.static)(pose);
      t += dur;
      camFrames.push(key(t, pose));
    }
    const names = steps.map(s => BUILDER_MOVES.find(m => m.id === s.id)?.name || s.id);
    const frags = steps.map((s, i) => {
      const m = BUILDER_MOVES.find(x => x.id === s.id);
      return (steps.length > 1 ? (i + 1) + '. ' : '') + (m ? m.promptFragment : '');
    });
    this.setState({
      camFrames, duration: Math.max(t, .5), time: 0,
      videoPrompt: 'Camera move — ' + names.join(', then ') + '.\n' + frags.join('\n'),
      status: 'move compiled — ' + names.join(' → ') + ' · ' + t + 's'
    }, () => this.applyTime(0));
  }

  // ── embed into a shot: copy render into the project + attach prompt/reference to the shot ──
  async pickEmbedProject(pid) {
    this.setState({ embedProj: pid, embedShot: '', embedShots: [] });
    if (!pid) return;
    try {
      const r = await fetch('/api/story/' + encodeURIComponent(pid));
      const jr = await r.json();
      this.setState({ embedShots: jr.shots || [] });
    } catch { /* project without story */ }
  }
  async embedInShot() {
    const { embedProj, embedShot, embedShots, lastRender, videoPrompt } = this.state;
    if (!embedProj || !embedShot || !lastRender || this.state.embedBusy) return;
    this.setState({ embedBusy: true, status: 'embedding into shot…' });
    try {
      await fetch('/api/library/copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromScope: 'library', name: lastRender.name, folder: '3d-renders', toScope: embedProj, toFolder: 'references' })
      });
      const shot = embedShots.find(s => s.id === embedShot) || {};
      const refLine = 'Motion reference (3D Stage): ' + lastRender.falUrl;
      const vp = [videoPrompt, refLine].filter(Boolean).join('\n');
      const pr = await fetch('/api/story/' + encodeURIComponent(embedProj) + '/shots/' + encodeURIComponent(embedShot), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { videoPrompt: shot.videoPrompt ? shot.videoPrompt + '\n' + vp : vp }, log: 'video reference embedded from 3D Stage' })
      });
      if (!pr.ok) throw new Error('shot patch ' + pr.status);
      this.setState({ embedBusy: false, status: 'embedded — reference in ' + embedProj + '/references + prompt on shot ' + embedShot });
    } catch (e) { this.setState({ embedBusy: false, status: 'embed failed: ' + e.message }); }
  }
  newScene() {
    for (const k of Object.keys(this.nodes)) { this.scene.remove(this.nodes[k]); delete this.nodes[k]; }
    this.gizmo.detach();
    this.setState({ sceneId: null, sceneName: 'untitled scene', objects: [], selected: null, camFrames: [], time: 0, duration: 5, playing: false, lastRender: null });
  }


  // ── ui — NLE layout: rails left/right, viewport owns the middle, one transport dock ──
  toggleRail(id) { this.setState(s => ({ railClosed: { ...(s.railClosed || {}), [id]: !(s.railClosed || {})[id] } })); }
  render() {
    const S = this.state;
    const btn = (label, onClick, opts = {}) => (
      <button onClick={onClick} disabled={opts.disabled} title={opts.title}
        style={{
          ...sx('font-size:11px;font-weight:700;border-radius:7px;padding:5px 10px;cursor:pointer;border:1px solid var(--border-2);background:var(--surface-2);color:var(--fg);white-space:nowrap;flex:none'),
          ...(opts.accent ? { borderColor: ACCENT + '77', color: ACCENT } : {}),
          ...(opts.disabled ? { opacity: .45, cursor: 'default' } : {}), ...(opts.style || {})
        }}>{label}</button>
    );
    const selObj = S.objects.find(o => o.key === S.selected);
    const hasKeys = S.camFrames.length > 0 || S.objects.some(o => o.keyframes.length);
    const STEPS = [
      { n: 1, label: 'DESCRIBE', done: S.chat.length > 0 || S.objects.length > 0 },
      { n: 2, label: 'STAGE', done: S.objects.length > 0 },
      { n: 3, label: 'MOVE', done: hasKeys },
      { n: 4, label: 'EXPORT', done: !!S.lastRender }
    ];
    const active = STEPS.find(st => !st.done) || STEPS[3];
    const HINTS = {
      1: 'describe the scene below — the director stages props, positions and the camera move',
      2: 'add props or convert stills to 3D, arrange with g/r/s on the stage',
      3: 'stack camera moves in the dock (dolly → crane → …) or set keys by hand (C / K)',
      4: 'export renders the move → fal CDN reference + composed video prompt → embed in a shot'
    };
    const scrub = e => {
      const r = this.lane.getBoundingClientRect();
      this.setTime(Math.min(S.duration, Math.max(0, (e.clientX - r.left) / r.width * S.duration)));
    };
    const closed = S.railClosed || {};
    const sec = (id, title, count, body) => (
      <div key={id} style={sx('border-bottom:1px solid var(--surface-2)')}>
        <div onClick={() => this.toggleRail(id)}
          style={sx('display:flex;align-items:center;gap:7px;padding:11px 14px;cursor:pointer;user-select:none')}>
          <span style={{ ...sx('font-size:9px;color:var(--fg-faint);width:8px'), fontFamily: MONO }}>{closed[id] ? '▸' : '▾'}</span>
          <span style={{ ...sx('font-size:10px;font-weight:800;letter-spacing:.09em;color:var(--fg-muted)'), fontFamily: MONO }}>{title}</span>
          {count != null && <span style={{ ...sx('margin-left:auto;font-size:9px;color:var(--fg-faint)'), fontFamily: MONO }}>{count}</span>}
        </div>
        {!closed[id] && <div style={sx('padding:0 14px 14px')}>{body}</div>}
      </div>
    );
    const input = (props, style) => (
      <input {...props} style={{ ...sx('width:100%;background:var(--surface);border:1px solid var(--border);border-radius:7px;color:var(--fg);font-size:11.5px;padding:7px 9px;box-sizing:border-box'), ...(style || {}) }} />
    );

    return (
      <div style={sx('display:flex;height:calc(100vh - 92px);overflow:hidden;background:var(--void)')}>

        {/* ── left rail · director ── */}
        {S.showDirector && (
          <aside style={sx('width:300px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--surface-2);background:var(--ink)')}>
            <div style={sx('padding:14px 16px 12px;border-bottom:1px solid var(--surface-2)')}>
              <div style={sx('display:flex;align-items:center;gap:8px')}>
                <span style={{ ...sx('width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:12px;flex:none;background:var(--surface-2)'), border: '1px solid ' + ACCENT + '66', color: ACCENT }}>✦</span>
                <span style={sx('font-size:12.5px;font-weight:800')}>Director</span>
                <span style={{ ...sx('margin-left:auto;font-size:9px;color:var(--fg-faint)'), fontFamily: MONO }}>claude code</span>
              </div>
              {/* steps — one horizontal strip, active is the only loud thing */}
              <div style={sx('display:flex;align-items:center;gap:0;margin-top:12px')}>
                {STEPS.map((st, i) => (
                  <React.Fragment key={st.n}>
                    {i > 0 && <span style={{ ...sx('flex:1;height:1px'), background: st.done || st === active ? ACCENT + '55' : 'var(--border)' }} />}
                    <span title={st.label} style={{
                      ...sx('width:20px;height:20px;border-radius:99px;display:flex;align-items:center;justify-content:center;flex:none;font-size:9px;font-weight:800'),
                      fontFamily: MONO,
                      background: st.done ? ACCENT : 'transparent',
                      color: st.done ? 'var(--void)' : st === active ? ACCENT : 'var(--fg-faint)',
                      border: '1px solid ' + (st.done || st === active ? ACCENT : 'var(--border)')
                    }}>{st.done ? '✓' : st.n}</span>
                  </React.Fragment>
                ))}
              </div>
              <div style={sx('display:flex;justify-content:space-between;margin-top:5px')}>
                {STEPS.map(st => (
                  <span key={st.n} style={{ ...sx('font-size:8px;font-weight:800;letter-spacing:.07em'), fontFamily: MONO, color: st === active ? 'var(--fg)' : st.done ? 'var(--fg-faint)' : 'var(--border-3)' }}>{st.label}</span>
                ))}
              </div>
              <div style={sx('font-size:10.5px;color:var(--fg-faint);line-height:1.5;margin-top:9px')}>{HINTS[active.n]}</div>
            </div>

            {/* chat fills the rail */}
            <div ref={el => { this.chatEl = el; }} style={sx('flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:14px 16px')}>
              {!S.chat.length && (
                <div style={sx('font-size:11px;color:var(--fg-faint);line-height:1.65')}>
                  “night street — a figure walks past a parked car toward the street lamp, slow push-in, 6 seconds”
                </div>
              )}
              {S.chat.map((m, i) => (
                <div key={i} style={{
                  ...sx('font-size:11.5px;line-height:1.55;border-radius:9px;padding:7px 10px;white-space:pre-wrap;max-width:94%'),
                  background: m.role === 'user' ? 'var(--raise)' : 'transparent',
                  color: m.role === 'user' ? 'var(--fg)' : 'var(--fg-muted)',
                  border: '1px solid ' + (m.role === 'user' ? 'var(--border)' : 'var(--surface-2)'),
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start'
                }}>{m.content}</div>
              ))}
              {S.chatBusy && <span style={{ ...sx('font-size:10px;color:var(--fg-faint)'), fontFamily: MONO }}>staging…</span>}
            </div>

            {S.videoPrompt && (
              <div style={sx('margin:0 16px 10px;border:1px solid var(--accent-35);border-radius:9px;padding:9px 11px;background:var(--surface);max-height:150px;overflow-y:auto')}>
                <div style={sx('display:flex;align-items:center;margin-bottom:4px')}>
                  <span style={{ ...sx('font-size:8.5px;font-weight:800;letter-spacing:.09em'), fontFamily: MONO, color: ACCENT }}>VIDEO PROMPT</span>
                  <span onClick={() => { navigator.clipboard?.writeText(S.videoPrompt); this.setState({ status: 'video prompt copied' }); }}
                    className="hFgL" style={sx('margin-left:auto;font-size:9.5px;color:var(--fg-muted);cursor:pointer')}>copy</span>
                </div>
                <div style={sx('font-size:10.5px;color:var(--fg-muted);line-height:1.55;user-select:all')}>{S.videoPrompt}</div>
              </div>
            )}
            <div style={sx('display:flex;align-items:center;gap:6px;padding:0 16px 14px')}>
              {input({
                value: S.chatInput, placeholder: 'direct the scene…', disabled: S.chatBusy,
                onChange: e => this.setState({ chatInput: e.target.value }),
                onKeyDown: e => { if (e.key === 'Enter') this.sendChat(); }
              }, { background: 'var(--surface-2)' })}
              <VoiceInput app={this.props.app} size={24}
                onText={t => this.setState(s => ({ chatInput: (s.chatInput ? s.chatInput.trim() + ' ' : '') + t }))} />
              {btn('→', () => this.sendChat(), { accent: true, disabled: S.chatBusy || !S.chatInput.trim() })}
            </div>
          </aside>
        )}

        {/* ── center · viewport + transport dock ── */}
        <main style={sx('flex:1;display:flex;flex-direction:column;min-width:0')}>
          <div ref={el => { this.holder = el; }}
            style={sx('flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:var(--sunk)')} />

          <div style={sx('flex:none;border-top:1px solid var(--surface-2);background:var(--ink);padding:10px 16px 9px;display:flex;flex-direction:column;gap:8px')}>
            {/* transport */}
            <div style={sx('display:flex;align-items:center;gap:10px')}>
              {btn(S.showDirector ? '◧' : '□', () => this.setState(s => ({ showDirector: !s.showDirector })), { title: 'toggle director', style: { padding: '5px 8px' } })}
              {btn(S.showRail ? '◨' : '□', () => this.setState(s => ({ showRail: !s.showRail })), { title: 'toggle panel', style: { padding: '5px 8px' } })}
              {btn(S.playing ? '⏸' : '▶', () => this.togglePlay(), { accent: true, style: { width: 40, fontSize: 12 } })}
              <div ref={el => { this.lane = el; }}
                onPointerDown={e => { if (S.playing) return; this.scrubbing = true; e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
                onPointerMove={e => { if (this.scrubbing) scrub(e); }}
                onPointerUp={() => { this.scrubbing = false; }}
                style={sx('position:relative;flex:1;height:38px;border:1px solid var(--border);border-radius:8px;background:var(--surface);cursor:ew-resize;touch-action:none')}>
                {Array.from({ length: Math.floor(S.duration) }, (_, i) => i + 1).map(s2 => (
                  <span key={s2} style={{ ...sx('position:absolute;top:0;bottom:0;width:1px;background:var(--line)'), left: (s2 / S.duration * 100) + '%' }} />
                ))}
                {S.camFrames.map((f, i) => (
                  <span key={'c' + i} title={'camera @ ' + f.t.toFixed(1) + 's'}
                    onPointerDown={e => { e.stopPropagation(); this.setTime(f.t); }}
                    style={{ ...sx('position:absolute;top:6px;width:9px;height:9px;border-radius:2px;cursor:pointer;transform:rotate(45deg)'), left: 'calc(' + (f.t / S.duration * 100) + '% - 4.5px)', background: ACCENT }} />
                ))}
                {(selObj?.keyframes || []).map((f, i) => (
                  <span key={'o' + i} title={selObj.name + ' @ ' + f.t.toFixed(1) + 's'}
                    onPointerDown={e => { e.stopPropagation(); this.setTime(f.t); }}
                    style={{ ...sx('position:absolute;bottom:6px;width:9px;height:9px;border-radius:99px;cursor:pointer'), left: 'calc(' + (f.t / S.duration * 100) + '% - 4.5px)', background: '#5B9DFF' }} />
                ))}
                <span style={{ ...sx('position:absolute;top:-1px;bottom:-1px;width:2px;background:var(--fg);border-radius:2px;pointer-events:none'), left: 'calc(' + (S.time / S.duration * 100) + '% - 1px)' }} />
              </div>
              <span style={{ ...sx('font-size:11px;color:var(--fg-muted);width:44px;text-align:right;flex:none'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{S.time.toFixed(1)}s</span>
              <input type="number" min={0.5} max={60} step={0.5} value={S.duration}
                onChange={e => { const d = Math.min(60, Math.max(.5, Number(e.target.value) || 5)); this.setState({ duration: d, time: Math.min(S.time, d) }); }}
                style={{ ...sx('width:48px;flex:none;background:var(--surface-2);color:var(--fg);border:1px solid var(--border);border-radius:6px;font-size:11px;padding:5px 6px;text-align:right'), fontFamily: MONO }} />
              <span style={{ ...sx('font-size:9px;color:var(--fg-faint);flex:none'), fontFamily: MONO }}>s</span>
            </div>

            {/* moves + keys + export — one row, never wraps */}
            <div style={sx('display:flex;align-items:center;gap:7px;overflow-x:auto;padding-bottom:2px')}>
              <span style={{ ...sx('font-size:8.5px;font-weight:800;letter-spacing:.09em;color:var(--fg-faint);flex:none'), fontFamily: MONO }}>MOVES</span>
              {S.moveSteps.map((st, i) => (
                <span key={st.key} style={sx('display:flex;align-items:center;gap:4px;border:1px solid var(--accent-35);border-radius:7px;padding:3px 6px;background:var(--surface);flex:none')}>
                  <span style={{ ...sx('font-size:8.5px;color:var(--fg-faint)'), fontFamily: MONO }}>{i + 1}</span>
                  <select value={st.id} onChange={e => this.patchMoveStep(st.key, { id: e.target.value })}
                    style={sx('background:var(--surface);color:var(--fg);border:none;font-size:10.5px')}>
                    {BUILDER_MOVES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="number" min={0.5} max={20} step={0.5} value={st.dur}
                    onChange={e => this.patchMoveStep(st.key, { dur: Number(e.target.value) || 2 })}
                    style={{ ...sx('width:34px;background:var(--surface-2);color:var(--fg-muted);border:1px solid var(--border);border-radius:4px;font-size:10px;padding:1px 3px;text-align:right'), fontFamily: MONO }} />
                  <span onClick={() => this.removeMoveStep(st.key)} style={sx('cursor:pointer;color:var(--fg-faint);font-size:9px')}>✕</span>
                </span>
              ))}
              <select value={S.movePick} onChange={e => this.setState({ movePick: e.target.value })}
                style={sx('background:var(--surface-2);color:var(--fg-muted);border:1px solid var(--border);border-radius:7px;font-size:10.5px;padding:4px 5px;flex:none')}>
                {BUILDER_MOVES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {btn('+ Add', () => this.addMoveStep(), { accent: true })}
              {S.moveSteps.length > 0 && btn('↻', () => this.compileMoves(), { title: 'recompile from current camera' })}
              <span style={sx('width:1px;height:20px;background:var(--border);flex:none;margin:0 3px')} />
              {btn('◆ C', () => this.keyframeCamera(), { title: 'camera keyframe (C)' })}
              {btn('● K', () => this.keyframeSelected(), { title: 'object keyframe (K)', disabled: !S.selected })}
              {btn('Clear', () => this.clearFrames())}
              <span style={sx('flex:1')} />
              {btn(S.recording ? '■ Cancel' : '⦿ Export reference', () => this.exportRender(), { accent: !S.recording })}
              {S.lastRender && btn('↓ .mp4', () => this.downloadRender())}
              {S.lastRender && btn('✎ Prompt', () => this.sendChat('Write the video prompt for this exported camera move and scene.'), { disabled: S.chatBusy, title: 'director writes the video prompt' })}
            </div>

            {/* result strip — only exists after an export */}
            {S.lastRender && (
              <div style={sx('display:flex;align-items:center;gap:8px;overflow-x:auto')}>
                <span style={{ ...sx('font-size:8.5px;font-weight:800;letter-spacing:.09em;flex:none'), fontFamily: MONO, color: 'var(--ok)' }}>REFERENCE</span>
                <span style={{ ...sx('font-size:9.5px;color:var(--ok);user-select:all;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px'), fontFamily: MONO }}>{S.lastRender.falUrl}</span>
                <span style={sx('width:1px;height:18px;background:var(--border);flex:none')} />
                <span style={{ ...sx('font-size:8.5px;font-weight:800;letter-spacing:.09em;color:var(--fg-faint);flex:none'), fontFamily: MONO }}>EMBED</span>
                <select value={S.embedProj} onChange={e => this.pickEmbedProject(e.target.value)}
                  style={sx('background:var(--surface-2);color:var(--fg);border:1px solid var(--border);border-radius:7px;font-size:10.5px;padding:4px 5px;flex:none')}>
                  <option value="">project…</option>
                  {S.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={S.embedShot} onChange={e => this.setState({ embedShot: e.target.value })} disabled={!S.embedShots.length}
                  style={sx('background:var(--surface-2);color:var(--fg);border:1px solid var(--border);border-radius:7px;font-size:10.5px;padding:4px 5px;flex:none;max-width:220px')}>
                  <option value="">{S.embedProj ? (S.embedShots.length ? 'shot…' : 'no shots') : 'shot…'}</option>
                  {S.embedShots.map(sh => <option key={sh.id} value={sh.id}>{sh.id} — {(sh.title || sh.desc || '').slice(0, 34)}</option>)}
                </select>
                {btn(S.embedBusy ? 'Embedding…' : '⇢ Embed', () => this.embedInShot(), { accent: true, disabled: !S.embedShot || S.embedBusy })}
              </div>
            )}

            <div style={{ ...sx('font-size:9.5px;color:var(--fg-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), fontFamily: MONO }}>
              {S.status || 'g/r/s transform · C camera key · K object key · space play · drag timeline to scrub · click stage to select'}
            </div>
          </div>
        </main>

        {/* ── right rail · scene / props / mesh / stage ── */}
        {S.showRail && (
          <aside style={sx('width:248px;flex:none;overflow-y:auto;border-left:1px solid var(--surface-2);background:var(--ink)')}>
            {sec('scene', 'SCENE', S.scenes.length || null, (
              <div>
                <div style={sx('display:flex;gap:6px')}>
                  {input({ value: S.sceneName, onChange: e => this.setState({ sceneName: e.target.value }) })}
                </div>
                <div style={sx('display:flex;gap:6px;margin-top:8px')}>
                  {btn('Save', () => this.saveScene(), { accent: true })}
                  {btn('New', () => this.newScene())}
                </div>
                {S.scenes.length > 0 && (
                  <div style={sx('margin-top:9px;display:flex;flex-direction:column;gap:3px')}>
                    {S.scenes.map(sc => (
                      <div key={sc.id} onClick={() => this.loadScene(sc.id)} className="hFgL"
                        style={sx('display:flex;justify-content:space-between;gap:6px;font-size:11px;color:var(--fg-muted);cursor:pointer;padding:4px 7px;border-radius:6px;background:var(--surface)')}>
                        <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: sc.id === S.sceneId ? ACCENT : undefined }}>{sc.name}</span>
                        <span style={{ ...sx('color:var(--fg-faint);flex:none'), fontFamily: MONO, fontSize: 9 }}>{sc.objects}·{sc.duration}s</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sec('props', 'PROPS', null, (
              <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:5px')}>
                {Object.entries(PROPS).map(([id, p]) =>
                  <button key={id} onClick={() => this.addProp(id)}
                    style={sx('font-size:10.5px;border:1px solid var(--border);background:var(--surface);color:var(--fg-soft);border-radius:7px;padding:6px 4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>+ {p.name}</button>)}
              </div>
            ))}
            {sec('gen', 'STILL → 3D', S.genObjects.length || null, (
              <div>
                {input({ placeholder: 'https://… image url', value: S.genUrl, onChange: e => this.setState({ genUrl: e.target.value }) })}
                <div style={sx('margin-top:6px')}>
                  {input({ placeholder: 'name (hero, prop car…)', value: S.genName, onChange: e => this.setState({ genName: e.target.value }) })}
                </div>
                <div style={sx('margin-top:8px')}>
                  {btn(S.genBusy ? 'Converting…' : '⧉ Generate mesh', () => this.generate3d(), { accent: true, disabled: S.genBusy || !S.genUrl.trim() })}
                </div>
                {S.genObjects.length > 0 && (
                  <div style={sx('margin-top:9px;display:flex;flex-direction:column;gap:3px')}>
                    {S.genObjects.map(o => (
                      <div key={o.id} style={sx('display:flex;align-items:center;gap:6px;font-size:11px;color:var(--fg-muted);padding:4px 7px;border-radius:6px;background:var(--surface)')}>
                        <span onClick={() => this.addGlb(o.glbUrl, o.name)} className="hFgL" style={sx('cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>+ {o.name}</span>
                        <span onClick={() => fetch('/api/threed/objects/' + o.id, { method: 'DELETE' }).then(() => this.refreshGen())}
                          style={sx('cursor:pointer;color:var(--fg-faint);font-size:9px')}>✕</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sec('stage', 'ON STAGE', S.objects.length, (
              <div style={sx('display:flex;flex-direction:column;gap:3px')}>
                {S.objects.map(o => (
                  <div key={o.key} onClick={() => this.select(o.key)}
                    style={{
                      ...sx('display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;padding:4px 7px;border-radius:6px'),
                      background: o.key === S.selected ? 'var(--raise)' : 'var(--surface)',
                      color: o.key === S.selected ? 'var(--fg)' : 'var(--fg-muted)',
                      border: '1px solid ' + (o.key === S.selected ? ACCENT + '55' : 'transparent')
                    }}>
                    <span style={sx('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{o.name}</span>
                    {o.keyframes.length > 0 && <span style={{ ...sx('color:#5B9DFF;flex:none'), fontFamily: MONO, fontSize: 9 }}>{o.keyframes.length}k</span>}
                    <span onClick={e => { e.stopPropagation(); this.removeObject(o.key); }} style={sx('color:var(--fg-faint);font-size:9px;flex:none')}>✕</span>
                  </div>
                ))}
                {!S.objects.length && <div style={{ ...sx('color:var(--fg-muted);letter-spacing:.06em'), fontFamily: MONO, fontSize: 9.5 }}>EMPTY — ADD A PROP OR CONVERT A STILL</div>}
              </div>
            ))}
          </aside>
        )}
      </div>
    );
  }
}
