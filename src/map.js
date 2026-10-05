// Maps, all built from axis-aligned boxes. Yellow base is at -x, Teal base at +x.
// - Arena: ~60 x 40 m outdoor arena, last team standing.
// - Crystal Cave: ~72 x 36 m symmetric cave with chokepoints, capture the treasure.
// - Sky Bridge: two floating islands joined by a bridge over a void, last team standing.

export const MAPS = {
  arena: { name: 'Arena', mode: 'elimination', modeName: 'Last team standing' },
  cave: { name: 'Crystal Cave', mode: 'ctf', modeName: 'Capture the treasure' },
  islands: { name: 'Sky Bridge', mode: 'elimination', modeName: 'Last team standing' },
};
export const MAP_ORDER = ['arena', 'cave', 'islands'];

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

export function buildMap(id = 'arena') {
  if (id === 'cave') return caveMap();
  if (id === 'islands') return islandsMap();
  return arenaMap();
}

function arenaMap() {
  const boxes = [];
  const add = (b) => boxes.push(b);
  const addMirrorX = (b) => { add(b); add(mirrorX(b)); };
  const addMirrorXZ = (b) => { add(b); add(mirrorX(b)); add(mirrorZ(b)); add(mirrorX(mirrorZ(b))); };

  // Outer walls: low enough to see the sky and trees, too high to jump
  add(box(-31, -30, 0, 3, -21, 21, C.wall));
  add(box(30, 31, 0, 3, -21, 21, C.wall));
  add(box(-31, 31, 0, 3, -21, -20, C.wall));
  add(box(-31, 31, 0, 3, 20, 21, C.wall));

  // Base cover walls: waist-high, wide open around them
  addMirrorXZ(box(-22.5, -21.5, 0, 1.2, 6, 10, C.wallDark));
  // Base cover crates
  addMirrorXZ(centered(-26, 9.5, 1.5, 1.5, 1.5, C.crate));
  addMirrorX(centered(-25, 0, 1, 1, 1, C.crateDark));

  // Low cover walls with wide gaps mark the side lanes without closing them off
  addMirrorXZ(box(-15, -12.5, 0, 1.3, 12.5, 13.3, C.wall));
  addMirrorXZ(box(-9, -6.5, 0, 1.3, 12.5, 13.3, C.wall));
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

  return {
    id: 'arena', ...MAPS.arena, theme: 'outdoor',
    boxes, spawns, decor, lanes, flankZ: 16.5,
    bounds: { minX: -30, maxX: 30, minZ: -20, maxZ: 20 },
  };
}

// ---------- Crystal Cave ----------
// Each base is a chamber with the team's treasure, opening through two 3 m doors.
// Side lanes lead to the middle cavern through three entries: two 3.5 m gaps and
// a low tunnel in the center. The middle cavern has a raised rock platform and
// floor-to-ceiling columns.

const R = {
  rock: 0x5d544c,
  rockDark: 0x4a433d,
  column: 0x6b6158,
  ledge: 0x6e655c,
  crate: 0xb5793a,
};

function caveMap() {
  const H = 7; // ceiling height
  const boxes = [];
  const add = (b) => boxes.push(b);
  const addMirrorX = (b) => { add(b); add(mirrorX(b)); };
  const addMirrorZ = (b) => { add(b); add(mirrorZ(b)); };
  const addMirrorXZ = (b) => { add(b); add(mirrorX(b)); add(mirrorZ(b)); add(mirrorX(mirrorZ(b))); };
  const rock = (x0, x1, y0, y1, z0, z1, color = R.rock) => box(x0, x1, y0, y1, z0, z1, color, { kind: 'rock' });

  // Shell and ceiling
  add(rock(-37, 37, 0, H, -19, -18, R.rockDark));
  add(rock(-37, 37, 0, H, 18, 19, R.rockDark));
  add(rock(-37, -36, 0, H, -18, 18, R.rockDark));
  add(rock(36, 37, 0, H, -18, 18, R.rockDark));
  add(box(-37, 37, H, H + 1, -19, 19, R.rockDark, { kind: 'ceiling' }));

  // Base chamber: x -36..-24, z -8.5..8.5. Doors at z ±5.5..8.5 through the base wall.
  addMirrorXZ(rock(-36, -21, 0, H, 8.5, 18));
  addMirrorX(rock(-24, -21, 0, H, -5.5, 5.5));
  // Side lanes: x -21..-12, closed off beyond z ±12, with a rock block in the middle
  addMirrorXZ(rock(-21, -12, 0, H, 12, 18));
  addMirrorX(rock(-21, -15, 0, H, -3.5, 3.5, R.rockDark));
  // Middle cavern wall at x -12..-10: gaps at z ±7..10.5 and a low tunnel at z -1.5..1.5
  addMirrorXZ(rock(-12, -10, 0, H, 1.5, 7));
  addMirrorXZ(rock(-12, -10, 0, H, 10.5, 12));
  addMirrorX(rock(-12, -10, 2.6, H, -1.5, 1.5, R.rockDark));
  addMirrorZ(rock(-10, 10, 0, H, 12, 18));

  // Middle cavern: raised platform with steps on all four sides
  const ledge = (x0, x1, y1, z0, z1) => box(x0, x1, 0, y1, z0, z1, R.ledge, { kind: 'ledge', walk: true });
  add(ledge(-3, 3, 1.2, -2.5, 2.5));
  addMirrorX(ledge(-3.8, -3, 0.8, -1.5, 1.5));
  addMirrorX(ledge(-4.6, -3.8, 0.4, -1.5, 1.5));
  addMirrorZ(ledge(-1, 1, 0.8, 2.5, 3.3));
  addMirrorZ(ledge(-1, 1, 0.4, 3.3, 4.1));
  // Floor-to-ceiling columns and low boulders for cover
  addMirrorXZ(centered(-6.5, 7, 1.6, 1.6, H, R.column, 0, { kind: 'column' }));
  addMirrorXZ(centered(-7.5, 3.8, 1.4, 1.2, 1.1, R.rock, 0, { kind: 'boulder' }));
  // Side lane cover: boulders and short stalagmites
  addMirrorXZ(centered(-17, 8, 1.6, 1.6, 1.3, R.rock, 0, { kind: 'boulder' }));
  addMirrorXZ(centered(-13.5, 5, 1, 1, 2.2, R.column, 0, { kind: 'stalagmite' }));
  // Base: low rocks on both sides of the treasure, supply crates by the spawn
  addMirrorXZ(centered(-27.5, 3.5, 1.2, 1.2, 1.0, R.rock, 0, { kind: 'boulder' }));
  addMirrorXZ(centered(-34.5, 6.8, 1.4, 1.4, 1.4, R.crate, 0, { kind: 'crate' }));

  const spawns = { yellow: [], teal: [] };
  for (let i = 0; i < 6; i++) {
    const z = -3 + i * 1.2;
    spawns.yellow.push({ x: -34.8, y: 0, z, yaw: -Math.PI / 2 });
    spawns.teal.push({ x: 34.8, y: 0, z, yaw: Math.PI / 2 });
  }
  const homes = { yellow: { x: -27.5, y: 0, z: 0 }, teal: { x: 27.5, y: 0, z: 0 } };

  const decor = [
    { kind: 'floor', team: 'yellow', min: [-36, 0, -8.5], max: [-24, 0.02, 8.5] },
    { kind: 'floor', team: 'teal', min: [24, 0, -8.5], max: [36, 0.02, 8.5] },
    { kind: 'banner', team: 'yellow', min: [-35.95, 2.2, -3], max: [-35.9, 4.7, 3] },
    { kind: 'banner', team: 'teal', min: [35.9, 2.2, -3], max: [35.95, 4.7, 3] },
  ];
  // Torches light the bases; glowing crystals light the middle
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) decor.push({ kind: 'torch', x: sx * 35.75, y: 3, z: sz * 5, face: -sx, light: true });
    for (const sz of [-1, 1]) decor.push({ kind: 'torch', x: sx * 20.75, y: 3, z: sz * 4.5, face: -sx, light: false });
  }
  for (const sz of [-1, 1]) {
    decor.push({ kind: 'crystal', x: 0, y: 0, z: sz * 11.6, color: 0x9a6bff, size: 1.4, light: true });
    for (const sx of [-1, 1]) {
      decor.push({ kind: 'crystal', x: sx * 4.5, y: 0, z: sz * 11.7, color: 0x4fb3ff, size: 0.9 });
      decor.push({ kind: 'crystal', x: sx * 16.5, y: 0, z: sz * 11.7, color: 0x6be0ff, size: 0.8 });
      decor.push({ kind: 'crystal', x: sx * 9.7, y: 0, z: sz * 4.3, color: 0x9a6bff, size: 0.6 });
    }
  }

  const lanes = [
    { x: 0, z: 9 },
    { x: 0, z: 0, y: 1.2 },
    { x: 0, z: -9 },
  ];

  return {
    id: 'cave', ...MAPS.cave, theme: 'cave', ceiling: H,
    boxes, spawns, decor, lanes, homes, flankZ: 9,
    bounds: { minX: -36, maxX: 36, minZ: -18, maxZ: 18 },
  };
}

// ---------- Sky Bridge ----------
// Two floating islands (tops at y = 0) over a void, joined by a 3.2 m wide plank
// bridge with a wider platform in the middle. There is no ground: whoever walks
// or is pushed off an edge falls and is out once below killY.

const S = {
  island: 0x7a6650,
  bridge: 0x9a6a3c,
  crate: 0xb5793a,
  crateDark: 0x8f5a28,
  pillar: 0xb8b2a6,
  wall: 0xc9bfa8,
  post: 0x6b4423,
};

function islandsMap() {
  const boxes = [];
  const add = (b) => boxes.push(b);
  const addMirrorX = (b) => { add(b); add(mirrorX(b)); };
  const addMirrorXZ = (b) => { add(b); add(mirrorX(b)); add(mirrorZ(b)); add(mirrorX(mirrorZ(b))); };
  const ground = (x0, x1, z0, z1, kind, color, depth) => box(x0, x1, -depth, 0, z0, z1, color, { kind, walk: true });

  // Islands: a 20 x 20 m block with a lobe on each side
  addMirrorX(ground(-32, -12, -10, 10, 'island', S.island, 3));
  addMirrorXZ(ground(-28, -16, 10, 12, 'island', S.island, 3));
  // Bridge spans and the middle platform (kept apart so their planks don't overlap)
  addMirrorX(ground(-12, -3, -1.6, 1.6, 'bridge', S.bridge, 0.35));
  add(ground(-3, 3, -3.5, 3.5, 'bridge', S.bridge, 0.35));
  // Rope posts at the bridge heads and the platform corners: markers, not railings
  addMirrorXZ(centered(-12.4, 1.95, 0.3, 0.3, 1.1, S.post, 0, { kind: 'post' }));
  addMirrorXZ(centered(-2.75, 3.25, 0.3, 0.3, 1.1, S.post, 0, { kind: 'post' }));

  // Cover by the bridge head
  addMirrorX(centered(-15, 4.5, 1.4, 1.4, 1.4, S.crate, 0, { kind: 'crate' }));
  addMirrorX(centered(-15.5, -5, 1.2, 1.2, 1.2, S.crateDark, 0, { kind: 'crate' }));
  // Ruined low walls across the middle of each island, open in the center
  addMirrorXZ(box(-21, -20, 0, 1.3, 2.5, 6.5, S.wall, { kind: 'wall' }));
  // Pillars on the lobes
  addMirrorXZ(centered(-22, 9.5, 1, 1, 3.5, S.pillar, 0, { kind: 'pillar' }));
  // A climbable crate stack at the back of each island
  addMirrorX(centered(-28, -7, 2, 2, 2, S.crate, 0, { kind: 'crate', walk: true }));
  addMirrorX(centered(-28, -7, 1, 1, 1, S.crateDark, 2, { kind: 'crate' }));
  addMirrorX(centered(-27, 7, 1.2, 1.2, 1.2, S.crateDark, 0, { kind: 'crate' }));

  const spawns = { yellow: [], teal: [] };
  for (let i = 0; i < 6; i++) {
    const z = -3 + i * 1.2;
    spawns.yellow.push({ x: -29.5, y: 0, z, yaw: -Math.PI / 2 });
    spawns.teal.push({ x: 29.5, y: 0, z, yaw: Math.PI / 2 });
  }

  // Team-tinted grass at the back of each island
  const decor = [
    { kind: 'floor', team: 'yellow', min: [-32, 0, -10], max: [-26, 0.02, 10] },
    { kind: 'floor', team: 'teal', min: [26, 0, -10], max: [32, 0.02, 10] },
  ];

  return {
    id: 'islands', ...MAPS.islands, theme: 'sky',
    boxes, spawns, decor, lanes: [{ x: 0, z: 0 }], flankZ: 0,
    buildX: [14, 24], // Builder bots put towers on their island, not on the bridge
    killY: -14,
    bounds: { minX: -40, maxX: 40, minZ: -20, maxZ: 20, void: true },
  };
}
