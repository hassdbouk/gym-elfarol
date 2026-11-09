/* Calibrate the population size N against the real share of slots over capacity.
 *
 * Method (information condition "none" only, so no information effect is tuned):
 *   1. Coarse grid of N (default 250-500 step 25) x memory 1/5/10 x 30 population seeds,
 *      utility rule with model defaults, capacity 37, 50 days with 20 burn-in.
 *   2. Fine grid (step 5) between the two coarse points that bracket the target.
 *   3. N* = linear interpolation where the seed- and memory-averaged % of slots over
 *      capacity crosses the real target (validation_targets.json), rounded to an integer.
 *   4. Uncertainty: the same crossing computed per population seed; 2.5-97.5 percentiles.
 *   Occupancy-profile RMSE against the real curve is reported as a check, not a target.
 *
 * Seeds are used unscaled (scaleSeedWithN off): they are already in capacity-anchored
 * units, which is the real curve at every N being tested.
 *
 * Usage: node analysis/calibrate_n.js [--seeds 30] [--threads 15] [--coarse 250:500:25] [--fine-step 5]
 * Writes data/processed/calibration_n.json and data/processed/calibration_n.csv.
 */
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..');
const G = require(path.join(root, 'web/simulation.js'));

const SETTINGS = { mode: 'none', capacity: 37, maxDays: 50, burnIn: 20, decisionRule: 'utility', profileMix: 'balanced', scaleSeedWithN: false };
const MEMORIES = [1, 5, 10];

function runOne({ agentCount, memory, populationSeed }) {
  const rules = G.parseRules(fs.readFileSync(path.join(root, 'web/profile-rules.csv'), 'utf8'));
  const history = G.parseSeedHistory(fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8'));
  const s = new G.Simulation(rules, history, { ...SETTINGS, agentCount, memory, populationSeed, simulationSeed: 100000 + populationSeed });
  while (!s.done) s.step();
  const r = s.summary();
  return { agentCount, memory, populationSeed, over: r['pct-slots-over-capacity'], rmse: r['profile-rmse'], skip: r['skip-rate'], good: r['good-visit-rate'], peak: r['peak-occupancy'], change: r['start-change-rate'] };
}

if (!isMainThread) {
  parentPort.on('message', jobs => parentPort.postMessage(jobs.map(runOne)));
  return;
}

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, x, i, a) => (x.startsWith('--') ? [...pairs, [x.slice(2), a[i + 1]]] : pairs), []));
const SEEDS = Array.from({ length: Number(args.seeds || 30) }, (_, i) => i + 1);
const THREADS = Number(args.threads || Math.max(1, os.cpus().length - 1));
const [c0, c1, cStep] = (args.coarse || '250:500:25').split(':').map(Number);
const FINE_STEP = Number(args['fine-step'] || 5);
const targets = JSON.parse(fs.readFileSync(path.join(root, 'data/processed/validation_targets.json'), 'utf8'));
const TARGET = targets.pct_slots_over_capacity;

async function runAll(jobs) {
  const chunks = Array.from({ length: THREADS }, () => []);
  jobs.forEach((job, i) => chunks[i % THREADS].push(job));
  const results = await Promise.all(chunks.filter(c => c.length).map(chunk => new Promise((resolve, reject) => {
    const worker = new Worker(__filename);
    worker.once('message', out => { resolve(out); worker.terminate(); });
    worker.once('error', reject);
    worker.postMessage(chunk);
  })));
  return results.flat();
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)));
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
// N where a curve of (N, value) points first crosses the target, by linear interpolation.
function crossing(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    const [n0, v0] = sorted[i - 1], [n1, v1] = sorted[i];
    if ((v0 - TARGET) * (v1 - TARGET) <= 0 && v0 !== v1) return n0 + (TARGET - v0) * (n1 - n0) / (v1 - v0);
  }
  return null;
}

(async () => {
  const started = Date.now(), results = [];
  const grid = async ns => {
    const todo = ns.filter(n => !results.some(r => r.agentCount === n));
    const jobs = todo.flatMap(agentCount => MEMORIES.flatMap(memory => SEEDS.map(populationSeed => ({ agentCount, memory, populationSeed }))));
    console.log(`Running ${jobs.length} runs for N = ${todo.join(', ')} on ${THREADS} threads`);
    results.push(...await runAll(jobs));
  };
  const byN = () => [...new Set(results.map(r => r.agentCount))].sort((a, b) => a - b).map(n => {
    const rs = results.filter(r => r.agentCount === n);
    const perSeed = SEEDS.map(seed => mean(rs.filter(r => r.populationSeed === seed).map(r => r.over)));
    const byMemory = Object.fromEntries(MEMORIES.map(m => [`overMemory${m}`, mean(rs.filter(r => r.memory === m).map(r => r.over))]));
    return { n, over: mean(rs.map(r => r.over)), ...byMemory, overSd: sd(perSeed), skip: mean(rs.map(r => r.skip)), good: mean(rs.map(r => r.good)), rmse: mean(rs.map(r => r.rmse)), peak: mean(rs.map(r => r.peak)), change: mean(rs.map(r => r.change)), perSeed };
  });

  const coarse = [];
  for (let n = c0; n <= c1; n += cStep) coarse.push(n);
  await grid(coarse);
  let table = byN();
  const bracket = table.findIndex((row, i) => i > 0 && (table[i - 1].over - TARGET) * (row.over - TARGET) <= 0);
  if (bracket < 0) throw Error(`Target ${TARGET}% not bracketed by N ${c0}-${c1}; widen --coarse`);
  const fine = [];
  for (let n = table[bracket - 1].n + FINE_STEP; n < table[bracket].n; n += FINE_STEP) fine.push(n);
  await grid(fine);
  table = byN();

  const chosen = Math.round(crossing(table.map(r => [r.n, r.over])));
  const seedCrossings = SEEDS.map((_, i) => crossing(table.map(r => [r.n, r.perSeed[i]])));
  const valid = seedCrossings.filter(x => x !== null);
  const nearest = table.reduce((best, r) => (Math.abs(r.n - chosen) < Math.abs(best.n - chosen) ? r : best));
  const out = {
    target_pct_slots_over_capacity: TARGET,
    chosen_n: chosen,
    capacity: SETTINGS.capacity,
    capacity_ratio_pct: Math.round(10000 * SETTINGS.capacity / chosen) / 100,
    seed_crossing_ci95: valid.length ? [Math.round(quantile(valid, 0.025)), Math.round(quantile(valid, 0.975))] : null,
    seeds_crossing_in_range: `${valid.length}/${SEEDS.length}`,
    check_at_nearest_grid_n: { n: nearest.n, profile_rmse: +nearest.rmse.toFixed(3), skip_rate: +nearest.skip.toFixed(4), good_visit_rate: +nearest.good.toFixed(4), start_change_rate: +nearest.change.toFixed(3), peak: +nearest.peak.toFixed(1) },
    method: 'info none; memory 1/5/10; population seeds 1-' + SEEDS.length + ' (simulation seed 100000 + seed); utility rule with model defaults; ' +
      `${SETTINGS.maxDays} days, ${SETTINGS.burnIn} burn-in; coarse grid ${c0}-${c1} step ${cStep}, fine step ${FINE_STEP}; N* by linear interpolation of the mean % over capacity; CI from per-seed crossings.`,
    settings: { ...SETTINGS, memories: MEMORIES, defaults: G.DEFAULTS },
    grid: table.map(({ perSeed, ...r }) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(4)]))),
    runtime_seconds: Math.round((Date.now() - started) / 1000),
  };
  fs.writeFileSync(path.join(root, 'data/processed/calibration_n.json'), JSON.stringify(out, null, 2) + '\n');
  const header = 'n,pct_over_capacity,pct_over_memory1,pct_over_memory5,pct_over_memory10,pct_over_sd_across_seeds,skip_rate,good_visit_rate,profile_rmse,peak,start_change_rate';
  fs.writeFileSync(path.join(root, 'data/processed/calibration_n.csv'), [header, ...out.grid.map(r => [r.n, r.over, r.overMemory1, r.overMemory5, r.overMemory10, r.overSd, r.skip, r.good, r.rmse, r.peak, r.change].join(','))].join('\n') + '\n');
  console.table(out.grid);
  console.log(`Target ${TARGET}% -> N* = ${chosen} (per-seed 95% range ${JSON.stringify(out.seed_crossing_ci95)}, ${out.seeds_crossing_in_range} seeds cross), capacity ratio ${out.capacity_ratio_pct}%, ${out.runtime_seconds}s`);
})().catch(error => { console.error(error); process.exit(1); });
