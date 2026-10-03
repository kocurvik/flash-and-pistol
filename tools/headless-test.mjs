// Runs bot-only matches without a browser to catch simulation errors and
// sanity-check balance. Usage: node tools/headless-test.mjs [matches] [teamSize] [difficulty]
import { Sim } from '../src/sim.js';

const matches = +(process.argv[2] || 3);
const teamSize = +(process.argv[3] || 4);
const difficulty = process.argv[4] || 'normal';
const dt = 1 / 60;

const totals = {};
const charStats = {};
const roundLengths = [];
const wins = { yellow: 0, teal: 0 };

for (let m = 0; m < matches; m++) {
  const sim = new Sim({ teamSize, difficulty });
  sim.newMatch();
  let roundStart = 0;
  let steps = 0;
  while (sim.phase !== 'matchEnd' && steps < 60 * 60 * 30) {
    sim.tick(dt);
    steps++;
    for (const ev of sim.drainEvents()) {
      totals[ev.type] = (totals[ev.type] || 0) + 1;
      if (ev.type === 'fight') roundStart = sim.time;
      if (ev.type === 'roundEnd') roundLengths.push(sim.time - roundStart);
      if (ev.type === 'kill') {
        const killer = sim.get(ev.killer);
        const victim = sim.get(ev.victim);
        if (killer && killer !== victim) {
          charStats[killer.char] = charStats[killer.char] || { kills: 0, deaths: 0 };
          charStats[killer.char].kills++;
        }
        charStats[victim.char] = charStats[victim.char] || { kills: 0, deaths: 0 };
        charStats[victim.char].deaths++;
        totals['kill:' + ev.cause] = (totals['kill:' + ev.cause] || 0) + 1;
      }
    }
  }
  if (sim.matchWinner) wins[sim.matchWinner]++;
  console.log(`match ${m + 1}: winner=${sim.matchWinner} score=${JSON.stringify(sim.score)} rounds=${sim.round} simTime=${sim.time.toFixed(0)}s`);
}

const avg = roundLengths.reduce((a, b) => a + b, 0) / Math.max(1, roundLengths.length);
console.log('wins', wins);
console.log('avg round length', avg.toFixed(1) + 's', 'timeouts', totals.timeUp || 0, 'of', roundLengths.length);
console.log('events', totals);
console.log('per character', charStats);
