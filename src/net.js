// Networking: a thin relay connection plus host/client sessions.
// Host-authoritative: the host browser runs the Sim (with bots) and sends
// snapshots; clients send inputs and their own predicted movement.
//
// Two interchangeable transports speak the same messages: Relay (WebSocket to
// server.js) and PeerRelay (WebRTC straight between browsers, no server needed).
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

class Emitter {
  constructor() { this.handlers = {}; }
  on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
  off(type) { delete this.handlers[type]; }
  emit(type, m) { for (const fn of this.handlers[type] || []) fn(m); }

  // Waits for the next message of a given type
  wait(type, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeout);
      const fn = (m) => { clearTimeout(timer); this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn); resolve(m); };
      this.on(type, fn);
    });
  }
}

export class Relay extends Emitter {
  constructor() {
    super();
    this.ws = null;
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
  send(obj) { if (this.open) this.ws.send(JSON.stringify(obj)); }
  close() { this.handlers = {}; if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.ws = null; }
}

// ---------- Peer-to-peer transport (WebRTC via PeerJS) ----------
// PeerJS's free public server (0.peerjs.com) only brokers the handshake: the host
// registers under its game code and clients connect to it. Game traffic then
// flows directly between the browsers (on a LAN it stays on the LAN).
// Emits the same messages as the relay server, so the game code is unaware.

const PEER_PREFIX = 'flash-and-pistol-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I; 32 chars, so no modulo bias

export function randomCode(n = 6) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// PeerJS is a classic script (sets window.Peer); load it only when needed
let peerLib = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return (peerLib ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/peerjs.min.js', import.meta.url).href;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => { peerLib = null; reject(new Error('Could not load the networking library.')); };
    document.head.appendChild(s);
  }));
}

// We do our own JSON: PeerJS's JSON mode rejects messages of 16 KB or more
const CONN_OPTS = { serialization: 'raw', reliable: true };

export class PeerRelay extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.id = null;
    this.room = null;
    this.conns = new Map(); // host: client id -> DataConnection
    this.hostConn = null;   // client: the connection to the host
    this.nextId = 1;
  }

  get open() { return !!this.peer && !this.peer.destroyed; }

  openPeer(Peer, peerId, timeout) {
    return new Promise((resolve, reject) => {
      const peer = peerId ? new Peer(peerId, { debug: 0 }) : new Peer({ debug: 0 });
      this.peer = peer;
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('The connection server did not respond. Check your internet connection.')); }, timeout);
      const onError = (e) => { clearTimeout(timer); peer.destroy(); reject(e); };
      peer.once('error', onError);
      peer.once('open', () => { clearTimeout(timer); peer.off('error', onError); resolve(); });
    });
  }

  async host(name, timeout = 10000) {
    const Peer = await loadPeerJS();
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode();
      try {
        await this.openPeer(Peer, PEER_PREFIX + code, timeout);
      } catch (e) {
        if (e.type === 'unavailable-id') continue; // code taken, roll another
        throw new Error(e.type ? 'Could not reach the connection server.' : e.message);
      }
      this.id = 'h';
      this.room = { id: code, name: `${name}'s game`.slice(0, 40) };
      this.peer.on('connection', (c) => this.accept(c));
      this.peer.on('error', () => {}); // e.g. lost the connection server: running games carry on
      this.peer.on('disconnected', () => { if (!this.peer.destroyed) this.peer.reconnect(); }); // so new players can still join
      return { room: this.room, you: this.id };
    }
    throw new Error('Could not get a free game code.');
  }

  // Host side: a client sends 'hello' first; everything after that is game data
  accept(conn) {
    let id = null;
    conn.on('data', (raw) => {
      let d;
      try { d = JSON.parse(raw); } catch { return; }
      if (id) { this.emit('msg', { from: id, data: d }); return; }
      if (!d || d.t !== 'hello') return;
      id = 'p' + this.nextId++;
      this.conns.set(id, conn);
      conn.send(JSON.stringify({ t: 'welcome', you: id, room: this.room }));
      this.emit('peer-join', { id, name: String(d.name || 'Player').slice(0, 20) });
    });
    const gone = () => { if (id && this.conns.delete(id)) this.emit('peer-leave', { id }); };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  async join(code, name, timeout = 15000) {
    const Peer = await loadPeerJS();
    try {
      await this.openPeer(Peer, null, timeout);
    } catch (e) {
      throw new Error(e.type ? 'Could not reach the connection server.' : e.message);
    }
    return new Promise((resolve, reject) => {
      let joined = false;
      const fail = (msg) => {
        if (joined) return;
        joined = true;
        clearTimeout(timer);
        this.close();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('Could not connect to the host. Some networks block direct connections between devices.'), timeout);
      this.peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? `No game with code ${code}. Check the code with the host.` : 'Could not connect to the host.'));
      const conn = this.peer.connect(PEER_PREFIX + code, CONN_OPTS);
      this.hostConn = conn;
      conn.on('open', () => conn.send(JSON.stringify({ t: 'hello', name })));
      conn.on('data', (raw) => {
        let d;
        try { d = JSON.parse(raw); } catch { return; }
        if (joined) { this.emit('msg', { from: 'h', data: d }); return; }
        if (!d || d.t !== 'welcome') return;
        joined = true;
        clearTimeout(timer);
        this.id = d.you;
        this.room = d.room;
        resolve({ you: d.you, room: d.room, host: 'h' });
      });
      conn.on('close', () => { if (joined) this.emit('closed', { reason: 'The host left the game.' }); else fail('The host closed the connection.'); });
    });
  }

  // The same envelopes as the relay server: bcast/to from the host, up from a client
  send(obj) {
    switch (obj.t) {
      case 'bcast': {
        const s = JSON.stringify(obj.data);
        for (const c of this.conns.values()) if (c.open) c.send(s);
        break;
      }
      case 'to': {
        const c = this.conns.get(obj.id);
        if (c && c.open) c.send(JSON.stringify(obj.data));
        break;
      }
      case 'up':
        if (this.hostConn && this.hostConn.open) this.hostConn.send(JSON.stringify(obj.data));
        break;
      case 'leave':
        this.close();
        break;
    }
  }

  close() {
    this.handlers = {};
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.conns.clear();
    this.hostConn = null;
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
    this.setMap('arena');
    this.entities = [];
    this.byId = new Map();
    this.towers = [];
    this.projectiles = [];
    this.flags = [];
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

  setMap(id) {
    this.map = buildMap(id);
    this.mapId = this.map.id;
    this.mode = this.map.mode;
    this.solids = this.map.boxes.slice();
  }

  applySnapshot(s, now) {
    this.gotSnapshot = true;
    if (s.mapId && s.mapId !== this.mapId) this.setMap(s.mapId);
    this.flags = s.flags || [];
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
        'cloakT', 'onTower', 'respawnT', 'captures']) {
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
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (!this.map.bounds.void) p.y = Math.max(0.05, p.y);
    }
  }
}
