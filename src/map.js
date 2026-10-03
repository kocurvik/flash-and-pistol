// The arena: ~60 x 40 m, all axis-aligned boxes. Symmetric across x = 0 and z = 0.
// Yellow base is at -x, Teal base at +x.

const C = {
  wall: 0xd9cbb0,
  wallDark: 0xb9a98c,
  crate: 0xb5793a,
  crateDark: 0x8f5a28,
  pillar: 0x9aa3ad,
  walkway: 0x7d8a96,
  step: 0x8f9ba6,
  stone: 0xc4b59a,
};

function box(x0, x1, y0, y1, z0, z1, color, extra = {}) {
  return { min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)], color, ...extra };
}

function centered(cx, cz, w, d, h, color, y0 = 0, extra = {}) {
  return box(cx - w / 2, cx + w / 2, y0, y0 + h, cz - d / 2, cz + d / 2, color, extra);
}

function mirrorX(b) { return { ...b, min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] }; }
function mirrorZ(b) { return { ...b, min: [b.min[0], b.min[1], -b.max[2]], max: [b.max[0], b.max[1], -b.min[2]] }; }

export function buildMap() {
  const boxes = [];
  const add = (b) => boxes.push(b);
  const addMirrorX = (b) => { add(b); add(mirrorX(b)); };
  const addMirrorXZ = (b) => { add(b); add(mirrorX(b)); add(mirrorZ(b)); add(mirrorX(mirrorZ(b))); };

  // Outer walls
  add(box(-31, -30, 0, 6, -21, 21, C.wall));
  add(box(30, 31, 0, 6, -21, 21, C.wall));
  add(box(-31, 31, 0, 6, -21, -20, C.wall));
  add(box(-31, 31, 0, 6, 20, 21, C.wall));

  // Base front walls (gaps in the middle and at the sides toward corridors)
  addMirrorXZ(box(-22.5, -21.5, 0, 3, 4, 12, C.wallDark));
  // Base cover crates
  addMirrorXZ(centered(-26, 9.5, 1.5, 1.5, 1.5, C.crate));
  addMirrorX(centered(-25, 0, 1, 1, 1, C.crateDark));

  // Corridor walls separate the side corridors from the middle field
  addMirrorXZ(box(-16, -5, 0, 4, 12.5, 13.5, C.wall));
  // Corridor crates
  addMirrorXZ(centered(-10, 17.5, 1.4, 1.4, 1.4, C.crate));
  addMirrorXZ(centered(-2.5, 15.2, 1.2, 1.2, 1.2, C.crateDark));
  addMirrorXZ(centered(-19, 16, 1.2, 2.4, 1.2, C.crate));

  // Raised walkway in the middle (along x) with stairs at each end and on each side
  add(box(-6, 6, 0, 1.5, -1.5, 1.5, C.walkway, { walk: true }));
  addMirrorX(box(-6.75, -6, 0, 1.0, -1.5, 1.5, C.step, { walk: true }));
  addMirrorX(box(-7.5, -6.75, 0, 0.5, -1.5, 1.5, C.step, { walk: true }));
  add(box(-1, 1, 0, 1.0, 1.5, 2.25, C.step, { walk: true }));
  add(box(-1, 1, 0, 0.5, 2.25, 3.0, C.step, { walk: true }));
  add(box(-1, 1, 0, 1.0, -2.25, -1.5, C.step, { walk: true }));
  add(box(-1, 1, 0, 0.5, -3.0, -2.25, C.step, { walk: true }));

  // Pillars
  addMirrorXZ(centered(-12, 6, 1, 1, 4, C.pillar));
  addMirrorXZ(centered(-4, 8.5, 1, 1, 4, C.pillar));

  // Middle field crates
  addMirrorX(centered(-15, 0, 2, 2, 2, C.crate, 0, { walk: true }));
  addMirrorX(centered(-15, 0, 1, 1, 1, C.crateDark, 2));
  addMirrorXZ(centered(-10, 3.5, 1.2, 1.2, 1.2, C.crateDark));
  addMirrorXZ(centered(-18, 8, 2, 1.2, 1.2, C.crate));
  addMirrorXZ(centered(-8, 9.5, 1.2, 1.2, 1.2, C.crate));

  // Tag each box with a kind so the renderer can detail walls, crates, pillars...
  const KIND = {
    [C.wall]: 'wall', [C.wallDark]: 'wall', [C.crate]: 'crate', [C.crateDark]: 'crate',
    [C.pillar]: 'pillar', [C.walkway]: 'walkway', [C.step]: 'step', [C.stone]: 'wall',
  };
  for (const b of boxes) b.kind = KIND[b.color] || 'wall';

  const spawns = { yellow: [], teal: [] };
  for (let i = 0; i < 6; i++) {
    const z = -3 + i * 1.2; // inside the gap of the base wall
    spawns.yellow.push({ x: -27.5, y: 0, z, yaw: -Math.PI / 2 });
    spawns.teal.push({ x: 27.5, y: 0, z, yaw: Math.PI / 2 });
  }

  // Non-colliding decoration: team-colored base floors and banners
  const decor = [
    { kind: 'floor', team: 'yellow', min: [-30, 0, -20], max: [-22, 0.02, 20] },
    { kind: 'floor', team: 'teal', min: [22, 0, -20], max: [30, 0.02, 20] },
    { kind: 'banner', team: 'yellow', min: [-29.95, 2, -4], max: [-29.9, 5, 4] },
    { kind: 'banner', team: 'teal', min: [29.9, 2, -4], max: [29.95, 5, 4] },
  ];

  // Lanes used by bots to spread out when no enemy is known
  const lanes = [
    { x: 0, z: 16.5 },   // north corridor
    { x: 0, z: 0, y: 1.5 }, // over the walkway
    { x: 0, z: -6 },     // middle field
    { x: 0, z: 6 },
    { x: 0, z: -16.5 },  // south corridor
  ];

  return { boxes, spawns, decor, lanes, bounds: { minX: -30, maxX: 30, minZ: -20, maxZ: 20 } };
}
