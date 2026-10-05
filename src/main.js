// Entry point: menus, game modes (offline / host / client), the main loop and
// the glue between simulation, input, rendering, HUD, audio and networking.
import { Sim, emptyInput } from './sim.js';
import { Renderer } from './render.js';
import { Input, ACTIONS, keyName } from './input.js';
import { Audio } from './audio.js';
import { HUD, CHAR_ICONS } from './hud.js';
import { Relay, HostSession, ClientView, relayUrlFromAddress } from './net.js';
import { stepMovement, raycast, forwardVec, yawTo } from './physics.js';
import { buildMap, MAPS, MAP_ORDER } from './map.js';
import { CHARACTERS, CHARACTER_ORDER, WEAPONS, GAME, TEAM_NAMES, TEAM_COLORS } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PLAY_PHASES = ['countdown', 'play', 'roundEnd'];
const STEP = 1 / GAME.tickRate;

// ---------- Settings ----------
const settings = { name: '', teamSize: GAME.teamSize, difficulty: 'normal', sens: 1, volume: 0.6, addr: '', keys: null, quality: 'medium', map: 'arena' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('fp-settings') || '{}')); } catch { /* ignore */ }
if (!MAPS[settings.map]) settings.map = 'arena';
function saveSettings() { try { localStorage.setItem('fp-settings', JSON.stringify(settings)); } catch { /* ignore */ } }
const playerName = () => (settings.name || '').trim() || 'Player';

// ---------- Core objects ----------
const canvas = $('game');
const renderer = new Renderer(canvas, settings.quality);
renderer.buildMap(buildMap(settings.map));
const input = new Input(canvas, settings.keys);
const audio = new Audio();
audio.setVolume(settings.volume);
const hud = new HUD(input);

const G = {
  mode: null,        // 'offline' | 'host' | 'client'
  view: null,        // Sim (offline/host) or ClientView (client)
  sim: null,
  relay: null,
  host: null,
  localId: null,
  roomName: '',
  yaw: 0, pitch: 0,
  time: 0,
  acc: 0,
  pauseOpen: false,
  showScores: false,
  specIdx: 0,
  lastSpawnSeq: -1,
  lastPhase: null,
  lastCount: null,
  shake: 0,
  net: { spc: 0, flc: 0, pdc: 0, slot: 0, atk: false, tick: 0 },
  lanUrl: null,
};

renderer.onStep = (e) => {
  audio.play('step', e.pos, e.char === 'spy' ? 0.3 : 0.7);
};

const getMe = () => (G.view ? G.view.get(G.localId) : null);

// ---------- Menu ----------
function initMenu() {
  const ts = $('teamsize'), lts = $('lobby-teamsize');
  for (let i = 1; i <= 6; i++) {
    ts.add(new Option(`${i} vs ${i}`, i));
    lts.add(new Option(`${i} vs ${i}`, i));
  }
  $('name').value = settings.name;
  ts.value = settings.teamSize;
  $('difficulty').value = settings.difficulty;
  $('sens').value = $('sens2').value = settings.sens;
  $('volume').value = $('volume2').value = settings.volume;
  $('addr').value = settings.addr;

  $('name').oninput = () => { settings.name = $('name').value; saveSettings(); };
  ts.onchange = () => { settings.teamSize = +ts.value; saveSettings(); };
  for (const id of ['map', 'lobby-map']) {
    for (const m of MAP_ORDER) $(id).add(new Option(`${MAPS[m].name} · ${MAPS[m].modeName}`, m));
  }
  $('map').value = settings.map;
  $('map').onchange = () => {
    settings.map = $('map').value;
    saveSettings();
    renderer.buildMap(buildMap(settings.map)); // the menu backdrop previews it
  };
  $('lobby-map').onchange = () => {
    if (G.mode !== 'host' || G.sim.phase !== 'lobby') return;
    G.sim.setMap($('lobby-map').value);
    settings.map = G.sim.mapId;
    saveSettings();
  };
  $('difficulty').onchange = () => { settings.difficulty = $('difficulty').value; saveSettings(); };
  for (const id of ['sens', 'sens2']) $(id).oninput = () => { settings.sens = +$(id).value; $('sens').value = $('sens2').value = settings.sens; saveSettings(); };
  $('quality').value = $('quality2').value = renderer.quality;
  for (const id of ['quality', 'quality2']) {
    $(id).onchange = () => {
      settings.quality = $(id).value;
      $('quality').value = $('quality2').value = settings.quality;
      renderer.setQuality(settings.quality);
      saveSettings();
    };
  }
  for (const id of ['volume', 'volume2']) $(id).oninput = () => { settings.volume = +$(id).value; $('volume').value = $('volume2').value = settings.volume; audio.setVolume(settings.volume); saveSettings(); };

  $('btn-offline').onclick = startOffline;
  $('btn-host').onclick = hostGame;
  $('btn-addr').onclick = connectByAddress;
  $('btn-start').onclick = () => { if (G.mode === 'host') G.sim.newMatch(); };
  $('lobby-teamsize').onchange = () => { if (G.mode === 'host') { G.sim.setTeamSize(+$('lobby-teamsize').value); settings.teamSize = G.sim.teamSize; saveSettings(); } };
  $('lobby-difficulty').onchange = () => { if (G.mode === 'host') { G.sim.difficulty = $('lobby-difficulty').value; settings.difficulty = G.sim.difficulty; saveSettings(); } };
  $('join-yellow').onclick = () => switchTeam('yellow');
  $('join-teal').onclick = () => switchTeam('teal');
  $('btn-lobby-leave').onclick = () => backToMenu();
  $('btn-resume').onclick = () => { G.pauseOpen = false; audio.init(); input.lock(); };
  $('btn-leave').onclick = () => backToMenu();
  $('btn-matchend-menu').onclick = () => backToMenu();
  $('btn-to-lobby').onclick = () => { if (G.mode === 'host') { G.sim.toLobby(); G.pauseOpen = false; } };
  $('clickplay').onclick = () => { audio.init(); input.lock(); };
  canvas.addEventListener('click', () => {
    if (G.mode && PLAY_PHASES.includes(G.view.phase) && !input.locked && !G.pauseOpen) { audio.init(); input.lock(); }
  });

  document.addEventListener('pointerlockchange', () => {
    if (!input.locked && G.mode && PLAY_PHASES.includes(G.view.phase) && !latePicking()) G.pauseOpen = true;
    if (input.locked) G.pauseOpen = false;
  });
  $('btn-controls').onclick = () => openControls();
  $('btn-controls2').onclick = () => openControls();
  $('btn-bind-done').onclick = () => closeControls();
  $('btn-bind-reset').onclick = () => { input.resetBindings(); bindingsChanged(); };

  buildPickCards();
  renderControlsList();
  initOnline();
}

let menuRelay = null;

async function initOnline() {
  const url = relayUrlFromAddress(null);
  if (!url) { $('online-off').classList.remove('hidden'); return; }
  try {
    menuRelay = await openRelay(url);
    $('online-ok').classList.remove('hidden');
  } catch {
    $('online-off').classList.remove('hidden');
  }
  fetch('/info').then((r) => r.json()).then((info) => { G.lanUrl = (info.lan && info.lan[0]) || location.origin; }).catch(() => {});
}

async function openRelay(url) {
  const r = new Relay();
  await r.connect(url);
  r.on('rooms', (m) => { if (r === menuRelay) renderRooms(m.rooms); });
  r.send({ t: 'list' });
  return r;
}

function renderRooms(rooms) {
  const list = $('room-list');
  list.innerHTML = '';
  if (!rooms.length) {
    list.innerHTML = '<div class="muted">No games yet. Host one!</div>';
    return;
  }
  for (const room of rooms) {
    const row = document.createElement('div');
    row.className = 'room';
    row.innerHTML = `<span class="name">${esc(room.name)}</span><span class="muted">${room.players} player${room.players === 1 ? '' : 's'}</span>`;
    const b = document.createElement('button');
    b.className = 'teal';
    b.textContent = 'Join';
    b.onclick = () => joinGame(room.id);
    row.appendChild(b);
    list.appendChild(row);
  }
}

async function connectByAddress() {
  const addr = $('addr').value.trim();
  settings.addr = addr;
  saveSettings();
  const url = relayUrlFromAddress(addr);
  $('addr-status').textContent = 'Connecting…';
  try {
    if (menuRelay) menuRelay.close();
    menuRelay = await openRelay(url);
    G.lanUrl = 'http://' + addr.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    $('online-ok').classList.remove('hidden');
    $('online-off').classList.add('hidden');
    $('addr-status').textContent = 'Connected. Host a game or join one above.';
  } catch {
    $('addr-status').textContent = `Could not connect to ${url}. Is the server running and the firewall open?`;
  }
}

// ---------- Starting / leaving games ----------

function setupGame(mode, view, localId) {
  G.mode = mode;
  G.view = view;
  G.sim = mode === 'client' ? null : view;
  G.localId = localId;
  G.pauseOpen = false;
  G.lastSpawnSeq = -1;
  G.lastPhase = null;
  G.acc = 0;
  G.net = { spc: 0, flc: 0, pdc: 0, slot: 0, atk: false, tick: 0 };
  $('menu').classList.add('hidden');
}

function startOffline() {
  audio.init();
  const sim = new Sim({ teamSize: settings.teamSize, difficulty: settings.difficulty, mapId: settings.map });
  sim.addHuman('me', playerName(), 'yellow');
  sim.fillBots();
  sim.newMatch();
  setupGame('offline', sim, 'me');
}

async function hostGame() {
  audio.init();
  if (!menuRelay || !menuRelay.open) { alert('Not connected to the game server.'); return; }
  const relay = menuRelay;
  relay.send({ t: 'host', name: playerName() });
  let m;
  try { m = await relay.wait('hosted'); } catch { alert('The server did not respond.'); return; }
  const sim = new Sim({ teamSize: settings.teamSize, difficulty: settings.difficulty, mapId: settings.map });
  sim.addHuman(m.you, playerName(), 'yellow');
  sim.fillBots();
  G.host = new HostSession(relay, sim);
  G.relay = relay;
  G.roomName = m.room.name;
  relay.on('disconnect', () => backToMenu('Lost connection to the server.'));
  setupGame('host', sim, m.you);
}

async function joinGame(roomId) {
  audio.init();
  const relay = menuRelay;
  if (!relay || !relay.open) return;
  relay.send({ t: 'join', room: roomId, name: playerName() });
  let m;
  try {
    m = await Promise.race([relay.wait('joined'), relay.wait('error').then((e) => { throw new Error(e.reason); })]);
  } catch (err) {
    alert(err.message || 'Could not join.');
    return;
  }
  const view = new ClientView(m.you);
  relay.on('msg', (mm) => {
    const d = mm.data;
    if (d && d.t === 'snap') {
      view.applySnapshot(d.s, performance.now());
      if (G.mode === 'client') handleEvents(d.ev || []);
    }
  });
  relay.on('closed', (mm) => backToMenu(mm.reason));
  relay.on('disconnect', () => backToMenu('Lost connection to the server.'));
  G.relay = relay;
  G.roomName = m.room.name;
  setupGame('client', view, m.you);
}

function switchTeam(team) {
  if (G.mode === 'host') G.sim.setTeam(G.localId, team);
  else if (G.mode === 'client') G.relay.send({ t: 'up', data: { t: 'team', team } });
}

function backToMenu(message) {
  if (!G.mode) return;
  const relay = G.relay;
  if (relay) {
    relay.send({ t: 'leave' });
    for (const t of ['msg', 'peer-join', 'peer-leave', 'closed', 'disconnect', 'hosted', 'joined', 'error']) relay.off(t);
    if (relay.open) relay.send({ t: 'list' });
  }
  G.mode = null;
  G.view = null;
  G.sim = null;
  G.host = null;
  G.relay = null;
  G.pauseOpen = false;
  input.unlock();
  for (const id of ['lobby', 'pick', 'pause', 'matchend', 'clickplay']) $(id).classList.add('hidden');
  hud.show(false);
  $('menu').classList.remove('hidden');
  renderer.buildMap(buildMap(settings.map));
  if (message) setTimeout(() => alert(message), 50);
}

// ---------- Controls ----------

// The read-only list on the main menu
function renderControlsList() {
  const keys = (id) => input.bindings[id].filter(Boolean).map((c) => keyName(c)).join(' / ') || '(unbound)';
  const rows = [
    [['forward', 'left', 'back', 'right'].map((id) => input.label(id)).join(' '), 'Move'],
    ['Mouse', 'Look'],
    [keys('attack'), 'Attack (hold to keep swinging)'],
    [keys('special'), 'Special: medkit, build tower, throw bottle, steal'],
    [keys('jump'), 'Jump (Doctor: double jump)'],
    [keys('crouch'), 'Crouch'],
    [`${input.label('crouch')} + ${input.label('jump')}`, 'Builder on his tower: collapse it!'],
    [keys('flash'), 'Longman flashlight (reveals Spies)'],
    [`${keys('weapon1')} / ${keys('weapon2')} / wheel`, 'Switch weapon'],
    [keys('scores'), 'Scoreboard'],
    ['Esc', 'Pause / menu'],
  ];
  $('controls-list').innerHTML = rows.map(([k, t]) => `<kbd>${esc(k)}</kbd><span>${esc(t)}</span>`).join('');
}

function openControls() {
  G.controlsOpen = true;
  renderBindTable();
  $('controls').classList.remove('hidden');
}

function closeControls() {
  G.controlsOpen = false;
  input.capture = null;
  $('controls').classList.add('hidden');
}

function bindingsChanged() {
  settings.keys = input.bindings;
  saveSettings();
  renderBindTable();
  renderControlsList();
  buildPickCards();
}

function renderBindTable() {
  const table = $('bind-table');
  table.innerHTML = '';
  for (const a of ACTIONS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(a.label)}</td>`;
    for (let slot = 0; slot < 2; slot++) {
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.className = 'bind';
      const code = input.bindings[a.id][slot];
      b.textContent = code ? keyName(code) : '—';
      b.onclick = () => {
        for (const other of table.querySelectorAll('button.bind.listening')) other.classList.remove('listening');
        b.classList.add('listening');
        b.textContent = 'press a key…';
        $('bind-status').textContent = 'Press a key or mouse button. Esc cancels, Backspace clears.';
        input.startCapture((newCode) => {
          if (newCode === 'Backspace' || newCode === 'Delete') input.bind(a.id, slot, null);
          else if (newCode) input.bind(a.id, slot, newCode);
          $('bind-status').textContent = newCode && newCode.startsWith('Control') ? 'Careful: Ctrl+W closes the browser tab.' : '';
          bindingsChanged();
        });
      };
      td.appendChild(b);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
}

// ---------- Pick screen ----------

function buildPickCards() {
  const wrap = $('pick-cards');
  wrap.innerHTML = '';
  CHARACTER_ORDER.forEach((c, i) => {
    const d = CHARACTERS[c];
    const card = document.createElement('div');
    card.className = 'pcard';
    card.id = 'pc-' + c;
    const bk = d.backup ? WEAPONS[d.backup].name : 'none';
    card.innerHTML = `
      <span class="key">${i + 1}</span>
      <div class="portrait">${CHAR_ICONS[c]}</div>
      <h3>${d.name}</h3>
      <div class="role">${d.role}</div>
      <div class="hearts">${'♥'.repeat(d.hearts)}</div>
      <div class="stat">Speed <b>${d.speed}</b> m/s</div>
      <div class="stat">Weapon <b>${WEAPONS[d.primary].name}</b> · backup <b>${bk}</b></div>
      <div class="blurb">${withKeys(d.blurb)}</div>
      <div class="who"></div>`;
    card.onclick = () => choosePick(c);
    wrap.appendChild(card);
  });
}

function canPick(view, me, c) {
  const n = view.entities.filter((o) => o !== me && o.team === me.team && o.pick === c).length;
  return n < GAME.maxSameCharacter;
}

// Capture the treasure: the dead may switch character before they respawn
const respawning = (view, me) => view.mode === 'ctf' && me && !me.alive && (view.phase === 'countdown' || view.phase === 'play');
// A player who joins a capture-the-treasure round midway picks before spawning
function latePicking() {
  const me = getMe();
  return !!G.view && !!me && respawning(G.view, me) && !me.pick;
}

function choosePick(c) {
  audio.init();
  const view = G.view, me = getMe();
  if (!view || !me || (view.phase !== 'pick' && !respawning(view, me)) || !canPick(view, me, c)) { audio.play('fail'); return; }
  if (G.mode === 'client') { G.relay.send({ t: 'up', data: { t: 'pick', char: c } }); me.pick = c; }
  else G.sim.setPick(G.localId, c);
  audio.play('pick');
  if (view.phase !== 'pick') hud.flashHint(`You will respawn as ${CHARACTERS[c].name}`, 1.5);
  input.lock();
}

function renderPick(view, me) {
  $('pick-score').innerHTML = `<span class="ty">Yellow ${view.score.yellow}</span> – <span class="tt">${view.score.teal} Teal</span>`;
  $('pick-title').textContent = view.phase === 'pick' ? `Round ${view.round + 1}: pick your character` : 'Pick a character to join the fight';
  $('pick-timer').textContent = Math.max(0, Math.ceil(view.phaseT));
  const portraitBg = me.team === 'yellow' ? 'rgba(242,196,24,.25)' : 'rgba(31,181,173,.25)';
  for (const c of CHARACTER_ORDER) {
    const card = $('pc-' + c);
    card.classList.toggle('chosen', me.pick === c);
    card.classList.toggle('full', me.pick !== c && !canPick(view, me, c));
    card.querySelector('.portrait').style.background = portraitBg;
    const who = view.entities.filter((o) => o.team === me.team && o.pick === c && o !== me).map((o) => o.name);
    const txt = who.length ? '✓ ' + who.join(', ') : '';
    const el = card.querySelector('.who');
    if (el.textContent !== txt) el.textContent = txt;
  }
  const foot = me.pick
    ? `You picked <b>${CHARACTERS[me.pick].name}</b>. Waiting for the others… (press 1–4 to change)`
    : 'Click a character or press 1–4. At most 2 of the same character per team.';
  if ($('pick-foot').innerHTML !== foot) $('pick-foot').innerHTML = foot;
}

// ---------- Lobby ----------

function renderLobby(view, me) {
  $('lobby-title').textContent = G.roomName || 'Lobby';
  $('share-url').textContent = G.lanUrl || location.origin;
  const mp = MAPS[view.mapId] || MAPS.arena;
  $('lobby-mapinfo').textContent = `Map: ${mp.name} · ${mp.modeName}`;
  for (const team of ['yellow', 'teal']) {
    const html = view.entities.filter((e) => e.team === team).map((e) =>
      `<div class="member${e.id === G.localId ? ' me' : ''}"><span>${esc(e.name)}${e.id === G.localId ? ' (you)' : ''}</span>${e.isBot ? '<span class="bot">bot</span>' : ''}</div>`).join('');
    const el = $('lobby-' + team);
    if (el.innerHTML !== html) el.innerHTML = html;
    $('join-' + team).disabled = !me || me.team === team;
  }
  const isHost = G.mode === 'host';
  $('host-controls').classList.toggle('hidden', !isHost);
  $('client-wait').classList.toggle('hidden', isHost);
  if (isHost) {
    if (document.activeElement !== $('lobby-teamsize')) $('lobby-teamsize').value = view.teamSize;
    if (document.activeElement !== $('lobby-difficulty')) $('lobby-difficulty').value = view.difficulty;
    if (document.activeElement !== $('lobby-map')) $('lobby-map').value = view.mapId;
  }
}

// ---------- Events from the simulation ----------

function handleEvents(evs) {
  const view = G.view;
  if (!view) return;
  const me = getMe();
  const myId = G.localId;
  const ent = (id) => view.get(id);
  for (const ev of evs) {
    const e = ev.id ? ent(ev.id) : null;
    const pos = e ? e.pos : (ev.x !== undefined ? ev : null);
    switch (ev.type) {
      case 'swing': {
        const w = WEAPONS[ev.weapon];
        audio.play(w && w.kind === 'spin' ? 'spin' : 'swing', ev.id === myId ? null : pos, 0.8);
        break;
      }
      case 'hurt':
        renderer.spawnText(ev.backstab ? `-${ev.amount} BACKSTAB` : `-${ev.amount}`, '#ff4d5e', ev.x, ev.y + 0.5, ev.z);
        renderer.burst(ev.x, ev.y, ev.z, 0xff3b4e, 8, 3, 0.07);
        audio.play('hit', ev.id === myId ? null : ev, 1);
        if (ev.id === myId) { hud.hurt(); audio.play('hurt'); G.shake = Math.max(G.shake, 0.25); }
        if (ev.by === myId && ev.id !== myId) hud.hitmarker(false);
        break;
      case 'heal':
        renderer.spawnText(`+${ev.amount}`, '#37d67a', ev.x, ev.y + 0.5, ev.z);
        renderer.burst(ev.x, ev.y, ev.z, 0x37d67a, 8, 2, 0.07, 0.8, 2);
        audio.play('heal', ev.id === myId ? null : ev, 0.8);
        if (ev.by === myId && ev.id !== myId) hud.hitmarker(true);
        break;
      case 'kill': {
        const killer = ent(ev.killer), victim = ent(ev.victim);
        if (victim) victim.deathAt = G.time;
        audio.play('kill', ev.victim === myId ? null : ev, 0.8);
        const how = ev.cause === 'tower' ? 'tower collapse' : ev.cause === 'void' ? 'into the void' : (WEAPONS[ev.cause] ? WEAPONS[ev.cause].name : ev.cause);
        if (killer && killer !== victim) hud.feed(`${hud.name(killer)} <span class="muted">[${esc(how)}]</span> ${hud.name(victim)}`, ev.killer === myId || ev.victim === myId);
        else if (ev.cause === 'void') hud.feed(`${hud.name(victim)} <span class="muted">fell into the void</span>`, ev.victim === myId);
        else hud.feed(`${hud.name(victim)} <span class="muted">was crushed by their own tower</span>`, ev.victim === myId);
        if (ev.victim === myId) {
          const by = killer && killer !== victim ? `Taken out by ${hud.name(killer)}. ` : '';
          if (view.mode === 'ctf') hud.message('You are out!', `${by}Back in ${GAME.respawnTime} s · press 1–4 to switch character.`, 3);
          else hud.message('You are out!', `${by}You can pick again next round.`, 3);
          G.specIdx = 0;
        } else if (ev.killer === myId) {
          hud.flashHint(`You took out ${victim ? victim.name : 'someone'}!`, 1.5);
        }
        break;
      }
      case 'steal': {
        const thief = e, victim = ent(ev.from);
        audio.play('steal', ev);
        renderer.spawnText('STOLEN!', '#ff9f43', ev.x, ev.y + 0.6, ev.z);
        if (ev.from === myId) hud.flashHint(`A Spy stole your ${WEAPONS[ev.weapon].name}! You are on your backup weapon.`, 3);
        if (ev.id === myId) hud.flashHint(`You stole a ${WEAPONS[ev.weapon].name}! 1 = fists, 2 = stolen weapon.`, 3);
        if (thief && victim) hud.feed(`${hud.name(thief)} <span class="muted">stole</span> ${hud.name(victim)}<span class="muted">'s ${WEAPONS[ev.weapon].name}</span>`, ev.id === myId || ev.from === myId);
        break;
      }
      case 'build':
        audio.play('build', ev);
        renderer.burst(ev.x, ev.y + 0.2, ev.z, 0xc49a5a, 12, 3, 0.1);
        break;
      case 'collapse': {
        audio.play('collapse', ev, 1.4);
        renderer.debris(ev.x, ev.y, ev.z, ev.height, ev.team);
        if (me) {
          const d = Math.hypot(me.pos.x - ev.x, me.pos.z - ev.z);
          G.shake = Math.max(G.shake, Math.max(0, 0.9 - d * 0.04));
        }
        break;
      }
      case 'towerBreak':
        audio.play('break', ev);
        renderer.debris(ev.x, ev.y, ev.z, ev.height * 0.6, ev.team);
        break;
      case 'towerHit':
        audio.play('hit', ev, 0.6);
        renderer.burst(ev.x, ev.y, ev.z, 0x8a5a2b, 6, 2, 0.1);
        break;
      case 'throw': audio.play('throw', ev.id === myId ? null : pos); break;
      case 'shoot': audio.play('shoot', ev.id === myId ? null : pos, 0.8); break;
      case 'nailHit':
        audio.play('nailHit', ev, 0.8);
        renderer.burst(ev.x, ev.y, ev.z, 0xc0c6cc, 4, 1.5, 0.05, 0.4);
        break;
      case 'deflect':
        // Nail bounced off: the target is inside the tower's blind spot
        audio.play('deflect', ev);
        renderer.burst(ev.x, ev.y, ev.z, 0xfff2c0, 6, 3, 0.05, 0.4);
        renderer.spawnText('safe', '#fff2c0', ev.x, ev.y + 0.4, ev.z);
        if (ev.id === myId) hud.flashHint('Too close for the nail gun: you are in the tower\'s blind spot!', 1.5);
        break;
      case 'shimmer':
        audio.play('shimmer', ev.id === myId ? null : ev, ev.id === myId ? 0.4 : 1);
        break;
      case 'lastStand': {
        const mine = me && me.team === ev.team;
        hud.message('Last stand!', mine
          ? `Only Spies left on your team. The pings speed up: you are fully visible in ${GAME.lastStandReveal} s. Hurry!`
          : `Only Spies left on <span class="${ev.team === 'yellow' ? 'ty' : 'tt'}">${TEAM_NAMES[ev.team]}</span>. They are fully visible in ${GAME.lastStandReveal} s.`, 3);
        break;
      }
      case 'exposed': {
        const mine = me && me.team === ev.team;
        hud.message(mine ? 'You are exposed!' : 'Spies exposed!', mine ? 'Your cloak is gone. Fight!' : 'The last Spies are fully visible. Finish them!', 2.5);
        break;
      }
      case 'ping': {
        // Beeps speed up and rise in pitch as the last stand runs out
        const pitch = 1 + (ev.p || 0) * 0.6;
        const life = Math.max(0.5, Math.min(2.5, (ev.interval || 4) * 1.1));
        // Enemies (and spectators of the other team) see the Spy's position through walls
        if (!me || me.team !== ev.team) { renderer.ping(ev.x, ev.y, ev.z, ev.team, life); audio.play('ping', ev, 1.4, pitch); }
        else if (ev.id === myId) audio.play('ping', null, 0.5, pitch);
        break;
      }
      case 'splash':
        audio.play('splash', ev);
        renderer.burst(ev.x, ev.y + 0.1, ev.z, 0x47e08a, 18, 4, 0.08, 0.6);
        renderer.ring(ev.x, Math.max(0, ev.y - 0.3), ev.z, 0x47e08a, CHARACTERS.doctor.bottleRadius, 0.6);
        break;
      case 'medkit':
        audio.play('medkit', ev.id === myId ? null : pos);
        if (e) renderer.burst(e.pos.x, e.pos.y + 1.2, e.pos.z, 0xffffff, 10, 2, 0.08, 0.8, 1);
        break;
      case 'flash': audio.play('click', ev.id === myId ? null : pos); break;
      case 'land': audio.play('land', ev.id === myId ? null : ev, 0.8); break;
      case 'fail':
        if (ev.id === myId) { hud.flashHint(ev.reason, 1.5); audio.play('fail'); }
        break;
      case 'flagTake': {
        const carrier = e;
        const tc = ev.team === 'yellow' ? 'ty' : 'tt';
        audio.play('steal', ev.id === myId ? null : ev, 1.2);
        renderer.burst(ev.x, ev.y, ev.z, TEAM_COLORS[ev.team], 14, 3, 0.08);
        hud.feed(`${hud.name(carrier)} <span class="muted">took the</span> <span class="${tc}">${TEAM_NAMES[ev.team]}</span> <span class="muted">treasure!</span>`, ev.id === myId);
        if (ev.id === myId) hud.message('You have the treasure!', 'Bring it to the ring around your own chest!', 2.5);
        else if (me && me.team === ev.team) hud.message('Our treasure was taken!', `Stop ${hud.name(carrier)} before they get home!`, 2.5);
        break;
      }
      case 'flagDrop': {
        const tc = ev.team === 'yellow' ? 'ty' : 'tt';
        audio.play('break', ev, 0.6);
        hud.feed(`<span class="${tc}">${TEAM_NAMES[ev.team]}</span> <span class="muted">treasure dropped · back home in ${GAME.flagReturnTime} s</span>`);
        break;
      }
      case 'flagReturn': {
        const tc = ev.team === 'yellow' ? 'ty' : 'tt';
        audio.play('heal', ev, 0.8);
        renderer.ring(ev.x, ev.y, ev.z, TEAM_COLORS[ev.team], 2, 0.6);
        if (e) hud.feed(`${hud.name(e)} <span class="muted">returned the</span> <span class="${tc}">${TEAM_NAMES[ev.team]}</span> <span class="muted">treasure</span>`, ev.id === myId);
        else hud.feed(`<span class="${tc}">${TEAM_NAMES[ev.team]}</span> <span class="muted">treasure is back home</span>`);
        break;
      }
      case 'flagCapture':
        renderer.burst(ev.x, ev.y + 0.8, ev.z, TEAM_COLORS[ev.flag], 30, 5, 0.1, 1.2);
        hud.feed(`${hud.name(e)} <span class="muted">brought the treasure home!</span>`, ev.id === myId);
        break;
      case 'respawn':
        if (ev.id === myId) hud.flashHint('Back in the fight!', 1.2);
        break;
      case 'fight': audio.play('fight'); hud.message('FIGHT!', '', 1.2); break;
      case 'timeUp':
        if (ev.ctf) hud.message('Time up!', 'Nobody brought a treasure home.', 2.5);
        else hud.message('Time up!', 'The team with more hearts left wins the round.', 2.5);
        break;
      case 'roundEnd': {
        const w = ev.winner;
        if (w === 'draw') hud.message('Draw!', 'Nobody scores this round.', 4);
        else hud.message(view.mode === 'ctf' ? `${TEAM_NAMES[w]} steals the treasure!` : `${TEAM_NAMES[w]} wins the round!`, `<span class="ty">${ev.score.yellow}</span> – <span class="tt">${ev.score.teal}</span>`, 4);
        if (me && w !== 'draw') audio.play(me.team === w ? 'win' : 'lose');
        break;
      }
      case 'matchEnd':
        if (me) audio.play(me.team === ev.winner ? 'win' : 'lose');
        break;
      case 'join': hud.feed(`${esc(ev.name)} <span class="muted">joined</span> <span class="${ev.team === 'yellow' ? 'ty' : 'tt'}">${TEAM_NAMES[ev.team]}</span>`); break;
      case 'leave': hud.feed(`${esc(ev.name)} <span class="muted">left (a bot takes over)</span>`); break;
    }
  }
}

// ---------- Hints ----------

const K = (id) => `<b>${esc(input.label(id))}</b>`;
const collapseKeys = () => `${K('crouch')} + ${K('jump')}`;

// Fills {special}, {flash}, {crouch}, {jump}... in texts with the current key names
function withKeys(text) {
  return text.replace(/\{(\w+)\}/g, (m, id) => (input.bindings[id] ? esc(input.label(id)) : m));
}

function computeHint(view, me) {
  if (!me || !me.alive || !PLAY_PHASES.includes(view.phase)) return '';
  const def = CHARACTERS[me.char];
  if (view.mode === 'ctf' && view.flags && view.flags.some((f) => f.carrier === me.id)) {
    return '<b>You have the treasure!</b> Bring it to the ring around your own chest';
  }
  switch (me.char) {
    case 'builder': {
      const tower = view.towers.find((t) => t.id === me.towerId);
      if (me.weapon === 'nailgun') return `${K('attack')}: nail gun (enemies inside the ring are safe) · ${collapseKeys()}: COLLAPSE (4 hearts to enemies below)`;
      if (!me.hasPrimary && !tower) return 'Your wrench was stolen: no towers this round. Punch with your fists!';
      if (me.buildT > 0) return 'Building… keep holding';
      if (tower) {
        const onTop = me.onGround && me.standingOn && me.standingOn.tower === tower.id;
        if (onTop) return `${collapseKeys()}: COLLAPSE the tower! (4 hearts to enemies below, 1 to you)`;
        return 'Walk into your tower to climb it: shoot nails from the top, collapse it when enemies get close.';
      }
      if (me.specialCd <= 0) return `Hold ${K('special')} to build a tower · ${K('attack')} spins your wrench (hits everyone around you)`;
      return `${K('attack')} spins your wrench and hits every enemy around you`;
    }
    case 'spy': {
      const ls = view.lastStandT && view.lastStand && view.lastStand[me.team] ? view.lastStandT[me.team] : null;
      if (ls !== null) {
        const left = Math.ceil(GAME.lastStandReveal - ls);
        return left > 0 ? `<b>Last stand!</b> Fully visible in ${left} s` : '<b>Exposed!</b> Your cloak is gone';
      }
      if (me.flickerT > 0) return '<b>You are visible!</b>';
      const next = Math.max(0, Math.ceil(def.cloakEvery - (me.cloakT || 0)));
      if (me.stolen && me.slot === 1) return `Invisible · flicker in ${next} s · ${K('weapon2')} uses the stolen ${WEAPONS[me.stolen].name}`;
      return `Invisible · you flicker into view in ${next} s · ${K('special')} steals a weapon · your fists only hit for 1♥`;
    }
    case 'longman':
      if (me.hearts <= me.maxHearts - 2 && me.specialCd <= 0) return `${K('special')}: Medkit (+2♥)`;
      return `${K('flash')}: flashlight reveals invisible Spies in its beam`;
    case 'doctor':
      if (!me.hasPrimary) return `Your axe was stolen! Kick enemies, and keep throwing healing bottles (${K('special')})`;
      return `Hit teammates with your axe to heal them · ${K('special')}: healing bottle · double jump!`;
  }
  return '';
}

// ---------- Camera ----------

function spectateTargets(view, me) {
  const mates = view.entities.filter((e) => e.alive && e.team === me.team && e.id !== me.id);
  if (mates.length) return mates;
  return view.entities.filter((e) => e.alive && !(e.char === 'spy' && e.team !== me.team));
}

function computeCamera(view, me) {
  const phase = view ? view.phase : 'lobby';
  if (!view || !me || !PLAY_PHASES.includes(phase)) {
    const t = G.time * 0.06;
    const B = renderer.mapBounds;
    const x = Math.cos(t) * (B.maxX + 4), z = Math.sin(t) * (B.maxZ + 4), y = 16;
    return { cam: { x, y, z, yaw: yawTo(-x, -z), pitch: Math.atan2(-y + 1, Math.hypot(x, z)) }, firstPerson: false, spectating: null };
  }
  if (me.alive) {
    const def = CHARACTERS[me.char];
    const eye = def.eye * (me.crouch ? GAME.crouchHeightScale : 1);
    return { cam: { x: me.pos.x, y: me.pos.y + eye, z: me.pos.z, yaw: G.yaw, pitch: G.pitch }, firstPerson: true, spectating: null };
  }
  // Dead: briefly look at your own body, then follow teammates
  const sinceDeath = me.deathAt !== undefined ? G.time - me.deathAt : 99;
  let target = me;
  let spectating = null;
  if (sinceDeath > 2 || phase !== 'play') {
    const list = spectateTargets(view, me);
    if (list.length) { target = list[((G.specIdx % list.length) + list.length) % list.length]; spectating = target; }
  }
  const def = CHARACTERS[target.char] || CHARACTERS.longman;
  const head = { x: target.pos.x, y: target.pos.y + def.height + 0.4, z: target.pos.z };
  const yaw = target === me ? G.yaw : target.yaw;
  const f = forwardVec(yaw);
  const back = { x: -f.x, y: 0.45, z: -f.z };
  const bl = Math.hypot(back.x, back.y, back.z);
  const solids = view.solids;
  const hit = raycast(head.x, head.y, head.z, back.x / bl, back.y / bl, back.z / bl, 4, solids);
  const d = Math.max(0.5, hit.t - 0.25);
  const cam = { x: head.x + back.x / bl * d, y: head.y + back.y / bl * d, z: head.z + back.z / bl * d };
  cam.yaw = yaw;
  cam.pitch = -0.3;
  return { cam, firstPerson: false, spectating };
}

// ---------- Fixed-rate update ----------

function fixedStep() {
  const view = G.view;
  const me = getMe();
  if (me && me.spawnSeq !== G.lastSpawnSeq) {
    G.lastSpawnSeq = me.spawnSeq;
    G.yaw = me.yaw;
    G.pitch = 0;
  }
  const inp = input.sample(G.yaw, G.pitch);
  if (me && !me.alive && inp.attackPressed) G.specIdx++;

  if (G.mode !== 'client') {
    if (G.mode === 'offline' && G.pauseOpen) return;
    if (me && me.alive) me.input = inp;
    G.sim.tick(STEP);
    const evs = G.sim.drainEvents();
    handleEvents(evs);
    if (G.host) G.host.queueEvents(evs);
    return;
  }

  // Client: predict our own movement locally, send it with our actions to the host
  const n = G.net;
  if (me && me.alive && PLAY_PHASES.includes(view.phase) && me.char) {
    const def = CHARACTERS[me.char];
    me.yaw = G.yaw;
    me.pitch = G.pitch;
    const mvInp = view.phase === 'countdown' ? { ...emptyInput(), crouch: inp.crouch } : inp;
    const mv = stepMovement(me, def, mvInp, STEP, view.solids, me.towerId, view.map.bounds);
    if (mv.poundLanded) n.pdc++;
    if (mv.landed > 9) audio.play('land', null, 0.6);
  }
  if (inp.specialPressed) n.spc++;
  if (inp.flashPressed) n.flc++;
  if (inp.slot) n.slot = inp.slot;
  n.atk = n.atk || inp.attack;
  n.sp = n.sp || inp.special;
  n.tick++;
  if (n.tick % 2 === 0 && me) {
    G.relay.send({ t: 'up', data: {
      t: 'in', ss: me.spawnSeq,
      x: me.pos.x, y: me.pos.y, z: me.pos.z, vx: me.vel.x, vy: me.vel.y, vz: me.vel.z,
      yaw: G.yaw, pitch: G.pitch, cr: me.crouch, og: me.onGround, cl: me.climbing,
      atk: n.atk, sp: n.sp, spc: n.spc, flc: n.flc, pdc: n.pdc, slot: n.slot,
    } });
    n.atk = false; n.sp = false; n.slot = 0;
  }
}

// ---------- Main loop ----------

let last = performance.now();
let uiAcc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  G.time += dt;
  const view = G.view;
  const me = getMe();
  const phase = view ? view.phase : null;

  // Mouse look
  const look = input.takeLook();
  if (input.locked && me && me.alive && PLAY_PHASES.includes(phase)) {
    const k = 0.0022 * settings.sens;
    G.yaw -= look.dx * k;
    G.pitch = Math.max(-1.5, Math.min(1.5, G.pitch - look.dy * k));
  }
  G.showScores = input.action('scores');
  // Number keys pick a character during the pick phase
  if (input.pickRequest) {
    if (phase === 'pick' || (view && respawning(view, me))) choosePick(CHARACTER_ORDER[input.pickRequest - 1]);
    input.pickRequest = 0;
  }

  if (G.mode) {
    G.acc += dt;
    let n = 0;
    while (G.acc >= STEP && n < 8) { fixedStep(); G.acc -= STEP; n++; }
    if (n === 8) G.acc = 0;
    if (G.mode === 'client') G.view.update(dt, now);
    if (G.host) G.host.update(dt);
  }

  // Phase transitions (works the same for host, offline and clients)
  const ph = G.view ? G.view.phase : null;
  if (ph !== G.lastPhase) {
    if (ph === 'pick' || ph === 'matchEnd' || ph === 'lobby') input.unlock();
    if (ph === 'countdown') {
      const m = getMe();
      const goal = G.view.mode === 'ctf' ? ' · grab their treasure and bring it home!' : '';
      hud.message(`Round ${G.view.round}`, m && m.char ? `You are ${CHAR_ICONS[m.char]} ${CHARACTERS[m.char].name}${goal}` : '', 2.5);
      G.lastCount = null;
    }
    G.lastPhase = ph;
  }
  if (ph === 'countdown') {
    const c = Math.ceil(G.view.phaseT);
    if (c !== G.lastCount && c > 0) { G.lastCount = c; audio.play('beep'); }
  }

  // The host may have switched maps in the lobby
  if (G.view && G.view.map && G.view.mapId !== renderer.mapId) renderer.buildMap(G.view.map);

  // Camera + render
  const meNow = getMe();
  const camInfo = computeCamera(G.view, meNow);
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt);
    camInfo.cam.x += (Math.random() - 0.5) * G.shake * 0.4;
    camInfo.cam.y += (Math.random() - 0.5) * G.shake * 0.4;
    camInfo.cam.z += (Math.random() - 0.5) * G.shake * 0.4;
  }
  audio.listener = { x: camInfo.cam.x, y: camInfo.cam.y, z: camInfo.cam.z, yaw: camInfo.cam.yaw };
  const renderView = G.view || { entities: [], towers: [], projectiles: [], phase: 'lobby' };
  renderer.render(renderView, {
    localId: G.localId, viewerTeam: meNow ? meNow.team : null,
    camera: camInfo.cam, firstPerson: camInfo.firstPerson && PLAY_PHASES.includes(ph), time: G.time,
  }, dt);

  // Screens + HUD
  const inPlay = !!G.mode && PLAY_PHASES.includes(ph);
  hud.show(inPlay);
  $('lobby').classList.toggle('hidden', !(G.mode && ph === 'lobby'));
  const latePick = latePicking();
  $('pick').classList.toggle('hidden', !(G.mode && ((ph === 'pick' && meNow) || latePick)));
  if (latePick && input.locked) input.unlock();
  $('matchend').classList.toggle('hidden', !(G.mode && ph === 'matchEnd'));
  $('pause').classList.toggle('hidden', !(inPlay && G.pauseOpen));
  $('clickplay').classList.toggle('hidden', !(inPlay && !input.locked && !G.pauseOpen && !latePick));
  if (inPlay) {
    hud.update(G.view, meNow, {
      spectating: camInfo.spectating,
      hint: computeHint(G.view, meNow),
      showScores: G.showScores || ph === 'roundEnd',
    }, dt);
    if (G.pauseOpen) {
      $('pause-title').textContent = G.mode === 'offline' ? 'Paused' : 'Menu (the game keeps running)';
      $('btn-to-lobby').classList.toggle('hidden', G.mode !== 'host');
    }
  }
  uiAcc += dt;
  if (uiAcc > 0.1 && G.mode) {
    uiAcc = 0;
    if (ph === 'lobby') renderLobby(G.view, meNow);
    if ((ph === 'pick' || latePick) && meNow) renderPick(G.view, meNow);
    if (ph === 'matchEnd') {
      const w = G.view.matchWinner;
      $('matchend-title').innerHTML = w ? `<span class="${w === 'yellow' ? 'ty' : 'tt'}">${TEAM_NAMES[w]}</span> wins the match!` : 'Match over';
      $('matchend-sub').textContent = `${G.view.score.yellow} – ${G.view.score.teal} · next match starts in ${Math.max(0, Math.ceil(G.view.phaseT))} s`;
      const html = hud.scoreboardHtml(G.view, meNow);
      if ($('matchend-board').innerHTML !== html) $('matchend-board').innerHTML = html;
    }
  }
}

initMenu();
requestAnimationFrame(frame);
// Handle for debugging from the browser console and automated tests
window.flashAndPistol = { G, renderer, input, startOffline, choosePick };
