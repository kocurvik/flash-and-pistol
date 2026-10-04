// Mesh builders: materials, weapons, characters, towers, the arena and the sky.
// Everything is built from simple shapes (rounded boxes, capsules, extruded
// silhouettes) with flat colors. render.js places and animates these.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TEAM_COLORS } from './config.js';

export const SKIN = 0xe8c39e;
export const METAL = 0xc3cad2;
const DARK = 0x2b2f38;

// ---------- Materials ----------

const MAT = {
  cloth: { rough: 0.9 },
  skin: { rough: 0.65 },
  wood: { rough: 0.85 },
  stone: { rough: 0.92 },
  paint: { rough: 0.55 },
  plastic: { rough: 0.45 },
  rubber: { rough: 0.95 },
  metal: { rough: 0.35, metal: 0.75 },
  steel: { rough: 0.3, metal: 0.65 }, // polished but still bright under the sky
  glossy: { rough: 0.25 },
};

const matCache = new Map();
// Shared standard material. kind: a MAT preset name or { rough, metal }.
export function mat(color, kind = 'paint', emissive = 0, emissiveIntensity = 1) {
  const p = typeof kind === 'string' ? MAT[kind] : kind;
  const key = `${color}|${p.rough}|${p.metal || 0}|${emissive}|${emissiveIntensity}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: p.rough, metalness: p.metal || 0, emissive, emissiveIntensity,
    }));
  }
  return matCache.get(key);
}

export function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c.getHex();
}

// ---------- Geometry helpers ----------

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

export function boxGeo(w, h, d) { return cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)); }

export function rboxGeo(w, h, d, r) {
  const rr = r ?? Math.min(0.06, Math.min(w, h, d) * 0.25);
  return cached(`rb${w},${h},${d},${rr}`, () => new RoundedBoxGeometry(w, h, d, 2, rr));
}

function capsuleGeo(r, len) { return cached(`c${r},${len}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10)); }
function sphereGeo(r) { return cached(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12)); }
function cylGeo(rt, rb, h, seg = 18) { return cached(`cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)); }

export function part(geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

const rb = (w, h, d, color, kind, x, y, z, r) => part(rboxGeo(w, h, d, r), mat(color, kind), x, y, z);
const sph = (r, color, kind, x, y, z) => part(sphereGeo(r), mat(color, kind), x, y, z);
const cyl = (rt, rbot, h, color, kind, x, y, z) => part(cylGeo(rt, rbot, h), mat(color, kind), x, y, z);
// A cylinder lying along the z axis (handles, barrels)
function rod(r, color, kind, z0, z1, rEnd = r) {
  const m = part(cylGeo(rEnd, r, Math.abs(z1 - z0)), mat(color, kind), 0, 0, (z0 + z1) / 2);
  m.rotation.x = Math.PI / 2;
  return m;
}

// Flat silhouette extruded into a blade/plate. points are [forward, up] pairs;
// the result points along -z (forward) with its thickness along x.
function silhouette(points, thickness, bevel = 0.004) {
  const key = 'sil' + JSON.stringify(points) + thickness;
  return cached(key, () => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
    });
    g.translate(0, 0, -thickness / 2);
    g.rotateY(Math.PI / 2); // shape x (forward) -> -z, extrusion -> x
    g.computeVertexNormals();
    return g;
  });
}

// ---------- Weapons ----------
// Built from the hand (origin) pointing forward (-z). The cutting edge of
// chopping weapons faces -y: that's the side that leads a downward swing.

export function buildWeapon(id) {
  const g = new THREE.Group();
  switch (id) {
    case 'machete': {
      g.add(rod(0.022, 0x3b2616, 'wood', 0.08, -0.08));
      g.add(rb(0.05, 0.09, 0.025, 0x2b2b2b, 'metal', 0, -0.005, -0.09, 0.008));
      const blade = part(silhouette([[0.09, 0.022], [0.48, 0.03], [0.6, 0.022], [0.67, -0.01], [0.63, -0.055], [0.5, -0.065], [0.09, -0.038]], 0.01), mat(0xdfe5ea, 'steel'));
      g.add(blade);
      g.add(part(silhouette([[0.09, 0.022], [0.5, 0.03], [0.5, 0.012], [0.09, 0.006]], 0.0125, 0.002), mat(0x8c939b, 'metal')));
      break;
    }
    case 'dagger':
      g.add(rod(0.018, 0x3a2a1a, 'wood', 0.07, -0.05));
      g.add(sph(0.026, 0xb08d57, 'metal', 0, 0, 0.075));
      g.add(rb(0.025, 0.12, 0.025, 0xb08d57, 'metal', 0, 0, -0.055, 0.008));
      g.add(part(silhouette([[0.06, 0.02], [0.27, 0.012], [0.34, 0], [0.27, -0.012], [0.06, -0.02]], 0.008, 0.003), mat(0xe2e6ea, 'steel')));
      break;
    case 'knife':
      g.add(rod(0.016, 0x111111, 'rubber', 0.06, -0.05));
      g.add(rod(0.019, 0xd4af37, 'metal', -0.045, -0.06));
      g.add(part(silhouette([[0.05, 0.012], [0.24, 0.012], [0.3, 0], [0.22, -0.02], [0.05, -0.018]], 0.006, 0.002), mat(0xeef2f5, 'steel')));
      break;
    case 'axe': {
      // Long wooden handle with the head at the far end, bit pointing down
      g.add(rod(0.022, 0x7a4e2a, 'wood', 0.1, -0.64, 0.026));
      g.add(rod(0.03, 0x2e7d4f, 'rubber', 0.08, -0.06));
      const head = part(silhouette([
        [0.52, 0.06], [0.63, 0.06], [0.62, -0.06], [0.69, -0.18], [0.68, -0.25],
        [0.62, -0.275], [0.54, -0.28], [0.46, -0.265], [0.44, -0.2], [0.53, -0.06],
      ], 0.032), mat(0xd9dee3, 'steel'));
      g.add(head);
      // Green medical cross on both faces of the bit: it's a healing axe
      const cross = mat(0x2ee87a, 'plastic', 0x1fd16a, 1.6);
      for (const sx of [-1, 1]) {
        g.add(part(boxGeo(0.006, 0.09, 0.03), cross, sx * 0.021, -0.17, -0.565, false));
        g.add(part(boxGeo(0.006, 0.03, 0.09), cross, sx * 0.021, -0.17, -0.565, false));
      }
      break;
    }
    case 'wrench': {
      g.add(rod(0.032, 0xc0392b, 'rubber', 0.06, -0.16));
      const r = 0.1, cx = 0.62;
      const pts = [[-0.08, 0.026], [cx - 0.09, 0.026]];
      for (let a = 160; a >= 32; a -= 16) pts.push([cx + Math.cos(a * Math.PI / 180) * r, Math.sin(a * Math.PI / 180) * r]);
      pts.push([cx + 0.02, 0.034], [cx - 0.03, 0.034], [cx - 0.03, -0.034], [cx + 0.02, -0.034]);
      for (let a = -32; a >= -160; a -= 16) pts.push([cx + Math.cos(a * Math.PI / 180) * r, Math.sin(a * Math.PI / 180) * r]);
      pts.push([cx - 0.09, -0.026], [-0.08, -0.026]);
      g.add(part(silhouette(pts, 0.035, 0.006), mat(0x9aa3ad, 'metal')));
      break;
    }
    case 'nailgun': {
      g.add(rb(0.1, 0.15, 0.36, 0xf2b705, 'plastic', 0, 0.03, -0.13));
      g.add(rb(0.105, 0.05, 0.3, 0x2b2f38, 'rubber', 0, 0.1, -0.12));
      g.add(rod(0.026, 0x3a3f47, 'metal', -0.28, -0.52));
      g.add(rod(0.034, 0xf2b705, 'plastic', -0.5, -0.53));
      g.add(rb(0.07, 0.17, 0.09, 0x2b2f38, 'rubber', 0, -0.09, 0.0));
      const mag = rb(0.05, 0.08, 0.26, 0x8a929c, 'metal', 0, -0.06, -0.3);
      mag.rotation.x = -0.25;
      g.add(mag);
      break;
    }
    default:
      break; // fists, kick: no model
  }
  return g;
}

// ---------- Characters (feet at origin, facing -z) ----------

// A joint pivot with a capsule limb hanging down and an optional end piece
function limb(r, len, color, kind, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.add(part(capsuleGeo(r, len - 2 * r), mat(color, kind), 0, -len / 2, 0));
  return pivot;
}

function eyes(g, y, z, spread, size = 0.035, color = 0x1a1a1a) {
  for (const sx of [-1, 1]) g.add(rb(size, size * 1.2, 0.02, color, 'glossy', sx * spread, y, z, 0.006));
}

export function buildCharacter(char, team) {
  const tc = TEAM_COLORS[team];
  const tdark = shade(tc, 0.62);
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything that bobs / tilts / spins
  root.add(body);
  const P = { root, body };

  if (char === 'longman') {
    // Tall, thin, long coat and a top hat
    P.legL = limb(0.085, 0.95, 0x2f3440, 'cloth', -0.11, 0.95, 0);
    P.legR = limb(0.085, 0.95, 0x2f3440, 'cloth', 0.11, 0.95, 0);
    for (const L of [P.legL, P.legR]) L.add(rb(0.17, 0.1, 0.28, 0x3b2616, 'glossy', 0, -0.9, -0.05, 0.03));
    body.add(P.legL, P.legR);
    body.add(rb(0.5, 0.82, 0.3, tc, 'cloth', 0, 1.36, 0));
    body.add(rb(0.54, 0.4, 0.33, tdark, 'cloth', 0, 0.86, 0));
    body.add(rb(0.14, 0.62, 0.02, 0xf4f1e8, 'cloth', 0, 1.42, -0.155, 0.005));
    body.add(rb(0.05, 0.3, 0.025, 0x7a1d1d, 'cloth', 0, 1.55, -0.165, 0.005));
    body.add(rb(0.55, 0.06, 0.34, 0x2b1d12, 'glossy', 0, 1.0, 0, 0.02));
    body.add(rb(0.07, 0.05, 0.02, 0xd4af37, 'metal', 0, 1.0, -0.175, 0.008));
    body.add(rb(0.38, 0.1, 0.31, tdark, 'cloth', 0, 1.78, 0));
    body.add(cyl(0.07, 0.07, 0.1, SKIN, 'skin', 0, 1.8, 0));
    body.add(rb(0.28, 0.32, 0.28, SKIN, 'skin', 0, 1.95, 0));
    eyes(body, 1.98, -0.141, 0.065);
    body.add(rb(0.22, 0.035, 0.03, 0x3a2a1a, 'cloth', 0, 1.9, -0.145, 0.01));
    body.add(cyl(0.24, 0.24, 0.025, 0x161616, 'cloth', 0, 2.11, 0));
    body.add(cyl(0.15, 0.155, 0.32, 0x161616, 'cloth', 0, 2.28, 0));
    body.add(cyl(0.157, 0.157, 0.05, tc, 'cloth', 0, 2.15, 0));
    P.armL = limb(0.065, 0.78, tc, 'cloth', -0.32, 1.74, 0);
    P.armR = limb(0.065, 0.78, tc, 'cloth', 0.32, 1.74, 0);
    for (const A of [P.armL, P.armR]) A.add(sph(0.07, 0x3b2616, 'cloth', 0, -0.76, 0));
    body.add(P.armL, P.armR);
    // Flashlight in the left hand; its lens glows when switched on
    const torch = rod(0.035, 0x2b2f38, 'metal', 0.02, -0.18);
    torch.position.set(0, -0.76, -0.08);
    P.armL.add(torch);
    P.lensMat = new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xfff1c8, emissiveIntensity: 0 });
    P.armL.add(part(cylGeo(0.042, 0.042, 0.02), P.lensMat, 0, -0.76, -0.27, false));
    P.armL.children[P.armL.children.length - 1].rotation.x = Math.PI / 2;
  } else if (char === 'builder') {
    // Wide, overalls, hard hat
    const navy = 0x3b4a6b;
    P.legL = limb(0.11, 0.6, navy, 'cloth', -0.2, 0.6, 0);
    P.legR = limb(0.11, 0.6, navy, 'cloth', 0.2, 0.6, 0);
    for (const L of [P.legL, P.legR]) L.add(rb(0.23, 0.13, 0.33, 0x5a3a1e, 'rubber', 0, -0.55, -0.05, 0.04));
    body.add(P.legL, P.legR);
    body.add(rb(0.9, 0.62, 0.52, tc, 'cloth', 0, 0.94, 0, 0.1));
    body.add(rb(0.46, 0.36, 0.04, navy, 'cloth', 0, 0.9, -0.26, 0.015));
    for (const sx of [-1, 1]) body.add(rb(0.07, 0.36, 0.03, navy, 'cloth', sx * 0.18, 1.12, -0.26, 0.01));
    body.add(rb(0.94, 0.11, 0.56, 0x6b4423, 'wood', 0, 0.67, 0, 0.03));
    for (const sx of [-1, 1]) body.add(rb(0.13, 0.15, 0.1, 0x5a3a1e, 'cloth', sx * 0.32, 0.62, -0.27, 0.02));
    body.add(rb(0.36, 0.34, 0.34, SKIN, 'skin', 0, 1.4, 0, 0.06));
    eyes(body, 1.44, -0.171, 0.08);
    body.add(rb(0.3, 0.1, 0.04, 0x6b4423, 'cloth', 0, 1.29, -0.16, 0.02));
    const hat = part(new THREE.SphereGeometry(0.235, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xff8c1a, 'glossy'), 0, 1.55, 0);
    body.add(hat);
    body.add(cyl(0.29, 0.29, 0.03, 0xff8c1a, 'glossy', 0, 1.56, -0.02));
    body.add(rb(0.05, 0.2, 0.42, 0xffa94d, 'glossy', 0, 1.7, 0, 0.02));
    P.armL = limb(0.1, 0.62, tc, 'cloth', -0.56, 1.18, 0);
    P.armR = limb(0.1, 0.62, tc, 'cloth', 0.56, 1.18, 0);
    for (const A of [P.armL, P.armR]) A.add(sph(0.1, 0xd9a441, 'cloth', 0, -0.6, 0));
    body.add(P.armL, P.armR);
  } else if (char === 'doctor') {
    // Robot on two metal legs
    P.legL = limb(0.06, 0.88, 0x8a929c, 'metal', -0.12, 0.92, 0);
    P.legR = limb(0.06, 0.88, 0x8a929c, 'metal', 0.12, 0.92, 0);
    for (const L of [P.legL, P.legR]) {
      L.add(sph(0.07, 0x555c66, 'metal', 0, -0.45, 0));
      L.add(rb(0.15, 0.08, 0.26, 0x555c66, 'metal', 0, -0.88, -0.05, 0.03));
    }
    body.add(P.legL, P.legR);
    body.add(rb(0.26, 0.14, 0.26, 0x555c66, 'metal', 0, 0.88, 0));
    body.add(rb(0.58, 0.62, 0.46, METAL, 'metal', 0, 1.2, 0, 0.1));
    for (const sx of [-1, 1]) body.add(rb(0.18, 0.12, 0.42, tc, 'paint', sx * 0.3, 1.47, 0, 0.05));
    body.add(rb(0.28, 0.28, 0.03, 0xf7f7f7, 'plastic', 0, 1.2, -0.235, 0.03));
    const crossMat = mat(0xe03030, 'plastic', 0xff2020, 0.6);
    body.add(part(boxGeo(0.07, 0.2, 0.02), crossMat, 0, 1.2, -0.252, false));
    body.add(part(boxGeo(0.2, 0.07, 0.02), crossMat, 0, 1.2, -0.252, false));
    body.add(rb(0.42, 0.32, 0.38, METAL, 'metal', 0, 1.69, 0, 0.08));
    // Glowing visor and a doctor's head mirror
    body.add(part(rboxGeo(0.34, 0.09, 0.03, 0.02), mat(0x22e0ff, 'glossy', 0x22e0ff, 2.6), 0, 1.7, -0.19, false));
    const mirror = part(cylGeo(0.065, 0.065, 0.012), mat(0xe8eef3, 'steel'), 0, 1.83, -0.19);
    mirror.rotation.x = Math.PI / 2;
    body.add(mirror);
    body.add(cyl(0.012, 0.012, 0.2, 0x555c66, 'metal', 0.12, 1.94, 0));
    body.add(part(sphereGeo(0.035), mat(tc, 'glossy', tc, 2.2), 0.12, 2.05, 0, false));
    P.armL = limb(0.05, 0.56, METAL, 'metal', -0.36, 1.45, 0);
    P.armR = limb(0.05, 0.56, METAL, 'metal', 0.36, 1.45, 0);
    for (const A of [P.armL, P.armR]) A.add(sph(0.065, 0x3a3f47, 'metal', 0, -0.55, 0));
    body.add(P.armL, P.armR);
  } else {
    // Spy: small and slim, balaclava, fedora, suit and tie
    const suit = 0x22222a;
    P.legL = limb(0.065, 0.66, suit, 'cloth', -0.09, 0.66, 0);
    P.legR = limb(0.065, 0.66, suit, 'cloth', 0.09, 0.66, 0);
    for (const L of [P.legL, P.legR]) L.add(rb(0.13, 0.07, 0.24, 0x0d0d0d, 'glossy', 0, -0.63, -0.05, 0.03));
    body.add(P.legL, P.legR);
    body.add(rb(0.36, 0.5, 0.22, tc, 'cloth', 0, 0.92, 0, 0.06));
    body.add(part(new THREE.ConeGeometry(0.08, 0.2, 3), mat(0xf4f1e8, 'cloth'), 0, 1.06, -0.105));
    body.children[body.children.length - 1].rotation.set(Math.PI, 0, 0);
    body.add(rb(0.045, 0.26, 0.02, 0x7a1d1d, 'cloth', 0, 1.0, -0.118, 0.005));
    body.add(rb(0.24, 0.26, 0.24, 0x1d2033, 'cloth', 0, 1.3, 0, 0.06));
    for (const sx of [-1, 1]) body.add(rb(0.075, 0.05, 0.02, SKIN, 'skin', sx * 0.055, 1.33, -0.122, 0.01));
    eyes(body, 1.33, -0.134, 0.055, 0.025, 0x0a0a0a);
    body.add(cyl(0.21, 0.21, 0.02, 0x2b2b2b, 'cloth', 0, 1.44, 0));
    body.add(cyl(0.12, 0.135, 0.14, 0x2b2b2b, 'cloth', 0, 1.51, 0));
    body.add(cyl(0.137, 0.137, 0.035, tc, 'cloth', 0, 1.465, 0));
    P.armL = limb(0.045, 0.5, tc, 'cloth', -0.23, 1.15, 0);
    P.armR = limb(0.045, 0.5, tc, 'cloth', 0.23, 1.15, 0);
    for (const A of [P.armL, P.armR]) A.add(sph(0.05, 0x0d0d0d, 'rubber', 0, -0.49, 0));
    body.add(P.armL, P.armR);
  }
  // Weapon holder at the right hand
  P.hand = new THREE.Group();
  const armLen = { longman: 0.78, builder: 0.62, doctor: 0.56, spy: 0.5 }[char];
  P.hand.position.set(0, -armLen + 0.05, 0);
  P.armR.add(P.hand);
  return P;
}

// First-person arm: sleeve + hand, weapon attached at the hand
export function buildViewArm(char, team) {
  const g = new THREE.Group();
  const sleeve = { longman: TEAM_COLORS[team], builder: TEAM_COLORS[team], doctor: METAL, spy: TEAM_COLORS[team] }[char];
  const glove = { longman: 0x5a3a22, builder: 0xd9a441, doctor: 0x9aa3ad, spy: 0x1a1a1f }[char];
  const arm = part(capsuleGeo(0.05, 0.4), mat(sleeve, char === 'doctor' ? 'metal' : 'cloth'), 0, -0.03, 0.3, false);
  arm.rotation.x = Math.PI / 2;
  g.add(arm);
  // Fist wrapped around the grip
  g.add(part(rboxGeo(0.07, 0.085, 0.09, 0.03), mat(glove, char === 'doctor' ? 'metal' : 'cloth'), 0, -0.005, 0.01, false));
  return g;
}

// ---------- Tower ----------

export function buildTower(t) {
  const g = new THREE.Group();
  const s = t.size, h = t.height;
  const wood = 0x8a5a2b, darkWood = 0x5c3a1a, light = 0xc49a5a;
  g.add(rb(s * 0.84, h, s * 0.84, darkWood, 'wood', 0, h / 2, 0, 0.02));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(rb(0.16, h, 0.16, wood, 'wood', x * s / 2, h / 2, z * s / 2, 0.03));
  // Cross braces on every side
  const diag = Math.hypot(s, h * 0.5);
  const ang = Math.atan2(h * 0.5, s);
  for (const side of [0, 1, 2, 3]) {
    for (const [y, sgn] of [[h * 0.25, 1], [h * 0.75, -1]]) {
      const brace = rb(diag, 0.07, 0.05, light, 'wood', 0, y, 0, 0.015);
      brace.rotation.z = sgn * ang;
      const holder = new THREE.Group();
      holder.rotation.y = side * Math.PI / 2;
      brace.position.z = s / 2 + 0.03;
      holder.add(brace);
      g.add(holder);
    }
  }
  // Ladder rungs on all sides: you can climb from anywhere
  for (let y = 0.3; y < h - 0.1; y += 0.45) {
    for (const side of [0, 1, 2, 3]) {
      const rung = part(cylGeo(0.025, 0.025, s, 8), mat(light, 'wood'), 0, y, s / 2 + 0.07);
      rung.rotation.z = Math.PI / 2;
      const holder = new THREE.Group();
      holder.rotation.y = side * Math.PI / 2;
      holder.add(rung);
      g.add(holder);
    }
  }
  g.add(rb(s + 0.16, 0.14, s + 0.16, TEAM_COLORS[t.team], 'paint', 0, h - 0.07, 0, 0.03));
  // Little team flag on the top corner
  const pole = cyl(0.02, 0.02, 0.9, 0x3a3f47, 'metal', s / 2, h + 0.45, s / 2);
  g.add(pole);
  const flag = part(silhouette([[0, 0], [0.4, -0.1], [0, -0.22]], 0.01, 0), mat(TEAM_COLORS[t.team], 'cloth'), s / 2, h + 0.88, s / 2, false);
  flag.rotation.y = Math.PI / 2;
  g.add(flag);
  g.userData.flag = flag;
  return g;
}

// ---------- Arena ----------

function bannerTexture(team) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const x = c.getContext('2d');
  x.fillStyle = team === 'yellow' ? '#f2c418' : '#1fb5ad';
  x.fillRect(0, 0, 512, 192);
  x.fillStyle = 'rgba(0,0,0,0.18)';
  x.fillRect(0, 168, 512, 24);
  x.fillStyle = '#ffffff';
  x.strokeStyle = 'rgba(0,0,0,0.35)';
  x.lineWidth = 6;
  x.beginPath();
  if (team === 'yellow') {
    // Lightning bolt: Flash
    x.moveTo(280, 18); x.lineTo(200, 104); x.lineTo(250, 104); x.lineTo(222, 176); x.lineTo(316, 78); x.lineTo(262, 78); x.closePath();
  } else {
    // Pistol silhouette: Pištol
    x.moveTo(170, 60); x.lineTo(350, 60); x.lineTo(350, 92); x.lineTo(262, 92); x.lineTo(250, 104);
    x.lineTo(232, 168); x.lineTo(190, 168); x.lineTo(206, 96); x.lineTo(170, 92); x.closePath();
  }
  x.stroke();
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildArena(scene, map) {
  // Floor: flat-colored tiles with a little per-tile variation
  const pos = [], col = [], idx = [];
  const S = 2;
  let v = 0;
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let x = -30; x < 30; x += S) {
    for (let z = -20; z < 20; z += S) {
      const odd = (x / S + z / S) & 1;
      let base = odd ? 0x9bbf7a : 0x93b873;
      if (x < -22) base = odd ? 0xd9c784 : 0xd2bf7a;
      if (x >= 22) base = odd ? 0x86c9bf : 0x7ec2b8;
      if (Math.abs(z) > 13 && x >= -22 && x < 22) base = odd ? 0xb3aa98 : 0xaba290;
      const c = new THREE.Color(base).multiplyScalar(0.94 + rand() * 0.1);
      const g = 0.04; // grout gap between tiles
      pos.push(x + g, 0, z + g, x + S - g, 0, z + g, x + S - g, 0, z + S - g, x + g, 0, z + S - g);
      for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
      v += 4;
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  fg.setIndex(idx);
  fg.computeVertexNormals();
  const floor = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  floor.position.y = 0.002;
  floor.receiveShadow = true;
  scene.add(floor);
  const grout = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), mat(0x6f7f5c, 'stone'));
  grout.rotation.x = -Math.PI / 2;
  grout.receiveShadow = true;
  scene.add(grout);
  const line = part(boxGeo(0.15, 0.01, 40), mat(0xf5f5f0, 'paint'), 0, 0.006, 0, false);
  line.receiveShadow = true;
  scene.add(line);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(0x7fa463, 'stone'));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  scene.add(outer);

  // Crate edge frames for every crate in one instanced mesh
  const frames = [];
  for (const b of map.boxes) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const add = (m) => { m.receiveShadow = true; scene.add(m); return m; };
    switch (b.kind) {
      case 'crate': {
        add(rb(w - 0.04, h - 0.04, d - 0.04, b.color, 'wood', cx, cy, cz, 0.03));
        const t = Math.min(0.12, Math.min(w, h, d) * 0.1);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) frames.push([cx + sx * (w / 2 - t / 2), cy, cz + sz * (d / 2 - t / 2), t + 0.01, h, t + 0.01]);
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) frames.push([cx, cy + sy * (h / 2 - t / 2), cz + sz * (d / 2 - t / 2), w, t + 0.01, t + 0.01]);
          for (const sx of [-1, 1]) frames.push([cx + sx * (w / 2 - t / 2), cy + sy * (h / 2 - t / 2), cz, t + 0.01, t + 0.01, d]);
        }
        // Diagonal plank on the two long faces
        const diag = part(boxGeo(Math.hypot(w, h) - t * 2, t * 0.8, 0.02), mat(shade(b.color, 0.75), 'wood'), cx, cy, cz);
        diag.rotation.z = Math.atan2(h, w);
        for (const sz of [-1, 1]) { const dd = diag.clone(); dd.position.z = cz + sz * (d / 2 + 0.005); add(dd); }
        break;
      }
      case 'pillar':
        add(rb(w * 0.85, h, d * 0.85, b.color, 'stone', cx, cy, cz, 0.05));
        add(rb(w * 1.15, 0.3, d * 1.15, shade(b.color, 0.8), 'stone', cx, b.min[1] + 0.15, cz, 0.04));
        add(rb(w * 1.15, 0.22, d * 1.15, shade(b.color, 1.12), 'stone', cx, b.max[1] - 0.11, cz, 0.04));
        break;
      case 'walkway':
      case 'step': {
        add(rb(w, h, d, shade(b.color, 0.85), 'metal', cx, cy, cz, 0.03));
        add(part(boxGeo(w - 0.06, 0.04, d - 0.06), mat(b.color, { rough: 0.6, metal: 0.5 }), cx, b.max[1] + 0.005, cz));
        if (b.kind === 'walkway') {
          // Hazard stripes along the long edges
          for (const sz of [-1, 1]) {
            for (let x = b.min[0] + 0.2; x < b.max[0] - 0.2; x += 0.8) {
              const st = part(boxGeo(0.35, 0.06, 0.12), mat(0xf2c418, 'paint'), x + 0.2, b.max[1] + 0.01, cz + sz * (d / 2 - 0.08), false);
              st.rotation.y = 0.6;
              add(st);
            }
          }
        }
        break;
      }
      default: { // walls: body, darker base, lighter cap, pilasters on long walls
        add(rb(w, h, d, b.color, 'stone', cx, cy, cz, 0.04));
        add(rb(w + 0.1, 0.28, d + 0.1, shade(b.color, 0.72), 'stone', cx, b.min[1] + 0.14, cz, 0.03));
        add(rb(w + 0.16, 0.16, d + 0.16, shade(b.color, 1.1), 'stone', cx, b.max[1] - 0.02, cz, 0.04));
        const long = Math.max(w, d);
        if (long > 6) {
          const alongX = w > d;
          for (let s = -long / 2 + 2.5; s < long / 2 - 1; s += 5) {
            add(rb(alongX ? 0.45 : d + 0.24, h - 0.3, alongX ? d + 0.24 : 0.45, shade(b.color, 0.92), 'stone',
              alongX ? cx + s : cx, cy - 0.05, alongX ? cz : cz + s, 0.04));
          }
        }
      }
    }
  }
  if (frames.length) {
    const inst = new THREE.InstancedMesh(boxGeo(1, 1, 1), mat(0x5c3a1a, 'wood'), frames.length);
    const m4 = new THREE.Matrix4();
    frames.forEach(([x, y, z, sx, sy, sz], i) => {
      m4.makeScale(sx, sy, sz).setPosition(x, y, z);
      inst.setMatrixAt(i, m4);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // Team banners with emblems on the back walls
  for (const dcr of map.decor) {
    if (dcr.kind !== 'banner') continue;
    const h = dcr.max[1] - dcr.min[1], d = dcr.max[2] - dcr.min[2];
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(d, h), new THREE.MeshStandardMaterial({ map: bannerTexture(dcr.team), roughness: 0.9 }));
    const facing = dcr.team === 'yellow' ? 1 : -1;
    banner.position.set(dcr.team === 'yellow' ? -29.93 : 29.93, (dcr.min[1] + dcr.max[1]) / 2, 0);
    banner.rotation.y = facing * Math.PI / 2;
    banner.receiveShadow = true;
    scene.add(banner);
    const rodM = part(cylGeo(0.06, 0.06, d + 0.6), mat(0x5c3a1a, 'wood'), banner.position.x + facing * 0.08, dcr.max[1] + 0.05, 0);
    rodM.rotation.x = Math.PI / 2;
    scene.add(rodM);
  }

  buildScenery(scene);
}

// ---------- Sky and scenery outside the walls ----------

function buildScenery(scene) {
  // Gradient sky dome with a soft sun glow
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f8fd8) },
      horizon: { value: new THREE.Color(0xcfe8f7) },
      bottom: { value: new THREE.Color(0x9cc28a) },
      sunDir: { value: new THREE.Vector3(25, 45, 15).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, min(1.0, -h * 6.0));
        float s = max(0.0, dot(normalize(vDir), sunDir));
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 6.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -1;
  scene.add(sky);

  // Rolling hills
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const r = 110 + (i % 3) * 22;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(26 + (i % 4) * 9, 20, 12), mat(i % 2 ? 0x86ad6a : 0x7da362, 'stone'));
    hill.position.set(Math.cos(a) * r, -10, Math.sin(a) * r);
    hill.scale.y = 0.55;
    scene.add(hill);
  }

  // A ring of trees peeking over the walls
  const trees = [];
  let seed = 3;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const rx = 38 + rand() * 40, rz = 28 + rand() * 40;
    trees.push({ x: Math.cos(a) * rx, z: Math.sin(a) * rz, s: 0.8 + rand() * 0.7, c: rand() });
  }
  const trunk = new THREE.InstancedMesh(cylGeo(0.35, 0.5, 4, 8), mat(0x6b4423, 'wood'), trees.length);
  const crownGeo = new THREE.IcosahedronGeometry(3, 1);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), trees.length * 2);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const greens = [0x4f8a3c, 0x5e9a46, 0x437a33, 0x6aa84f];
  trees.forEach((t, i) => {
    m4.compose(new THREE.Vector3(t.x, 2 * t.s, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    trunk.setMatrixAt(i, m4);
    for (let k = 0; k < 2; k++) {
      const sc = t.s * (k ? 0.75 : 1);
      m4.compose(new THREE.Vector3(t.x + (k ? 0.8 : 0), (5.5 + k * 2.6) * t.s, t.z + (k ? -0.5 : 0)), q, new THREE.Vector3(sc, sc * 1.1, sc));
      crown.setMatrixAt(i * 2 + k, m4);
      crown.setColorAt(i * 2 + k, new THREE.Color(greens[Math.floor(t.c * greens.length + k) % greens.length]));
    }
  });
  trunk.castShadow = crown.castShadow = true;
  scene.add(trunk, crown);
}

// Puffy clouds made of flattened spheres; returned so they can drift
export function buildClouds(scene) {
  const group = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.35 });
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(sphereGeo(4 + rand() * 4), cloudMat);
      p.position.set(k * 4.5 - n * 2, rand() * 2, rand() * 4 - 2);
      p.scale.y = 0.55;
      c.add(p);
    }
    const a = rand() * Math.PI * 2, r = 80 + rand() * 120;
    c.position.set(Math.cos(a) * r, 55 + rand() * 30, Math.sin(a) * r);
    c.rotation.y = rand() * Math.PI;
    group.add(c);
  }
  scene.add(group);
  return group;
}

