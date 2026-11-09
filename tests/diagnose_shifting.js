/* Before/after check: do agents move between start slots?
 * Usage: node tests/diagnose_shifting.js [N ...]
 * Runs both decision rules (legacy and utility), info none, memory 5, population
 * seeds 1-5 (simulation seed 100000 + population seed), 40 days with 10 burn-in,
 * and prints seed-averaged shifting and crowding metrics.
 */
const fs = require('node:fs'), path = require('node:path');
const G = require('../web/simulation.js');
const root = path.resolve(__dirname, '..');
const rules = G.parseRules(fs.readFileSync(path.join(root, 'web/profile-rules.csv'), 'utf8'));
const history = G.parseSeedHistory(fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8'));
const sizes = process.argv.slice(2).map(Number).filter(Number.isInteger);
const SEEDS = [1, 2, 3, 4, 5];
const average = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

function run(decisionRule, agentCount, populationSeed) {
  const s = new G.Simulation(rules, history, { decisionRule, agentCount, capacity: 37, mode: 'none', memory: 5, maxDays: 40, burnIn: 10, populationSeed, simulationSeed: 100000 + populationSeed });
  while (!s.done) s.step();
  const r = s.summary();
  // Fixed-start share split by crowding type (eligible agents only).
  const byCrowding = [0, 1, 2].map(type => {
    const group = s.agents.filter(a => a.crowding === type && a.allowedStarts.length);
    return group.length ? group.filter(a => a.fixedStart >= 0).length / group.length : 0;
  });
  return { ...r, byCrowding };
}

const rows = [];
for (const agentCount of sizes.length ? sizes : [100, 400]) for (const rule of ['legacy', 'utility']) {
  const runs = SEEDS.map(seed => run(rule, agentCount, seed));
  const pick = key => average(runs.map(r => r[key]));
  rows.push({
    N: agentCount, rule,
    'fixed (all)': pick('fixed-start-share').toFixed(2),
    'fixed indiff/busy/empty': [0, 1, 2].map(i => average(runs.map(r => r.byCrowding[i])).toFixed(2)).join('/'),
    'change rate': pick('start-change-rate').toFixed(3),
    'mean shift': pick('mean-start-shift').toFixed(2),
    'later than plan': pick('later-than-planned-share').toFixed(3),
    '% over cap': pick('pct-slots-over-capacity').toFixed(2),
    peak: pick('peak-occupancy').toFixed(1),
    'skip rate': pick('skip-rate').toFixed(3),
    'structural skip': pick('structural-skip-rate').toFixed(3),
    'profile rmse': pick('profile-rmse').toFixed(2),
  });
}
console.log(`none, memory 5, capacity 37, seeds ${SEEDS.join(',')}, days 11-40`);
console.table(rows);
