// Flash and Pištol server: serves the game files and relays messages between
// players. No npm packages needed: `node server.js` (add --open to launch a browser).
//
// The game itself runs in the host player's browser; this server only forwards
// messages, so it can also be deployed on any public Node host for internet play.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const START_PORT = +(process.env.PORT || 8080);
const OPEN = process.argv.includes('--open');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  // Prefer typical home/office LAN ranges first
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

let port = START_PORT;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ lan: lanAddresses().map((ip) => `http://${ip}:${port}`), port, rooms: roomList().length }));
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- Minimal WebSocket (RFC 6455) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let nextConnId = 1;

class Conn {
  constructor(socket) {
    this.id = 'p' + nextConnId++;
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.room = null;
    this.name = 'Player';
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => {});
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 4 * 1024 * 1024) { this.socket.destroy(); return; }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buf[maskOff + (i & 3)];
      this.buf = buf.subarray(off + len);
      this.onFrame(op, fin, payload);
    }
  }

  onFrame(op, fin, payload) {
    if (op === 0x8) { this.writeFrame(0x8, Buffer.alloc(0)); this.socket.end(); return; }
    if (op === 0x9) { this.writeFrame(0xa, payload); return; }
    if (op === 0xa) { this.alive = true; return; }
    this.frags.push(payload);
    if (!fin) return;
    const text = Buffer.concat(this.frags).toString('utf8');
    this.frags = [];
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    handleMessage(this, msg);
  }

  writeFrame(op, data) {
    const len = data.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    if (!this.socket.destroyed) this.socket.write(Buffer.concat([head, data]));
  }

  send(obj) { this.writeFrame(0x1, Buffer.from(JSON.stringify(obj))); }

  sendRaw(str) { this.writeFrame(0x1, Buffer.from(str)); }

  onClose() {
    conns.delete(this);
    leaveRoom(this);
  }
}

const conns = new Set();
const rooms = new Map(); // id -> { id, name, host: Conn, members: Set<Conn> }
let nextRoomId = 1;

function roomList() {
  return [...rooms.values()].map((r) => ({ id: r.id, name: r.name, players: r.members.size + 1 }));
}

function pushRoomList() {
  const msg = JSON.stringify({ t: 'rooms', rooms: roomList() });
  for (const c of conns) if (!c.room) c.sendRaw(msg);
}

function leaveRoom(c) {
  const r = c.room;
  if (!r) return;
  c.room = null;
  if (r.host === c) {
    for (const m of r.members) { m.room = null; m.send({ t: 'closed', reason: 'The host left the game.' }); }
    rooms.delete(r.id);
  } else {
    r.members.delete(c);
    r.host.send({ t: 'peer-leave', id: c.id });
  }
  pushRoomList();
}

function handleMessage(c, m) {
  switch (m.t) {
    case 'list':
      c.send({ t: 'rooms', rooms: roomList() });
      break;
    case 'host': {
      leaveRoom(c);
      c.name = String(m.name || 'Host').slice(0, 20);
      const r = { id: 'r' + nextRoomId++, name: String(m.room || `${c.name}'s game`).slice(0, 40), host: c, members: new Set() };
      rooms.set(r.id, r);
      c.room = r;
      c.send({ t: 'hosted', room: { id: r.id, name: r.name }, you: c.id });
      pushRoomList();
      break;
    }
    case 'join': {
      const r = rooms.get(m.room);
      if (!r) { c.send({ t: 'error', reason: 'That game no longer exists.' }); break; }
      leaveRoom(c);
      c.name = String(m.name || 'Player').slice(0, 20);
      c.room = r;
      r.members.add(c);
      c.send({ t: 'joined', room: { id: r.id, name: r.name }, you: c.id, host: r.host.id });
      r.host.send({ t: 'peer-join', id: c.id, name: c.name });
      pushRoomList();
      break;
    }
    case 'leave':
      leaveRoom(c);
      break;
    case 'bcast': // host -> all members
      if (c.room && c.room.host === c) {
        const s = JSON.stringify({ t: 'msg', from: c.id, data: m.data });
        for (const mem of c.room.members) mem.sendRaw(s);
      }
      break;
    case 'to': // host -> one member
      if (c.room && c.room.host === c) {
        for (const mem of c.room.members) if (mem.id === m.id) mem.send({ t: 'msg', from: c.id, data: m.data });
      }
      break;
    case 'up': // member -> host
      if (c.room && c.room.host !== c) c.room.host.send({ t: 'msg', from: c.id, data: m.data });
      break;
  }
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const c = new Conn(socket);
  conns.add(c);
});

// Drop dead connections
setInterval(() => {
  for (const c of conns) {
    if (!c.alive) { c.socket.destroy(); continue; }
    c.alive = false;
    c.writeFrame(0x9, Buffer.alloc(0));
  }
}, 15000);

function start() {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < START_PORT + 10) {
      port++;
      start();
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    const local = `http://localhost:${port}`;
    const lan = lanAddresses().map((ip) => `http://${ip}:${port}`);
    console.log('');
    console.log('  Flash and Pistol is running!');
    console.log('');
    console.log(`  Play on this computer:   ${local}`);
    if (lan.length) {
      console.log(`  Friends on your network: ${lan[0]}`);
      for (const u of lan.slice(1)) console.log(`                           ${u}`);
    }
    console.log('');
    console.log('  If friends cannot connect, allow Node.js through the firewall (private networks).');
    console.log('  Close this window to stop the server.');
    console.log('');
    if (OPEN) {
      const cmd = process.platform === 'win32' ? `start "" "${local}"` : process.platform === 'darwin' ? `open "${local}"` : `xdg-open "${local}"`;
      exec(cmd, () => {});
    }
  });
}
start();
