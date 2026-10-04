// Movement, collision, raycasts and the waypoint graph. No DOM, no Three.js:
// this file runs in the browser and in Node (tests / a future dedicated server).
import { GAME } from './config.js';

const EPS = 0.001;

export function overlapsBox(x, y, z, r, h, b) {
  return x + r > b.min[0] && x - r < b.max[0] &&
         y + h > b.min[1] && y < b.max[1] &&
         z + r > b.min[2] && z - r < b.max[2];
}

function firstOverlap(x, y, z, r, h, solids) {
  for (const b of solids) if (overlapsBox(x, y, z, r, h, b)) return b;
  return null;
}

export function forwardVec(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
export function lookDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
export function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function towerBox(t) {
  const s = t.size / 2;
  return { min: [t.x - s, t.y, t.z - s], max: [t.x + s, t.y + t.height, t.z + s], tower: t.id, color: 0 };
}

export function entityHeight(e, def) {
  return def.height * (e.crouch ? GAME.crouchHeightScale : 1);
}

// Moves one entity for one tick. Shared by the host simulation and client-side prediction.
// input: { fwd, right, jump, jumpPressed, crouch }
// Returns movement events: { poundLanded: box|null, landed: speed|0, jumped: bool }
export function stepMovement(e, def, input, dt, solids, ownTowerId) {
  const out = { poundLanded: null, landed: 0, jumped: false };
  const r = def.radius;
  const wasCrouch = e.crouch;
  e.crouch = !!input.crouch;
  // Can't stand up into a ceiling
  if (wasCrouch && !e.crouch && firstOverlap(e.pos.x, e.pos.y, e.pos.z, r, def.height, solids)) e.crouch = true;
  const h = entityHeight(e, def);

  let speed = def.speed * (e.crouch ? GAME.crouchSpeedScale : 1);
  if (e.buildT > 0) speed *= 0.5;
  const f = forwardVec(e.yaw);
  const rx = -f.z, rz = f.x; // right vector
  let wx = f.x * input.fwd + rx * input.right;
  let wz = f.z * input.fwd + rz * input.right;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }

  if (e.onGround) {
    e.vel.x = wx * speed;
    e.vel.z = wz * speed;
    e.jumpsUsed = 0;
  } else {
    const k = Math.min(1, 5 * dt);
    e.vel.x += (wx * speed - e.vel.x) * k;
    e.vel.z += (wz * speed - e.vel.z) * k;
  }

  // Ground pound: Builder on top of his own tower, crouch + jump
  const standingOnOwnTower = e.onGround && e.standingOn && e.standingOn.tower != null && e.standingOn.tower === ownTowerId;
  if (input.jumpPressed && input.crouch && standingOnOwnTower) {
    e.vel.y = 6;
    e.pounding = true;
    e.onGround = false;
    out.jumped = true;
  } else if ((input.jumpPressed || (input.jump && e.onGround)) && !e.pounding) {
    const maxJumps = def.doubleJump ? 2 : 1;
    if (e.onGround) {
      e.vel.y = GAME.jumpSpeed; e.jumpsUsed = 1; e.onGround = false; out.jumped = true;
    } else if (input.jumpPressed && e.jumpsUsed < maxJumps && def.doubleJump) {
      e.vel.y = GAME.jumpSpeed * 0.95; e.jumpsUsed = Math.max(e.jumpsUsed, 1) + 1; out.jumped = true;
    }
  }

  // Gravity
  const g = GAME.gravity * (e.pounding && e.vel.y < 2 ? GAME.poundGravityScale : 1);
  e.vel.y += g * dt;
  if (e.vel.y < -30) e.vel.y = -30;

  // Horizontal movement, one axis at a time, with auto step-up
  let climbBox = null;
  const moveAxis = (axis, delta) => {
    if (delta === 0) return;
    const p = e.pos;
    const nx = axis === 0 ? p.x + delta : p.x;
    const nz = axis === 2 ? p.z + delta : p.z;
    const b = firstOverlap(nx, p.y, nz, r, h, solids);
    if (!b) { p.x = nx; p.z = nz; return; }
    const stepTo = b.max[1];
    if (stepTo - p.y <= GAME.stepHeight && stepTo - p.y > 0 && !firstOverlap(nx, stepTo + EPS, nz, r, h, solids)) {
      p.x = nx; p.z = nz; p.y = stepTo + EPS; return;
    }
    if (b.tower != null) climbBox = b;
    if (axis === 0) p.x = delta > 0 ? b.min[0] - r - EPS : b.max[0] + r + EPS;
    else p.z = delta > 0 ? b.min[2] - r - EPS : b.max[2] + r + EPS;
    if (axis === 0) e.vel.x = 0; else e.vel.z = 0;
  };
  moveAxis(0, e.vel.x * dt);
  moveAxis(2, e.vel.z * dt);

  // Climb towers by walking into them
  e.climbing = false;
  if (climbBox && input.fwd > 0.3 && !e.pounding) {
    e.vel.y = GAME.climbSpeed;
    e.climbing = true;
  }

  // Vertical movement
  const wasGround = e.onGround;
  const vy = e.vel.y;
  let ny = e.pos.y + vy * dt;
  e.onGround = false;
  e.standingOn = null;
  if (ny <= 0) {
    ny = 0; e.onGround = true; e.vel.y = 0;
  }
  const b = firstOverlap(e.pos.x, ny, e.pos.z, r, h, solids);
  if (b) {
    if (vy <= 0) {
      ny = b.max[1] + EPS; e.onGround = true; e.vel.y = 0; e.standingOn = b;
    } else {
      ny = b.min[1] - h - EPS; e.vel.y = 0;
    }
  }
  if (!e.onGround && vy <= 0) {
    // Check if we are resting exactly on something
    const below = firstOverlap(e.pos.x, ny - 0.02, e.pos.z, r, h, solids);
    if (below && below.max[1] <= ny + 0.01) { e.onGround = true; e.standingOn = below; e.vel.y = 0; }
  }
  e.pos.y = ny;

  if (e.onGround && !wasGround) {
    out.landed = -vy;
    if (e.pounding) {
      e.pounding = false;
      out.poundLanded = e.standingOn || { ground: true };
    }
  }
  // Keep inside the arena
  e.pos.x = Math.max(-29.5, Math.min(29.5, e.pos.x));
  e.pos.z = Math.max(-19.5, Math.min(19.5, e.pos.z));
  return out;
}

// Ray vs box (slab method). Returns distance along the ray or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b.min[i] || o[i] > b.max[i]) return Infinity;
    } else {
      let t1 = (b.min[i] - o[i]) / d[i];
      let t2 = (b.max[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function raycast(ox, oy, oz, dx, dy, dz, maxT, solids) {
  let best = maxT, hit = null;
  for (const b of solids) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, b, best);
    if (t < best) { best = t; hit = b; }
  }
  return { t: best, box: hit };
}

export function lineClear(a, b, solids) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const r = raycast(a.x, a.y, a.z, dx / len, dy / len, dz / len, len, solids);
  return r.box === null;
}

// ---------- Waypoint graph ----------

export function buildNav(boxes) {
  const nodes = [];
  const R = 0.45;
  const free = (x, y, z) => !firstOverlap(x, y + EPS, z, R, 1.0, boxes);
  for (let x = -28; x <= 28; x += 2) {
    for (let z = -18; z <= 18; z += 2) {
      if (free(x, 0, z)) nodes.push({ x, y: 0, z });
    }
  }
  for (const b of boxes) {
    if (!b.walk) continue;
    const y = b.max[1];
    const x0 = b.min[0] + 0.4, x1 = b.max[0] - 0.4, z0 = b.min[2] + 0.4, z1 = b.max[2] - 0.4;
    const xs = [], zs = [];
    if (x1 - x0 < 2) xs.push((x0 + x1) / 2); else for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.ceil((x1 - x0) / 2)) xs.push(x);
    if (z1 - z0 < 2) zs.push((z0 + z1) / 2); else for (let z = z0; z <= z1 + 0.01; z += (z1 - z0) / Math.ceil((z1 - z0) / 2)) zs.push(z);
    for (const x of xs) for (const z of zs) if (free(x, y, z)) nodes.push({ x, y, z });
  }
  nodes.forEach((n, i) => { n.i = i; n.nbrs = []; });

  // Body clearance test along the segment, above anything we can step over.
  // Drops test above the higher end so walking off a ledge is allowed.
  const clearPath = (a, b) => {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / 0.25);
    const y = Math.abs(a.y - b.y) > 0.6 ? Math.max(a.y, b.y) + 0.06 : Math.min(a.y, b.y) + 0.56;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (firstOverlap(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t, 0.3, 1.0, boxes)) return false;
    }
    return true;
  };

  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 2.9 || d < 0.1) continue;
      const dy = b.y - a.y;
      if (dy > 0.6) continue;       // too high to step up
      if (dy < -2.2) continue;      // too far to drop
      if (!clearPath(a, b)) continue;
      a.nbrs.push(j);
    }
  }
  return { nodes };
}

export function nearestNode(nav, p, solids, requireClear = true) {
  let best = null, bd = Infinity;
  for (const n of nav.nodes) {
    const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2 + ((n.y - p.y) * 2) ** 2;
    if (d < bd) {
      if (requireClear && d > 1 && !lineClear({ x: p.x, y: p.y + 0.8, z: p.z }, { x: n.x, y: n.y + 0.8, z: n.z }, solids)) continue;
      bd = d; best = n;
    }
  }
  return best;
}

export function findPath(nav, start, goal) {
  if (!start || !goal) return [];
  if (start === goal) return [goal];
  const N = nav.nodes.length;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = [start.i];
  g[start.i] = 0;
  const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z);
  const f = new Float32Array(N).fill(Infinity);
  f[start.i] = h(start);
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal.i) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cn = nav.nodes[cur];
    for (const j of cn.nbrs) {
      if (closed[j]) continue;
      const nn = nav.nodes[j];
      const cost = g[cur] + Math.hypot(nn.x - cn.x, nn.z - cn.z) + Math.abs(nn.y - cn.y);
      if (cost < g[j]) {
        g[j] = cost; came[j] = cur; f[j] = cost + h(nn);
        open.push(j);
      }
    }
  }
  if (came[goal.i] === -1) return [];
  const path = [];
  for (let c = goal.i; c !== -1; c = came[c]) path.push(nav.nodes[c]);
  path.reverse();
  return path;
}
