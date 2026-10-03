// Three.js rendering. Reads a "view" (the Sim on host/offline, a ClientView online)
// and never changes game state.
import * as THREE from '../vendor/three.module.min.js';
import { CHARACTERS, TEAM_COLORS, WEAPONS, GAME } from './config.js';
import { lookDir, entityHeight } from './physics.js';

const SKIN = 0xe8c39e;
const DARK = 0x2b2f38;
const METAL = 0xb8c0c8;
const ORANGE = 0xe69a2e;

const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w},${h},${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
const matCache = new Map();
function lambert(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c.getHex();
}

function mesh(geo, color, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? lambert(color) : color);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}
const bx = (w, h, d, color, x, y, z) => mesh(boxGeo(w, h, d), color, x, y, z);

// ---------- Weapon models: built pointing forward (-z) from the hand ----------
export function buildWeapon(id) {
  const g = new THREE.Group();
  switch (id) {
    case 'machete':
      g.add(bx(0.05, 0.05, 0.16, 0x4a2f1b, 0, 0, 0));
      g.add(bx(0.11, 0.02, 0.06, 0x333333, 0, 0, -0.09));
      g.add(bx(0.09, 0.015, 0.6, 0xd8dde3, 0, 0.01, -0.42));
      break;
    case 'dagger':
      g.add(bx(0.04, 0.04, 0.12, 0x3a2a1a, 0, 0, 0));
      g.add(bx(0.09, 0.02, 0.03, 0x999999, 0, 0, -0.07));
      g.add(bx(0.04, 0.012, 0.26, 0xe2e6ea, 0, 0, -0.21));
      break;
    case 'wrench':
      g.add(bx(0.06, 0.06, 0.65, 0x8a929c, 0, 0, -0.25));
      g.add(bx(0.22, 0.07, 0.08, 0x8a929c, 0, 0, -0.6));
      g.add(bx(0.06, 0.07, 0.16, 0x8a929c, -0.08, 0, -0.7));
      g.add(bx(0.06, 0.07, 0.16, 0x8a929c, 0.08, 0, -0.7));
      g.add(bx(0.07, 0.07, 0.2, 0xc0392b, 0, 0, 0.02));
      break;
    case 'axe':
      g.add(bx(0.05, 0.05, 0.7, 0x6b4423, 0, 0, -0.25));
      g.add(bx(0.03, 0.26, 0.2, 0xd8dde3, 0, 0.08, -0.55));
      g.add(bx(0.035, 0.06, 0.2, 0x37d67a, 0, 0.22, -0.55));
      break;
    case 'knife':
      g.add(bx(0.035, 0.035, 0.1, 0x111111, 0, 0, 0));
      g.add(bx(0.03, 0.01, 0.22, 0xeef2f5, 0, 0, -0.16));
      break;
    case 'nailgun':
      g.add(bx(0.09, 0.14, 0.34, 0x5a6470, 0, 0.02, -0.12));
      g.add(bx(0.05, 0.05, 0.3, 0x2b2f38, 0, 0.06, -0.42));
      g.add(bx(0.07, 0.16, 0.08, 0x3b4a6b, 0, -0.1, 0));
      g.add(bx(0.06, 0.08, 0.14, 0xc8a000, 0, -0.08, -0.18));
      g.add(bx(0.1, 0.03, 0.2, 0xff8c1a, 0, 0.1, -0.12));
      break;
    default:
      break; // fists, kick: no model
  }
  return g;
}

// ---------- Character models (feet at origin, facing -z) ----------
function limb(w, h, d, color, x, y, z) {
  // A pivot group at the joint with the limb hanging down from it
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.add(bx(w, h, d, color, 0, -h / 2, 0));
  return pivot;
}

export function buildCharacter(char, team) {
  const tc = TEAM_COLORS[team];
  const tdark = shade(tc, 0.7);
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything that bobs / tilts
  root.add(body);
  const P = { root, body };

  if (char === 'longman') {
    P.legL = limb(0.16, 0.95, 0.18, DARK, -0.11, 0.95, 0);
    P.legR = limb(0.16, 0.95, 0.18, DARK, 0.11, 0.95, 0);
    body.add(P.legL, P.legR);
    body.add(bx(0.5, 0.85, 0.3, tc, 0, 1.35, 0));
    body.add(bx(0.52, 0.32, 0.32, tdark, 0, 0.86, 0));
    body.add(bx(0.12, 0.6, 0.02, 0xf4f1e8, 0, 1.45, -0.16));
    body.add(bx(0.28, 0.3, 0.28, SKIN, 0, 1.92, 0));
    body.add(bx(0.3, 0.05, 0.05, 0x111111, 0, 1.96, -0.14));
    body.add(bx(0.42, 0.03, 0.42, 0x1a1a1a, 0, 2.08, 0));
    body.add(bx(0.26, 0.3, 0.26, 0x1a1a1a, 0, 2.24, 0));
    body.add(bx(0.27, 0.05, 0.27, tc, 0, 2.12, 0));
    P.armL = limb(0.12, 0.78, 0.12, tc, -0.32, 1.74, 0);
    P.armR = limb(0.12, 0.78, 0.12, tc, 0.32, 1.74, 0);
    body.add(P.armL, P.armR);
    const torch = bx(0.07, 0.07, 0.2, 0x333333, 0, -0.74, -0.08);
    torch.add(bx(0.09, 0.09, 0.04, 0xfff3b0, 0, 0, -0.1));
    P.armL.add(torch);
  } else if (char === 'builder') {
    P.legL = limb(0.24, 0.6, 0.26, 0x3b4a6b, -0.2, 0.6, 0);
    P.legR = limb(0.24, 0.6, 0.26, 0x3b4a6b, 0.2, 0.6, 0);
    body.add(P.legL, P.legR);
    body.add(bx(0.9, 0.62, 0.52, tc, 0, 0.92, 0));
    body.add(bx(0.92, 0.1, 0.54, 0x5a3a1e, 0, 0.66, 0));
    body.add(bx(0.4, 0.3, 0.02, tdark, 0, 0.95, -0.27));
    body.add(bx(0.36, 0.34, 0.34, SKIN, 0, 1.4, 0));
    body.add(bx(0.3, 0.08, 0.02, 0x4a2f1b, 0, 1.3, -0.18));
    body.add(bx(0.44, 0.14, 0.44, 0xff8c1a, 0, 1.6, 0));
    body.add(bx(0.5, 0.03, 0.56, 0xff8c1a, 0, 1.54, -0.03));
    P.armL = limb(0.2, 0.62, 0.2, tc, -0.56, 1.18, 0);
    P.armR = limb(0.2, 0.62, 0.2, tc, 0.56, 1.18, 0);
    body.add(P.armL, P.armR);
  } else if (char === 'doctor') {
    // One bird leg
    const leg = new THREE.Group();
    leg.position.set(0, 0.92, 0);
    const thigh = bx(0.1, 0.48, 0.1, ORANGE, 0, -0.22, 0.06);
    thigh.rotation.x = -0.35;
    leg.add(thigh);
    const shin = bx(0.07, 0.5, 0.07, ORANGE, 0, -0.66, 0.08);
    shin.rotation.x = 0.3;
    leg.add(shin);
    for (const a of [-0.5, 0, 0.5]) {
      const toe = bx(0.04, 0.03, 0.22, ORANGE, Math.sin(a) * 0.08, -0.9, -0.1);
      toe.rotation.y = a;
      leg.add(toe);
    }
    P.legR = leg;
    body.add(leg);
    body.add(bx(0.58, 0.62, 0.46, METAL, 0, 1.2, 0));
    body.add(bx(0.6, 0.12, 0.48, tc, 0, 1.46, 0));
    body.add(bx(0.26, 0.26, 0.02, 0xffffff, 0, 1.18, -0.24));
    body.add(bx(0.06, 0.18, 0.025, 0xe03030, 0, 1.18, -0.25));
    body.add(bx(0.18, 0.06, 0.025, 0xe03030, 0, 1.18, -0.25));
    body.add(bx(0.22, 0.12, 0.22, 0x555c66, 0, 0.86, 0));
    body.add(bx(0.42, 0.32, 0.38, METAL, 0, 1.68, 0));
    body.add(bx(0.36, 0.1, 0.02, 0x22e0ff, 0, 1.7, -0.2));
    body.add(bx(0.03, 0.2, 0.03, 0x555c66, 0.12, 1.92, 0));
    body.add(bx(0.07, 0.07, 0.07, tc, 0.12, 2.03, 0));
    P.armL = limb(0.1, 0.56, 0.1, METAL, -0.36, 1.45, 0);
    P.armR = limb(0.1, 0.56, 0.1, METAL, 0.36, 1.45, 0);
    body.add(P.armL, P.armR);
  } else {
    // Spy: small and slim, fedora and mask
    P.legL = limb(0.13, 0.66, 0.14, 0x22222a, -0.09, 0.66, 0);
    P.legR = limb(0.13, 0.66, 0.14, 0x22222a, 0.09, 0.66, 0);
    body.add(P.legL, P.legR);
    body.add(bx(0.36, 0.5, 0.22, tc, 0, 0.92, 0));
    body.add(bx(0.06, 0.32, 0.02, 0x22222a, 0, 0.98, -0.12));
    body.add(bx(0.24, 0.26, 0.24, 0x22222a, 0, 1.3, 0));
    body.add(bx(0.2, 0.05, 0.02, 0xffffff, 0, 1.33, -0.125));
    body.add(bx(0.4, 0.02, 0.4, 0x2b2b2b, 0, 1.45, 0));
    body.add(bx(0.24, 0.14, 0.24, 0x2b2b2b, 0, 1.53, 0));
    body.add(bx(0.25, 0.04, 0.25, tc, 0, 1.48, 0));
    P.armL = limb(0.09, 0.5, 0.09, tc, -0.23, 1.15, 0);
    P.armR = limb(0.09, 0.5, 0.09, tc, 0.23, 1.15, 0);
    body.add(P.armL, P.armR);
  }
  // Weapon holder at the right hand
  P.hand = new THREE.Group();
  const armLen = { longman: 0.78, builder: 0.62, doctor: 0.56, spy: 0.5 }[char];
  P.hand.position.set(0, -armLen + 0.05, 0);
  P.armR.add(P.hand);
  return P;
}

// ---------- Text / heart sprites ----------
function makeLabelSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 80;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.6, 0.5, 1);
  s.renderOrder = 10;
  return { sprite: s, canvas, tex, key: '' };
}

function drawLabel(L, name, hearts, max, team, showName) {
  const key = `${name}|${hearts}|${max}|${team}|${showName}`;
  if (L.key === key) return;
  L.key = key;
  const c = L.canvas.getContext('2d');
  c.clearRect(0, 0, 256, 80);
  c.textAlign = 'center';
  if (showName) {
    c.font = 'bold 22px system-ui, sans-serif';
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.strokeText(name, 128, 26);
    c.fillStyle = team === 'yellow' ? '#ffe066' : '#6ff2e8';
    c.fillText(name, 128, 26);
  }
  const size = 26;
  const total = max * size;
  c.font = `${size}px system-ui, sans-serif`;
  for (let i = 0; i < max; i++) {
    const x = 128 - total / 2 + i * size + size / 2;
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.strokeText('♥', x, 66);
    c.fillStyle = i < hearts ? '#ff3b4e' : 'rgba(60,60,60,0.8)';
    c.fillText('♥', x, 66);
  }
  L.tex.needsUpdate = true;
}

function textSprite(text, color, size = 48) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const c = canvas.getContext('2d');
  c.font = `bold ${size}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 6;
  c.strokeStyle = 'rgba(0,0,0,0.75)';
  c.strokeText(text, 64, 32);
  c.fillStyle = color;
  c.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(0.9, 0.45, 1);
  s.renderOrder = 11;
  return s;
}

// ---------- Renderer ----------
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fd6f5);
    this.scene.fog = new THREE.Fog(0x9fd6f5, 45, 120);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x7a6a50, 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(18, 40, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -36; sc.right = 36; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 100;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.models = new Map();
    this.towerMeshes = new Map();
    this.projMeshes = new Map();
    this.particles = [];
    this.buildPreview = null;

    // Flashlight pool: fixed count so materials never recompile
    this.spots = [];
    const coneLen = CHARACTERS.longman.flashlightRange;
    const coneR = Math.tan(CHARACTERS.longman.flashlightAngle * Math.PI / 180) * coneLen;
    const coneGeo = new THREE.ConeGeometry(coneR, coneLen, 24, 1, true);
    coneGeo.translate(0, -coneLen / 2, 0);
    coneGeo.rotateX(Math.PI / 2); // apex at origin, opening toward -z (forward)
    for (let i = 0; i < 5; i++) {
      const light = new THREE.SpotLight(0xfff1c8, 0, coneLen * 1.4, CHARACTERS.longman.flashlightAngle * Math.PI / 180 * 1.15, 0.35, 1.2);
      this.scene.add(light);
      this.scene.add(light.target);
      const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
        color: 0xfff1c8, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      cone.visible = false;
      this.scene.add(cone);
      this.spots.push({ light, cone });
    }

    // First-person viewmodel
    this.vm = new THREE.Group();
    this.camera.add(this.vm);
    this.vmKey = '';
    this.vmSwingT = 9;
    this.vmAnim = 'swing';
    this.vmBob = 0;
    this.vmAttackSeq = -1;

    this.ghostMats = {
      yellow: new THREE.MeshBasicMaterial({ color: TEAM_COLORS.yellow, transparent: true, opacity: 0.22, depthWrite: false }),
      teal: new THREE.MeshBasicMaterial({ color: TEAM_COLORS.teal, transparent: true, opacity: 0.22, depthWrite: false }),
    };
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildMap(map) {
    // Floor made of flat-colored tiles (vertex colors) so motion is easy to read
    const tiles = [];
    const pos = [], col = [], idx = [];
    const S = 2;
    let v = 0;
    for (let x = -30; x < 30; x += S) {
      for (let z = -20; z < 20; z += S) {
        let base = ((x / S + z / S) & 1) ? 0x9bbf7a : 0x93b873;
        if (x < -22) base = ((x / S + z / S) & 1) ? 0xd9c784 : 0xd2bf7a;
        if (x >= 22) base = ((x / S + z / S) & 1) ? 0x86c9bf : 0x7ec2b8;
        if (Math.abs(z) > 13 && x >= -22 && x < 22) base = ((x / S + z / S) & 1) ? 0xb3aa98 : 0xaba290;
        const c = new THREE.Color(base);
        pos.push(x, 0, z, x + S, 0, z, x + S, 0, z + S, x, 0, z + S);
        for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
        idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
        v += 4;
      }
    }
    void tiles;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    fg.setIndex(idx);
    fg.computeVertexNormals();
    const floor = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Center line
    const line = bx(0.15, 0.02, 40, 0xf5f5f0, 0, 0.01, 0);
    line.castShadow = false;
    this.scene.add(line);
    // Ground beyond the walls
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), lambert(0x7fa463));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    this.scene.add(outer);

    for (const b of map.boxes) {
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
      const m = mesh(boxGeo(w, h, d), b.color, (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      m.receiveShadow = true;
      this.scene.add(m);
      // Darker top edge trim for readability
      if (h > 0.4 && w > 0.3 && d > 0.3) {
        const trim = mesh(boxGeo(w + 0.02, 0.06, d + 0.02), shade(b.color, 0.75), m.position.x, b.max[1] - 0.03, m.position.z, false);
        this.scene.add(trim);
      }
    }
    for (const dcr of map.decor) {
      const w = dcr.max[0] - dcr.min[0], h = dcr.max[1] - dcr.min[1], d = dcr.max[2] - dcr.min[2];
      if (dcr.kind === 'banner') {
        const m = mesh(boxGeo(Math.max(w, 0.05), h, d), TEAM_COLORS[dcr.team], (dcr.min[0] + dcr.max[0]) / 2, (dcr.min[1] + dcr.max[1]) / 2, (dcr.min[2] + dcr.max[2]) / 2, false);
        this.scene.add(m);
      }
    }
    // Some distant hills for a sense of place
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 90 + (i % 3) * 15;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(18 + (i % 4) * 6, 12, 8), lambert(0x86ad6a));
      hill.position.set(Math.cos(a) * r, -6, Math.sin(a) * r);
      hill.scale.y = 0.6;
      this.scene.add(hill);
    }
  }

  // ---------- Per-frame ----------

  render(view, opts, dt) {
    // opts: { localId, viewerTeam, camera: {x,y,z,yaw,pitch}, firstPerson: bool, time }
    const cam = this.camera;
    cam.position.set(opts.camera.x, opts.camera.y, opts.camera.z);
    cam.rotation.set(opts.camera.pitch, opts.camera.yaw, 0);

    this.updateCharacters(view, opts, dt);
    this.updateTowers(view, dt);
    this.updateProjectiles(view, dt);
    this.updateFlashlights(view, opts);
    this.updateViewmodel(view, opts, dt);
    this.updateParticles(dt);
    this.gl.render(this.scene, cam);
  }

  setMode(m, mode, team) {
    const key = mode + team;
    if (m.modeKey === key) return;
    m.modeKey = key;
    m.parts.root.visible = mode !== 'hidden';
    m.parts.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.orig) o.userData.orig = o.material;
      o.material = mode === 'ghost' ? this.ghostMats[team] : mode === 'glow' ? this.glowMat : o.userData.orig;
      o.castShadow = mode === 'normal';
    });
  }

  updateCharacters(view, opts, dt) {
    const seen = new Set();
    for (const e of view.entities) {
      const isLocal = e.id === opts.localId;
      const showDead = !e.alive && e.deathAt !== undefined && opts.time - e.deathAt < 4 && e.char;
      if (!e.alive && !showDead) continue;
      if (view.phase === 'pick' || view.phase === 'lobby') continue;
      seen.add(e.id);
      let m = this.models.get(e.id);
      if (!m || m.char !== e.char || m.team !== e.team) {
        if (m) this.removeModel(m);
        m = this.createModel(e);
        this.models.set(e.id, m);
      }
      const P = m.parts;
      // Visibility mode for the viewer
      let mode = 'normal';
      if (isLocal && opts.firstPerson) mode = 'hidden';
      else if (e.char === 'spy' && e.alive) {
        if (e.team === opts.viewerTeam) mode = 'ghost';
        else mode = e.revealed ? 'glow' : 'hidden';
      }
      this.setMode(m, mode, e.team);
      if (mode === 'glow') this.glowMat.opacity = 0.35 + Math.sin(opts.time * 18) * 0.15;

      P.root.position.set(e.pos.x, e.pos.y, e.pos.z);
      P.root.rotation.y = e.yaw;
      // Walk animation from horizontal movement
      const dx = e.pos.x - (m.lastX ?? e.pos.x), dz = e.pos.z - (m.lastZ ?? e.pos.z);
      m.lastX = e.pos.x; m.lastZ = e.pos.z;
      const speed = dt > 0 ? Math.min(10, Math.hypot(dx, dz) / dt) : 0;
      m.speed += (speed - m.speed) * Math.min(1, dt * 10);
      m.walk += m.speed * dt * 2.6;
      const sw = Math.sin(m.walk) * Math.min(1, m.speed / 3) * 0.7;
      if (P.legL) P.legL.rotation.x = sw;
      if (P.legR && e.char !== 'doctor') P.legR.rotation.x = -sw;
      if (e.char === 'doctor') P.legR.rotation.x = e.onGround ? 0 : -0.35;
      if (P.armL) P.armL.rotation.x = e.climbing ? 2.6 - Math.sin(opts.time * 10) * 0.3 : -sw * 0.6;
      if (e.char === 'longman' && e.flashlight && P.armL) P.armL.rotation.x = 1.4 + e.pitch;
      // Footsteps (spies are quiet but audible)
      if (e.alive && e.onGround && m.speed > 1 && !isLocal) {
        m.stepAcc += m.speed * dt;
        if (m.stepAcc > 1.6) { m.stepAcc = 0; this.onStep && this.onStep(e); }
      }

      // Weapon model in hand
      const w = e.weapon || '';
      if (m.weaponId !== w) {
        P.hand.clear();
        const wm = buildWeapon(w);
        wm.rotation.x = 0;
        P.hand.add(wm);
        m.weaponId = w;
        m.modeKey = '';
      }
      // Attack animation
      if (e.attackSeq !== m.attackSeq) {
        if (m.attackSeq !== undefined) m.swingT = 0;
        m.attackSeq = e.attackSeq;
        m.anim = (WEAPONS[w] || {}).anim || 'swing';
      }
      m.swingT += dt;
      const st = Math.min(1, m.swingT / 0.3);
      // Positive x rotation swings a hanging limb forward
      const gun = w === 'nailgun';
      let armR = (gun ? 1.45 : 0.9) + e.pitch * 0.8; // hold weapon forward
      let spin = 0;
      if (m.swingT < 0.3) {
        if (m.anim === 'swing') armR = 2.8 - st * 2.6;
        else if (m.anim === 'stab' || m.anim === 'punch') armR = 1.5 + Math.sin(st * Math.PI) * 0.2;
        else if (m.anim === 'spin') { armR = 1.6; spin = st * Math.PI * 2; }
        else if (m.anim === 'kick' && P.legR) P.legR.rotation.x = Math.sin(st * Math.PI) * 1.4;
        else if (m.anim === 'shoot') armR += Math.sin(st * Math.PI) * 0.3;
      }
      if (e.climbing) armR = 2.6 + Math.sin(opts.time * 10) * 0.3;
      P.armR.rotation.x = armR;
      // Point the gun straight along the arm's forward direction
      P.hand.rotation.x = gun ? Math.PI / 2 - armR : -0.4;
      P.body.rotation.y = spin;
      P.body.scale.y = e.crouch ? 0.72 : 1;

      // Death: tip over and sink
      if (!e.alive) {
        const t = Math.min(1, (opts.time - e.deathAt) / 0.5);
        P.body.rotation.x = -t * Math.PI / 2;
        P.root.position.y = e.pos.y - Math.max(0, (opts.time - e.deathAt - 2.5) * 0.5);
      } else {
        P.body.rotation.x = 0;
      }

      // Floating name + hearts
      const showLabel = e.alive && mode !== 'hidden' && !(isLocal && opts.firstPerson);
      m.label.sprite.visible = showLabel;
      if (showLabel) {
        drawLabel(m.label, e.name, e.hearts, e.maxHearts, e.team, e.team === opts.viewerTeam);
        m.label.sprite.position.set(e.pos.x, e.pos.y + CHARACTERS[e.char].height * (e.crouch ? 0.75 : 1) + 0.45, e.pos.z);
      }
    }
    for (const [id, m] of this.models) {
      if (!seen.has(id)) { this.removeModel(m); this.models.delete(id); }
    }
  }

  createModel(e) {
    const parts = buildCharacter(e.char, e.team);
    this.scene.add(parts.root);
    const label = makeLabelSprite();
    this.scene.add(label.sprite);
    return { parts, label, char: e.char, team: e.team, walk: 0, speed: 0, swingT: 9, stepAcc: 0, modeKey: '' };
  }

  removeModel(m) {
    this.scene.remove(m.parts.root);
    this.scene.remove(m.label.sprite);
  }

  updateTowers(view, dt) {
    const seen = new Set();
    for (const t of view.towers) {
      seen.add(t.id);
      let tm = this.towerMeshes.get(t.id);
      if (!tm) {
        tm = this.createTower(t);
        this.towerMeshes.set(t.id, tm);
        tm.grow = 0;
      }
      tm.grow = Math.min(1, tm.grow + dt * 4);
      tm.group.scale.y = tm.grow;
      tm.group.position.set(t.x, t.y, t.z);
      if (tm.hp !== t.hp) { tm.shake = 0.3; tm.hp = t.hp; }
      if (tm.shake > 0) {
        tm.shake -= dt;
        tm.group.position.x += (Math.random() - 0.5) * 0.08;
        tm.group.position.z += (Math.random() - 0.5) * 0.08;
      }
    }
    for (const [id, tm] of this.towerMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(tm.group);
        this.scene.remove(tm.ring);
        tm.ring.geometry.dispose();
        tm.ring.material.dispose();
        this.towerMeshes.delete(id);
      }
    }
  }

  createTower(t) {
    const g = new THREE.Group();
    const s = t.size, h = t.height;
    const core = bx(s * 0.86, h, s * 0.86, 0x8a5a2b, 0, h / 2, 0);
    core.receiveShadow = true;
    g.add(core);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(bx(0.14, h, 0.14, 0x5c3a1a, x * s / 2, h / 2, z * s / 2));
    // Ladder rungs on all sides: you can climb from anywhere
    for (let y = 0.3; y < h - 0.1; y += 0.45) {
      g.add(bx(s, 0.06, 0.06, 0xc49a5a, 0, y, -s / 2));
      g.add(bx(s, 0.06, 0.06, 0xc49a5a, 0, y, s / 2));
      g.add(bx(0.06, 0.06, s, 0xc49a5a, -s / 2, y, 0));
      g.add(bx(0.06, 0.06, s, 0xc49a5a, s / 2, y, 0));
    }
    const top = bx(s + 0.1, 0.12, s + 0.1, TEAM_COLORS[t.team], 0, h - 0.06, 0);
    top.receiveShadow = true;
    g.add(top);
    this.scene.add(g);
    // Ground ring marking the nail gun's blind spot: enemies inside it are safe from nails
    const r = CHARACTERS.builder.nailMinRange;
    const rg = new THREE.RingGeometry(r - 0.15, r, 64);
    rg.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: TEAM_COLORS[t.team], transparent: true, opacity: 0.55, depthWrite: false }));
    ring.position.set(t.x, t.y + 0.03, t.z);
    this.scene.add(ring);
    return { group: g, ring, hp: t.hp, shake: 0 };
  }

  updateProjectiles(view, dt) {
    const seen = new Set();
    for (const p of view.projectiles) {
      seen.add(p.id);
      let pm = this.projMeshes.get(p.id);
      if (!pm && p.type === 'nail') {
        const g = new THREE.Group();
        g.add(mesh(boxGeo(0.035, 0.035, 0.34), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }), 0, 0, 0, false));
        g.add(mesh(boxGeo(0.08, 0.08, 0.03), new THREE.MeshBasicMaterial({ color: 0x8a929c }), 0, 0, -0.17, false));
        this.scene.add(g);
        pm = { group: g, nail: true };
        this.projMeshes.set(p.id, pm);
      }
      if (!pm) {
        const g = new THREE.Group();
        const glass = new THREE.MeshLambertMaterial({ color: 0x47e08a, transparent: true, opacity: 0.85, emissive: 0x115522 });
        g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 10), glass, 0, 0, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.12, 8), glass, 0, 0.16, 0));
        g.add(mesh(boxGeo(0.05, 0.04, 0.05), 0x8a5a2b, 0, 0.24, 0));
        this.scene.add(g);
        pm = { group: g };
        this.projMeshes.set(p.id, pm);
      }
      pm.group.position.set(p.x, p.y, p.z);
      if (pm.nail) {
        pm.group.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      } else {
        pm.group.rotation.x += dt * 10;
        pm.group.rotation.z += dt * 4;
      }
    }
    for (const [id, pm] of this.projMeshes) {
      if (!seen.has(id)) { this.scene.remove(pm.group); this.projMeshes.delete(id); }
    }
  }

  updateFlashlights(view, opts) {
    let i = 0;
    for (const e of view.entities) {
      if (i >= this.spots.length) break;
      if (!e.alive || !e.flashlight || view.phase === 'pick') continue;
      const S = this.spots[i++];
      const def = CHARACTERS[e.char];
      const eyeY = e.pos.y + def.eye * (e.crouch ? GAME.crouchHeightScale : 1);
      const d = lookDir(e.yaw, e.pitch);
      const isLocalFP = e.id === opts.localId && opts.firstPerson;
      const ox = e.pos.x + (isLocalFP ? 0 : d.x * 0.3), oz = e.pos.z + (isLocalFP ? 0 : d.z * 0.3);
      S.light.intensity = 40;
      S.light.position.set(ox, eyeY - 0.15, oz);
      S.light.target.position.set(ox + d.x * 10, eyeY - 0.15 + d.y * 10, oz + d.z * 10);
      S.cone.visible = !isLocalFP;
      S.cone.position.set(ox, eyeY - 0.15, oz);
      S.cone.rotation.set(e.pitch, e.yaw, 0, 'YXZ');
    }
    for (; i < this.spots.length; i++) {
      this.spots[i].light.intensity = 0;
      this.spots[i].cone.visible = false;
    }
  }

  updateViewmodel(view, opts, dt) {
    const e = view.entities.find((x) => x.id === opts.localId);
    const show = e && e.alive && opts.firstPerson && view.phase !== 'pick';
    this.vm.visible = !!show;
    if (this.buildPreview) this.buildPreview.visible = false;
    if (!show) return;
    const key = `${e.char}|${e.weapon}|${e.team}`;
    if (key !== this.vmKey) {
      this.vmKey = key;
      this.vm.clear();
      const pivot = new THREE.Group();
      pivot.scale.setScalar(0.55);
      const holder = new THREE.Group();
      holder.position.set(0.32, -0.32, -0.5);
      pivot.add(holder);
      const def = CHARACTERS[e.char];
      const sleeve = { longman: TEAM_COLORS[e.team], builder: TEAM_COLORS[e.team], doctor: METAL, spy: TEAM_COLORS[e.team] }[e.char];
      holder.add(bx(0.1, 0.1, 0.35, sleeve, 0, -0.03, 0.2));
      holder.add(bx(0.09, 0.09, 0.09, e.char === 'doctor' ? METAL : SKIN, 0, 0, 0));
      const w = buildWeapon(e.weapon);
      w.position.set(0, 0.02, -0.02);
      w.rotation.x = e.weapon === 'nailgun' ? 0 : 0.25;
      holder.add(w);
      if (e.weapon === 'kick') {
        const leg = bx(0.07, 0.07, 0.6, ORANGE, -0.1, -0.15, -0.2);
        leg.visible = false;
        holder.add(leg);
        this.vmLeg = leg;
      } else this.vmLeg = null;
      if (e.char === 'longman') {
        const lh = new THREE.Group();
        lh.position.set(-0.34, -0.34, -0.45);
        lh.add(bx(0.09, 0.09, 0.09, SKIN, 0, 0, 0));
        lh.add(bx(0.07, 0.07, 0.22, 0x333333, 0, 0.02, -0.1));
        lh.add(bx(0.09, 0.09, 0.03, 0xfff3b0, 0, 0.02, -0.22));
        pivot.add(lh);
        this.vmTorch = lh;
      } else this.vmTorch = null;
      void def;
      this.vm.add(pivot);
      this.vmPivot = pivot;
      this.vmHolder = holder;
      // Spy sees his own hands faintly
      const spy = e.char === 'spy';
      pivot.traverse((o) => {
        if (!o.isMesh) return;
        if (spy) o.material = new THREE.MeshBasicMaterial({ color: o.material.color, transparent: true, opacity: 0.35, depthWrite: false });
        o.castShadow = false;
      });
    }
    if (e.attackSeq !== this.vmAttackSeq) {
      if (this.vmAttackSeq !== -1) this.vmSwingT = 0;
      this.vmAttackSeq = e.attackSeq;
      this.vmAnim = (WEAPONS[e.weapon] || {}).anim || 'swing';
    }
    this.vmSwingT += dt;
    const speed = Math.hypot(e.vel.x, e.vel.z);
    if (e.onGround) this.vmBob += dt * speed * 1.6;
    const bob = Math.sin(this.vmBob) * 0.015 * Math.min(1, speed / 3);
    const H = this.vmHolder, Pv = this.vmPivot;
    if (e.weapon === 'nailgun') H.position.set(0.42, -0.42 + bob, -0.55);
    else H.position.set(0.32, -0.32 + bob, -0.5);
    H.rotation.set(0, 0, 0);
    Pv.rotation.set(0, 0, 0);
    if (this.vmLeg) this.vmLeg.visible = false;
    const T = 0.28;
    if (this.vmSwingT < T) {
      const t = this.vmSwingT / T;
      const s = Math.sin(t * Math.PI);
      switch (this.vmAnim) {
        case 'swing':
          // From raised (blade up) to a diagonal slash down and across
          H.rotation.x = 1.3 - t * 2.0;
          H.rotation.z = -0.4 + t * 0.9;
          H.position.x = 0.4 - t * 0.55;
          H.position.y = -0.12 - t * 0.25;
          break;
        case 'stab':
        case 'punch':
          H.position.z = -0.5 - s * 0.35;
          H.position.x = 0.32 - s * 0.12;
          break;
        case 'spin':
          Pv.rotation.y = Math.PI * 0.8 - t * Math.PI * 1.6;
          H.position.set(0.0, -0.25, -0.75);
          H.rotation.y = Math.PI / 2;
          break;
        case 'shoot':
          H.position.z = -0.5 + s * 0.12;
          H.rotation.x = s * 0.3;
          break;
        case 'kick':
          if (this.vmLeg) { this.vmLeg.visible = true; this.vmLeg.position.z = -0.2 - s * 0.4; this.vmLeg.position.y = -0.3 + s * 0.15; }
          break;
      }
    }
    if (e.buildT > 0) { H.position.y -= 0.15; H.rotation.x = Math.sin(opts.time * 20) * 0.3; }
    if (this.vmTorch) this.vmTorch.visible = e.flashlight;

    // Tower placement preview while building
    if (e.char === 'builder' && e.buildT > 0) {
      if (!this.buildPreview) {
        const d = CHARACTERS.builder;
        this.buildPreview = new THREE.Mesh(boxGeo(d.towerSize, d.towerHeight, d.towerSize),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
        this.scene.add(this.buildPreview);
      }
      const d = CHARACTERS.builder;
      const p = Math.min(1, e.buildT / d.buildTime);
      const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
      this.buildPreview.visible = true;
      this.buildPreview.scale.y = Math.max(0.05, p);
      this.buildPreview.position.set(e.pos.x + fx * 1.9, e.pos.y + d.towerHeight * p / 2, e.pos.z + fz * 1.9);
      this.buildPreview.material.color.setHex(TEAM_COLORS[e.team]);
    }
  }

  // ---------- Effects ----------

  ping(x, y, z, team, life = 2.5) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d');
    const col = team === 'yellow' ? '#ffd43b' : '#4ee6dc';
    c.lineWidth = 10;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.beginPath(); c.arc(64, 64, 50, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 6;
    c.strokeStyle = col;
    c.beginPath(); c.arc(64, 64, 50, 0, Math.PI * 2); c.stroke();
    c.font = 'bold 72px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.fillText('!', 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Constant on-screen size so a far-away ping is still easy to spot
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    sp.scale.set(0.1, 0.1, 1);
    sp.position.set(x, y + 2.2, z);
    sp.renderOrder = 20;
    this.scene.add(sp);
    this.particles.push({ obj: sp, vx: 0, vy: 0, vz: 0, life, max: life, gravity: 0, fade: true, sprite: true });
    this.ring(x, y, z, team === 'yellow' ? 0xffd43b : 0x4ee6dc, 3, Math.min(1.2, life));
  }

  spawnText(text, color, x, y, z) {
    const s = textSprite(text, color);
    s.position.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4);
    this.scene.add(s);
    this.particles.push({ obj: s, vx: 0, vy: 1.2, vz: 0, life: 1.0, max: 1.0, gravity: 0, fade: true, sprite: true });
  }

  burst(x, y, z, color, n = 10, speed = 3, size = 0.08, life = 0.7, gravity = -9) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(boxGeo(size, size, size), mat);
      m.position.set(x, y, z);
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      this.particles.push({ obj: m, vx: Math.cos(a) * r * speed, vy: Math.abs(u) * speed + 1, vz: Math.sin(a) * r * speed, life, max: life, gravity, fade: true, mat });
    }
  }

  ring(x, y, z, color, radius, life = 0.6) {
    const geo = new THREE.RingGeometry(0.2, 0.45, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + 0.05, z);
    this.scene.add(m);
    this.particles.push({ obj: m, vx: 0, vy: 0, vz: 0, life, max: life, gravity: 0, fade: true, mat, grow: radius / 0.45 });
  }

  debris(x, y, z, height, team) {
    const colors = [0x8a5a2b, 0x5c3a1a, 0xc49a5a, TEAM_COLORS[team]];
    for (let i = 0; i < 22; i++) {
      const s = 0.15 + Math.random() * 0.35;
      const mat = new THREE.MeshLambertMaterial({ color: colors[i % colors.length], transparent: true });
      const m = new THREE.Mesh(boxGeo(s, s * 0.6, s * 1.5), mat);
      m.position.set(x + (Math.random() - 0.5) * 1.2, y + Math.random() * height, z + (Math.random() - 0.5) * 1.2);
      m.castShadow = true;
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      this.particles.push({ obj: m, vx: Math.cos(a) * sp, vy: Math.random() * 4, vz: Math.sin(a) * sp, life: 1.6, max: 1.6, gravity: -14, fade: true, mat, spin: true, floor: y });
    }
    this.ring(x, y, z, 0xd9c7a0, CHARACTERS.builder.collapseRadius, 0.7);
  }

  updateParticles(dt) {
    const keep = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        if (p.sprite) { p.obj.material.map.dispose(); p.obj.material.dispose(); }
        else if (p.mat && p.grow) { p.obj.geometry.dispose(); p.mat.dispose(); }
        continue;
      }
      p.vy += p.gravity * dt;
      p.obj.position.x += p.vx * dt;
      p.obj.position.y += p.vy * dt;
      p.obj.position.z += p.vz * dt;
      const floor = p.floor ?? 0;
      if (p.obj.position.y < floor + 0.05 && p.gravity) { p.obj.position.y = floor + 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      if (p.spin) { p.obj.rotation.x += dt * 5; p.obj.rotation.y += dt * 3; }
      if (p.grow) { const s = 1 + (1 - p.life / p.max) * (p.grow - 1); p.obj.scale.set(s, 1, s); }
      const a = p.life / p.max;
      if (p.fade) {
        if (p.sprite) p.obj.material.opacity = Math.min(1, a * 2);
        else if (p.mat) p.mat.opacity = Math.min(1, a * 2);
      }
      keep.push(p);
    }
    this.particles = keep;
  }
}
