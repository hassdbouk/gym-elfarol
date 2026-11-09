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
rules.mix = G.parseProfileMix(fs.readFileSync(path.join(root, 'web/profile-mix.csv'), 'utf8'));
const history = G.parseSeedHistory(fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8'));
// NetLogo writes list reporters as "[a b c]".
const netlogoList = text => text.replace(/^\[|\]$/g, '').trim().split(/\s+/).filter(Boolean).map(Number);
const close = (a, b) => Math.abs(a - b) < 1e-8;
const UTILITY_COLUMNS = {
  'workout-value': 'workoutValue', 'crowd-penalty': 'crowdPenalty', 'comfort-threshold': 'comfortThreshold', 'time-weight': 'timeWeight',
  'taste-weight': 'tasteWeight', 'choice-temperature': 'temperature', 'outcome-learning?': 'outcomeLearning', 'learning-rate': 'learningRate', 'learning-weight': 'learningWeight',
  'recency-decay': 'recencyDecay', 'scale-seed-with-n?': 'scaleSeedWithN', 'capacity-from-ratio?': 'capacityFromRatio',
  'capacity-ratio': 'capacityRatio', 'profile-mix': 'profileMix',
};
const BOOLEAN_OPTIONS = new Set(['outcomeLearning', 'scaleSeedWithN', 'capacityFromRatio']);
let compared = 0;
for (const row of rows) {
  const o = {
    agentCount: +row['n-agents'], capacity: +row.capacity, memory: +row['memory-size'], strategies: +row['number-strategies'],
    mode: row['info-mode'], delay: +row.delay, maxDays: +row['[step]'] / 31, burnIn: +row['burn-in-days'], duration: +row['workout-slots'],
    populationSeed: +row['population-seed'], simulationSeed: +row['simulation-seed'], mustGo: row['must-go?'] === 'true',
    decisionRule: row['decision-rule'] || 'legacy', // tables written before the switch are legacy runs
  };
  // Utility-rule globals; tables that do not record them fall back to the shared defaults.
  for (const [column, key] of Object.entries(UTILITY_COLUMNS)) if (column in row) o[key] = BOOLEAN_OPTIONS.has(key) ? row[column] === 'true' : key === 'profileMix' ? row[column] : Number(row[column]);
  assert.equal(row['seed-from-data?'], 'true');
  const s = new G.Simulation(rules, history, o);
  while (!s.done) s.step();
  const label = `Run ${row['[run number]']} (${o.decisionRule}, ${o.mode}, memory ${o.memory}, seed ${o.populationSeed})`;
  for (const [metric, value] of Object.entries(s.summary())) {
    if (!(metric in row)) continue; // older tables lack the newer reporters
    if (Array.isArray(value)) {
      const netlogo = netlogoList(row[metric]);
      assert.equal(netlogo.length, value.length, `${label} ${metric}: length`);
      value.forEach((v, i) => assert(close(v, netlogo[i]), `${label} ${metric}[${i}]: browser=${v}, NetLogo=${netlogo[i]}`));
    } else {
      assert(close(value, Number(row[metric])), `${label} ${metric}: browser=${value}, NetLogo=${row[metric]}`);
    }
    compared++;
  }
}
console.log(`Browser and NetLogo agree on ${compared} reporter values across ${rows.length} completed runs`);
