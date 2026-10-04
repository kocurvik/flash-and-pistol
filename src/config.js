// All gameplay numbers live here so balance changes need no code edits.
// Values marked (assumption) in spec.md are starting points for playtesting.

export const WEAPONS = {
  // kind: 'cone' hits the nearest target in front, 'spin' hits every enemy around you.
  machete: { name: 'Machete', damage: 2, cooldown: 0.8, range: 2.4, arc: 40, kind: 'cone', anim: 'swing' },
  dagger:  { name: 'Dagger',  damage: 1, cooldown: 0.4, range: 2.0, arc: 40, kind: 'cone', anim: 'stab' },
  wrench:  { name: 'Wrench',  damage: 2, cooldown: 1.2, range: 2.0, kind: 'spin', anim: 'spin' },
  fists:   { name: 'Fists',   damage: 1, cooldown: 0.5, range: 1.8, arc: 40, kind: 'cone', anim: 'punch' },
  axe:     { name: 'Axe',     damage: 1, heal: 1, cooldown: 0.7, range: 2.3, arc: 40, kind: 'cone', anim: 'swing' },
  kick:    { name: 'Bird-leg kick', damage: 1, cooldown: 0.6, range: 2.0, arc: 40, kind: 'cone', anim: 'kick' },
  knife:   { name: 'Knife',   damage: 1, backstab: 2, cooldown: 0.5, range: 1.9, arc: 40, kind: 'cone', anim: 'stab' },
  // Builder's tower gun: only usable while standing on top of his own tower
  nailgun: { name: 'Nail gun', damage: 1, cooldown: 0.8, kind: 'gun', anim: 'shoot' },
};

export const CHARACTERS = {
  longman: {
    name: 'Longman', role: 'Tank', hearts: 6, speed: 4.0,
    height: 2.1, radius: 0.4, eye: 1.92,
    primary: 'machete', backup: 'dagger', special: 'medkit',
    medkitHeal: 2, medkitCooldown: 20,
    flashlightRange: 10, flashlightAngle: 22, // half-angle in degrees
    blurb: 'Slow and tough. {special}: medkit heals 2. Flashlight ({flash}) reveals Spies.',
  },
  builder: {
    name: 'Builder', role: 'Area control', hearts: 4, speed: 5.5,
    height: 1.6, radius: 0.5, eye: 1.45,
    primary: 'wrench', backup: 'fists', special: 'tower',
    buildTime: 2, towerHeight: 3, towerSize: 1.3, towerHp: 6,
    collapseRadius: 3, collapseDamage: 4, collapseSelfDamage: 1, towerCooldown: 25,
    // Nail gun from the tower top. Nails only hurt enemies whose distance from the
    // tower base is within [nailMinRange, nailMaxRange]: close enemies are in a blind spot.
    nailMinRange: 5, nailMaxRange: 20, nailSpeed: 30, nailGravity: -4,
    blurb: 'Wrench spins around you. Hold {special} to build a tower. On top: nail gun hits enemies 5–20 m away, {crouch}+{jump} collapses it.',
  },
  doctor: {
    name: 'Doctor', role: 'Healer', hearts: 4, speed: 7.2,
    height: 1.7, radius: 0.4, eye: 1.5,
    primary: 'axe', backup: 'kick', special: 'bottle',
    hops: true, doubleJump: true, hopSpeed: 4.6,
    bottleHeal: 2, bottleRadius: 2.5, bottleCooldown: 15, bottleSpeed: 13,
    blurb: 'Hops on a bird leg, double jump. Axe heals teammates. {special} throws a healing bottle.',
  },
  spy: {
    name: 'Spy', role: 'Thief / assassin', hearts: 3, speed: 6.5,
    height: 1.45, radius: 0.35, eye: 1.3,
    primary: 'fists', backup: null, special: 'steal',
    stealRange: 2.2, stealCooldown: 8, flickerTime: 1.0,
    // Unstable cloak: the Spy flickers visible for cloakFlicker s every cloakEvery s, all round
    cloakEvery: 3, cloakFlicker: 0.5,
    blurb: 'Invisible, but flickers into view for 0.5 s every 3 s. Starts with only fists (1♥). {special} steals an enemy weapon to fight with.',
  },
};

export const CHARACTER_ORDER = ['longman', 'builder', 'doctor', 'spy'];

export const GAME = {
  teamSize: 4,            // 1..6, bots fill empty slots
  roundsToWin: 3,         // best of 5
  roundTime: 180,
  pickTime: 20,
  countdown: 3,
  roundEndTime: 5,
  matchEndTime: 12,
  maxSameCharacter: 2,
  gravity: -20,
  jumpSpeed: 7,
  climbSpeed: 3.5,
  poundGravityScale: 3,
  stepHeight: 0.55,
  crouchSpeedScale: 0.5,
  crouchHeightScale: 0.7,
  tickRate: 60,
  snapshotRate: 20,
  bottleGravity: -15,
  // Last stand: when a team has only Spies alive, they are pinged to enemies.
  // Pings speed up from lastStandPing to lastStandPingMin s apart, and each one
  // reveals the Spy for longer, until he is fully visible after lastStandReveal s.
  // The round clock drops to at most lastStandTime s.
  lastStandPing: 4,
  lastStandPingMin: 0.5,
  lastStandReveal: 30,
  lastStandTime: 45,
};

export const DIFFICULTY = {
  easy:   { label: 'Easy',   reaction: 0.8, wobble: 25, specialChance: 0.35, attackChance: 0.6 },
  normal: { label: 'Normal', reaction: 0.4, wobble: 12, specialChance: 0.7,  attackChance: 0.85 },
  hard:   { label: 'Hard',   reaction: 0.2, wobble: 4,  specialChance: 1.0,  attackChance: 1.0 },
};

export const TEAMS = ['yellow', 'teal'];
export const TEAM_COLORS = { yellow: 0xf2c418, teal: 0x1fb5ad };
export const TEAM_NAMES = { yellow: 'Yellow', teal: 'Teal' };

export function projectileGravity(type) {
  return type === 'nail' ? CHARACTERS.builder.nailGravity : GAME.bottleGravity;
}
