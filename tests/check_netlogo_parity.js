/* Compare actual NetLogo BehaviorSpace output to the browser engine.
 * Usage: node tests/check_netlogo_parity.js data/processed/preferences_pilot.csv
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const G = require('../web/simulation.js');
const root = path.resolve(__dirname, '..');
const file = process.argv[2];
if (!file) throw Error('Supply a completed preferences BehaviorSpace CSV');
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const start = lines.findIndex(line => line.includes('"[run number]"'));
assert(start >= 0, 'Missing BehaviorSpace header');
const parse = line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));
const header = parse(lines[start]);
const rows = lines.slice(start + 1).filter(Boolean).map(line => Object.fromEntries(parse(line).map((v, i) => [header[i], v])));
assert(rows.length > 0, 'No completed runs');
const rules = G.parseRules(fs.readFileSync(path.join(root, 'web/profile-rules.csv'), 'utf8'));
const history = G.parseSeedHistory(fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8'));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function autocorrelation(points) {
  const pairs = points.slice(1).map((p, i) => [points[i], p]).filter(([a, b]) => a.day === b.day);
  if (pairs.length < 2) return 0;
  const x = pairs.map(p => p[0].attendance), y = pairs.map(p => p[1].attendance), mx = mean(x), my = mean(y);
  const numerator = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  const denominator = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0));
  return denominator ? numerator / denominator : 0;
}
for (const row of rows) {
  const o = { agentCount: +row['n-agents'], capacity: +row.capacity, memory: +row['memory-size'], strategies: +row['number-strategies'], mode: row['info-mode'], delay: +row.delay, maxDays: +row['[step]'] / 31, burnIn: +row['burn-in-days'], duration: +row['workout-slots'], populationSeed: +row['population-seed'], simulationSeed: +row['simulation-seed'], mustGo: row['must-go?'] === 'true' };
  assert.equal(row['seed-from-data?'], 'true');
  const s = new G.Simulation(rules, history, o);
  while (!s.done) s.step();
  const m = s.metrics, counts = m.occupancy.map(p => p.attendance), average = counts.length ? mean(counts) : 0;
  const actual = { 'peak-occupancy': m.peak, 'pct-slots-over-capacity': m.slots ? 100 * m.over / m.slots : 0, 'occupancy-variance': counts.length ? mean(counts.map(x => (x - average) ** 2)) : 0, 'good-visit-rate': m.visits ? m.good / m.visits : 0, 'skip-rate': m.agentDays ? m.skips / m.agentDays : 0, 'lag1-autocorr': autocorrelation(m.occupancy) };
  for (const [metric, value] of Object.entries(actual)) assert(Math.abs(value - Number(row[metric])) < 1e-8, `Run ${row['[run number]']} (${o.mode}, memory ${o.memory}, seed ${o.populationSeed}) ${metric}: browser=${value}, NetLogo=${row[metric]}`);
}
console.log(`Browser and NetLogo agree on all six reporters for ${rows.length} completed runs`);
