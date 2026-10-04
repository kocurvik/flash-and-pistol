// Checks the Spy cloak, last stand, nail gun and capture-the-treasure rules against config values.
// Usage: node tools/rules-test.mjs
import { Sim } from '../src/sim.js';
import { CHARACTERS, GAME } from '../src/config.js';

let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) failures++;
};
const dt = 1 / 60;
const run = (s, seconds) => { const evs = []; for (let i = 0; i < seconds * 60; i++) { s.tick(dt); evs.push(...s.drainEvents()); } return evs; };

function setup(picks) {
  const s = new Sim({ teamSize: picks.yellow.length });
  s.fillBots();
  s.newMatch();
  s.teamMembers('yellow').forEach((e, i) => { e.pick = picks.yellow[i]; });
  s.teamMembers('teal').forEach((e, i) => { e.pick = picks.teal[i]; });
  s.startRound();
  s.phase = 'play';
  s.phaseT = 100;
  for (const e of s.entities) e.brain = null; // scripted, no AI
  return s;
}
const put = (e, x, z, yaw = 0) => { e.pos = { x, y: 0, z }; e.vel = { x: 0, y: 0, z: 0 }; e.yaw = e.input.yaw = yaw; };

// ---------- Unstable cloak ----------
{
  const s = setup({ yellow: ['longman', 'longman'], teal: ['spy', 'doctor'] });
  const [spy] = s.teamMembers('teal');
  put(spy, 0, -16);
  const def = CHARACTERS.spy;
  let evs = run(s, def.cloakEvery - 0.2);
  check('spy hidden before the first flicker', !evs.some((e) => e.type === 'shimmer') && !spy.revealed);
  let visibleTicks = 0;
  const ticks = Math.round(def.cloakEvery * 4 * 60);
  evs = [];
  for (let i = 0; i < ticks; i++) { s.tick(dt); evs.push(...s.drainEvents()); if (spy.revealed) visibleTicks++; }
  const n = evs.filter((e) => e.type === 'shimmer' && e.id === spy.id).length;
  check('flickers once every cloakEvery', n === 4, `${n} flickers in ${def.cloakEvery * 4}s`);
  const frac = visibleTicks / ticks;
  const want = def.cloakFlicker / def.cloakEvery;
  check('visible for cloakFlicker of every cloakEvery', Math.abs(frac - want) < 0.03, `${(frac * 100).toFixed(1)}% visible, want ${(want * 100).toFixed(1)}%`);
  const lm = s.teamMembers('yellow')[0];
  put(lm, 4, -16, Math.PI / 2);
  let seen = 0;
  for (let i = 0; i < ticks; i++) { s.tick(dt); s.drainEvents(); if (s.canSee(lm, spy)) seen++; }
  check('bots can see the spy during flickers', seen > 0 && seen < ticks / 2, `${seen}/${ticks} ticks`);
}

// ---------- Last stand ----------
{
  const s = setup({ yellow: ['spy', 'longman'], teal: ['spy', 'doctor'] });
  const [ys, yl] = s.teamMembers('yellow');
  const [ts, td] = s.teamMembers('teal');
  put(ys, -20, 16); put(ts, 20, -16); put(yl, -25, 0); put(td, 25, 0);
  s.phaseT = 120;
  s.damage(yl, 99, null, 'test');
  let evs = run(s, 0.1);
  check('last stand triggers when only Spies remain', evs.some((e) => e.type === 'lastStand' && e.team === 'yellow'));
  check('round clock drops to lastStandTime', s.phaseT <= GAME.lastStandTime && s.phaseT > GAME.lastStandTime - 1, s.phaseT.toFixed(1));
  check('immediate ping of the last Spy', evs.some((e) => e.type === 'ping' && e.id === ys.id));
  // Track pings and visibility over the whole reveal period
  const pingTimes = [];
  let visible = { early: 0, late: 0 };
  const reveal = GAME.lastStandReveal;
  for (let i = 0; i < Math.round((reveal - 0.1) * 60); i++) {
    s.tick(dt);
    for (const e of s.drainEvents()) if (e.type === 'ping' && e.id === ys.id) pingTimes.push(i / 60);
    if (i < 6 * 60 && ys.revealed) visible.early++;
    if (i >= (reveal - 6) * 60 && ys.revealed) visible.late++;
  }
  const gaps = pingTimes.slice(1).map((t, i) => t - pingTimes[i]);
  check('pings speed up', gaps.length > 5 && gaps[0] > 3 && gaps[gaps.length - 1] < 1.2 && gaps.every((g, i) => i === 0 || g <= gaps[i - 1] + 0.02),
    `${pingTimes.length + 1} pings, gaps ${gaps[0].toFixed(2)}s -> ${gaps[gaps.length - 1].toFixed(2)}s`);
  check('visible more and more of the time', visible.late > visible.early * 3,
    `first 6s ${(visible.early / 3.6).toFixed(0)}% visible, last 6s ${(visible.late / 3.6).toFixed(0)}%`);
  evs = run(s, 0.3);
  check('fully exposed after lastStandReveal', evs.some((e) => e.type === 'exposed' && e.team === 'yellow') && ys.revealed);
  let always = true;
  for (let i = 0; i < 120; i++) { s.tick(dt); s.drainEvents(); if (!ys.revealed) always = false; }
  check('stays visible once exposed', always);
  check('round time left to finish him', s.phaseT > 10, `${s.phaseT.toFixed(1)}s left`);
  s.damage(td, 99, null, 'test');
  evs = run(s, 0.1);
  check('spy vs spy: both teams in last stand', evs.some((e) => e.type === 'lastStand' && e.team === 'teal') && s.lastStand.yellow);
  check('clock not extended by the second last stand', s.phaseT < GAME.lastStandTime - GAME.lastStandReveal);
}

// ---------- Nail gun ----------
{
  const s = setup({ yellow: ['builder', 'doctor'], teal: ['longman', 'longman'] });
  const [bd, doc] = s.teamMembers('yellow');
  const [l1, l2] = s.teamMembers('teal');
  put(bd, -18, -11, -Math.PI / 2); put(doc, -28, 0); put(l1, 25, 15); put(l2, 25, 17);
  bd.input.special = true;
  run(s, CHARACTERS.builder.buildTime + 0.2);
  bd.input.special = false;
  const t = s.towers[0];
  check('tower built', !!t);
  check('wrench while on the ground', bd.weapon === 'wrench' && !bd.onTower);
  bd.pos = { x: t.x, y: t.y + t.height + 0.01, z: t.z };
  run(s, 0.1);
  check('nail gun when standing on own tower', bd.weapon === 'nailgun' && bd.onTower);
  bd.input.slot = 2; run(s, 0.05);
  check('cannot switch weapons on the tower', bd.weapon === 'nailgun');

  const shootAt = (target, dist) => {
    put(target, t.x + dist, t.z, 0);
    target.hearts = target.maxHearts;
    const eyeY = bd.pos.y + CHARACTERS.builder.eye;
    const ty = target.pos.y + 1.2;
    bd.input.yaw = -Math.PI / 2; // facing +x
    bd.input.pitch = Math.atan2(ty - eyeY, dist);
    bd.attackCd = 0;
    bd.input.attack = true; s.tick(dt); bd.input.attack = false;
    return run(s, 1.2);
  };
  // Nails drop slightly, so aim straight and accept either a hit or a near miss at range
  let evs = shootAt(l1, 10);
  check('nail hurts an enemy 10 m from the tower', evs.some((e) => e.type === 'hurt' && e.id === l1.id && e.cause === 'nailgun'), `hearts ${l1.hearts}/${l1.maxHearts}`);
  evs = shootAt(l1, 3);
  check('nail deflects inside the blind spot', evs.some((e) => e.type === 'deflect' && e.id === l1.id) && l1.hearts === l1.maxHearts);
  evs = shootAt(l1, 24);
  check('nail does nothing beyond max range', !evs.some((e) => e.type === 'hurt' && e.id === l1.id));
  put(l1, 25, 15);

  // Teammates are not hit
  put(doc, t.x + 8, t.z); doc.hearts = 2;
  bd.input.pitch = Math.atan2(doc.pos.y + 1.2 - (bd.pos.y + CHARACTERS.builder.eye), 8); bd.attackCd = 0;
  bd.input.attack = true; s.tick(dt); bd.input.attack = false;
  evs = run(s, 1);
  check('nails fly past teammates', doc.hearts === 2 && !evs.some((e) => e.type === 'hurt' && e.id === doc.id));

  // A Spy steals the wrench while the Builder is on the tower: keeps the gun, gets fists on the ground
  bd.prevWeapon = 'wrench';
  bd.hasPrimary = false; bd.prevWeapon = 'fists';
  bd.pos = { x: t.x + 3, y: 0, z: t.z };
  run(s, 0.2);
  check('back on the ground after a steal: fists', bd.weapon === 'fists' && !bd.onTower);
}

// ---------- Capture the treasure (Crystal Cave) ----------
{
  const s = new Sim({ teamSize: 2, mapId: 'cave' });
  s.fillBots();
  s.newMatch();
  s.teamMembers('yellow').forEach((e, i) => { e.pick = ['longman', 'spy'][i]; });
  s.teamMembers('teal').forEach((e, i) => { e.pick = ['doctor', 'builder'][i]; });
  s.startRound();
  s.phase = 'play';
  s.phaseT = 100;
  for (const e of s.entities) e.brain = null;
  const [ylm, yspy] = s.teamMembers('yellow');
  const [tdoc, tbd] = s.teamMembers('teal');
  const flag = (team) => s.flags.find((f) => f.team === team);
  const homes = s.map.homes;
  put(ylm, 0, -9); put(yspy, 0, 9); put(tdoc, 2, -9); put(tbd, 2, 9);
  run(s, 0.1);
  check('both treasures start at home', s.flags.length === 2 && s.flags.every((f) => f.state === 'home'));

  // Walking over the enemy treasure picks it up; the Spy carrying it stays visible
  put(yspy, homes.teal.x - 0.5, homes.teal.z);
  let evs = run(s, 0.1);
  check('enemy picks up the treasure by walking over it', flag('teal').state === 'carried' && flag('teal').carrier === yspy.id && evs.some((e) => e.type === 'flagTake'));
  check('a Spy carrying the treasure is visible', yspy.revealed);
  check('owners cannot pick up their own treasure', flag('yellow').state === 'home');

  // Carrier dies: the treasure drops where he fell, and he respawns after respawnTime
  put(yspy, 10, 9);
  run(s, 0.05);
  s.damage(yspy, 99, tdoc, 'axe');
  evs = run(s, 0.1);
  check('carrier drops the treasure on death', flag('teal').state === 'dropped' && Math.abs(flag('teal').x - 10) < 0.5 && evs.some((e) => e.type === 'flagDrop'));
  check('no round end on a kill in capture the treasure', s.phase === 'play');
  evs = run(s, GAME.respawnTime - 0.5);
  check('still dead before the respawn time', !yspy.alive);
  evs = run(s, 0.7);
  check('respawns after the respawn time, in the home base', yspy.alive && yspy.pos.x < -30 && evs.some((e) => e.type === 'respawn' && e.id === yspy.id));

  // A teammate touching the dropped treasure sends it home
  put(tbd, 10.3, 9);
  evs = run(s, 0.1);
  check('teammate returns a dropped treasure', flag('teal').state === 'home' && evs.some((e) => e.type === 'flagReturn' && e.id === tbd.id));

  // A dropped treasure goes home on its own after flagReturnTime
  put(tdoc, homes.yellow.x + 0.5, homes.yellow.z);
  run(s, 0.1);
  put(tdoc, -15, 8);
  run(s, 0.05);
  s.damage(tdoc, 99, ylm, 'machete');
  put(ylm, 0, -9);
  run(s, GAME.flagReturnTime - 1);
  const stillDropped = flag('yellow').state === 'dropped';
  evs = run(s, 1.5);
  check('dropped treasure returns home on its own', stillDropped && flag('yellow').state === 'home' && evs.some((e) => e.type === 'flagReturn' && e.id === null));

  // The dead can switch character before respawning
  s.damage(ylm, 99, tbd, 'wrench');
  check('dead player may switch character while respawning', s.setPick(ylm.id, 'builder') && ylm.pick === 'builder');
  run(s, GAME.respawnTime + 0.2);
  check('respawns as the new character', ylm.alive && ylm.char === 'builder');

  // Bringing the enemy treasure into your own base wins the round
  put(yspy, homes.teal.x, homes.teal.z + 0.5);
  run(s, 0.05);
  put(yspy, homes.yellow.x + 1, homes.yellow.z);
  evs = run(s, 0.1);
  check('carrying the treasure home wins the round', s.phase === 'roundEnd' && s.winner === 'yellow' && s.score.yellow === 1 && evs.some((e) => e.type === 'flagCapture'));
}

// Elimination still ends the round on the arena map; no respawns there
{
  const s = setup({ yellow: ['longman'], teal: ['doctor'] });
  const [y] = s.teamMembers('yellow');
  const [t] = s.teamMembers('teal');
  s.damage(t, 99, y, 'machete');
  run(s, 0.1);
  check('arena: last team standing wins, no respawn', s.phase === 'roundEnd' && s.winner === 'yellow' && !t.alive);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
