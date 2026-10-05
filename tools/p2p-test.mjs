// End-to-end test of game-code (PeerJS/WebRTC) play: serves the game as plain static
// files (like GitHub Pages, so no relay server), opens two small headless Chrome windows, hosts
// in one and joins from the other. Needs internet for the PeerJS handshake.
// Usage: node tools/p2p-test.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const files = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => files.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${files.address().port}/`;

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9333 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=400,300', // small: two software-rendered game loops must keep up
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 50; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(200); }
}
// Each player gets its own window: a background tab would stop its game loop
const browser = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => (browser.onopen = r));
const newWindow = (u) => new Promise((r) => {
  browser.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) r(m.result.targetId); };
  browser.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: u, newWindow: true } }));
});

async function openTab(name) {
  const targetId = await newWindow(url);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.id === targetId);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && process.env.VERBOSE) console.log(`[${name}]`, m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    if (m.method === 'Runtime.exceptionThrown') console.log(`[${name} exception]`, m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(`${name}: ${r.result.exceptionDetails.exception?.description}`);
    return r.result.result.value;
  };
  const waitFor = async (expr, what, ms = 20000) => {
    for (let t = 0; t < ms; t += 200) { const v = await evaluate(expr); if (v) return v; await sleep(200); }
    const state = await evaluate(`JSON.stringify({ title: document.getElementById('lobby-title').textContent,
      yellow: document.getElementById('lobby-yellow').innerText, teal: document.getElementById('lobby-teal').innerText,
      status: document.getElementById('code-status').textContent, alerts: window.alerts })`);
    throw new Error(`${name}: timed out waiting for ${what}: ${state}`);
  };
  await waitFor('!!document.getElementById("btn-host-code")', 'the page');
  await sleep(1500); // let the relay probe fail so the menu settles
  // Record alerts instead of blocking on them
  await evaluate('window.alerts = []; window.alert = (m) => window.alerts.push(String(m)); true');
  return { evaluate, waitFor, ws };
}

const visible = (id) => `!document.getElementById('${id}').classList.contains('hidden')`;
let ok = false;
try {
  const A = await openTab('host');
  const B = await openTab('client');

  await A.evaluate(`document.getElementById('name').value = 'Hosty'; document.getElementById('name').oninput(); document.getElementById('btn-host-code').click(); true`);
  const code = await A.waitFor(`${visible('lobby')} && /^[A-Z0-9]{6}$/.test(document.getElementById('share-url').textContent) && document.getElementById('share-url').textContent`, 'a game code');
  console.log('host got code', code, '|', await A.evaluate(`document.getElementById('share-link').textContent`));

  await B.evaluate(`document.getElementById('name').value = 'Clienty'; document.getElementById('name').oninput(); document.getElementById('join-code').value = '${code.toLowerCase()}'; document.getElementById('btn-join-code').click(); true`);
  await B.waitFor(visible('lobby'), 'the client lobby');
  await A.waitFor(`document.getElementById('lobby').textContent.includes('Clienty')`, 'the host to list the client');
  await B.waitFor(`document.getElementById('lobby').textContent.includes('Hosty')`, 'the client to receive a snapshot');
  console.log('client joined; both lobbies list both players');

  await B.evaluate(`document.getElementById('join-teal').click(); true`);
  await A.waitFor(`[...document.querySelectorAll('#lobby-teal .member')].some((e) => e.textContent.includes('Clienty'))`, 'the team switch to reach the host');
  console.log('client -> host message delivered (team switch)');

  await A.evaluate(`document.getElementById('btn-start').click(); true`);
  await B.waitFor(visible('pick'), 'the client to see the pick screen');
  console.log('host started the match; client is on the pick screen');

  await A.evaluate(`document.getElementById('btn-leave').click(); true`);
  const msg = await B.waitFor(`window.alerts[0]`, 'the client to be told the host left', 30000);
  console.log('client notified:', msg);

  await B.evaluate(`document.getElementById('join-code').value = 'ZZZZZZ'; document.getElementById('btn-join-code').click(); true`);
  console.log('bad code:', await B.waitFor(`/No game/.test(document.getElementById('code-status').textContent) && document.getElementById('code-status').textContent`, 'the bad-code error'));
  ok = true;
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  chrome.kill();
  files.close();
}
console.log(ok ? 'P2P OK' : 'P2P FAILED');
process.exit(ok ? 0 : 1);
