// Bot AI: a priority list checked ~5 times per second (think), and smooth
// steering every tick (steer) that turns decisions into the same input a human makes.
import { CHARACTERS, WEAPONS, DIFFICULTY, GAME } from './config.js';
import { nearestNode, findPath, yawTo, angleDiff, forwardVec, lineClear, groundAt, groundAlong } from './physics.js';

const DEG = Math.PI / 180;
const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist3 = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * 0.7, a.z - b.z);

export class BotBrain {
  constructor(sim, e) {
    this.sim = sim;
    this.e = e;
    this.pickDelay = 1;
    this.reset();
  }

  get diff() { return DIFFICULTY[this.sim.difficulty] || DIFFICULTY.normal; }

  reset() {
    const lanes = this.sim.map.lanes;
    this.thinkT = Math.random() * 0.2;
    this.goal = null;
    this.path = [];
    this.pathGoal = null;
    this.repathT = 0;
    this.target = null;
    this.seen = new Map();
    this.lastKnown = null;
    this.lane = lanes[Math.floor(Math.random() * lanes.length)];
    this.laneDone = false;
    this.roamGoal = null;
    this.wantAttack = false;
    this.holdSpecial = false;
    this.pressSpecial = false;
    this.pressFlash = false;
    this.pressJump = false;
    this.crouch = false;
    this.slot = 0;
    this.stuckT = 0;
    this.lastPos = null;
    this.unstickT = 0;
    this.strafe = 0;
    this.sweepT = 0;
    this.sweepBase = 0;
    this.lookYaw = null;
    this.wobble = 0;
    this.wobbleGoal = 0;
    this.wobbleT = 0;
    this.throwAt = null;
    this.buildSpot = null;
    this.holdT = 0;
    this.retreatT = 0;
    this.retreatFrom = null;
    this.spyTarget = null;
    this.flankPoint = null;
    this.role = null; // capture the treasure: 'attack' or 'defend'
    this.guardSpot = null;
    this.useSpecials = Math.random() < this.diff.specialChance;
    this.idleFlash = Math.random() < this.diff.specialChance;
  }

  update(dt) {
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.2;
      this.think();
    }
    this.steer(dt);
  }

  // ---------- Perception ----------

  visibleEnemies() {
    const { sim, e } = this;
    const out = [];
    const now = sim.time;
    for (const o of sim.entities) {
      if (o.team === e.team || !o.alive) continue;
      if (sim.canSee(e, o)) {
        if (!this.seen.has(o.id)) this.seen.set(o.id, now);
        out.push(o);
        this.lastKnown = { x: o.pos.x, y: o.pos.y, z: o.pos.z, t: now };
      } else {
        this.seen.delete(o.id);
      }
    }
    out.sort((a, b) => dist3(e.pos, a.pos) - dist3(e.pos, b.pos));
    return out;
  }

  reacted(o) {
    const t = this.seen.get(o.id);
    return t !== undefined && this.sim.time - t >= this.diff.reaction;
  }

  range() {
    const w = WEAPONS[this.e.weapon];
    return w && w.range ? w.range : 2; // the nail gun has no melee range
  }

  // ---------- Decisions ----------

  think() {
    const { e } = this;
    this.goal = null;
    this.target = null;
    this.wantAttack = false;
    this.holdSpecial = false;
    this.crouch = false;
    this.lookYaw = null;
    this.throwAt = null;

    const vis = this.visibleEnemies();
    const ready = vis.filter((o) => this.reacted(o));
    const ctx = { vis, ready, nearest: ready[0] || null };
    ctx.nd = ctx.nearest ? dist3(e.pos, ctx.nearest.pos) : Infinity;

    const handled =
      this.thinkObjective(ctx, true) ||
      (e.char === 'longman' && this.thinkLongman(ctx)) ||
      (e.char === 'builder' && this.thinkBuilder(ctx)) ||
      (e.char === 'doctor' && this.thinkDoctor(ctx)) ||
      (e.char === 'spy' && this.thinkSpy(ctx));
    if (!handled) this.thinkShared(ctx);
  }

  engage(o) {
    const d = dist3(this.e.pos, o.pos);
    const r = this.range();
    this.target = o;
    this.goal = d > r * 0.7 ? o.pos : null;
    this.wantAttack = d <= r + 0.2 && Math.random() < this.diff.attackChance + 0.15;
  }

  thinkShared(ctx) {
    const { sim, e } = this;
    const { nearest, nd } = ctx;
    // 1. Low on hearts: go to a friendly Doctor
    if (e.hearts <= 1) {
      const doc = sim.entities.find((o) => o !== e && o.alive && o.team === e.team && o.char === 'doctor');
      if (doc) {
        if (nearest && nd <= this.range() + 0.3) this.engage(nearest);
        else this.goal = doc.pos;
        return;
      }
    }
    // 2 + 3. Attack a visible enemy in range, or chase one within 20 m
    if (nearest && nd <= 20) { this.engage(nearest); return; }
    // Capture the treasure: attack or defend instead of hunting and roaming
    if (this.thinkObjective(ctx, false)) return;
    // Hunt the last place we saw someone
    if (this.lastKnown && sim.time - this.lastKnown.t < 6) {
      if (distXZ(e.pos, this.lastKnown) < 1.5) this.lastKnown = null;
      else { this.goal = this.lastKnown; return; }
    }
    // 4. Head for the enemy base along a random lane, then wander
    this.roam();
  }

  roam() {
    const { sim, e } = this;
    const enemyX = e.team === 'yellow' ? 1 : -1;
    if (!this.laneDone) {
      const lp = { x: this.lane.x, y: this.lane.y || 0, z: this.lane.z };
      if (distXZ(e.pos, lp) < 2) this.laneDone = true;
      else { this.goal = lp; return; }
    }
    if (!this.roamGoal || distXZ(e.pos, this.roamGoal) < 2) {
      const nodes = sim.nav.nodes.filter((n) => n.x * enemyX > -6);
      this.roamGoal = nodes[Math.floor(Math.random() * nodes.length)];
    }
    this.goal = this.roamGoal;
  }

  // Capture the treasure. urgent: only what beats everything else (carrying the
  // treasure, getting ours back, grabbing theirs when it is close).
  thinkObjective(ctx, urgent) {
    const { sim, e } = this;
    if (sim.mode !== 'ctf' || !sim.flags.length) return false;
    const mine = sim.flags.find((f) => f.team === e.team);
    const theirs = sim.flags.find((f) => f.team !== e.team);
    const near = ctx.nearest && ctx.nd <= this.range() + 0.3 ? ctx.nearest : null;
    if (!this.role) {
      const mates = sim.teamMembers(e.team);
      this.role = e.char === 'builder' ? 'defend' : e.char === 'spy' ? 'attack' : (mates.indexOf(e) % 2 === 0 ? 'attack' : 'defend');
    }
    // Carrying: run home, only swinging at whoever blocks the way
    if (theirs.carrier === e.id) {
      this.goal = mine.home;
      if (near) { this.target = near; this.wantAttack = Math.random() < this.diff.attackChance + 0.15; }
      return true;
    }
    // Our treasure is lying around: the closest ones return it
    if (mine.state === 'dropped' && distXZ(e.pos, mine) < 18) { this.goal = { x: mine.x, y: mine.y, z: mine.z }; return true; }
    // Our treasure was taken: hunt the carrier (the gems glitter, so everyone knows where)
    if (mine.state === 'carried') {
      const c = sim.get(mine.carrier);
      if (c && (this.role === 'defend' || distXZ(e.pos, c.pos) < 15)) {
        if (dist3(e.pos, c.pos) <= this.range() + 0.2) this.engage(c);
        else { this.target = near; this.goal = c.pos; this.wantAttack = !!near; }
        return true;
      }
    }
    // Their treasure is close and free: grab it
    if (theirs.state !== 'carried' && distXZ(e.pos, theirs) < 10) {
      this.goal = { x: theirs.x, y: theirs.y, z: theirs.z };
      if (near) { this.target = near; this.wantAttack = true; }
      return true;
    }
    if (urgent) return false;
    if (this.role === 'attack') {
      // Escort a teammate carrying their treasure, else go for it
      const carrier = theirs.state === 'carried' ? sim.get(theirs.carrier) : null;
      this.goal = carrier ? carrier.pos : { x: theirs.x, y: theirs.y, z: theirs.z };
      return true;
    }
    // Defend: hold a spot near our treasure, facing the doors
    if (!this.guardSpot || (distXZ(e.pos, this.guardSpot) < 1.5 && Math.random() < 0.05)) {
      const h = mine.home;
      const spots = sim.nav.nodes.filter((n) => { const d = distXZ(n, h); return d > 3 && d < 9; });
      this.guardSpot = spots[Math.floor(Math.random() * spots.length)] || h;
    }
    this.goal = this.guardSpot;
    if (distXZ(e.pos, this.guardSpot) < 1.5) this.lookYaw = yawTo(e.team === 'yellow' ? 1 : -1, 0) + Math.sin(sim.time * 0.6) * 0.7;
    return true;
  }

  thinkLongman(ctx) {
    const { sim, e } = this;
    const def = CHARACTERS.longman;
    if (e.hearts <= 3 && e.specialCd <= 0 && e.hearts < e.maxHearts && Math.random() < this.diff.specialChance * 0.5) this.pressSpecial = true;
    // Hit by something we can't see: flashlight on and sweep around
    const attacker = sim.get(e.lastAttacker);
    if (sim.time - e.lastHurtT < 0.25 && attacker && !ctx.vis.includes(attacker)) {
      if (Math.random() < this.diff.specialChance + 0.2) {
        this.sweepT = 6;
        this.sweepBase = e.yaw + Math.PI * (Math.random() < 0.5 ? 0.5 : -0.5);
        if (!e.flashlight) this.pressFlash = true;
      }
    }
    const enemySpyAlive = sim.entities.some((o) => o.alive && o.team !== e.team && o.char === 'spy');
    const wantLight = this.sweepT > 0 || (enemySpyAlive && this.idleFlash);
    if (wantLight !== e.flashlight && !this.pressFlash && Math.random() < 0.3) this.pressFlash = true;
    if (this.sweepT > 0) {
      this.sweepT -= 0.2;
      if (!ctx.nearest) {
        this.lookYaw = this.sweepBase + Math.sin(sim.time * 2.2) * 1.3;
        return true; // stand and search
      }
    }
    void def;
    return false;
  }

  thinkBuilder(ctx) {
    const { sim, e } = this;
    const def = CHARACTERS.builder;
    const tower = sim.towers.find((t) => t.id === e.towerId);
    const { nearest, nd } = ctx;

    if (!tower) {
      if (!e.hasPrimary || e.specialCd > 0 || !this.useSpecials) return false;
      if (nearest && nd < 5) return false; // fight first
      if (!this.buildSpot) this.buildSpot = this.pickBuildSpot();
      const d = distXZ(e.pos, this.buildSpot);
      if (d > 1.0) { this.goal = this.buildSpot; return true; }
      // Face toward the enemy side and build
      this.lookYaw = yawTo(e.team === 'yellow' ? 1 : -1, 0);
      this.holdSpecial = true;
      this.holdT += 0.2;
      if (this.holdT > def.buildTime + 1.2) { this.buildSpot = null; this.holdT = 0; }
      return true;
    }
    this.buildSpot = null;
    this.holdT = 0;
    const enemies = sim.entities.filter((o) => o.alive && o.team !== e.team);
    const near = enemies.filter((o) => (o.char !== 'spy' || o.revealed) &&
      Math.hypot(o.pos.x - tower.x, o.pos.z - tower.z) <= def.collapseRadius + 0.3 && o.pos.y < tower.y + tower.height);
    const needed = Math.min(2, enemies.length);
    const onTop = e.onGround && e.standingOn && e.standingOn.tower === tower.id;
    const worth = near.length >= needed && (e.hearts > 1 || near.length >= 2 || near.some((o) => o.hearts <= 4));
    if (onTop) {
      this.goal = { x: tower.x, y: tower.y + tower.height, z: tower.z };
      if (worth && near.length > 0) { this.crouch = true; this.pressJump = true; return true; }
      // Nail gun: shoot enemies outside the blind spot and inside range
      const inBand = ctx.ready.find((o) => {
        const d = Math.hypot(o.pos.x - tower.x, o.pos.z - tower.z);
        return d >= def.nailMinRange + 0.3 && d <= def.nailMaxRange - 1;
      });
      if (inBand && e.weapon === 'nailgun') {
        this.target = inBand;
        this.wantAttack = Math.random() < this.diff.attackChance + 0.15;
        return true;
      }
      // Lookout: face the nearest threat or the enemy side
      if (nearest) this.target = nearest;
      else this.lookYaw = yawTo(e.team === 'yellow' ? 1 : -1, 0) + Math.sin(sim.time * 0.7) * 0.8;
      return true;
    }
    const dt = distXZ(e.pos, tower);
    if (worth && dt < 8 && e.hearts > 1) { this.goal = { x: tower.x, y: tower.y, z: tower.z }; return true; }
    if (nearest && nd <= this.range() + 0.5) return false;
    if (nearest && nd < 5 && dt > 3) return false;
    this.goal = { x: tower.x, y: tower.y, z: tower.z };
    return true;
  }

  pickBuildSpot() {
    const { sim, e } = this;
    const side = e.team === 'yellow' ? -1 : 1;
    // Capture the treasure: guard our treasure; otherwise cover the middle of our half
    const home = sim.mode === 'ctf' ? sim.map.homes[e.team] : null;
    const [x0, x1] = sim.map.buildX || [2, 13];
    const cands = home
      ? sim.nav.nodes.filter((n) => n.y === 0 && distXZ(n, home) > 4 && distXZ(n, home) < 9)
      : sim.nav.nodes.filter((n) => n.y === 0 && n.x * side > x0 && n.x * side < x1 && Math.abs(n.z) < 11);
    return cands[Math.floor(Math.random() * cands.length)] || { x: e.pos.x, y: 0, z: e.pos.z };
  }

  thinkDoctor(ctx) {
    const { sim, e } = this;
    const def = CHARACTERS.doctor;
    const mates = sim.entities.filter((o) => o.alive && o.team === e.team);
    const hurt = mates.filter((o) => o !== e && o.hearts < o.maxHearts)
      .sort((a, b) => a.hearts / a.maxHearts - b.hearts / b.maxHearts);
    // Bottle: 2+ hurt teammates close together
    if (e.specialCd <= 0 && this.useSpecials) {
      const allHurt = mates.filter((o) => o.hearts < o.maxHearts);
      for (const h of allHurt) {
        const cluster = allHurt.filter((o) => distXZ(o.pos, h.pos) < 3);
        const d = distXZ(e.pos, h.pos);
        if (cluster.length >= 2 && d < 14 && (h === e || lineClear(sim.eye(e), sim.chest(h), sim.solids))) {
          this.throwAt = h === e ? { x: e.pos.x, y: e.pos.y, z: e.pos.z } : { x: h.pos.x, y: h.pos.y + 0.6, z: h.pos.z };
          break;
        }
      }
    }
    if (hurt.length && e.weapon === 'axe') {
      if (ctx.nearest && ctx.nd < 2.2) return false; // self-defense
      const h = hurt[0];
      const d = dist3(e.pos, h.pos);
      this.target = h;
      this.goal = d > 1.5 ? h.pos : null;
      this.wantAttack = d <= this.range();
      return true;
    }
    if (this.throwAt) return true;
    return false;
  }

  thinkSpy(ctx) {
    const { sim, e } = this;
    const def = CHARACTERS.spy;
    // Retreat from any enemy flashlight pointing our way
    for (const l of sim.entities) {
      if (!l.alive || !l.flashlight || l.team === e.team) continue;
      const ld = CHARACTERS[l.char];
      const d = distXZ(l.pos, e.pos);
      if (d > ld.flashlightRange + 4) continue;
      const a = Math.abs(angleDiff(yawTo(e.pos.x - l.pos.x, e.pos.z - l.pos.z), l.yaw));
      if (a < ld.flashlightAngle * 1.8 * DEG) { this.retreatT = 1.5; this.retreatFrom = { x: l.pos.x, z: l.pos.z }; }
    }
    if (this.retreatT > 0) {
      this.retreatT -= 0.2;
      const dx = e.pos.x - this.retreatFrom.x, dz = e.pos.z - this.retreatFrom.z;
      const l = Math.hypot(dx, dz) || 1;
      const perp = (Math.random() < 0.5 ? 1 : -1);
      this.goal = { x: e.pos.x + (dx / l) * 5 - (dz / l) * 3 * perp, y: e.pos.y, z: e.pos.z + (dz / l) * 5 + (dx / l) * 3 * perp };
      return true;
    }
    // Choose a victim: Doctor > Builder > anyone, preferring armed ones when steal is ready
    let T = this.spyTarget && this.spyTarget.alive ? this.spyTarget : null;
    if (!T) {
      const enemies = sim.entities.filter((o) => o.alive && o.team !== e.team && o.char !== 'spy');
      const prio = { doctor: 0, builder: 1, longman: 2 };
      enemies.sort((a, b) => (prio[a.char] - prio[b.char]) || (distXZ(e.pos, a.pos) - distXZ(e.pos, b.pos)));
      T = enemies[0] || null;
      this.spyTarget = T;
      if (T && sim.mode !== 'ctf' && Math.abs(T.pos.z) < 12 && distXZ(e.pos, T.pos) > 14) {
        const side = e.pos.z >= 0 ? 1 : -1;
        this.flankPoint = { x: (e.pos.x + T.pos.x) / 2, y: 0, z: sim.map.flankZ * side };
      }
    }
    if (!T) return false;
    // Capture the treasure: only mug enemies close by, otherwise go thieving
    if (sim.mode === 'ctf' && distXZ(e.pos, T.pos) > 10) { this.spyTarget = null; return false; }
    // Sneak through a side corridor first
    if (this.flankPoint) {
      if (distXZ(e.pos, this.flankPoint) < 2.5 || distXZ(e.pos, T.pos) < 8) this.flankPoint = null;
      else { this.goal = this.flankPoint; return true; }
    }
    // Weapon choice: any stolen weapon is at least as good as bare fists
    const want = e.stolen ? 2 : 1;
    if (want !== e.slot) this.slot = want;

    const d = dist3(e.pos, T.pos);
    if (T.hasPrimary && e.specialCd <= 0) {
      this.target = T;
      this.goal = T.pos;
      if (d < def.stealRange - 0.2) this.pressSpecial = true;
      return true;
    }
    const f = forwardVec(T.yaw);
    const behind = { x: T.pos.x - f.x * 1.1, y: T.pos.y, z: T.pos.z - f.z * 1.1 };
    this.target = T;
    this.goal = d < 1.0 ? null : behind;
    const isBehind = sim.isBehind(e, T);
    this.wantAttack = d <= this.range() && (isBehind || e.slot === 2 || d < 1.3 || e.hearts < 3);
    return true;
  }

  // ---------- Steering ----------

  ballisticPitch(from, to) {
    const def = CHARACTERS.doctor;
    const v = def.bottleSpeed, g = GAME.bottleGravity;
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    let best = -0.2, be = Infinity;
    for (let p = -0.6; p < 1.2; p += 0.02) {
      const vh = v * Math.cos(p);
      const t = d / vh;
      const y = from.y + (v * Math.sin(p) + 2.5) * t + 0.5 * g * t * t;
      const err = Math.abs(y - to.y);
      if (err < be) { be = err; best = p; }
    }
    return best;
  }

  steer(dt) {
    const { sim, e } = this;
    const inp = e.input;
    const diff = this.diff;

    // Aim wobble drifts slowly so aim feels human
    this.wobbleT -= dt;
    if (this.wobbleT <= 0) { this.wobbleT = 0.4 + Math.random() * 0.4; this.wobbleGoal = (Math.random() * 2 - 1) * diff.wobble * DEG; }
    this.wobble += (this.wobbleGoal - this.wobble) * Math.min(1, dt * 4);

    let mx = 0, mz = 0;
    if (this.goal) {
      const wp = this.nextWaypoint(dt);
      if (wp) {
        const dx = wp.x - e.pos.x, dz = wp.z - e.pos.z;
        const l = Math.hypot(dx, dz);
        if (l > 0.35) { mx = dx / l; mz = dz / l; }
      }
    }
    // Over a void: never step off an edge (in the air too, so a jump can't carry us out)
    const edgeAhead = (x, z) => {
      if (!sim.map.bounds.void || !(x || z)) return false;
      const l = Math.hypot(x, z), ahead = CHARACTERS[e.char].radius + 0.35;
      return !groundAt(e.pos.x + x / l * ahead, e.pos.z + z / l * ahead, e.pos.y, sim.solids, 3);
    };
    if (edgeAhead(mx, mz)) { mx = 0; mz = 0; } // held back by the edge: not stuck
    // Unstick: strafe and jump if we haven't moved for a while
    if (mx || mz) {
      this.stuckT += dt;
      if (this.stuckT > 0.8) {
        if (this.lastPos && distXZ(this.lastPos, e.pos) < 0.3 && !e.climbing) {
          this.unstickT = 0.6;
          this.strafe = Math.random() < 0.5 ? -1 : 1;
          this.pressJump = true;
          this.repathT = 0;
        }
        this.lastPos = { x: e.pos.x, z: e.pos.z };
        this.stuckT = 0;
      }
    }
    if (this.unstickT > 0) {
      this.unstickT -= dt;
      const sx = -mz * this.strafe, sz = mx * this.strafe;
      mx = mx * 0.3 + sx; mz = mz * 0.3 + sz;
    }
    if (edgeAhead(mx, mz)) { mx = 0; mz = 0; }

    // Facing
    const eye = sim.eye(e);
    let faceYaw = (mx || mz) ? yawTo(mx, mz) : e.yaw;
    let facePitch = 0;
    if (this.throwAt) {
      const t = this.throwAt;
      faceYaw = yawTo(t.x - e.pos.x, t.z - e.pos.z);
      facePitch = Math.hypot(t.x - e.pos.x, t.z - e.pos.z) < 1 ? -1.2 : this.ballisticPitch(eye, t);
    } else if (this.target) {
      let c = sim.chest(this.target);
      if (e.weapon === 'nailgun') {
        // Lead moving targets and aim above them to cancel the nail's drop
        const bd = CHARACTERS.builder;
        const t = Math.hypot(c.x - eye.x, c.z - eye.z) / bd.nailSpeed;
        const v = this.target.vel || { x: 0, z: 0 };
        c = { x: c.x + v.x * t, y: c.y - 0.5 * bd.nailGravity * t * t, z: c.z + v.z * t };
      }
      faceYaw = yawTo(c.x - eye.x, c.z - eye.z) + this.wobble;
      facePitch = Math.atan2(c.y - eye.y, Math.hypot(c.x - eye.x, c.z - eye.z)) + this.wobble * 0.3;
    } else if (this.lookYaw !== null) {
      faceYaw = this.lookYaw;
    }
    const turnRate = (sim.difficulty === 'hard' ? 14 : sim.difficulty === 'easy' ? 6 : 9) * dt;
    const dy = angleDiff(faceYaw, e.yaw);
    const yaw = e.yaw + Math.max(-turnRate, Math.min(turnRate, dy));
    const pitch = e.pitch + Math.max(-turnRate, Math.min(turnRate, facePitch - e.pitch));

    // Convert world move direction into forward/right relative to the new yaw
    const f = forwardVec(yaw);
    inp.fwd = mx * f.x + mz * f.z;
    inp.right = mx * -f.z + mz * f.x;
    inp.yaw = yaw;
    inp.pitch = Math.max(-1.4, Math.min(1.4, pitch));
    inp.crouch = this.crouch;
    inp.jump = false;
    inp.jumpPressed = this.pressJump;
    this.pressJump = false;
    // Doctor: double-jump over trouble now and then
    if (e.char === 'doctor' && !e.onGround && e.vel.y < 0 && this.target && this.target.team !== e.team && Math.random() < dt * 0.8) inp.jumpPressed = true;

    const aligned = Math.abs(angleDiff(faceYaw, yaw)) < (e.weapon === 'nailgun' ? 4 : 25) * DEG;
    inp.attack = this.wantAttack && aligned;
    inp.special = this.holdSpecial;
    if (this.pressSpecial && (aligned || e.char === 'longman')) { inp.specialPressed = true; this.pressSpecial = false; }
    if (this.throwAt && Math.abs(angleDiff(faceYaw, yaw)) < 6 * DEG && Math.abs(facePitch - pitch) < 0.05 && e.specialCd <= 0) {
      inp.specialPressed = true;
      this.throwAt = null;
    }
    if (this.pressFlash) { inp.flashPressed = true; this.pressFlash = false; }
    if (this.slot) { inp.slot = this.slot; this.slot = 0; }
  }

  nextWaypoint(dt) {
    const { sim, e } = this;
    const goal = this.goal;
    const eye = { x: e.pos.x, y: e.pos.y + 0.8, z: e.pos.z };
    const g = { x: goal.x, y: (goal.y || 0) + 0.8, z: goal.z };
    if (distXZ(e.pos, goal) < 6 && Math.abs((goal.y || 0) - e.pos.y) < 1.2 && lineClear(eye, g, sim.solids) &&
      (!sim.map.bounds.void || groundAlong(e.pos, goal, sim.solids))) {
      this.path = [];
      return goal;
    }
    // Climbing a tower: keep pushing straight in
    if (e.climbing) return goal;
    this.repathT -= dt;
    if (this.repathT <= 0 || !this.pathGoal || distXZ(this.pathGoal, goal) > 2) {
      this.repathT = 1 + Math.random() * 0.5;
      this.pathGoal = { x: goal.x, y: goal.y || 0, z: goal.z };
      const a = nearestNode(sim.nav, e.pos, sim.solids);
      const b = nearestNode(sim.nav, this.pathGoal, sim.solids, false);
      this.path = findPath(sim.nav, a, b);
    }
    while (this.path.length && distXZ(e.pos, this.path[0]) < 0.9 && Math.abs(this.path[0].y - e.pos.y) < 1.6) this.path.shift();
    return this.path[0] || goal;
  }
}
