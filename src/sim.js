// Authoritative game simulation: rounds, picks, combat, specials.
// No DOM and no Three.js, so it runs in a browser (offline / host) or in Node.
import { CHARACTERS, CHARACTER_ORDER, WEAPONS, GAME, TEAMS, projectileGravity } from './config.js';
import { buildMap } from './map.js';
import {
  stepMovement, buildNav, towerBox, lookDir, forwardVec, yawTo, angleDiff,
  lineClear, raycast, overlapsBox, entityHeight,
} from './physics.js';
import { BotBrain } from './bots.js';

const DEG = Math.PI / 180;
const BOT_NAMES = ['Bolt', 'Pickle', 'Rusty', 'Mango', 'Sprocket', 'Noodle', 'Gizmo', 'Waffle', 'Biscuit', 'Turnip', 'Pebble', 'Muffin', 'Nugget', 'Crumpet'];

export function emptyInput(yaw = 0) {
  return {
    fwd: 0, right: 0, jump: false, jumpPressed: false, crouch: false,
    yaw, pitch: 0, attack: false, special: false, specialPressed: false,
    flashPressed: false, slot: 0,
  };
}

const r2 = (v) => Math.round(v * 100) / 100;

export class Sim {
  constructor({ teamSize = GAME.teamSize, difficulty = 'normal', mapId = 'arena' } = {}) {
    this.teamSize = teamSize;
    this.difficulty = difficulty;
    this.entities = [];
    this.towers = [];
    this.projectiles = [];
    this.flags = [];
    this.events = [];
    this.time = 0;
    this.phase = 'lobby';
    this.phaseT = 0;
    this.round = 0;
    this.score = { yellow: 0, teal: 0 };
    this.winner = null;
    this.matchWinner = null;
    this.nextId = 1;
    this.botNameIdx = Math.floor(Math.random() * BOT_NAMES.length);
    this.setMap(mapId);
  }

  // Only between matches: the lobby switches maps
  setMap(id) {
    this.map = buildMap(id);
    this.mapId = this.map.id;
    this.mode = this.map.mode; // 'elimination' | 'ctf'
    this.nav = buildNav(this.map.boxes, this.map.bounds);
    this.towers = [];
    this.projectiles = [];
    this.flags = [];
    this.updateSolids();
  }

  roundTime() { return this.mode === 'ctf' ? GAME.ctfRoundTime : GAME.roundTime; }

  // ---------- Roster ----------

  makeEntity(id, name, team, isBot) {
    const e = {
      id, name, team, isBot, remote: false,
      char: 'longman', pick: null, lastChar: null,
      alive: false, hearts: 0, maxHearts: 0,
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0, onGround: true, crouch: false, jumpsUsed: 0,
      pounding: false, climbing: false, standingOn: null,
      weapon: null, slot: 1, hasPrimary: true, stolen: null,
      attackCd: 0, specialCd: 0, specialMax: 1, buildT: 0,
      flashlight: false, flickerT: 0, revealed: false,
      attackSeq: 0, spawnSeq: 0, kills: 0, deaths: 0, heals: 0,
      lastHurtT: -99, lastAttacker: null, towerId: null, deathT: 0, respawnT: 0, captures: 0,
      cloakT: 0, onTower: false, prevWeapon: null,
      input: emptyInput(), net: { spc: 0, flc: 0, pdc: 0 },
      brain: null,
    };
    if (isBot) e.brain = new BotBrain(this, e);
    return e;
  }

  botName() {
    const n = BOT_NAMES[this.botNameIdx++ % BOT_NAMES.length];
    return `${n} (bot)`;
  }

  teamMembers(team) { return this.entities.filter((e) => e.team === team); }
  get(id) { return this.entities.find((e) => e.id === id); }

  fillBots() {
    for (const team of TEAMS) {
      let members = this.teamMembers(team);
      while (members.length < this.teamSize) {
        const e = this.makeEntity('b' + this.nextId++, this.botName(), team, true);
        this.entities.push(e);
        members.push(e);
      }
      while (members.length > this.teamSize) {
        const bot = [...members].reverse().find((m) => m.isBot);
        if (!bot) break;
        this.entities.splice(this.entities.indexOf(bot), 1);
        members = this.teamMembers(team);
      }
    }
  }

  setTeamSize(n) {
    this.teamSize = Math.max(1, Math.min(6, n | 0));
    this.fillBots();
  }

  addHuman(id, name, preferredTeam) {
    const humans = (t) => this.teamMembers(t).filter((e) => !e.isBot).length;
    let team = preferredTeam;
    if (!team) team = humans('yellow') <= humans('teal') ? 'yellow' : 'teal';
    const members = this.teamMembers(team);
    if (members.length >= this.teamSize) {
      const bot = members.find((m) => m.isBot);
      if (!bot) {
        // That team is full of humans: try the other one, else grow the teams
        const other = team === 'yellow' ? 'teal' : 'yellow';
        if (this.teamMembers(other).some((m) => m.isBot)) return this.addHuman(id, name, other);
        if (this.teamSize < 6) { this.teamSize++; this.fillBots(); return this.addHuman(id, name, team); }
        team = other;
      } else {
        // Take over the bot's slot. Mid-round the human spectates until the next pick.
        this.entities.splice(this.entities.indexOf(bot), 1);
      }
    }
    const e = this.makeEntity(id, name, team, false);
    e.alive = false;
    this.entities.push(e);
    this.fillBots();
    this.emit({ type: 'join', id, name, team });
    return e;
  }

  removeHuman(id) {
    const e = this.get(id);
    if (!e) return;
    // The slot becomes a bot that keeps playing the current character
    e.isBot = true;
    e.remote = false;
    this.emit({ type: 'leave', id, name: e.name });
    e.name = this.botName();
    e.brain = new BotBrain(this, e);
    e.input = emptyInput(e.yaw);
  }

  setTeam(id, team) {
    const e = this.get(id);
    if (!e || e.team === team || !TEAMS.includes(team)) return;
    const members = this.teamMembers(team);
    if (members.length >= this.teamSize) {
      const bot = members.find((m) => m.isBot);
      if (!bot) return;
      bot.team = e.team;
    }
    e.team = team;
    e.alive = false;
    e.pick = null;
  }

  // ---------- Events ----------

  emit(ev) { ev.t = this.time; this.events.push(ev); }
  drainEvents() { const ev = this.events; this.events = []; return ev; }

  // ---------- Round flow ----------

  newMatch() {
    this.score = { yellow: 0, teal: 0 };
    this.round = 0;
    this.matchWinner = null;
    for (const e of this.entities) { e.kills = 0; e.deaths = 0; e.heals = 0; e.captures = 0; }
    this.fillBots();
    this.startPick();
  }

  toLobby() {
    this.phase = 'lobby';
    this.round = 0;
    this.score = { yellow: 0, teal: 0 };
    this.towers = [];
    this.projectiles = [];
    this.flags = [];
    this.updateSolids();
    for (const e of this.entities) { e.alive = false; e.pick = null; e.flashlight = false; }
  }

  startPick() {
    this.phase = 'pick';
    this.phaseT = GAME.pickTime;
    this.winner = null;
    this.towers = [];
    this.projectiles = [];
    this.updateSolids();
    for (const e of this.entities) {
      e.pick = null;
      e.alive = false;
      e.flashlight = false;
      if (e.brain) e.brain.pickDelay = 0.4 + Math.random() * 1.5;
    }
    this.emit({ type: 'pickStart', round: this.round + 1 });
  }

  canPick(e, char) {
    if (!CHARACTERS[char]) return false;
    const n = this.entities.filter((o) => o !== e && o.team === e.team && o.pick === char).length;
    return n < GAME.maxSameCharacter;
  }

  setPick(id, char) {
    const e = this.get(id);
    if (!e || !this.canPick(e, char)) return false;
    // With respawns, the dead may switch character for their next life
    const respawning = this.mode === 'ctf' && !e.alive && (this.phase === 'countdown' || this.phase === 'play');
    if (this.phase !== 'pick' && !respawning) return false;
    e.pick = char;
    this.emit({ type: 'pick', id, char });
    return true;
  }

  botPick(e) {
    const team = this.teamMembers(e.team);
    const counts = {};
    for (const c of CHARACTER_ORDER) counts[c] = team.filter((o) => o !== e && o.pick === c).length;
    const weights = { longman: 3, builder: 3, doctor: 3, spy: 2 };
    if (counts.doctor === 0) weights.doctor += 4;
    if (counts.longman === 0) weights.longman += 3;
    if (counts.spy >= 1) weights.spy = 0.3;
    let best = null, bw = -1;
    for (const c of CHARACTER_ORDER) {
      if (!this.canPick(e, c)) continue;
      const w = (weights[c] / (1 + counts[c] * 2)) * (0.5 + Math.random());
      if (w > bw) { bw = w; best = c; }
    }
    if (best) this.setPick(e.id, best);
  }

  updatePick(dt) {
    this.phaseT -= dt;
    const elapsed = GAME.pickTime - this.phaseT;
    for (const e of this.entities) {
      if (!e.isBot || e.pick) continue;
      // Bots wait for the humans on their team so they can fill in around them
      const humansPending = this.entities.some((o) => !o.isBot && o.team === e.team && !o.pick);
      e.brain.pickDelay -= dt;
      if (e.brain.pickDelay <= 0 && (!humansPending || elapsed > GAME.pickTime * 0.6)) this.botPick(e);
    }
    const allPicked = this.entities.every((e) => e.pick);
    if (allPicked && this.phaseT > 1.5) this.phaseT = 1.5;
    if (this.phaseT <= 0) this.startRound();
  }

  startRound() {
    this.round++;
    this.towers = [];
    this.projectiles = [];
    this.updateSolids();
    for (const e of this.entities) {
      if (!e.pick) {
        const pref = [e.lastChar, ...CHARACTER_ORDER.slice().sort(() => Math.random() - 0.5)];
        e.pick = pref.find((c) => c && this.canPick(e, c));
      }
    }
    for (const team of TEAMS) {
      const spawns = this.map.spawns[team];
      this.teamMembers(team).forEach((e, i) => { e.respawnT = 0; this.spawn(e, spawns[i % spawns.length]); });
    }
    this.flags = this.mode === 'ctf' ? TEAMS.map((team) => {
      const h = this.map.homes[team];
      return { team, home: { ...h }, x: h.x, y: h.y, z: h.z, state: 'home', carrier: null, dropT: 0 };
    }) : [];
    this.lastStand = { yellow: false, teal: false };
    this.pingNext = { yellow: 0, teal: 0 };
    this.lastStandT = { yellow: 0, teal: 0 };
    this.phase = 'countdown';
    this.phaseT = GAME.countdown;
    this.emit({ type: 'roundStart', round: this.round });
  }

  spawn(e, sp) {
    const def = CHARACTERS[e.pick];
    e.char = e.pick;
    e.lastChar = e.pick;
    e.alive = true;
    e.hearts = e.maxHearts = def.hearts;
    e.weapon = def.primary;
    e.slot = 1;
    e.hasPrimary = true;
    e.stolen = null;
    e.attackCd = 0; e.specialCd = 0; e.specialMax = 1;
    e.buildT = 0; e.flashlight = false; e.flickerT = 0; e.revealed = false;
    e.towerId = null; e.pounding = false; e.climbing = false; e.crouch = false;
    e.cloakT = 0; e.onTower = false; e.prevWeapon = null;
    e.pos = { x: sp.x, y: sp.y, z: sp.z };
    e.vel = { x: 0, y: 0, z: 0 };
    e.yaw = sp.yaw; e.pitch = 0;
    e.onGround = true;
    e.input = emptyInput(sp.yaw);
    e.spawnSeq++;
    if (e.brain) e.brain.reset();
  }

  endRound(winner) {
    this.phase = 'roundEnd';
    this.phaseT = GAME.roundEndTime;
    this.winner = winner;
    if (winner !== 'draw') this.score[winner]++;
    this.emit({ type: 'roundEnd', winner, score: { ...this.score } });
  }

  checkRoundEnd() {
    const alive = { yellow: 0, teal: 0 };
    for (const e of this.entities) if (e.alive) alive[e.team]++;
    if (alive.yellow === 0 && alive.teal === 0) this.endRound('draw');
    else if (alive.yellow === 0) this.endRound('teal');
    else if (alive.teal === 0) this.endRound('yellow');
  }

  timeUp() {
    if (this.mode === 'ctf') {
      this.emit({ type: 'timeUp', ctf: true });
      this.endRound('draw');
      return;
    }
    const hearts = { yellow: 0, teal: 0 };
    for (const e of this.entities) if (e.alive) hearts[e.team] += e.hearts;
    this.emit({ type: 'timeUp', hearts });
    if (hearts.yellow === hearts.teal) this.endRound('draw');
    else this.endRound(hearts.yellow > hearts.teal ? 'yellow' : 'teal');
  }

  // ---------- Main tick ----------

  tick(dt) {
    this.time += dt;
    switch (this.phase) {
      case 'lobby':
        return;
      case 'pick':
        this.updatePick(dt);
        return;
      case 'countdown':
        this.phaseT -= dt;
        this.updateEntities(dt, false);
        if (this.phaseT <= 0) {
          this.phase = 'play';
          this.phaseT = this.roundTime();
          this.emit({ type: 'fight' });
        }
        return;
      case 'play':
        this.phaseT -= dt;
        this.updateEntities(dt, true);
        if (this.mode === 'ctf') {
          this.updateRespawns(dt);
          this.updateFlags(dt);
        } else {
          this.updateLastStand(dt);
          if (this.phase === 'play') this.checkRoundEnd();
        }
        if (this.phase === 'play' && this.phaseT <= 0) this.timeUp();
        return;
      case 'roundEnd':
        this.phaseT -= dt;
        this.updateEntities(dt, true);
        if (this.phaseT <= 0) {
          const champ = TEAMS.find((t) => this.score[t] >= GAME.roundsToWin);
          if (champ) {
            this.phase = 'matchEnd';
            this.phaseT = GAME.matchEndTime;
            this.matchWinner = champ;
            this.emit({ type: 'matchEnd', winner: champ, score: { ...this.score } });
          } else {
            this.startPick();
          }
        }
        return;
      case 'matchEnd':
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.newMatch();
        return;
    }
  }

  updateEntities(dt, active) {
    for (const e of this.entities) if (e.brain && e.alive) e.brain.update(dt);

    // Shuffled order so neither team always lands the first hit in a trade
    const order = this.entities.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const e of order) {
      if (!e.alive) continue;
      const def = CHARACTERS[e.char];
      const inp = e.input;
      if (!e.remote) {
        e.yaw = inp.yaw;
        e.pitch = inp.pitch;
        const mvInput = active ? inp : { ...emptyInput(), crouch: inp.crouch };
        const mv = stepMovement(e, def, mvInput, dt, this.solids, e.towerId, this.map.bounds);
        if (mv.poundLanded) this.tryCollapse(e, mv.poundLanded);
        if (mv.landed > 9) this.emit({ type: 'land', id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z });
      }
      if (this.map.killY !== undefined && e.pos.y < this.map.killY) { this.fallOut(e); continue; }
      this.updateTowerGun(e);
      if (active) this.doActions(e, def, inp, dt);
      if (active && def.cloakEvery) this.updateCloak(e, def, dt);
      e.attackCd = Math.max(0, e.attackCd - dt);
      e.specialCd = Math.max(0, e.specialCd - dt);
      e.flickerT = Math.max(0, e.flickerT - dt);
      inp.jumpPressed = false;
      inp.specialPressed = false;
      inp.flashPressed = false;
      inp.slot = 0;
    }
    this.updateProjectiles(dt);
    this.separate();
    this.updateReveals();
  }

  // ---------- Actions ----------

  doActions(e, def, inp, dt) {
    if (inp.slot === 1 || inp.slot === 2) this.switchSlot(e, def, inp.slot);

    if (inp.attack && e.attackCd <= 0 && e.buildT <= 0) this.attack(e, def);

    switch (def.special) {
      case 'medkit':
        if (inp.specialPressed) {
          if (e.specialCd > 0) break;
          if (e.hearts >= e.maxHearts) { this.fail(e, 'Already at full hearts'); break; }
          this.heal(e, def.medkitHeal, e);
          e.specialCd = e.specialMax = def.medkitCooldown;
          this.emit({ type: 'medkit', id: e.id });
        }
        if (inp.flashPressed) {
          e.flashlight = !e.flashlight;
          this.emit({ type: 'flash', id: e.id, on: e.flashlight });
        }
        break;
      case 'tower': {
        const can = e.hasPrimary && e.towerId === null && e.specialCd <= 0 && e.onGround;
        if (inp.special && can) {
          e.buildT += dt;
          if (e.buildT >= def.buildTime) { e.buildT = 0; this.placeTower(e, def); }
        } else {
          if (inp.specialPressed && !can) {
            if (!e.hasPrimary) this.fail(e, 'No wrench, no towers');
            else if (e.towerId !== null) this.fail(e, 'Only one tower at a time');
            else if (e.specialCd > 0) this.fail(e, 'Tower not ready');
          }
          e.buildT = 0;
        }
        break;
      }
      case 'bottle':
        if (inp.specialPressed && e.specialCd <= 0) {
          const d = lookDir(e.yaw, e.pitch);
          const eye = this.eye(e);
          this.projectiles.push({
            id: this.nextId++, type: 'bottle', team: e.team, owner: e.id,
            x: eye.x + d.x * 0.5, y: eye.y + d.y * 0.5 - 0.1, z: eye.z + d.z * 0.5,
            vx: d.x * def.bottleSpeed, vy: d.y * def.bottleSpeed + 2.5, vz: d.z * def.bottleSpeed,
            life: 5,
          });
          e.specialCd = e.specialMax = def.bottleCooldown;
          this.emit({ type: 'throw', id: e.id });
        }
        break;
      case 'steal':
        if (inp.specialPressed && e.specialCd <= 0) this.trySteal(e, def);
        break;
    }
  }

  fail(e, reason) { this.emit({ type: 'fail', id: e.id, reason }); }

  switchSlot(e, def, slot) {
    if (e.onTower) return; // the nail gun is the only weapon up there
    let w = null;
    if (def.special === 'steal') w = slot === 1 ? def.primary : e.stolen;
    else w = slot === 1 ? (e.hasPrimary ? def.primary : null) : def.backup;
    if (w && w !== e.weapon) {
      e.weapon = w;
      e.slot = slot;
      e.attackCd = Math.max(e.attackCd, 0.25);
    }
  }

  eye(e) {
    const def = CHARACTERS[e.char];
    return { x: e.pos.x, y: e.pos.y + def.eye * (e.crouch ? GAME.crouchHeightScale : 1), z: e.pos.z };
  }

  chest(e) {
    const def = CHARACTERS[e.char];
    return { x: e.pos.x, y: e.pos.y + entityHeight(e, def) * 0.6, z: e.pos.z };
  }

  // Finds the best target in front of e. filter(o) decides who counts.
  coneTarget(e, range, arcDeg, filter) {
    const eye = this.eye(e);
    let best = null, bd = Infinity;
    for (const o of this.entities) {
      if (o === e || !o.alive || !filter(o)) continue;
      const od = CHARACTERS[o.char];
      const oh = entityHeight(o, od);
      const ty = Math.max(o.pos.y + 0.2, Math.min(o.pos.y + oh - 0.1, eye.y));
      const dx = o.pos.x - eye.x, dy = ty - eye.y, dz = o.pos.z - eye.z;
      const hd = Math.hypot(dx, dz);
      const d = Math.hypot(hd, dy) - od.radius;
      if (d > range) continue;
      if (hd > 0.7) {
        if (Math.abs(angleDiff(yawTo(dx, dz), e.yaw)) > arcDeg * DEG) continue;
        if (Math.abs(Math.atan2(dy, hd) - e.pitch) > 65 * DEG) continue;
      }
      if (!lineClear(eye, { x: o.pos.x, y: ty, z: o.pos.z }, this.solids)) continue;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  isBehind(attacker, target) {
    const f = forwardVec(target.yaw);
    const dx = attacker.pos.x - target.pos.x, dz = attacker.pos.z - target.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    return (f.x * dx + f.z * dz) / l < -0.3;
  }

  attack(e, def) {
    const w = WEAPONS[e.weapon];
    if (!w) return;
    e.attackCd = w.cooldown;
    e.attackSeq++;
    if (def.special === 'steal') e.flickerT = Math.max(e.flickerT, def.flickerTime);
    if (w.kind === 'gun') { this.fireNail(e); return; }
    this.emit({ type: 'swing', id: e.id, weapon: e.weapon });
    const range = w.range + (e.remote ? 0.3 : 0);
    let hitSomething = false;

    if (w.kind === 'spin') {
      const c = this.chest(e);
      for (const o of this.entities) {
        if (o === e || !o.alive || o.team === e.team) continue;
        const od = CHARACTERS[o.char];
        const hd = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) - od.radius;
        if (hd > range) continue;
        if (o.pos.y > e.pos.y + def.height + 0.3 || o.pos.y + entityHeight(o, od) < e.pos.y - 0.3) continue;
        if (!lineClear(c, this.chest(o), this.solids)) continue;
        this.damage(o, w.damage, e, e.weapon);
        hitSomething = true;
      }
      for (const t of [...this.towers]) {
        if (t.team === e.team) continue;
        const hd = Math.max(Math.abs(t.x - e.pos.x), Math.abs(t.z - e.pos.z)) - t.size / 2;
        if (hd <= range && e.pos.y < t.y + t.height && e.pos.y + def.height > t.y) { this.damageTower(t, w.damage, e); hitSomething = true; }
      }
      return;
    }

    const target = this.coneTarget(e, range, w.arc, (o) => {
      if (o.team !== e.team) return true;
      return !!w.heal && o.hearts < o.maxHearts;
    });
    if (target) {
      if (target.team === e.team) {
        this.heal(target, w.heal, e);
      } else {
        const behind = w.backstab && this.isBehind(e, target);
        this.damage(target, behind ? w.backstab : w.damage, e, e.weapon, behind);
      }
      hitSomething = true;
    }
    if (!hitSomething) {
      const eye = this.eye(e);
      const d = lookDir(e.yaw, e.pitch);
      const hit = raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, range, this.solids);
      if (hit.box && hit.box.tower != null) {
        const t = this.towers.find((tt) => tt.id === hit.box.tower);
        if (t && t.team !== e.team) this.damageTower(t, w.damage, e);
      }
    }
  }

  damage(o, amount, attacker, cause, backstab = false) {
    if (!o.alive) return;
    o.hearts = Math.max(0, o.hearts - amount);
    o.lastHurtT = this.time;
    o.lastAttacker = attacker ? attacker.id : null;
    o.buildT = 0;
    if (o.char === 'spy') o.flickerT = Math.max(o.flickerT, 0.5);
    this.emit({
      type: 'hurt', id: o.id, by: attacker ? attacker.id : null, amount, cause, backstab,
      x: o.pos.x, y: o.pos.y + 1.2, z: o.pos.z,
    });
    if (o.hearts <= 0) this.kill(o, attacker, cause);
  }

  heal(o, amount, healer) {
    if (!o.alive) return 0;
    const add = Math.min(amount, o.maxHearts - o.hearts);
    if (add <= 0) return 0;
    o.hearts += add;
    if (healer && healer !== o) healer.heals += add;
    this.emit({ type: 'heal', id: o.id, by: healer ? healer.id : null, amount: add, x: o.pos.x, y: o.pos.y + 1.2, z: o.pos.z });
    return add;
  }

  kill(o, attacker, cause) {
    o.alive = false;
    o.hearts = 0;
    o.deaths++;
    o.deathT = this.time;
    o.flashlight = false;
    o.buildT = 0;
    if (attacker && attacker !== o) attacker.kills++;
    this.emit({ type: 'kill', victim: o.id, killer: attacker ? attacker.id : null, cause, x: o.pos.x, y: o.pos.y, z: o.pos.z });
    if (o.towerId !== null) {
      const t = this.towers.find((tt) => tt.id === o.towerId);
      if (t) this.removeTower(t, 'break');
    }
    if (this.mode === 'ctf') {
      o.respawnT = GAME.respawnTime;
      this.dropFlag(o);
    }
  }

  // Fell into the void. Whoever hit them last, recently, gets the kill.
  fallOut(e) {
    const by = this.time - e.lastHurtT < 6 ? this.get(e.lastAttacker) : null;
    this.kill(e, by, 'void');
  }

  trySteal(e, def) {
    const t = this.coneTarget(e, def.stealRange, 50, (o) => o.team !== e.team && o.char !== 'spy' && o.hasPrimary);
    if (!t) { this.fail(e, 'No enemy weapon in reach'); return; }
    const tdef = CHARACTERS[t.char];
    const w = tdef.primary;
    t.hasPrimary = false;
    if (t.onTower) t.prevWeapon = tdef.backup; // keeps the nail gun while up there
    else t.weapon = tdef.backup;
    t.slot = 2;
    t.buildT = 0;
    t.attackCd = Math.max(t.attackCd, 0.3);
    e.stolen = w;
    e.weapon = w;
    e.slot = 2;
    e.specialCd = e.specialMax = def.stealCooldown;
    e.flickerT = Math.max(e.flickerT, def.flickerTime);
    t.lastHurtT = this.time;
    t.lastAttacker = e.id;
    this.emit({ type: 'steal', id: e.id, from: t.id, weapon: w, x: t.pos.x, y: t.pos.y + 1.2, z: t.pos.z });
  }

  // ---------- Towers ----------

  updateSolids() {
    this.solids = this.map.boxes.concat(this.towers.map(towerBox));
  }

  // Height of the highest floor at (x, z) not above maxY; -Infinity over a void
  supportHeight(x, z, maxY) {
    let y = this.map.bounds.void ? -Infinity : 0;
    for (const b of this.map.boxes) {
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && b.max[1] <= maxY + 0.05) y = Math.max(y, b.max[1]);
    }
    return y;
  }

  placeTower(e, def) {
    const f = forwardVec(e.yaw);
    for (const dist of [1.9, 2.5, 1.5, 3.0]) {
      const x = e.pos.x + f.x * dist, z = e.pos.z + f.z * dist;
      const y = this.supportHeight(x, z, e.pos.y);
      if (y === -Infinity) continue;
      const t = { id: this.nextId++, owner: e.id, team: e.team, x, y, z, size: def.towerSize, height: def.towerHeight, hp: def.towerHp, maxHp: def.towerHp };
      const b = towerBox(t);
      const s = def.towerSize / 2 - 0.02;
      const B = this.map.bounds;
      if (x - s < B.minX + 0.2 || x + s > B.maxX - 0.2 || z - s < B.minZ + 0.2 || z + s > B.maxZ - 0.2) continue;
      if (this.solids.some((o) => overlapsBox(x, y + 0.02, z, s, def.towerHeight - 0.04, o))) continue;
      if (this.entities.some((o) => o.alive && overlapsBox(o.pos.x, o.pos.y, o.pos.z, CHARACTERS[o.char].radius, CHARACTERS[o.char].height, b))) continue;
      this.towers.push(t);
      e.towerId = t.id;
      this.updateSolids();
      this.emit({ type: 'build', id: e.id, tower: t.id, x, y, z });
      return;
    }
    this.fail(e, 'No room for a tower here');
  }

  damageTower(t, amount, attacker) {
    t.hp -= amount;
    this.emit({ type: 'towerHit', tower: t.id, by: attacker.id, x: t.x, y: t.y + 1.5, z: t.z });
    if (t.hp <= 0) this.removeTower(t, 'break');
  }

  removeTower(t, reason) {
    this.towers = this.towers.filter((tt) => tt !== t);
    const owner = this.get(t.owner);
    if (owner && owner.towerId === t.id) {
      owner.towerId = null;
      const def = CHARACTERS.builder;
      owner.specialCd = owner.specialMax = def.towerCooldown;
    }
    this.updateSolids();
    this.emit({ type: reason === 'collapse' ? 'collapse' : 'towerBreak', tower: t.id, team: t.team, x: t.x, y: t.y, z: t.z, height: t.height });
  }

  // Called when the Builder lands a ground pound. box is what he landed on.
  tryCollapse(e, box) {
    if (e.char !== 'builder' || e.towerId === null) return;
    const t = this.towers.find((tt) => tt.id === e.towerId);
    if (!t || box.tower !== t.id) return;
    const def = CHARACTERS.builder;
    this.removeTower(t, 'collapse');
    for (const o of this.entities) {
      if (!o.alive || o.team === e.team) continue;
      const hd = Math.hypot(o.pos.x - t.x, o.pos.z - t.z);
      if (hd <= def.collapseRadius + CHARACTERS[o.char].radius && o.pos.y < t.y + t.height + 0.5) this.damage(o, def.collapseDamage, e, 'tower');
    }
    this.damage(e, def.collapseSelfDamage, e, 'tower');
  }

  // ---------- Projectiles ----------

  updateProjectiles(dt) {
    const keep = [];
    for (const p of this.projectiles) {
      p.life -= dt;
      p.vy += projectileGravity(p.type) * dt;
      const nail = p.type === 'nail';
      const steps = nail ? 6 : 3;
      let hit = false, victim = null;
      for (let s = 0; s < steps && !hit; s++) {
        p.x += p.vx * dt / steps; p.y += p.vy * dt / steps; p.z += p.vz * dt / steps;
        if (p.y <= 0.05 && !this.map.bounds.void) { p.y = 0.05; hit = true; break; }
        if (p.y < this.map.killY) { p.life = 0; p.lost = true; break; } // gone into the void
        if (this.solids.some((b) => overlapsBox(p.x, p.y - 0.08, p.z, 0.08, 0.16, b))) { hit = true; break; }
        for (const o of this.entities) {
          if (!o.alive || o.id === p.owner) continue;
          if (nail && o.team === p.team) continue; // nails fly past teammates
          const od = CHARACTERS[o.char];
          if (Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < od.radius + 0.1 && p.y > o.pos.y && p.y < o.pos.y + entityHeight(o, od)) { hit = true; victim = o; break; }
        }
      }
      if (nail) {
        const far = Math.hypot(p.x - p.tx, p.z - p.tz) > CHARACTERS.builder.nailMaxRange;
        if (victim) this.nailHit(p, victim);
        else if (hit) this.emit({ type: 'nailHit', x: p.x, y: p.y, z: p.z });
        if (!hit && !far && p.life > 0) keep.push(p);
        continue;
      }
      if (p.lost) continue;
      if (hit || p.life <= 0) this.splash(p);
      else keep.push(p);
    }
    this.projectiles = keep;
  }

  fireNail(e) {
    const t = this.towers.find((tt) => tt.id === e.towerId);
    if (!t) return;
    const def = CHARACTERS.builder;
    const d = lookDir(e.yaw, e.pitch);
    const eye = this.eye(e);
    this.projectiles.push({
      id: this.nextId++, type: 'nail', team: e.team, owner: e.id,
      x: eye.x + d.x * 0.6, y: eye.y + d.y * 0.6 - 0.1, z: eye.z + d.z * 0.6,
      vx: d.x * def.nailSpeed, vy: d.y * def.nailSpeed, vz: d.z * def.nailSpeed,
      life: 2, tx: t.x, tz: t.z,
    });
    this.emit({ type: 'shoot', id: e.id });
  }

  // Nails only hurt enemies outside the tower's blind spot
  nailHit(p, o) {
    const def = CHARACTERS.builder;
    const dist = Math.hypot(o.pos.x - p.tx, o.pos.z - p.tz);
    if (dist >= def.nailMinRange) this.damage(o, WEAPONS.nailgun.damage, this.get(p.owner), 'nailgun');
    else this.emit({ type: 'deflect', id: o.id, x: p.x, y: p.y, z: p.z });
  }

  // Tower the entity stands on top of (by geometry, so it also works for remote players)
  towerUnder(e) {
    if (!e.onGround) return null;
    const r = CHARACTERS[e.char].radius * 0.5;
    return this.towers.find((t) => Math.abs(e.pos.x - t.x) < t.size / 2 + r && Math.abs(e.pos.z - t.z) < t.size / 2 + r &&
      Math.abs(e.pos.y - (t.y + t.height)) < 0.1) || null;
  }

  // On top of his own tower the Builder holds the nail gun
  updateTowerGun(e) {
    if (e.char !== 'builder') return;
    const t = this.towerUnder(e);
    const on = !!t && t.id === e.towerId;
    if (on && !e.onTower) {
      e.prevWeapon = e.weapon;
      e.weapon = 'nailgun';
      e.attackCd = Math.max(e.attackCd, 0.2);
    } else if (!on && e.onTower) {
      const def = CHARACTERS.builder;
      const back = e.prevWeapon === def.primary && !e.hasPrimary ? def.backup : e.prevWeapon;
      e.weapon = back || (e.hasPrimary ? def.primary : def.backup);
    }
    e.onTower = on;
  }

  // Unstable cloak: the Spy flickers into view on a fixed rhythm all round
  updateCloak(e, def, dt) {
    e.cloakT += dt;
    if (e.cloakT >= def.cloakEvery) {
      e.cloakT -= def.cloakEvery;
      e.flickerT = Math.max(e.flickerT, def.cloakFlicker);
      this.emit({ type: 'shimmer', id: e.id, x: e.pos.x, y: e.pos.y + 1, z: e.pos.z });
    }
  }

  // Last stand: a team with only Spies left gets pinged ever faster until
  // the Spies are fully visible, and the clock shrinks
  updateLastStand(dt) {
    for (const team of TEAMS) {
      const alive = this.entities.filter((e) => e.alive && e.team === team);
      if (!alive.length || !alive.every((e) => e.char === 'spy')) continue;
      if (!this.lastStand[team]) {
        this.lastStand[team] = true;
        this.pingNext[team] = 0;
        this.lastStandT[team] = 0;
        if (this.phaseT > GAME.lastStandTime) this.phaseT = GAME.lastStandTime;
        this.emit({ type: 'lastStand', team });
      }
      const before = this.lastStandT[team];
      this.lastStandT[team] += dt;
      // p goes 0 -> 1 over lastStandReveal seconds
      const p = Math.min(1, this.lastStandT[team] / GAME.lastStandReveal);
      if (p >= 1) {
        if (before < GAME.lastStandReveal) this.emit({ type: 'exposed', team });
        for (const s of alive) s.flickerT = Math.max(s.flickerT, 0.1); // stays visible
      }
      this.pingNext[team] -= dt;
      if (this.pingNext[team] <= 0) {
        const interval = GAME.lastStandPing + (GAME.lastStandPingMin - GAME.lastStandPing) * p;
        this.pingNext[team] = interval;
        for (const s of alive) {
          // Each ping shows the Spy for a growing share of the time until the next one
          s.flickerT = Math.max(s.flickerT, Math.max(0.4, interval * p));
          this.emit({ type: 'ping', id: s.id, team, x: s.pos.x, y: s.pos.y, z: s.pos.z, p: Math.round(p * 100) / 100, interval });
          // Enemy bots hear the ping too and go hunting
          for (const o of this.entities) {
            if (o.brain && o.alive && o.team !== team) o.brain.lastKnown = { x: s.pos.x, y: s.pos.y, z: s.pos.z, t: this.time };
          }
        }
      }
    }
  }

  // ---------- Capture the treasure ----------

  // The dead come back respawnTime s after dying, at a free spot in their base
  updateRespawns(dt) {
    for (const e of this.entities) {
      if (e.alive) continue;
      if (!e.pick && e.isBot) e.pick = [e.lastChar, ...CHARACTER_ORDER].find((c) => c && this.canPick(e, c));
      if (!e.pick) continue; // a human who joined mid-round picks first
      e.respawnT = Math.max(0, e.respawnT - dt);
      if (e.respawnT > 0) continue;
      this.spawn(e, this.freeSpawn(e.team));
      this.emit({ type: 'respawn', id: e.id });
    }
  }

  freeSpawn(team) {
    const list = this.map.spawns[team];
    const free = list.filter((sp) => !this.entities.some((o) => o.alive && Math.hypot(o.pos.x - sp.x, o.pos.z - sp.z) < 0.9));
    const pool = free.length ? free : list;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  carriedFlag(e) { return this.flags.find((f) => f.carrier === e.id) || null; }

  dropFlag(e) {
    const f = this.carriedFlag(e);
    if (!f) return;
    f.state = 'dropped';
    f.carrier = null;
    f.x = e.pos.x; f.z = e.pos.z;
    f.y = this.supportHeight(e.pos.x, e.pos.z, e.pos.y);
    f.dropT = GAME.flagReturnTime;
    this.emit({ type: 'flagDrop', team: f.team, id: e.id, x: f.x, y: f.y, z: f.z });
  }

  returnFlag(f, by) {
    f.state = 'home';
    f.carrier = null;
    f.x = f.home.x; f.y = f.home.y; f.z = f.home.z;
    f.dropT = 0;
    this.emit({ type: 'flagReturn', team: f.team, id: by ? by.id : null, x: f.x, y: f.y, z: f.z });
  }

  // Enemies pick a treasure up by walking over it; teammates return a dropped one.
  // Carrying the enemy treasure into your own base wins the round.
  updateFlags(dt) {
    for (const f of this.flags) {
      if (f.state === 'carried') {
        const c = this.get(f.carrier);
        if (!c || !c.alive) { if (c) this.dropFlag(c); else this.returnFlag(f, null); continue; }
        f.x = c.pos.x; f.y = c.pos.y; f.z = c.pos.z;
        if (c.char === 'spy') c.flickerT = Math.max(c.flickerT, 0.15); // the glittering gems give him away
        const home = this.map.homes[c.team];
        if (Math.hypot(c.pos.x - home.x, c.pos.z - home.z) <= GAME.captureRadius && Math.abs(c.pos.y - home.y) < 2) {
          c.captures++;
          this.emit({ type: 'flagCapture', team: c.team, flag: f.team, id: c.id, x: home.x, y: home.y, z: home.z });
          this.endRound(c.team);
          return;
        }
        continue;
      }
      if (f.state === 'dropped') {
        f.dropT -= dt;
        if (f.dropT <= 0) { this.returnFlag(f, null); continue; }
      }
      for (const o of this.entities) {
        if (!o.alive) continue;
        if (Math.hypot(o.pos.x - f.x, o.pos.z - f.z) > GAME.flagPickupRadius || Math.abs(o.pos.y - f.y) > 1.6) continue;
        if (o.team !== f.team) {
          if (this.carriedFlag(o)) continue;
          f.state = 'carried';
          f.carrier = o.id;
          f.dropT = 0;
          this.emit({ type: 'flagTake', team: f.team, id: o.id, x: f.x, y: f.y + 1, z: f.z });
          break;
        }
        if (f.state === 'dropped') { this.returnFlag(f, o); break; }
      }
    }
  }

  splash(p) {
    const def = CHARACTERS.doctor;
    const owner = this.get(p.owner);
    for (const o of this.entities) {
      if (!o.alive || o.team !== p.team) continue;
      const c = this.chest(o);
      if (Math.hypot(c.x - p.x, (c.y - p.y) * 0.6, c.z - p.z) <= def.bottleRadius + 0.4) this.heal(o, def.bottleHeal, owner);
    }
    this.emit({ type: 'splash', team: p.team, x: p.x, y: p.y, z: p.z });
  }

  // ---------- Misc ----------

  separate() {
    const list = this.entities.filter((e) => e.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const ra = CHARACTERS[a.char].radius, rb = CHARACTERS[b.char].radius;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = ra + rb;
        if (d >= min || Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        const push = (min - d) * 0.5;
        const wa = a.remote ? 0 : (b.remote ? 2 : 1), wb = b.remote ? 0 : (a.remote ? 2 : 1);
        this.nudge(a, -nx * push * wa, -nz * push * wa);
        this.nudge(b, nx * push * wb, nz * push * wb);
      }
    }
  }

  nudge(e, dx, dz) {
    if (!dx && !dz) return;
    const def = CHARACTERS[e.char];
    const h = entityHeight(e, def);
    const nx = e.pos.x + dx, nz = e.pos.z + dz;
    if (this.solids.some((b) => overlapsBox(nx, e.pos.y + 0.01, nz, def.radius, h, b))) return;
    e.pos.x = nx; e.pos.z = nz;
  }

  // The beam reveals a Spy if it touches any part of his body, not just his chest:
  // up close a short Spy's chest is below the beam even when his head is lit.
  inFlashlight(holder, target) {
    if (!holder.flashlight || !holder.alive) return false;
    const def = CHARACTERS[holder.char];
    const td = CHARACTERS[target.char];
    const eye = this.eye(holder);
    const L = lookDir(holder.yaw, holder.pitch);
    const h = entityHeight(target, td);
    for (const f of [0.15, 0.4, 0.65, 0.9]) {
      const p = { x: target.pos.x, y: target.pos.y + h * f, z: target.pos.z };
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > def.flashlightRange + td.radius) continue;
      const cos = Math.max(-1, Math.min(1, (dx * L.x + dy * L.y + dz * L.z) / (d || 1)));
      // The body's own width counts too
      if (d > 1 && Math.acos(cos) - Math.atan2(td.radius, d) > def.flashlightAngle * DEG) continue;
      if (lineClear(eye, p, this.solids)) return true;
    }
    return false;
  }

  updateReveals() {
    const lights = this.entities.filter((e) => e.alive && e.flashlight);
    for (const e of this.entities) {
      if (!e.alive || e.char !== 'spy') { e.revealed = false; continue; }
      e.revealed = e.flickerT > 0 || lights.some((l) => l.team !== e.team && this.inFlashlight(l, e));
    }
  }

  // Can `viewer` see `target`? Used by bots (and matches what the renderer shows).
  canSee(viewer, target, maxDist = 40) {
    if (!target.alive) return false;
    if (target.char === 'spy' && target.team !== viewer.team && !target.revealed) return false;
    const a = this.eye(viewer), b = this.chest(target);
    if (Math.hypot(a.x - b.x, a.z - b.z) > maxDist) return false;
    return lineClear(a, b, this.solids);
  }

  // ---------- Networking ----------

  // Applies a remote client's input. The client simulates its own movement;
  // the host trusts the position and resolves all combat itself.
  applyRemoteInput(id, m) {
    const e = this.get(id);
    if (!e || e.isBot) return;
    e.remote = true;
    const inp = e.input;
    inp.attack = !!m.atk;
    inp.special = !!m.sp;
    if (m.spc !== e.net.spc) { inp.specialPressed = true; e.net.spc = m.spc; }
    if (m.flc !== e.net.flc) { inp.flashPressed = true; e.net.flc = m.flc; }
    if (m.slot) inp.slot = m.slot;
    if (!e.alive || m.ss !== e.spawnSeq) return;
    e.yaw = m.yaw; e.pitch = m.pitch;
    inp.yaw = m.yaw; inp.pitch = m.pitch;
    if (this.phase === 'countdown') return;
    e.pos.x = m.x; e.pos.y = m.y; e.pos.z = m.z;
    e.vel.x = m.vx; e.vel.y = m.vy; e.vel.z = m.vz;
    e.crouch = !!m.cr;
    e.onGround = !!m.og;
    e.climbing = !!m.cl;
    if (m.pdc !== e.net.pdc) {
      e.net.pdc = m.pdc;
      const t = this.towers.find((tt) => tt.id === e.towerId);
      if (t && Math.abs(e.pos.x - t.x) < t.size && Math.abs(e.pos.z - t.z) < t.size && Math.abs(e.pos.y - (t.y + t.height)) < 0.6) {
        this.tryCollapse(e, { tower: t.id });
      }
    }
  }

  snapshot() {
    return {
      phase: this.phase, phaseT: r2(this.phaseT), round: this.round, lastStandT: this.lastStand ? this.lastStandT : null,
      mapId: this.mapId, mode: this.mode,
      flags: this.flags.map((f) => ({ team: f.team, state: f.state, carrier: f.carrier, x: r2(f.x), y: r2(f.y), z: r2(f.z), dropT: r2(f.dropT) })),
      lastStand: this.lastStand || null,
      score: this.score, winner: this.winner, matchWinner: this.matchWinner,
      teamSize: this.teamSize, difficulty: this.difficulty,
      entities: this.entities.map((e) => ({
        id: e.id, name: e.name, team: e.team, isBot: e.isBot, char: e.char, pick: e.pick,
        alive: e.alive, hearts: e.hearts, maxHearts: e.maxHearts,
        x: r2(e.pos.x), y: r2(e.pos.y), z: r2(e.pos.z),
        vx: r2(e.vel.x), vy: r2(e.vel.y), vz: r2(e.vel.z),
        yaw: r2(e.yaw), pitch: r2(e.pitch), crouch: e.crouch, onGround: e.onGround, climbing: e.climbing,
        weapon: e.weapon, slot: e.slot, hasPrimary: e.hasPrimary, stolen: e.stolen,
        attackCd: r2(e.attackCd), specialCd: r2(e.specialCd), specialMax: e.specialMax, buildT: r2(e.buildT),
        flashlight: e.flashlight, flickerT: r2(e.flickerT), revealed: e.revealed,
        attackSeq: e.attackSeq, spawnSeq: e.spawnSeq, kills: e.kills, deaths: e.deaths, heals: e.heals,
        towerId: e.towerId, lastHurtT: r2(e.lastHurtT), cloakT: r2(e.cloakT), onTower: e.onTower,
        respawnT: r2(e.respawnT), captures: e.captures,
      })),
      towers: this.towers.map((t) => ({ ...t })),
      projectiles: this.projectiles.map((p) => ({ id: p.id, type: p.type, team: p.team, x: r2(p.x), y: r2(p.y), z: r2(p.z), vx: r2(p.vx), vy: r2(p.vy), vz: r2(p.vz) })),
      time: r2(this.time),
    };
  }
}
