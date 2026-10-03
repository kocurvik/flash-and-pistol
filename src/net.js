// Networking: a thin relay connection plus host/client sessions.
// Host-authoritative: the host browser runs the Sim (with bots) and sends
// snapshots; clients send inputs and their own predicted movement.
//
// Transport is isolated in Relay, so a WebRTC or hosted-server transport can be
// dropped in later for internet play without touching the game code.
import { GAME, projectileGravity } from './config.js';
import { buildMap } from './map.js';
import { towerBox, angleDiff } from './physics.js';

export function relayUrlFromAddress(addr) {
  if (!addr) {
    if (!location.protocol.startsWith('http')) return null;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }
  let a = addr.trim();
  if (/^wss?:\/\//.test(a)) return a.endsWith('/ws') ? a : a.replace(/\/$/, '') + '/ws';
  a = a.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!a.includes(':')) a += ':8080';
  return 'ws://' + a + '/ws';
}

export class Relay {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.id = null;
    this.url = null;
  }

  connect(url, timeout = 4000) {
    this.url = url;
    return new Promise((resolve, reject) => {
      let done = false;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      this.ws = ws;
      const timer = setTimeout(() => { if (!done) { done = true; ws.close(); reject(new Error('timeout')); } }, timeout);
      ws.onopen = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('connect failed')); } };
      ws.onclose = () => { this.emit('disconnect', {}); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        this.emit(m.t, m);
      };
    });
  }

  get open() { return this.ws && this.ws.readyState === 1; }
  on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
  off(type) { delete this.handlers[type]; }
  emit(type, m) { for (const fn of this.handlers[type] || []) fn(m); }
  send(obj) { if (this.open) this.ws.send(JSON.stringify(obj)); }
  close() { this.handlers = {}; if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.ws = null; }

  // Waits for the next message of a given type
  wait(type, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeout);
      const fn = (m) => { clearTimeout(timer); this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn); resolve(m); };
      this.on(type, fn);
    });
  }
}

// ---------- Host side ----------

export class HostSession {
  constructor(relay, sim) {
    this.relay = relay;
    this.sim = sim;
    this.pending = [];
    this.snapAcc = 0;
    relay.on('peer-join', (m) => { sim.addHuman(m.id, m.name); this.sendNow(); });
    relay.on('peer-leave', (m) => sim.removeHuman(m.id));
    relay.on('msg', (m) => this.onMsg(m.from, m.data));
  }

  onMsg(from, d) {
    if (!d) return;
    const sim = this.sim;
    switch (d.t) {
      case 'in': sim.applyRemoteInput(from, d); break;
      case 'pick': sim.setPick(from, d.char); break;
      case 'team': if (sim.phase === 'lobby' || sim.phase === 'pick') sim.setTeam(from, d.team); break;
      case 'name': { const e = sim.get(from); if (e && !e.isBot) e.name = String(d.name).slice(0, 20); break; }
    }
  }

  // Called with every event the sim produced this tick
  queueEvents(evs) { for (const e of evs) this.pending.push(e); }

  update(dt) {
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / GAME.snapshotRate) {
      this.snapAcc = 0;
      this.sendNow();
    }
  }

  sendNow() {
    this.relay.send({ t: 'bcast', data: { t: 'snap', s: this.sim.snapshot(), ev: this.pending } });
    this.pending = [];
  }
}

// ---------- Client side ----------

const INTERP_DELAY = 100; // ms

export class ClientView {
  constructor(myId) {
    this.myId = myId;
    this.map = buildMap();
    this.solids = this.map.boxes.slice();
    this.entities = [];
    this.byId = new Map();
    this.towers = [];
    this.projectiles = [];
    this.phase = 'lobby';
    this.phaseT = 0;
    this.round = 0;
    this.score = { yellow: 0, teal: 0 };
    this.winner = null;
    this.matchWinner = null;
    this.teamSize = 4;
    this.difficulty = 'normal';
    this.time = 0;
    this.gotSnapshot = false;
  }

  get(id) { return this.byId.get(id); }

  applySnapshot(s, now) {
    this.gotSnapshot = true;
    this.phase = s.phase; this.phaseT = s.phaseT; this.round = s.round;
    this.score = s.score; this.winner = s.winner; this.matchWinner = s.matchWinner;
    this.teamSize = s.teamSize; this.difficulty = s.difficulty; this.time = s.time;
    this.lastStand = s.lastStand; this.lastStandT = s.lastStandT;
    const ids = new Set();
    for (const se of s.entities) {
      ids.add(se.id);
      let e = this.byId.get(se.id);
      if (!e) {
        e = { id: se.id, pos: { x: se.x, y: se.y, z: se.z }, vel: { x: 0, y: 0, z: 0 }, yaw: se.yaw, pitch: se.pitch, buf: [], spawnSeq: -1, jumpsUsed: 0 };
        this.byId.set(se.id, e);
      }
      const isMe = se.id === this.myId;
      for (const k of ['name', 'team', 'isBot', 'char', 'pick', 'alive', 'hearts', 'maxHearts', 'weapon', 'slot', 'hasPrimary', 'stolen',
        'attackCd', 'specialCd', 'specialMax', 'buildT', 'flashlight', 'flickerT', 'revealed', 'attackSeq', 'kills', 'deaths', 'heals', 'towerId', 'lastHurtT',
        'cloakT', 'onTower']) {
        e[k] = se[k];
      }
      if (isMe) {
        if (se.spawnSeq !== e.spawnSeq || !se.alive) {
          e.pos = { x: se.x, y: se.y, z: se.z };
          e.vel = { x: 0, y: 0, z: 0 };
          if (se.spawnSeq !== e.spawnSeq) { e.yaw = se.yaw; e.pitch = 0; e.respawned = true; }
          e.onGround = true; e.crouch = false; e.pounding = false; e.standingOn = null;
        }
        e.spawnSeq = se.spawnSeq;
      } else {
        e.buf.push({ t: now, x: se.x, y: se.y, z: se.z, yaw: se.yaw, pitch: se.pitch });
        if (e.buf.length > 5) e.buf.shift();
        e.crouch = se.crouch; e.onGround = se.onGround; e.climbing = se.climbing;
        e.vel = { x: se.vx, y: se.vy, z: se.vz };
        if (se.spawnSeq !== e.spawnSeq) { e.buf = [e.buf[e.buf.length - 1]]; e.spawnSeq = se.spawnSeq; }
      }
    }
    for (const id of [...this.byId.keys()]) if (!ids.has(id)) this.byId.delete(id);
    this.entities = s.entities.map((se) => this.byId.get(se.id));
    this.towers = s.towers;
    this.solids = this.map.boxes.concat(this.towers.map(towerBox));
    this.projectiles = s.projectiles.map((p) => ({ ...p }));
  }

  update(dt, now) {
    if (this.phase !== 'lobby') this.phaseT = Math.max(0, this.phaseT - dt);
    const rt = now - INTERP_DELAY;
    for (const e of this.entities) {
      if (e.id === this.myId || !e.buf.length) continue;
      const b = e.buf;
      let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) {
        if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
      }
      let t = c.t > a.t ? (rt - a.t) / (c.t - a.t) : 1;
      t = Math.max(0, Math.min(1, t));
      e.pos.x = a.x + (c.x - a.x) * t;
      e.pos.y = a.y + (c.y - a.y) * t;
      e.pos.z = a.z + (c.z - a.z) * t;
      e.yaw = a.yaw + angleDiff(c.yaw, a.yaw) * t;
      e.pitch = a.pitch + (c.pitch - a.pitch) * t;
    }
    for (const p of this.projectiles) {
      p.vy += projectileGravity(p.type) * dt;
      p.x += p.vx * dt; p.y = Math.max(0.05, p.y + p.vy * dt); p.z += p.vz * dt;
    }
  }
}
